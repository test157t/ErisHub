import type { PromptBlock, ProviderConfig } from "../../shared/types";
import { moduleTool, type AppModule, type AfterChatContext, type AfterChatEvent } from "./types";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findAgentFolderSync, listAgentFolders } from "./agentSections";
import { completeProvider } from "./providerCompletion";
import { readJsonStore, writeJsonStore } from "./jsonStore";
import { Readable } from "node:stream";
import WebSocket from "ws";
import {
  AudioPlayerStatus,
  EndBehaviorType,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel
} from "@discordjs/voice";
import { resolveSpeechRuntime, resampleSpeechPcm16, speechAsrAudioPayload, speechAsrUrl, speechPcmBuffer, speechTranscript, streamSpeechAudio } from "./sip";

const moduleRoot = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(moduleRoot, "..", "..");
const dataRoot = path.join(appRoot, "data");
const configPath = path.join(dataRoot, "discord-config.json");

export type DiscordConfig = {
  token: string;
  channelId: string;
  guildId: string;
  autoFireReminders: boolean;
  mentionTargets: Array<{ name: string; userId: string; defaultAgent?: string }>;
  providerId: string;
  providerEndpoint: string;
  providerModel: string;
  providerApiKey: string;
  providerTemperature: number;
  activeAgentsByChannel: Record<string, string>;
};

let discordConfig: DiscordConfig = { token: "", channelId: "", guildId: "", autoFireReminders: false, mentionTargets: [], providerId: "", providerEndpoint: "", providerModel: "", providerApiKey: "", providerTemperature: 0.7, activeAgentsByChannel: {} };
let botClient: any = null;
let botStarting: Promise<any> | null = null;
let currentIdentityAgent = "";
let currentAvatarSignature = "";
type DiscordChatResult = { content: string; agent: string | null; afterReply?: () => Promise<void> };
type DiscordChatRunner = (input: { conversationId: string; message: string; agentName?: string | null; userId?: string | null }) => Promise<DiscordChatResult>;
let discordChatRunner: DiscordChatRunner | null = null;
let discordResetRunner: (() => Promise<void>) | null = null;

type VoiceControl = "join" | "leave";
type DiscordVoiceCapture = { chunks: Buffer[]; capturing: boolean; silentChunks: number; speechChunks: number };
type DiscordVoiceSession = { agentName: string; channelId: string; connection: any; player: any; captures: Map<string, DiscordVoiceCapture>; pendingCaptures: Set<string>; textChannel: any; playbackQueue: Promise<void> };
const VOICE_VAD_START_CHUNKS = 5;
const VOICE_VAD_SILENCE_CHUNKS = 45;
const VOICE_VAD_RMS = 800;
const voiceSessions = new Map<string, DiscordVoiceSession>();
const pendingVoiceConnections = new Map<string, any>();
const voiceControlQueues = new Map<string, Promise<DiscordVoiceSession | null>>();

function bounded<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer!));
}

function clearVoiceConnection(guildId: string) {
  const pending = pendingVoiceConnections.get(guildId);
  pendingVoiceConnections.delete(guildId);
  const session = voiceSessions.get(guildId);
  voiceSessions.delete(guildId);
  try { pending?.destroy(); } catch {}
  if (session?.connection !== pending) {
    try { session?.connection.destroy(); } catch {}
  }
}

async function transcribeDiscordPcm(runtime: Awaited<ReturnType<typeof resolveSpeechRuntime>>, pcm: Buffer) {
  return new Promise<string>((resolve, reject) => {
    const socket = new WebSocket(speechAsrUrl(runtime.asrEndpoint, runtime.asrModel));
    let settled = false;
    const timer = setTimeout(() => { socket.close(); reject(new Error("Discord voice transcription timed out.")); }, 20_000);
    const finish = (value: string, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      if (error) reject(error); else resolve(value);
    };
    socket.on("open", () => {
      socket.send(speechAsrAudioPayload(pcm).message);
      socket.send(JSON.stringify({ type: "flush" }));
    });
    socket.on("message", (message) => {
      try {
        const text = speechTranscript(JSON.parse(message.toString()));
        if (text) finish(text);
      } catch (error) { finish("", error instanceof Error ? error : new Error("Invalid ASR response.")); }
    });
    socket.on("error", (error) => finish("", error));
    socket.on("close", () => {
      if (!settled) finish("", new Error("ASR closed before returning a final transcript."));
    });
  });
}

function discordPlaybackPcm(pcm16Mono: Buffer) {
  const mono = resampleSpeechPcm16(new Int16Array(pcm16Mono.buffer, pcm16Mono.byteOffset, Math.floor(pcm16Mono.length / 2)), 16000, 48000);
  const stereo = new Int16Array(mono.length * 2);
  for (let index = 0; index < mono.length; index += 1) stereo[index * 2] = stereo[index * 2 + 1] = mono[index];
  return speechPcmBuffer(stereo);
}

async function speakDiscordResponse(session: DiscordVoiceSession, content: string, runtime: Awaited<ReturnType<typeof resolveSpeechRuntime>>) {
  const stream = Readable.from((async function* () {
    for await (const audio of streamSpeechAudio({ ...runtime, content })) {
      yield discordPlaybackPcm(audio);
    }
  })());
  const resource = createAudioResource(stream, { inputType: StreamType.Raw });
  const previous = session.playbackQueue.catch(() => undefined);
  session.playbackQueue = previous.then(async () => {
    session.player.play(resource);
    await entersState(session.player, AudioPlayerStatus.Playing, 5_000).catch(() => undefined);
    await Promise.race([
      entersState(session.player, AudioPlayerStatus.Idle, 300_000),
      entersState(session.player, AudioPlayerStatus.AutoPaused, 300_000)
    ]).catch(() => undefined);
  });
  await session.playbackQueue;
}

async function sendVoiceStatus(session: DiscordVoiceSession, content: string) {
  if (!session.textChannel?.send) return;
  await bounded(Promise.resolve(session.textChannel.send(content)), 5_000, "Discord voice text status").catch(() => undefined);
}

export function resolveDiscordAgentContext(input: {
  explicitAgent?: string | null;
  activeDiscordAgent?: string | null;
  channelDefault?: string | null;
  userDefault?: string | null;
  activeChatAgent?: string | null;
}) {
  return [input.explicitAgent, input.activeDiscordAgent, input.channelDefault, input.userDefault, input.activeChatAgent]
    .map((value) => String(value || "").trim())
    .find((value) => value && findAgentFolderSync(value)) || null;
}

async function discordAgentForChannel(cfg: DiscordConfig, channelId: string, userId?: string, explicitAgent?: string | null) {
  const channelDefault = resolveMentionTarget(cfg, channelId)?.defaultAgent || null;
  const userDefault = userId ? mentionTargetForUser(cfg, userId)?.defaultAgent || null : null;
  return resolveDiscordAgentContext({
    explicitAgent,
    activeDiscordAgent: cfg.activeAgentsByChannel[channelId],
    channelDefault,
    userDefault,
    activeChatAgent: await activeAgentName()
  });
}

async function persistDiscordChannelAgent(channelId: string, agentName: string) {
  if (!channelId || !findAgentFolderSync(agentName)) return;
  const cfg = await readDiscordConfig();
  if (cfg.activeAgentsByChannel[channelId] === agentName) return;
  await writeDiscordConfig({ ...cfg, activeAgentsByChannel: { ...cfg.activeAgentsByChannel, [channelId]: agentName } });
  const guildId = [...voiceSessions.entries()].find(([, session]) => String(session.textChannel?.id || "") === channelId)?.[0];
  if (guildId) voiceSessions.get(guildId)!.agentName = agentName;
}

function rootMeanSquare(samples: Int16Array) {
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) sum += samples[index] * samples[index];
  return Math.sqrt(sum / Math.max(samples.length, 1));
}

function handleDiscordCaptureChunk(guild: any, session: DiscordVoiceSession, userId: string, capture: DiscordVoiceCapture, chunk: Buffer) {
  const frame = new Int16Array(chunk.buffer, chunk.byteOffset, Math.floor(chunk.length / 2));
  const mono = new Int16Array(Math.floor(frame.length / 2));
  for (let index = 0; index < mono.length; index += 1) mono[index] = Math.round(((frame[index * 2] || 0) + (frame[index * 2 + 1] || 0)) / 2);
  const loud = rootMeanSquare(mono) >= VOICE_VAD_RMS;
  if (!capture.capturing) {
    capture.speechChunks = loud ? capture.speechChunks + 1 : 0;
    if (capture.speechChunks < VOICE_VAD_START_CHUNKS) return;
    capture.capturing = true;
    capture.chunks.length = 0;
    capture.silentChunks = 0;
  }
  capture.chunks.push(Buffer.from(chunk));
  capture.silentChunks = loud ? 0 : capture.silentChunks + 1;
  if (capture.silentChunks >= VOICE_VAD_SILENCE_CHUNKS) {
    const utterance = capture.chunks;
    capture.chunks = [];
    capture.capturing = false;
    capture.speechChunks = 0;
    capture.silentChunks = 0;
    void handleDiscordUtterance(guild, session, userId, utterance);
  }
}

async function handleDiscordUtterance(guild: any, session: DiscordVoiceSession, userId: string, chunks: Buffer[]) {
  if (!chunks.length) return;
  let stage = "receiving audio";
  try {
    const decodedPcm = Buffer.concat(chunks);
    const stereo = new Int16Array(decodedPcm.buffer, decodedPcm.byteOffset, Math.floor(decodedPcm.length / 2));
    const mono = new Int16Array(Math.floor(stereo.length / 2));
    for (let index = 0; index < mono.length; index += 1) mono[index] = Math.round(((stereo[index * 2] || 0) + (stereo[index * 2 + 1] || 0)) / 2);
    if (rootMeanSquare(mono) < VOICE_VAD_RMS) return;
    stage = "resolving speech configuration";
    const cfg = await readDiscordConfig();
    const textChannelId = String(session.textChannel?.id || "");
    const agentName = resolveDiscordAgentContext({ activeDiscordAgent: cfg.activeAgentsByChannel[textChannelId] || session.agentName });
    if (!agentName) throw new Error("No active Discord agent is selected for this channel.");
    const runtime = await resolveSpeechRuntime(agentName, cfg.providerId || "");
    stage = "sending audio to ASR";
    console.log(`Discord voice: sending ${mono.length} decoded samples to ASR for guild ${guild.id}.`);
    const transcript = await transcribeDiscordPcm(runtime, speechPcmBuffer(resampleSpeechPcm16(mono, 48000, 16000)));
    if (!transcript.trim()) return;
    console.log(`Discord voice: ASR returned a final transcript for guild ${guild.id}.`);
    stage = "generating the agent response";
    const result = await chatCompletion(`discord:voice:${guild.id}:${session.channelId}`, transcript, agentName, userId);
    if (!result.content.trim() || result.content.startsWith("*Chat error:") || result.content.startsWith("*Provider request failed:")) throw new Error(result.content.replace(/^\*|\*$/g, ""));
    const responseAgent = result.agent || agentName;
    await applyAgentIdentity(guild.client, responseAgent);
    stage = "synthesizing VoiceForge audio";
    const responseRuntime = await resolveSpeechRuntime(responseAgent, cfg.providerId || "");
    await speakDiscordResponse(session, result.content, responseRuntime);
    console.log(`Discord voice: playback started for ${responseAgent} in guild ${guild.id}.`);
    result.afterReply?.().catch((error) => console.error("Discord voice post-reply action failed:", error));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Discord voice ${stage} failed:`, message);
    await sendVoiceStatus(session, `*Voice conversation failed while ${stage}: ${message}*`);
  }
}

async function handleDiscordStartSpeaking(guild: any, session: DiscordVoiceSession, userId: string) {
  if (userId === guild.client.user?.id || session.captures.has(userId) || session.pendingCaptures.has(userId)) return;
  session.pendingCaptures.add(userId);
  try {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member?.user?.bot) return;
    const prismImport = await import("prism-media");
    const prism = (prismImport.default || prismImport) as any;
    const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
    const opus = session.connection.receiver.subscribe(userId, { end: { behavior: EndBehaviorType.Manual } });
    const capture: DiscordVoiceCapture = { chunks: [], capturing: false, silentChunks: 0, speechChunks: 0 };
    session.captures.set(userId, capture);
    decoder.on("data", (chunk: Buffer) => handleDiscordCaptureChunk(guild, session, userId, capture, chunk));
    decoder.on("error", () => session.captures.delete(userId));
    decoder.on("close", () => session.captures.delete(userId));
    opus.on("error", () => decoder.destroy());
    opus.pipe(decoder);
  } catch (error) {
    session.captures.delete(userId);
    console.error("Discord voice receiver error:", error instanceof Error ? error.message : error);
  } finally {
    session.pendingCaptures.delete(userId);
  }
}

export function discordVoiceControlForText(text: string): VoiceControl | null {
  const command = text.trim().toLowerCase().replace(/[!.,?]+$/, "").replace(/\s+/g, " ");
  const target = String.raw`\b(?:vc|voice(?:\s*(?:chat|channel))?)\b`;
  const joinVerb = String.raw`\b(?:join|enter|come\s*(?:to|in|into)?|get\s+(?:in|into|on)|hop\s*(?:in|into|on)?|jump\s*(?:in|into|on)?|go\s*(?:in|into|to)?)\b`;
  const leaveVerb = String.raw`\b(?:leave|exit|get\s*out(?:\s*of)?|hop\s*out(?:\s*of)?)\b`;
  if (new RegExp(`${joinVerb}.{0,18}?${target}`).test(command)) return "join";
  if (new RegExp(`${leaveVerb}.{0,18}?${target}`).test(command)) return "leave";
  return null;
}

async function performVoiceControl(message: any, control: VoiceControl, explicitAgent?: string | null): Promise<DiscordVoiceSession | null> {
  const guild = message.guild;
  if (!guild) throw new Error("Voice controls are only available in a server.");
  if (control === "leave") {
    const connection = getVoiceConnection(guild.id);
    if (!connection) return null;
    clearVoiceConnection(guild.id);
    try { connection.destroy(); } catch {}
    return null;
  }
  const channel = message.member?.voice?.channel;
  if (!channel?.isVoiceBased?.()) throw new Error("Join a voice channel first, then ask me to join.");
  const existing = getVoiceConnection(guild.id);
  if (existing?.joinConfig.channelId === channel.id && voiceSessions.has(guild.id)) return voiceSessions.get(guild.id) || null;
  clearVoiceConnection(guild.id);
  try { existing?.destroy(); } catch {}
  let connection: any = null;
  try {
    connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false
    });
    pendingVoiceConnections.set(guild.id, connection);
    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
    const cfg = await readDiscordConfig();
    const displayAgent = String(guild.members.me?.displayName || "").trim();
    const agentName = await discordAgentForChannel(cfg, String(message.channelId || message.channel?.id || ""), String(message.author?.id || ""), explicitAgent || (findAgentFolderSync(displayAgent) ? displayAgent : null));
    if (!agentName) throw new Error("No Discord agent is mapped to this channel or member.");
    await persistDiscordChannelAgent(String(message.channelId || message.channel?.id || ""), agentName);
    if (pendingVoiceConnections.get(guild.id) !== connection) throw new Error("Discord voice join was cancelled.");
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    player.on("error", (error: Error) => console.error("Discord voice playback error:", error.message));
    connection.subscribe(player);
    const session: DiscordVoiceSession = { agentName, channelId: channel.id, connection, player, captures: new Map(), pendingCaptures: new Set(), textChannel: message.channel, playbackQueue: Promise.resolve() };
    pendingVoiceConnections.delete(guild.id);
    voiceSessions.set(guild.id, session);
    connection.receiver.speaking.on("start", (userId: string) => {
      void handleDiscordStartSpeaking(guild, session, userId);
    });
    connection.on(VoiceConnectionStatus.Disconnected, () => clearVoiceConnection(guild.id));
    return session;
  } catch (error) {
    pendingVoiceConnections.delete(guild.id);
    try { connection?.destroy(); } catch {}
    console.error("Discord voice join failed:", error instanceof Error ? error.message : error);
    throw new Error("I could not join the voice channel. Check that I have Connect and Speak permissions.");
  }
}

function queueVoiceControl(message: any, control: VoiceControl, explicitAgent?: string | null): Promise<DiscordVoiceSession | null> {
  const guildId = String(message.guild?.id || `dm:${message.author?.id || "unknown"}`);
  const previous = voiceControlQueues.get(guildId) || Promise.resolve();
  let task: Promise<DiscordVoiceSession | null>;
  task = previous
    .catch(() => null)
    .then(async () => {
      try {
        return await bounded(performVoiceControl(message, control, explicitAgent), 12_000, `Discord voice ${control}`);
      } catch (error) {
        if (message.guild?.id) clearVoiceConnection(message.guild.id);
        console.error("Discord voice control failed:", error instanceof Error ? error.message : error);
        const result = error instanceof Error && error.message
          ? error.message
          : control === "join"
            ? "I could not join the voice channel. Check that I have Connect and Speak permissions."
            : "I could not leave the voice channel cleanly.";
        await bounded(Promise.resolve(message.reply(result)), 5_000, "Discord voice error reply").catch(() => undefined);
        return null;
      }
    })
    .catch((error) => {
      console.error("Discord voice queue error:", error instanceof Error ? error.message : error);
      return null;
    })
    .finally(() => {
      if (voiceControlQueues.get(guildId) === task) voiceControlQueues.delete(guildId);
    });
  voiceControlQueues.set(guildId, task);
  return task;
}

export function setDiscordChatRunner(runner: DiscordChatRunner) {
  discordChatRunner = runner;
}

export function setDiscordResetRunner(runner: () => Promise<void>) {
  discordResetRunner = runner;
}

function agentSystemPrompt(agentName: string) {
  const found = findAgentFolderSync(agentName);
  const agent = found?.agent;
  if (!agent) return `You are ${agentName}. Respond helpfully and conversationally.`;
  const displayName = String(agent.assistantName || agent.name || found.folderName || agentName);
  const blocks = Array.isArray(agent.blocks) ? agent.blocks : [];
  const blockText = blocks
    .filter((block) => block && typeof block === "object" && (block as { enabled?: unknown }).enabled !== false)
    .map((block) => {
      const item = block as { name?: unknown; content?: unknown };
      return [`Section: ${String(item.name || "Profile")}`, String(item.content || "").trim()].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 12000);
  return [`You are ${displayName}. Respond as this character, naturally and conversationally.`, blockText].filter(Boolean).join("\n\n");
}

function matchLeadingAgent(text: string): { agentName: string; cleanText: string } | null {
  const words = text.split(/\s+/);
  for (let count = Math.min(words.length - 1, 4); count >= 1; count -= 1) {
    const name = words.slice(0, count).join(" ").replace(/[.,!?;:]+$/, "");
    if (findAgentFolderSync(name)) return { agentName: name, cleanText: words.slice(count).join(" ") };
  }
  return null;
}

function resolveAgent(text: string): { agentName: string | null; cleanText: string } {
  const match = text.match(/^@(\S+)/);
  if (match) {
    const name = match[1].replace(/[.,!?;:]+$/, "");
    if (findAgentFolderSync(name)) return { agentName: name, cleanText: text.slice(match[0].length).trim() };
    return { agentName: null, cleanText: text };
  }
  const direct = matchLeadingAgent(text);
  if (direct) return direct;
  const greeting = text.match(/^(?:hey|hello|hi|yo|ok(?:ay)?)[,\s]+(.+)$/i);
  if (greeting) {
    const greeted = matchLeadingAgent(greeting[1]);
    if (greeted) return greeted;
  }
  return { agentName: null, cleanText: text };
}

function agentDisplayName(agentName: string) {
  const found = findAgentFolderSync(agentName);
  const agent = found?.agent;
  return String(agent?.assistantName || agent?.name || found?.folderName || agentName).trim() || agentName;
}

async function agentGifPath(folder: string) {
  const files = await fs.readdir(folder).catch(() => [] as string[]);
  const gif = files.find((file) => file.toLowerCase().endsWith(".gif"));
  return gif ? path.join(folder, gif) : null;
}

function avatarDataUri(buffer: Buffer, gif: boolean) {
  let mime = "image/png";
  if (gif) mime = "image/gif";
  else if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) mime = "image/jpeg";
  else if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") mime = "image/webp";
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

async function agentAvatarDataUri(agentName: string) {
  const found = findAgentFolderSync(agentName);
  const imageUrl = String(found?.agent?.imageUrl || "").trim();
  if (!found) return null;
  if (imageUrl.startsWith("data:image/")) return imageUrl;
  const gifPath = await agentGifPath(found.folder);
  if (gifPath) {
    const buffer = await fs.readFile(gifPath).catch(() => null);
    return buffer ? avatarDataUri(buffer, true) : null;
  }
  if (/^https?:\/\//i.test(imageUrl)) {
    const response = await fetch(imageUrl).catch(() => null);
    if (!response?.ok) return null;
    return avatarDataUri(Buffer.from(await response.arrayBuffer()), false);
  }
  const appRoot = path.resolve(moduleRoot, "..", "..");
  const decoded = decodeURIComponent(imageUrl.split(/[?#]/)[0] || "");
  if (decoded.startsWith("/assets/agents/")) {
    const buffer = await fs.readFile(path.join(appRoot, "data", "agents", decoded.slice("/assets/agents/".length))).catch(() => null);
    return buffer ? avatarDataUri(buffer, false) : null;
  }
  if (decoded.startsWith("/assets/image-generation/")) {
    const buffer = await fs.readFile(path.join(appRoot, "server", "modules", "image-generation", "generated", decoded.slice("/assets/image-generation/".length))).catch(() => null);
    return buffer ? avatarDataUri(buffer, false) : null;
  }
  const files = await fs.readdir(found.folder).catch(() => [] as string[]);
  const still = files.find((f) => /^(avatar|profile|portrait|icon|.+)\.(png|jpe?g|webp)$/i.test(f));
  if (still) {
    const buffer = await fs.readFile(path.join(found.folder, still)).catch(() => null);
    return buffer ? avatarDataUri(buffer, false) : null;
  }
  return null;
}

async function agentAvatarSignature(agentName: string) {
  const found = findAgentFolderSync(agentName);
  if (!found) return agentName.toLowerCase();
  const imageUrl = String(found?.agent?.imageUrl || "").trim();
  const gifPath = await agentGifPath(found.folder);
  if (gifPath) {
    const stats = await fs.stat(gifPath).catch(() => null);
    if (stats) return `${agentName.toLowerCase()}\n${gifPath}\n${stats.size}\n${stats.mtimeMs}`;
  }
  const appRoot = path.resolve(moduleRoot, "..", "..");
  const decoded = decodeURIComponent(imageUrl.split(/[?#]/)[0] || "");
  const imagePath = decoded.startsWith("/assets/agents/") ? path.join(appRoot, "data", "agents", decoded.slice("/assets/agents/".length)) : "";
  if (imagePath) {
    const stats = await fs.stat(imagePath).catch(() => null);
    if (stats) return `${agentName.toLowerCase()}\n${imagePath}\n${stats.size}\n${stats.mtimeMs}`;
  }
  const files = await fs.readdir(found.folder).catch(() => [] as string[]);
  const still = files.find((f) => /^(avatar|profile|portrait|icon|.+)\.(png|jpe?g|webp)$/i.test(f));
  if (still) {
    const filePath = path.join(found.folder, still);
    const stats = await fs.stat(filePath).catch(() => null);
    if (stats) return `${agentName.toLowerCase()}\n${filePath}\n${stats.size}\n${stats.mtimeMs}`;
  }
  return `${agentName.toLowerCase()}\n${imageUrl}`;
}

async function discordGuild(target: any, client: any) {
  if (target?.guild) return target.guild;
  const cfg = await readDiscordConfig();
  return cfg.guildId ? client.guilds.fetch(cfg.guildId).catch(() => null) : null;
}

async function applyAgentIdentity(target: any, agentName: string | null) {
  if (!agentName) return { agent: null, updated: false };
  const client = target?.client || target;
  if (!client?.user) return { agent: agentName, updated: false };
  const displayName = agentDisplayName(agentName);
  let nicknameUpdated = false;
  let usernameUpdated = false;
  let avatarUpdated = false;
  currentIdentityAgent = agentName;
  if (client.user.username !== displayName) {
    usernameUpdated = await client.user.setUsername(displayName).then(() => true).catch(() => false);
  }
  const guild = await discordGuild(target, client);
  if (guild?.members?.me && guild.members.me.displayName !== displayName) {
    nicknameUpdated = await guild.members.me.setNickname(displayName).then(() => true).catch(() => false);
  }
  const signature = await agentAvatarSignature(agentName);
  if (currentAvatarSignature === signature) return { agent: agentName, displayName, usernameUpdated, nicknameUpdated, avatarUpdated, updated: usernameUpdated || nicknameUpdated };
  const avatar = await agentAvatarDataUri(agentName).catch(() => null);
  if (!avatar) return { agent: agentName, displayName, usernameUpdated, nicknameUpdated, avatarUpdated, updated: usernameUpdated || nicknameUpdated };
  avatarUpdated = await client.user.setAvatar(avatar).then(() => { currentAvatarSignature = signature; return true; }).catch(() => false);
  return { agent: agentName, displayName, usernameUpdated, nicknameUpdated, avatarUpdated, updated: usernameUpdated || nicknameUpdated || avatarUpdated };
}

export async function readDiscordConfig(): Promise<DiscordConfig> {
  try {
    const data = await readJsonStore<Partial<DiscordConfig>>(configPath, {});
    return {
      ...discordConfig,
      ...data,
      mentionTargets: Array.isArray(data.mentionTargets) ? data.mentionTargets : [],
      activeAgentsByChannel: data.activeAgentsByChannel && typeof data.activeAgentsByChannel === "object" && !Array.isArray(data.activeAgentsByChannel) ? data.activeAgentsByChannel : {}
    };
  } catch { return discordConfig; }
}

export async function writeDiscordConfig(config: Partial<DiscordConfig>) {
  discordConfig = { ...discordConfig, ...config };
  await writeJsonStore(configPath, discordConfig);
}

async function registerCommands(client: any) {
  try {
    const { REST, Routes } = await import("discord.js");
    const cfg = await readDiscordConfig();
    if (!cfg.guildId) return;
    const agents = listAgentFolders().map((a) => ({ name: a.folderName, value: a.folderName }));
    const agentChoices = agents.length > 0 ? agents.slice(0, 25) : undefined;
    const rest = new REST({ version: "10" }).setToken(cfg.token);
    await rest.put(Routes.applicationGuildCommands(client.user.id, cfg.guildId), {
      body: [
        {
          name: "chat",
          description: "Talk to the AI agent",
          options: [
            { type: 3, name: "message", description: "Your message", required: true },
            ...(agentChoices ? [{ type: 3, name: "agent", description: "Agent to talk to", required: false, choices: agentChoices }] : [])
          ]
        },
        {
          name: "reset",
          description: "Reset all Discord agent conversation histories"
        }
      ]
    });
    console.log("Discord slash commands registered.");
  } catch (error) {
    console.error("Discord command registration failed:", error);
  }
}

const appStatePath = path.resolve(moduleRoot, "..", "..", "data", "app-state.json");

async function activeProviderConfig() {
  try {
    const raw = await fs.readFile(appStatePath, "utf8");
    const state = JSON.parse(raw);
    const profiles = Array.isArray(state.providerProfiles) ? state.providerProfiles as Array<Record<string, unknown>> : [];
    const activeId = String(state.activeProviderId || "");
    const active = profiles.find((p) => String(p.id) === activeId) || profiles[0] || null;
    return active ? { endpoint: String(active.baseUrl || ""), model: String(active.model || ""), apiKey: String(active.apiKey || ""), temperature: Number(active.temperature) || 0.7 } : null;
  } catch { return null; }
}

async function activeAgentName() {
  try {
    const raw = await fs.readFile(appStatePath, "utf8");
    const state = JSON.parse(raw);
    const profiles = Array.isArray(state.promptProfiles) ? state.promptProfiles as Array<Record<string, unknown>> : [];
    const activeId = String(state.activePromptProfileId || "");
    const activeIds = Array.isArray(state.activeAgentIds) ? state.activeAgentIds.map((id: unknown) => String(id)) : [];
    const active = profiles.find((profile) => activeIds.includes(String(profile.id || "")))
      || profiles.find((profile) => String(profile.id || "") === activeId)
      || null;
    if (!active) return null;
    const key = String(active.id || active.name || active.assistantName || "");
    const found = findAgentFolderSync(key) || findAgentFolderSync(String(active.name || active.assistantName || ""));
    return found?.folderName || String(active.assistantName || active.name || active.id || "").trim() || null;
  } catch { return null; }
}

async function chatCompletion(conversationId: string, userMessage: string, agentName?: string | null, userId?: string | null): Promise<DiscordChatResult> {
  if (discordChatRunner) {
    try { return await discordChatRunner({ conversationId, message: userMessage, agentName, userId }); }
    catch (error) { return { content: `*Chat error: ${error instanceof Error ? error.message : "Unknown error"}*`, agent: agentName || null }; }
  }
  const cfg = await readDiscordConfig();
  const appProvider = await activeProviderConfig();
  const endpoint = cfg.providerEndpoint || appProvider?.endpoint || "http://127.0.0.1:8080";
  const model = cfg.providerModel || appProvider?.model || "";
  const apiKey = cfg.providerApiKey || appProvider?.apiKey || "";
  const resolvedName = agentName || resolveAgent(userMessage).agentName || await activeAgentName();
  const cleanText = agentName ? userMessage : resolveAgent(userMessage).cleanText;
  const systemPrompt = resolvedName ? agentSystemPrompt(resolvedName) : "You are a helpful AI assistant. Respond conversationally.";
  const temperature = cfg.providerTemperature || appProvider?.temperature || 0.7;
  try {
    const provider = { baseUrl: endpoint, model: model || "default", apiKey, temperature } as ProviderConfig;
    const content = await completeProvider(provider, [
      { role: "system", content: systemPrompt },
      { role: "user", content: cleanText || userMessage }
    ], { temperature, maxTokens: 512 }) || "*No response*";
    return { content, agent: resolvedName };
  } catch (error) {
    return { content: `*Provider request failed: ${error instanceof Error ? error.message : "Unknown error"}*`, agent: resolvedName };
  }
}

export async function ensureBot() {
  if (botClient) return botClient;
  if (botStarting) return botStarting;
  botStarting = startBot().finally(() => { botStarting = null; });
  return botStarting;
}

async function startBot() {
  if (typeof joinVoiceChannel !== "function" || typeof entersState !== "function" || typeof createAudioPlayer !== "function") {
    throw new Error("Discord voice runtime did not initialize.");
  }
  const { Client, GatewayIntentBits, Events, MessageFlags, Partials } = await import("discord.js");
  const cfg = await readDiscordConfig();
  if (!cfg.token) return null;
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent], partials: [Partials.Channel] });

  client.on("error", (error: unknown) => console.error("Discord client error:", error));
  client.on("invalidated", () => console.error("Discord client session invalidated"));
  client.once(Events.ClientReady, () => {
    console.log(`Discord bot logged in as ${client.user?.tag}`);
    registerCommands(client).catch(() => undefined);
  });

  client.on(Events.InteractionCreate, async (interaction: any) => {
    try {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName === "reset") {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await discordResetRunner?.();
        await interaction.editReply({ content: "Discord agent conversation histories reset." }).catch(() => undefined);
        return;
      }
      if (interaction.commandName !== "chat") return;
      const message = interaction.options.getString("message", true);
      const agent = interaction.options.getString("agent") || null;
      await interaction.deferReply({ flags: undefined });
      await applyAgentIdentity(interaction, agent);
      const { content, agent: resolvedAgent, afterReply } = await chatCompletion(`discord:interaction:${interaction.channelId || interaction.user.id}`, message, agent, interaction.user?.id);
      if (resolvedAgent && interaction.channelId) await persistDiscordChannelAgent(String(interaction.channelId), resolvedAgent);
      await applyAgentIdentity(interaction, resolvedAgent);
      const truncated = content.length > 1900 ? content.slice(0, 1900) + "…" : content;
      await interaction.editReply({ content: truncated }).catch(() => undefined);
      afterReply?.().catch((error) => console.error("Discord post-reply action failed:", error));
    } catch (error) {
      console.error("Discord interaction handler error:", error);
      try { await interaction.editReply({ content: "*An error occurred processing your command.*" }).catch(() => undefined); } catch {}
    }
  });

  client.on("messageCreate", async (message: any) => {
    try {
      if (message.author.bot) return;
      if (!client.user) return;
      const rawText = String(message.content || "").trim();
      if (!rawText) return;
      const cfg = await readDiscordConfig();
      const botMentioned = rawText.includes(`<@${client.user.id}>`) || rawText.includes(`<@!${client.user.id}>`);
      const text = botMentioned ? rawText.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim() : rawText;
      if (!text) return;
      const { agentName: resolvedAgent, cleanText } = resolveAgent(text);
      if (!cleanText) return;
      const voiceControl = discordVoiceControlForText(cleanText);
      if (voiceControl) {
        const displayAgent = String(message.guild?.members.me?.displayName || "").trim();
        const explicitVoiceAgent = resolvedAgent || (findAgentFolderSync(displayAgent) ? displayAgent : null);
        const session = await queueVoiceControl(message, voiceControl, explicitVoiceAgent);
        if (voiceControl === "join" && session) {
          const guild = message.guild;
          const cfg = await readDiscordConfig();
          const result = await chatCompletion(`discord:voice:${guild.id}:${session.channelId}`, cleanText, session.agentName, message.author?.id);
          if (result.content.trim() && !result.content.startsWith("*Chat error:") && !result.content.startsWith("*Provider request failed:")) {
            const responseAgent = result.agent || session.agentName;
            await applyAgentIdentity(guild.client, responseAgent);
            const responseRuntime = await resolveSpeechRuntime(responseAgent, cfg.providerId || "");
            await speakDiscordResponse(session, result.content, responseRuntime);
            result.afterReply?.().catch((error) => console.error("Discord voice post-reply action failed:", error));
          }
        }
        return;
      }
      const isDM = !message.guild;
      const userTarget = mentionTargetForUser(cfg, message.author.id);
      const directAgent = resolvedAgent;
      const referenced = message.reference?.messageId ? await message.channel.messages.fetch(message.reference.messageId).catch(() => null) : null;
      const repliesToBot = referenced?.author?.id === client.user.id;
      const activeDiscordAgent = cfg.activeAgentsByChannel[String(message.channelId || "")] || null;
      const channelDefault = resolveMentionTarget(cfg, message.channelId)?.defaultAgent || null;
      const userDefault = userTarget?.defaultAgent || null;
      const defaultAgent = channelDefault || userDefault;
      if (!isDM && !botMentioned && !directAgent && !repliesToBot && !activeDiscordAgent && !defaultAgent) return;
      const displayAgent = (botMentioned || repliesToBot) ? String(message.guild?.members.me?.displayName || "").trim() : "";
      const targetAgent = resolvedAgent || activeDiscordAgent || (displayAgent && findAgentFolderSync(displayAgent) ? displayAgent : null) || (repliesToBot ? currentIdentityAgent : null) || defaultAgent;
      if (targetAgent && message.channelId) await persistDiscordChannelAgent(String(message.channelId), targetAgent);
      await applyAgentIdentity(message, targetAgent);
      await message.channel.sendTyping().catch(() => undefined);
      const { content, agent: replyAgent, afterReply } = await chatCompletion(`discord:${message.channelId}`, cleanText, targetAgent, message.author.id);
      await applyAgentIdentity(message, replyAgent);
      const truncated = content.length > 1900 ? content.slice(0, 1900) + "…" : content;
      await message.reply(truncated).catch(() => undefined);
      afterReply?.().catch((error) => console.error("Discord post-reply action failed:", error));
    } catch (error) {
      console.error("Discord message handler error:", error);
      try { await message.reply("*An error occurred processing your message.*").catch(() => undefined); } catch {}
    }
  });

  try {
    const loginPromise = client.login(cfg.token);
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Login timed out after 15s")), 15000));
    await Promise.race([loginPromise, timeout]);
    botClient = client;
    return client;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Discord bot login failed:", msg);
    try { client.destroy(); } catch {}
    botClient = null;
    return null;
  }
}

export function getBotUserId(): string | null {
  return botClient?.user?.id || null;
}

export async function stopBot() {
  const guildIds = new Set([...voiceSessions.keys(), ...pendingVoiceConnections.keys()]);
  for (const guildId of guildIds) clearVoiceConnection(guildId);
  voiceControlQueues.clear();
  if (botClient) {
    try { botClient.destroy(); } catch {}
    botClient = null;
  }
}

export async function sendDiscordMessage(content: string) {
  const client = await ensureBot();
  if (!client) return false;
  const cfg = await readDiscordConfig();
  if (!cfg.channelId) return false;
  try {
    const channel = await client.channels.fetch(cfg.channelId);
    if (channel?.isTextBased()) { await channel.send(content); return true; }
    return false;
  } catch (error) {
    console.error("Discord send failed:", error);
    return false;
  }
}

function normalizeKey(value: unknown) {
  return String(value || "").trim().replace(/^@/, "").toLowerCase();
}

function resolveMentionTarget(cfg: DiscordConfig, value: unknown) {
  const key = normalizeKey(value);
  if (!key) return null;
  return cfg.mentionTargets.find((target) => normalizeKey(target.name) === key || normalizeKey(target.userId) === key) || null;
}

function mentionTargetForUser(cfg: DiscordConfig, userId: unknown) {
  const key = normalizeKey(userId);
  if (!key) return null;
  return cfg.mentionTargets.find((target) => normalizeKey(target.userId) === key) || null;
}

export async function sendDiscordTargetMessage(input: { user?: string; content: string }) {
  const cfg = await readDiscordConfig();
  const target = resolveMentionTarget(cfg, input.user);
  const prefix = target ? `<@${target.userId}> ` : "";
  const ok = await sendDiscordMessage(`${prefix}${input.content}`.trim());
  return { sent: ok, user: target?.name || input.user || "", userId: target?.userId || "", content: input.content };
}

export async function executeDiscordSend(attrs: Record<string, string>) {
  const content = attrs.content || attrs.message || "";
  if (!content) throw new Error("discord.send requires content or message attribute.");
  return sendDiscordTargetMessage({ user: attrs.user || attrs.target, content });
}

const DISCORD_PROMPT_BLOCK: PromptBlock = {
  id: "discord-guidance",
  name: "Discord Integration",
  enabled: true,
  role: "system",
  position: "bottom",
  priority: 30,
  content: "Use the Discord tool for reminders, notifications, task updates, or when the user needs to be reached outside this chat."
};

export const discordModule: AppModule = {
  id: "discord",
  name: "Discord",
  description: "Discord bot integration. Enables discord.send action for proactive messaging and /chat slash command for chatting from Discord.",
  kind: "automation",
  defaultEnabled: false,
  defaultSettings: {
    token: "",
    channelId: "",
    guildId: "",
    autoFireReminders: true,
    providerEndpoint: "",
    providerModel: "",
    providerApiKey: "",
    providerTemperature: 0.7
  },
  tools: [moduleTool("discord.send", "Send a message through the configured Discord integration.", ["content"])],
  hooks: {
    getPromptBlocks(): PromptBlock[] {
      return [DISCORD_PROMPT_BLOCK];
    },
    async afterChatComplete(ctx: AfterChatContext): Promise<AfterChatEvent[] | undefined> {
      if (ctx.settings.autoFireReminders === false) return;
      const reminderResults = (ctx.actionResults || []).filter((r: any) => r.action?.type === "schedule.create" && r.status === "executed");
      if (reminderResults.length > 0) {
        const reminders = reminderResults.map((r: any) => r.result?.title || r.action?.attrs?.title || "Reminder").join(", ");
        await sendDiscordMessage(`Reminder set: ${reminders}`).catch(() => undefined);
      }
    }
  }
};
