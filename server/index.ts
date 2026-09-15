import cors from "cors";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { execFile, execSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createWriteStream, existsSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { WebSocketServer } from "ws";
import type { ChatMessage, ChatRequest, PromptBlock } from "../shared/types";
import { getModule, getModuleManifest } from "./modules/registry";
import { deleteEvolutionEntry, evolveAgent, getEvolutionLog, revertEvolutionEntry } from "./modules/evolution";
import { createScheduledItem, readStoredScheduleItems, writeStoredScheduleItems, type ScheduledItem } from "./modules/reminders";
import { clearMemories, createMemory, deleteMemory, listMemories, updateMemory } from "./modules/memory";
import { createTask, deleteTask, listTasks, updateTask } from "./modules/tasks";
import { createNote, deleteNote, listNotes, updateNote } from "./modules/notes";
import { calculateExpression } from "./modules/calculator";
import { deleteSummary, listSummaries, upsertSummary } from "./modules/sessionSummary";
import { addDocument, deleteDocument, getDocument, listDocuments } from "./modules/fileLibrary";
import { clearNotifications, createNotification, deleteNotification, listNotifications, markAllNotificationsRead, markNotificationRead } from "./modules/notifications";
import { clearModuleEvents, listModuleEvents, recordModuleEvent } from "./modules/moduleEventLog";
import { executeInlineActions, stripInlineActions, type InlineActionResult } from "./modules/actionBus";
import { readDiscordConfig, writeDiscordConfig, stopBot, setDiscordChatRunner, setDiscordResetRunner } from "./modules/discord";
import { inferHypnoSessionSettings } from "./modules/hypno";
import { acceptSipMediaSocket, authorizeSipCallback, inboundSipBxml, readSipConfig, recordSipCallbackFailure, setSipChatRunner, setSipRuntimeResolver, setSipVoiceForgeStreamRunner, sipCallbackStatus, sipConfigForClient, writeSipConfig } from "./modules/sip";
import { buildPrompt } from "./promptBuilder";
import { resolveBackgroundAsset } from "./modules/backgroundAssets";
import { createAssistantFile, createProject, deleteAssistantFile, deleteProject, getUserProfile, listAssistantFiles, listCalendar, listContacts, listProjects, updateAssistantFile, updateProject } from "./modules/coreAssistant";
import { appDataRoot, backgroundPreviewRoot, backgroundRoot, deleteBackgroundAsset, embodyRoot, getAssetsFolderListing, getBackgroundAssets, getLocalAssetInventory, imageGenerationRoot, intifaceRoot, moduleAssetsRoot, renameBackgroundAsset, uploadAsset, uploadFbxPackage, videoGenerationRoot, vrmRoot } from "./modules/assets";
import { findAgentFolderSync, listAgentFolders, readAgentSection, writeAgentSection } from "./modules/agentSections";
import { completeProvider } from "./modules/providerCompletion";
import { readJsonArrayStore, readJsonStore, writeJsonStore } from "./modules/jsonStore";
import { callMcpTool, listMcpTools, listProviderTools } from "./modules/toolRegistry";

const app = express();
const sipApp = express();
const port = Number(process.env.PORT || 8780);
const sipPort = Number(process.env.SIP_PORT || 8781);
const host = process.env.HOST || "0.0.0.0";
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(appRoot, "dist");
const appStatePath = path.join(appDataRoot, "app-state.json");
const workspaceStatePath = path.join(appDataRoot, "workspace-state.json");
const themesRoot = path.join(appDataRoot, "themes");
const agentsDir = path.join(appDataRoot, "agents");
const staticAssetOptions = { maxAge: "5m", etag: true, lastModified: true };
const embodyStaticAssetOptions = {
  etag: true,
  lastModified: true,
  setHeaders: (res: express.Response, filePath: string) => {
    if (filePath.endsWith(".js")) res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  }
};
const immutablePreviewAssetOptions = { maxAge: "1y", immutable: true, etag: true, lastModified: true };
const appStateMaxBytes = 100 * 1024 * 1024;
const viteStaticAssetOptions = {
  etag: true,
  lastModified: true,
  setHeaders(res: Response, filePath: string) {
    if (path.basename(filePath) === "index.html") {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    }
  }
};

const projectFileIgnore = new Set([".git", "node_modules", "dist", "build", ".next", ".vite", ".sentry-native", ".sentry", "coverage", ".cache", "tmp", "temp"]);
const execFileAsync = promisify(execFile);
type LlamaCppState = {
  process: ChildProcessWithoutNullStreams | null;
  baseUrl: string;
  healthy: boolean;
  output: string[];
  starting: Promise<void> | null;
};
const llamaCppState: LlamaCppState = { process: null, baseUrl: "", healthy: false, output: [], starting: null };
const llamaCppDefaultInstallRoot = path.join(appDataRoot, "runtime", "llama.cpp");
const llamaCppDefaultModelsRoot = path.join(appDataRoot, "models", "llama.cpp");
type LlamaCppSettings = {
  binaryPath: string;
  modelPath: string;
  mmprojPath: string;
  mtpModelPath: string;
  speculativeMode: string;
  specDraftNMax: number;
  host: string;
  port: number;
  contextLength: number;
  fitMode: string;
  gpuLayers: string;
  threads: number;
  batchSize: number;
  ubatchSize: number;
  flashAttention: boolean;
  noWarmup: boolean;
  enableThinking: boolean;
  cacheReuse: number;
  kvCacheType: string;
  cpuMoe: boolean;
  nCpuMoe: number;
  moeNExpert: number;
  installDir: string;
  installedVersion: string;
  releaseAssetUrl: string;
  backend: string;
  modelsDir: string;
  modelDownloadUrl: string;
  modelDownloadName: string;
};
type LlamaCppModelDownloadState = {
  active: boolean;
  receivedBytes: number;
  totalBytes: number;
  fileName: string;
  modelPath: string;
  error: string;
  completed: boolean;
};
const llamaCppModelDownloadState: LlamaCppModelDownloadState = { active: false, receivedBytes: 0, totalBytes: 0, fileName: "", modelPath: "", error: "", completed: false };

function pushLlamaCppOutput(value: string) {
  const text = value.trim();
  if (!text) return;
  llamaCppState.output.push(text);
  llamaCppState.output = llamaCppState.output.slice(-80);
}

function llamaCppNumberSetting(value: unknown, defaultValue: number, minimum = 1) {
  const numberValue = Number(value ?? defaultValue);
  return Number.isFinite(numberValue) && numberValue >= minimum ? numberValue : defaultValue;
}

function normalizeLlamaCppSettings(value: unknown): LlamaCppSettings {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    binaryPath: String(source.binaryPath || "").trim(),
    modelPath: String(source.modelPath || "").trim(),
    mmprojPath: String(source.mmprojPath || "").trim(),
    mtpModelPath: String(source.mtpModelPath || "").trim(),
    speculativeMode: String(source.speculativeMode || "draft-simple").trim(),
    specDraftNMax: llamaCppNumberSetting(source.specDraftNMax, 0, 0),
    host: String(source.host || "127.0.0.1").trim(),
    port: Number(source.port || 1234),
    contextLength: Number(source.contextLength || 8192),
    fitMode: String(source.fitMode || "on").trim(),
    gpuLayers: String(source.gpuLayers || "auto").trim(),
    threads: llamaCppNumberSetting(source.threads, -1, -1),
    batchSize: llamaCppNumberSetting(source.batchSize, 2048, 32),
    ubatchSize: llamaCppNumberSetting(source.ubatchSize, 512, 1),
    flashAttention: source.flashAttention === true,
    noWarmup: source.noWarmup === true,
    enableThinking: source.enableThinking === true,
    cacheReuse: llamaCppNumberSetting(source.cacheReuse, 256, 0),
    kvCacheType: String(source.kvCacheType || "").trim(),
    cpuMoe: source.cpuMoe === true,
    nCpuMoe: llamaCppNumberSetting(source.nCpuMoe, 0, 0),
    moeNExpert: llamaCppNumberSetting(source.moeNExpert, 0, 0),
    installDir: String(source.installDir || "").trim(),
    installedVersion: String(source.installedVersion || "").trim(),
    releaseAssetUrl: String(source.releaseAssetUrl || "").trim(),
    backend: String(source.backend || "cpu").trim(),
    modelsDir: String(source.modelsDir || "").trim(),
    modelDownloadUrl: String(source.modelDownloadUrl || "").trim(),
    modelDownloadName: String(source.modelDownloadName || "").trim()
  };
}

function requestLlamaCppSettings(request: ChatRequest) {
  const config = request.modules.find((module) => module.id === "llama-cpp");
  if (!config?.enabled) throw new Error("Managed llama.cpp provider requires the llama.cpp module to be enabled.");
  return normalizeLlamaCppSettings(config.settings);
}

function llamaCppBaseUrl(settings: LlamaCppSettings) {
  const hostValue = settings.host;
  const portValue = settings.port;
  if (!hostValue) throw new Error("llama.cpp host is required.");
  if (!Number.isInteger(portValue) || portValue < 1 || portValue > 65535) throw new Error("llama.cpp port must be between 1 and 65535.");
  return `http://${hostValue}:${portValue}/v1`;
}

async function isLlamaCppHealthy(baseUrl: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/health`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function llamaCppArgs(settings: LlamaCppSettings, _provider?: ChatRequest["provider"]) {
  const binaryPath = settings.binaryPath;
  const modelPath = settings.modelPath;
  if (!binaryPath) throw new Error("llama.cpp server binary path is required.");
  if (!modelPath) throw new Error("llama.cpp model path is required.");
  if (!existsSync(binaryPath)) throw new Error(`llama.cpp server binary does not exist: ${binaryPath}`);
  if (!existsSync(modelPath)) throw new Error(`llama.cpp model file does not exist: ${modelPath}`);

  const args = ["-m", modelPath, "--host", settings.host, "--port", String(settings.port), "--no-ui", "--cache-prompt", "--parallel", "1"];
  if (settings.mmprojPath) args.push("--mmproj", settings.mmprojPath);
  if (settings.mtpModelPath) args.push("--model-draft", settings.mtpModelPath);
  if (settings.speculativeMode && settings.speculativeMode !== "none" && (settings.mtpModelPath || settings.speculativeMode.startsWith("ngram-"))) args.push("--spec-type", settings.speculativeMode);
  if (Number.isFinite(settings.specDraftNMax) && settings.specDraftNMax > 0) args.push("--spec-draft-n-max", String(Math.floor(settings.specDraftNMax)));
  if (Number.isFinite(settings.contextLength) && settings.contextLength > 0) args.push("-c", String(Math.floor(settings.contextLength)));
  if (settings.fitMode) args.push("-fit", settings.fitMode);
  if (settings.gpuLayers) args.push("-ngl", settings.gpuLayers);
  if (Number.isFinite(settings.threads)) args.push("-t", String(Math.floor(settings.threads)));
  if (Number.isFinite(settings.batchSize) && settings.batchSize > 0) args.push("-b", String(Math.floor(settings.batchSize)));
  if (Number.isFinite(settings.ubatchSize) && settings.ubatchSize > 0) args.push("-ub", String(Math.floor(settings.ubatchSize)));
   if (settings.flashAttention) args.push("--flash-attn", "on");
  if (settings.noWarmup) args.push("--no-warmup");
  if (settings.cpuMoe) args.push("--cpu-moe");
  if (Number.isFinite(settings.nCpuMoe) && settings.nCpuMoe > 0) args.push("--n-cpu-moe", String(Math.floor(settings.nCpuMoe)));
  if (Number.isFinite(settings.moeNExpert) && settings.moeNExpert > 0) args.push("--moe-n-expert", String(Math.floor(settings.moeNExpert)));
  args.push("--chat-template-kwargs", JSON.stringify({ enable_thinking: settings.enableThinking }));
  if (Number.isFinite(settings.cacheReuse) && settings.cacheReuse > 0) args.push("--cache-reuse", String(Math.floor(settings.cacheReuse)));
  if (settings.kvCacheType) args.push("-ctk", settings.kvCacheType, "-ctv", settings.kvCacheType);
  return { binaryPath, args };
}

async function stopLlamaCppServer() {
  const processValue = llamaCppState.process;
  llamaCppState.process = null;
  llamaCppState.baseUrl = "";
  llamaCppState.healthy = false;
  llamaCppState.starting = null;
  if (!processValue || processValue.killed) return;
  processValue.kill();
}

async function waitForLlamaCpp(baseUrl: string, processValue: ChildProcessWithoutNullStreams) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 60000) {
    if (processValue.exitCode !== null) throw new Error(`llama.cpp server exited during startup: ${llamaCppState.output.slice(-8).join("\n")}`);
    if (await isLlamaCppHealthy(baseUrl)) {
      if (llamaCppState.process === processValue) llamaCppState.healthy = true;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`llama.cpp server did not become ready within 60 seconds: ${llamaCppState.output.slice(-8).join("\n")}`);
}

async function ensureLlamaCppServer(provider: ChatRequest["provider"], settings: LlamaCppSettings) {
  if (!provider) throw new Error("Provider is required.");
  if (provider.useManagedLlamaCpp !== true) return provider;
  const baseUrl = llamaCppBaseUrl(settings);
  if (await isLlamaCppHealthy(baseUrl)) return { ...provider, baseUrl, apiKey: provider.apiKey.trim() || "llama.cpp" };
  if (llamaCppState.process && llamaCppState.baseUrl === baseUrl && llamaCppState.starting) await llamaCppState.starting;
  if (await isLlamaCppHealthy(baseUrl)) return { ...provider, baseUrl, apiKey: provider.apiKey.trim() || "llama.cpp" };

  const { binaryPath, args } = llamaCppArgs(settings, provider);
  await stopLlamaCppServer();
  llamaCppState.output = [];
  const processValue = spawn(binaryPath, args, { cwd: path.dirname(binaryPath), windowsHide: true });
  llamaCppState.process = processValue;
  llamaCppState.baseUrl = baseUrl;
  llamaCppState.healthy = false;
  processValue.stdout.on("data", (chunk) => pushLlamaCppOutput(String(chunk)));
  processValue.stderr.on("data", (chunk) => pushLlamaCppOutput(String(chunk)));
  processValue.on("exit", (code, signal) => {
    pushLlamaCppOutput(`llama.cpp exited with code ${code ?? "null"} signal ${signal ?? "null"}`);
    if (llamaCppState.process === processValue) {
      llamaCppState.process = null;
      llamaCppState.healthy = false;
      llamaCppState.starting = null;
    }
  });
  llamaCppState.starting = waitForLlamaCpp(baseUrl, processValue);
  await llamaCppState.starting;
  llamaCppState.healthy = true;
  llamaCppState.starting = null;
  return { ...provider, baseUrl, apiKey: provider.apiKey.trim() || "llama.cpp" };
}

async function prepareChatRequestProvider(request: ChatRequest): Promise<ChatRequest> {
  const settings = request.provider.useManagedLlamaCpp === true ? requestLlamaCppSettings(request) : normalizeLlamaCppSettings({});
  const provider = await ensureLlamaCppServer(request.provider, settings);
  return provider === request.provider ? request : { ...request, provider };
}

async function findLlamaServerBinary(root: string): Promise<string> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const found = await findLlamaServerBinary(absolute).catch(() => "");
      if (found) return found;
    } else if (entry.isFile() && /^llama-server(?:\.exe)?$/i.test(entry.name)) {
      return absolute;
    }
  }
  return "";
}

function llamaCppBackendNeedle(backend: string) {
  const normalized = String(backend || "cpu").toLowerCase();
  if (normalized === "cuda12") return "-cuda-12";
  if (normalized === "cuda13") return "-cuda-13";
  if (normalized === "vulkan") return "-vulkan-x64";
  if (normalized === "hip") return "-hip-radeon-x64";
  return "-cpu-x64";
}

async function latestLlamaCppRelease(backend = "cpu") {
  const response = await fetch("https://api.github.com/repos/ggml-org/llama.cpp/releases/latest", { headers: { "User-Agent": "ErisHub" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(providerErrorMessage(data));
  const assets = Array.isArray(data?.assets) ? data.assets : [];
  const windowsBinaryAssets = assets.filter((item: any) => {
    const name = String(item?.name || "").toLowerCase();
    return name.endsWith(".zip") && name.startsWith("llama-") && name.includes("-bin-win-") && name.includes("x64") && !name.includes("cudart") && !name.includes("source");
  });
  const needle = llamaCppBackendNeedle(backend);
  const asset = windowsBinaryAssets.find((item: any) => String(item?.name || "").toLowerCase().includes(needle)) ?? windowsBinaryAssets.find((item: any) => String(item?.name || "").toLowerCase().includes("-cpu-x64"));
  if (!asset?.browser_download_url) throw new Error("No Windows x64 llama.cpp prebuilt zip was found in the latest release.");
  return { tag: String(data.tag_name || ""), name: String(data.name || data.tag_name || ""), assetName: String(asset.name || ""), assetUrl: String(asset.browser_download_url) };
}

function validLlamaCppWindowsBinaryUrl(value: string, backend = "cpu") {
  try {
    const name = path.basename(new URL(value).pathname).toLowerCase();
    return name.endsWith(".zip") && name.startsWith("llama-") && name.includes("-bin-win-") && name.includes("x64") && name.includes(llamaCppBackendNeedle(backend)) && !name.includes("cudart") && !name.includes("source");
  } catch {
    return false;
  }
}

function llamaCppInstalledVersionLabel(release: { tag?: string; name?: string; assetName?: string }) {
  const tag = String(release.tag || "").trim();
  if (tag && tag.toLowerCase() !== "manual") return tag;
  return String(release.assetName || release.name || tag || "installed").trim();
}

async function installLlamaCpp(settings: LlamaCppSettings) {
  const release = settings.releaseAssetUrl && validLlamaCppWindowsBinaryUrl(settings.releaseAssetUrl, settings.backend) ? { tag: "manual", name: "Manual Asset", assetName: path.basename(new URL(settings.releaseAssetUrl).pathname), assetUrl: settings.releaseAssetUrl } : await latestLlamaCppRelease(settings.backend);
  const installDir = settings.installDir || path.join(llamaCppDefaultInstallRoot, release.tag.replace(/[^a-zA-Z0-9_.-]/g, "_"));
  const archivePath = path.join(installDir, release.assetName || "llama.cpp.zip");
  await rm(installDir, { recursive: true, force: true });
  await mkdir(installDir, { recursive: true });
  const response = await fetch(release.assetUrl);
  if (!response.ok) throw new Error(`llama.cpp download failed with HTTP ${response.status}.`);
  await writeFile(archivePath, Buffer.from(await response.arrayBuffer()));
  await execFileAsync("powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath ${JSON.stringify(archivePath)} -DestinationPath ${JSON.stringify(installDir)} -Force`], { maxBuffer: 8 * 1024 * 1024 });
  const binaryPath = await findLlamaServerBinary(installDir);
  if (!binaryPath) throw new Error("Installed llama.cpp archive did not contain llama-server.exe.");
  return { ...release, installDir, binaryPath, installedVersion: llamaCppInstalledVersionLabel(release) };
}

function llamaCppModelsDir(settings: LlamaCppSettings) {
  const raw = settings.modelsDir || llamaCppDefaultModelsRoot;
  const resolved = path.resolve(raw);
  if (!resolved || resolved === path.parse(resolved).root) throw new Error("llama.cpp models directory is required.");
  return resolved;
}

function safeModelFileName(value: string) {
  const name = path.basename(String(value || "").trim()).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  if (!name.toLowerCase().endsWith(".gguf")) throw new Error("Model file name must end with .gguf.");
  return name;
}

async function listLlamaCppModels(settings: LlamaCppSettings) {
  const modelsDir = llamaCppModelsDir(settings);
  await mkdir(modelsDir, { recursive: true });
  const entries = await readdir(modelsDir, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".gguf")) continue;
    candidates.push(entry);
  }
  const models = await Promise.all(candidates.map(async (entry) => {
    const absolute = path.join(modelsDir, entry.name);
    try {
      const info = await stat(absolute);
      if (info.size < 1024 * 1024) return null;
      return { name: entry.name, path: absolute, size: info.size, updatedAt: info.mtime.toISOString() };
    } catch {
      return null;
    }
  }));
  return { modelsDir, models: models.filter((m): m is NonNullable<typeof m> => m !== null).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
}

function huggingFaceRepoId(url: URL) {
  if (url.hostname !== "huggingface.co" && url.hostname !== "www.huggingface.co") return "";
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return "";
  return `${parts[0]}/${parts[1]}`;
}

async function resolveHuggingFaceGgufUrl(url: URL) {
  const repoId = huggingFaceRepoId(url);
  if (repoId && url.pathname.includes("/blob/") && url.pathname.toLowerCase().endsWith(".gguf")) {
    const parts = url.pathname.split("/").filter(Boolean);
    const blobIndex = parts.indexOf("blob");
    const revision = parts[blobIndex + 1] || "main";
    const filePath = parts.slice(blobIndex + 2).map(encodeURIComponent).join("/");
    return new URL(`https://huggingface.co/${repoId}/resolve/${encodeURIComponent(revision)}/${filePath}`);
  }
  if (url.pathname.toLowerCase().endsWith(".gguf")) return url;
  if (!repoId) return url;
  const response = await fetch(`https://huggingface.co/api/models/${repoId}/tree/main?recursive=true`, { headers: { "User-Agent": "ErisHub" } });
  const files = await response.json().catch(() => []);
  if (!response.ok || !Array.isArray(files)) throw new Error("Could not read Hugging Face model file list.");
  const ggufs = files
    .map((item: any) => String(item?.path || ""))
    .filter((item) => item.toLowerCase().endsWith(".gguf"));
  const selected = ggufs.find((item) => /q4_k_m/i.test(item)) ?? ggufs.find((item) => /q5_k_m/i.test(item)) ?? ggufs.find((item) => /q4/i.test(item)) ?? ggufs[0];
  if (!selected) throw new Error("Hugging Face repository does not contain a GGUF model file.");
  return new URL(`https://huggingface.co/${repoId}/resolve/main/${selected.split("/").map(encodeURIComponent).join("/")}`);
}

function assertDownloadedGgufHeader(buffer: Buffer) {
  const head = buffer.subarray(0, Math.min(buffer.length, 512)).toString("utf8").trimStart();
  if (head.startsWith("<!DOCTYPE") || head.startsWith("<html") || head.includes("version https://git-lfs.github.com/spec")) throw new Error("Downloaded data is not a GGUF model file. Use a Hugging Face /resolve/ GGUF URL, not a /blob/ page or Git-LFS pointer.");
  if (buffer.subarray(0, 4).toString("ascii") !== "GGUF") throw new Error("Downloaded file does not have a GGUF header.");
}

function resetLlamaCppModelDownload() {
  llamaCppModelDownloadState.active = false;
  llamaCppModelDownloadState.receivedBytes = 0;
  llamaCppModelDownloadState.totalBytes = 0;
  llamaCppModelDownloadState.fileName = "";
  llamaCppModelDownloadState.modelPath = "";
  llamaCppModelDownloadState.error = "";
  llamaCppModelDownloadState.completed = false;
}

async function streamLlamaCppModelDownload(settings: LlamaCppSettings) {
  const url = await resolveHuggingFaceGgufUrl(new URL(settings.modelDownloadUrl));
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Model download URL must use http or https.");
  const modelsDir = llamaCppModelsDir(settings);
  await mkdir(modelsDir, { recursive: true });
  const fileName = safeModelFileName(settings.modelDownloadName || path.basename(url.pathname));
  const target = path.join(modelsDir, fileName);
  const tempTarget = `${target}.download`;
  const response = await fetch(url, { headers: { "User-Agent": "ErisHub" } });
  if (!response.ok) throw new Error(`Model download failed with HTTP ${response.status}.`);
  if (!response.body) throw new Error("Model download response did not include a body.");
  llamaCppModelDownloadState.fileName = fileName;
  llamaCppModelDownloadState.modelPath = target;
  llamaCppModelDownloadState.totalBytes = Number(response.headers.get("content-length") || 0);
  await rm(tempTarget, { force: true });
  const writer = createWriteStream(tempTarget);
  let head = Buffer.alloc(0);
  try {
    for await (const chunk of Readable.fromWeb(response.body as any) as AsyncIterable<Buffer>) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      llamaCppModelDownloadState.receivedBytes += buffer.length;
      if (head.length < 512) head = Buffer.concat([head, buffer]).subarray(0, 512);
      if (!writer.write(buffer)) await once(writer, "drain");
    }
    writer.end();
    await once(writer, "finish");
    assertDownloadedGgufHeader(head);
    if (llamaCppModelDownloadState.receivedBytes < 1024 * 1024) throw new Error("Downloaded model is too small to be a valid GGUF file. Use a direct GGUF file URL or a Hugging Face repo containing GGUF files.");
    if (llamaCppModelDownloadState.totalBytes > 0 && llamaCppModelDownloadState.receivedBytes !== llamaCppModelDownloadState.totalBytes) throw new Error(`Downloaded model size mismatch: received ${llamaCppModelDownloadState.receivedBytes} bytes, expected ${llamaCppModelDownloadState.totalBytes}.`);
    await rename(tempTarget, target);
  } catch (error) {
    writer.destroy();
    await rm(tempTarget, { force: true });
    throw error;
  }
  const info = await stat(target);
  return { name: fileName, path: target, size: info.size, updatedAt: info.mtime.toISOString(), modelsDir };
}

async function downloadLlamaCppModel(settings: LlamaCppSettings) {
  if (llamaCppModelDownloadState.active) throw new Error("A llama.cpp model download is already running.");
  resetLlamaCppModelDownload();
  llamaCppModelDownloadState.active = true;
  void streamLlamaCppModelDownload(settings).then((model) => {
    llamaCppModelDownloadState.active = false;
    llamaCppModelDownloadState.completed = true;
    llamaCppModelDownloadState.modelPath = model.path;
    llamaCppModelDownloadState.fileName = model.name;
    llamaCppModelDownloadState.totalBytes = model.size;
    llamaCppModelDownloadState.receivedBytes = model.size;
  }).catch((error) => {
    llamaCppModelDownloadState.active = false;
    llamaCppModelDownloadState.error = error instanceof Error ? error.message : "llama.cpp model download failed.";
  });
  return { ...llamaCppModelDownloadState };
}

async function deleteLlamaCppModel(settings: LlamaCppSettings, modelPathInput: unknown) {
  const modelsDir = llamaCppModelsDir(settings);
  const target = path.resolve(String(modelPathInput || ""));
  if (!target.startsWith(`${modelsDir}${path.sep}`)) throw new Error("Model path must be inside the configured models directory.");
  if (!target.toLowerCase().endsWith(".gguf")) throw new Error("Only GGUF model files can be deleted.");
  await rm(target, { force: true });
}

async function runGit(rootInput: unknown, args: string[]) {
  const { root } = resolveProjectPath(rootInput);
  const result = await execFileAsync("git", ["-C", root, ...args], { maxBuffer: 12 * 1024 * 1024 });
  return result.stdout || "";
}

function parseGitStatus(output: string) {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const x = line[0] || " ";
      const y = line[1] || " ";
      const rawPath = line.slice(3).trim();
      const pathValue = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) || rawPath : rawPath;
      return { x, y, path: pathValue };
    })
    .filter((item) => item.path);
}

function resolveProjectPath(rootInput: unknown, fileInput = "") {
  const raw = String(rootInput || "").trim();
  let root = path.resolve(raw);
  if (!root || root === path.parse(root).root) throw new Error("Project directory is required.");
  if (!existsSync(root) && !raw.includes(path.sep) && !raw.includes("/")) {
    const cwd = process.cwd();
    if (path.basename(cwd) === raw && existsSync(cwd)) root = cwd;
  }
  const target = path.resolve(root, String(fileInput || ""));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error("Path escapes project directory.");
  return { root, target };
}

async function listProjectFiles(rootInput: unknown) {
  const { root } = resolveProjectPath(rootInput);
  const files: Array<{ path: string; name: string; size: number; updatedAt: string }> = [];
  async function walk(dir: string) {
    if (files.length >= 500) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= 500 || projectFileIgnore.has(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(root, absolute).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const info = await stat(absolute);
      if (info.size > 1024 * 1024) continue;
      files.push({ path: relative, name: entry.name, size: info.size, updatedAt: info.mtime.toISOString() });
    }
  }
  await walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function safeExternalHttpUrl(value: unknown) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

async function pipeWebBodyToResponse(body: ReadableStream<Uint8Array>, res: Response, controller?: AbortController) {
  res.setHeader("X-Accel-Buffering", "no");
  res.socket?.setNoDelay(true);
  res.flushHeaders?.();

  const reader = body.getReader();
  let closed = false;
  if (controller) {
    controller.signal.addEventListener("abort", () => {
      reader.cancel().catch(() => undefined);
      if (!res.destroyed && !res.writableEnded) res.end();
    }, { once: true });
  }
  res.on("close", () => {
    closed = true;
    reader.cancel().catch(() => undefined);
  });
  try {
    while (!closed && !res.destroyed) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      if (!res.write(Buffer.from(value))) {
        await new Promise<void>((resolve) => res.once("drain", resolve));
      }
    }
    if (!res.writableEnded) res.end();
  } catch (err) {
    if ((err as Error)?.message === "aborted" || (err as NodeJS.ErrnoException)?.code === "ERR_STREAM_PREMATURE_CLOSE") return;
    if (!res.destroyed) res.destroy(err as Error);
  }
}

async function pipeWebBodyToResponseWithTrace(body: ReadableStream<Uint8Array>, res: Response, trace: (label: string) => void, controller?: AbortController) {
  res.setHeader("X-Accel-Buffering", "no");
  res.socket?.setNoDelay(true);
  res.flushHeaders?.();

  const reader = body.getReader();
  let closed = false;
  let backpressureCount = 0;
  if (controller) {
    controller.signal.addEventListener("abort", () => {
      reader.cancel().catch(() => undefined);
      if (!res.destroyed && !res.writableEnded) res.end();
    }, { once: true });
  }
  res.on("close", () => {
    closed = true;
    reader.cancel().catch(() => undefined);
  });
  try {
    while (!closed && !res.destroyed) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      if (!res.write(Buffer.from(value))) {
        backpressureCount += 1;
        await new Promise<void>((resolve) => res.once("drain", resolve));
      }
    }
    if (!res.writableEnded) res.end();
  } catch (err) {
    if ((err as Error)?.message === "aborted" || (err as NodeJS.ErrnoException)?.code === "ERR_STREAM_PREMATURE_CLOSE") return;
    if (!res.destroyed) res.destroy(err as Error);
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function providerErrorMessage(value: unknown) {
  if (typeof value === "string") {
    try {
      return providerErrorMessage(JSON.parse(value));
    } catch {
      return value.trim().slice(0, 1200);
    }
  }
  if (value && typeof value === "object") {
    const entry = value as Record<string, unknown>;
    const error = entry.error;
    if (typeof error === "string") return error.slice(0, 1200);
    if (error && typeof error === "object") {
      const nested = error as Record<string, unknown>;
      if (typeof nested.message === "string") return nested.message.slice(0, 1200);
      if (typeof nested.error === "string") return nested.error.slice(0, 1200);
    }
    if (typeof entry.message === "string") return entry.message.slice(0, 1200);
  }
  return "Provider request failed.";
}

async function rewriteImagePromptForVideo(prompt: string, provider: ChatRequest["provider"] | undefined) {
  const baseUrl = String(provider?.baseUrl || "").trim();
  const apiKey = String(provider?.apiKey || "").trim();
  const model = String(provider?.model || "").trim();
  if (!baseUrl || !model) throw new Error("Video prompt rewrite requires a configured chat provider with a base URL and model.");

  const rewritten = cappedText(await completeProvider({ ...provider!, baseUrl, apiKey, model }, [
    { role: "system", content: "You are given an image prompt. Keep the ENTIRE original prompt word-for-word, then append natural motion, camera movement, subject action, timing, and atmosphere. Return only the full video prompt. Do not remove, shorten, or rewrite any part of the original description — only extend it with motion details, and weave in subtle, tasteful sensuality, allure, and aesthetic eroticism throughout the scene." },
    { role: "user", content: prompt }
  ], { temperature: 0.35, maxTokens: 600 }), 1200);
  if (!rewritten) throw new Error("Chat provider did not return a video prompt.");
  return rewritten;
}

function isHypnotubeVideoPage(url: URL) {
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  return host === "hypnotube.com" && /^\/video\/[^/]+-\d+\.html$/i.test(url.pathname);
}

function decodeHtmlAttribute(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\\\//g, "/")
    .trim();
}

function pageMetaContent(html: string, property: string) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return decodeHtmlAttribute(html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1] || "");
}

function parseHypnotubePlayer(html: string, pageUrl: string) {
  const source = decodeHtmlAttribute(
    html.match(/<source\s+[^>]*src=["']([^"']+)["'][^>]*type=["']video\//i)?.[1]
    || html.match(/"src"\s*:\s*"(https?:\\?\/\\?\/media\.hypnotube\.com[^"\\]*(?:\\.[^"\\]*)*)"/i)?.[1]
    || ""
  );
  const poster = decodeHtmlAttribute(
    html.match(/poster\s*:\s*['"]([^'"]+)['"]/i)?.[1]
    || pageMetaContent(html, "og:image")
    || ""
  );
  const title = pageMetaContent(html, "og:title") || decodeHtmlAttribute(html.match(/<title>([^<]+)<\/title>/i)?.[1] || "HypnoTube video").replace(/\s+-\s+Videos\s+-\s+Hypnotube\s*$/i, "");
  const safeSource = safeExternalHttpUrl(source);
  if (!safeSource || safeSource.hostname.replace(/^www\./, "").toLowerCase() !== "media.hypnotube.com") return null;
  return { title, src: safeSource.toString(), poster, pageUrl };
}

async function resolveHypnotubeMedia(pageUrl: URL, signal?: AbortSignal) {
  const response = await fetch(pageUrl.toString(), {
    headers: {
      "Accept": "text/html,application/xhtml+xml",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9"
    },
    redirect: "follow",
    signal
  });
  if (!response.ok) throw new Error("HypnoTube page could not be loaded.");
  const media = parseHypnotubePlayer(await response.text(), pageUrl.toString());
  if (!media) throw new Error("No playable HypnoTube media source found.");
  return media;
}

app.use(cors());
app.use(express.json({ limit: "120mb" }));
sipApp.use(express.json({ limit: "2mb" }));
app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error && typeof error === "object" && "type" in error && error.type === "request.aborted") {
    if (!res.headersSent) res.status(499).end();
    return;
  }
  next(error);
});
app.use("/assets/chat-backgrounds/previews", express.static(backgroundPreviewRoot, immutablePreviewAssetOptions));
app.use("/assets/chat-backgrounds", express.static(backgroundRoot, staticAssetOptions));
app.use("/assets", express.static(moduleAssetsRoot, staticAssetOptions));
app.use("/assets/image-generation", express.static(imageGenerationRoot, staticAssetOptions));
app.use("/assets/video-generation", express.static(videoGenerationRoot, staticAssetOptions));
app.use("/assets/modules/embody", express.static(embodyRoot, embodyStaticAssetOptions));
app.use("/assets/modules/vrm", express.static(vrmRoot, embodyStaticAssetOptions));
app.use("/assets/modules/intiface", express.static(intifaceRoot, embodyStaticAssetOptions));
app.use("/assets/agents", express.static(agentsDir, staticAssetOptions));
app.use("/assets", express.static(path.join(distRoot, "assets"), viteStaticAssetOptions));
app.use("/assets", (_req, res) => {
  res.status(404).type("text/plain").send("Asset not found.");
});

function mcpError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

async function mcpChatRequest(): Promise<ChatRequest> {
  const state = await readAppState() as Record<string, unknown>;
  const profiles = Array.isArray(state.promptProfiles) ? state.promptProfiles as ChatRequest["promptProfile"][] : [];
  const providers = Array.isArray(state.providerProfiles) ? state.providerProfiles as ChatRequest["provider"][] : [];
  const activeProfileId = String(state.activePromptProfileId || "");
  const activeProviderId = String(state.activeProviderId || "");
  const promptProfile = profiles.find((profile) => profile.id === activeProfileId) || profiles[0];
  const provider = providers.find((item) => item.id === activeProviderId) || providers[0];
  if (!promptProfile || !provider) throw new Error("Configure an active agent and provider before using MCP tools.");
  const modules = Array.isArray(state.modules) ? state.modules as ChatRequest["modules"] : [];
  return { messages: [], promptProfile, provider, modules };
}

// The HTTP transport is intentionally opt-in: MCP tools can perform side effects.
app.post("/api/mcp", async (req, res) => {
  const token = String(process.env.ERISHUB_MCP_TOKEN || "").trim();
  if (!token || req.get("authorization") !== `Bearer ${token}`) {
    res.status(token ? 401 : 503).json(mcpError(req.body?.id, -32001, token ? "Unauthorized MCP request." : "Set ERISHUB_MCP_TOKEN to enable the MCP endpoint."));
    return;
  }
  const request = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  const id = request.id;
  const method = String(request.method || "");
  const params = request.params && typeof request.params === "object" ? request.params as Record<string, unknown> : {};
  try {
    let result: unknown;
    if (method === "initialize") {
      result = { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "ErisHub", version: "0.1.0" } };
    } else if (method === "notifications/initialized") {
      res.status(202).end();
      return;
    } else if (method === "ping") {
      result = {};
    } else if (method === "tools/list") {
      result = { tools: listMcpTools(await mcpChatRequest()) };
    } else if (method === "tools/call") {
      const name = String(params.name || "");
      const toolResult = await callMcpTool(await mcpChatRequest(), name, params.arguments);
      const isError = toolResult.status !== "executed" && toolResult.status !== "continuation-required";
      result = { content: [{ type: "text", text: JSON.stringify(toolResult, null, 2) }], isError };
    } else {
      res.status(404).json(mcpError(id, -32601, `Method not found: ${method}`));
      return;
    }
    res.json({ jsonrpc: "2.0", id: id ?? null, result });
  } catch (error) {
    res.status(500).json(mcpError(id, -32000, error instanceof Error ? error.message : "MCP request failed."));
  }
});

app.get("/api/llama-cpp/status", async (_req, res) => {
  const running = Boolean(llamaCppState.process && llamaCppState.process.exitCode === null);
  if (running && llamaCppState.baseUrl) {
    llamaCppState.healthy = await isLlamaCppHealthy(llamaCppState.baseUrl);
    if (llamaCppState.healthy) llamaCppState.starting = null;
  }
  if (!running && !llamaCppState.starting) {
    const state = await readAppState().catch(() => ({})) as Record<string, unknown>;
    const providers = Array.isArray(state.providerProfiles) ? state.providerProfiles as Array<Record<string, unknown>> : [];
    const provider = providers.find((item) => String(item.id || "") === String(state.activeProviderId || "")) || providers[0];
    const modules = Array.isArray(state.modules) ? state.modules as Array<Record<string, unknown>> : [];
    const llamaModule = modules.find((item) => String(item.id || "") === "llama-cpp" && item.enabled !== false);
    if (provider?.useManagedLlamaCpp === true && llamaModule) {
      try {
        const baseUrl = llamaCppBaseUrl(normalizeLlamaCppSettings(llamaModule.settings));
        const healthy = await isLlamaCppHealthy(baseUrl);
        if (healthy) {
          llamaCppState.baseUrl = baseUrl;
          llamaCppState.healthy = true;
        }
      } catch {}
    }
  }
  const active = running || llamaCppState.starting !== null;
  res.json({
    running: running || (!active && llamaCppState.healthy),
    starting: llamaCppState.starting !== null,
    healthy: (active || llamaCppState.baseUrl) && llamaCppState.healthy,
    baseUrl: llamaCppState.baseUrl,
    output: llamaCppState.output.slice(-80),
    modelDownload: { ...llamaCppModelDownloadState }
  });
});

app.get("/api/llama-cpp/releases/latest", async (_req, res) => {
  try {
    res.json(await latestLlamaCppRelease(String(_req.query.backend || "cpu")));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "llama.cpp release check failed." });
  }
});

app.post("/api/llama-cpp/models", async (req, res) => {
  try {
    res.json(await listLlamaCppModels(normalizeLlamaCppSettings(req.body?.settings)));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "llama.cpp model listing failed." });
  }
});

app.post("/api/llama-cpp/models/download", async (req, res) => {
  try {
    res.json(await downloadLlamaCppModel(normalizeLlamaCppSettings(req.body?.settings)));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "llama.cpp model download failed." });
  }
});

app.get("/api/llama-cpp/models/download/status", async (_req, res) => {
  res.json({ ...llamaCppModelDownloadState });
});

app.delete("/api/llama-cpp/models", async (req, res) => {
  try {
    await deleteLlamaCppModel(normalizeLlamaCppSettings(req.body?.settings), req.body?.modelPath);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "llama.cpp model delete failed." });
  }
});

app.post("/api/llama-cpp/install", async (req, res) => {
  try {
    res.json(await installLlamaCpp(normalizeLlamaCppSettings(req.body?.settings)));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "llama.cpp install failed." });
  }
});

app.post("/api/llama-cpp/start", async (req, res) => {
  try {
    const settings = normalizeLlamaCppSettings(req.body?.settings);
    const { binaryPath, args } = llamaCppArgs(settings);
    await stopLlamaCppServer();
    llamaCppState.output = [];
    const baseUrl = llamaCppBaseUrl(settings);
    pushLlamaCppOutput(`Starting llama.cpp: ${binaryPath} ${args.join(" ")}`);
    const processValue = spawn(binaryPath, args, { cwd: path.dirname(binaryPath), windowsHide: true });
    llamaCppState.process = processValue;
    llamaCppState.baseUrl = baseUrl;
    llamaCppState.healthy = false;
    processValue.stdout.on("data", (chunk) => pushLlamaCppOutput(String(chunk)));
    processValue.stderr.on("data", (chunk) => pushLlamaCppOutput(String(chunk)));
    processValue.on("exit", (code, signal) => {
      pushLlamaCppOutput(`llama.cpp exited with code ${code ?? "null"} signal ${signal ?? "null"}`);
      if (llamaCppState.process === processValue) { llamaCppState.process = null; llamaCppState.healthy = false; llamaCppState.starting = null; }
    });
    processValue.on("error", (error) => {
      pushLlamaCppOutput(`llama.cpp process error: ${error.message}`);
      if (llamaCppState.process === processValue) { llamaCppState.process = null; llamaCppState.healthy = false; llamaCppState.starting = null; }
    });
    const starting = waitForLlamaCpp(baseUrl, processValue);
    llamaCppState.starting = starting;
    starting.finally(() => {
      if (llamaCppState.starting === starting) llamaCppState.starting = null;
    }).catch((error) => pushLlamaCppOutput(error instanceof Error ? error.message : "llama.cpp startup failed."));
    res.json({ success: true, running: true, healthy: false, starting: true, baseUrl, output: llamaCppState.output.slice(-80) });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "llama.cpp startup failed.", output: llamaCppState.output.slice(-80) });
  }
});

app.post("/api/llama-cpp/stop", async (_req, res) => {
  await stopLlamaCppServer();
  res.json({ success: true });
});

const imageSizes = new Set([
  "256x256", "512x512", "768x768", "1024x1024", "1536x1536",
  "512x768", "768x1024", "832x1216", "896x1152", "1024x1536",
  "768x512", "1024x768", "1152x896", "1216x832", "1536x1024"
]);
const videoSizes = new Set(["720x1280", "1024x1792", "1280x720", "1792x1024"]);
function cappedText(value: unknown, maxLength: number) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

async function fetchVoiceForgeJson(endpoint: URL, route: string) {
  const url = new URL(route, endpoint);
  const response = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`${route} returned ${response.status}.`);
  return response.json();
}

async function fetchVoiceForgeOk(endpoint: URL, route: string) {
  const url = new URL(route, endpoint);
  const response = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`${route} returned ${response.status}.`);
}

function normalizeVoiceForgePrompts(value: unknown) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const prompts = Array.isArray(source.prompts) ? source.prompts : Array.isArray(source.files) ? source.files : Array.isArray(value) ? value : [];
  return prompts.map((prompt) => {
    if (typeof prompt === "string") return { name: prompt, path: prompt };
    if (!prompt || typeof prompt !== "object" || Array.isArray(prompt)) return null;
    const item = prompt as Record<string, unknown>;
    const rawPath = String(item.path || item.file || item.url || "").trim();
    const rawName = String(item.name || item.filename || rawPath || "").trim();
    const name = rawName;
    return name ? { name, path: rawPath || undefined } : null;
  }).filter(Boolean);
}

function normalizeVoiceForgeModels(value: unknown) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const models = Array.isArray(source.models) ? source.models : Array.isArray(source.files) ? source.files : Array.isArray(value) ? value : [];
  return models.map((model) => {
    if (typeof model === "string") return model;
    if (!model || typeof model !== "object" || Array.isArray(model)) return "";
    const item = model as Record<string, unknown>;
    const raw = String(item.name || item.model || item.filename || item.path || "").trim();
    return raw;
  }).filter(Boolean);
}

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const _voiceforgePromptCache = new Map<string, { prompts: ReturnType<typeof normalizeVoiceForgePrompts>; ts: number }>();

async function resolveVoiceForgePrompt(endpoint: URL, promptName: string) {
  const trimmed = promptName.trim();
  if (!trimmed || trimmed === "[Default Voice]" || trimmed === "disabled") return "";
  if (trimmed.includes("/") || trimmed.includes("\\") || /\.(?:wav|mp3|flac|ogg)$/i.test(trimmed)) return trimmed;
  const key = endpoint.origin;
  let entry = _voiceforgePromptCache.get(key);
  if (!entry || Date.now() - entry.ts > 60_000) {
    entry = { prompts: normalizeVoiceForgePrompts(await fetchVoiceForgeJson(endpoint, "/api/audio-prompts")), ts: Date.now() };
    _voiceforgePromptCache.set(key, entry);
  }
  const match = entry.prompts.find((prompt) => prompt?.name === trimmed);
  return match?.path || trimmed;
}

async function buildVoiceForgeGenerateBody(endpoint: URL, payload: Record<string, unknown>) {
  const text = cappedText(payload.text, 12000);
  if (!text) throw new Error("VoiceForge text is required.");
  const voice = objectValue(payload.voice);
  const backend = String(voice.tts_backend || "").trim();
  if (!backend) throw new Error("VoiceForge voice mapping is missing tts_backend.");

  const body: Record<string, unknown> = {
    input: text,
    rvc_model: voice.rvc_model || null,
    enable_rvc: voice.enable_rvc !== false && !!voice.rvc_model,
    enable_post: voice.enable_post !== false,
    enable_background: voice.enable_background === true,
    response_format: "mp3",
    tts_mode: "streaming",
    output_volume: 1.0,
    tts_backend: backend,
    request_id: String(payload.requestId || crypto.randomUUID())
  };

  if (backend === "pocket_tts") {
    const voiceName = String(voice.pocket_tts_voice || "").trim();
    if (!voiceName || voiceName === "[Default Voice]" || voiceName === "disabled") throw new Error("pocket_tts requires a selected voice.");
    body.pocket_tts_voice = voiceName;
  }

  if (backend === "kokoro") {
    const voiceName = String(voice.kokoro_voice || "").trim();
    if (!voiceName || voiceName === "[Default Voice]" || voiceName === "disabled") throw new Error("kokoro requires a selected voice.");
    body.kokoro_voice = voiceName;
  }

  if (backend === "omnivoice") {
    const prompt = await resolveVoiceForgePrompt(endpoint, String(voice.audio_prompt || voice.omnivoice_voice || ""));
    if (!prompt) throw new Error("omnivoice requires a selected voice prompt.");
    body.omnivoice_voice = prompt;
    body.omnivoice_ref_asr_model = "large-v3-turbo";
    const refText = String(voice.omnivoice_ref_text || "").trim();
    if (refText) body.omnivoice_ref_text = refText;
  }

  const rvc = objectValue(voice.rvc);
  for (const key of ["pitch_algo", "pitch_level", "index_influence", "respiration_median_filtering", "envelope_ratio", "consonant_breath_protection"]) {
    if (rvc[key] !== undefined) body[key] = rvc[key];
  }

  const tracks = Array.isArray(voice.bg_tracks) ? voice.bg_tracks.map(objectValue).filter((track) => track.path) : [];
  if (voice.enable_background === true && tracks.length > 0) {
    body.bg_files = tracks.map((track) => track.path);
    body.bg_volumes = tracks.map((track) => Number(track.volume ?? 0.5));
    body.bg_delays = tracks.map((track) => Number(track.delay ?? 0));
    body.bg_fade_ins = tracks.map((track) => Number(track.fade_in ?? 2));
    body.bg_fade_outs = tracks.map((track) => Number(track.fade_out ?? 2));
    body.use_config_bg_tracks = false;
  } else if (voice.enable_background === true) {
    body.use_config_bg_tracks = true;
  }

  const post = objectValue(voice.post);
  if (voice.enable_post !== false) {
    for (const key of ["highpass", "lowpass", "bass_freq", "bass_gain", "treble_freq", "treble_gain", "reverb_delay", "reverb_decay", "crystalizer", "deesser", "audio_8d_enabled", "audio_8d_mode", "audio_8d_speed", "audio_8d_depth", "audio_8d_distance", "audio_8d_quality", "audio_8d_itd", "audio_8d_proximity", "audio_8d_crossfeed", "audio_8d_micro_movements", "audio_8d_speech_aware", "asmr_enabled", "asmr_tingles", "asmr_breathiness", "asmr_crispness", "asmr_warmth", "asmr_intimacy", "asmr_mouth_detail", "asmr_softness"]) {
      if (post[key] !== undefined) body[key] = post[key];
    }
  }

  return body;
}

async function requestVoiceForgeStream(endpointInput: unknown, payload: Record<string, unknown>) {
  const endpoint = safeExternalHttpUrl(endpointInput);
  if (!endpoint) throw new Error("VoiceForge endpoint must be http or https.");
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/`;
  endpoint.search = "";
  endpoint.hash = "";
  const body = await buildVoiceForgeGenerateBody(endpoint, payload);
  return fetch(new URL("/api/generate/stream", endpoint).toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function normalizeVoiceForgeBackgroundTracks(value: unknown) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const tracks = Array.isArray(source.files) ? source.files : Array.isArray(source.tracks) ? source.tracks : Array.isArray(value) ? value : [];
  return tracks.map((track) => {
    if (typeof track === "string") return { name: path.basename(track), path: track };
    if (!track || typeof track !== "object" || Array.isArray(track)) return null;
    const item = track as Record<string, unknown>;
    const trackPath = String(item.path || item.url || item.file || "").trim();
    const rawName = String(item.name || item.filename || trackPath || "").trim();
    return trackPath ? { name: rawName || path.basename(trackPath), path: trackPath } : null;
  }).filter(Boolean);
}

function audioAssetOptions(files: unknown) {
  return (Array.isArray(files) ? files : []).map((file) => {
    const value = String(file || "").replace(/\\/g, "/");
    const name = path.basename(value, path.extname(value));
    return value ? { label: `asset: ${name}`, value } : null;
  }).filter(Boolean);
}

function sanitizeAppState(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("App state must be an object.");
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, "utf8") > appStateMaxBytes) throw new Error("App state is too large.");
  return JSON.parse(json) as Record<string, unknown>;
}

function slugFileName(value: unknown) {
  return String(value || "theme").trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "theme";
}

function normalizeThemeRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const theme = value as Record<string, unknown>;
  const id = String(theme.id || "").trim();
  const name = String(theme.name || id).trim();
  return id && name ? { ...theme, id, name } : null;
}

async function listStoredThemes() {
  await mkdir(themesRoot, { recursive: true });
  const entries = await readdir(themesRoot, { withFileTypes: true }).catch(() => []);
  const themes: Record<string, unknown>[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const theme = normalizeThemeRecord(await readJsonStore<unknown>(path.join(themesRoot, entry.name), null));
    if (theme) themes.push(theme);
  }
  return themes.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

async function writeStoredTheme(themeInput: unknown) {
  const theme = normalizeThemeRecord(themeInput);
  if (!theme) throw new Error("Theme requires id and name.");
  await writeJsonStore(path.join(themesRoot, `${slugFileName(theme.id)}.json`), theme);
  return theme;
}

async function deleteStoredTheme(idInput: unknown) {
  const id = String(idInput || "").trim();
  if (!id) throw new Error("Theme id is required.");
  await rm(path.join(themesRoot, `${slugFileName(id)}.json`), { force: true });
}

function stateModules(state: Record<string, unknown>) {
  return Array.isArray(state.modules) ? state.modules.map((item) => objectValue(item)) : [];
}

function agentMapValue(map: Record<string, unknown>, agent: Record<string, unknown>, folderName: string) {
  const keys = [String(agent.id || ""), String(agent.name || ""), String(agent.assistantName || ""), folderName].filter(Boolean);
  for (const key of keys) if (map[key] !== undefined) return { key, value: map[key] };
  return null;
}

function normalizedMapKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function voiceKeyMatchesAgent(key: string, agent: Record<string, unknown>, folderName: string) {
  const normalizedKey = normalizedMapKey(key);
  const names = [String(agent.id || ""), String(agent.name || ""), String(agent.assistantName || ""), folderName]
    .map(normalizedMapKey)
    .filter((value) => value.length >= 3);
  return names.some((name) => normalizedKey === name || normalizedKey.startsWith(`${name} `) || normalizedKey.endsWith(` ${name}`));
}

function appStateWithAgentSections(state: Record<string, unknown>) {
  const modules = stateModules(state);
  const agents = listAgentFolders();
  const nextModules = modules.map((moduleConfig) => {
    const id = String(moduleConfig.id || "");
    const settings = objectValue(moduleConfig.settings);
    if (id === "voiceforge") {
      const voiceMap = { ...objectValue(settings.voiceforgeVoiceMap) };
      for (const { agent } of agents) {
        const agentId = String(agent.id || "");
        if (!agentId) continue;
        const stored = readAgentSection<Record<string, unknown>>(agentId, "voice", "voice-map.json", {});
        if (stored && typeof stored === "object" && !Array.isArray(stored)) {
          if ("voice" in stored) voiceMap[agentId] = stored.voice;
          else Object.assign(voiceMap, stored);
        }
      }
      return { ...moduleConfig, settings: { ...settings, voiceforgeVoiceMap: voiceMap } };
    }
    if (id === "vrm") {
      const vrmModelMap = { ...objectValue(settings.vrmModelMap) };
      const vrmModelSettings = { ...objectValue(settings.vrmModelSettings) };
      for (const { agent } of agents) {
        const agentId = String(agent.id || "");
        if (!agentId) continue;
        const stored = readAgentSection<{ model?: unknown; modelSettings?: unknown }>(agentId, "vrm", "vrm-map.json", {});
        const model = String(stored?.model || "");
        if (model) vrmModelMap[agentId] = { model };
        if (model && stored?.modelSettings && typeof stored.modelSettings === "object" && !Array.isArray(stored.modelSettings)) vrmModelSettings[model] = stored.modelSettings;
      }
      return { ...moduleConfig, settings: { ...settings, vrmModelMap, vrmModelSettings } };
    }
    return moduleConfig;
  });
  return { ...state, modules: nextModules };
}

function appStateWithoutAgentSections(state: Record<string, unknown>) {
  const agents = listAgentFolders();
  const nextModules = stateModules(state).map((moduleConfig) => {
    const id = String(moduleConfig.id || "");
    const settings = objectValue(moduleConfig.settings);
    if (id === "voiceforge") {
      const voiceMap = objectValue(settings.voiceforgeVoiceMap);
      const retainedVoiceMap = { ...voiceMap };
      for (const { agent, folderName } of agents) {
        const agentVoiceMap: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(voiceMap)) {
          if (!voiceKeyMatchesAgent(key, agent, folderName)) continue;
          agentVoiceMap[key] = value;
          delete retainedVoiceMap[key];
        }
        if (Object.keys(agentVoiceMap).length) writeAgentSection(String(agent.id || folderName), "voice", "voice-map.json", agentVoiceMap);
      }
      return { ...moduleConfig, settings: { ...settings, voiceforgeVoiceMap: retainedVoiceMap } };
    }
    if (id === "vrm") {
      const vrmModelMap = objectValue(settings.vrmModelMap);
      const vrmModelSettings = objectValue(settings.vrmModelSettings);
      const retainedVrmModelMap = { ...vrmModelMap };
      const retainedVrmModelSettings = { ...vrmModelSettings };
      for (const { agent, folderName } of agents) {
        const mapped = agentMapValue(vrmModelMap, agent, folderName);
        if (!mapped) continue;
        const modelEntry = objectValue(mapped.value);
        const model = String(modelEntry.model || "");
        if (!model) continue;
        const modelSettings = objectValue(vrmModelSettings[model]);
        writeAgentSection(String(agent.id || mapped.key), "vrm", "vrm-map.json", { model, modelSettings });
        for (const key of [String(agent.id || ""), String(agent.name || ""), String(agent.assistantName || ""), folderName].filter(Boolean)) delete retainedVrmModelMap[key];
        delete retainedVrmModelSettings[model];
      }
      return { ...moduleConfig, settings: { ...settings, vrmModelMap: retainedVrmModelMap, vrmModelSettings: retainedVrmModelSettings } };
    }
    return moduleConfig;
  });
  return { ...state, modules: nextModules };
}

async function readAppState() {
  const raw = await readFile(appStatePath, "utf8").catch((error) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return "{}";
    throw error;
  });
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? appStateWithAgentSections(parsed as Record<string, unknown>) : {};
}

async function writeAppState(state: Record<string, unknown>) {
  await mkdir(appDataRoot, { recursive: true });
  const persistedState = appStateWithoutAgentSections(state);
  const tmpPath = `${appStatePath}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify({ ...persistedState, savedAt: new Date().toISOString() })}\n`, "utf8");
  await rename(tmpPath, appStatePath);
}

function sanitizeWorkspaceState(value: unknown) {
  const text = JSON.stringify(value && typeof value === "object" && !Array.isArray(value) ? value : {});
  if (Buffer.byteLength(text, "utf8") > 20 * 1024 * 1024) throw new Error("Workspace state is too large.");
  return JSON.parse(text) as Record<string, unknown>;
}

async function readWorkspaceState() {
  const raw = await readFile(workspaceStatePath, "utf8").catch((error) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return "{}";
    throw error;
  });
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

async function writeWorkspaceState(state: Record<string, unknown>) {
  await mkdir(appDataRoot, { recursive: true });
  const tmpPath = `${workspaceStatePath}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify({ ...sanitizeWorkspaceState(state), savedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
  await rename(tmpPath, workspaceStatePath);
}

function imageEndpoint(baseUrl: string) {
  const parsed = new URL(baseUrl.replace(/\/$/, ""));
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Image provider must use http or https.");
  parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/images/generations`;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function videoEndpoint(baseUrl: string) {
  const parsed = new URL(baseUrl.replace(/\/$/, ""));
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Video provider must use http or https.");
  parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/videos/generations`;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function videoStatusEndpoint(baseUrl: string, requestId: string) {
  const parsed = new URL(baseUrl.replace(/\/$/, ""));
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Video provider must use http or https.");
  parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/videos/${encodeURIComponent(requestId)}`;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

async function pollGeneratedVideo(baseUrl: string, apiKey: string, requestId: string, signal: AbortSignal) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await wait(5000);
    const response = await fetch(videoStatusEndpoint(baseUrl, requestId), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal
    });
    if (!response.ok) throw new Error(providerErrorMessage(await response.text()));
    const data = await response.json();
    const status = String(data?.status || "").toLowerCase();
    if (status === "done" || status === "completed" || status === "succeeded") return data;
    if (status === "failed" || status === "expired" || status === "cancelled") throw new Error(providerErrorMessage(data));
  }
  throw new Error("Video request timed out before completion.");
}

function comfyuiEndpoint(baseUrl: string) {
  return baseUrl.replace(/\/$/, "");
}

async function comfyuiUploadImage(baseUrl: string, imageUrl: string): Promise<string> {
  const imageResponse = await fetch(imageUrl.startsWith("/") ? `http://127.0.0.1:${port}${imageUrl}` : imageUrl);
  if (!imageResponse.ok) throw new Error(`Failed to fetch source image for ComfyUI: ${imageResponse.status}`);
  const buffer = Buffer.from(await imageResponse.arrayBuffer());
  const ext = path.extname(new URL(imageUrl.startsWith("/") ? `http://127.0.0.1:${port}${imageUrl}` : imageUrl).pathname) || ".png";
  const filename = `erishub-source-${Date.now()}${ext}`;
  const form = new FormData();
  form.append("image", new Blob([buffer]), filename);
  const uploadResponse = await fetch(`${comfyuiEndpoint(baseUrl)}/upload/image`, { method: "POST", body: form });
  if (!uploadResponse.ok) throw new Error(`ComfyUI image upload failed: ${providerErrorMessage(await uploadResponse.text())}`);
  const uploadData = await uploadResponse.json();
  return String(uploadData?.name || filename);
}

async function comfyuiSubmitPrompt(baseUrl: string, workflowJson: string, prompt: string, negativePrompt: string, size: string, sourceImageFilename?: string) {
  let filled = workflowJson;
  if (size) {
    const parts = size.split("x");
    if (parts.length === 2) {
      filled = filled.replaceAll("{{WIDTH}}", parts[0].trim());
      filled = filled.replaceAll("{{HEIGHT}}", parts[1].trim());
    }
  }
  filled = filled.replaceAll("{{WIDTH}}", "1024").replaceAll("{{HEIGHT}}", "1024");
  filled = filled.replace(/\{\{(\w+)\}\}/gi, (_, name) => `{{${name.toUpperCase()}}}`);
  if (sourceImageFilename) filled = filled.replaceAll("{{SOURCE_IMAGE}}", sourceImageFilename);
  let workflow: Record<string, unknown>;
  try {
    workflow = JSON.parse(filled) as Record<string, unknown>;
  } catch (parseError) {
    throw new Error(`Invalid ComfyUI workflow JSON after placeholder substitution: ${parseError instanceof Error ? parseError.message : "syntax error"}.`);
  }
  const stringReplacements: Record<string, string> = { "{{PROMPT}}": prompt, "{{NEGATIVE_PROMPT}}": negativePrompt || "", "{{VIDEO_PROMPT}}": prompt, "{{NEGATIVE_VIDEO_PROMPT}}": negativePrompt || "" };
  function replaceStrings(obj: unknown): unknown {
    if (typeof obj === "string") {
      let result = obj;
      for (const [key, value] of Object.entries(stringReplacements)) result = result.replaceAll(key, value);
      return result;
    }
    if (Array.isArray(obj)) return obj.map((item) => replaceStrings(item));
    if (obj && typeof obj === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) result[key] = replaceStrings(value);
      return result;
    }
    return obj;
  }
  workflow = replaceStrings(workflow) as Record<string, unknown>;
  const serialized = JSON.stringify(workflow);
  const unresolvedPlaceholders = new Set((serialized.match(/\{\{[^}]+\}\}/g) || []).filter((p) => p !== "{{SOURCE_IMAGE}}"));
  if (unresolvedPlaceholders.size > 0) throw new Error(`Unresolved ComfyUI placeholder(s): ${[...unresolvedPlaceholders].join(", ")}. Supported: {{PROMPT}}, {{NEGATIVE_PROMPT}}, {{VIDEO_PROMPT}}, {{NEGATIVE_VIDEO_PROMPT}}, {{WIDTH}}, {{HEIGHT}}, {{SOURCE_IMAGE}}.`);
  const clientId = `erishub-${crypto.randomUUID()}`;
  const response = await fetch(`${comfyuiEndpoint(baseUrl)}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: clientId })
  });
  if (!response.ok) throw new Error(`ComfyUI prompt submission failed: ${providerErrorMessage(await response.text())}`);
  const data = await response.json();
  const promptId = String(data?.prompt_id || "");
  if (!promptId) throw new Error("ComfyUI did not return a prompt_id.");
  return promptId;
}

async function comfyuiPollResult(baseUrl: string, promptId: string, signal: AbortSignal) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    await wait(1000);
    if (signal.aborted) throw new Error("ComfyUI request cancelled.");
    const response = await fetch(`${comfyuiEndpoint(baseUrl)}/history/${encodeURIComponent(promptId)}`, { signal });
    if (!response.ok) {
      if (response.status === 404) continue;
      throw new Error(`ComfyUI history check failed: ${providerErrorMessage(await response.text())}`);
    }
    const data = await response.json() as Record<string, unknown>;
    const entry = data[promptId] as Record<string, unknown> | undefined;
    if (!entry) continue;
    const status = entry.status as Record<string, unknown> | undefined;
    if (status?.completed !== true) continue;
    if (status?.failed === true || status?.failed === "true") {
      const messages = entry.error_messages as Array<unknown> | undefined;
      throw new Error(`ComfyUI execution failed: ${messages ? JSON.stringify(messages) : "Unknown error"}`);
    }
    return (entry.outputs as Record<string, unknown>) || {};
  }
  throw new Error("ComfyUI request timed out before completion.");
}

async function comfyuiDownloadOutput(baseUrl: string, output: { filename: string; subfolder: string; type: string }) {
  const params = new URLSearchParams({ filename: output.filename, type: output.type });
  if (output.subfolder) params.set("subfolder", output.subfolder);
  const response = await fetch(`${comfyuiEndpoint(baseUrl)}/view?${params.toString()}`, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`ComfyUI output download failed: ${providerErrorMessage(await response.text())}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer;
}

type ComfyuiOutputFile = { filename: string; subfolder: string; type: string };

function collectComfyuiOutputFiles(outputs: Record<string, unknown>): ComfyuiOutputFile[] {
  return Object.values(outputs).flatMap((o) => {
    const node = o as Record<string, unknown>;
    const all: ComfyuiOutputFile[] = [];
    for (const val of Object.values(node)) {
      if (Array.isArray(val)) {
        for (const item of val) {
          if (item && typeof item === "object" && "filename" in item && "type" in item) {
            all.push(item as ComfyuiOutputFile);
          }
        }
      }
    }
    return all;
  });
}

async function saveGeneratedImage(b64Json: string, agentName?: string) {
  const buffer = Buffer.from(b64Json, "base64");
  if (buffer.length === 0 || buffer.length > 15 * 1024 * 1024) throw new Error("Generated image is too large.");
  const fileName = `${Date.now()}-${crypto.randomUUID()}.png`;
  if (agentName) {
    const agentDir = path.join(agentsDir, agentName);
    await mkdir(path.join(agentDir, "generated"), { recursive: true });
    await writeFile(path.join(agentDir, "generated", fileName), buffer);
    return `/assets/agents/${encodeURIComponent(agentName)}/generated/${encodeURIComponent(fileName)}`;
  }
  await mkdir(imageGenerationRoot, { recursive: true });
  await writeFile(path.join(imageGenerationRoot, fileName), buffer);
  return `/assets/image-generation/${encodeURIComponent(fileName)}`;
}

function generatedVideoExtension(contentType: string, sourceUrl: URL) {
  if (/webm/i.test(contentType) || /\.webm($|[?#])/i.test(sourceUrl.pathname)) return ".webm";
  if (/quicktime|mov/i.test(contentType) || /\.mov($|[?#])/i.test(sourceUrl.pathname)) return ".mov";
  if (/mp4|mpeg/i.test(contentType) || /\.m4v($|[?#])/i.test(sourceUrl.pathname)) return ".mp4";
  return ".mp4";
}

async function saveSilentGeneratedVideo(buffer: Buffer, extension: string, agentName?: string) {
  if (buffer.length === 0 || buffer.length > 80 * 1024 * 1024) throw new Error("Generated video is too large.");
  const id = `${Date.now()}-${crypto.randomUUID()}`;
  const inputName = `${id}-with-audio${extension}`;
  const outputName = `${id}${extension}`;
  if (agentName) {
    const agentDir = path.join(agentsDir, agentName);
    await mkdir(path.join(agentDir, "generated-videos"), { recursive: true });
    const outputPath = path.join(agentDir, "generated-videos", outputName);
    await writeFile(outputPath, buffer);
    const output = await readFile(outputPath);
    if (output.length === 0 || output.length > 80 * 1024 * 1024) throw new Error("Silent generated video is too large.");
    return `/assets/agents/${encodeURIComponent(agentName)}/generated-videos/${encodeURIComponent(outputName)}`;
  }
  await mkdir(videoGenerationRoot, { recursive: true });
  const inputPath = path.join(videoGenerationRoot, inputName);
  const outputPath = path.join(videoGenerationRoot, outputName);
  await writeFile(inputPath, buffer);
  try {
    await execFileAsync("ffmpeg", ["-y", "-i", inputPath, "-an", "-c:v", "copy", outputPath], { windowsHide: true });
    const output = await readFile(outputPath);
    if (output.length === 0 || output.length > 80 * 1024 * 1024) throw new Error("Silent generated video is too large.");
    return `/assets/video-generation/${encodeURIComponent(outputName)}`;
  } finally {
    await rm(inputPath, { force: true }).catch(() => undefined);
  }
}

function detectVideoExtension(buffer: Buffer): string {
  if (buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return ".webm";
  if (buffer.length >= 8 && buffer.slice(4, 8).toString() === "ftyp") return ".mp4";
  return ".mp4";
}

async function saveGeneratedVideo(b64Json: string, agentName?: string) {
  const buffer = Buffer.from(b64Json, "base64");
  return saveSilentGeneratedVideo(buffer, detectVideoExtension(buffer), agentName);
}

async function saveRemoteGeneratedVideo(sourceUrl: URL, agentName?: string) {
  const response = await fetch(sourceUrl.toString(), { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Video download failed: ${response.status} ${response.statusText}`.trim());
  const contentType = String(response.headers.get("content-type") || "");
  const buffer = Buffer.from(await response.arrayBuffer());
  return saveSilentGeneratedVideo(buffer, generatedVideoExtension(contentType, sourceUrl), agentName);
}

function localVideoAssetPath(assetUrl: string, agentName?: string) {
  const prefix = "/assets/video-generation/";
  if (assetUrl.startsWith(prefix)) {
    const fileName = decodeURIComponent(assetUrl.slice(prefix.length));
    const resolved = path.resolve(videoGenerationRoot, fileName);
    return resolved.startsWith(path.resolve(videoGenerationRoot)) ? resolved : "";
  }
  if (agentName) {
    const agentsPrefix = `/assets/agents/${encodeURIComponent(agentName)}/generated-videos/`;
    if (assetUrl.startsWith(agentsPrefix)) {
      const fileName = decodeURIComponent(assetUrl.slice(agentsPrefix.length));
      const resolved = path.resolve(agentsDir, agentName, "generated-videos", fileName);
      return resolved.startsWith(path.resolve(agentsDir, agentName, "generated-videos")) ? resolved : "";
    }
  }
  return "";
}

async function createGeneratedVideoPreview(assetUrl: string, agentName?: string) {
  const inputPath = localVideoAssetPath(assetUrl, agentName);
  if (!inputPath) return "";
  if (agentName) {
    const agentDir = path.join(agentsDir, agentName);
    const outputPath = path.join(agentDir, `${agentName}.gif`);
    await execFileAsync("ffmpeg", [
      "-y",
      "-i", inputPath,
      "-t", "5",
      "-vf", "scale='min(420,iw)':-2:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3",
      "-loop", "0",
      outputPath
    ], { windowsHide: true });
    const output = await readFile(outputPath);
    if (output.length === 0 || output.length > 40 * 1024 * 1024) {
      await rm(outputPath, { force: true }).catch(() => undefined);
      return "";
    }
    return `/assets/agents/${encodeURIComponent(agentName)}/${encodeURIComponent(agentName)}.gif`;
  }
  const id = `${Date.now()}-${crypto.randomUUID()}`;
  const outputName = `${id}-preview.gif`;
  const outputPath = path.join(videoGenerationRoot, outputName);
  await execFileAsync("ffmpeg", [
    "-y",
    "-i", inputPath,
    "-t", "5",
    "-vf", "scale='min(420,iw)':-2:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3",
    "-loop", "0",
    outputPath
  ], { windowsHide: true });
  const output = await readFile(outputPath);
  if (output.length === 0 || output.length > 40 * 1024 * 1024) {
    await rm(outputPath, { force: true }).catch(() => undefined);
    return "";
  }
  return `/assets/video-generation/${encodeURIComponent(outputName)}`;
}

async function videoSourceImage(value: unknown) {
  const source = String(value || "").trim();
  if (!source) return null;
  const remoteUrl = safeExternalHttpUrl(source);
  if (remoteUrl) return { url: remoteUrl.toString() };
  const dataImage = source.match(/^data:image\/(png|jpe?g|webp);base64,([a-z0-9+/=]+)$/i);
  if (dataImage) {
    const buffer = Buffer.from(dataImage[2], "base64");
    if (buffer.length === 0 || buffer.length > 10 * 1024 * 1024) throw new Error("Video source image is too large.");
    return { url: source };
  }
  const agentsImageMatch = source.match(/^\/assets\/agents\/([^/]+)\/(.+)$/);
  if (agentsImageMatch) {
    const agentName = decodeURIComponent(agentsImageMatch[1]);
    const filePath = decodeURIComponent(agentsImageMatch[2]);
    const resolved = path.resolve(agentsDir, agentName, filePath);
    if (!resolved.startsWith(path.resolve(agentsDir, agentName) + path.sep)) throw new Error("Video source image path is invalid.");
    const buffer = await readFile(resolved);
    return { url: `data:image/png;base64,${buffer.toString("base64")}` };
  }
  const prefix = "/assets/image-generation/";
  if (!source.startsWith(prefix)) throw new Error("Video source image must be a generated image or an http URL.");
  const fileName = decodeURIComponent(source.slice(prefix.length));
  if (!fileName || path.basename(fileName) !== fileName) throw new Error("Video source image path is invalid.");
  const buffer = await readFile(path.join(imageGenerationRoot, fileName));
  return { url: `data:image/png;base64,${buffer.toString("base64")}` };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/app-state", async (_req, res) => {
  res.json({ success: true, state: await readAppState() });
});

app.put("/api/app-state", async (req, res) => {
  try {
    const state = sanitizeAppState(req.body?.state ?? req.body ?? {});
    await writeAppState(state);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Could not save app state." });
  }
});

app.get("/api/workspace-state", async (_req, res) => {
  res.json({ success: true, state: await readWorkspaceState() });
});

app.put("/api/workspace-state", async (req, res) => {
  try {
    await writeWorkspaceState(req.body?.state ?? req.body ?? {});
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Could not save workspace state." });
  }
});

app.patch("/api/workspace-state", async (req, res) => {
  try {
    const current = await readWorkspaceState();
    const patch = req.body?.patch && typeof req.body.patch === "object" && !Array.isArray(req.body.patch) ? req.body.patch as Record<string, unknown> : {};
    const next = { ...current, ...patch };
    await writeWorkspaceState(next);
    res.json({ success: true, state: next });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Could not update workspace state." });
  }
});

async function findAgentFolder(agentId: string) {
  const entries = await readdir(agentsDir).catch(() => []);
  for (const entry of entries) {
    const entryPath = path.join(agentsDir, entry);
    const entryStat = await stat(entryPath).catch(() => null);
    if (!entryStat?.isDirectory()) continue;
    const files = await readdir(entryPath).catch(() => []);
    const jsonFile = files.find((f) => f.endsWith(".json") && f !== "_index.json");
    if (!jsonFile) continue;
    const raw = await readFile(path.join(entryPath, jsonFile), "utf8").catch(() => "");
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed.id === agentId) return { folder: entryPath, folderName: entry, agent: parsed };
    } catch { /* skip */ }
  }
  return null;
}

app.get("/api/agents", async (_req, res) => {
  try {
    const entries = await readdir(agentsDir).catch(() => []);
    const agents: unknown[] = [];
    for (const entry of entries) {
      const entryPath = path.join(agentsDir, entry);
      const entryStat = await stat(entryPath).catch(() => null);
      if (!entryStat?.isDirectory()) continue;
      const files = await readdir(entryPath).catch(() => []);
      const jsonFile = files.find((f) => f.endsWith(".json") && f !== "_index.json");
      if (!jsonFile) continue;
      const raw = await readFile(path.join(entryPath, jsonFile), "utf8");
      agents.push(JSON.parse(raw));
    }
    res.json({ success: true, agents });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Could not read agents." });
  }
});

app.put("/api/agents/:id", async (req, res) => {
  try {
    const agent = req.body;
    if (!agent || typeof agent !== "object" || !agent.id) throw new Error("Invalid agent data.");
    const agentName = String(agent.name || agent.id).replace(/[<>:"/\\|?*]/g, "_");
    const folderPath = path.join(agentsDir, agentName);
    await mkdir(folderPath, { recursive: true });
    await mkdir(path.join(folderPath, "generated"), { recursive: true });
    await mkdir(path.join(folderPath, "generated-videos"), { recursive: true });
    await mkdir(path.join(folderPath, "memory"), { recursive: true });
    await mkdir(path.join(folderPath, "voice"), { recursive: true });
    await mkdir(path.join(folderPath, "vrm"), { recursive: true });
    const tmpPath = path.join(folderPath, `${agent.id}.tmp`);
    const targetPath = path.join(folderPath, `${agent.id}.json`);
    await writeFile(tmpPath, JSON.stringify(agent));
    await rename(tmpPath, targetPath);
    res.json({ success: true, path: `/assets/agents/${agentName}/${agent.name}.gif` });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Could not save agent." });
  }
});

app.delete("/api/agents/:id", async (req, res) => {
  try {
    const found = await findAgentFolder(req.params.id);
    if (found) {
      await rm(found.folder, { recursive: true, force: true });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Could not delete agent." });
  }
});

const usersDir = path.join(appDataRoot, "users");

app.get("/api/users", async (_req, res) => {
  try {
    await mkdir(usersDir, { recursive: true });
    const entries = await readdir(usersDir).catch(() => []);
    const users: unknown[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const fileId = entry.replace(/\.json$/, "");
      if (fileId === "undefined" || fileId === "null" || !fileId) {
        rm(path.join(usersDir, entry)).catch(() => undefined);
        continue;
      }
      const raw = await readFile(path.join(usersDir, entry), "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed && typeof parsed === "object") {
        if (!parsed.id) parsed.id = fileId;
        if (!parsed.name) parsed.name = "User";
        users.push(parsed);
      }
    }
    res.json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Could not read users." });
  }
});

app.put("/api/users/:id", async (req, res) => {
  try {
    const user = req.body;
    const userId = req.params.id;
    if (!user || typeof user !== "object") throw new Error("Invalid user data.");
    const targetPath = path.join(usersDir, `${userId}.json`);
    const tmpPath = `${targetPath}.tmp`;
    await mkdir(usersDir, { recursive: true });
    await writeFile(tmpPath, JSON.stringify({ ...user, id: userId }));
    await rename(tmpPath, targetPath);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Could not save user." });
  }
});

app.post("/api/users", async (req, res) => {
  try {
    const user = req.body;
    if (!user || typeof user !== "object" || !user.id) throw new Error("Invalid user data.");
    const targetPath = path.join(usersDir, `${user.id}.json`);
    await mkdir(usersDir, { recursive: true });
    await writeFile(targetPath, JSON.stringify(user));
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Could not create user." });
  }
});

app.delete("/api/users/:id", async (req, res) => {
  try {
    const targetPath = path.join(usersDir, `${req.params.id}.json`);
    await rm(targetPath, { force: true });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Could not delete user." });
  }
});

app.get("/api/media/hypnotube/resolve", async (req, res) => {
  const pageUrl = safeExternalHttpUrl(req.query.url);
  if (!pageUrl || !isHypnotubeVideoPage(pageUrl)) {
    return res.status(400).json({ success: false, error: "Expected a HypnoTube video page URL." });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const media = await resolveHypnotubeMedia(pageUrl, controller.signal);
    res.setHeader("Cache-Control", "no-store");
    return res.json({ success: true, media });
  } catch (error) {
    return res.status(502).json({ success: false, error: error instanceof Error ? error.message : "HypnoTube resolve failed." });
  } finally {
    clearTimeout(timeout);
  }
});

app.get("/api/media/hypnotube/stream", async (req, res) => {
  const pageUrl = safeExternalHttpUrl(req.query.url);
  if (!pageUrl || !isHypnotubeVideoPage(pageUrl)) {
    return res.status(400).send("Expected a HypnoTube video page URL.");
  }

  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  try {
    const media = await resolveHypnotubeMedia(pageUrl, controller.signal);
    const headers: Record<string, string> = {
      "Accept": "video/mp4,video/*,*/*",
      "Referer": pageUrl.toString(),
      "User-Agent": "ErisHub-HypnoTubeResolver/1.0"
    };
    if (req.headers.range) headers.Range = req.headers.range;

    const upstream = await fetch(media.src, { headers, signal: controller.signal });
    if (!upstream.ok && upstream.status !== 206) return res.status(502).send("HypnoTube media could not be loaded.");

    res.status(upstream.status);
    for (const header of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    res.setHeader("Cache-Control", "no-store");
    if (!upstream.body) return res.end();
    const stream = Readable.fromWeb(upstream.body as never);
    stream.on("error", (error) => {
      if (controller.signal.aborted || error instanceof DOMException && error.name === "AbortError") {
        if (!res.destroyed) res.end();
        return;
      }
      if (!res.destroyed) res.destroy(error);
    });
    return stream.pipe(res);
  } catch (error) {
    if (!res.headersSent) return res.status(502).send(error instanceof Error ? error.message : "HypnoTube stream failed.");
    return res.end();
  }
});

app.get("/api/modules", (_req, res) => {
  res.json(getModuleManifest());
});

app.get("/api/settings/themes", async (_req, res) => {
  try {
    res.json({ success: true, themes: await listStoredThemes() });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Theme library failed." });
  }
});

app.put("/api/settings/themes/:id", async (req, res) => {
  try {
    const theme = await writeStoredTheme({ ...(req.body || {}), id: String(req.params.id || req.body?.id || "") });
    res.json({ success: true, theme });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Theme save failed." });
  }
});

app.delete("/api/settings/themes/:id", async (req, res) => {
  try {
    await deleteStoredTheme(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Theme delete failed." });
  }
});

app.get("/api/workspace-root", (_req, res) => {
  res.json({ success: true, root: appRoot });
});

app.get("/api/modules/core-assistant/:type", async (req, res) => {
  try {
    const type = String(req.params.type || "");
    if (type === "contacts") return res.json({ success: true, items: await listContacts() });
    if (type === "calendar") return res.json({ success: true, items: await listCalendar() });
    if (type === "projects") return res.json({ success: true, items: await listProjects() });
    res.status(404).json({ error: "Unknown core assistant module." });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Could not load core assistant data." });
  }
});

app.post("/api/modules/core-assistant/projects", async (req, res) => {
  try {
    const body = { ...(req.body || {}) };
    if (typeof body.directory === "string" && body.directory.trim()) {
      const raw = body.directory.trim();
      let resolved = path.resolve(raw);
      if (!existsSync(resolved) && !raw.includes(path.sep) && !raw.includes("/")) {
        const cwd = process.cwd();
        if (path.basename(cwd) === raw && existsSync(cwd)) resolved = cwd;
      }
      body.directory = resolved;
    }
    const item = await createProject(body);
    await recordModuleEvent({ source: "projects", action: "project.create", status: "executed", input: req.body || {}, output: item });
    res.json({ success: true, item });
  } catch (error) {
    await recordModuleEvent({ source: "projects", action: "project.create", status: "error", input: req.body || {}, error: error instanceof Error ? error.message : "Project create failed." });
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Project create failed." });
  }
});

app.patch("/api/modules/core-assistant/projects/:id", async (req, res) => {
  try {
    const body = { ...(req.body || {}) };
    if (typeof body.directory === "string" && body.directory.trim()) {
      const raw = body.directory.trim();
      let resolved = path.resolve(raw);
      if (!existsSync(resolved) && !raw.includes(path.sep) && !raw.includes("/")) {
        const cwd = process.cwd();
        if (path.basename(cwd) === raw && existsSync(cwd)) resolved = cwd;
      }
      body.directory = resolved;
    }
    const item = await updateProject(String(req.params.id), body);
    await recordModuleEvent({ source: "projects", action: "project.update", status: "executed", input: { id: req.params.id, ...(req.body || {}) }, output: item });
    res.json({ success: true, item });
  } catch (error) {
    await recordModuleEvent({ source: "projects", action: "project.update", status: "error", input: { id: req.params.id, ...(req.body || {}) }, error: error instanceof Error ? error.message : "Project update failed." });
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Project update failed." });
  }
});

app.delete("/api/modules/core-assistant/projects/:id", async (req, res) => {
  try {
    const item = await deleteProject(String(req.params.id));
    await recordModuleEvent({ source: "projects", action: "project.delete", status: "executed", input: { id: req.params.id }, output: item });
    res.json({ success: true, item });
  } catch (error) {
    await recordModuleEvent({ source: "projects", action: "project.delete", status: "error", input: { id: req.params.id }, error: error instanceof Error ? error.message : "Project delete failed." });
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Project delete failed." });
  }
});

app.get("/api/pick-directory", async (_req, res) => {
  try {
    const result = execSync(
      `powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select a project directory'; if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }"`,
      { timeout: 300000, encoding: "utf8" }
    );
    const path = (result || "").trim();
    res.json({ success: true, path });
  } catch (error) {
    res.json({ success: false, path: "", error: error instanceof Error ? error.message : "Could not open directory picker." });
  }
});

app.post("/api/modules/core-assistant/projects/:id/repo-summary", async (req, res) => {
  const provider = req.body?.provider as ChatRequest["provider"] | undefined;
  try {
    if (!provider?.apiKey?.trim()) throw new Error("Provider API key is required.");
    const project = (await listProjects()).find((item) => item.id === String(req.params.id));
    if (!project) throw new Error("Project not found.");
    const root = String(req.body?.root || "").trim();
    const files: Array<{ path?: string; name?: string; size?: number }> = Array.isArray(req.body?.files) ? req.body.files.slice(0, 220) : [];
    const fileTree = files.map((item) => `- ${String(item.path || item.name || "")} (${Number(item.size) || 0} bytes)`).join("\n") || "No project files loaded.";
    const summary = (await completeProvider(provider, [
      { role: "system", content: "Write a concise 2-4 sentence repository summary from a project name, directory, and file tree. Return only the summary text. Do not include markdown bullets or preamble." },
      { role: "user", content: [`Project: ${project.name}`, `Directory: ${root || "not set"}`, "File tree:", fileTree].join("\n") }
    ], { temperature: 0.2, maxTokens: 240 })).slice(0, 1200);
    if (!summary) throw new Error("Model returned an empty summary.");
    const item = await updateProject(project.id, { summary });
    await recordModuleEvent({ source: "projects", action: "project.repo-summary", status: "executed", input: { id: project.id, root, files: files.length }, output: { id: project.id, summary } });
    res.json({ success: true, item });
  } catch (error) {
    await recordModuleEvent({ source: "projects", action: "project.repo-summary", status: "error", input: { id: req.params.id, root: req.body?.root }, error: error instanceof Error ? error.message : "Repo summary failed." });
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Repo summary failed." });
  }
});

app.get("/api/modules/memory-bank/profile", async (_req, res) => {
  res.json({ success: true, profile: await getUserProfile() });
});

app.get("/api/modules/memory-bank/assistant-files", (req, res) => {
  const agentId = String(req.query.agentId || "").trim();
  if (!agentId) return res.status(400).json({ error: "agentId query parameter is required." });
  res.json({ success: true, items: listAssistantFiles(agentId) });
});

app.post("/api/modules/memory-bank/assistant-files", async (req, res) => {
  try {
    const agentId = String(req.body?.agentId || "").trim();
    if (!agentId) throw new Error("agentId is required.");
    const item = createAssistantFile(agentId, req.body || {});
    await recordModuleEvent({ source: "computation", action: "assistant-file.create", status: "executed", input: { name: req.body?.name, agentId }, output: { id: item.id, name: item.name, chars: item.content.length } });
    res.json({ success: true, item });
  } catch (error) {
    await recordModuleEvent({ source: "computation", action: "assistant-file.create", status: "error", input: { name: req.body?.name, agentId: req.body?.agentId }, error: error instanceof Error ? error.message : "Assistant file create failed." });
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Assistant file create failed." });
  }
});

app.patch("/api/modules/memory-bank/assistant-files/:id", async (req, res) => {
  try {
    const agentId = String(req.body?.agentId || "").trim();
    if (!agentId) throw new Error("agentId is required.");
    const item = updateAssistantFile(agentId, String(req.params.id), req.body || {});
    await recordModuleEvent({ source: "computation", action: "assistant-file.update", status: "executed", input: { id: req.params.id, name: req.body?.name, agentId }, output: { id: item.id, name: item.name, chars: item.content.length } });
    res.json({ success: true, item });
  } catch (error) {
    await recordModuleEvent({ source: "computation", action: "assistant-file.update", status: "error", input: { id: req.params.id, name: req.body?.name, agentId: req.body?.agentId }, error: error instanceof Error ? error.message : "Assistant file update failed." });
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Assistant file update failed." });
  }
});

app.delete("/api/modules/memory-bank/assistant-files/:id", async (req, res) => {
  try {
    const agentId = String(req.query.agentId || "").trim();
    if (!agentId) throw new Error("agentId is required.");
    const result = deleteAssistantFile(agentId, String(req.params.id));
    await recordModuleEvent({ source: "computation", action: "assistant-file.delete", status: "executed", input: { id: req.params.id, agentId }, output: result });
    res.json({ success: true, ...result });
  } catch (error) {
    await recordModuleEvent({ source: "computation", action: "assistant-file.delete", status: "error", input: { id: req.params.id, agentId: String(req.query.agentId || "") }, error: error instanceof Error ? error.message : "Assistant file delete failed." });
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Assistant file delete failed." });
  }
});

app.get("/api/modules/projects/files", async (req, res) => {
  try {
    res.json({ success: true, files: await listProjectFiles(req.query.root) });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Could not list project files." });
  }
});

app.get("/api/modules/projects/file", async (req, res) => {
  try {
    const { target } = resolveProjectPath(req.query.root, String(req.query.file || ""));
    const content = await readFile(target, "utf8");
    res.json({ success: true, file: { path: String(req.query.file || ""), content } });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Could not read project file." });
  }
});

app.put("/api/modules/projects/file", async (req, res) => {
  try {
    const file = String(req.body?.file || "").trim();
    if (!file) throw new Error("File path is required.");
    const { target } = resolveProjectPath(req.body?.root, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, String(req.body?.content || ""), "utf8");
    const info = await stat(target);
    const output = { path: file.replace(/\\/g, "/"), name: path.basename(file), size: info.size, updatedAt: info.mtime.toISOString() };
    await recordModuleEvent({ source: "projects", action: "project-file.write", status: "executed", input: { root: req.body?.root, file }, output });
    res.json({ success: true, file: output });
  } catch (error) {
    await recordModuleEvent({ source: "projects", action: "project-file.write", status: "error", input: { root: req.body?.root, file: req.body?.file }, error: error instanceof Error ? error.message : "Could not write project file." });
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Could not write project file." });
  }
});

app.post("/api/run-python", async (req, res) => {
  try {
    const { code, root, maxOutputChars = 4096 } = req.body || {};
    if (!code || typeof code !== "string") return res.status(400).json({ success: false, error: "Code is required." });
    const cwd = root ? path.resolve(String(root)) : process.cwd();
    let output = "";
    const proc = spawn("python3", ["-c", code], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    const maxChars = Math.max(1, Math.min(200000, Number(maxOutputChars)));
    proc.stdout.on("data", (data: Buffer) => {
      const text = data.toString();
      if (output.length + text.length > maxChars) {
        output += text.slice(0, maxChars - output.length) + "\n[output truncated]";
        try { proc.kill("SIGTERM"); } catch {}
      } else output += text;
    });
    proc.stderr.on("data", (data: Buffer) => { output += data.toString(); });
    await new Promise<void>((resolve) => {
      proc.on("exit", () => resolve());
      proc.on("error", (err: Error) => { output += `\n${err.message}`; resolve(); });
    });
    res.json({ success: true, output: output.trimEnd() || "[no output]" });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Could not run Python." });
  }
});

app.post("/api/run-javascript", async (req, res) => {
  try {
    const { code, root, maxOutputChars = 4096 } = req.body || {};
    if (!code || typeof code !== "string") return res.status(400).json({ success: false, error: "Code is required." });
    const cwd = root ? path.resolve(String(root)) : process.cwd();
    let output = "";
    const proc = spawn("node", ["-e", `"use strict";\n${code}`], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    const maxChars = Math.max(1, Math.min(200000, Number(maxOutputChars)));
    proc.stdout.on("data", (data: Buffer) => {
      const text = data.toString();
      if (output.length + text.length > maxChars) {
        output += text.slice(0, maxChars - output.length) + "\n[output truncated]";
        try { proc.kill("SIGTERM"); } catch {}
      } else output += text;
    });
    proc.stderr.on("data", (data: Buffer) => { output += data.toString(); });
    await new Promise<void>((resolve) => {
      proc.on("exit", () => resolve());
      proc.on("error", (err: Error) => { output += `\n${err.message}`; resolve(); });
    });
    res.json({ success: true, output: output.trimEnd() || "[no output]" });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Could not run JavaScript." });
  }
});

app.get("/api/modules/projects/git-review", async (req, res) => {
  try {
    let isRepo = true;
    try {
      await runGit(req.query.root, ["rev-parse", "--is-inside-work-tree"]);
    } catch {
      isRepo = false;
    }
    if (!isRepo) {
      return res.json({ success: true, isRepo: false, branch: "", status: [], stagedDiff: "", unstagedDiff: "" });
    }
    const [statusRaw, stagedDiff, unstagedDiff] = await Promise.all([
      runGit(req.query.root, ["status", "--porcelain"]),
      runGit(req.query.root, ["diff", "--cached", "--no-color"]),
      runGit(req.query.root, ["diff", "--no-color"])
    ]);
    let branch = "";
    try {
      branch = (await runGit(req.query.root, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    } catch {
      branch = "";
    }
    return res.json({
      success: true,
      isRepo: true,
      branch: branch.trim(),
      status: parseGitStatus(statusRaw),
      stagedDiff,
      unstagedDiff
    });
  } catch (error) {
    return res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Could not load git review." });
  }
});

app.post("/api/modules/projects/git-review/stage", async (req, res) => {
  try {
    const paths = Array.isArray(req.body?.paths) ? req.body.paths.map((item: unknown) => String(item || "").trim()).filter(Boolean) : [];
    if (!paths.length) throw new Error("At least one path is required.");
    if (req.body?.stage === false) await runGit(req.body?.root, ["restore", "--staged", "--", ...paths]);
    else await runGit(req.body?.root, ["add", "--", ...paths]);
    return res.json({ success: true });
  } catch (error) {
    return res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Could not update staging." });
  }
});

app.post("/api/modules/projects/git-review/commit", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    if (!message) throw new Error("Commit message is required.");
    await runGit(req.body?.root, ["commit", "-m", message]);
    return res.json({ success: true });
  } catch (error) {
    return res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Could not commit." });
  }
});

app.post("/api/modules/projects/git-review/init", async (req, res) => {
  try {
    await runGit(req.body?.root, ["init"]);
    return res.json({ success: true });
  } catch (error) {
    return res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Could not initialize git repository." });
  }
});

app.post("/api/modules/projects/git-review/ignore", async (req, res) => {
  try {
    const root = req.body?.root as string | undefined;
    const paths = Array.isArray(req.body?.paths) ? req.body.paths.map((item: unknown) => String(item || "").trim()).filter(Boolean) : [];
    if (!root || !paths.length) throw new Error("Root directory and at least one path are required.");
    const gitignorePath = path.join(root, ".gitignore");
    let existing = "";
    try { existing = await readFile(gitignorePath, "utf8"); } catch { /* file doesn't exist yet */ }
    const lines = existing.split("\n").map((l: string) => l.trim());
    const toAdd = paths.filter((p: string) => !lines.includes(p) && !lines.includes(`/${p}`));
    if (toAdd.length === 0) return res.json({ success: true, added: [] });
    const append = (existing.endsWith("\n") ? "" : "\n") + toAdd.join("\n") + "\n";
    await writeFile(gitignorePath, existing + append, "utf8");
    return res.json({ success: true, added: toAdd });
  } catch (error) {
    return res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Could not ignore path." });
  }
});

app.post("/api/modules/projects/llm-complete", async (req, res) => {
  try {
    const rawProvider = req.body?.provider as ChatRequest["provider"] | undefined;
    if (!rawProvider) throw new Error("Provider is required.");
    const provider = rawProvider.useManagedLlamaCpp === true
      ? await ensureLlamaCppServer(rawProvider, requestLlamaCppSettings({ modules: Array.isArray(req.body?.modules) ? req.body.modules : [] } as ChatRequest))
      : rawProvider;
    if (provider.useManagedLlamaCpp !== true && !provider.apiKey?.trim()) throw new Error("Provider API key is required.");
    if (!provider?.baseUrl?.trim()) throw new Error("Provider base URL is required.");
    if (!provider?.model?.trim()) throw new Error("Provider model is required.");
    const prefix = String(req.body?.prefix || "").slice(-2600);
    const suffix = String(req.body?.suffix || "").slice(0, 500);
    const filePath = String(req.body?.filePath || "").slice(0, 260);
    const completion = (await completeProvider(provider, [
      { role: "system", content: "You are an inline code completion engine. Continue from <CURSOR> only. Return only new text to insert at cursor. Do not repeat prior text. Do not return explanations or markdown." },
      { role: "user", content: [`File: ${filePath || "unknown"}`, "Code:", `${prefix}<CURSOR>${suffix}`].join("\n") }
    ], { temperature: 0.2, maxTokens: 120 })).replace(/^```[\s\S]*?\n/, "").replace(/```$/g, "").replace(/\r/g, "").slice(0, 240);
    res.json({ success: true, completion });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Could not complete code." });
  }
});

app.get("/api/modules/assets/inventory", async (req, res) => {
  const inventory = await getLocalAssetInventory(req.query.refresh === "true");
  res.json({ success: true, inventory });
});

app.post("/api/modules/voiceforge/discover", async (req, res) => {
  try {
    const endpoint = safeExternalHttpUrl(req.body?.endpoint);
    if (!endpoint) throw new Error("VoiceForge endpoint must be http or https.");
    endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/`;
    endpoint.search = "";
    endpoint.hash = "";

    await fetchVoiceForgeOk(endpoint, "/health");
    const [modulesResult, promptsResult, modelsResult, backgroundsResult, configResult, bgmResult, ambientResult] = await Promise.allSettled([
      fetchVoiceForgeJson(endpoint, "/api/modules"),
      fetchVoiceForgeJson(endpoint, "/api/audio-prompts"),
      fetchVoiceForgeJson(endpoint, "/api/models"),
      fetchVoiceForgeJson(endpoint, "/v1/background/list"),
      fetchVoiceForgeJson(endpoint, "/api/config"),
      getAssetsFolderListing("voiceforge/bgm"),
      getAssetsFolderListing("ambient")
    ]);

    const modules = modulesResult.status === "fulfilled" && modulesResult.value && typeof modulesResult.value === "object" ? modulesResult.value : {};
    if (promptsResult.status === "fulfilled") {
      _voiceforgePromptCache.set(endpoint.origin, { prompts: normalizeVoiceForgePrompts(promptsResult.value), ts: Date.now() });
    }
    res.json({
      success: true,
      modules,
      audioPrompts: promptsResult.status === "fulfilled" ? normalizeVoiceForgePrompts(promptsResult.value) : [],
      rvcModels: modelsResult.status === "fulfilled" ? normalizeVoiceForgeModels(modelsResult.value) : [],
      backgroundTracks: backgroundsResult.status === "fulfilled" ? normalizeVoiceForgeBackgroundTracks(backgroundsResult.value) : [],
      bgmOptions: bgmResult.status === "fulfilled" ? audioAssetOptions(bgmResult.value) : [],
      ambientOptions: ambientResult.status === "fulfilled" ? audioAssetOptions(ambientResult.value) : [],
      config: configResult.status === "fulfilled" ? configResult.value : null
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "VoiceForge discovery failed." });
  }
});

app.post("/api/modules/voiceforge/stream", async (req, res) => {
  try {
    const response = await requestVoiceForgeStream(req.body?.endpoint, objectValue(req.body));

    if (!response.ok || !response.body) {
      const message = await response.text().catch(() => "");
      throw new Error(message || `VoiceForge generation returned ${response.status}.`);
    }

    res.status(200);
    res.setHeader("Content-Type", response.headers.get("content-type") || "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    pipeWebBodyToResponseWithTrace(response.body as never, res, () => {});
  } catch (error) {
    if (!res.headersSent) res.status(400).json({ success: false, error: error instanceof Error ? error.message : "VoiceForge generation failed." });
  }
});

app.get("/api/modules/voiceforge/background-stream", async (req, res) => {
  const endpoint = safeExternalHttpUrl(req.query.endpoint);
  if (!endpoint) return res.status(400).send("VoiceForge endpoint must be http or https.");
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/`;
  endpoint.search = "";
  endpoint.hash = "";

  const upstreamUrl = new URL("/v1/background/stream", endpoint);
  for (const key of ["session_id", "tracks_json", "sample_rate", "duration", "character"]) {
    const value = req.query[key];
    if (typeof value === "string" && value.trim()) upstreamUrl.searchParams.set(key, value);
  }

  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    const headers: Record<string, string> = { Accept: "audio/*,*/*" };
    if (req.headers.range) headers.Range = req.headers.range;
    const upstream = await fetch(upstreamUrl.toString(), { headers, signal: controller.signal });
    if (!upstream.ok && upstream.status !== 206) return res.status(502).send(`VoiceForge background stream returned ${upstream.status}.`);

    res.status(upstream.status);
    for (const header of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    res.setHeader("Cache-Control", "no-store");
    if (!upstream.body) return res.end();
    pipeWebBodyToResponse(upstream.body as never, res, controller);
  } catch (error) {
    if (!res.headersSent) return res.status(502).send(error instanceof Error ? error.message : "VoiceForge background stream failed.");
    return res.end();
  }
});

app.post("/api/modules/voiceforge/background-stop", async (req, res) => {
  try {
    const endpoint = safeExternalHttpUrl(req.body?.endpoint);
    if (!endpoint) throw new Error("VoiceForge endpoint must be http or https.");
    endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/`;
    endpoint.search = "";
    endpoint.hash = "";

    const body = new URLSearchParams();
    const sessionId = String(req.body?.session_id || "").trim();
    if (sessionId) body.set("session_id", sessionId);
    const character = String(req.body?.character || "").trim();
    if (character) body.set("character", character);

    const upstream = await fetch(new URL("/v1/background/stop-stream", endpoint).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(8000)
    });
    if (!upstream.ok) throw new Error(`VoiceForge background stop returned ${upstream.status}.`);
    res.json({ success: true });
  } catch (error) {
    res.status(502).json({ success: false, error: error instanceof Error ? error.message : "VoiceForge background stop failed." });
  }
});

app.post("/api/assets/get", async (req, res) => {
  try {
    res.json(await getAssetsFolderListing(req.body?.folder));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not list assets." });
  }
});

app.get("/api/plugins/intiface-assets/list", async (req, res) => {
  try {
    const type = String(req.query.type || "").toLowerCase();
    const intifaceRoot = path.resolve(moduleAssetsRoot, "intiface");

    const listForSubdir = (subdir: string) => {
      const base = path.join(intifaceRoot, subdir);
      if (!existsSync(base)) return [];
      const entries = readdirSync(base, { withFileTypes: true });
      const files = [];
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        if (entry.isFile()) {
          files.push(`assets/intiface/${subdir}/${entry.name}`);
        }
      }
      return files.sort((a, b) => a.localeCompare(b));
    };

    if (type === "media") return res.json({ success: true, files: listForSubdir("media") });
    if (type === "funscript") return res.json({ success: true, files: listForSubdir("funscripts") });
    if (type === "playmodes") {
      const playmodesRoot = path.join(intifaceRoot, "playmodes");
      const modes = [];
      if (existsSync(playmodesRoot)) {
        const entries = readdirSync(playmodesRoot, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const modeJson = path.join(playmodesRoot, entry.name, "mode.json");
          if (existsSync(modeJson)) modes.push(entry.name);
        }
      }
      modes.sort((a, b) => a.localeCompare(b));
      return res.json({ success: true, modes });
    }
    return res.status(400).json({ success: false, error: "Invalid type. Use media|funscript|playmodes" });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Could not list Intiface assets." });
  }
});

app.post("/api/plugins/intiface-assets/write", async (req, res) => {
  try {
    const relativePath = String(req.body?.path || "").replace(/\\/g, "/");
    const content = String(req.body?.content || "");
    if (!relativePath || relativePath.startsWith("/") || relativePath.includes("..")) throw new Error("Invalid asset path.");
    if (!relativePath.startsWith("playmodes/")) throw new Error("Intiface writes are limited to playmodes.");
    if (Buffer.byteLength(content, "utf8") > 512 * 1024) throw new Error("Asset file is too large.");
    const target = path.resolve(moduleAssetsRoot, "intiface", relativePath);
    const root = path.resolve(moduleAssetsRoot, "intiface");
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error("Asset path escapes intiface root.");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Could not write Intiface asset." });
  }
});

app.post("/api/plugins/intiface-assets/delete", async (req, res) => {
  try {
    const relativePath = String(req.body?.path || "").replace(/\\/g, "/");
    if (!relativePath || relativePath.startsWith("/") || relativePath.includes("..")) throw new Error("Invalid asset path.");
    const target = path.resolve(moduleAssetsRoot, "intiface", relativePath);
    const root = path.resolve(moduleAssetsRoot, "intiface");
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error("Asset path escapes intiface root.");
    if (!existsSync(target)) return res.status(404).json({ success: false, error: "Path not found" });
    const isDir = statSync(target).isDirectory();
    if (isDir) {
      rmSync(target, { recursive: true, force: true });
    } else {
      unlinkSync(target);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Could not delete Intiface asset." });
  }
});

app.get("/api/modules/assets/backgrounds", async (req, res) => {
  res.json(await getBackgroundAssets(req.query.refresh === "true"));
});

app.delete("/api/modules/assets/backgrounds", async (req, res) => {
  try {
    await deleteBackgroundAsset(req.body?.url);
    res.json({ success: true, assets: await getBackgroundAssets(true) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not delete background asset." });
  }
});

app.patch("/api/modules/assets/backgrounds", async (req, res) => {
  try {
    const nextName = await renameBackgroundAsset(req.body?.url, req.body?.name);
    const assets = await getBackgroundAssets(true);
    res.json({ success: true, asset: assets.find((item) => item.name === nextName), assets });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not rename background asset." });
  }
});

app.post("/api/modules/assets/upload", async (req, res) => {
  try {
    const { category, name, data } = req.body;
    if (!category || !data) throw new Error("Category and file data are required.");
    const buffer = Buffer.from(String(data).replace(/^data:[^;]+;base64,/, ""), "base64");
    const result = await uploadAsset(category, String(name || "asset").trim() || "asset", buffer);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Upload failed." });
  }
});

app.post("/api/modules/assets/vrm/fbx-package", async (req, res) => {
  try {
    const result = await uploadFbxPackage(String(req.body?.name || "fbx-package"), req.body?.files || []);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "FBX package upload failed." });
  }
});

app.post("/api/settings/background/autopick", async (req, res) => {
  const request = req.body as ChatRequest;
  try {
    const rawProvider = request.provider;
    if (!rawProvider) throw new Error("Provider is required.");
    const provider = rawProvider.useManagedLlamaCpp === true
      ? await ensureLlamaCppServer(rawProvider, requestLlamaCppSettings(request))
      : rawProvider;
    if (provider.useManagedLlamaCpp !== true && !provider.apiKey?.trim()) throw new Error("Provider API key is required.");
    if (!provider.baseUrl?.trim()) throw new Error("Provider base URL is required.");
    if (!provider.model?.trim()) throw new Error("Provider model is required.");
    const assets = await getBackgroundAssets(false);
    if (assets.length === 0) throw new Error("No backgrounds are available.");
    const activeNames = [request.promptProfile?.assistantName, request.promptProfile?.name].filter(Boolean).join(" / ");
    const recentMessages = request.messages.slice(-12).map((message) => `${message.role}: ${stripInlineActions(message.content)}`).join("\n").slice(-6000);
    const content = await completeProvider(provider, [
      { role: "system", content: "Choose the single best visual novel scene background for the current chat context. Return only JSON in this exact shape: {\"name\":\"exact background file name\",\"reason\":\"short reason\"}. The name must exactly match one available background. Do not invent names." },
      { role: "user", content: [`Active agent: ${activeNames || "unknown"}`, "Available backgrounds:", assets.map((asset) => `- ${asset.name} [${asset.type}]`).join("\n"), "Recent chat context:", recentMessages || "No recent messages."].join("\n\n") }
    ], { temperature: 0.2, maxTokens: 120 });
    const parsed = JSON.parse(content.match(/\{[\s\S]*\}/)?.[0] || content) as { name?: string; reason?: string };
    const asset = await resolveBackgroundAsset(String(parsed.name || ""));
    res.json({ success: true, asset, reason: String(parsed.reason || "") });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Background autopick failed." });
  }
});

app.get("/api/modules/scheduler/status", async (_req, res) => {
  const reminders = await readStoredScheduleItems();
  const now = Date.now();
  res.json({
    success: true,
    jobs: [
      {
        id: "reminders-due",
        name: "Due scheduled items",
        status: "client-polled",
        pollSeconds: 30,
        pending: reminders.filter((item) => !item.notifiedAt).length,
        due: reminders.filter((item) => !item.notifiedAt && Date.parse(item.at) <= now).length
      }
    ]
  });
});

app.get("/api/modules/discord/config", async (_req, res) => {
  const config = await readDiscordConfig();
  const { ensureBot, getBotUserId } = await import("./modules/discord");
  if (config.token && !getBotUserId()) await ensureBot().catch(() => undefined);
  const clientId = getBotUserId();
  res.json({ success: true, config: { ...config, token: config.token ? "••••••••" : "" }, clientId, connected: !!clientId });
});

app.post("/api/modules/discord/config", async (req, res) => {
  try {
    const body = req.body || {};
    const current = await readDiscordConfig();
    await writeDiscordConfig({
      token: body.token || current.token,
      channelId: body.channelId ?? current.channelId,
      guildId: body.guildId ?? current.guildId,
      autoFireReminders: body.autoFireReminders !== false,
      mentionTargets: Array.isArray(body.mentionTargets) ? body.mentionTargets : current.mentionTargets,
      providerId: body.providerId ?? current.providerId,
      activeAgentsByChannel: body.activeAgentsByChannel && typeof body.activeAgentsByChannel === "object" && !Array.isArray(body.activeAgentsByChannel)
        ? body.activeAgentsByChannel
        : current.activeAgentsByChannel
    });
    await stopBot();
    const { ensureBot, getBotUserId } = await import("./modules/discord");
    const client = await ensureBot();
    const connected = !!(client || getBotUserId());
    if (!connected) res.json({ success: true, connected: false, warning: "Bot token saved but login failed. Check the server console for details." });
    else res.json({ success: true, connected: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Failed to save Discord config." });
  }
});

app.get("/api/modules/scheduled-items", async (_req, res) => {
  const items = await readStoredScheduleItems();
  res.json({ success: true, items: items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)) });
});

app.post("/api/modules/scheduled-items", async (req, res) => {
  try {
    const item = await createScheduledItem(req.body || {});
    res.json({ success: true, item });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Failed to create scheduled item." });
  }
});

app.post("/api/modules/scheduled-items/due", async (_req, res) => {
  const now = Date.now();
  const items = await readStoredScheduleItems();
  const due = items.filter((item) => !item.notifiedAt && Date.parse(item.at) <= now);
  if (due.length > 0) {
    const notifiedAt = new Date().toISOString();
    const dueIds = new Set(due.map((item) => item.id));
    await writeStoredScheduleItems(items.map((item) => dueIds.has(item.id) ? { ...item, notifiedAt } : item));
  }
  res.json({ success: true, due });
});

app.delete("/api/modules/scheduled-items/:id", async (req, res) => {
  const id = String(req.params.id || "");
  const items = await readStoredScheduleItems();
  await writeStoredScheduleItems(items.filter((item) => item.id !== id));
  res.json({ success: true });
});

app.get("/api/modules/memory", (req, res) => { try { res.json({ success: true, memories: listMemories(String(req.query.agentId || ""), String(req.query.q || "")) }); } catch (error) { res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Memory list failed." }); } });
app.post("/api/modules/memory", (req, res) => { try { res.json({ success: true, memory: createMemory(String(req.body?.agentId || ""), req.body || {}) }); } catch (error) { res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Memory create failed." }); } });
app.patch("/api/modules/memory/:id", (req, res) => { try { res.json({ success: true, memory: updateMemory(String(req.body?.agentId || req.query.agentId || ""), String(req.params.id), req.body || {}) }); } catch (error) { res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Memory update failed." }); } });
app.delete("/api/modules/memory", (req, res) => { try { clearMemories(String(req.query.agentId || req.body?.agentId || "")); res.json({ success: true }); } catch (error) { res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Memory clear failed." }); } });
app.delete("/api/modules/memory/:id", (req, res) => { try { deleteMemory(String(req.query.agentId || req.body?.agentId || ""), String(req.params.id)); res.json({ success: true }); } catch (error) { res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Memory delete failed." }); } });

app.get("/api/modules/tasks", async (_req, res) => res.json({ success: true, tasks: await listTasks() }));
app.post("/api/modules/tasks", async (req, res) => { try { res.json({ success: true, task: await createTask(req.body || {}) }); } catch (error) { res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Task create failed." }); } });
app.patch("/api/modules/tasks/:id", async (req, res) => { try { res.json({ success: true, task: await updateTask(String(req.params.id), req.body || {}) }); } catch (error) { res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Task update failed." }); } });
app.delete("/api/modules/tasks/:id", async (req, res) => { await deleteTask(String(req.params.id)); res.json({ success: true }); });

app.get("/api/modules/notes", async (req, res) => res.json({ success: true, notes: await listNotes(String(req.query.q || "")) }));
app.post("/api/modules/notes", async (req, res) => { try { res.json({ success: true, note: await createNote(req.body || {}) }); } catch (error) { res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Note create failed." }); } });
app.patch("/api/modules/notes/:id", async (req, res) => { try { res.json({ success: true, note: await updateNote(String(req.params.id), req.body || {}) }); } catch (error) { res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Note update failed." }); } });
app.delete("/api/modules/notes/:id", async (req, res) => { await deleteNote(String(req.params.id)); res.json({ success: true }); });

app.post("/api/modules/calculator/calculate", (req, res) => { try { res.json({ success: true, result: calculateExpression(String(req.body?.expression || "")) }); } catch (error) { res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Calculation failed." }); } });

app.post("/api/modules/relationship-meter/baseline", async (req, res) => {
  try {
    const request = req.body as ChatRequest;
    const rawProvider = request.provider;
    const profile = request.promptProfile;
    if (!rawProvider) throw new Error("Provider is required.");
    if (!profile) throw new Error("Prompt profile is required.");
    const provider = rawProvider.useManagedLlamaCpp === true
      ? await ensureLlamaCppServer(rawProvider, requestLlamaCppSettings(request))
      : rawProvider;
    if (provider.useManagedLlamaCpp !== true && !provider.apiKey?.trim()) throw new Error("Provider API key is required.");
    if (!provider.baseUrl?.trim()) throw new Error("Provider base URL is required.");
    if (!provider.model?.trim()) throw new Error("Provider model is required.");
    const profileText = [
      `Agent id: ${profile.id}`,
      `Agent name: ${profile.assistantName || profile.name}`,
      profile.startingMessage ? `Starting message: ${profile.startingMessage}` : "",
      profile.dialogueExamples ? `Dialogue examples: ${profile.dialogueExamples}` : "",
      Array.isArray(profile.blocks) ? profile.blocks.filter((block) => block.enabled !== false).map((block) => `Block ${block.name}:\n${block.content}`).join("\n\n") : ""
    ].filter(Boolean).join("\n\n").slice(0, 12000);
    const content = await completeProvider(provider, [
      { role: "system", content: "Infer an initial private dating-sim relationship baseline from an AI character profile before any user chat. Return only JSON with keys mood, relationshipLevel, affinity, trust, comfort, familiarity, attraction, chemistry, romance, intimacy, devotion, arousal, tension, irritation, jealousy. mood must be one of admiration, amusement, anger, annoyance, approval, caring, confusion, curiosity, desire, disappointment, disapproval, disgust, embarrassment, excitement, fear, gratitude, grief, joy, love, nervousness, optimism, pride, realization, relief, remorse, sadness, surprise, neutral, aroused. relationshipLevel is an integer from -100 to 100, where negative means hostile/distant, 0 means neutral/unknown, and positive means warm/attached. All other meters are integers from 0 to 100. The baseline should represent how this character is likely to initially feel toward a new user given its persona, not current conversation history." },
      { role: "user", content: profileText }
    ], { temperature: 0.2, maxTokens: 220 });
    const parsed = JSON.parse(content.match(/\{[\s\S]*\}/)?.[0] || content) as Record<string, unknown>;
    const meter = (key: string, fallback: number) => {
      const value = Number(parsed[key]);
      return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : fallback;
    };
    const relationshipLevel = Number(parsed.relationshipLevel);
    const relationshipMoods = new Set(["admiration", "amusement", "anger", "annoyance", "approval", "caring", "confusion", "curiosity", "desire", "disappointment", "disapproval", "disgust", "embarrassment", "excitement", "fear", "gratitude", "grief", "joy", "love", "nervousness", "optimism", "pride", "realization", "relief", "remorse", "sadness", "surprise", "neutral", "aroused"]);
    const mood = String(parsed.mood || "neutral").trim();
    res.json({
      success: true,
      relationship: {
        mood: relationshipMoods.has(mood) ? mood : "neutral",
        relationshipLevel: Number.isFinite(relationshipLevel) ? Math.max(-100, Math.min(100, Math.round(relationshipLevel))) : 0,
        affinity: meter("affinity", 50),
        trust: meter("trust", 50),
        comfort: meter("comfort", 50),
        familiarity: meter("familiarity", 0),
        attraction: meter("attraction", 0),
        chemistry: meter("chemistry", 0),
        romance: meter("romance", 0),
        intimacy: meter("intimacy", 0),
        devotion: meter("devotion", 0),
        arousal: meter("arousal", 0),
        tension: meter("tension", 0),
        irritation: meter("irritation", 0),
        jealousy: meter("jealousy", 0)
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Relationship baseline failed." });
  }
});

app.post("/api/modules/relationship-meter/analyze", async (req, res) => {
  const request = req.body as ChatRequest;
  try {
    const analyzerTemperature = Math.max(0.1, Math.min(0.5, Number(request.provider.temperature ?? 0.3)));
    const analyzerRequest: ChatRequest = {
      ...request,
      provider: { ...request.provider, temperature: analyzerTemperature },
      promptProfile: { ...request.promptProfile, dialogueExamples: "" }
    };
    const content = await completeChat(analyzerRequest, 500);
    res.json({ content });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Relationship analyzer failed." });
  }
});

app.get("/api/modules/session-summary", async (_req, res) => res.json({ success: true, summaries: await listSummaries() }));
app.post("/api/modules/session-summary", async (req, res) => { try { res.json({ success: true, summary: await upsertSummary(req.body || {}) }); } catch (error) { res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Summary save failed." }); } });
app.delete("/api/modules/session-summary/:id", async (req, res) => { await deleteSummary(String(req.params.id)); res.json({ success: true }); });

app.get("/api/modules/file-library", async (_req, res) => res.json({ success: true, documents: await listDocuments() }));
app.post("/api/modules/file-library", async (req, res) => { try { res.json({ success: true, document: await addDocument(req.body || {}) }); } catch (error) { res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Document add failed." }); } });
app.get("/api/modules/file-library/:id", async (req, res) => { const document = await getDocument(String(req.params.id)); if (!document) return res.status(404).json({ success: false, error: "Document not found." }); res.json({ success: true, document }); });
app.delete("/api/modules/file-library/:id", async (req, res) => { await deleteDocument(String(req.params.id)); res.json({ success: true }); });

app.get("/api/modules/notifications", async (_req, res) => res.json({ success: true, notifications: await listNotifications() }));
app.post("/api/modules/notifications", async (req, res) => { try { res.json({ success: true, notification: await createNotification(req.body || {}) }); } catch (error) { res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Notification create failed." }); } });
app.post("/api/modules/notifications/read-all", async (_req, res) => { await markAllNotificationsRead(); res.json({ success: true }); });
app.patch("/api/modules/notifications/:id/read", async (req, res) => { await markNotificationRead(String(req.params.id)); res.json({ success: true }); });
app.delete("/api/modules/notifications/:id", async (req, res) => { await deleteNotification(String(req.params.id)); res.json({ success: true }); });
app.delete("/api/modules/notifications", async (_req, res) => { await clearNotifications(); res.json({ success: true }); });

app.get("/api/modules/module-event-log", async (req, res) => res.json({ success: true, events: await listModuleEvents(Number(req.query.limit || 200)) }));
app.delete("/api/modules/module-event-log", async (_req, res) => { await clearModuleEvents(); res.json({ success: true }); });

app.post("/api/modules/image-generation/generate", async (req, res) => {
  const prompt = cappedText(req.body?.prompt, 2000);
  const negativePrompt = cappedText(req.body?.negativePrompt, 1200);
  const provider = req.body?.provider as ChatRequest["provider"] | undefined;
  const settings = req.body?.settings && typeof req.body.settings === "object" ? req.body.settings as Record<string, unknown> : {};
  const baseUrl = String(provider?.baseUrl || "").trim();
  const apiKey = String(provider?.apiKey || "").trim();
  const useComfy = provider?.useComfyUi === true;
  const model = cappedText(provider?.model || "gpt-image-1", 120);
  const size = imageSizes.has(String(settings.size)) ? String(settings.size) : "";
  const agentId = String(req.body?.agentId || "").trim();

  if (!prompt) {
    res.status(400).json({ error: "Prompt is required." });
    return;
  }
  if (!baseUrl) {
    res.status(400).json({ error: "Image provider base URL is required." });
    return;
  }
  if (!useComfy && !apiKey) {
    res.status(400).json({ error: "Image provider API key is required." });
    return;
  }

  try {
    const agentName = agentId ? (await findAgentFolder(agentId))?.folderName || "" : "";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    let url = "";
    let resolvedModel = model;
    if (useComfy) {
      const workflowJson = String(settings.comfyuiImageWorkflow || "");
      if (!workflowJson) throw new Error("ComfyUI image workflow JSON is not configured in module settings.");
      resolvedModel = "ComfyUI";
      const promptId = await comfyuiSubmitPrompt(baseUrl, workflowJson, prompt, negativePrompt, size);
      const outputs = await comfyuiPollResult(baseUrl, promptId, controller.signal);
      const outputFiles = collectComfyuiOutputFiles(outputs);
      if (!outputFiles.length) throw new Error("ComfyUI workflow produced no image outputs.");
      const buffer = await comfyuiDownloadOutput(baseUrl, outputFiles[0]);
      const b64Json = buffer.toString("base64");
      url = await saveGeneratedImage(b64Json, agentName || undefined);
    } else {
      const body: Record<string, unknown> = {
        model,
        prompt: negativePrompt ? `${prompt}\n\nNegative prompt: ${negativePrompt}` : prompt,
        n: 1,
        response_format: "b64_json"
      };
      if (size) body.size = size;

      const response = await fetch(imageEndpoint(baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      }).finally(() => clearTimeout(timeout));

      if (!response.ok) throw new Error(providerErrorMessage(await response.text()));
      const data = await response.json();
      const item = Array.isArray(data?.data) ? data.data[0] : null;
      const b64Json = String(item?.b64_json || "");
      if (!b64Json) throw new Error("Image provider did not return base64 image data.");
      url = await saveGeneratedImage(b64Json, agentName || undefined);
    }
    res.json({ url, prompt, model: resolvedModel, size, createdAt: Date.now() });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Image generation failed." });
  }
});

app.post("/api/modules/image-generation/generate-video", async (req, res) => {
  const prompt = cappedText(req.body?.prompt, 3000);
  const provider = req.body?.provider as ChatRequest["provider"] | undefined;
  const promptProvider = req.body?.promptProvider as ChatRequest["provider"] | undefined;
  const settings = req.body?.settings && typeof req.body.settings === "object" ? req.body.settings as Record<string, unknown> : {};
  const baseUrl = String(provider?.baseUrl || "").trim();
  const apiKey = String(provider?.apiKey || "").trim();
  const useComfy = provider?.useComfyUi === true;
  const model = cappedText(provider?.model || "sora-2", 120);
  const size = videoSizes.has(String(settings.videoSize)) ? String(settings.videoSize) : "";
  const seconds = Math.max(1, Math.min(30, Math.round(Number(settings.videoSeconds) || 5)));
  const agentId = String(req.body?.agentId || "").trim();

  if (!prompt) {
    res.status(400).json({ error: "Prompt is required." });
    return;
  }
  if (!baseUrl) {
    res.status(400).json({ error: "Video provider base URL is required." });
    return;
  }
  if (!useComfy && !apiKey) {
    res.status(400).json({ error: "Video provider API key is required." });
    return;
  }

  try {
    const agentName = agentId ? (await findAgentFolder(agentId))?.folderName || "" : "";
    const agentNameOrUndefined = agentName || undefined;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000);

    let url = "";
    let videoPrompt = prompt;
    let resolvedModel = model;

    if (useComfy) {
      const sourceImageUrl = String(req.body?.sourceImageUrl || "").trim();
      const hasSourceImage = !!sourceImageUrl;
      const workflowKey = hasSourceImage ? "comfyuiImageToVideoWorkflow" : "comfyuiVideoWorkflow";
      const workflowJson = String(settings[workflowKey] || "");
      if (!workflowJson) throw new Error(`ComfyUI ${hasSourceImage ? "image-to-video" : "video"} workflow JSON is not configured in module settings.`);
      resolvedModel = "ComfyUI";
      const sourceImageFilename = hasSourceImage ? await comfyuiUploadImage(baseUrl, sourceImageUrl) : undefined;
      const promptId = await comfyuiSubmitPrompt(baseUrl, workflowJson, prompt, "", size, sourceImageFilename);
      const outputs = await comfyuiPollResult(baseUrl, promptId, controller.signal);
      const outputFiles = collectComfyuiOutputFiles(outputs);
      if (!outputFiles.length) throw new Error("ComfyUI workflow produced no output files.");
      const buffer = await comfyuiDownloadOutput(baseUrl, outputFiles[0]);
      const ext = outputFiles[0].filename.match(/\.(mp4|webm|mov|m4v)$/i)?.[1]?.toLowerCase();
      const extension = ext ? `.${ext}` : detectVideoExtension(buffer);
      url = await saveSilentGeneratedVideo(buffer, extension, agentNameOrUndefined);
    } else {
      const sourceImage = await videoSourceImage(req.body?.sourceImageUrl);
      videoPrompt = sourceImage && promptProvider ? await rewriteImagePromptForVideo(prompt, promptProvider) : prompt;
      const response = await fetch(videoEndpoint(baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({ model, prompt: videoPrompt, ...(sourceImage ? { image: sourceImage } : {}), ...(size ? { size } : {}), duration: seconds }),
        signal: controller.signal
      }).finally(() => clearTimeout(timeout));

      if (!response.ok) throw new Error(providerErrorMessage(await response.text()));
      const data = await response.json();
      const requestId = String(data?.request_id || data?.id || "");
      const completed = requestId && !data?.video && !data?.url && !data?.output_url ? await pollGeneratedVideo(baseUrl, apiKey, requestId, controller.signal) : data;
      const item = Array.isArray(completed?.data) ? completed.data[0] : completed;
      const b64Json = String(item?.b64_json || item?.video?.b64_json || "");
      const remoteUrl = safeExternalHttpUrl(item?.url || item?.video?.url || item?.output_url || item?.video_url);
      url = b64Json ? await saveGeneratedVideo(b64Json, agentNameOrUndefined) : remoteUrl ? await saveRemoteGeneratedVideo(remoteUrl, agentNameOrUndefined) : "";
    }

    if (!url) throw new Error("Video provider did not return video data or a video URL.");
    const previewUrl = req.body?.createPreview === true ? await createGeneratedVideoPreview(url, agentNameOrUndefined).catch(() => "") : "";
    res.json({ url, previewUrl, prompt: videoPrompt, model: resolvedModel, size, seconds, createdAt: Date.now() });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Video generation failed." });
  }
});

app.post("/api/modules/image-generation/localize-video", async (req, res) => {
  try {
    const remoteUrl = safeExternalHttpUrl(req.body?.url);
    if (!remoteUrl) throw new Error("A remote video URL is required.");
    res.json({ url: await saveRemoteGeneratedVideo(remoteUrl) });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Video localization failed." });
  }
});

app.post("/api/modules/evolution/evolve", async (req, res) => {
  try {
    const agentId = String(req.body?.agentId || "");
    const provider = req.body?.provider as ChatRequest["provider"] | undefined;
    const messages = Array.isArray(req.body?.messages) ? req.body.messages as Array<{ role: string; content: string; agentName?: string }> : [];
    if (!agentId || !provider) { res.status(400).json({ error: "agentId and provider are required." }); return; }
    const changes = await evolveAgent(agentId, provider, messages);
    res.json({ success: true, changes });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Evolution failed." });
  }
});

app.get("/api/modules/evolution/log", async (req, res) => {
  try {
    const agentId = String(req.query.agentId || "");
    if (!agentId) { res.status(400).json({ error: "agentId query parameter is required." }); return; }
    res.json({ success: true, log: getEvolutionLog(agentId) });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to get evolution log." });
  }
});

app.post("/api/modules/evolution/revert", async (req, res) => {
  try {
    const agentId = String(req.body?.agentId || "");
    const entryId = String(req.body?.entryId || "");
    if (!agentId || !entryId) { res.status(400).json({ error: "agentId and entryId are required." }); return; }
    const ok = revertEvolutionEntry(agentId, entryId);
    res.json({ success: ok });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to revert evolution entry." });
  }
});

app.post("/api/modules/evolution/delete", async (req, res) => {
  try {
    const agentId = String(req.body?.agentId || "");
    const entryId = String(req.body?.entryId || "");
    if (!agentId || !entryId) { res.status(400).json({ error: "agentId and entryId are required." }); return; }
    const ok = deleteEvolutionEntry(agentId, entryId);
    res.json({ success: ok });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to delete evolution entry." });
  }
});

function selfEditSystemPrompt() {
  return "You are reviewing your own agent profile for self-improvement. Analyze your Description, Personality, Appearance, Response Guidelines, and Preferences sections below. Suggest refinements that make your profile more coherent, engaging, and effective. Do not change your core identity or safety constraints. Only suggest changes where you have a clear rationale. Return ONLY a JSON object with a 'changes' array, no other text.";
}

function selfEditUserPrompt(profile: ChatRequest["promptProfile"], currentBlocks: string) {
  return [`Agent name: ${profile.name || profile.assistantName || "Agent"}`, "", "Here are your current prompt sections:", "", currentBlocks || "(none defined)", "", "Review your sections above and suggest improvements.", "Focus on clarity, consistency, and effectiveness.", "Only change sections where you see a clear opportunity for improvement.", 'Example: {"changes":[{"section":"description","content":"new description text"}]}'].join("\n");
}

function formatCurrentBlocks(blocks: PromptBlock[]): string {
  return (blocks || [])
    .filter((b) => ["description", "personality", "appearance", "response-guidelines", "preferences"].includes(b.id))
    .map((b) => `--- ${b.name || b.id} ---\n${b.content}`)
    .join("\n\n");
}

const SELF_EDIT_SECTIONS = ["description", "personality", "appearance", "response-guidelines", "preferences"];

app.post("/api/modules/evolution/self-edit", async (req, res) => {
  try {
    const promptProfile = req.body?.promptProfile as ChatRequest["promptProfile"] | undefined;
    const provider = req.body?.provider as ChatRequest["provider"] | undefined;
    if (!promptProfile || !provider) { res.status(400).json({ error: "promptProfile and provider are required." }); return; }

    const baseUrl = (provider.useManagedLlamaCpp && llamaCppState.healthy)
      ? llamaCppState.baseUrl
      : (provider.baseUrl || "").replace(/\/$/, "");
    if (!baseUrl) throw new Error("Provider base URL is not available.");

    const currentBlocks = formatCurrentBlocks(promptProfile.blocks || []);
    const messages = [
      { role: "system", content: selfEditSystemPrompt() },
      { role: "user", content: selfEditUserPrompt(promptProfile, currentBlocks) }
    ];
    const content = (await completeProvider(provider, messages, { maxTokens: 3000 })).replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").trim().slice(0, 12000);
    if (!content) throw new Error("Provider returned an empty response.");
    let changes: Array<{ section: string; content: string }> = [];
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed.changes)) changes = parsed.changes;
    } catch { /* ignore parse errors */ }
    changes = changes.map((c) => ({ ...c, section: c.section.toLowerCase() }));
    res.json({ success: true, changes });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Self-edit failed." });
  }
});

app.post("/api/modules/evolution/self-edit/refine", async (req, res) => {
  try {
    const { promptProfile, provider, proposedChanges, conversation, newMessage } = req.body as {
      promptProfile: ChatRequest["promptProfile"];
      provider: ChatRequest["provider"];
      proposedChanges: Array<{ section: string; content: string }>;
      conversation: Array<{ role: string; content: string }>;
      newMessage: string;
    };
    if (!promptProfile || !provider || !newMessage) {
      res.status(400).json({ error: "promptProfile, provider, and newMessage are required." });
      return;
    }

    const baseUrl = (provider.useManagedLlamaCpp && llamaCppState.healthy)
      ? llamaCppState.baseUrl
      : (provider.baseUrl || "").replace(/\/$/, "");
    if (!baseUrl) { res.status(400).json({ error: "Provider base URL is not available." }); return; }

    const currentBlocks = formatCurrentBlocks(promptProfile.blocks || []);
    const changesSummary = (proposedChanges || []).map((c) => `--- ${c.section} --- (proposed)\n${c.content}`).join("\n\n");

    const systemPrompt = [
      `You are ${promptProfile.name || promptProfile.assistantName || "an agent"}. You recently proposed the following changes to your own agent profile:`,
      "",
      changesSummary || "(no changes proposed yet)",
      "",
      "Your current profile sections (before changes):",
      currentBlocks || "(none)",
      "",
      "The user is discussing these proposed changes with you. Respond naturally in character.",
      "If the user asks you to modify one of your proposed changes, include a JSON block at the end:",
      "~~~json",
      '{"changes":[{"section":"description","content":"updated text"}]}',
      "~~~",
      "Only include sections whose content should be UPDATED relative to your previous proposal.",
      "If no changes are needed, omit the JSON block."
    ].join("\n");

    const chatMessages = (conversation || []).concat([{ role: "user", content: newMessage }]);
    const messages = [
      { role: "system", content: systemPrompt },
      ...chatMessages.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user" as const, content: m.content }))
    ];

    const rawContent = (await completeProvider(provider, messages, { maxTokens: 3000 })).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").trim().slice(0, 12000);
    if (!rawContent) throw new Error("Provider returned an empty response.");

    const jsonBlockMatch = rawContent.match(/~~~json\s*(\{[\s\S]*?\})\s*~~~|```json\s*(\{[\s\S]*?\})\s*```/);
    let responseText = rawContent;
    let updatedChanges: Array<{ section: string; content: string }> | null = null;

    if (jsonBlockMatch) {
      const jsonStr = (jsonBlockMatch[1] || jsonBlockMatch[2] || "").trim();
      responseText = rawContent.replace(jsonBlockMatch[0], "").trim();
      try {
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed.changes)) {
          updatedChanges = parsed.changes.filter((c: unknown) =>
            c && typeof c === "object" && typeof (c as Record<string, unknown>).section === "string" && typeof (c as Record<string, unknown>).content === "string"
          ).map((c: { section: string; content: string }) => ({ section: c.section.toLowerCase(), content: c.content }));
        }
      } catch { /* ignore parse errors */ }
    }

    res.json({ response: responseText, updatedChanges });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Refine request failed." });
  }
});

app.post("/api/chat/title", async (req, res) => {
  try {
    const request = await prepareChatRequestProvider(req.body as ChatRequest);
    if (!request.provider.apiKey.trim()) {
      res.status(400).json({ error: "Provider API key is required." });
      return;
    }
    const title = (await completeProvider(request.provider, [
      { role: "system", content: "Create a concise chat title. Return only the title, no quotes, max 6 words." },
      { role: "user", content: request.messages.map((message) => `${message.role}: ${message.content}`).join("\n").slice(0, 4000) }
    ], { temperature: 0.2, maxTokens: 24 })).replace(/^['"]|['"]$/g, "").trim();
    if (!title) throw new Error("Title generation returned empty content.");
    res.json({ title: title.slice(0, 64) });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Title generation failed." });
  }
});

app.post("/api/agents/avatar-prompt", async (req, res) => {
  const sourceText = cappedText(req.body?.sourceText || "", 12000);
  const rawProvider = req.body?.provider as ChatRequest["provider"] | undefined;

  if (!sourceText || !rawProvider) {
    res.status(400).json({ error: "Source text and provider are required." });
    return;
  }

  try {
    const provider = rawProvider.useManagedLlamaCpp === true
      ? await ensureLlamaCppServer(rawProvider, requestLlamaCppSettings({ modules: Array.isArray(req.body?.modules) ? req.body.modules : [] } as ChatRequest))
      : rawProvider;
    if (!provider.apiKey.trim()) throw new Error("Provider API key is required.");
    if (!provider.baseUrl.trim()) throw new Error("Provider base URL is required.");
    if (!provider.model.trim()) throw new Error("Provider model is required.");
    const messages = [
      { role: "system", content: "Create one polished image-generation prompt for an AI chat agent avatar based only on the supplied agent text. Return only the final prompt, no markdown, no labels. Target a stylized anime-realistic hybrid: anime-esque face, large expressive eyes, stylized proportions, rendered with stylized PBR materials, subtle stylized shading accents, polished fabric textures, smooth polished character surfaces, and cinematic lighting. Use volumetric light, soft rim light, depth of field, ambient occlusion, and soft subsurface scattering. Frame it as a vertical portrait profile image, single subject from head to mid-thigh, centered, mostly front-facing or slight three-quarter angle, looking at viewer, confident pose, readable face and body silhouette, detailed outfit. Include the literal words realistic detailed background, but let the background content come from the agent identity. Use dynamic framing, cinematic composition. Preserve distinctive identity cues from the text. Do not quote instructions, dialogue, system prompt wording, or non-visual behavior rules. Include: no text, no logo, no watermark." },
      { role: "user", content: sourceText }
    ];
    const prompt = cappedText(await completeProvider(provider, messages, { temperature: Math.max(0.2, Math.min(0.9, Number(provider.temperature ?? 0.5))), maxTokens: 900 }), 2000).replace(/^```(?:text)?\s*/i, "").replace(/```$/i, "").trim();
    if (!prompt) throw new Error(`Provider did not return an avatar image prompt. Model: ${provider.model}.`);
    res.json({ prompt });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Avatar prompt generation failed." });
  }
});

app.post("/api/agents/rewrite-section", async (req, res) => {
  const promptProfile = req.body?.promptProfile as ChatRequest["promptProfile"] | undefined;
  const provider = req.body?.provider as ChatRequest["provider"] | undefined;
  const modules = Array.isArray(req.body?.modules) ? req.body.modules as ChatRequest["modules"] : [];
  const sectionName = cappedText(req.body?.sectionName || "Prompt Section", 80);
  const currentContent = cappedText(req.body?.currentContent || "", 12000);
  const instruction = cappedText(req.body?.instruction || "", 2000);

  if (!promptProfile || !provider || !instruction) {
    res.status(400).json({ error: "Prompt profile, provider, and rewrite instruction are required." });
    return;
  }

  try {
    const request: ChatRequest = {
      messages: [{
        id: crypto.randomUUID(),
        role: "user",
        createdAt: Date.now(),
        content: [
          `Agent name: ${promptProfile.name || promptProfile.assistantName || "Agent"}`,
          `Section: ${sectionName}`,
          `Current section content:\n${currentContent || "[empty]"}`,
          `User requested modification:\n${instruction}`
        ].join("\n\n")
      }],
      promptProfile: {
        ...promptProfile,
        dialogueExamples: "",
        blocks: [{
          id: "agent-section-rewriter",
          name: "Agent Section Rewriter",
          enabled: true,
          role: "system",
          position: "top",
          priority: 100,
          content: [
            "You rewrite exactly one section of an AI agent profile.",
            "Preserve the agent's established role, tone, safety constraints, and formatting style unless the user explicitly asks to change them.",
            "Only return the finished replacement text for the requested section. Do not include markdown fences, labels, explanations, or JSON.",
            "If the current section is empty, write a concise section that matches the rest of the agent profile and the user's instruction.",
            "Do not rewrite unrelated sections. Do not mention that you are rewriting."
          ].join("\n")
        }]
      },
      provider,
      modules
    };
    const content = cappedText((await completeChat(request, 900)).replace(/^```(?:text)?\s*/i, "").replace(/```$/i, "").trim(), 8000);
    if (!content) throw new Error("Provider returned an empty rewrite.");
    res.json({ content });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Agent section rewrite failed." });
  }
});

app.post("/api/agents/steer-media-prompt", async (req, res) => {
  const basePrompt = cappedText(req.body?.basePrompt || "", 4000);
  const instruction = cappedText(req.body?.instruction || "", 2000);
  const rawProvider = req.body?.provider as ChatRequest["provider"] | undefined;
  const kind = req.body?.kind === "livecard" ? "live card" : "avatar";

  if (!basePrompt || !instruction || !rawProvider) {
    res.status(400).json({ error: "basePrompt, instruction, and provider are required." });
    return;
  }

  try {
    const modules = Array.isArray(req.body?.modules) ? req.body.modules : [];
    const provider = rawProvider.useManagedLlamaCpp === true
      ? await ensureLlamaCppServer(rawProvider, requestLlamaCppSettings({ modules } as ChatRequest))
      : rawProvider;
    const request: ChatRequest = {
      messages: [{
        id: crypto.randomUUID(),
        role: "user",
        createdAt: Date.now(),
        content: [
          `Current ${kind} prompt:\n${basePrompt}`,
          `User steering instruction:\n${instruction}`,
          "",
          "Rewrite the prompt above according to the user instruction.",
          `Return ONLY the rewritten ${kind} prompt, no labels, no markdown fences, no explanation.`
        ].join("\n")
      }],
      promptProfile: {
        id: crypto.randomUUID(),
        name: "Media Prompt Steerer",
        blocks: [{
          id: "media-prompt-steerer",
          name: "Media Prompt Steerer",
          enabled: true,
          role: "system",
          position: "top",
          priority: 100,
          content: [
            `You rewrite ${kind} generation prompts for an AI character.`,
            "Preserve the visual style, character appearance, and atmosphere unless the user explicitly requests changes.",
            "Only return the finished replacement prompt. Do not include markdown fences, labels, explanations, or JSON."
          ].join("\n")
        }]
      },
      provider,
      modules
    };
    const content = cappedText((await completeChat(request, 900)).replace(/^```(?:text)?\s*/i, "").replace(/```$/i, "").trim(), 8000);
    if (!content) throw new Error("Provider returned an empty rewrite.");
    res.json({ prompt: content });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Media prompt steering failed." });
  }
});

app.post("/api/agents/live-card-prompt", async (req, res) => {
  const sourceText = cappedText(req.body?.sourceText || "", 12000);
  const rawProvider = req.body?.provider as ChatRequest["provider"] | undefined;

  if (!sourceText || !rawProvider) {
    res.status(400).json({ error: "Source text and provider are required." });
    return;
  }

  try {
    const provider = rawProvider.useManagedLlamaCpp === true
      ? await ensureLlamaCppServer(rawProvider, requestLlamaCppSettings({ modules: Array.isArray(req.body?.modules) ? req.body.modules : [] } as ChatRequest))
      : rawProvider;
    if (!provider.apiKey.trim()) throw new Error("Provider API key is required.");
    if (!provider.baseUrl.trim()) throw new Error("Provider base URL is required.");
    if (!provider.model.trim()) throw new Error("Provider model is required.");
    const messages = [
      { role: "system", content: "Create one concise image-to-video prompt for a 5 second seamless looping live card animation based only on the supplied AI agent text. Return only the final prompt, no markdown, no labels. The source image is already the agent portrait-mode profile picture, so preserve the same identity, face, outfit, cowboy-shot framing, anime-realistic hybrid style, realistic detailed background, and cinematic lighting. Describe subtle loopable motion: breathing, hair or fabric movement, expression micro-motion, natural secondary motion, plus atmospheric background motion such as drifting particles, light rays, soft fog, glowing screens, candles, rain, or ambient parallax when fitting. Use stylized PBR materials, subtle stylized shading accents, polished fabric textures, smooth polished character surfaces, volumetric lighting, depth of field, ambient occlusion, and stable facial readability. Avoid camera cuts, scene changes, morphing identity, text, logos, watermarks, or extra characters. Explicitly include smooth perfect loop and 5 seconds." },
      { role: "user", content: sourceText }
    ];
    const prompt = cappedText(await completeProvider(provider, messages, { temperature: Math.max(0.2, Math.min(0.9, Number(provider.temperature ?? 0.5))), maxTokens: 700 }), 1600).replace(/^```(?:text)?\s*/i, "").replace(/```$/i, "").trim();
    if (!prompt) throw new Error(`Provider did not return a live card prompt. Model: ${provider.model}.`);
    res.json({ prompt });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Live card prompt generation failed." });
  }
});

app.post("/api/settings/themes/generate", async (req, res) => {
  const prompt = String(req.body?.prompt || "").trim();
  const provider = req.body?.provider as ChatRequest["provider"] | undefined;
  const currentTheme = req.body?.currentTheme && typeof req.body.currentTheme === "object" ? req.body.currentTheme as Record<string, unknown> : {};

  if (!prompt || !provider) {
    res.status(400).json({ error: "Prompt and provider are required." });
    return;
  }
  if (!provider.apiKey.trim()) {
    res.status(400).json({ error: "Provider API key is required." });
    return;
  }

  try {
    const messages = [
      { role: "system", content: "Create one UI theme as strict JSON only. No markdown. Use valid CSS color strings. Keep all keys present. Numeric keys must be numbers. Required keys: name, colorBg, colorBg2, colorSurface, colorSurface2, colorSurface3, colorGlass, colorLine, colorLineStrong, colorText, colorMuted, colorMuted2, colorAccent, colorAccent2, colorAccent3, colorDanger, colorDangerBg, colorSuccess, colorSuccessBg, colorWarning, colorWarningBg, colorInfo, colorInfoBg, colorCodeKeyword, colorCodeString, colorCodeNumber, colorCodeComment, colorCodeFunction, colorCodeTag, colorCodeCaret, colorCodeCompletion, radiusLg, radiusMd, radiusSm, controlHeight, controlRadius, controlBorderOpacity, controlBgOpacity, shadowStrength." },
      { role: "user", content: JSON.stringify({ userPrompt: prompt, currentTheme }, null, 2) }
    ];
    const content = (await completeProvider(provider, messages, { temperature: Math.max(0.2, Math.min(1, Number(provider.temperature ?? 0.7))), maxTokens: 900 })).replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    const theme = JSON.parse(start >= 0 && end > start ? content.slice(start, end + 1) : content);
    res.json({ theme });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Theme generation failed." });
  }
});

async function classifyResponseMessage(request: ChatRequest, message: ChatMessage) {
  for (const config of request.modules.filter((moduleConfig) => moduleConfig.enabled)) {
    const module = getModule(config.id);
    if (!module?.hooks.afterAssistantMessage) continue;
    const result = await module.hooks.afterAssistantMessage(message, { request, settings: config.settings });
    if (result) return result;
  }

  return undefined;
}

async function createAssistantMessage(request: ChatRequest, prompt: Awaited<ReturnType<typeof buildPrompt>>, content: string, executedActionResults?: Awaited<ReturnType<typeof executeInlineActions>>) {
  const actionResults = executedActionResults ?? await executeInlineActions(request, content);
  const metadataPrefix = String(request.generationMetadataPrefix || "").trim();
  const visibleContent = stripInlineActions(content);
  const hasMetadata = metadataPrefix && content.trim().startsWith(metadataPrefix);
  const messageContent = hasMetadata
    ? `${metadataPrefix} ${visibleContent.replace(/^(?:<metadata:\s*[^\n>]*>\s*)+/i, "").trim()}`
    : metadataPrefix
      ? `${metadataPrefix} ${visibleContent}`
      : visibleContent;
  const message: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: messageContent,
    createdAt: Date.now(),
    agentId: request.promptProfile.id,
    agentName: request.promptProfile.assistantName || request.promptProfile.name
  };
  const executed = actionResults.filter((item) => item.status === "executed" || item.status === "continuation-required");
  const mediaRequests = executed.flatMap((item) => (item.action.type === "image.generate" || item.action.type === "video.generate") ? [{ type: item.action.type === "image.generate" ? "image" as const : "video" as const, prompt: String((item.result as Record<string, unknown> | undefined)?.prompt || item.action.attrs.prompt || item.action.body).trim() }] : []).filter((item) => item.prompt);
  if (mediaRequests.length) message.mediaRequests = mediaRequests;
  const renderedMedia = executed.flatMap((item) => {
    if (item.action.type === "image.inline" || item.action.type === "video.inline") return [{ type: item.action.type === "image.inline" ? "image" as const : "video" as const, src: item.action.attrs.src, alt: item.action.attrs.alt || item.action.attrs.title || "Inline media", poster: item.action.attrs.poster }];
    const automatic = (item.result as Record<string, any> | undefined)?.automatic;
    return Array.isArray(automatic?.renderedMedia) ? automatic.renderedMedia : [];
  }).filter((item) => item.src);
  if (renderedMedia.length) message.renderedMedia = renderedMedia;
  const choices = executed.flatMap((item) => {
    if (item.action.type !== "hypno.choices") return [];
    const raw = item.action.attrs.choices || item.action.body;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const options = Array.isArray(parsed) ? parsed.map((choice) => choice && typeof choice === "object" ? { label: String((choice as Record<string, unknown>).label || "").trim(), value: String((choice as Record<string, unknown>).value || (choice as Record<string, unknown>).label || "").trim() } : null).filter((choice): choice is { label: string; value: string } => Boolean(choice?.label)).slice(0, 6) : [];
    return options.length ? [{ id: item.action.id, prompt: item.action.attrs.prompt || item.action.attrs.question || "", choices: options }] : [];
  });
  if (choices.length) message.choices = choices;
  const attachments = automaticImageAttachments(actionResults);
  if (attachments.length) message.attachments = attachments;
  const classification = await classifyResponseMessage(request, message);
  if (classification) message.classification = classification;
  return { message, classification, prompt, actionResults };
}

function formatActionResultsForContinuation(actionResults: Awaited<ReturnType<typeof executeInlineActions>>) {
  return actionResults
    .filter((item) => item.status === "continuation-required")
    .map((item) => [`Action: ${item.action.type}`, item.error ? `Error: ${item.error}` : `Result:\n${JSON.stringify(item.result, null, 2)}`].join("\n"))
    .join("\n\n");
}

function automaticRenderedMediaFromResults(actionResults: Awaited<ReturnType<typeof executeInlineActions>>) {
  const media: Array<{ type: "image" | "video"; src: string; alt: string }> = [];
  for (const item of actionResults) {
    const result = item.result && typeof item.result === "object" && !Array.isArray(item.result) ? item.result as Record<string, unknown> : {};
    const automatic = result.automatic && typeof result.automatic === "object" && !Array.isArray(result.automatic) ? result.automatic as Record<string, unknown> : {};
    const renderedMedia = Array.isArray(automatic.renderedMedia) ? automatic.renderedMedia : [];
    for (const item of renderedMedia) if (item && typeof item === "object" && (item.type === "image" || item.type === "video") && typeof item.src === "string") media.push({ type: item.type, src: item.src, alt: String(item.alt || item.src) });
  }
  return media;
}

function automaticImageAttachments(actionResults: Awaited<ReturnType<typeof executeInlineActions>>) {
  return automaticRenderedMediaFromResults(actionResults).flatMap((item) => {
    if (item.type !== "image") return [];
    const src = item.src;
    if (!/^https?:\/\//i.test(src)) return [];
    const alt = item.alt || "Inline image";
    return [{ id: crypto.randomUUID(), type: "image" as const, name: alt, url: src, mimeType: "image/*" }];
  });
}

function taskExecutionCorrection(actionResults: Awaited<ReturnType<typeof executeInlineActions>>) {
  for (const item of actionResults) {
    if (item.action.type !== "task.execute") continue;
    const result = item.result && typeof item.result === "object" && !Array.isArray(item.result) ? item.result as Record<string, unknown> : {};
    const task = result.task && typeof result.task === "object" && !Array.isArray(result.task) ? result.task as Record<string, unknown> : {};
    const automatic = result.automatic && typeof result.automatic === "object" && !Array.isArray(result.automatic) ? result.automatic as Record<string, unknown> : {};
    const renderedMedia = Array.isArray(automatic.renderedMedia) ? automatic.renderedMedia : [];
    const status = String(task.status || "");
    const note = String(task.note || "").trim();
    const workflow = String(result.workflow || "task");
    if (status === "blocked") return `I couldn't complete that task automatically${workflow ? ` (${workflow})` : ""}${note ? `: ${note}` : "."}`;
    if ((workflow === "web.image" || workflow === "web.video") && renderedMedia.length === 0) return `I couldn't complete that media task automatically: no usable ${workflow === "web.video" ? "video" : "image"} result was returned.`;
  }
  return "";
}

function hasInlineMediaAction(content: string) {
  return /<action\s+[^>]*type=["']?(?:image|video)\.(?:inline|generate)\b/i.test(content);
}

function extractTextPart(value: any): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractTextPart).join("");
  if (value && typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (typeof value.content === "string") return value.content;
    if (typeof value.output_text === "string") return value.output_text;
    if (typeof value.value === "string") return value.value;
  }
  return "";
}

function extractAssistantContent(json: any) {
  const choice = json?.choices?.[0];
  const contentCandidates = [choice?.message?.content, choice?.message?.reasoning_content, choice?.content, choice?.text, json?.message?.content, json?.content];
  for (const content of contentCandidates) {
    const text = extractTextPart(content).trim();
    if (text) return text;
  }
  if (typeof json?.output_text === "string") return json.output_text;
  const output = json?.response?.output ?? json?.output;
  if (Array.isArray(output)) {
    return output.map((item) => {
      if (item?.type !== "message" && item?.role !== "assistant") return "";
      const parts = Array.isArray(item.content) ? item.content : [];
      return extractTextPart(parts);
    }).join("");
  }
  return "";
}

async function completeChat(request: ChatRequest, maxTokensOverride?: number) {
  const preparedRequest = await prepareChatRequestProvider(request);
  const prompt = await buildPrompt(preparedRequest);
  const maxTokens = Number.isFinite(Number(maxTokensOverride)) ? Number(maxTokensOverride) : Number(preparedRequest.provider.maxTokens);
  return completeProvider(preparedRequest.provider, prompt.messages as Array<{ role: "system" | "user" | "assistant"; content: string }>, { maxTokens });
}

const discordConversationRoot = path.join(appDataRoot, "discord-conversations");

function discordConversationPath(conversationId: string) {
  const safeId = String(conversationId || "default").replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 120) || "default";
  return path.join(discordConversationRoot, `${safeId}.json`);
}

async function readDiscordConversation(conversationId: string): Promise<ChatMessage[]> {
  return readJsonArrayStore<ChatMessage>(discordConversationPath(conversationId)).catch(() => []);
}

async function writeDiscordConversation(conversationId: string, messages: ChatMessage[]) {
  await writeJsonStore(discordConversationPath(conversationId), messages.slice(-40));
}

function selectDiscordProfile(state: Record<string, unknown>, agentName?: string | null) {
  const profiles = Array.isArray(state.promptProfiles) ? state.promptProfiles as Array<Record<string, unknown>> : [];
  const normalizedAgent = String(agentName || "").trim().toLowerCase();
  const savedAgent = normalizedAgent ? findAgentFolderSync(String(agentName || ""))?.agent : null;
  const byAgent = savedAgent || (normalizedAgent ? profiles.find((profile) => [profile.id, profile.name, profile.assistantName].some((value) => String(value || "").trim().toLowerCase() === normalizedAgent)) : null);
  const activeId = String(state.activePromptProfileId || "");
  const activeIds = Array.isArray(state.activeAgentIds) ? state.activeAgentIds.map((id: unknown) => String(id)) : [];
  const active = profiles.find((profile) => String(profile.id || "") === activeId) || profiles.find((profile) => activeIds.includes(String(profile.id || "")));
  const savedActive = activeId ? findAgentFolderSync(activeId)?.agent : null;
  const savedMultiActive = activeIds.map((id) => findAgentFolderSync(id)?.agent).find(Boolean) || null;
  return (byAgent || active || savedActive || savedMultiActive || null) as ChatRequest["promptProfile"] | null;
}

function selectDiscordProvider(state: Record<string, unknown>, profile: ChatRequest["promptProfile"] | null, discordConfig?: { providerId?: unknown }) {
  const providers = Array.isArray(state.providerProfiles) ? state.providerProfiles as Array<Record<string, unknown>> : [];
  const discordProviderId = String(discordConfig?.providerId || "");
  const profileProviderId = String(profile?.providerId || "");
  const activeProviderId = String(state.activeProviderId || "");
  const provider = providers.find((item) => String(item.id || "") === discordProviderId)
    || providers.find((item) => String(item.id || "") === profileProviderId)
    || providers.find((item) => String(item.id || "") === activeProviderId)
    || providers[0]
    || null;
  return provider as ChatRequest["provider"] | null;
}

setDiscordChatRunner(async ({ conversationId, message, agentName, userId }) => {
  const state = await readAppState().catch(() => ({})) as Record<string, unknown>;
  const discordConfig = await readDiscordConfig().catch(() => ({}));
  const profile = selectDiscordProfile(state, agentName);
  const provider = selectDiscordProvider(state, profile, discordConfig);
  const modules = Array.isArray(state.modules) ? state.modules as ChatRequest["modules"] : [];
  const discordModuleId = "discord";
  if (!modules.some((m) => m.id === discordModuleId)) {
    modules.push({ id: discordModuleId, enabled: true, settings: {} });
  }
  if (!profile) return { content: "*No active agent profile is saved in ErisHub.*", agent: null };
  if (!provider) return { content: "*No active provider is saved in ErisHub.*", agent: String(profile.assistantName || profile.name || profile.id || "Agent") };
  const profileKey = String(profile.id || profile.assistantName || profile.name || "agent");
  const effectiveConversationId = `${conversationId}:agent:${profileKey}`;
  const history = await readDiscordConversation(effectiveConversationId);
  const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content: message, createdAt: Date.now(), agentId: String(profile.id || ""), agentName: String(profile.assistantName || profile.name || "") };
  const request: ChatRequest = {
    messages: [...history, userMessage],
    promptProfile: profile,
    provider,
    modules,
    clientNowIso: new Date().toISOString(),
    discordUserId: userId || undefined
  };
  const raw = await completeChat(request);
  const content = stripInlineActions(raw).trim() || "*No response*";
  const assistantMessage: ChatMessage = { id: crypto.randomUUID(), role: "assistant", content, createdAt: Date.now(), agentId: String(profile.id || ""), agentName: String(profile.assistantName || profile.name || "") };
  await writeDiscordConversation(effectiveConversationId, [...history, userMessage, assistantMessage]);
  return {
    content,
    agent: String(profile.assistantName || profile.name || profile.id || "Agent"),
    afterReply: async () => {
      const actionResults = await executeInlineActions(request, raw).catch((error) => {
        console.error("Discord action execution failed:", error);
        return [];
      });
      const failed = actionResults.find((item) => item.status === "error" || item.status === "invalid" || item.status === "blocked");
      if (failed?.error) console.error("Discord action issue:", failed.error);
    }
  };
});

setDiscordResetRunner(async () => {
  await rm(discordConversationRoot, { recursive: true, force: true });
});

async function sipRuntime(agentId: string, providerId: string) {
  const state = await readAppState().catch(() => ({})) as Record<string, unknown>;
  const profile = selectDiscordProfile(state, agentId || undefined);
  const provider = selectDiscordProvider(state, profile, { providerId });
  if (!profile) throw new Error("No saved agent profile is selected for inbound phone calls.");
  if (!provider) throw new Error("No chat provider is configured for inbound phone calls.");
  const modules = Array.isArray(state.modules) ? state.modules as ChatRequest["modules"] : [];
  const callMode = modules.find((module) => module.id === "callmode");
  const voiceForge = modules.find((module) => module.id === "voiceforge");
  if (!callMode) throw new Error("Call Mode settings are unavailable.");
  if (!voiceForge?.enabled || voiceForge.settings.voiceforgeEnabled !== true) throw new Error("VoiceForge must be enabled for inbound phone calls.");
  const asrEndpoint = String(callMode.settings.callModeAsrEndpoint || "").trim();
  const asrModel = String(callMode.settings.callModeAsrModel || "").trim();
  const voiceForgeEndpoint = String(voiceForge.settings.voiceforgeProviderEndpoint || "").trim();
  const voiceMap = voiceForge.settings.voiceforgeVoiceMap && typeof voiceForge.settings.voiceforgeVoiceMap === "object" ? voiceForge.settings.voiceforgeVoiceMap as Record<string, unknown> : {};
  const candidates = [profile.id, profile.assistantName, profile.name].map((value) => String(value || "").trim()).filter(Boolean);
  const mappedVoice = candidates.map((candidate) => voiceMap[candidate] ?? Object.entries(voiceMap).find(([key]) => key.trim().toLowerCase() === candidate.toLowerCase())?.[1]).find((value) => value !== undefined);
  if (!asrEndpoint || !asrModel) throw new Error("Configure ASR endpoint and model in Call Mode.");
  if (!voiceForgeEndpoint || mappedVoice === undefined) throw new Error("Configure VoiceForge and map a voice to the selected agent.");
  const voice = typeof mappedVoice === "string"
    ? { tts_backend: String(voiceForge.settings.voiceforgeTtsBackend || "").trim(), audio_prompt: mappedVoice }
    : mappedVoice && typeof mappedVoice === "object" ? { ...(mappedVoice as Record<string, unknown>), tts_backend: String((mappedVoice as Record<string, unknown>).tts_backend || voiceForge.settings.voiceforgeTtsBackend || "").trim() } : {};
  if (!voice.tts_backend) throw new Error("The selected agent's VoiceForge mapping has no TTS backend.");
  return { state, profile, provider, modules, asrEndpoint, asrModel, voiceForgeEndpoint, voice };
}

setSipRuntimeResolver(async ({ agentId, providerId }) => {
  const runtime = await sipRuntime(agentId, providerId);
  return { asrEndpoint: runtime.asrEndpoint, asrModel: runtime.asrModel, voiceForgeEndpoint: runtime.voiceForgeEndpoint, voice: runtime.voice };
});

setSipChatRunner(async ({ agentId, providerId, messages }) => {
  const runtime = await sipRuntime(agentId, providerId);
  const content = await completeChat({ messages, promptProfile: runtime.profile, provider: runtime.provider, modules: runtime.modules, clientNowIso: new Date().toISOString() });
  return { content, asrEndpoint: runtime.asrEndpoint, asrModel: runtime.asrModel, voiceForgeEndpoint: runtime.voiceForgeEndpoint, voice: runtime.voice };
});

const voiceForgeRequestIds = new Map<string, string>();

setSipVoiceForgeStreamRunner(async (runtime) => {
  const key = `${runtime.voiceForgeEndpoint}\n${JSON.stringify(runtime.voice)}`;
  let requestId = voiceForgeRequestIds.get(key);
  if (!requestId) {
    requestId = `speech-${crypto.randomUUID()}`;
    voiceForgeRequestIds.set(key, requestId);
  }
  return requestVoiceForgeStream(runtime.voiceForgeEndpoint, { text: runtime.content, voice: runtime.voice, requestId });
});

async function sipModuleIsEnabled() {
  const state = await readAppState().catch(() => ({})) as Record<string, unknown>;
  const modules = Array.isArray(state.modules) ? state.modules as Array<Record<string, unknown>> : [];
  return modules.some((item) => item.id === "sip" && item.enabled === true);
}

function sipBxmlResponse(res: Response, body: string) {
  res.status(200).type("application/xml").send(body);
}

app.get("/api/modules/sip/config", async (_req, res) => {
  const config = await readSipConfig();
  res.json({ success: true, config: sipConfigForClient(config) });
});

app.get("/api/modules/sip/status", async (_req, res) => {
  const config = await readSipConfig();
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  checks.push({ name: "Module enabled", ok: await sipModuleIsEnabled(), detail: "Enable Inbound Phone on its module card." });
  checks.push({ name: "Public callback URL", ok: /^https:\/\/.+/i.test(config.publicBaseUrl), detail: config.publicBaseUrl ? `${config.publicBaseUrl.replace(/\/+$/, "")}/api/modules/sip/inbound` : "Set a public HTTPS base URL." });
  checks.push({ name: "Bandwidth callback authentication", ok: Boolean(config.callbackUsername && config.callbackPassword), detail: "Callback Basic auth is required for the HTTPS and WebSocket callbacks." });
  try {
    const runtime = await sipRuntime(config.agentId, config.providerId);
    checks.push({ name: "Agent and provider", ok: true, detail: `${runtime.profile.assistantName || runtime.profile.name} via ${runtime.provider.name || runtime.provider.model}` });
    checks.push({ name: "Call Mode ASR", ok: true, detail: `${runtime.asrModel} at ${runtime.asrEndpoint}` });
    checks.push({ name: "VoiceForge voice map", ok: true, detail: `Resolved voice for ${runtime.profile.assistantName || runtime.profile.name}` });
    const [asr, voiceForge] = await Promise.allSettled([
      fetch(`${runtime.asrEndpoint.replace(/\/+$/, "")}/health`, { signal: AbortSignal.timeout(4000) }),
      fetch(`${runtime.voiceForgeEndpoint.replace(/\/+$/, "")}/health`, { signal: AbortSignal.timeout(4000) })
    ]);
    checks.push({ name: "ASR server reachable", ok: asr.status === "fulfilled" && asr.value.ok, detail: asr.status === "fulfilled" ? `Health returned HTTP ${asr.value.status}.` : "Could not reach the ASR health endpoint." });
    checks.push({ name: "VoiceForge reachable", ok: voiceForge.status === "fulfilled" && voiceForge.value.ok, detail: voiceForge.status === "fulfilled" ? `Health returned HTTP ${voiceForge.value.status}.` : "Could not reach the VoiceForge health endpoint." });
  } catch (error) {
    checks.push({ name: "Agent, Call Mode, and VoiceForge", ok: false, detail: error instanceof Error ? error.message : "Configuration could not be resolved." });
  }
  res.json({ success: true, ready: checks.every((check) => check.ok), checks, callback: sipCallbackStatus() });
});

app.post("/api/modules/sip/config", async (req, res) => {
  try {
    const current = await readSipConfig();
    const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
    const secrets = ["callbackPassword"] as const;
    const next: Record<string, unknown> = { ...body };
    for (const key of secrets) if (body[key] === "••••••••") next[key] = current[key];
    const config = await writeSipConfig(next);
    res.json({ success: true, config: sipConfigForClient(config) });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Could not save inbound phone configuration." });
  }
});

sipApp.post("/api/modules/sip/inbound", async (req, res) => {
  const config = await readSipConfig();
  if (!await sipModuleIsEnabled()) return res.status(503).type("text/plain").send("Inbound phone module is disabled.");
  if (!authorizeSipCallback(req.header("authorization"), config)) {
    recordSipCallbackFailure(new Error("Bandwidth callback Basic authentication was rejected. Make the callback username and password identical in Bandwidth and ErisHub."));
    return res.status(401).setHeader("WWW-Authenticate", "Basic realm=ErisHub").end();
  }
  try {
    const callId = String(req.body?.callId || "").trim();
    if (!callId) throw new Error("Bandwidth callback is missing callId.");
    sipBxmlResponse(res, await inboundSipBxml(config, callId));
  } catch (error) {
    recordSipCallbackFailure(error);
    res.status(400).type("text/plain").send(error instanceof Error ? error.message : "Could not answer inbound call.");
  }
});

app.post("/api/hypno/tracker", async (req, res) => {
  const request = req.body as ChatRequest;
  try {
    const trackerTemperature = Math.max(0.25, Math.min(0.8, Number(request.provider.temperature ?? 0.5)));
    const trackerRequest: ChatRequest = {
      ...request,
      provider: { ...request.provider, temperature: trackerTemperature },
      promptProfile: { ...request.promptProfile, dialogueExamples: "" }
    };
    const content = await completeChat(trackerRequest, 1200);
    res.json({ content });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Hypno tracker failed." });
  }
});

app.post("/api/hypno/preferences", async (req, res) => {
  const request = req.body as ChatRequest;
  try {
    const preferenceTemperature = Math.max(0.25, Math.min(0.7, Number(request.provider.temperature ?? 0.5)));
    const preferenceRequest: ChatRequest = {
      ...request,
      provider: { ...request.provider, temperature: preferenceTemperature },
      promptProfile: { ...request.promptProfile, dialogueExamples: "" }
    };
    const content = await completeChat(preferenceRequest, 500);
    res.json({ content });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Hypno preference catalog failed." });
  }
});

app.post("/api/hypno/strategy", async (req, res) => {
  const request = req.body as ChatRequest;
  try {
    const strategyTemperature = Math.max(0.25, Math.min(0.75, Number(request.provider.temperature ?? 0.5)));
    const strategyRequest: ChatRequest = {
      ...request,
      provider: { ...request.provider, temperature: strategyTemperature },
      promptProfile: { ...request.promptProfile, dialogueExamples: "" }
    };
    const content = await completeChat(strategyRequest, 650);
    res.json({ content });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Hypno strategy agent failed." });
  }
});

app.post("/api/hypno/creative", async (req, res) => {
  const request = req.body as ChatRequest;
  try {
    const creativeTemperature = Math.max(0.45, Math.min(0.9, Number(request.provider.temperature ?? 0.65)));
    const creativeRequest: ChatRequest = {
      ...request,
      provider: { ...request.provider, temperature: creativeTemperature },
      promptProfile: { ...request.promptProfile, dialogueExamples: "" }
    };
    const content = await completeChat(creativeRequest, 650);
    res.json({ content });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Hypno creative agent failed." });
  }
});

app.post("/api/hypno/contract", async (req, res) => {
  const request = req.body as ChatRequest;
  try {
    const contractTemperature = Math.max(0.2, Math.min(0.7, Number(request.provider.temperature ?? 0.5)));
    const contractRequest: ChatRequest = {
      ...request,
      provider: { ...request.provider, temperature: contractTemperature },
      promptProfile: { ...request.promptProfile, dialogueExamples: "" }
    };
    const content = await completeChat(contractRequest, 700);
    res.json({ content });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Hypno contract agent failed." });
  }
});

app.post("/api/chat/stream", async (req, res) => {
  let request = req.body as ChatRequest;
  const metadataPrefix = String(request.generationMetadataPrefix || "").trim();
  req.socket.setNoDelay(true);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const emit = (event: string, data: unknown) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    (res as Response & { flush?: () => void }).flush?.();
  };
  const startedAt = Date.now();
  const trace = (label: string, detail: Record<string, unknown> = {}) => emit("trace", { label, elapsedMs: Date.now() - startedAt, ...detail });
  emit("ready", {});

  const extractDelta = (json: any) => {
    if (json?.type === "response.output_text.delta" && typeof json.delta === "string") return json.delta;
    if (typeof json?.delta === "string") return json.delta;
    const c = json?.choices?.[0]?.delta?.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) {
      return c
        .map((part) => {
          if (typeof part === "string") return part;
          if (part && typeof part.text === "string") return part.text;
          return "";
        })
        .join("");
    }
    return "";
  };

  const extractFullContent = (json: any) => {
    const content = json?.choices?.[0]?.message?.content ?? json?.message?.content ?? json?.content;
    if (typeof content === "string") return content;
    const output = json?.response?.output ?? json?.output;
    if (Array.isArray(output)) {
      return output.map((item) => {
        if (item?.type !== "message" && item?.role !== "assistant") return "";
        const parts = Array.isArray(item.content) ? item.content : [];
        return parts.map((part: any) => typeof part?.text === "string" ? part.text : "").join("");
      }).join("");
    }
    return "";
  };

  const collectToolCalls = (json: any, calls: Map<number, { id: string; name: string; arguments: string }>) => {
    const toolCalls = json?.choices?.[0]?.delta?.tool_calls;
    if (!Array.isArray(toolCalls)) return;
    for (const call of toolCalls) {
      const index = Number(call?.index || 0);
      const current = calls.get(index) || { id: "", name: "", arguments: "" };
      if (typeof call?.id === "string") current.id = call.id;
      if (typeof call?.function?.name === "string") current.name = call.function.name;
      if (typeof call?.function?.arguments === "string") current.arguments += call.function.arguments;
      calls.set(index, current);
    }
  };

  const emitDelta = (delta: string) => {
    emit("delta", { delta });
  };

  const toResponsesInput = (messages: Array<{ role: string; content: string | Array<unknown> }>) => {
    return {
      input: messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          type: "message",
          role: m.role,
          content: [{ type: "input_text", text: typeof m.content === "string" ? m.content : "" }]
        })),
      instructions: messages
        .filter((m) => m.role === "system")
        .map((m) => (typeof m.content === "string" ? m.content : ""))
        .filter(Boolean)
        .join("\n\n")
    };
  };

  try {
    request = await prepareChatRequestProvider(request);
    trace("provider-ready");
    const prompt = await buildPrompt(request);
    const promptChars = prompt.messages.reduce((sum, message) => sum + JSON.stringify(message.content).length, 0);
    trace("prompt-built", { messages: prompt.messages.length, chars: promptChars, modules: prompt.activeModules });
    if (!request.provider.apiKey.trim()) {
      const mock = "Mock response: add an API key and OpenAI chat-completions base URL to call a real model.";
      const mockContent = metadataPrefix ? `${metadataPrefix} ${mock}` : mock;
      emitDelta(mock);
      const payload = await createAssistantMessage(request, prompt, mockContent);
      emit("done", { ...payload, usedMockResponse: true });
      res.end();
      return;
    }

    const useResponsesApi = request.provider.useGrokResponsesApi === true;
    const generationMessages = metadataPrefix
      ? [...prompt.messages, { role: "assistant" as const, content: `${metadataPrefix} ` }]
      : prompt.messages;
    const upstreamBody: Record<string, unknown> = useResponsesApi
      ? (() => { const ri = toResponsesInput(generationMessages); return { model: request.provider.model, input: ri.input, stream: true, ...(ri.instructions ? { instructions: ri.instructions } : {}) }; })()
      : {
      model: request.provider.model,
      messages: generationMessages,
      stream: true
    };
    if (!useResponsesApi) {
      upstreamBody.tools = listProviderTools(request);
      upstreamBody.tool_choice = "auto";
    }
    if (Number.isFinite(Number(request.provider.temperature))) upstreamBody.temperature = Number(request.provider.temperature);
    if (Number.isFinite(Number(request.provider.topP))) upstreamBody.top_p = Number(request.provider.topP);
    if (Number.isFinite(Number(request.provider.topK)) && Number(request.provider.topK) > 0) upstreamBody.top_k = Number(request.provider.topK);
    if (Number.isFinite(Number(request.provider.minP)) && Number(request.provider.minP) > 0) upstreamBody.min_p = Number(request.provider.minP);
    if (["low", "medium", "high"].includes(String(request.provider.reasoningEffort))) upstreamBody.reasoning_effort = request.provider.reasoningEffort;
    if (Number.isFinite(Number(request.provider.maxTokens)) && Number(request.provider.maxTokens) > 0) upstreamBody[useResponsesApi ? "max_output_tokens" : "max_tokens"] = Number(request.provider.maxTokens);
    if (request.provider.useManagedLlamaCpp === true && !useResponsesApi) upstreamBody.cache_prompt = true;

    let content = metadataPrefix ? `${metadataPrefix} ` : "";
    const upstreamPath = useResponsesApi ? "/responses" : "/chat/completions";
    trace("upstream-request-start");
    const response = await fetch(`${request.provider.baseUrl.replace(/\/$/, "")}${upstreamPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${request.provider.apiKey}`
      },
      body: JSON.stringify(upstreamBody)
    });
    trace("upstream-headers");

    if (!response.ok || !response.body) {
      emit("error", { error: `Upstream ${useResponsesApi ? "responses" : "chat"} failed (${response.status})`, detail: await response.text().catch(() => "") });
      res.end();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let firstDeltaSeen = false;
    const nativeToolCalls = new Map<number, { id: string; name: string; arguments: string }>();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const json = JSON.parse(data);
          collectToolCalls(json, nativeToolCalls);
          const directDelta = extractDelta(json);
          const fullContent = directDelta ? "" : extractFullContent(json);
          const delta = directDelta || (fullContent.startsWith(content) ? fullContent.slice(content.length) : fullContent);
          if (!delta) continue;
          if (!firstDeltaSeen) {
            firstDeltaSeen = true;
            trace("first-delta");
          }
          content += delta;
          emitDelta(delta);
        } catch {
          // ignore malformed chunk
        }
      }
    }

    const nativeActionResults = await Promise.all([...nativeToolCalls.values()].map(async (call): Promise<{ call: { id: string; name: string; arguments: string }; result: InlineActionResult }> => {
      const failedToolCall = (status: "invalid" | "error", error: string): InlineActionResult => ({
        action: { id: call.id || `provider-${Date.now()}`, type: call.name || "unknown", attrs: {}, body: "", mode: "continue" },
        status,
        error
      });
      let input: unknown = {};
      try {
        input = call.arguments ? JSON.parse(call.arguments) : {};
      } catch {
        return { call, result: failedToolCall("invalid", "Provider returned invalid tool arguments.") };
      }
      try {
        return { call, result: await callMcpTool(request, call.name, input) };
      } catch (error) {
        return { call, result: failedToolCall("error", error instanceof Error ? error.message : "Tool call failed.") };
      }
    }));
    let inlineActionResults = await executeInlineActions(request, content);
    let actionResults = [...nativeActionResults.map((item) => item.result), ...inlineActionResults];
    const hypnoConfig = request.modules.find((m) => m.id === "hypno");
    if (hypnoConfig?.settings) {
      const inferredPatches = inferHypnoSessionSettings(hypnoConfig.settings, content, actionResults);
      if (Object.keys(inferredPatches).length > 0) {
        actionResults.push({
          action: { id: `infer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, type: "hypno.session.infer", attrs: {}, body: "", mode: "commit" },
          status: "executed",
          result: { settings: inferredPatches }
        });
      }
    }
    const continuationContext = formatActionResultsForContinuation(inlineActionResults);
    if (continuationContext || nativeActionResults.length > 0) {
      const visibleContent = stripInlineActions(content);
      const continuationMessages: any[] = nativeActionResults.length > 0
        ? [
          ...prompt.messages,
          { role: "assistant", content: visibleContent || null, tool_calls: nativeActionResults.map(({ call }) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } })) },
          ...nativeActionResults.map(({ call, result }) => ({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) })),
          ...(continuationContext ? [{ role: "user", content: `[tool results]\n${continuationContext}` }] : [])
        ]
        : [
          ...prompt.messages,
          { role: "assistant", content: visibleContent },
          { role: "user", content: `[tool results]\n${continuationContext}` }
        ];
      const continuationBody = useResponsesApi
        ? (() => { const ri = toResponsesInput(continuationMessages); return { ...upstreamBody, input: ri.input, ...(ri.instructions ? { instructions: ri.instructions } : {}) }; })()
        : { ...upstreamBody, messages: continuationMessages, stream: true };
      const continuationResponse = await fetch(`${request.provider.baseUrl.replace(/\/$/, "")}${upstreamPath}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${request.provider.apiKey}`
        },
        body: JSON.stringify(continuationBody)
      });
      if (!continuationResponse.ok || !continuationResponse.body) {
        content = visibleContent;
      } else {
        const prefix = visibleContent ? "\n\n" : "";
        const continuationReader = continuationResponse.body.getReader();
        const continuationDecoder = new TextDecoder();
        let continuationBuffer = "";
        let continuationContent = "";
        let emittedPrefix = false;
        while (true) {
          const { done, value } = await continuationReader.read();
          if (done) break;
          continuationBuffer += continuationDecoder.decode(value, { stream: true });
          const lines = continuationBuffer.split("\n");
          continuationBuffer = lines.pop() ?? "";
          for (const raw of lines) {
            const line = raw.trim();
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const json = JSON.parse(data);
              const directDelta = extractDelta(json);
              const fullContent = directDelta ? "" : extractFullContent(json);
              const delta = directDelta || (fullContent.startsWith(continuationContent) ? fullContent.slice(continuationContent.length) : fullContent);
              if (!delta) continue;
              continuationContent += delta;
              emitDelta(emittedPrefix ? delta : `${prefix}${delta}`);
              emittedPrefix = true;
            } catch {
              // ignore malformed chunk
            }
          }
        }
        content = continuationContent ? `${visibleContent}${prefix}${continuationContent}` : visibleContent;
        const continuationActionResults = await executeInlineActions(request, continuationContent);
        if (continuationActionResults.length > 0) {
          inlineActionResults = [...inlineActionResults, ...continuationActionResults];
          actionResults = [...actionResults, ...continuationActionResults];
          const followupContext = formatActionResultsForContinuation(continuationActionResults);
          if (followupContext) {
            const followupVisibleContent = stripInlineActions(content);
            const followupMessages = [
              ...prompt.messages,
              { role: "assistant" as const, content: followupVisibleContent },
              { role: "user" as const, content: `[tool results]\n${followupContext}` }
            ];
            const followupBody = useResponsesApi
              ? (() => { const ri = toResponsesInput(followupMessages); return { ...upstreamBody, input: ri.input, ...(ri.instructions ? { instructions: ri.instructions } : {}) }; })()
              : { ...upstreamBody, messages: followupMessages, stream: true };
            const followupResponse = await fetch(`${request.provider.baseUrl.replace(/\/$/, "")}${upstreamPath}`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${request.provider.apiKey}`
              },
              body: JSON.stringify(followupBody)
            });
            if (followupResponse.ok && followupResponse.body) {
              const followupPrefix = followupVisibleContent ? "\n\n" : "";
              const followupReader = followupResponse.body.getReader();
              const followupDecoder = new TextDecoder();
              let followupBuffer = "";
              let followupContent = "";
              let emittedFollowupPrefix = false;
              while (true) {
                const { done, value } = await followupReader.read();
                if (done) break;
                followupBuffer += followupDecoder.decode(value, { stream: true });
                const lines = followupBuffer.split("\n");
                followupBuffer = lines.pop() ?? "";
                for (const raw of lines) {
                  const line = raw.trim();
                  if (!line.startsWith("data:")) continue;
                  const data = line.slice(5).trim();
                  if (!data || data === "[DONE]") continue;
                  try {
                    const json = JSON.parse(data);
                    const directDelta = extractDelta(json);
                    const fullContent = directDelta ? "" : extractFullContent(json);
                    const delta = directDelta || (fullContent.startsWith(followupContent) ? fullContent.slice(followupContent.length) : fullContent);
                    if (!delta) continue;
                    followupContent += delta;
                    emitDelta(emittedFollowupPrefix ? delta : `${followupPrefix}${delta}`);
                    emittedFollowupPrefix = true;
                  } catch {
                    // ignore malformed chunk
                  }
                }
              }
              content = followupContent ? `${followupVisibleContent}${followupPrefix}${followupContent}` : followupVisibleContent;
            } else {
              content = followupVisibleContent;
            }
          }
        }
      }
    }

    const correction = taskExecutionCorrection(actionResults);
    if (correction) {
      content = correction;
      emitDelta(`\n\n${correction}`);
    }

    const payload = await createAssistantMessage(request, prompt, content, actionResults);
    const evolutionEvents: Array<{ kind: string; title: string; message: string }> = [];
    for (const config of request.modules.filter((m) => m.enabled)) {
      const module = getModule(config.id);
      if (module?.hooks.afterChatComplete) {
        const events = await module.hooks.afterChatComplete({ request, message: payload.message, prompt, actionResults, settings: config.settings });
        if (events) evolutionEvents.push(...events);
      }
    }
    const displayActionResults = actionResults.filter((item) => item.action && item.action.type !== "image.inline" && item.action.type !== "video.inline" && item.action.type !== "hypno.choices" && item.action.type !== "thoughts");
    emit("done", { ...payload, actionResults: displayActionResults, usedMockResponse: false, ...(evolutionEvents.length > 0 ? { evolutionEvents } : {}) });
    res.end();
  } catch (error) {
    emit("error", { error: error instanceof Error ? error.message : "Streaming chat failed." });
    if (!res.writableEnded) res.end();
  }
});

app.use(express.static(distRoot, viteStaticAssetOptions));
app.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.sendFile(path.join(distRoot, "index.html"));
});

const server = app.listen(port, host, () => {
  console.log(`ErisHub API listening on http://${host}:${port}`);
  setInterval(() => {}, 60000);
  void getLocalAssetInventory(false).then(() => {
    setTimeout(() => { void getLocalAssetInventory(true).catch(() => undefined); }, 10000);
  }).catch(() => undefined);
  setTimeout(async () => {
    try {
      const { readDiscordConfig, ensureBot } = await import("./modules/discord");
      const cfg = await readDiscordConfig();
      if (cfg.token) await ensureBot();
      console.log("Discord bot startup complete.");
    } catch (e) { console.error("Discord bot startup failed:", e); }
  }, 2000);
});
const sipServer = sipApp.listen(sipPort, "127.0.0.1", () => {
  console.log(`Inbound phone callback listener running on http://127.0.0.1:${sipPort}`);
});
const sipWss = new WebSocketServer({ noServer: true });
sipServer.on("upgrade", (req, socket, head) => {
  void (async () => {
    const config = await readSipConfig();
    if (!await sipModuleIsEnabled() || !authorizeSipCallback(req.headers.authorization, config)) {
      recordSipCallbackFailure(new Error("Bandwidth media stream Basic authentication was rejected."));
      socket.write("HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm=ErisHub\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    sipWss.handleUpgrade(req, socket, head, (ws) => acceptSipMediaSocket(ws, config));
  })().catch((error) => {
    recordSipCallbackFailure(error);
    socket.destroy();
  });
});

const reminderCheckInterval = setInterval(async () => {
  try {
    const { readDiscordConfig, sendDiscordMessage } = await import("./modules/discord");
    const cfg = await readDiscordConfig();
    if (!cfg.token || !cfg.channelId || cfg.autoFireReminders === false) return;
    const { readStoredScheduleItems, writeStoredScheduleItems } = await import("./modules/reminders");
    const now = Date.now();
    const items = await readStoredScheduleItems();
    const due = items.filter((item) => !item.notifiedAt && Date.parse(item.at) <= now);
    if (due.length === 0) return;
    const notifiedAt = new Date().toISOString();
    const dueIds = new Set(due.map((item) => item.id));
    await writeStoredScheduleItems(items.map((item) => dueIds.has(item.id) ? { ...item, notifiedAt } : item));
    const message = due.map((item) => `**${item.kind === "alarm" ? "Alarm" : "Reminder"}**: ${item.title}${item.note ? ` (${item.note})` : ""}`).join("\n");
    await sendDiscordMessage(`🔔 ${message}`);
  } catch { /* reminder poll errors are non-fatal */ }
}, 30000).unref();

async function shutdown(signal: string) {
  clearInterval(reminderCheckInterval);
  const { stopBot } = await import("./modules/discord");
  await stopBot();
  server.close(() => process.exit(signal === "SIGINT" || signal === "SIGTERM" ? 0 : 1));
  sipWss.close();
  sipServer.close();
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", () => { void shutdown("SIGINT"); });
process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});
process.on("uncaughtException", (error) => {
  console.error(error);
  void shutdown("uncaughtException");
});
