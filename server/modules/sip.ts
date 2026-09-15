import { timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import type { ChatMessage } from "../../shared/types";
import type { AppModule } from "./types";
import { readJsonStore, writeJsonStore } from "./jsonStore";

const moduleRoot = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(moduleRoot, "..", "..", "data", "sip-config.json");
const sessionTtlMs = 15 * 60 * 1000;

export type SipConfig = {
  publicBaseUrl: string;
  callbackUsername: string;
  callbackPassword: string;
  agentId: string;
  providerId: string;
  greeting: string;
};

const defaults: SipConfig = { publicBaseUrl: "", callbackUsername: "", callbackPassword: "", agentId: "", providerId: "", greeting: "Hello. How can I help you?" };
type SipRuntime = { content: string; asrEndpoint: string; asrModel: string; voiceForgeEndpoint: string; voice: Record<string, unknown> };
type SipChatRunner = (input: { callId: string; agentId: string; providerId: string; messages: ChatMessage[] }) => Promise<SipRuntime>;
type SipRuntimeResolver = (input: { agentId: string; providerId: string }) => Promise<Omit<SipRuntime, "content">>;
type SipVoiceForgeStreamRunner = (runtime: SipRuntime) => Promise<Response>;
type CallSession = { messages: ChatMessage[]; updatedAt: number };
type CallbackState = { eventType: string; callId: string; receivedAt: string; state: string; error: string };

let runner: SipChatRunner | null = null;
let runtimeResolver: SipRuntimeResolver | null = null;
let voiceForgeStreamRunner: SipVoiceForgeStreamRunner | null = null;
const sessions = new Map<string, CallSession>();
let lastCallback: CallbackState | null = null;
let lastMediaMetrics: { rms: number; speech: boolean; utteranceMs: number } | null = null;

function text(value: unknown) { return String(value || "").trim(); }
function xml(value: unknown) { return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;"); }
function cleanup() { const now = Date.now(); for (const [id, session] of sessions) if (session.updatedAt + sessionTtlMs <= now) sessions.delete(id); }
function update(callId: string, eventType: string, state: string, error = "") { lastCallback = { eventType, callId, receivedAt: new Date().toISOString(), state, error }; }

function normalizedBaseUrl(config: SipConfig) {
  const value = text(config.publicBaseUrl).replace(/\/+$/, "");
  if (!/^https:\/\//i.test(value)) throw new Error("Public base URL must be an HTTPS URL.");
  return value;
}

function streamUrl(config: SipConfig) { return normalizedBaseUrl(config).replace(/^https:/i, "wss:") + "/api/modules/sip/stream"; }

function callbackAttributes(config: SipConfig) {
  const username = text(config.callbackUsername);
  const password = text(config.callbackPassword);
  if (!username || !password) throw new Error("Bandwidth callback username and password are required.");
  return ` username="${xml(username)}" password="${xml(password)}"`;
}

function streamDestinationAttributes(config: SipConfig) {
  const username = text(config.callbackUsername);
  const password = text(config.callbackPassword);
  if (!username || !password) throw new Error("Bandwidth callback username and password are required.");
  return ` destinationUsername="${xml(username)}" destinationPassword="${xml(password)}"`;
}

function streamBxml(config: SipConfig) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><StartStream name="eris_live" destination="${xml(streamUrl(config))}" mode="bidirectional"${streamDestinationAttributes(config)}/><StopStream name="eris_live" wait="true"/></Response>`;
}

function basicAuthorized(header: string | undefined, config: SipConfig) {
  const expected = `${config.callbackUsername}:${config.callbackPassword}`;
  const supplied = text(header).replace(/^Basic\s+/i, "");
  if (!supplied || !expected) return false;
  const expectedBytes = Buffer.from(Buffer.from(expected).toString("base64"));
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

export function speechAsrUrl(endpoint: string, model: string) {
  const url = new URL(text(endpoint));
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol !== "ws:" && url.protocol !== "wss:") throw new Error("ASR endpoint must use http, https, ws, or wss.");
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1/audio/transcriptions/live`;
  url.searchParams.set("model", model);
  url.searchParams.set("language", "en");
  url.searchParams.set("call_mode", "true");
  url.searchParams.set("silence_threshold", "0.8");
  return url.toString();
}

function decodeMuLaw(value: Buffer) {
  const pcm = Buffer.allocUnsafe(value.length * 2);
  for (let i = 0; i < value.length; i += 1) {
    const byte = ~value[i];
    const sample = ((byte & 15) << 3) + 132;
    const signed = (byte & 128) ? 132 - (sample << ((byte & 112) >> 4)) : (sample << ((byte & 112) >> 4)) - 132;
    pcm.writeInt16LE(Math.max(-32768, Math.min(32767, signed)), i * 2);
  }
  return pcm;
}

export function resampleSpeechPcm16(samples: Int16Array, inputRate: number, outputRate = 16000) {
  if (inputRate === outputRate) return samples;
  const output = new Int16Array(Math.max(1, Math.round(samples.length * outputRate / inputRate)));
  for (let i = 0; i < output.length; i += 1) {
    const position = i * inputRate / outputRate;
    const before = Math.floor(position);
    const after = Math.min(before + 1, samples.length - 1);
    const fraction = position - before;
    output[i] = Math.round((samples[before] || 0) * (1 - fraction) + (samples[after] || 0) * fraction);
  }
  return output;
}

export function speechPcmBuffer(samples: Int16Array) { return Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength); }

function bandwidthPcm(value: Buffer) { return speechPcmBuffer(resampleSpeechPcm16(new Int16Array(value.buffer, value.byteOffset, Math.floor(value.length / 2)), 8000)); }

export function speechAsrAudioPayload(value: Buffer) {
  const samples = new Float32Array(value.length / 2);
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = value.readInt16LE(index * 2) / 32768;
    samples[index] = sample;
    sum += sample * sample;
  }
  return { message: JSON.stringify({ type: "audio", data: Buffer.from(samples.buffer).toString("base64"), sampleRate: 16000 }), rms: Math.sqrt(sum / Math.max(1, samples.length)) };
}

function bandwidthWirePcm(value: Buffer) {
  const output = Buffer.allocUnsafe(value.length);
  for (let offset = 0; offset + 1 < value.length; offset += 2) output.writeInt16BE(value.readInt16LE(offset), offset);
  return output;
}

function wavPcm16(value: Buffer) {
  if (value.length < 44 || value.toString("ascii", 0, 4) !== "RIFF" || value.toString("ascii", 8, 12) !== "WAVE") return value;
  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let data: Buffer | null = null;
  while (offset + 8 <= value.length) {
    const id = value.toString("ascii", offset, offset + 4);
    const length = value.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt " && start + 16 <= value.length) { channels = value.readUInt16LE(start + 2); sampleRate = value.readUInt32LE(start + 4); bits = value.readUInt16LE(start + 14); }
    if (id === "data") { data = value.subarray(start, Math.min(start + length, value.length)); break; }
    offset = start + length + (length & 1);
  }
  if (!data || !channels || !sampleRate || bits !== 16) throw new Error("VoiceForge audio must be PCM16 WAV or raw PCM16.");
  const frames = Math.floor(data.length / (channels * 2));
  const mono = new Int16Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let total = 0;
    for (let channel = 0; channel < channels; channel += 1) total += data.readInt16LE((frame * channels + channel) * 2);
    mono[frame] = Math.round(total / channels);
  }
  return speechPcmBuffer(resampleSpeechPcm16(mono, sampleRate));
}

export async function* streamSpeechAudio(runtime: SipRuntime & { content: string }): AsyncGenerator<Buffer> {
  if (!voiceForgeStreamRunner) throw new Error("SIP VoiceForge runner is not initialized.");
  const response = await voiceForgeStreamRunner(runtime);
  if (!response.ok || !response.body) throw new Error((await response.text().catch(() => "")).trim() || `VoiceForge generation returned ${response.status}.`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    const lines = buffered.split("\n");
    buffered = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const event = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
      if (event.type === "error") throw new Error(text(event.message) || "VoiceForge generation failed.");
      if (event.type === "chunk" && event.audio) yield wavPcm16(Buffer.from(String(event.audio), "base64"));
    }
  }
}

export function speechTranscript(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const event = value as Record<string, unknown>;
  if (event.isFinal === false || event.is_final === false || event.final === false) return "";
  return text(event.text || event.transcript || (event.result as Record<string, unknown> | undefined)?.text);
}

export function setSipChatRunner(value: SipChatRunner) { runner = value; }
export function setSipRuntimeResolver(value: SipRuntimeResolver) { runtimeResolver = value; }
export function setSipVoiceForgeStreamRunner(value: SipVoiceForgeStreamRunner) { voiceForgeStreamRunner = value; }
export async function resolveSpeechRuntime(agentId = "", providerId = "") {
  if (!runtimeResolver) throw new Error("Speech runtime is not initialized.");
  return runtimeResolver({ agentId, providerId });
}
export async function readSipConfig(): Promise<SipConfig> { return { ...defaults, ...await readJsonStore<Partial<SipConfig>>(configPath, {}) }; }
export async function writeSipConfig(value: Partial<SipConfig>) { const next = { ...await readSipConfig(), ...value }; await writeJsonStore(configPath, next); return next; }
export function sipConfigForClient(config: SipConfig) { return { ...config, callbackPassword: config.callbackPassword ? "••••••••" : "" }; }
export function authorizeSipCallback(authorization: string | undefined, config: SipConfig) { return basicAuthorized(authorization, config); }

export async function inboundSipBxml(config: SipConfig, callId: string) {
  cleanup();
  sessions.set(callId, { messages: [], updatedAt: Date.now() });
  update(callId, "initiate", "waiting for media stream");
  return streamBxml(config);
}

export function acceptSipMediaSocket(socket: WebSocket, config: SipConfig) {
  let callId = "";
  let asr: WebSocket | null = null;
  let runtime: Omit<SipRuntime, "content"> | null = null;
  let mediaChain = Promise.resolve();
  let processing = false;
  const pendingAudio: string[] = [];
  const preRoll: Buffer[] = [];
  let utterance: Buffer[] = [];
  let utteranceSamples = 0;
  let speechSamples = 0;
  let utteranceEnergy = 0;
  let utterancePeak = 0;
  let speechActive = false;
  let lastSpeechAt = 0;
  const sendAsr = (message: string) => {
    if (!asr) return;
    if (asr.readyState === WebSocket.OPEN) asr.send(message);
    else if (asr.readyState === WebSocket.CONNECTING) pendingAudio.push(message);
  };
  const appendUtterance = (audio: Buffer, rms: number, speech: boolean) => {
    utterance.push(audio);
    const samples = audio.length / 2;
    utteranceSamples += samples;
    speechSamples += speech ? samples : 0;
    utteranceEnergy += rms * rms * samples;
    utterancePeak = Math.max(utterancePeak, rms);
  };
  const resetUtterance = () => { utterance = []; utteranceSamples = 0; speechSamples = 0; utteranceEnergy = 0; utterancePeak = 0; speechActive = false; lastSpeechAt = 0; };
  const flushUtterance = () => {
    if (!utteranceSamples) return;
    const durationMs = utteranceSamples / 16;
    const speechMs = speechSamples / 16;
    const voicedRatio = speechSamples / utteranceSamples;
    const averageRms = Math.sqrt(utteranceEnergy / utteranceSamples);
    const shouldSend = durationMs >= 450 && speechMs >= 160 && voicedRatio >= 0.18 && utterancePeak >= 0.0085 && averageRms >= 0.0085 * 0.35;
    const audio = Buffer.concat(utterance);
    resetUtterance();
    if (!shouldSend) return;
    sendAsr(speechAsrAudioPayload(audio).message);
    sendAsr(JSON.stringify({ type: "flush" }));
    if (callId) update(callId, "media", "flushed Call Mode utterance to ASR");
  };
  const sendAudio = (audio: Buffer) => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ eventType: "playAudio", media: { contentType: "audio/pcm;rate=16000;channels=1;bit-depth=16;endian=little;encoding=signed", payload: audio.toString("base64") } }));
  const speak = async (content: string) => {
    if (!runtime) return;
    for await (const audio of streamSpeechAudio({ ...runtime, content })) sendAudio(audio);
  };
  const reply = async (content: string) => {
    if (!callId || !runner || processing) return;
    processing = true;
    try {
      const session = sessions.get(callId) || { messages: [], updatedAt: Date.now() };
      const user: ChatMessage = { id: crypto.randomUUID(), role: "user", content, createdAt: Date.now() };
      const response = await runner({ callId, agentId: config.agentId, providerId: config.providerId, messages: [...session.messages, user] });
      const assistant: ChatMessage = { id: crypto.randomUUID(), role: "assistant", content: text(response.content), createdAt: Date.now() };
      if (!assistant.content) throw new Error("The chat provider returned no phone response.");
      sessions.set(callId, { messages: [...session.messages, user, assistant].slice(-40), updatedAt: Date.now() });
      update(callId, "transcript", "sending response");
      await speak(assistant.content);
      update(callId, "transcript", "streaming response");
    } catch (error) { update(callId, "transcript", "failed", error instanceof Error ? error.message : "Phone response failed."); }
    finally { processing = false; }
  };
  socket.on("message", (raw) => {
    mediaChain = mediaChain.then(async () => {
      const event = JSON.parse(raw.toString()) as Record<string, unknown>;
      const eventType = text(event.eventType || event.type).toLowerCase();
      if (eventType === "start") {
        callId = text(event.callId || (event.metadata as Record<string, unknown> | undefined)?.callId || (event.start as Record<string, unknown> | undefined)?.callId);
        if (!callId) throw new Error("Bandwidth stream start event is missing callId.");
        if (!runtimeResolver) throw new Error("SIP runtime is not initialized.");
        runtime = await runtimeResolver({ agentId: config.agentId, providerId: config.providerId });
        asr = new WebSocket(speechAsrUrl(runtime.asrEndpoint, runtime.asrModel));
        asr.on("open", () => { for (const audio of pendingAudio.splice(0)) asr?.send(audio); if (callId) update(callId, "start", "forwarding live audio"); });
        asr.on("message", (message) => { try { const value = speechTranscript(JSON.parse(message.toString())); if (value) void reply(value); } catch (error) { update(callId, "asr", "failed", error instanceof Error ? error.message : "Invalid ASR event."); } });
        asr.on("error", (error) => update(callId, "asr", "failed", error.message));
        update(callId, "start", "ASR live stream connecting");
        return;
      }
      if (eventType === "media") {
        const media = event.media as Record<string, unknown> | undefined;
        const payload = text(media?.payload || event.payload);
        if (!payload || !asr) return;
        const audio = speechAsrAudioPayload(bandwidthPcm(Buffer.from(payload, "base64")));
        const pcm = bandwidthPcm(Buffer.from(payload, "base64"));
        const now = Date.now();
        const isSpeech = audio.rms >= 0.0085;
        lastMediaMetrics = { rms: audio.rms, speech: isSpeech, utteranceMs: utteranceSamples / 16 };
        if (isSpeech) {
          if (!speechActive) {
            resetUtterance();
            for (const frame of preRoll) appendUtterance(frame, 0, false);
            preRoll.length = 0;
            speechActive = true;
          }
          appendUtterance(pcm, audio.rms, true);
          lastSpeechAt = now;
        } else if (speechActive) {
          if (now - lastSpeechAt > 800) { flushUtterance(); return; }
          appendUtterance(pcm, audio.rms, false);
        } else {
          preRoll.push(pcm);
          while (preRoll.length > 18) preRoll.shift();
          return;
        }
        if (utteranceSamples >= 240000) flushUtterance();
        if (callId) update(callId, "media", "forwarding live audio");
        return;
      }
      if (eventType === "stop") { if (callId) update(callId, "stop", "media stream stopped"); asr?.close(); }
    }).catch((error) => update(callId, "media", "failed", error instanceof Error ? error.message : "Media stream failed."));
  });
  socket.on("close", () => { asr?.close(); if (callId) update(callId, "stream", "media socket closed"); });
  socket.on("error", (error) => update(callId, "stream", "failed", error.message));
}

export function sipCallbackStatus() { return lastCallback ? { ...lastCallback, media: lastMediaMetrics } : null; }
export function recordSipCallbackFailure(error: unknown) { update(lastCallback?.callId || "", lastCallback?.eventType || "callback", "failed", error instanceof Error ? error.message : "Callback failed."); }

export const sipModule: AppModule = { id: "sip", name: "Inbound Phone", description: "Bandwidth inbound phone calls with live ASR, chat, and VoiceForge streaming.", kind: "media", defaultEnabled: false, defaultSettings: {}, hooks: {} };
