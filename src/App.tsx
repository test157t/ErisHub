import { CSSProperties, FormEvent, KeyboardEvent, memo, ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, ModuleConfig, PromptBlock, PromptProfile, ProviderConfig, UserProfile } from "../shared/types";
import { parseInlineActionAttrs } from "../shared/inlineActions";
import { AgentsPage } from "./components/AgentsPage";
import { UsersPage } from "./components/UsersPage";
import { ProviderPage } from "./components/ProviderPage";
import { SidebarNav } from "./components/SidebarNav";
import { SettingsPage } from "./components/SettingsPage";
import { AppearanceSettingsPanel } from "./components/AppearanceSettingsPanel";
import { ChatPage } from "./components/chat/ChatPage";
import { EditorPage } from "./components/editor/EditorPage";
import { ModulesPage } from "./components/modules/ModulesPage";
import { ModuleSettingsPanelRouter } from "./components/modules/ModuleSettingsPanelRouter";
import type { BackgroundAsset, ModuleManifest, ModuleSettings } from "./components/modules/types";

type LocalAssetInventory = { chatBackgrounds?: BackgroundAsset[] };
type ModuleAssetItem = { name: string; path: string; url: string; size: number; updatedAt: string; type: string };
type LocalModuleAssetInventory = LocalAssetInventory & { modules?: { [key: string]: unknown } };
type EmbodyAudioAsset = { name: string; url: string };
type VrmAssetInventory = { animations?: ModuleAssetItem[]; models?: ModuleAssetItem[] };
type AppStateSnapshot = {
  version: number;
  savedAt?: string;
  providerProfiles: ProviderConfig[];
  activeProviderId: string;
  promptProfiles: PromptProfile[];
  activePromptProfileId: string;
  modules: ModuleConfig[];
  activeAgentIds: string[];
  activePage: AppPage;
  activeSessionId: string | null;
  currentChatTitle: string;
  sessions: ChatSession[];
  messages: ChatMessage[];
  imageRuns: Record<string, ImageGenerationResult>;
  videoRuns: Record<string, VideoGenerationResult>;
  chatSettings: ChatSettings;
  appearanceSettings: AppearanceSettings;
  callModeTtsVolume: number;
};
type AppearanceSettings = Record<string, unknown> & {
  backgroundUrl: string;
  dimStrength: number;
  blurBackground: boolean;
  activeThemeId: string;
  // Startup cache only. The server theme library replaces this collection after boot.
  themes: Record<string, unknown>[];
};
const BACKGROUND_ASSETS_CACHE_KEY = "chatBackgroundAssets.cache";
const APP_STATE_CACHE_KEY = "nitral.appState";
const IMAGE_RUNS_CACHE_KEY = "imageGeneration.runs";
const VIDEO_RUNS_CACHE_KEY = "videoGeneration.runs";
const COMPOSER_USER_HISTORY_CACHE_KEY = "composer.globalUserHistory";
const CHAT_SETTINGS_CACHE_KEY = "nitral.chatSettings";
const COMPOSER_USER_HISTORY_LIMIT = 100;
const APP_STATE_VOLATILE_KEYS = new Set(["callModeEnabled", "sessionActive", "sessionPaused", "sessionStyle", "sessionShape", "sessionEnding", "sessionStage", "sessionStageProgress", "sessionReadiness", "sessionFeedback", "sessionUserSignal", "sessionModelDecision", "sessionNextInstruction", "sessionTechnique", "sessionStageGoal", "sessionCheckInPrompt", "sessionCandidateBranchesJson", "sessionSelectedBranchId", "sessionSelectedBranchScore", "sessionSelectedBranchEffectsJson", "sessionBranchReason", "sessionDirectorNote", "sessionPathJson", "sessionPreferenceNotes", "sessionMemoryCandidate", "sessionLastSavedMemoryCandidate", "sessionStrategyNotes", "sessionCreativeNotes", "sessionAwaitingFeedback", "sessionTurnCount", "sessionStageTurnCount", "sessionContract", "sessionContractAnalysis", "sessionContractStatus", "intifaceTimelineBlocks", "intifaceTimelinePlaying", "intifaceTimelineScrubberMs", "intifacePatternDurationMs"]);
const APP_STATE_MAX_STRING_LENGTH = 512 * 1024;
const backgroundVideoExtensions = new Set(["m4v", "mov", "mp4", "webm"]);

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const raw = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(raw) ? raw : fallback));
}

type AppPage = "chat" | "editor" | "settings" | "agents" | "users" | "modules";
type PythonRunState = { status: "running" | "done" | "error"; output: string };
type ImageGenerationVariant = { url?: string; prompt: string; model?: string; size?: string; createdAt?: number };
type VideoGenerationVariant = ImageGenerationVariant & { seconds?: number };
type ImageGenerationResult = ImageGenerationVariant & { status: "running" | "done" | "error"; error?: string; variants?: ImageGenerationVariant[]; selectedIndex?: number };
type VideoGenerationResult = VideoGenerationVariant & { status: "running" | "done" | "error"; error?: string; variants?: VideoGenerationVariant[]; selectedIndex?: number };
type ReminderItem = { id: string; kind: "reminder" | "alarm"; title: string; at: string; note?: string; createdAt: string; notifiedAt?: string };
type MemoryItem = { id: string; scope: "user" | "agent" | "global"; text: string; tags: string; createdAt: string; updatedAt: string };
type TaskItem = { id: string; title: string; status: "todo" | "doing" | "done" | "blocked"; note?: string; createdAt: string; updatedAt: string };
type NoteItem = { id: string; type: "note"; title: string; content: string; createdAt: string; updatedAt: string };
type LibraryDoc = { id: string; name: string; size: number; createdAt: string; hash?: string };
type LibraryDocPreview = LibraryDoc & { content: string };
type SessionSummary = { id: string; title: string; summary: string; updatedAt: string };
type NotificationItem = { id: string; kind: "info" | "success" | "warning" | "error" | "reminder" | "alarm" | "task"; title: string; message: string; source: string; createdAt: string; readAt?: string };
type ModuleEventItem = { id: string; createdAt: string; source: string; action: string; status: string; input?: unknown; output?: unknown; error?: string };
type ActionResultItem = { action?: { type?: string; attrs?: Record<string, string>; body?: string }; status?: string; result?: unknown; error?: string };
type PlaybackCue = { type: string; attrs: Record<string, string>; body: string };
type VoiceForgeCueMessage = ChatMessage & { playbackCues?: PlaybackCue[] };
type ToastItem = { id: string; kind: NotificationItem["kind"]; title: string; message: string; createdAt: number };
type MediaPreview = { type: "image" | "video"; url: string; prompt: string; caption: string };
type ChatSettings = { editorCodeCompletionEnabled: boolean; wrapNormalChatMessages: boolean };
type HypnoTrackerDecision = {
  stage?: string;
  progress?: number;
  readiness?: string;
  userSignal?: string;
  decision?: string;
  awaitingFeedback?: boolean;
  feedback?: string;
  nextInstruction?: string;
  technique?: string;
  stageGoal?: string;
  checkInPrompt?: string;
  checkIn?: string;
  candidateBranches?: HypnoBranch[];
  selectedBranchId?: string;
  branchReason?: string;
  directorNote?: string;
  effects?: { spiralPreset?: string; particleStyle?: string; whispers?: string[] };
};
type HypnoBranch = {
  id?: string;
  label?: string;
  stage?: string;
  technique?: string;
  goal?: string;
  reason?: string;
  readinessNeeded?: string;
  intensity?: string;
  effectsPlan?: string;
  effects?: HypnoBranchEffects;
  comfortScore?: number;
  goalFitScore?: number;
  readinessScore?: number;
  noveltyScore?: number;
  intensityScore?: number;
  totalScore?: number;
  visits?: number;
  valueEstimate?: number;
  confidence?: number;
  rolloutSummary?: string;
};
type HypnoBranchEffects = { spiralPreset?: string; particleStyle?: string; particleCount?: number; whispers?: string[] };
const HYPNO_SESSION_STAGES = ["induction", "deepener", "body", "reinforcement", "ending"];
const HYPNO_SPIRAL_PRESETS = new Set(["none", "classic-vortex", "soft-orbital", "breathing-ring", "deep-tunnel", "pendulum"]);
const HYPNO_PARTICLE_STYLES = new Set(["snow", "rain", "firefly"]);
const HYPNO_BLOCK_ADVANCE_SIGNALS = new Set(["not-ready", "confused", "overwhelmed", "pause", "stop", "end"]);
const HYPNO_PAUSE_DECISIONS = new Set(["pause_session"]);
const HYPNO_END_DECISIONS = new Set(["end_session"]);
const STREAM_ACTION_RE = /<action\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/action>)/gi;
const STREAM_CUE_ACTION_TYPES = new Set(["audio.play", "intiface.play", "intiface.stop"]);

function extractPlaybackCues(buffer: string) {
  const cues: PlaybackCue[] = [];
  let lastConsumed = 0;
  for (const match of String(buffer || "").matchAll(STREAM_ACTION_RE)) {
    const attrs = parseInlineActionAttrs(match[1]);
    const type = String(attrs.type || "").trim();
    if (STREAM_CUE_ACTION_TYPES.has(type)) cues.push({ type, attrs, body: String(match[2] || "").trim() });
    lastConsumed = Number(match.index || 0) + match[0].length;
  }
  const remaining = buffer.slice(lastConsumed);
  const actionStart = remaining.toLowerCase().lastIndexOf("<action");
  return { cues, remaining: actionStart >= 0 ? remaining.slice(actionStart) : remaining.slice(-2000) };
}

function splitTtsSafeActionText(buffer: string) {
  const source = String(buffer || "");
  const actionStart = source.toLowerCase().lastIndexOf("<action");
  STREAM_ACTION_RE.lastIndex = 0;
  const maybeIncomplete = actionStart >= 0 && !STREAM_ACTION_RE.test(source.slice(actionStart));
  STREAM_ACTION_RE.lastIndex = 0;
  const safeEnd = maybeIncomplete ? actionStart : source.length;
  const safeText = source.slice(0, safeEnd).replace(STREAM_ACTION_RE, "");
  STREAM_ACTION_RE.lastIndex = 0;
  return { safeText, remaining: source.slice(safeEnd) };
}
function compactJson(value: unknown) {
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2).slice(0, 4000);
  } catch {
    return String(value).slice(0, 4000);
  }
}

const weatherCache: { summary: string; expiresAt: number; refreshPromise: Promise<string> | null } = { summary: "", expiresAt: 0, refreshPromise: null };
const ASSISTANT_METADATA_PREFIX_RE = /^(?:<metadata:\s*[^\n>]*>\s*)+/i;
const PYTHON_CODE_BLOCK_RE = /```(?:python|py)\s*\n([\s\S]*?)```/gi;
const STREAM_MAX_FPS = 165;
const STREAM_MIN_FRAME_MS = 1000 / STREAM_MAX_FPS;
const HTTP_URL_RE = /https?:\/\/[^\s<>"]+/gi;
const VOICEFORGE_DEFAULT_VOICE = "[Default Voice]";
const VOICEFORGE_DISABLED_VOICE = "disabled";
const classifySentiments = [
  "admiration", "amusement", "anger", "annoyance", "approval", "caring", "confusion", "curiosity", "desire", "disappointment",
  "disapproval", "disgust", "embarrassment", "excitement", "fear", "gratitude", "grief", "joy", "love", "nervousness",
  "optimism", "pride", "realization", "relief", "remorse", "sadness", "surprise", "neutral"
];

function backgroundAssetFromUrl(url: string, cachedAssets: BackgroundAsset[] = []): BackgroundAsset | null {
  const selected = String(url || "").trim();
  if (!selected) return null;
  const cached = cachedAssets.find((asset) => asset.url === selected);
  if (cached) return cached;
  const cleanUrl = selected.split(/[?#]/)[0];
  const leaf = cleanUrl.split("/").pop() || selected;
  const ext = leaf.includes(".") ? leaf.split(".").pop()?.toLowerCase() || "" : "";
  return {
    name: decodeURIComponent(leaf) || selected,
    url: selected,
    previewUrl: selected,
    type: backgroundVideoExtensions.has(ext) ? "video" : "image"
  };
}

function assetNameForMatch(value: string) {
  return String(value || "")
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.[^/.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim() || "";
}

function assetMatchTokens(value: string) {
  return assetNameForMatch(value).split(/\s+/).filter((token) => token.length > 1 && token !== "the" && token !== "and");
}

function stableIndex(value: string, length: number) {
  if (length <= 0) return -1;
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return hash % length;
}

function fuzzyAssetScore(target: string, candidate: string) {
  const normalizedTarget = assetNameForMatch(target);
  const normalizedCandidate = assetNameForMatch(candidate);
  if (!normalizedTarget || !normalizedCandidate) return 0;
  if (normalizedTarget === normalizedCandidate) return 100;
  if (normalizedCandidate.includes(normalizedTarget) || normalizedTarget.includes(normalizedCandidate)) return 80;
  const targetTokens = new Set(assetMatchTokens(target));
  const candidateTokens = new Set(assetMatchTokens(candidate));
  const overlap = [...targetTokens].filter((token) => candidateTokens.has(token)).length;
  return overlap === 0 ? 0 : Math.round((overlap / Math.max(1, Math.min(targetTokens.size, candidateTokens.size))) * 70);
}

function bestMatchingAudio(background: BackgroundAsset | null, audioAssets: EmbodyAudioAsset[]) {
  if (!background || audioAssets.length === 0) return "";
  const target = background.name || background.url;
  let best = { score: 0, url: "" };
  for (const asset of audioAssets) {
    const score = Math.max(fuzzyAssetScore(target, asset.name), fuzzyAssetScore(target, asset.url));
    if (score > best.score) best = { score, url: asset.url };
  }
  return best.score >= 30 ? best.url : "";
}

function loadCachedBackgroundAssets() {
  return loadState<BackgroundAsset[]>(BACKGROUND_ASSETS_CACHE_KEY, []);
}

function normalizeBackgroundAssets(value: unknown) {
  return Array.isArray(value)
    ? value.filter((asset): asset is BackgroundAsset => !!asset && typeof asset === "object" && typeof (asset as BackgroundAsset).name === "string" && typeof (asset as BackgroundAsset).url === "string")
    : [];
}

function loadCachedAppState() {
  const snapshot = stripAppStateVolatileData(loadState<Partial<AppStateSnapshot>>(APP_STATE_CACHE_KEY, {}));
  saveState(APP_STATE_CACHE_KEY, snapshot);
  return snapshot;
}

function appStateSavedAtMs(value: Partial<AppStateSnapshot> | undefined) {
  const time = Date.parse(String(value?.savedAt || ""));
  return Number.isFinite(time) ? time : 0;
}

function newerAppState(localState: Partial<AppStateSnapshot>, serverState: Partial<AppStateSnapshot>) {
  if (!serverState?.version) return localState;
  return serverState;
}

function loadLocalAppStateForBoot() {
  const state = stripAppStateVolatileData(loadState<Partial<AppStateSnapshot>>(APP_STATE_CACHE_KEY, {}));
  const providerProfiles = loadState<ProviderConfig[]>("providerProfiles", []);
  const activeProviderId = loadState<string>("activeProviderId", "");
  return {
    ...state,
    providerProfiles: providerProfiles.length ? providerProfiles : state.providerProfiles,
    activeProviderId: activeProviderId || state.activeProviderId
  };
}

function stripAppStateVolatileData<T>(value: T, key = ""): T {
  if (Array.isArray(value)) return value.map((entry) => stripAppStateVolatileData(entry)) as T;
  if (typeof value === "string") {
    if (value.startsWith("data:") && key !== "imageUrl" && key !== "videoUrl") return "" as T;
    if (value.length > APP_STATE_MAX_STRING_LENGTH && key !== "imageUrl" && key !== "videoUrl") return "" as T;
    return value;
  }
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !APP_STATE_VOLATILE_KEYS.has(key) && key !== "themes")
    .map(([key, entry]) => [key, stripAppStateVolatileData(entry, key)])) as T;
}

function loadSavedModules() {
  const snapshot = loadCachedAppState();
  const modules = Array.isArray(snapshot.modules) ? snapshot.modules : [];
  const scrubbedModules = stripAppStateVolatileData(modules);
  return scrubbedModules;
}



function prefetchAssetUrl(url: string) {
  const src = String(url || "").trim();
  if (!src || src === "none") return Promise.resolve();
  return fetch(src, { cache: "force-cache" }).then(() => undefined).catch(() => undefined);
}

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function boundedBootTask(task: Promise<unknown>, timeoutMs = 8000) {
  return Promise.race([task.catch(() => undefined), wait(timeoutMs)]);
}

function assetUrlBySetting(value: unknown, assets: ModuleAssetItem[] | undefined) {
  const raw = String(value || "").trim();
  if (!raw || raw === "none") return "";
  if (raw.startsWith("/")) return raw;
  const normalized = raw.toLowerCase().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\.[^/.]+$/, "");
  const leaf = normalized.split("/").pop() || normalized;
  return assets?.find((asset) => {
    const path = asset.path.toLowerCase().replace(/\\/g, "/").replace(/^\/+/, "");
    const name = asset.name.toLowerCase().replace(/\.[^/.]+$/, "");
    const noExt = path.replace(/\.[^/.]+$/, "");
    return asset.url === raw || asset.name === raw || asset.path.endsWith(raw) || noExt === normalized || noExt.endsWith(`/${normalized}`) || name === leaf;
  })?.url || raw;
}

function textMatchesModelUrl(text: unknown, modelUrl: string) {
  const normalizedText = String(text || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  const normalizedModel = String(modelUrl || "").trim().toLowerCase().replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9]+/g, "");
  return normalizedText.length >= 3 && normalizedModel.includes(normalizedText);
}

function profileMatchesModelUrl(profile: PromptProfile, modelUrl: string) {
  return textMatchesModelUrl(profile.name, modelUrl) || textMatchesModelUrl(profile.assistantName, modelUrl);
}

function expressionPresetName(value: unknown) {
  const name = String(value || "").trim();
  return name && name !== "none" ? name : "";
}

function settingObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function hypnoStageIndex(value: unknown) {
  return HYPNO_SESSION_STAGES.indexOf(String(value || "").toLowerCase());
}

function sanitizeHypnoTrackerText(value: unknown, maxLength = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function parseJsonArraySetting(value: unknown) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function hypnoScore(value: unknown, fallback = 50) {
  const raw = Number(value);
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(raw) ? raw : fallback)));
}

function sanitizeHypnoBranchEffects(value: unknown): Required<HypnoBranchEffects> {
  const effects = value && typeof value === "object" ? value as HypnoBranchEffects : {};
  const spiralPreset = sanitizeHypnoTrackerText(effects.spiralPreset || "none", 40);
  const particleStyle = sanitizeHypnoTrackerText(effects.particleStyle || "snow", 40);
  const whispers = Array.isArray(effects.whispers) ? effects.whispers.map((item) => sanitizeHypnoTrackerText(item, 60)).filter(Boolean).slice(0, 6) : [];
  return {
    spiralPreset: HYPNO_SPIRAL_PRESETS.has(spiralPreset) ? spiralPreset : "none",
    particleStyle: HYPNO_PARTICLE_STYLES.has(particleStyle) ? particleStyle : "snow",
    particleCount: Math.max(0, Math.min(1000, Math.round(Number(effects.particleCount) || 250))),
    whispers
  };
}

function sanitizeHypnoBranches(value: unknown): Required<HypnoBranch>[] {
  const items = Array.isArray(value) ? value : [];
  return items.slice(0, 5).map((item, index) => {
    const branch = item && typeof item === "object" ? item as HypnoBranch : {};
    const fallbackId = `branch-${index + 1}`;
    const comfortScore = hypnoScore(branch.comfortScore);
    const goalFitScore = hypnoScore(branch.goalFitScore);
    const readinessScore = hypnoScore(branch.readinessScore);
    const noveltyScore = hypnoScore(branch.noveltyScore, 35);
    const intensityScore = hypnoScore(branch.intensityScore, 40);
    const computedTotal = Math.round((comfortScore * 0.3) + (goalFitScore * 0.25) + (readinessScore * 0.25) + (noveltyScore * 0.1) + ((100 - intensityScore) * 0.1));
    return {
      id: sanitizeHypnoTrackerText(branch.id || fallbackId, 80) || fallbackId,
      label: sanitizeHypnoTrackerText(branch.label || branch.technique || fallbackId, 80),
      stage: sanitizeHypnoTrackerText(branch.stage || "", 60),
      technique: sanitizeHypnoTrackerText(branch.technique || "", 120),
      goal: sanitizeHypnoTrackerText(branch.goal || "", 220),
      reason: sanitizeHypnoTrackerText(branch.reason || "", 260),
      readinessNeeded: sanitizeHypnoTrackerText(branch.readinessNeeded || "", 120),
      intensity: sanitizeHypnoTrackerText(branch.intensity || "", 60),
      effectsPlan: sanitizeHypnoTrackerText(branch.effectsPlan || "", 180),
      effects: sanitizeHypnoBranchEffects(branch.effects),
      comfortScore,
      goalFitScore,
      readinessScore,
      noveltyScore,
      intensityScore,
      totalScore: hypnoScore(branch.totalScore, computedTotal),
      visits: Math.max(0, Math.min(99, Math.round(Number(branch.visits) || 1))),
      valueEstimate: hypnoScore(branch.valueEstimate, computedTotal),
      confidence: hypnoScore(branch.confidence, Math.round((comfortScore + readinessScore) / 2)),
      rolloutSummary: sanitizeHypnoTrackerText(branch.rolloutSummary || "", 220)
    };
  }).filter((branch) => branch.label || branch.technique || branch.goal);
}

function appendHypnoPathNode(settings: Record<string, unknown>, patch: Record<string, unknown>) {
  const path = parseJsonArraySetting(settings.sessionPathJson).slice(-11);
  const node = {
    stage: patch.sessionStage,
    progress: patch.sessionStageProgress,
    technique: patch.sessionTechnique,
    goal: patch.sessionStageGoal,
    branchId: patch.sessionSelectedBranchId,
    reason: patch.sessionBranchReason,
    score: patch.sessionSelectedBranchScore,
    effects: patch.sessionSelectedBranchEffectsJson,
    readiness: patch.sessionReadiness,
    at: Date.now()
  };
  return JSON.stringify([...path, node]);
}

function extractJsonObject(text: string) {
  const raw = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    throw new Error("Tracker did not return valid JSON.");
  }
}

function validateHypnoTrackerDecision(settings: Record<string, unknown>, decision: HypnoTrackerDecision) {
  const currentStage = String(settings.sessionStage || "induction").toLowerCase();
  const currentStageIndex = Math.max(0, hypnoStageIndex(currentStage));
  const requestedStage = String(decision.stage || currentStage).toLowerCase();
  const requestedStageIndex = hypnoStageIndex(requestedStage);
  const userSignal = sanitizeHypnoTrackerText(decision.userSignal || "unknown", 64).toLowerCase();
  const modelDecision = sanitizeHypnoTrackerText(decision.decision || "continue_current_stage", 80).toLowerCase();
  const blocksAdvance = HYPNO_BLOCK_ADVANCE_SIGNALS.has(userSignal) || ["not-ready", "overwhelmed", "confused", "paused"].includes(String(decision.readiness || "").toLowerCase());
  let stage = currentStageIndex >= 0 ? HYPNO_SESSION_STAGES[currentStageIndex] : "induction";
  if (!blocksAdvance && requestedStageIndex >= 0) {
    stage = HYPNO_SESSION_STAGES[Math.min(currentStageIndex + 1, Math.max(currentStageIndex, requestedStageIndex))];
  }
  const stageChanged = stage !== currentStage;
  const rawProgress = Number(decision.progress);
  const currentProgress = Number(settings.sessionStageProgress) || 0;
  const progress = Math.round(Math.max(0, Math.min(100, Number.isFinite(rawProgress) ? rawProgress : currentProgress)));
  const branches = sanitizeHypnoBranches(decision.candidateBranches);
  const selectedBranchId = sanitizeHypnoTrackerText(decision.selectedBranchId || branches[0]?.id || "", 80);
  const selectedBranch = branches.find((branch) => branch.id === selectedBranchId) || branches[0];
  const settingsPatch: Record<string, unknown> = {
    sessionStage: stage,
    sessionStageProgress: stageChanged ? Math.min(progress, 15) : progress,
    sessionReadiness: sanitizeHypnoTrackerText(decision.readiness || "unknown", 80),
    sessionFeedback: sanitizeHypnoTrackerText(decision.feedback || "tracker reviewed latest user response", 600),
    sessionUserSignal: userSignal,
    sessionModelDecision: modelDecision,
    sessionNextInstruction: sanitizeHypnoTrackerText(decision.nextInstruction || "Continue the current guided relaxation stage gently and do not skip ahead.", 900),
    sessionTechnique: sanitizeHypnoTrackerText(decision.technique || selectedBranch?.technique || settings.sessionTechnique || "", 160),
    sessionStageGoal: sanitizeHypnoTrackerText(decision.stageGoal || selectedBranch?.goal || settings.sessionStageGoal || "", 300),
    sessionCheckInPrompt: sanitizeHypnoTrackerText(decision.checkInPrompt || settings.sessionCheckInPrompt || decision.checkIn || "", 300),
    sessionCandidateBranchesJson: JSON.stringify(branches),
    sessionSelectedBranchId: selectedBranchId,
    sessionSelectedBranchScore: selectedBranch ? selectedBranch.totalScore : 0,
    sessionSelectedBranchEffectsJson: JSON.stringify(selectedBranch?.effects || sanitizeHypnoBranchEffects({})),
    sessionBranchReason: sanitizeHypnoTrackerText(decision.branchReason || selectedBranch?.reason || "", 400),
    sessionDirectorNote: sanitizeHypnoTrackerText(decision.directorNote || "", 500),
    sessionAwaitingFeedback: decision.awaitingFeedback === true || String(decision.checkIn || "").toLowerCase() === "required",
    sessionTurnCount: Math.max(0, Math.floor(Number(settings.sessionTurnCount) || 0)) + 1,
    sessionStageTurnCount: stageChanged ? 0 : Math.max(0, Math.floor(Number(settings.sessionStageTurnCount) || 0)) + 1
  };
  if (selectedBranch?.effects) {
    const effects = sanitizeHypnoBranchEffects(selectedBranch.effects);
    settingsPatch.spiralPreset = effects.spiralPreset;
    settingsPatch.spiralEnabled = effects.spiralPreset !== "none";
    settingsPatch.particlesEnabled = effects.particleCount > 0;
    settingsPatch.particleStyle = effects.particleStyle;
    settingsPatch.particleCount = effects.particleCount;
    if (effects.whispers.length > 0) {
      settingsPatch.visualWhispersEnabled = true;
      settingsPatch.visualWhispers = effects.whispers.join("\n");
    }
  }
  settingsPatch.sessionPathJson = appendHypnoPathNode(settings, settingsPatch);
  if (HYPNO_PAUSE_DECISIONS.has(modelDecision) || userSignal === "pause" || userSignal === "stop") settingsPatch.sessionPaused = true;
  if (HYPNO_END_DECISIONS.has(modelDecision) || userSignal === "end") {
    settingsPatch.sessionActive = false;
    settingsPatch.sessionPaused = false;
  }
  return settingsPatch;
}

function sanitizeVoiceForgeText(content: string) {
  return String(content || "").trim();
}

function normalizeVoiceForgeBackgroundTracks(value: unknown) {
  const normalizeTrack = (track: unknown) => {
    if (typeof track === "string") return track.trim() ? { file: track.trim() } : null;
    if (!track || typeof track !== "object" || Array.isArray(track)) return null;
    const record = track as Record<string, unknown>;
    const file = String(record.file || record.path || record.url || "").trim();
    if (!file) return null;
    return {
      file,
      volume: Number(record.volume ?? 0.5),
      delay: Number(record.delay ?? 0),
      fade_in: Number(record.fade_in ?? record.fadeIn ?? 0),
      fade_out: Number(record.fade_out ?? record.fadeOut ?? 0)
    };
  };
  if (Array.isArray(value)) return value.map(normalizeTrack).filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(normalizeTrack).filter(Boolean);
      if (parsed && typeof parsed === "object") return normalizeVoiceForgeBackgroundTracks(parsed);
    } catch {
      return [{ file: value.trim() }];
    }
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return normalizeVoiceForgeBackgroundTracks(record.tracks ?? record.files ?? record.background_tracks);
  }
  return [];
}

function streamedTtsWordCount(text: string) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function streamedTtsNthWordEndIndex(text: string, wordCount: number) {
  const matches = [...String(text || "").matchAll(/\S+/g)];
  const match = matches[Math.max(0, wordCount - 1)];
  return match ? match.index + match[0].length : 0;
}

function streamedTtsChunkEndIndex(text: string, chunkWords: number) {
  return streamedTtsNthWordEndIndex(text, chunkWords);
}

function voiceForgeRequestVoice(rawVoice: unknown, settings: Record<string, unknown>) {
  if (typeof rawVoice === "string") {
    if (!rawVoice || rawVoice === VOICEFORGE_DISABLED_VOICE) return null;
    const backend = String(settings.voiceforgeTtsBackend || "").trim();
    if (!backend) return null;
    return { tts_backend: backend, audio_prompt: rawVoice };
  }
  const voice = settingObject(rawVoice);
  const backend = String(voice.tts_backend || settings.voiceforgeTtsBackend || "").trim();
  if (!backend) return null;
  const next: Record<string, unknown> = { ...voice, tts_backend: backend };
  for (const key of ["audio_prompt", "omnivoice_voice", "pocket_tts_voice", "kokoro_voice"]) {
    if (next[key] === VOICEFORGE_DEFAULT_VOICE || next[key] === VOICEFORGE_DISABLED_VOICE) delete next[key];
  }
  return next;
}

function voiceMapLookupKey(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function resolveVoiceForgeMappedVoice(settings: Record<string, unknown>, agentId: unknown, agentName: unknown) {
  const voiceMap = settingObject(settings.voiceforgeVoiceMap);
  const candidates = [String(agentId || ""), String(agentName || "")].filter(Boolean);
  for (const candidate of candidates) {
    if (voiceMap[candidate] !== undefined) return voiceMap[candidate];
  }
  const entries = Object.entries(voiceMap);
  for (const candidate of candidates) {
    const normalized = voiceMapLookupKey(candidate);
    const found = entries.find(([key]) => voiceMapLookupKey(key) === normalized);
    if (found) return found[1];
    const stripped = voiceMapLookupKey(candidate.replace(/\s*\([^)]*\)\s*$/, ""));
    if (stripped && stripped !== normalized) {
      const strippedFound = entries.find(([key]) => voiceMapLookupKey(key) === stripped);
      if (strippedFound) return strippedFound[1];
    }
  }
  return voiceMap[VOICEFORGE_DEFAULT_VOICE];
}

function modelSettingsForUrl(allSettings: unknown, modelUrl: string) {
  const all = settingObject(allSettings);
  const exact = settingObject(all[modelUrl]);
  if (Object.keys(exact).length) return exact;

  const normalized = String(modelUrl || "").toLowerCase().replace(/\\/g, "/").replace(/^\/+/, "");
  const normalizedNoExt = normalized.replace(/\.vrm$/i, "");
  const leaf = normalizedNoExt.split("/").pop() || normalizedNoExt;
  const match = Object.entries(all).find(([key]) => {
    const candidate = key.toLowerCase().replace(/\\/g, "/").replace(/^\/+/, "");
    const candidateNoExt = candidate.replace(/\.(vrm|fbx)$/i, "");
    return candidate === normalized || candidateNoExt === normalizedNoExt || candidateNoExt.split("/").pop() === leaf;
  });
  return match ? settingObject(match[1]) : {};
}

function completeVrmModelSettings(settings: Record<string, unknown>, modelUrl: string) {
  const modelSettings = modelSettingsForUrl(settings.vrmModelSettings, modelUrl);
  const animationDefault = settingObject(modelSettings.animation_default);
  const defaultScale = /\.fbx$/i.test(modelUrl) ? 1 : Number(settings.vrmModelScale ?? 3) || 3;
  return {
    scale: Number(modelSettings.scale ?? defaultScale) || defaultScale,
    x: Number(modelSettings.x ?? settings.vrmModelPositionX ?? 0) || 0,
    y: Number(modelSettings.y ?? settings.vrmModelPositionY ?? 0) || 0,
    z: Number(modelSettings.z ?? 0) || 0,
    rx: Number(modelSettings.rx ?? settings.vrmModelRotationX ?? 0) || 0,
    ry: Number(modelSettings.ry ?? settings.vrmModelRotationY ?? 0) || 0,
    rz: Number(modelSettings.rz ?? 0) || 0,
    ...modelSettings,
    animation_default: {
      expression: String(animationDefault.expression || settings.vrmDefaultExpression || "neutral"),
      motion: String(animationDefault.motion || settings.vrmDefaultMotion || "/assets/vrm/animations/neutral.bvh"),
      sequence: String(animationDefault.sequence || "")
    },
    classify_mapping: settingObject(modelSettings.classify_mapping),
    hitboxes_mapping: settingObject(modelSettings.hitboxes_mapping),
    blend_shape_mapping: settingObject(modelSettings.blend_shape_mapping)
  };
}

function sanitizeMetadataValue(value: unknown) {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/[<>]/g, "").trim();
}

function ordinalDay(dayNumber: number) {
  const mod100 = Math.abs(dayNumber) % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${dayNumber}th`;
  const mod10 = Math.abs(dayNumber) % 10;
  if (mod10 === 1) return `${dayNumber}st`;
  if (mod10 === 2) return `${dayNumber}nd`;
  if (mod10 === 3) return `${dayNumber}rd`;
  return `${dayNumber}th`;
}

function timestampMetadataValue() {
  const now = new Date();
  const monthName = now.toLocaleString(undefined, { month: "long" });
  const hour24 = now.getHours();
  const hour12 = hour24 % 12 || 12;
  const min = String(now.getMinutes()).padStart(2, "0");
  const meridiem = hour24 >= 12 ? "pm" : "am";
  const tz = Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
    .formatToParts(now)
    .find((part) => part.type === "timeZoneName")?.value || "local";
  return sanitizeMetadataValue(`${monthName} ${ordinalDay(now.getDate())}, ${now.getFullYear()} at ${hour12}:${min} ${meridiem} ${tz}`);
}

function weatherUnits() {
  const locale = String(navigator.language || "").toLowerCase();
  return ["en-us", "en-lr", "my"].some((entry) => locale === entry || locale.startsWith(`${entry}-`)) ? "imperial" : "metric";
}

function weatherCodeLabel(code: unknown) {
  const c = Number(code);
  if (c === 0) return "clear";
  if (c === 1) return "mostly clear";
  if (c === 2) return "partly cloudy";
  if (c === 3) return "overcast";
  if (c === 45 || c === 48) return "foggy";
  if ([51, 53, 55, 56, 57].includes(c)) return "drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(c)) return "rain";
  if ([71, 73, 75, 77, 85, 86].includes(c)) return "snow";
  if ([95, 96, 99].includes(c)) return "thunderstorm";
  return "mixed";
}

function normalizeModuleSettings(manifest: ModuleManifest, savedSettings: Record<string, unknown> = {}) {
  if (manifest.id === "classify") {
    const minConfidence = Number(savedSettings.minConfidence ?? manifest.defaultSettings.minConfidence);
    return { minConfidence: Number.isFinite(minConfidence) ? Math.max(0, Math.min(1, minConfidence)) : 0 };
  }
  if (manifest.id === "background-music") {
    const next = Object.fromEntries(Object.keys(manifest.defaultSettings).map((key) => [key, savedSettings[key] ?? manifest.defaultSettings[key]]));
    if (savedSettings.audioBgmLockModeVersion !== 1) next.audioBgmLocked = false;
    if (next.audioBgmRandom === undefined) next.audioBgmRandom = false;
    next.audioBgmLockModeVersion = 1;
    return next;
  }

  return Object.fromEntries(Object.keys(manifest.defaultSettings).map((key) => [key, savedSettings[key] ?? manifest.defaultSettings[key]]));
}

function callModeHypnoSettings(hypnoEnabled: boolean, settings: Record<string, unknown>) {
  const active = hypnoEnabled && settings.sessionActive === true && settings.overlayEnabled !== false;
  const particlesActive = hypnoEnabled && settings.overlayEnabled !== false && settings.particlesEnabled !== false;
  return {
    callModeHypnoticEffectsEnabled: active && settings.effectsEnabled !== false,
    callModeParticlesEnabled: particlesActive,
    callModeParticleStyle: settings.particleStyle,
    callModeParticleCount: settings.particleCount,
    callModeParticleFallRate: settings.particleFallRate,
    callModeParticleImpactRate: settings.particleImpactRate,
    callModeFireflyGlow: settings.fireflyGlow,
    callModeHypnoWhispersEnabled: active && settings.visualWhispersEnabled !== false,
    callModeHypnoSpiralEnabled: active && settings.spiralEnabled !== false && settings.spiralPreset !== "none",
    callModeHypnoSpiralPreset: settings.spiralPreset,
    callModeHypnoSnapSfxEnabled: active && settings.snapSfxEnabled !== false,
    callModeHypnoAmbientEnabled: active && settings.ambientEnabled !== false,
    callModeHypnoBreathCuesEnabled: active && settings.breathCuesEnabled !== false,
    callModeHypnoSpokenWhispersEnabled: active && settings.spokenWhispersEnabled === true,
    callModeHypnoBreathGuidanceEnabled: active && settings.breathGuidanceEnabled !== false,
    callModeHypnoBreathGuidanceLeadMs: settings.breathGuidanceLeadMs,
    callModeHypnoWhispers: settings.visualWhispers
  };
}

const themeCssVars: Record<string, string> = {
  colorBg: "--bg",
  colorBg2: "--bg-2",
  colorSurface: "--surface",
  colorSurface2: "--surface-2",
  colorSurface3: "--surface-3",
  colorGlass: "--glass",
  colorLine: "--line",
  colorLineStrong: "--line-strong",
  colorText: "--text",
  colorMuted: "--muted",
  colorMuted2: "--muted-2",
  colorAccent: "--accent",
  colorAccent2: "--accent-2",
  colorAccent3: "--accent-3",
  colorDanger: "--danger",
  colorDangerBg: "--danger-bg",
  colorSuccess: "--success",
  colorSuccessBg: "--success-bg",
  colorWarning: "--warning",
  colorWarningBg: "--warning-bg",
  colorInfo: "--info",
  colorInfoBg: "--info-bg",
  colorCodeKeyword: "--code-keyword",
  colorCodeString: "--code-string",
  colorCodeNumber: "--code-number",
  colorCodeComment: "--code-comment",
  colorCodeFunction: "--code-function",
  colorCodeTag: "--code-tag",
  colorCodeCaret: "--code-caret",
  colorCodeCompletion: "--code-completion"
};

const themePxVars: Record<string, string> = {
  radiusLg: "--radius-lg",
  radiusMd: "--radius-md",
  radiusSm: "--radius-sm",
  controlHeight: "--ui-control-height",
  controlRadius: "--ui-control-radius"
};

function applyThemeSettings(settings: Record<string, unknown>) {
  const themes = Array.isArray(settings.themes) ? settings.themes.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
  const activeThemeId = String(settings.activeThemeId || "").trim();
  const activeTheme = themes.find((item) => String(item.id || "") === activeThemeId) || themes[0] || settings;
  const root = document.documentElement;
  for (const [key, cssVar] of Object.entries(themeCssVars)) {
    const value = String(activeTheme[key] || "").trim();
    if (value) root.style.setProperty(cssVar, value);
  }
  for (const [key, cssVar] of Object.entries(themePxVars)) {
    const value = Number(activeTheme[key]);
    if (Number.isFinite(value)) root.style.setProperty(cssVar, `${value}px`);
  }
  const borderOpacity = Math.max(0, Math.min(1, Number(activeTheme.controlBorderOpacity ?? 0.18)));
  const bgOpacity = Math.max(0, Math.min(1, Number(activeTheme.controlBgOpacity ?? 0.54)));
  const shadowStrength = Math.max(0, Math.min(90, Number(activeTheme.shadowStrength ?? 46)));
  root.style.setProperty("--ui-control-border-opacity", String(borderOpacity));
  root.style.setProperty("--ui-control-bg-opacity", String(bgOpacity));
  root.style.setProperty("--shadow", `0 28px 80px rgba(0, 0, 0, ${shadowStrength / 100})`);
  root.style.setProperty("--shadow-soft", `0 14px 38px rgba(0, 0, 0, ${Math.max(0.08, shadowStrength / 165)})`);
}

async function geocodeCity(city: string) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", city);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  const res = await fetch(url.toString());
  if (!res.ok) return null;
  const data = await res.json();
  const row = Array.isArray(data?.results) ? data.results[0] : null;
  const latitude = Number(row?.latitude);
  const longitude = Number(row?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude, label: String(row?.name || city).trim() || city };
}

async function reverseGeocode(latitude: number, longitude: number) {
  try {
    const url = new URL("https://api.bigdatacloud.net/data/reverse-geocode-client");
    url.searchParams.set("latitude", String(latitude));
    url.searchParams.set("longitude", String(longitude));
    url.searchParams.set("localityLanguage", "en");
    const res = await fetch(url.toString());
    if (!res.ok) return "";
    const data = await res.json();
    const city = data?.city || data?.locality || data?.principalSubdivision;
    const parts = [city, data?.principalSubdivision, data?.countryCode].map((part) => String(part || "").trim()).filter(Boolean);
    return parts.join(", ");
  } catch {
    return "";
  }
}

async function browserCoords() {
  if (!navigator.geolocation) return null;
  const pos = await new Promise<GeolocationPosition | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: false, timeout: 4000, maximumAge: 15 * 60 * 1000 });
  });
  const latitude = Number(pos?.coords.latitude);
  const longitude = Number(pos?.coords.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const label = await reverseGeocode(latitude, longitude);
  if (!label) return null;
  return { latitude, longitude, label };
}

function weatherRefreshMs(settings: Record<string, unknown>) {
  return Math.max(5, Math.min(240, Number(settings.weatherRefreshMinutes) || 30)) * 60 * 1000;
}

async function refreshWeatherMetadata(settings: Record<string, unknown>) {
  if (settings.weatherContextEnabled !== true) return "";
  try {
    const manualCity = String(settings.weatherManualCity || "").trim();
    const location = manualCity ? await geocodeCity(manualCity) : await browserCoords();
    if (!location) {
      weatherCache.expiresAt = Date.now() + weatherRefreshMs(settings);
      return "";
    }
    const units = weatherUnits();
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(location.latitude));
    url.searchParams.set("longitude", String(location.longitude));
    url.searchParams.set("current", "temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m");
    url.searchParams.set("temperature_unit", units === "imperial" ? "fahrenheit" : "celsius");
    url.searchParams.set("wind_speed_unit", units === "imperial" ? "mph" : "kmh");
    url.searchParams.set("timezone", "auto");
    const res = await fetch(url.toString());
    if (!res.ok) return "";
    const current = (await res.json())?.current;
    const temp = Number(current?.temperature_2m);
    const wind = Number(current?.wind_speed_10m);
    const humidity = Number(current?.relative_humidity_2m);
    const parts = [];
    if (Number.isFinite(temp)) parts.push(`${Math.round(temp)}${units === "imperial" ? "F" : "C"}`);
    parts.push(weatherCodeLabel(current?.weather_code));
    if (Number.isFinite(wind)) parts.push(`wind ${Math.round(wind)} ${units === "imperial" ? "mph" : "km/h"}`);
    if (Number.isFinite(humidity)) parts.push(`humidity ${Math.round(humidity)}%`);
    const summary = sanitizeMetadataValue(`${location.label}: ${parts.join(", ")}.`);
    weatherCache.summary = summary;
    weatherCache.expiresAt = Date.now() + weatherRefreshMs(settings);
    return summary;
  } catch {
    weatherCache.expiresAt = Date.now() + weatherRefreshMs(settings);
    return "";
  }
}

function weatherMetadataValue(settings: Record<string, unknown>) {
  if (settings.weatherContextEnabled !== true) return "";
  const now = Date.now();
  if (weatherCache.summary && weatherCache.expiresAt > now) return weatherCache.summary;
  if (!weatherCache.refreshPromise) {
    weatherCache.refreshPromise = refreshWeatherMetadata(settings).finally(() => {
      weatherCache.refreshPromise = null;
    });
  }
  return weatherCache.summary;
}

async function editorWorkspaceContext() {
  const workspaceState = await fetch("/api/workspace-state").then((res) => res.json()).catch(() => ({}));
  const editor = workspaceState?.state?.editor && typeof workspaceState.state.editor === "object" && !Array.isArray(workspaceState.state.editor) ? workspaceState.state.editor as Record<string, unknown> : {};
  const activeProjectId = String(editor.activeProjectId || "").trim();
  if (!activeProjectId) return { metadata: "", note: "" };
  const activeFilePath = String(editor.activeProjectFilePath || "").trim();
  const activeFileContent = String(editor.activeProjectFileContent || "").slice(0, 8000);
  const directory = String(editor.projectDirectory || "").trim();
  if (!directory) return { metadata: "", note: "" };
  const files = Array.isArray(editor.projectFilesSnapshot) ? editor.projectFilesSnapshot.slice(0, 80).map((item) => String(item || "")).filter(Boolean).join(", ") : "";
  let modifiedFiles = "";
  try {
    const res = await fetch(`/api/modules/projects/git-review?root=${encodeURIComponent(directory)}`);
    const data = await res.json();
    if (res.ok && Array.isArray(data?.status)) {
      modifiedFiles = data.status.slice(0, 40).map((item: { path?: string; x?: string; y?: string }) => `${String(item.x || " ")}${String(item.y || " ")} ${String(item.path || "")}`).join(" | ");
    }
  } catch {
    modifiedFiles = "";
  }
  const parts = [
    `project_dir=${directory}`,
    activeFilePath ? `selected_file=${activeFilePath}` : "",
    files ? `files=${files}` : "",
    modifiedFiles ? `modified=${modifiedFiles}` : "",
    activeFilePath && activeFileContent ? `selected_file_content:\n${activeFileContent}` : ""
  ].filter(Boolean);
  const metadata = parts.length ? sanitizeMetadataValue(parts.join(" | ")).slice(0, 12000) : "";
  const noteParts = [
    `Project: ${directory}`,
    activeFilePath ? `Selected file: ${activeFilePath}` : "",
    modifiedFiles ? `Modified files: ${modifiedFiles}` : "",
    files ? `Indexed files: ${files}` : ""
  ].filter(Boolean);
  return { metadata, note: noteParts.join("\n") };
}

function extractPythonCodeBlocks(content: string) {
  return Array.from(content.matchAll(PYTHON_CODE_BLOCK_RE), (match) => match[1].trim()).filter(Boolean);
}

function extractImagePrompts(content: string) {
  return [] as string[];
}

function extractVideoPrompts(content: string) {
  return [] as string[];
}

function stripAllTags(content: string) {
  return content;
}

function parseReminderAttributes(raw: string) {
  const attrs: Record<string, string> = {};
  for (const match of raw.matchAll(/([a-zA-Z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? "";
  return attrs;
}

function safeHttpUrl(value: string | undefined) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function directVideoUrl(value: string) {
  const url = safeHttpUrl(value);
  if (!url) return "";
  const parsed = new URL(url);
  if (parsed.hostname.replace(/^www\./, "").toLowerCase() === "media.hypnotube.com") return url;
  return /\.(mp4|webm|ogg|mov|m4v)(?:$|[?#])/i.test(parsed.pathname) ? url : "";
}

function videoEmbedUrl(value: string) {
  const url = safeHttpUrl(value);
  if (!url) return "";
  const parsed = new URL(url);
  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  if (host === "youtu.be") return `https://www.youtube.com/embed/${parsed.pathname.replace(/^\//, "").split("/")[0]}`;
  if (host === "youtube.com" || host.endsWith(".youtube.com")) {
    const id = parsed.searchParams.get("v") || (parsed.pathname.startsWith("/shorts/") ? parsed.pathname.split("/")[2] : "");
    return id ? `https://www.youtube.com/embed/${id}` : "";
  }
  if (host === "vimeo.com" || host.endsWith(".vimeo.com")) {
    const id = parsed.pathname.split("/").find((part) => /^\d+$/.test(part));
    return id ? `https://player.vimeo.com/video/${id}` : "";
  }
  if (host === "pornhub.com" || host.endsWith(".pornhub.com")) {
    if (parsed.pathname.startsWith("/embed/")) return parsed.toString();
    const viewKey = parsed.searchParams.get("viewkey") || parsed.pathname.match(/\/view_video\.php\/([^/?#]+)/i)?.[1] || "";
    return viewKey ? `https://www.pornhub.com/embed/${encodeURIComponent(viewKey)}` : "";
  }
  return "";
}

function isHypnotubeVideoPage(value: string) {
  const url = safeHttpUrl(value);
  if (!url) return false;
  const parsed = new URL(url);
  return parsed.hostname.replace(/^www\./, "").toLowerCase() === "hypnotube.com" && /^\/video\/[^/]+-\d+\.html$/i.test(parsed.pathname);
}

function extractInlineImages(content: string): Record<string, string>[] {
  return [];
}
function isVideoUrl(value: string) { return !!videoEmbedUrl(value) || !!directVideoUrl(value) || isHypnotubeVideoPage(value); }
function extractInlineVideos(content: string): Record<string, string>[] { return []; }

function extractLinkedVideos(content: string): Record<string, string>[] {
  return Array.from(content.matchAll(HTTP_URL_RE), (match) => safeHttpUrl(match[0].replace(/[),.;!?]+$/g, "")))
    .filter((url) => url && (videoEmbedUrl(url) || directVideoUrl(url) || isHypnotubeVideoPage(url)))
    .map((url) => ({ src: url, alt: "Linked video" }));
}

function mergeVideoItems(items: Record<string, string>[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.src || seen.has(item.src)) return false;
    seen.add(item.src);
    return true;
  });
}

function HypnotubeVideo({ item }: { item: Record<string, string> }) {
  const [media, setMedia] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState("");
  const streamUrl = `/api/media/hypnotube/stream?url=${encodeURIComponent(item.src)}`;

  useEffect(() => {
    const controller = new AbortController();
    setMedia(null);
    setError("");
    fetch(`/api/media/hypnotube/resolve?url=${encodeURIComponent(item.src)}`, { signal: controller.signal })
      .then(async (response) => {
        const text = await response.text();
        const data = text ? JSON.parse(text) : null;
        return { response, data };
      })
      .then(({ response, data }) => {
        if (!response.ok) throw new Error(data?.error || "HypnoTube resolve failed.");
        setMedia(data.media || null);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "HypnoTube resolve failed.");
      });
    return () => controller.abort();
  }, [item.src]);

  if (media?.src) return <video autoPlay controls loop muted playsInline preload="metadata" src={streamUrl} poster={media?.poster || item.poster || undefined} />;
  if (error) return <a className="inline-video-link" href={item.src} target="_blank" rel="noreferrer">Open HypnoTube video</a>;
  return <div className="inline-video-loading">Loading HypnoTube video...</div>;
}

function renderInlineVideo(item: Record<string, string>, index: number) {
  const embedUrl = videoEmbedUrl(item.src);
  const videoUrl = directVideoUrl(item.src);
  return <figure key={`${item.src}-${index}`}>
    {embedUrl ? <iframe allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen loading="lazy" referrerPolicy="strict-origin-when-cross-origin" src={embedUrl} title={item.alt || item.title || "Inline video"} /> : null}
    {!embedUrl && isHypnotubeVideoPage(item.src) ? <HypnotubeVideo item={item} /> : null}
    {!embedUrl && !isHypnotubeVideoPage(item.src) && videoUrl ? <video autoPlay controls loop muted playsInline preload="metadata" src={videoUrl} poster={item.poster || undefined} /> : null}
    {!embedUrl && !isHypnotubeVideoPage(item.src) && !videoUrl ? <a className="inline-video-link" href={item.src} target="_blank" rel="noreferrer">Open video</a> : null}
    <figcaption>{item.alt || item.title || item.src}</figcaption>
  </figure>;
}

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}

function messageTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString([], { year: "2-digit", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function compactActionValue(value: unknown) {
  if (value === undefined || value === null || value === "") return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function actionResultTitle(item: ActionResultItem) {
  const type = item.action?.type || "action";
  const attrs = item.action?.attrs || {};
  const result = settingObject(item.result);
  if (type === "schedule.create") return `${compactActionValue(result.kind || attrs.kind || "reminder")} scheduled`;
  if (type === "calendar.create") return "calendar event created";
  if (type === "note.create") return "note saved";
  if (type === "note.append") return "note updated";
  if (type === "task.create") return "task created";
  if (type === "task.update") return "task updated";
  if (type === "task.execute") return "task executed";
  if (type === "notification.create") return "notification created";
  if (type === "image.generate") return "image generation queued";
  if (type === "video.generate") return "video generation queued";
  return type;
}

function actionResultDetailLines(item: ActionResultItem) {
  const attrs = item.action?.attrs || {};
  const result = settingObject(item.result);
  const lines: string[] = [];
  const add = (label: string, value: unknown) => {
    const text = compactActionValue(value);
    if (text) lines.push(`${label}: ${text}`);
  };
  add("Title", result.title || attrs.title);
  const when = result.at || result.startsAt || attrs.at || attrs.startsAt;
  add("When", when ? formatTimestamp(Date.parse(String(when))) : "");
  add("Ends", result.endsAt || attrs.endsAt);
  add("Kind", result.kind || attrs.kind);
  add("Status", result.status || attrs.status);
  const nestedTask = settingObject(result.task);
  const automatic = settingObject(result.automatic);
  const inlineActions = Array.isArray(automatic.inlineActions) ? automatic.inlineActions : [];
  add("Workflow", result.workflow);
  add("Task Status", nestedTask.status);
  add("Task Note", nestedTask.note);
  add("Inline Media", inlineActions.length ? `${inlineActions.length} item(s)` : "");
  add("Location", result.location || attrs.location);
  add("Note", result.note || attrs.note || item.action?.body);
  add("ID", result.id || attrs.id);
  return lines;
}

function actionResultMessage(item: ActionResultItem) {
  const status = item.status || "unknown";
  const title = actionResultTitle(item);
  const lines = actionResultDetailLines(item);
  if (status === "executed" || status === "continuation-required") return [`${title}: ${status}`, ...lines].join("\n");
  return [`${title}: ${status}`, item.error ? `Error: ${item.error}` : "", ...lines].filter(Boolean).join("\n");
}

function messageDetailsLabel(note: string) {
  if (/^Actions taken:/i.test(note.trim())) return "Actions taken";
  if (/\n\nActions taken:/i.test(note)) return "Message details";
  return "Context used";
}

function visibleMessageContent(message: ChatMessage, hideMetadataPrefix = false) {
  const content = message.role === "assistant" ? stripAllTags(message.content) : message.content;
  if (!hideMetadataPrefix || message.role !== "assistant") return content;
  return content.replace(ASSISTANT_METADATA_PREFIX_RE, "");
}

function stripStandaloneWrappingQuotes(content: string) {
  let cleaned = content.trim();
  cleaned = cleaned.replace(/^(["'“”‘’])\s*\n+/, "");
  cleaned = cleaned.replace(/\n+\s*(["'“”‘’])$/, "");
  return cleaned;
}

function stripAssistantSelfLabel(content: string, profile: PromptProfile) {
  const aliases = [profile.name, profile.assistantName]
    .filter(Boolean)
    .map((name) => String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!aliases.length) return content;
  return content.replace(new RegExp(`^(\\s*[\"“”]?\\s*)(?:${aliases.join("|")})\\s*:\\s*`, "i"), "$1");
}

function renderMessageTextWithCodeBlocks(content: string) {
  const blocks: ReactNode[] = [];
  const regex = /```([a-zA-Z0-9_-]+)?[ \t]*\r?\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const before = content.slice(lastIndex, match.index);
    if (before.trim()) blocks.push(<p key={`t-${lastIndex}`}>{before}</p>);
    const language = String(match[1] || "").trim().toLowerCase();
    blocks.push(<pre className="chat-code-block" key={`c-${match.index}`}><code className={language ? `language-${language}` : ""}>{match[2]}</code></pre>);
    lastIndex = match.index + match[0].length;
  }
  const tail = content.slice(lastIndex);
  if (tail.trim() || blocks.length === 0) blocks.push(<p key={`t-${lastIndex}`}>{tail}</p>);
  return blocks;
}

type MessageArticleProps = {
  message: ChatMessage;
  sessionId: string;
  profile: PromptProfile;
  userName: string;
  hideMetadataPrefix?: boolean;
  editingMessageId: string | null;
  editingDraft: string;
  imageGenerationEnabled: boolean;
  pythonSandboxEnabled: boolean;
  pythonSandboxRequireConfirmation: boolean;
  imageRuns: Record<string, ImageGenerationResult>;
  videoRuns: Record<string, VideoGenerationResult>;
  pythonRuns: Record<string, PythonRunState>;
  onStartEditing: (message: ChatMessage) => void;
  onDelete: (sessionId: string, messageId: string) => void;
  onEditingDraftChange: (value: string) => void;
  onSaveEdited: (sessionId: string, messageId: string) => void;
  onCancelEditing: () => void;
  onGenerateImage: (runId: string, prompt: string, agentId?: string) => void;
  onGenerateVideo: (runId: string, prompt: string, agentId?: string, sourceImageUrl?: string) => void;
  onClearImage: (runId: string) => void;
  onClearVideo: (runId: string) => void;
  selectImageRunVariant: (runId: string, index: number) => void;
  selectVideoRunVariant: (runId: string, index: number) => void;
  onRunPythonCode: (runId: string, code: string) => void;
  onHypnoChoice: (label: string, value: string) => void;
  onUpdateImagePrompt?: (runId: string, prompt: string) => void;
  onUpdateVideoPrompt?: (runId: string, prompt: string) => void;
};

type HypnoChoicePrompt = { id: string; prompt: string; choices: Array<{ label: string; value: string }> };

function extractThoughts(content: string) {
  return [] as string[];
}

function extractHypnoChoicePrompts(content: string): HypnoChoicePrompt[] {
  return [];
}

function relevantRunsEqual<T>(prev: Record<string, T>, next: Record<string, T>, keys: string[]) {
  return keys.every((key) => prev[key] === next[key]);
}

function generatedMediaCaption(run: { model?: string; size?: string; seconds?: number; createdAt?: number }) {
  const parts = [run.model, run.size, run.seconds ? `${run.seconds}s` : "", run.createdAt ? formatTimestamp(run.createdAt) : "generated"].filter(Boolean);
  return parts.join(" · ");
}

function imageVariants(run: ImageGenerationResult | undefined) {
  if (!run) return [];
  const variants = Array.isArray(run.variants) ? run.variants : [];
  return variants.length ? variants : run.url ? [{ url: run.url, prompt: run.prompt, model: run.model, size: run.size, createdAt: run.createdAt }] : [];
}

function videoVariants(run: VideoGenerationResult | undefined) {
  if (!run) return [];
  const variants = Array.isArray(run.variants) ? run.variants : [];
  return variants.length ? variants : run.url ? [{ url: run.url, prompt: run.prompt, model: run.model, size: run.size, seconds: run.seconds, createdAt: run.createdAt }] : [];
}

function selectedVariant<T>(variants: T[], index: unknown) {
  if (!variants.length) return null;
  const selected = Math.max(0, Math.min(variants.length - 1, Number(index) || 0));
  return variants[selected];
}

function appendImageVariant(current: ImageGenerationResult | undefined, variant: ImageGenerationVariant): ImageGenerationResult {
  const variants = [...imageVariants(current), variant];
  return { status: "done", ...variant, variants, selectedIndex: variants.length - 1 };
}

function appendVideoVariant(current: VideoGenerationResult | undefined, variant: VideoGenerationVariant): VideoGenerationResult {
  const variants = [...videoVariants(current), variant];
  return { status: "done", ...variant, variants, selectedIndex: variants.length - 1 };
}

function MediaPromptDisclosure({ imagePrompt, videoPrompt, onEditImage, onEditVideo }: { imagePrompt?: string; videoPrompt?: string; onEditImage?: (prompt: string) => void; onEditVideo?: (prompt: string) => void }) {
  const [editing, setEditing] = useState<{ label: string; value: string } | null>(null);
  const cleanImagePrompt = String(imagePrompt || "").trim();
  const cleanVideoPrompt = String(videoPrompt || "").trim();
  if (!cleanImagePrompt && !cleanVideoPrompt) return null;
  const startEdit = (label: string, value: string) => setEditing({ label, value });
  const saveEdit = () => {
    if (!editing) return;
    const trimmed = editing.value.trim();
    if (trimmed && editing.label === "Image") onEditImage?.(trimmed);
    if (trimmed && editing.label === "Video") onEditVideo?.(trimmed);
    setEditing(null);
  };
  const cancelEdit = () => setEditing(null);
  const isEditing = (label: string) => editing?.label === label;
  const promptBlock = (label: string, prompt: string) =>
    isEditing(label)
      ? <div className="media-prompt-block"><div className="media-prompt-header"><strong>{label}</strong><div><button type="button" onClick={saveEdit}>Save</button><button type="button" onClick={cancelEdit}>Cancel</button></div></div><textarea className="image-generation-prompt-editor" value={editing!.value} onChange={(e) => setEditing({ ...editing!, value: e.target.value })} onKeyDown={(e) => { if (e.ctrlKey && e.key === "Enter") saveEdit(); if (e.key === "Escape") cancelEdit(); }} rows={3} /></div>
      : <div className="media-prompt-block"><div className="media-prompt-header"><strong>{label}</strong><div><button type="button" onClick={() => startEdit(label, prompt)}>Edit</button><button type="button" onClick={() => navigator.clipboard?.writeText(prompt).catch(() => undefined)}>Copy</button></div></div><p className="image-generation-prompt">{prompt}</p></div>;
  return <details className="media-prompt-disclosure"><summary><span>{cleanImagePrompt && cleanVideoPrompt ? "Media prompts" : cleanImagePrompt ? "Image prompt" : "Video prompt"}</span></summary><div className="media-prompt-stack">{cleanImagePrompt ? promptBlock("Image", cleanImagePrompt) : null}{cleanVideoPrompt ? promptBlock("Video", cleanVideoPrompt) : null}</div></details>;
}

function GeneratedMediaFigure({ canNext, canPrevious, caption, onClear, onGenerateVideo, onNext, onPreview, onPrevious, onRegenerate, prompt, type, url }: { canNext: boolean; canPrevious: boolean; caption: string; onClear: () => void; onGenerateVideo?: () => void; onNext: () => void; onPreview: (preview: MediaPreview) => void; onPrevious: () => void; onRegenerate: () => void; prompt: string; type: "image" | "video"; url: string }) {
  return <figure className={`generated-media-figure ${type}`}>
    <div className="generated-media-frame">
      {canPrevious ? <button aria-label={`Previous generated ${type}`} className="generated-media-nav previous" type="button" onClick={onPrevious}>‹</button> : null}
      <button aria-label={canNext ? `Next generated ${type}` : `Generate next ${type}`} className="generated-media-nav next" type="button" onClick={canNext ? onNext : onRegenerate}>›</button>
      <div className="generated-media-overlay-actions">
        <button className="generated-media-overlay-action regenerate" type="button" onClick={onRegenerate}>Regenerate</button>
        {onGenerateVideo ? <button className="generated-media-overlay-action video" type="button" onClick={onGenerateVideo}>Generate Video</button> : null}
      </div>
      <button aria-label={`Remove generated ${type}`} className="generated-media-overlay-action remove" type="button" onClick={onClear}>×</button>
      {type === "image"
        ? <button className="generated-media-preview-button" type="button" onClick={() => onPreview({ type, url, prompt, caption })}><img alt={prompt} src={url} /></button>
        : <video autoPlay controls loop muted playsInline preload="metadata" src={url} />}
      <span className="generated-media-metadata">{caption}</span>
    </div>
  </figure>;
}

const MessageArticle = memo(function MessageArticle({
  message,
  sessionId,
  profile,
  userName,
  hideMetadataPrefix = false,
  editingMessageId,
  editingDraft,
  imageGenerationEnabled,
  pythonSandboxEnabled,
  pythonSandboxRequireConfirmation,
  imageRuns,
  videoRuns,
  pythonRuns,
  onStartEditing,
  onDelete,
  onEditingDraftChange,
  onSaveEdited,
  onCancelEditing,
  onGenerateImage,
  onGenerateVideo,
  onClearImage,
  onClearVideo,
  selectImageRunVariant,
  selectVideoRunVariant,
  onRunPythonCode,
  onHypnoChoice,
  onUpdateImagePrompt,
  onUpdateVideoPrompt
}: MessageArticleProps) {
  const [mediaPreview, setMediaPreview] = useState<MediaPreview | null>(null);
  const label = message.role === "system"
    ? "System"
    : message.role === "user"
    ? userName
    : message.agentName || profile.assistantName || profile.name || "Assistant";
  const isEditing = editingMessageId === message.id;
  const rawContent = message.content || "";
  const rawDisplayContent = visibleMessageContent(message, hideMetadataPrefix);
  const imagePromptsFromContent = imageGenerationEnabled && message.role === "assistant" && !isEditing ? (message.mediaRequests || []).filter((item) => item.type === "image").map((item) => item.prompt) : [];
  const videoPromptsFromContent = imageGenerationEnabled && message.role === "assistant" && !isEditing ? (message.mediaRequests || []).filter((item) => item.type === "video").map((item) => item.prompt) : [];
  const imageRunIds = imageGenerationEnabled && message.role === "assistant" && !isEditing
    ? Object.keys(imageRuns).filter((key) => key.startsWith(`${message.id}:`)).sort((a, b) => {
        const ai = parseInt(a.split(":").pop() || "0", 10);
        const bi = parseInt(b.split(":").pop() || "0", 10);
        return ai - bi;
      })
    : [];
  const videoRunIds = imageGenerationEnabled && message.role === "assistant" && !isEditing
    ? Object.keys(videoRuns).filter((key) => key.startsWith(`${message.id}:video:`)).sort((a, b) => {
        const ai = parseInt(a.split(":").pop() || "0", 10);
        const bi = parseInt(b.split(":").pop() || "0", 10);
        return ai - bi;
      })
    : [];
  const imagePrompts = imageRunIds.length ? imageRunIds.map((runId) => imageRuns[runId]?.prompt || "") : imagePromptsFromContent;
  const videoPrompts = videoRunIds.length ? videoRunIds.map((runId) => videoRuns[runId]?.prompt || "") : videoPromptsFromContent;
  const inlineImages = message.role === "assistant" && !isEditing ? (message.renderedMedia || []).filter((item) => item.type === "image").map((item) => ({ ...item, src: safeHttpUrl(item.src) })).filter((item) => item.src) : [];
  const explicitInlineVideos = message.role === "assistant" && !isEditing ? (message.renderedMedia || []).filter((item) => item.type === "video").map((item) => ({ ...item, src: safeHttpUrl(item.src), poster: safeHttpUrl(item.poster) })).filter((item) => item.src) : [];
  const hypnoChoicePrompts = message.role === "assistant" && !isEditing ? message.choices || [] : [];
  const thoughts = message.role === "assistant" && !isEditing ? extractThoughts(rawContent) : [];
  const displayContent = rawDisplayContent;
  const inlineVideos = message.role === "assistant" && !isEditing ? mergeVideoItems([...explicitInlineVideos, ...extractLinkedVideos(displayContent)]) : [];
  const pythonBlocks = pythonSandboxEnabled && message.role === "assistant" && !isEditing ? extractPythonCodeBlocks(displayContent) : [];

  useEffect(() => {
    if (pythonBlocks.length && !pythonSandboxRequireConfirmation) {
      pythonBlocks.forEach((code, index) => onRunPythonCode(`${message.id}:${index}`, code));
    }
  }, []);

  return <article className={`message ${message.role}`}>
    <div className="message-heading">
      <strong>{label}</strong>
      <div className="message-tools">
        <time>{messageTimestamp(message.createdAt)}</time>
        <button aria-label="Edit message" type="button" onClick={() => onStartEditing(message)}>✎</button>
        <button aria-label="Delete message" type="button" onClick={() => onDelete(sessionId, message.id)}>×</button>
      </div>
    </div>
    {message.role === "assistant" && message.contextNote ? <details className="assistant-context-note"><summary>{messageDetailsLabel(message.contextNote)}</summary><pre>{message.contextNote}</pre></details> : null}
    {isEditing ? <div className="message-editor"><textarea value={editingDraft} onChange={(event) => onEditingDraftChange(event.target.value)} rows={4} /><div className="button-row"><button type="button" onClick={() => onSaveEdited(sessionId, message.id)}>Save</button><button type="button" onClick={onCancelEditing}>Cancel</button></div></div> : <>{thoughts.map((thought, index) => <details className="assistant-thoughts" key={index}><summary>Thinking...</summary><p>{thought}</p></details>)}{renderMessageTextWithCodeBlocks(displayContent)}{message.attachments?.length ? <div className="chat-inline-images">{message.attachments.map((item) => <figure key={item.id}><img alt={item.name} src={item.url} /><figcaption>{item.name}</figcaption></figure>)}</div> : null}{inlineImages.length ? <div className="chat-inline-images">{inlineImages.map((item, index) => <figure key={`${item.src}-${index}`}><img alt={item.alt || "Inline image"} src={item.src} /><figcaption>{item.alt || item.src}</figcaption></figure>)}</div> : null}{inlineVideos.length ? <div className="chat-inline-videos">{inlineVideos.map(renderInlineVideo)}</div> : null}{hypnoChoicePrompts.length ? <div className="hypno-choice-stack">{hypnoChoicePrompts.map((prompt) => <div className="hypno-choice-card" key={prompt.id}>{prompt.prompt ? <strong>{prompt.prompt}</strong> : null}<div className="hypno-choice-row">{prompt.choices.map((choice) => <button type="button" key={`${prompt.id}:${choice.label}`} onClick={() => onHypnoChoice(choice.label, choice.value)}>{choice.label}</button>)}</div></div>)}</div> : null}{imagePrompts.length ? <div className="image-generation-chat-results">
      {imagePrompts.map((prompt, index) => {
        const runId = `${message.id}:${index}`;
        const imageVideoRunId = `${message.id}:image-video:${index}`;
        const run = imageRuns[runId];
        const imageVideoRun = videoRuns[imageVideoRunId];
        const runVariants = imageVariants(run);
        const runSelectedIndex = Math.max(0, Math.min(runVariants.length - 1, Number(run?.selectedIndex) || 0));
        const selectedRun = selectedVariant(runVariants, runSelectedIndex);
        const imageVideoVariants = videoVariants(imageVideoRun);
        const imageVideoSelectedIndex = Math.max(0, Math.min(imageVideoVariants.length - 1, Number(imageVideoRun?.selectedIndex) || 0));
        const selectedImageVideoRun = selectedVariant(imageVideoVariants, imageVideoSelectedIndex);
        return <div className="image-generation-chat-result" key={runId}>
          <MediaPromptDisclosure imagePrompt={prompt} videoPrompt={imageVideoRun?.prompt || selectedImageVideoRun?.prompt} onEditImage={onUpdateImagePrompt ? (newPrompt) => onUpdateImagePrompt(runId, newPrompt) : undefined} onEditVideo={onUpdateVideoPrompt ? (newPrompt) => onUpdateVideoPrompt(imageVideoRunId, newPrompt) : undefined} />
          <div className="image-generation-result-body">
          {run?.status === "error" ? <pre className="python-sandbox-output error">{run.error}</pre> : null}
          {run?.status === "running" ? <span className="generating-status">Generating image…</span> : null}
          {imageVideoRun?.status === "error" ? <pre className="python-sandbox-output error">{imageVideoRun.error}</pre> : null}
          {imageVideoRun?.status === "running" ? <span className="generating-status">Generating video…</span> : null}
          {selectedRun?.url || selectedImageVideoRun?.url ? <div className="generated-media-row">{selectedRun?.url ? <GeneratedMediaFigure canNext={runSelectedIndex < runVariants.length - 1} canPrevious={runSelectedIndex > 0} caption={generatedMediaCaption(selectedRun)} onClear={() => onClearImage(runId)} onGenerateVideo={selectedImageVideoRun?.url ? undefined : () => onGenerateVideo(imageVideoRunId, prompt, message.agentId, selectedRun.url)} onNext={() => selectImageRunVariant(runId, runSelectedIndex + 1)} onPrevious={() => selectImageRunVariant(runId, runSelectedIndex - 1)} onRegenerate={() => onGenerateImage(runId, prompt, message.agentId)} prompt={selectedRun.prompt || prompt} type="image" url={selectedRun.url} onPreview={setMediaPreview} /> : null}{selectedImageVideoRun?.url ? <GeneratedMediaFigure canNext={imageVideoSelectedIndex < imageVideoVariants.length - 1} canPrevious={imageVideoSelectedIndex > 0} caption={generatedMediaCaption(selectedImageVideoRun)} onClear={() => onClearVideo(imageVideoRunId)} onNext={() => selectVideoRunVariant(imageVideoRunId, imageVideoSelectedIndex + 1)} onPrevious={() => selectVideoRunVariant(imageVideoRunId, imageVideoSelectedIndex - 1)} onRegenerate={() => onGenerateVideo(imageVideoRunId, prompt, message.agentId, selectedRun?.url || run?.url)} prompt={selectedImageVideoRun.prompt || prompt} type="video" url={selectedImageVideoRun.url} onPreview={setMediaPreview} /> : null}</div> : null}
          <div className="generated-media-actions">
            {!run || run.status === "error" ? <button type="button" onClick={() => onGenerateImage(runId, prompt, message.agentId)}>{run?.status === "error" ? "Retry Image" : "Generate Image"}</button> : null}
            {(!selectedRun?.url && (!imageVideoRun || imageVideoRun.status === "error")) ? <button type="button" onClick={() => onGenerateVideo(imageVideoRunId, prompt, message.agentId, run?.url)}>{imageVideoRun?.status === "error" ? "Retry Video" : "Generate Video"}</button> : null}
          </div>
          </div>
        </div>;
      })}
    </div> : null}{videoPrompts.length ? <div className="image-generation-chat-results">
      {videoPrompts.map((prompt, index) => {
        const runId = `${message.id}:video:${index}`;
        const run = videoRuns[runId];
        const runVariants = videoVariants(run);
        const runSelectedIndex = Math.max(0, Math.min(runVariants.length - 1, Number(run?.selectedIndex) || 0));
        const selectedRun = selectedVariant(runVariants, runSelectedIndex);
        return <div className="image-generation-chat-result" key={runId}>
          <MediaPromptDisclosure videoPrompt={run?.prompt || selectedRun?.prompt || prompt} onEditVideo={onUpdateVideoPrompt ? (newPrompt) => onUpdateVideoPrompt(runId, newPrompt) : undefined} />
          <div className="image-generation-result-body">
          {selectedRun?.url ? <GeneratedMediaFigure canNext={runSelectedIndex < runVariants.length - 1} canPrevious={runSelectedIndex > 0} caption={generatedMediaCaption(selectedRun)} onClear={() => onClearVideo(runId)} onNext={() => selectVideoRunVariant(runId, runSelectedIndex + 1)} onPrevious={() => selectVideoRunVariant(runId, runSelectedIndex - 1)} onRegenerate={() => onGenerateVideo(runId, prompt, message.agentId)} prompt={selectedRun.prompt || prompt} type="video" url={selectedRun.url} onPreview={setMediaPreview} /> : null}
          {run?.status === "error" ? <pre className="python-sandbox-output error">{run.error}</pre> : null}
          {run?.status === "running" ? <span className="generating-status">Generating video…</span> : null}
          {!run || run.status === "error" ? <button type="button" onClick={() => onGenerateVideo(runId, prompt, message.agentId)}>{run?.status === "error" ? "Retry Video" : "Generate Video"}</button> : null}
          {run?.status === "done" && run.url ? <a className="small-action-button" href={run.url} target="_blank" rel="noreferrer">Open Video</a> : null}
          </div>
        </div>;
      })}
    </div> : null}{pythonBlocks.length && pythonSandboxRequireConfirmation ? <div className="python-sandbox-runs">
      {pythonBlocks.map((code, index) => {
        const runId = `${message.id}:${index}`;
        const run = pythonRuns[runId];
        return <div className="python-sandbox-run" key={runId}>
          <button disabled={run?.status === "running"} type="button" onClick={() => onRunPythonCode(runId, code)}>{run?.status === "running" ? "Running Python..." : `Run Python Block ${index + 1}`}</button>
          {run ? <pre className={`python-sandbox-output ${run.status}`}>{run.output}</pre> : null}
        </div>;
      })}
    </div> : null}{mediaPreview ? <div className="generated-media-lightbox" role="dialog" aria-modal="true" aria-label={`Generated ${mediaPreview.type} preview`} onClick={() => setMediaPreview(null)}><div className="generated-media-lightbox-card" onClick={(event) => event.stopPropagation()}><div className="modal-header"><button aria-label="Close preview" type="button" onClick={() => setMediaPreview(null)}>×</button></div>{mediaPreview.type === "image" ? <img alt={mediaPreview.prompt} src={mediaPreview.url} /> : <video autoPlay controls playsInline src={mediaPreview.url} />}<p>{mediaPreview.caption}</p></div></div> : null}</>}
  </article>;
}, (prev, next) => {
  if (prev.message !== next.message || prev.profile !== next.profile || prev.sessionId !== next.sessionId || prev.hideMetadataPrefix !== next.hideMetadataPrefix) return false;
  const wasEditing = prev.editingMessageId === prev.message.id;
  const isEditing = next.editingMessageId === next.message.id;
  if (wasEditing !== isEditing || (isEditing && prev.editingDraft !== next.editingDraft)) return false;
  if (prev.imageGenerationEnabled !== next.imageGenerationEnabled || prev.pythonSandboxEnabled !== next.pythonSandboxEnabled || prev.pythonSandboxRequireConfirmation !== next.pythonSandboxRequireConfirmation) return false;

  const content = next.message.content;
  const msgId = next.message.id;
  const imageKeys = next.imageGenerationEnabled && next.message.role === "assistant"
    ? [
        ...extractImagePrompts(content).map((_, index) => `${msgId}:${index}`),
        ...Object.keys(next.imageRuns).filter((key) => key.startsWith(`${msgId}:`) && !key.includes(":video:") && !key.includes(":image-video:"))
      ]
    : [];
  const videoKeys = next.imageGenerationEnabled && next.message.role === "assistant"
    ? [
        ...extractVideoPrompts(content).map((_, index) => `${msgId}:video:${index}`),
        ...extractImagePrompts(content).map((_, index) => `${msgId}:image-video:${index}`),
        ...Object.keys(next.videoRuns).filter((key) => key.startsWith(`${msgId}:`))
      ]
    : [];
  const pythonKeys = next.pythonSandboxEnabled && next.message.role === "assistant"
    ? extractPythonCodeBlocks(content).map((_, index) => `${msgId}:${index}`)
    : [];
  return relevantRunsEqual(prev.imageRuns, next.imageRuns, imageKeys) && relevantRunsEqual(prev.videoRuns, next.videoRuns, videoKeys) && relevantRunsEqual(prev.pythonRuns, next.pythonRuns, pythonKeys);
});

type ChatSession = {
  id: string;
  chatNumber: number;
  title: string;
  createdAt: number;
  messages: ChatMessage[];
  promptProfile: PromptProfile;
  agentIds?: string[];
  provider: ProviderConfig;
};

const pages: Array<{ id: AppPage; label: string }> = [
  { id: "chat", label: "Chat" },
  { id: "editor", label: "Editor" },
  { id: "settings", label: "Settings" },
  { id: "agents", label: "Agents" },
  { id: "users", label: "Users" },
  { id: "modules", label: "Modules" }
];
const basicModuleIds = new Set(["memory-bank", "organizer"]);

const defaultProvider: ProviderConfig = {
  id: "local-default",
  name: "Local Provider",
  baseUrl: "http://localhost:1234/v1",
  apiKey: "",
  model: "local-model",
  models: ["local-model"],
  useGrokResponsesApi: false,
  useManagedLlamaCpp: false,
  useComfyUi: false,
  temperature: 0.7,
  topP: 1,
  topK: 0,
  minP: 0,
  reasoningEffort: "none",
  contextLength: 8192,
  maxTokens: 800
};

const defaultPromptProfile: PromptProfile = {
  id: "default",
  name: "Default",
  blocks: [
    {
      id: "description",
      name: "Description",
      enabled: true,
      role: "system",
      position: "top",
      priority: 50,
      content: "You are a helpful, concise assistant. Follow the user's instructions and ask clarifying questions when needed."
    },
    {
      id: "personality",
      name: "Personality",
      enabled: true,
      role: "system",
      position: "top",
      priority: 51,
      content: ""
    },
    {
      id: "appearance",
      name: "Appearance",
      enabled: true,
      role: "system",
      position: "top",
      priority: 52,
      content: ""
    },
    {
      id: "response-guidelines",
      name: "Response Guidelines",
      enabled: true,
      role: "system",
      position: "top",
      priority: 53,
      content: ""
    },
    {
      id: "preferences",
      name: "Preferences",
      enabled: true,
      role: "system",
      position: "top",
      priority: 54,
      content: ""
    }
  ],
  assistantName: "",
  startingMessage: "",
  dialogueExamples: "",
  verbosity: 60,
  imageUrl: "",
  videoUrl: ""
};

const agentPromptSectionIds = ["description", "personality", "appearance", "response-guidelines", "preferences"] as const;

function agentPromptSectionTemplate(id: typeof agentPromptSectionIds[number]): PromptBlock {
  const index = agentPromptSectionIds.indexOf(id);
  const name = id === "response-guidelines" ? "Response Guidelines" : id[0].toUpperCase() + id.slice(1);
  return { id, name, enabled: true, role: "system", position: "top", priority: 50 + index, content: "" };
}

function normalizePromptBlocks(blocks: Partial<PromptBlock>[] | undefined) {
  const sourceBlocks = Array.isArray(blocks) && blocks.length ? blocks : defaultPromptProfile.blocks;
  return agentPromptSectionIds.map((id) => {
    const template = agentPromptSectionTemplate(id);
    const existing = sourceBlocks.find((block) => block.id === id) ?? (id === "description" ? sourceBlocks.find((block) => block.id === "core-system") ?? sourceBlocks[0] : undefined);
    return {
      ...template,
      ...existing,
      id: template.id,
      name: template.name,
      enabled: existing?.enabled ?? template.enabled,
      role: "system" as const,
      position: "top" as const,
      priority: template.priority,
      content: String(existing?.content ?? template.content)
    };
  });
}

function loadState<T>(key: string, defaultValue: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : defaultValue;
  } catch {
    return defaultValue;
  }
}

function saveState(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked */
  }
}

function loadComposerUserHistory() {
  const history = loadState<string[]>(COMPOSER_USER_HISTORY_CACHE_KEY, []);
  return Array.isArray(history) ? history.map((item) => String(item || "").trim()).filter(Boolean).slice(-COMPOSER_USER_HISTORY_LIMIT) : [];
}

function loadChatSettings(): ChatSettings {
  const settings = loadState<Partial<ChatSettings>>(CHAT_SETTINGS_CACHE_KEY, {});
  return { editorCodeCompletionEnabled: settings.editorCodeCompletionEnabled === true, wrapNormalChatMessages: settings.wrapNormalChatMessages === true };
}

function normalChatInputContent(value: string, wrapInQuotes: boolean) {
  const text = value.trim();
  if (!text) return "";
  return wrapInQuotes ? `"${text}"` : text;
}

function isRemoteHttpUrl(value: unknown) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function loadImageRuns() {
  const saved = loadState<Record<string, ImageGenerationResult>>(IMAGE_RUNS_CACHE_KEY, {});
  return Object.fromEntries(Object.entries(saved).map(([key, run]) => [key, run.status === "running" ? { status: "error", prompt: run.prompt, error: "Image generation was interrupted." } : run])) as Record<string, ImageGenerationResult>;
}

function loadVideoRuns() {
  const saved = loadState<Record<string, VideoGenerationResult>>(VIDEO_RUNS_CACHE_KEY, {});
  return Object.fromEntries(Object.entries(saved).map(([key, run]) => [key, run.status === "running" ? { status: "error", prompt: run.prompt, error: "Video generation was interrupted." } : run])) as Record<string, VideoGenerationResult>;
}

function normalizeProvider(provider: Partial<ProviderConfig>): ProviderConfig {
  const models = Array.isArray(provider.models) ? provider.models.map((model) => String(model).trim()).filter(Boolean) : [];
  const model = String(provider.model || models[0] || defaultProvider.model);
  const reasoningEffort = ["none", "low", "medium", "high"].includes(String(provider.reasoningEffort)) ? provider.reasoningEffort as ProviderConfig["reasoningEffort"] : defaultProvider.reasoningEffort;
  return {
    id: provider.id || crypto.randomUUID(),
    name: provider.name || model || "Provider",
    baseUrl: provider.baseUrl ?? defaultProvider.baseUrl,
    apiKey: provider.apiKey ?? defaultProvider.apiKey,
    model,
    models: models.includes(model) ? models : [model, ...models],
    useGrokResponsesApi: provider.useGrokResponsesApi === true,
    useManagedLlamaCpp: provider.useManagedLlamaCpp === true,
    useComfyUi: provider.useComfyUi === true,
    temperature: Number(provider.temperature ?? defaultProvider.temperature),
    topP: Number(provider.topP ?? defaultProvider.topP),
    topK: Number(provider.topK ?? defaultProvider.topK),
    minP: Number(provider.minP ?? defaultProvider.minP),
    reasoningEffort,
    contextLength: Number(provider.contextLength ?? defaultProvider.contextLength),
    maxTokens: Number(provider.maxTokens ?? defaultProvider.maxTokens)
  };
}

function normalizePromptProfile(profile: Partial<PromptProfile>): PromptProfile {
  const name = profile.name || profile.assistantName || "Agent";
  const encodedName = encodeURIComponent(name);
  const agentGifUrl = `/assets/agents/${encodedName}/${encodedName}.gif`;
  let imageUrl = String(profile.imageUrl ?? "");
  if (imageUrl.startsWith("/assets/video-generation/") && imageUrl.endsWith(".gif")) imageUrl = agentGifUrl;
  let videoPreviewUrl = String(profile.videoPreviewUrl ?? "");
  if (videoPreviewUrl.startsWith("/assets/video-generation/") && videoPreviewUrl.endsWith(".gif")) videoPreviewUrl = agentGifUrl;
  return {
    ...defaultPromptProfile,
    ...profile,
    id: profile.id || crypto.randomUUID(),
    name,
    blocks: normalizePromptBlocks(profile.blocks),
    assistantName: profile.name || profile.assistantName || "",
    startingMessage: String(profile.startingMessage ?? ""),
    dialogueExamples: String(profile.dialogueExamples ?? ""),
    verbosity: Math.max(0, Math.min(100, Number(profile.verbosity ?? 60))),
    providerId: profile.providerId,
    imageUrl,
    videoUrl: String(profile.videoUrl ?? ""),
    videoPreviewUrl
  };
}

function validAgentIds(agentIds: unknown, profiles: PromptProfile[]) {
  if (!Array.isArray(agentIds)) return [];
  const profileIds = new Set(profiles.map((profile) => profile.id));
  const seen = new Set<string>();
  return agentIds
    .map(String)
    .filter((agentId) => profileIds.has(agentId) && !seen.has(agentId) && (seen.add(agentId), true));
}

function resolveActiveChatAgent(activeAgentIds: string[], profiles: PromptProfile[]) {
  const activeAgentId = activeAgentIds.find((agentId) => profiles.some((profile) => profile.id === agentId));
  return activeAgentId ? profiles.find((profile) => profile.id === activeAgentId) : undefined;
}

function normalizedSessionAgents(session: ChatSession, profiles: PromptProfile[]) {
  const agentIds = validAgentIds(session.agentIds?.length ? session.agentIds : [session.promptProfile.id], profiles);
  const primaryProfile = profiles.find((profile) => profile.id === agentIds[0]) ?? profiles[0];
  return primaryProfile ? { ...session, promptProfile: primaryProfile, agentIds: agentIds.length ? agentIds : [primaryProfile.id] } : session;
}

function createMessage(role: ChatMessage["role"], content: string): ChatMessage {
  return { id: crypto.randomUUID(), role, content, createdAt: Date.now() };
}

function clientClockSnapshot() {
  return {
    clientNowIso: new Date().toISOString(),
    clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "local",
    clientLocale: navigator.language || "en-US"
  };
}

function normalizeReminderAt(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return raw;
  const hasTimezone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const date = new Date(hasTimezone ? raw : raw.replace(" ", "T"));
  return Number.isFinite(date.getTime()) ? date.toISOString() : raw;
}

export function App() {
  const cachedAppState = useMemo(loadCachedAppState, []);
  const [providerProfiles, setProviderProfiles] = useState<ProviderConfig[]>(() => {
    const savedProfiles = Array.isArray(cachedAppState.providerProfiles) ? cachedAppState.providerProfiles : loadState<Partial<ProviderConfig>[] | null>("providerProfiles", null);
    if (savedProfiles?.length) return savedProfiles.map(normalizeProvider);
    return [normalizeProvider(loadState("provider", defaultProvider))];
  });
  const [activeProviderId, setActiveProviderId] = useState(() => cachedAppState.activeProviderId || loadState("activeProviderId", providerProfiles[0]?.id ?? defaultProvider.id));
  const activeProvider = providerProfiles.find((item) => item.id === activeProviderId) ?? providerProfiles[0] ?? defaultProvider;
  const [provider, setProvider] = useState<ProviderConfig>(activeProvider);

  const [promptProfiles, setPromptProfiles] = useState<PromptProfile[]>(() => {
    const savedProfiles = Array.isArray(cachedAppState.promptProfiles) ? cachedAppState.promptProfiles : loadState<Partial<PromptProfile>[] | null>("promptProfiles", null);
    if (savedProfiles?.length) {
      const profiles = savedProfiles.map(normalizePromptProfile);
      const seen = new Set<string>();
      return profiles.filter((p) => !seen.has(p.id) && seen.add(p.id));
    }
    return [normalizePromptProfile(loadState("promptProfile", defaultPromptProfile))];
  });
  const [activePromptProfileId, setActivePromptProfileId] = useState(() => cachedAppState.activePromptProfileId || loadState("activePromptProfileId", promptProfiles[0]?.id ?? defaultPromptProfile.id));
  const activePromptProfile = promptProfiles.find((item) => item.id === activePromptProfileId) ?? promptProfiles[0] ?? defaultPromptProfile;
  const [promptProfile, setPromptProfile] = useState<PromptProfile>(activePromptProfile);

  const defaultUser: UserProfile = { id: "default-user", name: "User", imageUrl: "", videoUrl: "", videoPreviewUrl: "", description: "", personality: "", appearance: "", responseGuidelines: "", preferences: "", dialogueExamples: "", startingMessage: "" };
  function normalizeUser(u: UserProfile): UserProfile {
    const validId = u.id && u.id !== "undefined" && u.id !== "null" ? u.id : crypto.randomUUID();
    return { ...defaultUser, ...u, id: validId, name: u.name || "User" };
  }
  const [userProfiles, setUserProfiles] = useState<UserProfile[]>(() => {
    const saved = loadState<UserProfile[]>("userProfiles", []);
    if (!saved.length) return [defaultUser];
    return saved.map(normalizeUser);
  });
  const [activeUserId, setActiveUserId] = useState(() => loadState("activeUserId", userProfiles[0]?.id ?? defaultUser.id));
  const activeUser = userProfiles.find((u) => u.id === activeUserId) ?? userProfiles[0] ?? defaultUser;

  const [moduleManifests, setModuleManifests] = useState<ModuleManifest[]>([]);
  const [modules, setModules] = useState<ModuleConfig[]>(loadSavedModules);
  const [modulesLoaded, setModulesLoaded] = useState(false);
  const [appearanceSettings, setAppearanceSettings] = useState<AppearanceSettings>(() => cachedAppState.appearanceSettings ?? { backgroundUrl: "", dimStrength: 45, blurBackground: false, activeThemeId: "", themes: [] });
  const [backgroundAssets, setBackgroundAssets] = useState<BackgroundAsset[]>(loadCachedBackgroundAssets);
  const [embodyAudioAssets, setEmbodyAudioAssets] = useState<EmbodyAudioAsset[]>([]);
  const [vrmAnimations, setVrmAnimations] = useState<string[]>([]);
  const [expandedModuleId, setExpandedModuleId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(() => Array.isArray(cachedAppState.messages) ? cachedAppState.messages : loadState("messages", [] as ChatMessage[]));
  const [currentChatTitle, setCurrentChatTitle] = useState(() => cachedAppState.currentChatTitle || loadState("currentChatTitle", ""));
  const draftRef = useRef("");
  const [hasDraft, setHasDraft] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [callModeStatus, setCallModeStatus] = useState<"idle" | "connecting" | "listening" | "processing">("idle");
  const [callModeLevel, setCallModeLevel] = useState(0);
  const [callModeMuted, setCallModeMuted] = useState(false);
  const [callModeTtsVolume, setCallModeTtsVolume] = useState(() => Number.isFinite(Number(cachedAppState.callModeTtsVolume)) ? Math.max(0, Math.min(100, Math.round(Number(cachedAppState.callModeTtsVolume)))) : loadState("voiceforge.ttsVolume", 100));
  const [callModeHypnoPrompt, setCallModeHypnoPrompt] = useState<HypnoChoicePrompt | null>(null);
  const [isBooting, setIsBooting] = useState(true);
  const [isChatManagerOpen, setIsChatManagerOpen] = useState(false);
  const [isUtilityMenuOpen, setIsUtilityMenuOpen] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<NonNullable<ChatMessage["attachments"]>>([]);
  const [inspectedSessionId, setInspectedSessionId] = useState<string | null>(null);
  const [showRawHistory, setShowRawHistory] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [pythonRuns, setPythonRuns] = useState<Record<string, PythonRunState>>({});
  const [imageRuns, setImageRuns] = useState<Record<string, ImageGenerationResult>>(() => cachedAppState.imageRuns && typeof cachedAppState.imageRuns === "object" && !Array.isArray(cachedAppState.imageRuns) ? cachedAppState.imageRuns as Record<string, ImageGenerationResult> : loadImageRuns());
  const [videoRuns, setVideoRuns] = useState<Record<string, VideoGenerationResult>>(() => cachedAppState.videoRuns && typeof cachedAppState.videoRuns === "object" && !Array.isArray(cachedAppState.videoRuns) ? cachedAppState.videoRuns as Record<string, VideoGenerationResult> : loadVideoRuns());
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [reminderCalendarOffset, setReminderCalendarOffset] = useState(0);
  const [reminderDraft, setReminderDraft] = useState<{ kind: "reminder" | "alarm"; title: string; at: string; note: string }>({ kind: "reminder", title: "", at: "", note: "" });
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [documents, setDocuments] = useState<LibraryDoc[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<LibraryDocPreview | null>(null);
  const [summaries, setSummaries] = useState<SessionSummary[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [moduleEvents, setModuleEvents] = useState<ModuleEventItem[]>([]);
  const [simpleDraft, setSimpleDraft] = useState({ memory: "", task: "", noteTitle: "", noteContent: "", calc: "", calcResult: "", fileName: "", fileContent: "", summary: "" });
  const [draggedAgentId, setDraggedAgentId] = useState<string | null>(null);
  const [activeAgentIds, setActiveAgentIds] = useState<string[]>(() => {
    const savedAgentIds = Array.isArray(cachedAppState.activeAgentIds) && cachedAppState.activeAgentIds.length ? cachedAppState.activeAgentIds : loadState("activeAgentIds", [activePromptProfile.id]);
    const agentIds = validAgentIds(savedAgentIds, promptProfiles);
    return agentIds.length ? agentIds : [activePromptProfile.id];
  });
  const [chatSettings, setChatSettings] = useState<ChatSettings>(() => cachedAppState.chatSettings && typeof cachedAppState.chatSettings === "object" && !Array.isArray(cachedAppState.chatSettings) ? { editorCodeCompletionEnabled: cachedAppState.chatSettings.editorCodeCompletionEnabled === true, wrapNormalChatMessages: cachedAppState.chatSettings.wrapNormalChatMessages === true } : loadChatSettings());
  const [error, setError] = useState("");
  const [activePage, setActivePage] = useState<AppPage>(() => {
    const savedPage = cachedAppState.activePage || loadState<AppPage | string>("activePage", "chat");
    if (savedPage === "provider") return "settings";
    return pages.some((page) => page.id === savedPage) ? savedPage as AppPage : "chat";
  });
  const [sessions, setSessions] = useState<ChatSession[]>(() => (Array.isArray(cachedAppState.sessions) ? cachedAppState.sessions : loadState("sessions", [] as ChatSession[])).map((session) => normalizedSessionAgents(session, promptProfiles)));
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => cachedAppState.activeSessionId ?? loadState("activeSessionId", null as string | null));
  const [workspaceStateLoaded, setWorkspaceStateLoaded] = useState(false);
  const [composerUserHistory, setComposerUserHistory] = useState<string[]>(loadComposerUserHistory);
  const messagesRef = useRef(messages);
  const activeStreamAbortRef = useRef<AbortController | null>(null);
  const generationInFlightRef = useRef(false);
  const chatFileInputRef = useRef<HTMLInputElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const bgmAudioRef = useRef<HTMLAudioElement | null>(null);
  const voiceForgeLastMessageIdRef = useRef<string>("");
  const voiceForgeBackgroundStartKeyRef = useRef("");
  const voiceForgeDiscoveryWarmEndpointRef = useRef("");
  const voiceForgeGenerationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const voiceForgePlaybackQueueRef = useRef<Promise<void>>(Promise.resolve());
  const voiceForgePlaybackRunRef = useRef(0);
  const voiceForgeStreamPlaybackRunRef = useRef<Map<string, number>>(new Map());
  const voiceForgeStartedRunRef = useRef<Set<number>>(new Set());
  const voiceForgeTtsVolumeRef = useRef(callModeTtsVolume);
  const pendingCallModeHypnoPromptRef = useRef<HypnoChoicePrompt | null>(null);
  const callModeLevelRef = useRef(0);
  const callModeLevelUiRef = useRef({ lastLevel: 0, lastUpdateAt: 0 });
  const callModeMutedRef = useRef(false);
  const composerHistoryIndexRef = useRef<number | null>(null);
  const composerHistoryDraftRef = useRef("");
  const basicModuleRefreshPromiseRef = useRef<Promise<void> | null>(null);
  const basicModuleCacheExpiresAtRef = useRef(0);
  const notificationRefreshPromiseRef = useRef<Promise<void> | null>(null);
  const notificationCacheExpiresAtRef = useRef(0);
  const reminderRefreshPromiseRef = useRef<Promise<void> | null>(null);
  const reminderCacheExpiresAtRef = useRef(0);
  const appStateSaveTimerRef = useRef<number | null>(null);
  const appStateReadyRef = useRef(false);
  const assetInventoryLoadedRef = useRef(false);
  const localizingAgentVideoIdsRef = useRef<Set<string>>(new Set());
  const latestAppStateSnapshotRef = useRef<AppStateSnapshot | null>(null);
  const callModeModuleRef = useRef<null | { emitNitralEmbodyEvent: (type: string, detail?: unknown) => Promise<void>; endCall: () => void; getCallState: () => string; initCallMode: () => void; isCallActive: () => boolean; isCallMuted: () => boolean; setNitralEmbodyRuntimeState: (state: Record<string, unknown>) => void; toggleCall: () => void; toggleCallMute: () => void; toggleMicLevelTest?: () => boolean }>(null);
  const callModeRuntimeLoadRef = useRef<Promise<void> | null>(null);
  const intifaceRuntimeLoadRef = useRef<Promise<void> | null>(null);
  const enabledModuleIdsSignature = useMemo(() => modules.filter((item) => item.enabled).map((item) => item.id).sort().join("|"), [modules]);
  const moduleConfigById = useMemo(() => new Map(modules.map((item) => [item.id, item])), [modules]);
  const sortedModuleManifests = useMemo(() => [...moduleManifests].sort((a, b) => a.name.localeCompare(b.name)), [moduleManifests]);
  const moduleManifestColumns = useMemo(() => {
    const splitIndex = Math.ceil(sortedModuleManifests.length / 2);
    return [sortedModuleManifests.slice(0, splitIndex), sortedModuleManifests.slice(splitIndex)];
  }, [sortedModuleManifests]);
  const basicModulePanelOpen = activePage === "modules" && !!expandedModuleId && basicModuleIds.has(expandedModuleId);
  const remindersEnabled = modules.some((item) => item.id === "organizer" && item.enabled);
  const computationEnabled = modules.some((item) => item.id === "computation" && item.enabled === true);
  const activeBackgroundUrl = appearanceSettings.backgroundUrl;

  useEffect(() => {
    document.body.dataset.nitralActivePage = activePage;
    return () => {
      delete document.body.dataset.nitralActivePage;
    };
  }, [activePage]);

  useLayoutEffect(() => {
    applyThemeSettings(appearanceSettings);
  }, [appearanceSettings]);

  // Pre-warm VoiceForge audio manager and call-mode runtime so lazy imports don't delay first call
  useEffect(() => { getVoiceForgeAudioManager().catch(() => {}); }, []);
  useEffect(() => { ensureCallModeRuntime().catch(() => {}); }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const hotBackgroundUrl = String(cachedAppState.appearanceSettings?.backgroundUrl || "");
      const appStateTask = fetch("/api/app-state")
          .then((res) => res.json())
          .then((data: { state?: Partial<AppStateSnapshot> }) => {
            const serverState = stripAppStateVolatileData(data.state ?? {});
            const localState = loadLocalAppStateForBoot();
            const state = newerAppState(localState, serverState);
            if (!state?.version) return;
            saveState(APP_STATE_CACHE_KEY, state);
            if (Array.isArray(state.providerProfiles)) setProviderProfiles(state.providerProfiles.map(normalizeProvider));
            if (state.activeProviderId) setActiveProviderId(state.activeProviderId);
            if (Array.isArray(state.modules)) setModules(stripAppStateVolatileData(state.modules));
            if (state.activePage && pages.some((page) => page.id === state.activePage)) setActivePage(state.activePage);
            if (state.activeSessionId !== undefined) setActiveSessionId(state.activeSessionId || null);
            if (typeof state.currentChatTitle === "string") setCurrentChatTitle(state.currentChatTitle);
            if (Array.isArray(state.sessions)) setSessions(state.sessions.map((session) => normalizedSessionAgents(session, promptProfiles)));
            if (Array.isArray(state.messages)) setChatMessages(state.messages);
            if (Array.isArray(state.activeAgentIds)) setActiveAgentIds(validAgentIds(state.activeAgentIds, promptProfiles));
            if (state.imageRuns && typeof state.imageRuns === "object" && !Array.isArray(state.imageRuns)) setImageRuns(state.imageRuns as Record<string, ImageGenerationResult>);
            if (state.videoRuns && typeof state.videoRuns === "object" && !Array.isArray(state.videoRuns)) setVideoRuns(state.videoRuns as Record<string, VideoGenerationResult>);
            if (state.chatSettings && typeof state.chatSettings === "object" && !Array.isArray(state.chatSettings)) setChatSettings({ editorCodeCompletionEnabled: state.chatSettings.editorCodeCompletionEnabled === true, wrapNormalChatMessages: state.chatSettings.wrapNormalChatMessages === true });
            if (state.appearanceSettings && typeof state.appearanceSettings === "object" && !Array.isArray(state.appearanceSettings)) setAppearanceSettings(state.appearanceSettings);
            if (Number.isFinite(Number(state.callModeTtsVolume))) setCallModeTtsVolume(Math.max(0, Math.min(100, Math.round(Number(state.callModeTtsVolume)))));
          });
      const agentsTask = fetch("/api/agents")
        .then((res) => res.json())
        .then((data: { agents?: PromptProfile[] }) => {
          const loadedAgents = Array.isArray(data.agents) ? data.agents.map(normalizePromptProfile) : [];
          if (!loadedAgents.length) return;
          const seen = new Set<string>();
          setPromptProfiles(loadedAgents.filter((p) => !seen.has(p.id) && seen.add(p.id)));
          const currentActiveId = loadState<string>("activePromptProfileId", "");
          if (currentActiveId && loadedAgents.some((a) => a.id === currentActiveId)) setActivePromptProfileId(currentActiveId);
          const currentActiveAgentIds = loadState<string[]>("activeAgentIds", []);
          const agentIds = validAgentIds(currentActiveAgentIds, loadedAgents);
          if (agentIds.length) setActiveAgentIds(agentIds);
        });
      const usersTask = fetch("/api/users")
        .then((res) => res.json())
        .then((data: { users?: UserProfile[] }) => {
          const loadedUsers = Array.isArray(data.users) ? data.users.map(normalizeUser) : [];
          if (loadedUsers.length) {
            const seen = new Set<string>();
            const deduped = loadedUsers.filter((u) => !seen.has(u.id) && seen.add(u.id));
            setUserProfiles(deduped);
            saveState("userProfiles", deduped);
            const savedActiveUserId = loadState("activeUserId", "");
            if (savedActiveUserId && deduped.some((u) => u.id === savedActiveUserId)) {
              setActiveUserId(savedActiveUserId);
            } else {
              setActiveUserId(deduped[0].id);
              saveState("activeUserId", deduped[0].id);
            }
          }
        });
      const assetInventoryTask = fetch("/api/modules/assets/inventory?refresh=true")
        .then((res) => res.json())
        .then((data: { inventory?: LocalModuleAssetInventory }) => {
          const assets = normalizeBackgroundAssets(data.inventory?.chatBackgrounds);
          const embodyInventory = data.inventory?.modules?.embody && typeof data.inventory.modules.embody === "object" ? data.inventory.modules.embody as { voiceforge?: { audio?: ModuleAssetItem[]; backgrounds?: ModuleAssetItem[] } } : undefined;
          const vrmInventory = data.inventory?.modules?.vrm && typeof data.inventory.modules.vrm === "object" ? data.inventory.modules.vrm as VrmAssetInventory : undefined;
          const animations = Array.isArray(vrmInventory?.animations) ? vrmInventory.animations.map((asset) => asset.url).filter(Boolean) : [];
          const audio = [...(Array.isArray(embodyInventory?.voiceforge?.backgrounds) ? embodyInventory.voiceforge.backgrounds : []), ...(Array.isArray(embodyInventory?.voiceforge?.audio) ? embodyInventory.voiceforge.audio : [])]
            .map((asset) => ({ name: String(asset.name || asset.url || ""), url: String(asset.url || "") }))
            .filter((asset) => asset.url);
          assetInventoryLoadedRef.current = true;
          setBackgroundAssets(assets);
          setEmbodyAudioAssets(audio);
          setVrmAnimations(animations);
          saveState(BACKGROUND_ASSETS_CACHE_KEY, assets);
        })
        .catch(() => undefined);
      const workspaceStateTask = fetch("/api/workspace-state")
        .then((res) => res.json())
        .then((data) => {
          const state = data?.state && typeof data.state === "object" && !Array.isArray(data.state) ? data.state as { composerHistory?: unknown } : {};
          if (Array.isArray(state.composerHistory)) setComposerUserHistory(state.composerHistory.map((item) => String(item || "").trim()).filter(Boolean).slice(-COMPOSER_USER_HISTORY_LIMIT));
        })
        .catch(() => undefined)
        .finally(() => setWorkspaceStateLoaded(true));
      await boundedBootTask(Promise.all([
        appStateTask,
        agentsTask,
        assetInventoryTask,
        workspaceStateTask,
        hotBackgroundUrl ? prefetchAssetUrl(hotBackgroundUrl) : Promise.resolve()
      ]));
      appStateReadyRef.current = true;
      if (!cancelled) setIsBooting(false);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("/api/modules").then((res) => res.json()),
      fetch("/api/settings/themes").then((res) => res.json()).catch(() => ({ themes: [] }))
    ])
      .then(([manifests, themeLibrary]: [ModuleManifest[], { themes?: unknown }]) => {
        const fileThemes = Array.isArray(themeLibrary.themes) ? themeLibrary.themes : [];
        setModuleManifests(manifests);
        setModules((current) => {
          const saved = current.length ? current : loadSavedModules();
          return manifests.map((manifest) => {
            const savedCfg = saved.find((item) => item.id === manifest.id);
            const nextConfig = savedCfg
              ? { ...savedCfg, id: manifest.id, settings: normalizeModuleSettings(manifest, savedCfg.settings ?? {}) }
              : { id: manifest.id, enabled: manifest.defaultEnabled, settings: manifest.defaultSettings };
            return nextConfig;
          });
          setAppearanceSettings((current) => {
            const themes = fileThemes as Record<string, unknown>[];
            const activeThemeId = themes.some((theme) => String(theme.id || "") === current.activeThemeId)
              ? current.activeThemeId
              : String(themes[0]?.id || "");
            return { ...current, themes, activeThemeId };
          });
        });
        setModulesLoaded(true);
      })
      .catch(() => setError("Could not load module registry."));
  }, []);

  useEffect(() => {
    const refreshBackgroundAssets = () => {
      if (assetInventoryLoadedRef.current) return;
      fetch("/api/modules/assets/backgrounds")
        .then((res) => res.json())
        .then((assets: BackgroundAsset[]) => {
          const nextAssets = normalizeBackgroundAssets(assets);
          setBackgroundAssets(nextAssets);
          saveState(BACKGROUND_ASSETS_CACHE_KEY, nextAssets);
        })
        .catch(() => undefined);
    };
    const timer = window.setTimeout(refreshBackgroundAssets, 1000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const asset = backgroundAssetFromUrl(activeBackgroundUrl, backgroundAssets);
    if (!asset) return;
    if (asset.type === "video") {
      const video = document.createElement("video");
      video.preload = "auto";
      video.muted = true;
      video.src = asset.url;
      video.load();
      return;
    }
    const image = new Image();
    image.decoding = "async";
    image.src = asset.url;
  }, [activeBackgroundUrl, backgroundAssets]);

  useEffect(() => {
    function onAudioAssets(event: Event) {
      const assets = (event as CustomEvent<{ assets?: EmbodyAudioAsset[] }>).detail?.assets;
      if (Array.isArray(assets)) setEmbodyAudioAssets(assets.filter((asset) => asset?.url));
    }

    window.addEventListener("nitral-embody-audio-assets", onAudioAssets);
    return () => window.removeEventListener("nitral-embody-audio-assets", onAudioAssets);
  }, []);

  useEffect(() => {
    voiceForgeTtsVolumeRef.current = Math.max(0, Math.min(100, Number(callModeTtsVolume) || 0));
    getVoiceForgeAudioManager().then(mgr => mgr?.setTtsVolume(callModeTtsVolume)).catch(() => {});
  }, [callModeTtsVolume]);

  useEffect(() => {
    const settings = settingObject(moduleConfigById.get("voiceforge")?.settings);
    const bgVolume = Math.max(0, Math.min(100, Number(settings.audioVoiceForgeBackgroundVolume ?? 30) || 0));
    const bgPersist = settings.audioVoiceForgeBackgroundPersist !== false;
    getVoiceForgeAudioManager().then((mgr) => {
      mgr?.setVoiceForgeBgVolume?.(bgVolume);
      mgr?.setVoiceForgeBgPersist?.(bgPersist);
    }).catch(() => {});
  }, [moduleConfigById]);

  const VOICEFORGE_AUDIO_MODULE_URL = "/assets/modules/embody/voiceforge/audio.js?v=native-audio-4";
  let voiceForgeAudioManagerPromise: Promise<{
    setTtsVolume: (v: number) => void;
    setVoiceForgeBgVolume?: (v: number) => void;
    setVoiceForgeBgPersist?: (persist: boolean) => void;
    playTtsBlob: (blob: Blob, onStart?: (durationMs: number) => void | Promise<void>) => Promise<void>;
    stopTtsPlayback: () => void;
    initTtsContext?: () => void;
    startVoiceForgeBackground?: (bgInfo: Record<string, unknown>, characterName?: string) => Promise<void>;
    stopVoiceForgeBackground?: (fadeOut?: number, force?: boolean) => Promise<void>;
  } | null> | null = null;
  function getVoiceForgeAudioManager() {
    if (!voiceForgeAudioManagerPromise) {
      voiceForgeAudioManagerPromise = import(/* @vite-ignore */ VOICEFORGE_AUDIO_MODULE_URL)
        .then((m) => m.getAudioManager())
        .catch(() => null);
    }
    return voiceForgeAudioManagerPromise;
  }

  async function ensureCallModeRuntime() {
    if (callModeRuntimeLoadRef.current) return callModeRuntimeLoadRef.current;
    callModeRuntimeLoadRef.current = (async () => {
      const callModeUrl = "/assets/modules/embody/callmode/call-mode.js?v=callmode-native-8";
      const callMode = await import(/* @vite-ignore */ callModeUrl);
      callModeModuleRef.current = callMode;
      syncEmbodyRuntimeState();
      callMode.initCallMode?.();
      syncCallModeUiState();
    })();
    return callModeRuntimeLoadRef.current;
  }

  async function ensureIntifaceRuntime() {
    if (intifaceRuntimeLoadRef.current) return intifaceRuntimeLoadRef.current;
    intifaceRuntimeLoadRef.current = (async () => {
      const buttplug = await import("buttplug");
      const cdUrl = "/assets/modules/intiface/intiface/connected_devices.js";
      const cd = await import(/* @vite-ignore */ cdUrl);
      const cdApi = await cd.initConnectedDevices(buttplug);
      const intifaceConfig = modules.find((item) => item.id === "intiface");
      const intifaceSettings = settingObject(intifaceConfig?.settings);
      if (!cdApi.isClientConnected() && intifaceSettings.intifaceAutoConnect === true) {
        await cdApi.connect(true).catch(() => {});
      }
    })();
    return intifaceRuntimeLoadRef.current;
  }

  function syncCallModeUiState() {
    const runtime = callModeModuleRef.current;
    if (!runtime) return;
    const active = runtime.isCallActive?.() === true;
    setCallModeStatus(active ? (runtime.getCallState?.() as "idle" | "connecting" | "listening" | "processing") || "listening" : "idle");
    setCallModeMuted(runtime.isCallMuted?.() === true);
  }

  function syncEmbodyRuntimeState() {
    const callMode = callModeModuleRef.current;
    if (!callMode) return;
    const voiceForgeConfig = modules.find((item) => item.id === "voiceforge");
    const callModeConfig = modules.find((item) => item.id === "callmode");
    const hypnoConfig = modules.find((item) => item.id === "hypno");
    const settings = {
      ...settingObject(voiceForgeConfig?.settings),
      ...settingObject(callModeConfig?.settings),
      ...callModeHypnoSettings(hypnoConfig?.enabled === true, settingObject(hypnoConfig?.settings))
    };
    const selectedProfiles = selectedPromptProfiles();
    const primaryProfile = primaryPromptProfile();
    callMode.setNitralEmbodyRuntimeState?.({
      chat: messagesRef.current,
      characters: selectedProfiles.map((profile) => profile.assistantName || profile.name).filter(Boolean),
      activeAgentId: primaryProfile.id,
      activeAgentName: primaryProfile.assistantName || primaryProfile.name,
      settings,
      ttsVolume: callModeTtsVolume,
      userName: activeUser?.name || "User",
      suppressOverlay: activePage === "editor",
      callbacks: {
        cancelTtsPlay: () => {
          cancelVoiceForgePlaybackState();
          getVoiceForgeAudioManager().then(mgr => mgr?.stopTtsPlayback()).catch(() => {});
        },
        prewarmTtsContext: () => {
          getVoiceForgeAudioManager().then(mgr => mgr?.initTtsContext?.()).catch(() => {});
        },
        stopBackground: () => {
          getVoiceForgeAudioManager().then(mgr => mgr?.stopVoiceForgeBackground?.(0.5, true)).catch(() => {});
        },
        onMicLevel: (payload: { level?: unknown }) => {
          const level = Math.max(0, Math.min(1, Number(payload?.level) || 0));
          const now = performance.now();
          if (now - callModeLevelUiRef.current.lastUpdateAt < 50 && Math.abs(level - callModeLevelUiRef.current.lastLevel) < 0.025) return;
          callModeLevelUiRef.current = { lastLevel: level, lastUpdateAt: now };
          setCallModeLevel(level);
        },
        generate: async () => {
          const current = stripAssistantMetadataPrefixes(messagesRef.current);
          const rollback = current.slice(0, Math.max(0, current.length - 1));
          await generateAssistantResponses(current, rollback);
        },
        sendMessageAsUser: async (message: unknown, metadataPrefix?: unknown) => {
          const prefix = typeof metadataPrefix === "string" && metadataPrefix.trim() ? `${metadataPrefix.trim()}\n` : "";
          const text = `${prefix}${String(message || "").trim()}`.trim();
          if (!text) return;
          const userMessage = createMessage("user", text);
          const nextMessages = stripAssistantMetadataPrefixes([...messagesRef.current, userMessage]);
          messagesRef.current = nextMessages;
          setChatMessages(nextMessages);
          setComposerDraft("");
        },
        sendMessageAsSystem: async (message: unknown) => {
          const text = String(message || "").trim();
          if (!text) return;
          const systemMessage = createMessage("system", text);
          const nextMessages = stripAssistantMetadataPrefixes([...messagesRef.current, systemMessage]);
          messagesRef.current = nextMessages;
          setChatMessages(nextMessages);
        },
        stopGeneration: () => activeStreamAbortRef.current?.abort()
      }
    });
  }

  useEffect(() => {
    syncEmbodyRuntimeState();
  }, [activeAgentIds, activePage, activePromptProfileId, callModeTtsVolume, modules, promptProfiles]);

  useEffect(() => {
    const callModeConfig = modules.find((item) => item.id === "callmode");
    if (callModeConfig?.enabled === true) ensureCallModeRuntime().catch(() => undefined);
  }, [modules]);

  useEffect(() => {
    const intifaceConfig = modules.find((item) => item.id === "intiface");
    if (intifaceConfig?.enabled === true) ensureIntifaceRuntime().catch(() => undefined);
  }, [modules]);

  useEffect(() => {
    const voiceForgeConfig = modules.find((item) => item.id === "voiceforge");
    const settings = settingObject(voiceForgeConfig?.settings);
    if (voiceForgeConfig?.enabled !== true || settings.voiceforgeEnabled !== true) return;
    const endpoint = String(settings.voiceforgeProviderEndpoint || "").replace(/\/+$/, "");
    if (!endpoint || voiceForgeDiscoveryWarmEndpointRef.current === endpoint) return;
    voiceForgeDiscoveryWarmEndpointRef.current = endpoint;
    fetch("/api/modules/voiceforge/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint })
    }).catch(() => undefined);
  }, [modules]);

  useEffect(() => {
    const hypnoConfig = modules.find((item) => item.id === "hypno");
    const settings = settingObject(hypnoConfig?.settings);
    if (hypnoConfig?.enabled === true && settings.spokenWhispersEnabled === true) {
      ensureCallModeRuntime().catch(() => undefined);
    }
  }, [activeAgentIds, modules, promptProfiles]);

  useEffect(() => {
    if (!callModeModuleRef.current) return;
    const timer = window.setInterval(syncCallModeUiState, 200);
    return () => window.clearInterval(timer);
  }, [callModeStatus]);

  useEffect(() => {
    const backgroundMusicConfig = moduleConfigById.get("background-music");
    const settings = settingObject(backgroundMusicConfig?.settings);
    const audioEnabled = backgroundMusicConfig?.enabled === true && settings.audioEnabled === true;
    let audio = bgmAudioRef.current;
    if (!audio) {
      audio = new Audio();
      audio.id = "nitral_bgm_audio";
      audio.loop = true;
      audio.preload = "auto";
      bgmAudioRef.current = audio;
    }

    if (!audioEnabled) {
      audio.pause();
      audio.removeAttribute("src");
      return;
    }

    const manualAudio = settings.audioBgmLocked === true;
    const randomAudio = settings.audioBgmRandom === true;
    const selected = String(settings.audioBgmSelected || "").trim();
    const background = backgroundAssetFromUrl(activeBackgroundUrl, backgroundAssets);
    const randomIndex = stableIndex(`${background?.url || activeBackgroundUrl}|${embodyAudioAssets.length}`, embodyAudioAssets.length);
    const randomMatched = randomAudio && randomIndex >= 0 ? embodyAudioAssets[randomIndex]?.url || "" : "";
    const matched = !manualAudio && !randomAudio ? bestMatchingAudio(background, embodyAudioAssets) : "";
    const src = manualAudio ? selected : randomMatched || matched || selected;
    const muted = settings.audioBgmMuted !== false;
    const volume = Math.max(0, Math.min(1, (Number(settings.audioBgmVolume ?? 50) || 0) / 100));
    window.dispatchEvent(new CustomEvent("nitral-bgm-current-track", { detail: { src } }));

    audio.loop = true;
    audio.muted = muted;
    audio.volume = volume;

    if (!src) {
      audio.pause();
      audio.removeAttribute("src");
      return;
    }

    if (audio.getAttribute("src") !== src) {
      audio.src = src;
      audio.load();
    }

    if (muted) {
      audio.pause();
      return;
    }

    audio.play().catch(() => undefined);
  }, [moduleConfigById, activeBackgroundUrl, backgroundAssets, embodyAudioAssets]);

  async function refreshReminders(force = true) {
    if (!force && reminderCacheExpiresAtRef.current > Date.now()) return;
    if (reminderRefreshPromiseRef.current) {
      if (!force) return reminderRefreshPromiseRef.current;
      await reminderRefreshPromiseRef.current.catch(() => undefined);
    }
    reminderRefreshPromiseRef.current = (async () => {
      const res = await fetch("/api/modules/scheduled-items");
      if (!res.ok) throw new Error("Could not load scheduled items.");
      const data = await res.json();
      setReminders(Array.isArray(data.items) ? data.items : []);
      reminderCacheExpiresAtRef.current = Date.now() + 10000;
    })().finally(() => {
      reminderRefreshPromiseRef.current = null;
    });
    return reminderRefreshPromiseRef.current;
  }

  async function createReminder(reminder: { kind?: "reminder" | "alarm"; title: string; at: string; note?: string }) {
    const res = await fetch("/api/modules/scheduled-items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...reminder, at: normalizeReminderAt(reminder.at) })
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not create scheduled item.");
    await refreshReminders();
  }

  async function deleteReminder(id: string) {
    await fetch(`/api/modules/scheduled-items/${encodeURIComponent(id)}`, { method: "DELETE" });
    await refreshReminders();
  }

  async function refreshBasicModules(force = true) {
    if (!force && basicModuleCacheExpiresAtRef.current > Date.now()) return;
    if (basicModuleRefreshPromiseRef.current) {
      if (!force) return basicModuleRefreshPromiseRef.current;
      await basicModuleRefreshPromiseRef.current.catch(() => undefined);
    }
    basicModuleRefreshPromiseRef.current = (async () => {
      const [memoryData, taskData, noteData, docData, summaryData, eventData] = await Promise.all([
        fetch(`/api/modules/memory?agentId=${encodeURIComponent(activePromptProfile.id)}`).then((res) => res.json()).catch(() => ({})),
        fetch("/api/modules/tasks").then((res) => res.json()).catch(() => ({})),
        fetch("/api/modules/notes").then((res) => res.json()).catch(() => ({})),
        fetch("/api/modules/file-library").then((res) => res.json()).catch(() => ({})),
        fetch("/api/modules/session-summary").then((res) => res.json()).catch(() => ({})),
        fetch("/api/modules/module-event-log?limit=100").then((res) => res.json()).catch(() => ({}))
      ]);
      setMemories(Array.isArray(memoryData.memories) ? memoryData.memories : []);
      setTasks(Array.isArray(taskData.tasks) ? taskData.tasks : []);
      setNotes(Array.isArray(noteData.notes) ? noteData.notes : []);
      setDocuments(Array.isArray(docData.documents) ? docData.documents : []);
      setSummaries(Array.isArray(summaryData.summaries) ? summaryData.summaries : []);
      setModuleEvents(Array.isArray(eventData.events) ? eventData.events : []);
      basicModuleCacheExpiresAtRef.current = Date.now() + 10000;
    })().finally(() => {
      basicModuleRefreshPromiseRef.current = null;
    });
    return basicModuleRefreshPromiseRef.current;
  }

  async function postJson(url: string, body: unknown, method = "POST") {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Request failed.");
    return res.json();
  }

  function formatBytes(bytes: number) {
    const size = Number(bytes) || 0;
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }

  async function viewLibraryDocument(id: string) {
    const res = await fetch(`/api/modules/file-library/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not load document.");
    const data = await res.json();
    setSelectedDocument(data.document || null);
  }

  async function deleteLibraryDocument(id: string) {
    const doc = documents.find((item) => item.id === id);
    if (doc && !window.confirm(`Remove "${doc.name}" from File Library?`)) return;
    await fetch(`/api/modules/file-library/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (selectedDocument?.id === id) setSelectedDocument(null);
    await refreshBasicModules();
  }

  async function refreshNotifications(force = true) {
    if (!force && notificationCacheExpiresAtRef.current > Date.now()) return;
    if (notificationRefreshPromiseRef.current) {
      if (!force) return notificationRefreshPromiseRef.current;
      await notificationRefreshPromiseRef.current.catch(() => undefined);
    }
    notificationRefreshPromiseRef.current = (async () => {
      const data = await fetch("/api/modules/notifications").then((res) => res.json()).catch(() => ({}));
      setNotifications(Array.isArray(data.notifications) ? data.notifications : []);
      notificationCacheExpiresAtRef.current = Date.now() + 10000;
    })().finally(() => {
      notificationRefreshPromiseRef.current = null;
    });
    return notificationRefreshPromiseRef.current;
  }

  function openAuditLog() {
    setExpandedModuleId("module-event-log");
    setActivePage("modules");
  }

  async function notifyApp(input: Partial<NotificationItem>) {
    const toast: ToastItem = { id: crypto.randomUUID(), kind: input.kind || "info", title: String(input.title || "ErisHub"), message: String(input.message || ""), createdAt: Date.now() };
    setToasts((current) => [toast, ...current].slice(0, 5));
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== toast.id)), 5200);
    const notificationsEnabled = modules.some((item) => item.id === "organizer" && item.enabled);
    if (!notificationsEnabled) return;
    const data = await postJson("/api/modules/notifications", input).catch(() => null);
    await refreshNotifications().catch(() => undefined);
    const settings = modules.find((item) => item.id === "organizer")?.settings;
    if (settings?.browserNotifications === true && "Notification" in window) {
      if (Notification.permission === "default") await Notification.requestPermission().catch(() => "denied");
      if (Notification.permission === "granted") new Notification(String(input.title || data?.notification?.title || "ErisHub"), { body: String(input.message || "") });
    }
  }

  function dismissToast(id: string) {
    setToasts((current) => current.filter((item) => item.id !== id));
  }

  function copyText(value: string) {
    if (!value.trim()) return;
    navigator.clipboard?.writeText(value).catch(() => undefined);
  }

  function copyAndDismissAppError() {
    copyText(["Error", error].filter(Boolean).join("\n"));
    setError("");
  }

  function copyAndDismissToast(toast: ToastItem) {
    copyText([toast.title, toast.message].filter(Boolean).join("\n"));
    dismissToast(toast.id);
  }

  function actionResultSummary(results: ActionResultItem[]) {
    return results.filter((item) => !String(item.action?.type || "").startsWith("hypno.")).map(actionResultMessage).join("\n\n");
  }

  async function notifyActionResults(results: ActionResultItem[]) {
    for (const item of results) {
      if (item.action?.type === "hypno.session.start" && (item.status === "executed" || item.status === "continuation-required")) {
        const payload = item.result && typeof item.result === "object" ? item.result as { notification?: Partial<NotificationItem> } : {};
        await notifyApp({ kind: "success", title: "Entering hypno mode", message: String(payload.notification?.message || "Guided relaxation session started."), source: "hypno" });
        continue;
      }
      if (String(item.action?.type || "").startsWith("hypno.") && item.status === "executed") continue;
      const ok = item.status === "executed" || item.status === "continuation-required";
      await notifyApp({ kind: ok ? "success" : "error", title: ok ? "Action completed" : "Action failed", message: actionResultMessage(item).replace(/\n/g, " · "), source: "action-bus" });
    }
  }

  function playAlarmSound() {
    const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const ctx = new AudioContextCtor();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.4);
    gain.connect(ctx.destination);
    [0, 0.36, 0.72, 1.08].forEach((offset) => {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.setValueAtTime(880, ctx.currentTime + offset);
      osc.connect(gain);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.18);
    });
    window.setTimeout(() => ctx.close().catch(() => undefined), 1700);
  }

  async function generateReminderDueReply(due: ReminderItem[]) {
    if (due.length === 0 || generationInFlightRef.current) return;
    const content = due.map((item) => `${reminderKindLabel(item)} due now: ${reminderDueDisplayTitle(item)}${reminderDueDisplayNote(item)}`).join("\n");
    const userMessage = createMessage("user", content);
    const nextMessages = stripAssistantMetadataPrefixes([...messagesRef.current, userMessage]);
    setChatMessages(nextMessages);
    await generateAssistantResponses(nextMessages, stripAssistantMetadataPrefixes(messagesRef.current.filter((message) => message.id !== userMessage.id)));
  }

  function isGenericRelativeReminderText(value: string) {
    return /^(alarm|reminder)\s+(in|for|after)\s+\d+\s*(minute|minutes|hour|hours|day|days)\b/i.test(value.trim())
      || /^set\s+\w+\s+(minute|minutes|hour|hours|day|days)\s+from\s+now\.?$/i.test(value.trim());
  }

  function reminderKindLabel(item: Pick<ReminderItem, "kind">) {
    if (item.kind === "alarm") return "Alarm";
    return "Reminder";
  }

  function reminderDueDisplayTitle(item: ReminderItem) {
    const title = item.title.trim();
    if (isGenericRelativeReminderText(title)) return reminderKindLabel(item);
    return title || reminderKindLabel(item);
  }

  function reminderDueDisplayNote(item: ReminderItem) {
    const note = item.note?.trim();
    if (!note || isGenericRelativeReminderText(note)) return "";
    return ` (${note})`;
  }

  async function refreshAfterActionResults(actionResults: unknown, messageId?: string) {
    if (!Array.isArray(actionResults) || actionResults.length === 0) return;
    const results = actionResults as ActionResultItem[];
    for (const item of results.filter((item) => item.status === "executed")) {
      const attrs = item.action?.attrs || {};
      if (item.action?.type === "audio.play") playCueAudio({ type: "audio.play", attrs, body: item.action?.body || "" });
      if (item.action?.type === "intiface.play" || item.action?.type === "intiface.stop") {
        window.dispatchEvent(new CustomEvent("nitral-intiface-action", { detail: { type: item.action.type, attrs: { ...attrs, skipLead: "true" }, body: item.action?.body || "" } }));
      }
    }
    const actionTypes = new Set(results.map((item) => item.action?.type).filter(Boolean));
    await notifyActionResults(results).catch(() => undefined);
    await refreshBasicModules().catch(() => undefined);
    if (actionTypes.has("schedule.create")) await refreshReminders().catch(() => undefined);
    if (actionTypes.has("calendar.create") || actionTypes.has("calendar.update")) await refreshBasicModules(true).catch(() => undefined);
    if (actionTypes.has("notification.create")) await refreshNotifications().catch(() => undefined);
    for (const result of results.filter((item) => (item.status === "executed" || item.status === "continuation-required") && String(item.action?.type || "").startsWith("hypno."))) {
      const payload = result.result && typeof result.result === "object" ? result.result as { settings?: Record<string, unknown> } : {};
      const patch = payload.settings && typeof payload.settings === "object" ? payload.settings : {};
      for (const [key, value] of Object.entries(patch)) {
        if (key === "appendVisualWhisper") {
          const current = settingObject(moduleConfigById.get("hypno")?.settings);
          const lines = String(current.visualWhispers || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
          const next = String(value || "").trim();
          if (next && !lines.some((item) => item.toLowerCase() === next.toLowerCase())) updateModuleSetting("hypno", "visualWhispers", [...lines, next].join("\n"));
        } else {
          updateModuleSetting("hypno", key, value);
        }
      }
    }
    for (const [index, result] of results.filter((item) => item.status === "executed" && item.action?.type === "image.generate").entries()) {
      const payload = settingObject(result.result);
      const prompt = String(payload.prompt || result.action?.attrs?.prompt || result.action?.body || "").trim();
      if (prompt) {
        const runId = messageId ? `${messageId}:${index}` : `action:${result.action?.type}:${Date.now()}:${index}`;
        if (!imageRuns[runId]) generateImage(runId, prompt, activePromptProfileId);
      }
    }
    for (const [index, result] of results.filter((item) => item.status === "executed" && item.action?.type === "video.generate").entries()) {
      const payload = settingObject(result.result);
      const prompt = String(payload.prompt || result.action?.attrs?.prompt || result.action?.body || "").trim();
      if (prompt) {
        const runId = messageId ? `${messageId}:video:${index}` : `action:${result.action?.type}:${Date.now()}:${index}`;
        if (!videoRuns[runId]) generateVideo(runId, prompt, activePromptProfileId);
      }
    }
    const blocked = results.find((item) => item.status === "blocked" && item.error);
    if (blocked?.error) setError(String(blocked.error));
  }

  async function runRelationshipAnalyzer(assistantContent: string, responseProfile_: PromptProfile) {
    const relMeterConfig = modules.find((m) => m.id === "relationship-meter");
    if (relMeterConfig?.enabled !== true) return;
    const relSettings = settingObject(relMeterConfig.settings);
    const analyzerAgentId = String(relSettings.analyzerAgentId || "").trim();
    if (!analyzerAgentId) return;
    const analyzerProfile = promptProfiles.find((p) => p.id === analyzerAgentId);
    if (!analyzerProfile) return;
    const lastUser = [...messagesRef.current].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    const currentAgentRelationships = (relSettings.relationships && typeof relSettings.relationships === "object" ? relSettings.relationships as Record<string, unknown> : {})[activePromptProfileId] || {};
    const relPayload = {
      currentRelationships: currentAgentRelationships,
      agentProfile: { name: responseProfile_.assistantName || responseProfile_.name, id: responseProfile_.id },
      conversationHistory: [
        { role: "user", content: String(lastUser.content || "").slice(0, 1000) },
        { role: "assistant", content: String(assistantContent || "").slice(0, 1000) }
      ]
    };
    const response = await fetch("/api/modules/relationship-meter/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ ...createMessage("user", JSON.stringify(relPayload, null, 2)), id: `rel-analyze-${Date.now()}` }],
        promptProfile: analyzerProfile,
        provider: providerForAgent(analyzerProfile),
        modules: modules.map((m) => m.id === "relationship-meter" ? { ...m, enabled: false } : m)
      })
    });
    if (!response.ok) return;
    const data = await response.json().catch(() => ({}));
    const parsed = extractJsonObject(String(data?.content || ""));
    if (!parsed || typeof parsed !== "object" || !("mood" in parsed)) return;
    const meterKeys = ["mood", "relationshipLevel", "affinity", "trust", "comfort", "familiarity", "attraction", "chemistry", "romance", "intimacy", "devotion", "arousal", "tension", "irritation", "jealousy"];
    const relPatch: Record<string, unknown> = {};
    for (const key of meterKeys) {
      if (key in parsed) relPatch[key] = parsed[key as keyof typeof parsed];
    }
    if (Object.keys(relPatch).length === 0) return;
    const current = settingObject(relMeterConfig.settings);
    const relationships = { ...(typeof current.relationships === "object" && current.relationships !== null ? current.relationships as Record<string, unknown> : {}) };
    relationships[activePromptProfileId] = { ...(typeof relationships[activePromptProfileId] === "object" && relationships[activePromptProfileId] !== null ? relationships[activePromptProfileId] as Record<string, unknown> : {}), ...relPatch };
    applyModuleSettingsPatch("relationship-meter", { relationships });
  }

  useEffect(() => {
    if (!remindersEnabled) return;
    refreshReminders(false).catch(() => undefined);
    const timer = window.setInterval(async () => {
      const res = await fetch("/api/modules/scheduled-items/due", { method: "POST" }).catch(() => null);
      if (!res?.ok) return;
      const data = await res.json().catch(() => ({}));
      const due = Array.isArray(data.due) ? data.due as ReminderItem[] : [];
      if (due.length > 0) {
        if (due.some((item) => item.kind === "alarm")) playAlarmSound();
        due.forEach((item) => notifyApp({ kind: item.kind, title: `${reminderKindLabel(item)} due`, message: reminderDueDisplayTitle(item), source: "reminders" }).catch(() => undefined));
        if (reminderSettings()?.includeProgress !== false) alert(due.map((item) => `${reminderKindLabel(item)}: ${reminderDueDisplayTitle(item)}`).join("\n"));
        generateReminderDueReply(due).catch(() => undefined);
        refreshReminders().catch(() => undefined);
      }
    }, 30000);
    return () => window.clearInterval(timer);
  }, [remindersEnabled]);

  useEffect(() => {
    if (basicModulePanelOpen) {
      refreshBasicModules(false).catch(() => undefined);
    }
  }, [basicModulePanelOpen, expandedModuleId]);

  useEffect(() => { setProvider(activeProvider); }, [activeProvider]);
  useEffect(() => { setPromptProfile(activePromptProfile); }, [activePromptProfile]);

  useEffect(() => {
    if (promptProfiles.length === 0) return;
    const nextActiveAgentIds = validAgentIds(activeAgentIds, promptProfiles);
    const normalizedActiveAgentIds = nextActiveAgentIds.length ? nextActiveAgentIds : [promptProfiles[0].id];
    if (JSON.stringify(activeAgentIds) !== JSON.stringify(normalizedActiveAgentIds)) setActiveAgentIds(normalizedActiveAgentIds);
    if (!promptProfiles.some((profile) => profile.id === activePromptProfileId)) setActivePromptProfileId(normalizedActiveAgentIds[0]);

    const normalizedSessions = sessions.map((session) => normalizedSessionAgents(session, promptProfiles));
    if (JSON.stringify(sessions.map((session) => session.agentIds)) !== JSON.stringify(normalizedSessions.map((session) => session.agentIds))) setSessions(normalizedSessions);
  }, [activeAgentIds, activePromptProfileId, promptProfiles, sessions]);
  useEffect(() => {
    if (!activeSessionId) return;
    const activeProfile = resolveActiveChatAgent(activeAgentIds, promptProfiles);
    if (!activeProfile) return;
    setSessions((current) => current.map((session) => {
      if (session.id !== activeSessionId) return session;
      const sessionAgentIds = validAgentIds(session.agentIds, promptProfiles);
      if (JSON.stringify(sessionAgentIds) === JSON.stringify(activeAgentIds) && session.promptProfile.id === activeProfile.id) return session;
      return { ...session, agentIds: activeAgentIds, promptProfile: activeProfile };
    }));
  }, [activeAgentIds, activeSessionId, promptProfiles]);
  useEffect(() => {
    weatherCache.summary = "";
    weatherCache.expiresAt = 0;
  }, [enabledModuleIdsSignature]);
  useEffect(() => {
    const settings = imageGenerationSettings();
    if (!settings || (settings.autoGenerateImages ?? settings.autoGenerate) !== true) return;
    for (const message of messages) {
      if (message.role !== "assistant") continue;
      for (const [index, prompt] of extractImagePrompts(message.content).entries()) {
        const runId = `${message.id}:${index}`;
        if (!imageRuns[runId]) generateImage(runId, prompt, message.agentId);
      }
    }
  }, [messages, modules]);
  useEffect(() => {
    const settings = imageGenerationSettings();
    if (!settings || settings.autoGenerateVideos !== true) return;
    const videoModel = String(settings.videoModel || "").trim();
    for (const message of messages) {
      if (message.role !== "assistant") continue;
      for (const [index, prompt] of extractVideoPrompts(message.content).entries()) {
        const runId = `${message.id}:video:${index}`;
        const run = videoRuns[runId];
        if (!run) generateVideo(runId, prompt, message.agentId);
        else if (run.status === "error" && videoModel) generateVideo(runId, prompt, message.agentId);
      }
    }
  }, [messages, modules]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { callModeLevelRef.current = callModeLevel; }, [callModeLevel]);
  useEffect(() => {
    document.body.dataset.nitralActivePage = activePage;
    document.dispatchEvent(new CustomEvent("nitral-active-page-change", { detail: { page: activePage } }));
  }, [activePage]);
  useEffect(() => {
    document.body.dataset.nitralChatManagerOpen = isChatManagerOpen ? "true" : "false";
    document.dispatchEvent(new CustomEvent("nitral-ui-panel-change", { detail: { panel: "chat-manager", open: isChatManagerOpen } }));
  }, [isChatManagerOpen]);
  useEffect(() => {
    function handleSetActivePage(event: Event) {
      const page = (event as CustomEvent<{ page?: AppPage | "provider" }>).detail?.page;
      if (page === "provider") {
        setActivePage("settings");
        return;
      }
      if (page === "chat" || page === "editor" || page === "settings" || page === "agents" || page === "modules") {
        setActivePage(page);
      }
    }
    document.addEventListener("nitral-set-active-page", handleSetActivePage);
    return () => document.removeEventListener("nitral-set-active-page", handleSetActivePage);
  }, []);
  function createAppStateSnapshot(overrides: Partial<AppStateSnapshot> = {}): AppStateSnapshot {
    const snapshotModules = stripAppStateVolatileData(overrides.modules ?? modules);
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      providerProfiles: overrides.providerProfiles ?? providerProfiles,
      activeProviderId: overrides.activeProviderId ?? activeProviderId,
      promptProfiles: overrides.promptProfiles ?? promptProfiles,
      activePromptProfileId: overrides.activePromptProfileId ?? activePromptProfileId,
      modules: snapshotModules,
      activeAgentIds: overrides.activeAgentIds ?? activeAgentIds,
      activePage: overrides.activePage ?? activePage,
      activeSessionId: overrides.activeSessionId ?? activeSessionId,
      currentChatTitle: overrides.currentChatTitle ?? currentChatTitle,
      sessions: overrides.sessions ?? sessions,
      messages: overrides.messages ?? messages,
      imageRuns: overrides.imageRuns ?? imageRuns,
      videoRuns: overrides.videoRuns ?? videoRuns,
      chatSettings: overrides.chatSettings ?? chatSettings,
      appearanceSettings: overrides.appearanceSettings ?? appearanceSettings,
      callModeTtsVolume: overrides.callModeTtsVolume ?? callModeTtsVolume
    };
  }

  function scheduleAppStateSave(snapshot: AppStateSnapshot, delayMs = 750) {
    latestAppStateSnapshotRef.current = stripAppStateVolatileData(snapshot);
    if (appStateSaveTimerRef.current !== null) window.clearTimeout(appStateSaveTimerRef.current);
    appStateSaveTimerRef.current = window.setTimeout(() => {
      appStateSaveTimerRef.current = null;
      const latest = latestAppStateSnapshotRef.current ?? stripAppStateVolatileData(snapshot);
      saveState(APP_STATE_CACHE_KEY, latest);
      const { promptProfiles: _profiles, ...serverState } = latest;
      fetch("/api/app-state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: serverState })
      }).catch(() => undefined);
    }, delayMs);
  }

  useEffect(() => {
    if (!appStateReadyRef.current) return;
    if (isSending) return;
    scheduleAppStateSave(createAppStateSnapshot());
  }, [providerProfiles, activeProviderId, promptProfiles, activePromptProfileId, modules, activeAgentIds, activePage, activeSessionId, currentChatTitle, sessions, messages, imageRuns, videoRuns, chatSettings, appearanceSettings, callModeTtsVolume, isSending]);

  useEffect(() => {
    if (!workspaceStateLoaded) return;
    const timer = window.setTimeout(() => {
      fetch("/api/workspace-state", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patch: { composerHistory: composerUserHistory } })
      }).catch(() => undefined);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [workspaceStateLoaded, composerUserHistory]);

  useEffect(() => {
    if (!appStateReadyRef.current) return;
    for (const profile of promptProfiles) {
      const videoUrl = String(profile.videoUrl || "").trim();
      if (!isRemoteHttpUrl(videoUrl) || localizingAgentVideoIdsRef.current.has(profile.id)) continue;
      localizingAgentVideoIdsRef.current.add(profile.id);
      fetch("/api/modules/image-generation/localize-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: videoUrl })
      })
        .then(async (response) => {
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(String(data?.error || "Video localization failed."));
          const localUrl = String(data?.url || "").trim();
          if (localUrl) updatePromptProfileById(profile.id, { videoUrl: localUrl });
        })
        .catch((error) => console.warn("[Agent video localization]", error));
    }
  }, [promptProfiles]);

  function setChatMessages(nextMessages: ChatMessage[]) {
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
  }

  function stripAssistantMetadataPrefix(message: ChatMessage): ChatMessage {
    if (message.role !== "assistant") return message;
    const content = message.content.replace(ASSISTANT_METADATA_PREFIX_RE, "");
    return content === message.content ? message : { ...message, content };
  }

  function stripAssistantMetadataPrefixes(nextMessages: ChatMessage[]) {
    return nextMessages.map(stripAssistantMetadataPrefix);
  }

  async function buildGenerationMetadataPrefix() {
    const environmentalConfig = modules.find((config) => config.id === "environmental-context");
    const envEnabled = environmentalConfig?.enabled === true && environmentalConfig.settings.prefixEnabled === true;
    const projectsConfig = modules.find((config) => config.id === "projects");
    const [weatherMetadata, editorContext] = await Promise.all([
      envEnabled ? weatherMetadataValue(environmentalConfig.settings) : Promise.resolve(""),
      projectsConfig?.enabled === true ? editorWorkspaceContext() : Promise.resolve({ metadata: "", note: "" })
    ]);
    const parts = [
      envEnabled ? timestampMetadataValue() : "",
      weatherMetadata,
      editorContext.metadata
    ].filter(Boolean);
    return { prefix: parts.length ? `<metadata: ${parts.join(" | ")}>` : "", note: editorContext.note };
  }

  useEffect(() => () => {
    if (appStateSaveTimerRef.current !== null) window.clearTimeout(appStateSaveTimerRef.current);
  }, []);

  useEffect(() => {
    const flushAppState = () => {
      const snapshot = latestAppStateSnapshotRef.current;
      if (!snapshot) return;
      const safeSnapshot = stripAppStateVolatileData(snapshot);
      saveState(APP_STATE_CACHE_KEY, safeSnapshot);
      const { promptProfiles: _p, ...serverSafe } = safeSnapshot;
      fetch("/api/app-state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: serverSafe }),
        keepalive: true
      }).catch(() => undefined);
    };
    const stopCallAndFlushAppState = () => {
      stopNativeCallMode();
      flushAppState();
    };
    const flushAppStateWhenHidden = () => { if (document.visibilityState === "hidden") flushAppState(); };
    window.addEventListener("beforeunload", stopCallAndFlushAppState);
    window.addEventListener("pagehide", stopCallAndFlushAppState);
    document.addEventListener("visibilitychange", flushAppStateWhenHidden);
    return () => {
      window.removeEventListener("beforeunload", stopCallAndFlushAppState);
      window.removeEventListener("pagehide", stopCallAndFlushAppState);
      document.removeEventListener("visibilitychange", flushAppStateWhenHidden);
    };
  }, []);

  function updateProvider(changes: Partial<ProviderConfig>) {
    const next = { ...provider, ...changes };
    setProvider(next);
    setProviderProfiles((current) => {
      const nextProfiles = current.map((item) => item.id === next.id ? next : item);
      scheduleAppStateSave(createAppStateSnapshot({ providerProfiles: nextProfiles }), 300);
      return nextProfiles;
    });
  }

  function addProvider() {
    const next = normalizeProvider({ id: crypto.randomUUID(), name: "New Provider" });
    setProviderProfiles((current) => [...current, next]);
    setActiveProviderId(next.id);
  }

  function deleteProvider(providerId: string) {
    if (providerProfiles.length <= 1) return;
    const nextProviders = providerProfiles.filter((item) => item.id !== providerId);
    setProviderProfiles(nextProviders);
    if (activeProviderId === providerId) {
      setActiveProviderId(nextProviders[0].id);
      setProvider(nextProviders[0]);
    }
  }

  function updatePromptProfile(changes: Partial<PromptProfile>) {
    updatePromptProfileById(activePromptProfileId, changes);
  }

  function updatePromptProfileById(profileId: string, changes: Partial<PromptProfile>) {
    const baseProfile = promptProfiles.find((item) => item.id === profileId) ?? activePromptProfile;
    const next = normalizePromptProfile({ ...baseProfile, ...changes });
    if (next.id === activePromptProfileId) setPromptProfile(next);
    setPromptProfiles((current) => current.map((item) => item.id === next.id ? next : item));
    fetch(`/api/agents/${profileId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) }).then((res) => { if (!res.ok) res.text().then((t) => console.error("Failed to save agent:", t)).catch(() => undefined); }).catch((err) => console.error("Failed to save agent:", err));
  }

  function addPromptProfile() {
    const next = normalizePromptProfile({ id: crypto.randomUUID(), name: "New Agent" });
    setPromptProfiles((current) => [...current, next]);
    setActivePromptProfileId(next.id);
    fetch(`/api/agents/${next.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) }).then((res) => { if (!res.ok) res.text().then((t) => console.error("Failed to save agent:", t)).catch(() => undefined); }).catch((err) => console.error("Failed to save agent:", err));
  }

  function deletePromptProfile(profileId: string) {
    if (promptProfiles.length <= 1) return;
    const nextProfiles = promptProfiles.filter((item) => item.id !== profileId);
    const nextActiveAgentIds = validAgentIds(activeAgentIds.filter((agentId) => agentId !== profileId), nextProfiles);
    const normalizedActiveAgentIds = nextActiveAgentIds.length ? nextActiveAgentIds : [nextProfiles[0].id];
    setPromptProfiles(nextProfiles);
    setActiveAgentIds(normalizedActiveAgentIds);
    setSessions((current) => current.map((session) => normalizedSessionAgents({ ...session, agentIds: (session.agentIds || [session.promptProfile.id]).filter((agentId) => agentId !== profileId) }, nextProfiles)));
    if (activePromptProfileId === profileId) setActivePromptProfileId(normalizedActiveAgentIds[0]);
    setPromptProfile(nextProfiles.find((profile) => profile.id === normalizedActiveAgentIds[0]) ?? nextProfiles[0]);
    fetch(`/api/agents/${profileId}`, { method: "DELETE" }).then((res) => { if (!res.ok) res.text().then((t) => console.error("Failed to delete agent:", t)).catch(() => undefined); }).catch((err) => console.error("Failed to delete agent:", err));
  }

  function addUserProfile() {
    const next: UserProfile = { id: crypto.randomUUID(), name: "New User", imageUrl: "", videoUrl: "", videoPreviewUrl: "", description: "", personality: "", appearance: "", responseGuidelines: "", preferences: "", dialogueExamples: "", startingMessage: "" };
    const nextList = [...(userProfiles || []), next];
    setUserProfiles(nextList);
    saveState("userProfiles", nextList);
    setActiveUserId(next.id);
    fetch("/api/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) }).then((res) => { if (!res.ok) res.text().then((t) => console.error("Failed to save user:", t)).catch(() => undefined); }).catch((err) => console.error("Failed to save user:", err));
  }

  function updateUserProfile(userId: string, changes: Partial<UserProfile>) {
    const next = userProfiles.map((u) => u.id === userId ? { ...u, ...changes } : u);
    setUserProfiles(next);
    saveState("userProfiles", next);
    const merged = next.find((u) => u.id === userId) ?? changes;
    fetch(`/api/users/${userId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(merged) }).then((res) => { if (!res.ok) res.text().then((t) => console.error("Failed to save user:", t)).catch(() => undefined); }).catch((err) => console.error("Failed to save user:", err));
  }

  function deleteUserProfile(userId: string) {
    if (userProfiles.length <= 1) return;
    const next = userProfiles.filter((u) => u.id !== userId);
    setUserProfiles(next);
    saveState("userProfiles", next);
    if (activeUserId === userId) {
      const fallbackId = next[0]?.id ?? defaultUser.id;
      setActiveUserId(fallbackId);
      saveState("activeUserId", fallbackId);
    }
    fetch(`/api/users/${userId}`, { method: "DELETE" }).then((res) => { if (!res.ok) res.text().then((t) => console.error("Failed to delete user:", t)).catch(() => undefined); }).catch((err) => console.error("Failed to delete user:", err));
  }

  function buildUserProfileImageSource(user: UserProfile) {
    const parts = [user.description, user.personality, user.appearance, user.responseGuidelines, user.preferences].filter(Boolean);
    return parts.join("\n").slice(0, 1800).replace(/\s+/g, " ").trim() || user.name;
  }

  function providerForUser(user: UserProfile) {
    return providerProfiles.find((p) => p.id === activeProviderId) ?? providerProfiles[0];
  }

  async function requestProfileMediaPrompt(kind: "avatar" | "live-card", sourceText: string, chatProvider: ProviderConfig, imageUrl = "") {
    const endpoint = kind === "avatar" ? "/api/agents/avatar-prompt" : "/api/agents/live-card-prompt";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceText, imageUrl, provider: chatProvider, modules })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(String(data?.error || `${kind === "avatar" ? "Avatar" : "Live card"} prompt generation failed.`));
    const prompt = String(data?.prompt || "").trim();
    if (!prompt) throw new Error(`${kind === "avatar" ? "Avatar" : "Live card"} prompt generation did not return a prompt.`);
    return prompt;
  }

  async function requestSteeredMediaPrompt(kind: "avatar" | "livecard", basePrompt: string, instruction: string, chatProvider: ProviderConfig) {
    const res = await fetch("/api/agents/steer-media-prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ basePrompt, instruction, provider: chatProvider, kind, modules })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(String(data?.error || "Prompt steering failed."));
    const prompt = String(data?.prompt || "").trim();
    if (!prompt) throw new Error("Prompt steering returned empty result.");
    return prompt;
  }

  async function generateProfileMedia(
    kind: "image" | "video",
    target: { id: string; imageUrl?: string },
    prompt: string,
    update: (patch: { imageUrl?: string; videoUrl?: string; videoPreviewUrl?: string }) => void
  ) {
    const settings = imageGenerationSettings();
    if (!settings) throw new Error("Enable Image Generation first.");
    const sourceImageUrl = String(target.imageUrl || "").trim();
    if (kind === "video" && !sourceImageUrl) throw new Error("Select or generate an image first.");
    if (kind === "video" && !String(settings.videoModel || "").trim()) throw new Error("Select a Video Model in Media Creation.");
    const mediaProvider = mediaProviderWithModel(settings, kind === "image" ? "imageModel" : "videoModel");
    if (!mediaProvider) throw new Error(kind === "image" ? "Select a media creation provider." : "Select a video-capable media creation provider.");
    const finalPrompt = imagePromptWithPrefixes(prompt, settings, target.id);
    const res = await fetch(`/api/modules/image-generation/${kind === "image" ? "generate" : "generate-video"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(kind === "image"
        ? { agentId: target.id, prompt: finalPrompt.prompt, negativePrompt: finalPrompt.negativePrompt, settings, provider: mediaProvider }
        : { agentId: target.id, prompt: finalPrompt.prompt, settings: { ...settings, videoSeconds: 5 }, provider: mediaProvider, sourceImageUrl, createPreview: true })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(String(data?.error || `${kind === "image" ? "Image" : "Video"} generation failed.`));
    const url = String(data?.url || "");
    if (!url) throw new Error(`${kind === "image" ? "Image" : "Video"} generation did not return a URL.`);
    if (kind === "image") update({ imageUrl: url, videoUrl: "", videoPreviewUrl: "" });
    else update({ videoUrl: url, videoPreviewUrl: String(data?.previewUrl || "") + (data?.previewUrl ? `?t=${Date.now()}` : "") });
  }

  async function generateUserProfileImagePrompt(user: UserProfile) {
    const chatProvider = providerForUser(user);
    if (!chatProvider) throw new Error("No provider available.");
    return requestProfileMediaPrompt("avatar", buildUserProfileImageSource(user), chatProvider);
  }

  async function generateUserProfileLiveCardPrompt(user: UserProfile) {
    const chatProvider = providerForUser(user);
    if (!chatProvider) throw new Error("No provider available.");
    return requestProfileMediaPrompt("live-card", buildUserProfileImageSource(user), chatProvider, user.imageUrl || "");
  }

  async function generateUserProfileImage(user: UserProfile) {
    try {
      await generateProfileMedia("image", user, await generateUserProfileImagePrompt(user), (patch) => updateUserProfile(user.id, patch));
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Image generation failed.");
      throw error;
    }
  }

  async function generateUserProfileVideo(user: UserProfile) {
    try {
      await generateProfileMedia("video", user, await generateUserProfileLiveCardPrompt(user), (patch) => updateUserProfile(user.id, patch));
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Live card generation failed.");
      throw error;
    }
  }

  async function steerGenerateUserImage(user: UserProfile, instruction: string) {
    const steerProvider = providerForUser(user);
    if (!steerProvider) throw new Error("No provider available.");
    const prompt = await requestSteeredMediaPrompt("avatar", await generateUserProfileImagePrompt(user), instruction, steerProvider);
    await generateProfileMedia("image", user, prompt, (patch) => updateUserProfile(user.id, patch));
  }

  async function steerGenerateUserVideo(user: UserProfile, instruction: string) {
    const steerProvider = providerForUser(user);
    if (!steerProvider) throw new Error("No provider available.");
    const prompt = await requestSteeredMediaPrompt("livecard", await generateUserProfileLiveCardPrompt(user), instruction, steerProvider);
    await generateProfileMedia("video", user, prompt, (patch) => updateUserProfile(user.id, patch));
  }

  function movePromptProfile(targetId: string) {
    if (!draggedAgentId || draggedAgentId === targetId) return;
    setPromptProfiles((current) => {
      const dragged = current.find((item) => item.id === draggedAgentId);
      if (!dragged) return current;
      const withoutDragged = current.filter((item) => item.id !== draggedAgentId);
      const targetIndex = withoutDragged.findIndex((item) => item.id === targetId);
      if (targetIndex === -1) return current;
      return [...withoutDragged.slice(0, targetIndex), dragged, ...withoutDragged.slice(targetIndex)];
    });
  }

  function toggleAgent(profileId: string) {
    setActiveAgentIds((current) => {
      const next = current.includes(profileId) ? current.filter((id) => id !== profileId) : [...current, profileId];
      if (next.length === 0) return current;
      setActivePromptProfileId(next[0]);
      return next;
    });
  }

  function toggleSessionAgent(sessionId: string, profileId: string) {
    const toggledAgentIds = (ids: string[]) => {
      const isSelected = ids.includes(profileId);
      const isPrimary = ids[0] === profileId;
      if (isSelected && !isPrimary) return [profileId, ...ids.filter((id) => id !== profileId)];
      const next = isSelected ? ids.filter((id) => id !== profileId) : [profileId, ...ids];
      return next.length ? next : ids;
    };

    if (sessionId === "current" || sessionId === activeSessionId) {
      const session = sessions.find((item) => item.id === sessionId);
      const currentIds = session?.agentIds?.length ? session.agentIds : activeAgentIds;
      const nextIds = toggledAgentIds(currentIds.length ? currentIds : [activePromptProfileId]);
      setActiveAgentIds(nextIds);
      setActivePromptProfileId(nextIds[0]);
    }

    setSessions((current) => current.map((session) => {
      if (session.id !== sessionId) return session;
      const currentIds = session.agentIds?.length ? session.agentIds : [session.promptProfile.id];
      return { ...session, agentIds: toggledAgentIds(currentIds) };
    }));
  }

  function moveSessionAgent(sessionId: string, targetId: string) {
    if (!draggedAgentId || draggedAgentId === targetId) return;
    if (sessionId === "current" || sessionId === activeSessionId) {
      movePromptProfile(targetId);
      setActiveAgentIds((current) => {
        if (!current.includes(draggedAgentId) || !current.includes(targetId)) return current;
        const withoutDragged = current.filter((id) => id !== draggedAgentId);
        const targetIndex = withoutDragged.indexOf(targetId);
        return [...withoutDragged.slice(0, targetIndex), draggedAgentId, ...withoutDragged.slice(targetIndex)];
      });
      return;
    }

    setSessions((current) => current.map((session) => {
      if (session.id !== sessionId) return session;
      const currentIds = session.agentIds?.length ? session.agentIds : [session.promptProfile.id];
      if (!currentIds.includes(draggedAgentId) || !currentIds.includes(targetId)) return session;
      const withoutDragged = currentIds.filter((id) => id !== draggedAgentId);
      const targetIndex = withoutDragged.indexOf(targetId);
      return { ...session, agentIds: [...withoutDragged.slice(0, targetIndex), draggedAgentId, ...withoutDragged.slice(targetIndex)] };
    }));
  }

  function primaryPromptProfile() {
    const primaryId = activeAgentIds.find((id) => promptProfiles.some((profile) => profile.id === id)) ?? activePromptProfileId;
    return promptProfiles.find((profile) => profile.id === primaryId) ?? promptProfile;
  }

  function selectedPromptProfiles() {
    const seen = new Set<string>();
    const selected = activeAgentIds
      .filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .map((id) => promptProfiles.find((profile) => profile.id === id))
      .filter((profile): profile is PromptProfile => Boolean(profile));
    return selected.length ? selected : [primaryPromptProfile()];
  }

  function startingMessagesForProfiles(profiles: PromptProfile[]) {
    const now = Date.now();
    const startingMessages: ChatMessage[] = [];
    profiles.forEach((profile, index) => {
      const content = String(profile.startingMessage || "").trim();
      if (!content) return;
      startingMessages.push({
        id: crypto.randomUUID(),
        role: "assistant",
        content,
        createdAt: now + index,
        agentId: profile.id,
        agentName: profile.assistantName || profile.name
      });
    });
    return startingMessages;
  }

  function chatAgentTitle(agentIds: string[] | undefined, primaryProfile: PromptProfile) {
    const names = (agentIds?.length ? agentIds : [primaryProfile.id])
      .map((id) => promptProfiles.find((profile) => profile.id === id))
      .filter((profile): profile is PromptProfile => Boolean(profile))
      .map((profile) => profile.assistantName || profile.name)
      .filter(Boolean);
    return names.length ? names.join(" + ") : primaryProfile.assistantName || primaryProfile.name || "Assistant";
  }

  function providerForAgent(profile: PromptProfile) {
    return providerProfiles.find((item) => item.id === profile.providerId) ?? provider;
  }

  function knownMetadataBodyStart(content: string, metadataPrefix: string) {
    const prefix = metadataPrefix.trim();
    if (!prefix || !content.startsWith(prefix)) return 0;
    const match = content.match(ASSISTANT_METADATA_PREFIX_RE);
    return match ? match[0].length : 0;
  }

  function cleanAssistantOutput(content: string, profile: PromptProfile, activeProfiles: PromptProfile[], metadataPrefix = "") {
    const knownBodyStart = knownMetadataBodyStart(content, metadataPrefix);
    const metadataMatch = knownBodyStart > 0 ? null : content.match(ASSISTANT_METADATA_PREFIX_RE);
    const bodyStart = knownBodyStart || (metadataMatch ? metadataMatch[0].length : 0);
    const body = bodyStart > 0 ? content.slice(bodyStart) : content;
    let cleaned = stripStandaloneWrappingQuotes(stripAllTags(body));
    cleaned = stripAssistantSelfLabel(cleaned, profile);

    const otherAliases = activeProfiles
      .filter((item) => item.id !== profile.id)
      .flatMap((item) => [item.name, item.assistantName])
      .filter(Boolean)
      .map((name) => String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

    if (otherAliases.length > 0) {
      const otherSpeakerMatch = cleaned.match(new RegExp(`(?:^|\\n)\\s*(?:${otherAliases.join("|")})\\s*:\\s*`, "i"));
      if (otherSpeakerMatch?.index !== undefined) cleaned = cleaned.slice(0, otherSpeakerMatch.index).trimEnd();
    }

    return bodyStart > 0 ? `${content.slice(0, bodyStart)}${cleaned}` : cleaned;
  }

  function agentAliases(profile: PromptProfile) {
    return [profile.name, profile.assistantName].filter(Boolean).map((item) => String(item).toLowerCase());
  }

  function isAgentSummoned(profile: PromptProfile, text: string) {
    const lower = text.toLowerCase();
    return agentAliases(profile).some((name) => new RegExp(`(^|\\W)${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|\\W)`, "i").test(lower));
  }

  function keywordScore(profile: PromptProfile, text: string) {
    const source = profile.blocks.map((block) => block.content).join(" ").toLowerCase();
    const words = new Set(source.match(/\b[a-z]{5,}\b/g) ?? []);
    const textWords = text.toLowerCase().match(/\b[a-z]{5,}\b/g) ?? [];
    return textWords.filter((word) => words.has(word)).length;
  }

  function relevantPromptProfiles(nextMessages: ChatMessage[]) {
    const selected = selectedPromptProfiles();
    if (selected.length === 1) return selected;

    const recentText = nextMessages.slice(-4).map((message) => `${message.agentName || message.role}: ${message.content}`).join("\n");
    const summoned = selected.filter((profile) => isAgentSummoned(profile, recentText));
    if (summoned.length > 0) return summoned;

    const scored = selected
      .map((profile) => ({ profile, score: keywordScore(profile, recentText) }))
      .filter((item) => item.score >= 2)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.profile);

    return scored.length > 0 ? scored : [selected[0]];
  }

  function responseProfileWithGroupContext(profile: PromptProfile, responders: PromptProfile[]) {
    const selected = selectedPromptProfiles();
    if (selected.length === 1) return profile;

    const roster = selected.map((item) => item.assistantName || item.name).join(", ");
    const respondersList = responders.map((item) => item.assistantName || item.name).join(", ");
    return normalizePromptProfile({
      ...profile,
      blocks: [
        ...profile.blocks,
        {
          id: "shared-chat-context",
          name: "Shared Chat Context",
          enabled: true,
          role: "system",
          position: "top",
          priority: 95,
          content: `You are ${profile.assistantName || profile.name} in a shared multi-agent chat. Active agents: ${roster}. Respond as yourself only. Do not write dialogue, labels, or messages for other agents. Never include another agent's name followed by a colon as if they are speaking. You can respond to the user or to prior agent messages when relevant. This turn's selected responders: ${respondersList}.`
        }
      ]
    });
  }

  function updateModule(moduleId: string, changes: Partial<ModuleConfig>) {
    setModules((current) => {
      const manifest = moduleManifests.find((item) => item.id === moduleId);
      const hasConfig = current.some((item) => item.id === moduleId);
      const baseConfig = manifest ? { id: manifest.id, enabled: manifest.defaultEnabled, settings: manifest.defaultSettings } : null;
      const source = hasConfig ? current : baseConfig ? [...current, baseConfig] : current;
      const next = source.map((item) => item.id === moduleId ? { ...item, ...changes } : item);
      scheduleAppStateSave(createAppStateSnapshot({ modules: next }), 300);
      return next;
    });
  }

  function updateModuleSetting(moduleId: string, key: string, value: unknown) {
    setModules((current) => {
      const manifest = moduleManifests.find((item) => item.id === moduleId);
      const hasConfig = current.some((item) => item.id === moduleId);
      const baseConfig = manifest ? { id: manifest.id, enabled: manifest.defaultEnabled, settings: manifest.defaultSettings } : null;
      const source = hasConfig ? current : baseConfig ? [...current, baseConfig] : current;
      const next = source.map((item) => item.id === moduleId ? { ...item, settings: { ...item.settings, [key]: value } } : item);
      scheduleAppStateSave(createAppStateSnapshot({ modules: next }), 300);
      return next;
    });
  }

  function modulesWithSettingsPatch(sourceModules: ModuleConfig[], moduleId: string, patch: Record<string, unknown>) {
    return sourceModules.map((item) => item.id === moduleId ? { ...item, settings: { ...item.settings, ...patch } } : item);
  }

  function applyModuleSettingsPatch(moduleId: string, patch: Record<string, unknown>) {
    setModules((current) => {
      const next = modulesWithSettingsPatch(current, moduleId, patch);
      scheduleAppStateSave(createAppStateSnapshot({ modules: next }), 300);
      return next;
    });
  }

  function stopNativeCallMode() {
    callModeModuleRef.current?.endCall?.();
    setCallModeHypnoPrompt(null);
    pendingCallModeHypnoPromptRef.current = null;
    setCallModeLevel(0);
    setCallModeMuted(false);
    setCallModeStatus("idle");
  }

  function toggleCallModeMute() {
    if (callModeModuleRef.current) {
      callModeModuleRef.current.toggleCallMute?.();
      syncCallModeUiState();
    }
  }

  async function toggleMicLevelTest() {
    await ensureCallModeRuntime();
    syncEmbodyRuntimeState();
    callModeModuleRef.current?.toggleMicLevelTest?.();
  }

  async function toggleCallMode() {
    const callMode = modules.find((item) => item.id === "callmode");
    if (callMode?.enabled !== true) {
      setError("Enable the Call Mode module before starting Call Mode.");
      return;
    }
    try {
      await ensureCallModeRuntime();
      syncEmbodyRuntimeState();
      callModeModuleRef.current?.toggleCall?.();
      window.setTimeout(syncCallModeUiState, 0);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not start Call Mode.");
    }
  }

  async function autopickBackgroundWithModel() {
    const response = await fetch("/api/settings/background/autopick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, promptProfile: primaryPromptProfile(), provider, modules })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(data?.error || "Background autopick failed."));
    return data?.asset && typeof data.asset === "object" ? data.asset as BackgroundAsset : null;
  }

  async function generateChatTitle(nextMessages: ChatMessage[]) {
    const res = await fetch("/api/chat/title", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: nextMessages, promptProfile: primaryPromptProfile(), provider, modules })
    });
    if (!res.ok) return nextMessages.find((message) => message.role === "user")?.content.slice(0, 48) || "Untitled chat";
    const data = await res.json() as { title?: string };
    return data.title || nextMessages.find((message) => message.role === "user")?.content.slice(0, 48) || "Untitled chat";
  }

  async function streamAssistantResponse(nextMessages: ChatMessage[], rollbackMessages: ChatMessage[], responseProfile: PromptProfile, activeProfiles: PromptProfile[], generationMetadataPrefix = "", contextNote = "", modulesForRequest = modules, preparedAssistantMessage?: ChatMessage) {
    const streamStartedAt = performance.now();

    const promptMessages = stripAssistantMetadataPrefixes(nextMessages);
    const responseProvider = providerForAgent(responseProfile);
    const assistantMessage: ChatMessage = preparedAssistantMessage ?? {
      ...createMessage("assistant", ""),
      agentId: responseProfile.id,
      agentName: responseProfile.assistantName || responseProfile.name
    };
    let completedMessage: ChatMessage | null = null;
    const controller = new AbortController();
    let streamFlushFrameId: number | null = null;
    let pendingStreamContent = "";
    let lastPostedStreamContent = "";
    let lastStreamFlushAt = 0;
    const cancelPendingStreamFlush = () => {
      if (streamFlushFrameId !== null) {
        window.cancelAnimationFrame(streamFlushFrameId);
        streamFlushFrameId = null;
      }
    };
    const flushStreamContent = (now = performance.now()) => {
      streamFlushFrameId = null;
      if (pendingStreamContent === lastPostedStreamContent) return;
      if (lastStreamFlushAt > 0 && now - lastStreamFlushAt < STREAM_MIN_FRAME_MS) {
        streamFlushFrameId = window.requestAnimationFrame(flushStreamContent);
        return;
      }
      setChatMessages([...promptMessages, { ...assistantMessage, content: pendingStreamContent }]);
      lastPostedStreamContent = pendingStreamContent;
      lastStreamFlushAt = now;
    };
    const scheduleStreamContent = (content: string) => {
      pendingStreamContent = content;
      if (streamFlushFrameId === null) {
        streamFlushFrameId = window.requestAnimationFrame(flushStreamContent);
      }
    };
    activeStreamAbortRef.current = controller;
    setChatMessages([...promptMessages, assistantMessage]);
    try {
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: promptMessages, promptProfile: responseProfile, provider: responseProvider, modules: modulesForRequest, generationMetadataPrefix, userName: activeUser?.name || "User", userProfile: { description: activeUser?.description, personality: activeUser?.personality, appearance: activeUser?.appearance, responseGuidelines: activeUser?.responseGuidelines, preferences: activeUser?.preferences, dialogueExamples: activeUser?.dialogueExamples }, ...clientClockSnapshot() }),
        signal: controller.signal
      });
      if (!res.ok || !res.body) throw new Error(await res.text());

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let content = "";
      let streamedTtsRawBuffer = "";
      let streamedCueRawBuffer = "";
      let streamedTtsExtractedBuffer = "";
      let streamedTtsChunkIndex = 0;
      let pendingPlaybackCues: PlaybackCue[] = [];
      const streamedTtsPromises: Promise<void>[] = [];
      let streamDoneSeen = false;
      let firstDeltaSeen = false;
      const voiceForgeConfigForStreamTts = modules.find((item) => item.id === "voiceforge");
      const streamTtsSettings = settingObject(voiceForgeConfigForStreamTts?.settings);
      const streamTtsEnabled = voiceForgeConfigForStreamTts?.enabled === true && streamTtsSettings.voiceforgeEnabled === true;
      const tryQueueStreamedTts = (delta: string, force = false) => {
        streamedCueRawBuffer += delta;
        const extractedCues = extractPlaybackCues(streamedCueRawBuffer);
        streamedCueRawBuffer = extractedCues.remaining;
        if (!streamTtsEnabled) {
          const intifaceConfig = modules.find((item) => item.id === "intiface");
          const intifaceEnabled = intifaceConfig?.enabled === true;
          for (const cue of extractedCues.cues) {
            if (cue.type === "audio.play") {
              playCueAudio(cue);
            } else if ((cue.type === "intiface.play" || cue.type === "intiface.stop") && intifaceEnabled) {
              window.dispatchEvent(new CustomEvent("nitral-intiface-action", {
                detail: { type: cue.type, attrs: { ...cue.attrs, skipLead: "true" }, body: cue.body }
              }));
            }
          }
          return;
        }
        pendingPlaybackCues.push(...extractedCues.cues);
        streamedTtsRawBuffer += delta;
        const actionSafe = splitTtsSafeActionText(streamedTtsRawBuffer);
        streamedTtsRawBuffer = actionSafe.remaining;
        let extracted = "";
        let lastConsumedIndex = 0;
        let inQuote = false;
        let quoteStart = -1;
        for (let i = 0; i < actionSafe.safeText.length; i++) {
          if (actionSafe.safeText[i] !== '"') continue;
          if (!inQuote) {
            inQuote = true;
            quoteStart = i;
          } else {
            inQuote = false;
            extracted += actionSafe.safeText.slice(quoteStart + 1, i) + " ";
            lastConsumedIndex = i + 1;
          }
        }
        if (inQuote) {
          streamedTtsRawBuffer = actionSafe.safeText.slice(quoteStart) + streamedTtsRawBuffer;
          if (force) {
            extracted += streamedTtsRawBuffer.slice(1) + " ";
            streamedTtsRawBuffer = "";
          }
        } else if (quoteStart >= 0) {
          streamedTtsRawBuffer = actionSafe.safeText.slice(lastConsumedIndex) + streamedTtsRawBuffer;
        }
        streamedTtsExtractedBuffer += extracted;
        if (!streamedTtsExtractedBuffer.trim()) return;
        const settings = streamTtsSettings;
        const chunkWords = Math.max(3, Math.floor(Number(settings.voiceforgeChunkSize) || 12));
        while (streamedTtsExtractedBuffer.trim() && (force || streamedTtsWordCount(streamedTtsExtractedBuffer) >= chunkWords)) {
          const endIndex = force ? streamedTtsExtractedBuffer.length : streamedTtsChunkEndIndex(streamedTtsExtractedBuffer, chunkWords);
          if (endIndex <= 0) break;
          const chunk = streamedTtsExtractedBuffer.slice(0, endIndex).trim();
          streamedTtsExtractedBuffer = streamedTtsExtractedBuffer.slice(endIndex).trimStart();
          if (chunk) {
            streamedTtsChunkIndex += 1;
            const playbackCues = pendingPlaybackCues.splice(0);
            streamedTtsPromises.push(enqueueVoiceForgeMessage({
              ...assistantMessage,
              id: `${assistantMessage.id}:stream:${streamedTtsChunkIndex}`,
              content: chunk,
              createdAt: Date.now(),
              playbackCues,
            } as VoiceForgeCueMessage));
          }
          if (force) {
            streamedTtsExtractedBuffer = "";
            break;
          }
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const eventBlock of events) {
          const event = eventBlock.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim();
          const dataLine = eventBlock.split("\n").find((line) => line.startsWith("data:"));
          if (!event || !dataLine) continue;
          const data = JSON.parse(dataLine.slice(5).trim());
          if (event === "delta") {
            const delta = String(data.delta ?? "");
            content += delta;
            if (!firstDeltaSeen) {
              firstDeltaSeen = true;
            }
            const cleaned = cleanAssistantOutput(content, responseProfile, activeProfiles, generationMetadataPrefix);
            if (!lastPostedStreamContent && cleaned) {
              pendingStreamContent = cleaned;
              cancelPendingStreamFlush();
              flushStreamContent(performance.now());
            } else {
              scheduleStreamContent(cleaned);
            }
            tryQueueStreamedTts(delta);
          }
          if (event === "done") {
            streamDoneSeen = true;
            tryQueueStreamedTts("", true);
          }
          if (event === "done") {
            cancelPendingStreamFlush();
            if (pendingStreamContent !== lastPostedStreamContent) flushStreamContent();
            const actionSummary = Array.isArray(data.actionResults) && data.actionResults.length ? `Actions taken:\n${actionResultSummary(data.actionResults as ActionResultItem[])}` : "";
            const finalContextNote = [contextNote, actionSummary].filter(Boolean).join("\n\n");
            const finalMessage = { ...data.message, content: cleanAssistantOutput(data.message.content, responseProfile, activeProfiles, generationMetadataPrefix), contextNote: finalContextNote || undefined } as ChatMessage;
            completedMessage = finalMessage;
            setChatMessages([...promptMessages, finalMessage]);
            const hypnoPrompt = extractHypnoChoicePrompts(finalMessage.content)[0];
            if (hypnoPrompt && callModeModuleRef.current?.isCallActive?.() === true) pendingCallModeHypnoPromptRef.current = hypnoPrompt;
            if (Array.isArray(data.evolutionEvents)) {
              for (const ev of data.evolutionEvents) {
                notifyApp({ kind: ev.kind || "info", title: ev.title || "Agent evolved", message: ev.message || "" });
              }
            }
            refreshAfterActionResults(data.actionResults, data.message.id).catch(() => undefined);
            runRelationshipAnalyzer(data.message.content, responseProfile).catch(() => undefined);
          }
          if (event === "error") throw new Error(data.error || "Streaming chat failed.");
        }
      }
      if (!streamDoneSeen) tryQueueStreamedTts("", true);
      finalizeVoiceForgeStreamPlayback(assistantMessage, responseProfile, streamedTtsPromises).catch(() => undefined);
    } catch (err) {
      cancelPendingStreamFlush();
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Generation stopped.");
      } else {
        setError(err instanceof Error ? err.message : "Chat request failed.");
      }
      setChatMessages(rollbackMessages);
    } finally {
      if (activeStreamAbortRef.current === controller) activeStreamAbortRef.current = null;
    }

    return completedMessage;
  }

  type VoiceForgePlaybackSequence = { baseId: string; index: number };

  function voiceForgePlaybackSequence(message: ChatMessage): VoiceForgePlaybackSequence | null {
    const match = String(message.id || "").match(/^(.*):stream:(\d+)$/);
    if (!match) return null;
    return { baseId: match[1], index: Math.max(1, Number(match[2]) || 1) };
  }

  function cancelVoiceForgePlaybackState() {
    voiceForgePlaybackRunRef.current += 1;
    voiceForgeStreamPlaybackRunRef.current.clear();
    voiceForgeStartedRunRef.current.clear();
    voiceForgeBackgroundStartKeyRef.current = "";
    voiceForgeGenerationQueueRef.current = Promise.resolve();
    voiceForgePlaybackQueueRef.current = Promise.resolve();
    pendingCallModeHypnoPromptRef.current = null;
  }

  async function finalizeVoiceForgeStreamPlayback(message: ChatMessage, responseProfile: PromptProfile, playbackPromises: Promise<void>[]) {
    if (playbackPromises.length === 0) return;
    const baseId = String(message.id || "");
    await Promise.allSettled(playbackPromises);
    const playbackRunId = voiceForgeStreamPlaybackRunRef.current.get(baseId);
    if (!playbackRunId || voiceForgePlaybackRunRef.current !== playbackRunId || !voiceForgeStartedRunRef.current.has(playbackRunId)) return;
    voiceForgeStartedRunRef.current.delete(playbackRunId);
    voiceForgeStreamPlaybackRunRef.current.delete(baseId);
    const character = message.agentName || responseProfile.assistantName || responseProfile.name || String(message.agentId || "");
    const ttsPayload = { character, requestId: `${String(message.agentId || responseProfile.id || "")}-${baseId}`, sequence: playbackRunId, text: "" };
    window.dispatchEvent(new CustomEvent("voiceforge_tts_lipsync_end"));
    callModeModuleRef.current?.emitNitralEmbodyEvent?.("voiceforge_tts_end", ttsPayload);
    if (callModeModuleRef.current?.isCallActive?.() === true && pendingCallModeHypnoPromptRef.current) {
      setCallModeHypnoPrompt(pendingCallModeHypnoPromptRef.current);
      pendingCallModeHypnoPromptRef.current = null;
    }
  }

  async function playAudioBlob(blob: Blob, onStart?: (durationMs: number) => void | Promise<void>, shouldPlay?: () => boolean) {
    if (shouldPlay && !shouldPlay()) return;
    const playback = voiceForgePlaybackQueueRef.current.then(async () => {
      if (shouldPlay && !shouldPlay()) return;
      const mgr = await getVoiceForgeAudioManager();
      if (shouldPlay && !shouldPlay()) return;
      await mgr?.playTtsBlob(blob, onStart);
    });
    voiceForgePlaybackQueueRef.current = playback.catch(() => undefined);
    await playback;
  }

  function reserveVoiceForgePlaybackSlot(shouldPlay?: () => boolean) {
    const entries: Array<{ blob: Blob; onStart?: (durationMs: number) => void | Promise<void> }> = [];
    let closed = false;
    let wake: (() => void) | null = null;
    const waitForEntry = () => new Promise<void>((resolve) => { wake = resolve; });
    const done = voiceForgePlaybackQueueRef.current.then(async () => {
      while (true) {
        if (shouldPlay && !shouldPlay()) return;
        const entry = entries.shift();
        if (!entry) {
          if (closed) return;
          await waitForEntry();
          continue;
        }
        if (shouldPlay && !shouldPlay()) return;
        const mgr = await getVoiceForgeAudioManager();
        if (shouldPlay && !shouldPlay()) return;
        await mgr?.playTtsBlob(entry.blob, entry.onStart);
      }
    });
    voiceForgePlaybackQueueRef.current = done.catch(() => undefined);
    return {
      done,
      push(blob: Blob, onStart?: (durationMs: number) => void | Promise<void>) {
        entries.push({ blob, onStart });
        wake?.();
        wake = null;
      },
      close() {
        closed = true;
        wake?.();
        wake = null;
      }
    };
  }

  function resolveCueAudioUrl() {
    const clicker = embodyAudioAssets.find((asset) => asset.name.toLowerCase().replace(/\.[a-z0-9]+$/i, "") === "clicker");
    return clicker?.url || "";
  }

  function playCueAudio(cue: PlaybackCue) {
    const src = resolveCueAudioUrl();
    const volume = clampNumber(cue.attrs.volume, 0, 100, 100) / 100;
    console.log(`[audio.play] cue="${cue.attrs.name || cue.body || cue.attrs.url}" src="${src}" volume=${volume}`);
    if (!src) return;
    const audio = new Audio(src);
    audio.volume = volume;
    audio.play().catch((err) => console.warn(`[audio.play] Playback failed for "${src}":`, err));
  }

  function dispatchPlaybackCue(cue: PlaybackCue, message: ChatMessage, durationMs: number) {
    const intifaceConfig = modules.find((item) => item.id === "intiface");
    const intifaceSettings = settingObject(intifaceConfig?.settings);
    const cueDelay = clampNumber(cue.attrs.delay ?? cue.attrs.offsetMs, -5000, 5000, 0);
    if (cue.type === "audio.play") {
      window.setTimeout(() => playCueAudio(cue), Math.max(0, cueDelay));
      return;
    }
    if (cue.type !== "intiface.play" && cue.type !== "intiface.stop") return;
    if (intifaceConfig?.enabled !== true || intifaceSettings.intifaceAiEnabled === false || intifaceSettings.intifaceAiTtsSyncEnabled !== true) return;
    const syncOffset = clampNumber(intifaceSettings.intifaceAiTtsSyncOffsetMs, -1500, 1500, 0);
    const delay = Math.max(0, syncOffset + cueDelay);
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("nitral-intiface-action", {
        detail: {
          type: cue.type,
          attrs: { ...cue.attrs, skipLead: "true" },
          body: cue.body,
          messageId: message.id,
          durationMs,
        }
      }));
    }, delay);
  }

  function dispatchPlaybackCues(message: VoiceForgeCueMessage, durationMs: number) {
    const cues = Array.isArray(message.playbackCues) ? message.playbackCues : [];
    for (const cue of cues) dispatchPlaybackCue(cue, message, durationMs);
  }

  async function playVoiceForgeMessage(message: ChatMessage, onGenerationDone?: () => void) {
    const voiceForgeConfig = modules.find((item) => item.id === "voiceforge");
    const settings = settingObject(voiceForgeConfig?.settings);
    if (voiceForgeConfig?.enabled !== true || settings.voiceforgeEnabled !== true) return;
    if (voiceForgeLastMessageIdRef.current === message.id) return;

    const text = stripAllTags(String(message.content || "")).trim();
    if (!text) return;
    const agentId = String(message.agentId || "");
    const mappedVoice = resolveVoiceForgeMappedVoice(settings, agentId, message.agentName);
    const voice = voiceForgeRequestVoice(mappedVoice, settings);
    if (!agentId || !voice) throw new Error(`VoiceForge voice mapping is missing for ${message.agentName || agentId}.`);
    voiceForgeLastMessageIdRef.current = message.id;

    const endpoint = String(settings.voiceforgeProviderEndpoint || "").replace(/\/+$/, "");
    const response = await fetch("/api/modules/voiceforge/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint, text, voice, requestId: `${agentId}-${message.id}` })
    });
    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}));
      throw new Error(String(data?.error || "VoiceForge generation failed."));
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const playbackSequence = voiceForgePlaybackSequence(message);
    const playbackRunId = playbackSequence
      ? voiceForgeStreamPlaybackRunRef.current.get(playbackSequence.baseId) || (() => {
        const runId = ++voiceForgePlaybackRunRef.current;
        voiceForgeStreamPlaybackRunRef.current.set(playbackSequence.baseId, runId);
        return runId;
      })()
      : ++voiceForgePlaybackRunRef.current;
    const shouldContinuePlayback = () => voiceForgePlaybackRunRef.current === playbackRunId;
    const playbackSlot = reserveVoiceForgePlaybackSlot(shouldContinuePlayback);
    let playbackStarted = false;
    let audioChunkCount = 0;
    let localBgStreamInfo: Record<string, unknown> | null = null;
    const ttsPayload = { character: message.agentName || agentId, requestId: `${agentId}-${message.id}`, sequence: playbackRunId, text };
    const startVoiceForgeBackground = (bgInfo: Record<string, unknown>) => {
      const charName = message.agentName || agentId;
      voiceForgeBackgroundStartKeyRef.current = `${charName}|${JSON.stringify(bgInfo.tracks || [])}`;
      window.setTimeout(() => {
        getVoiceForgeAudioManager().then((mgr) => {
          const bgVolume = Math.max(0, Math.min(100, Number(settings.audioVoiceForgeBackgroundVolume ?? 30) || 0));
          const bgPersist = settings.audioVoiceForgeBackgroundPersist !== false;
          mgr?.setVoiceForgeBgVolume?.(bgVolume);
          mgr?.setVoiceForgeBgPersist?.(bgPersist);
          mgr?.startVoiceForgeBackground?.(bgInfo, charName);
        }).catch(() => {});
      }, 300);
    };
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const event = JSON.parse(line.slice(5).trim());
          const backgroundTracks = normalizeVoiceForgeBackgroundTracks(event.background_tracks ?? event.tracks ?? event.bg_tracks);
          if (event.type === "start" && event.background_enabled && backgroundTracks.length > 0) {
            localBgStreamInfo = {
              session_id: event.background_session_id || event.request_id,
              tracks: backgroundTracks,
              sample_rate: event.sample_rate || 44100,
              endpoint: String(settings.voiceforgeProviderEndpoint || "").replace(/\/+$/, ""),
            };
          }
          if (event.type === "background" && event.background_enabled && backgroundTracks.length > 0) {
            localBgStreamInfo = {
              session_id: event.background_session_id || event.request_id || `${agentId}-${message.id}`,
              tracks: backgroundTracks,
              sample_rate: event.sample_rate || 44100,
              endpoint: String(settings.voiceforgeProviderEndpoint || "").replace(/\/+$/, ""),
            };
            startVoiceForgeBackground(localBgStreamInfo);
          }
          if (event.type === "chunk" && event.audio) {
            audioChunkCount += 1;
            const audioChunkIndex = audioChunkCount;
            const startPlayback = async (durationMs: number) => {
              if (!shouldContinuePlayback()) return;
              if (!playbackStarted) {
                playbackStarted = true;
                dispatchPlaybackCues(message as VoiceForgeCueMessage, durationMs);
                voiceForgeStartedRunRef.current.add(playbackRunId);
                window.dispatchEvent(new CustomEvent("voiceforge_tts_lipsync_start", { detail: { character: message.agentName || agentId } }));
                callModeModuleRef.current?.emitNitralEmbodyEvent?.("voiceforge_tts_start", ttsPayload).catch(() => undefined);
                if (localBgStreamInfo) {
                  startVoiceForgeBackground(localBgStreamInfo);
                }
              }
              if (audioChunkIndex === 1) callModeModuleRef.current?.emitNitralEmbodyEvent?.("voiceforge_tts_spoken_text", ttsPayload).catch(() => undefined);
            };
            const binary = atob(String(event.audio));
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const mimeType = String(event.mime_type || event.mimeType || "audio/mpeg");
            const blob = new Blob([bytes], { type: mimeType });
            playbackSlot.push(blob, startPlayback);
          }
          if (event.type === "error") throw new Error(String(event.message || "VoiceForge generation failed."));
        }
      }
    } finally {
      playbackSlot.close();
      onGenerationDone?.();
      await playbackSlot.done.catch(() => undefined);
      if (playbackStarted && !playbackSequence) {
        const emitTtsEnd = () => {
          voiceForgeStartedRunRef.current.delete(playbackRunId);
          window.dispatchEvent(new CustomEvent("voiceforge_tts_lipsync_end"));
          callModeModuleRef.current?.emitNitralEmbodyEvent?.("voiceforge_tts_end", ttsPayload);
          if (callModeModuleRef.current?.isCallActive?.() === true && pendingCallModeHypnoPromptRef.current) {
            setCallModeHypnoPrompt(pendingCallModeHypnoPromptRef.current);
            pendingCallModeHypnoPromptRef.current = null;
          }
        };
        emitTtsEnd();
      }
    }
  }

  function enqueueVoiceForgeMessage(message: ChatMessage) {
    let releaseGeneration: () => void = () => {};
    const generationDone = new Promise<void>((resolve) => { releaseGeneration = resolve; });
    const playback = voiceForgeGenerationQueueRef.current.then(() => playVoiceForgeMessage(message, releaseGeneration)).catch((error) => {
      const messageText = error instanceof Error ? error.message : "VoiceForge playback failed.";
      console.error("[VoiceForge]", messageText, error);
      setError(messageText);
    }).finally(releaseGeneration);
    voiceForgeGenerationQueueRef.current = voiceForgeGenerationQueueRef.current.then(() => generationDone).catch(() => undefined);
    return playback;
  }

  async function applyHypnoTrackerBeforeGeneration(nextMessages: ChatMessage[], sourceModules: ModuleConfig[]) {
    const hypnoConfig = sourceModules.find((item) => item.id === "hypno");
    let workingModules = sourceModules;
    let hypnoSettings = settingObject(hypnoConfig?.settings);
    if (hypnoConfig?.enabled !== true || hypnoSettings.sessionActive !== true || hypnoSettings.sessionPaused === true) return sourceModules;
    const latestUser = [...nextMessages].reverse().find((message) => message.role === "user");
    if (!latestUser) return sourceModules;
    type HypnoSideAgentKind = "contract" | "preference" | "strategy" | "creative";
    const parseHypnoAgentJson = (content: unknown) => {
      try {
        return extractJsonObject(String(content || "{}"));
      } catch {
        return {};
      }
    };
    const callHypnoSideAgent = async (kind: HypnoSideAgentKind, endpoint: string, profile: PromptProfile | undefined, payload: unknown) => {
      if (!profile) return null;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ ...createMessage("user", JSON.stringify(payload, null, 2)), id: `hypno-${kind}-${Date.now()}` }],
          promptProfile: profile,
          provider: providerForAgent(profile),
          modules: workingModules.map((item) => item.id === "hypno" ? { ...item, enabled: false } : item)
        })
      });
      if (!response.ok) return null;
      const data = await response.json().catch(() => ({}));
      return { kind, parsed: parseHypnoAgentJson(data?.content) };
    };
    const contractAgentId = String(hypnoSettings.contractAgentId || "").trim();
    const preferenceAgentId = String(hypnoSettings.preferenceAgentId || "").trim();
    const strategyAgentId = String(hypnoSettings.strategyAgentId || "").trim();
    const creativeAgentId = String(hypnoSettings.creativeAgentId || "").trim();
    const turnCount = Number(hypnoSettings.sessionTurnCount || 0);
    const stageTurnCount = Number(hypnoSettings.sessionStageTurnCount || 0);
    const latestUserContent = latestUser.content.trim();
    const isSimpleReply = latestUserContent.length < 40 && /^(yes|no|ok|okay|k|yep|nope|sure|deeper|continue|ready|not.yet|stay|softer|pause|stop|end|good|nice|mmm|hmm|ah|wow|oh|thanks|thank.you|right|alright|fine)\b/i.test(latestUserContent.replace(/[.!?,;:]+$/g, ""));
    const hypnoMessageHistory = nextMessages.slice(-8).map((msg) => ({
      role: msg.role,
      content: msg.content.replace(/<action\b[\s\S]*?(?:<\/action>|$)/gi, " ").replace(/\s+/g, " ").trim().slice(0, msg.role === "assistant" ? 600 : 200)
    })).filter((msg) => msg.content.length > 10);
    const agentPromises: Array<ReturnType<typeof callHypnoSideAgent>> = [];
    if (turnCount <= 1) {
      agentPromises.push(callHypnoSideAgent("contract", "/api/hypno/contract", contractAgentId ? promptProfiles.find((profile) => profile.id === contractAgentId) : undefined, {
        currentSession: hypnoSettings, messageHistory: hypnoMessageHistory, instruction: "Return the updated operational session contract for the tracker and front-facing guide."
      }));
    }
    if (!isSimpleReply && latestUserContent.length > 10) {
      agentPromises.push(callHypnoSideAgent("preference", "/api/hypno/preferences", preferenceAgentId ? promptProfiles.find((profile) => profile.id === preferenceAgentId) : undefined, {
        currentSession: hypnoSettings, messageHistory: hypnoMessageHistory, instruction: "Return concise preference notes for the tracker and front-facing guided relaxation agent."
      }));
    }
    if (turnCount <= 1 || stageTurnCount === 0) {
      agentPromises.push(callHypnoSideAgent("strategy", "/api/hypno/strategy", strategyAgentId ? promptProfiles.find((profile) => profile.id === strategyAgentId) : undefined, {
        currentSession: hypnoSettings, messageHistory: hypnoMessageHistory, stageOrder: HYPNO_SESSION_STAGES, instruction: "Return compact hypnosis strategy notes for the tracker and front-facing guided relaxation agent."
      }));
    }
    if (stageTurnCount >= 3 || turnCount % 3 === 0) {
      agentPromises.push(callHypnoSideAgent("creative", "/api/hypno/creative", creativeAgentId ? promptProfiles.find((profile) => profile.id === creativeAgentId) : undefined, {
        currentSession: hypnoSettings, messageHistory: hypnoMessageHistory, instruction: "Return compact creative direction that prevents repetition in the next visible guided relaxation segment. Review the messageHistory to identify phrasing, imagery, and cadence patterns that have been used too recently, and suggest alternatives."
      }));
    }
    const agentResults = await Promise.all(agentPromises);
    const contractResult = agentResults.find((r) => r?.kind === "contract") ?? null;
    const preferenceResult = agentResults.find((r) => r?.kind === "preference") ?? null;
    const strategyResult = agentResults.find((r) => r?.kind === "strategy") ?? null;
    const creativeResult = agentResults.find((r) => r?.kind === "creative") ?? null;

    if (contractResult?.kind === "contract") {
      const contractParsed = contractResult.parsed;
      const contractPatch = {
        sessionShape: "interactive-staged",
        ...(contractParsed.style ? { sessionStyle: sanitizeHypnoTrackerText(contractParsed.style, 120) } : {}),
        ...(contractParsed.ending ? { sessionEnding: sanitizeHypnoTrackerText(contractParsed.ending, 60) } : {}),
        ...(contractParsed.contract ? { sessionContract: sanitizeHypnoTrackerText(contractParsed.contract, 700) } : {}),
        ...(contractParsed.contractAnalysis ? { sessionContractAnalysis: sanitizeHypnoTrackerText(contractParsed.contractAnalysis, 900) } : {}),
        ...(contractParsed.contractStatus ? { sessionContractStatus: sanitizeHypnoTrackerText(contractParsed.contractStatus, 80) } : {}),
        ...(contractParsed.missingQuestion ? { sessionNextInstruction: `Ask this compact contract question before continuing: ${sanitizeHypnoTrackerText(contractParsed.missingQuestion, 240)}` } : {})
      };
      workingModules = modulesWithSettingsPatch(workingModules, "hypno", contractPatch);
      applyModuleSettingsPatch("hypno", contractPatch);
      hypnoSettings = { ...hypnoSettings, ...contractPatch };
    }

    if (preferenceResult?.kind === "preference") {
      const preferenceParsed = preferenceResult.parsed;
      const preferenceNotes = sanitizeHypnoTrackerText(preferenceParsed.preferenceNotes || hypnoSettings.sessionPreferenceNotes || "", 700);
      const memoryCandidate = sanitizeHypnoTrackerText(preferenceParsed.memoryCandidate || "", 500);
      const memoryConfig = workingModules.find((item) => item.id === "memory-bank");
      const memorySettings = settingObject(memoryConfig?.settings);
      let memorySaved = false;
      const shouldSaveMemory = Boolean(memoryConfig?.enabled === true && memorySettings.allowModelCreate !== false && memoryCandidate && memoryCandidate !== String(hypnoSettings.sessionLastSavedMemoryCandidate || ""));
      if (shouldSaveMemory) {
        const memoryResponse = await fetch("/api/modules/memory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId: activePromptProfile.id, scope: "user", text: memoryCandidate, tags: "hypno,preference" })
        }).catch(() => undefined);
        memorySaved = memoryResponse?.ok === true;
      }
      if (preferenceNotes || memoryCandidate) {
        const preferencePatch = {
          ...(preferenceNotes ? { sessionPreferenceNotes: preferenceNotes } : {}),
          ...(memoryCandidate ? { sessionMemoryCandidate: memoryCandidate } : {}),
          ...(memorySaved ? { sessionLastSavedMemoryCandidate: memoryCandidate } : {})
        };
        workingModules = modulesWithSettingsPatch(workingModules, "hypno", preferencePatch);
        applyModuleSettingsPatch("hypno", preferencePatch);
        hypnoSettings = { ...hypnoSettings, ...preferencePatch };
      }
    }

    if (strategyResult?.kind === "strategy") {
      const strategyParsed = strategyResult.parsed;
      const parts = [
        strategyParsed.strategyNotes,
        strategyParsed.techniqueBias ? `Technique bias: ${strategyParsed.techniqueBias}` : "",
        strategyParsed.stageAdvice ? `Stage advice: ${strategyParsed.stageAdvice}` : "",
        strategyParsed.riskNote ? `Risk note: ${strategyParsed.riskNote}` : ""
      ].map((item) => sanitizeHypnoTrackerText(item, 500)).filter(Boolean);
      if (parts.length) {
        const strategyPatch = { sessionStrategyNotes: sanitizeHypnoTrackerText(parts.join(" "), 900) };
        workingModules = modulesWithSettingsPatch(workingModules, "hypno", strategyPatch);
        applyModuleSettingsPatch("hypno", strategyPatch);
        hypnoSettings = { ...hypnoSettings, ...strategyPatch };
      }
    }

    if (creativeResult?.kind === "creative") {
      const creativeParsed = creativeResult.parsed;
      const avoid = Array.isArray(creativeParsed.avoid) ? creativeParsed.avoid.map((item) => sanitizeHypnoTrackerText(item, 80)).filter(Boolean).slice(0, 6).join(", ") : "";
      const motifs = Array.isArray(creativeParsed.motifs) ? creativeParsed.motifs.map((item) => sanitizeHypnoTrackerText(item, 80)).filter(Boolean).slice(0, 6).join(", ") : "";
      const parts = [
        creativeParsed.creativeNotes,
        motifs ? `Fresh motifs: ${motifs}` : "",
        creativeParsed.cadence ? `Cadence: ${creativeParsed.cadence}` : "",
        avoid ? `Avoid repeating: ${avoid}` : ""
      ].map((item) => sanitizeHypnoTrackerText(item, 500)).filter(Boolean);
      if (parts.length) {
        const creativePatch = { sessionCreativeNotes: sanitizeHypnoTrackerText(parts.join(" "), 900) };
        workingModules = modulesWithSettingsPatch(workingModules, "hypno", creativePatch);
        applyModuleSettingsPatch("hypno", creativePatch);
        hypnoSettings = { ...hypnoSettings, ...creativePatch };
      }
    }
    const trackerAgentId = String(hypnoSettings.trackerAgentId || "").trim();
    const trackerProfile = trackerAgentId ? promptProfiles.find((profile) => profile.id === trackerAgentId) : primaryPromptProfile();
    if (!trackerProfile) return workingModules;
    const trackerProvider = providerForAgent(trackerProfile);
    if (!trackerProvider.apiKey.trim()) return workingModules;
    const trackerPayload = {
      currentSession: {
        active: hypnoSettings.sessionActive === true,
        paused: hypnoSettings.sessionPaused === true,
        style: hypnoSettings.sessionStyle || "",
        shape: hypnoSettings.sessionShape || "",
        ending: hypnoSettings.sessionEnding || "",
        stage: hypnoSettings.sessionStage || "induction",
        progress: hypnoSettings.sessionStageProgress || 0,
        readiness: hypnoSettings.sessionReadiness || "unknown",
        userSignal: hypnoSettings.sessionUserSignal || "unknown",
        decision: hypnoSettings.sessionModelDecision || "",
        technique: hypnoSettings.sessionTechnique || "",
        stageGoal: hypnoSettings.sessionStageGoal || "",
        checkInPrompt: hypnoSettings.sessionCheckInPrompt || "",
        candidateBranches: parseJsonArraySetting(hypnoSettings.sessionCandidateBranchesJson),
        selectedBranchId: hypnoSettings.sessionSelectedBranchId || "",
        selectedBranchScore: hypnoSettings.sessionSelectedBranchScore || 0,
        selectedBranchEffects: (() => {
          try {
            return JSON.parse(String(hypnoSettings.sessionSelectedBranchEffectsJson || "{}"));
          } catch {
            return {};
          }
        })(),
        branchReason: hypnoSettings.sessionBranchReason || "",
        directorNote: hypnoSettings.sessionDirectorNote || "",
        path: parseJsonArraySetting(hypnoSettings.sessionPathJson),
        preferenceNotes: hypnoSettings.sessionPreferenceNotes || "",
        strategyNotes: hypnoSettings.sessionStrategyNotes || "",
        creativeNotes: hypnoSettings.sessionCreativeNotes || "",
        awaitingFeedback: hypnoSettings.sessionAwaitingFeedback === true,
        feedback: hypnoSettings.sessionFeedback || "",
        contract: hypnoSettings.sessionContract || "",
        contractAnalysis: hypnoSettings.sessionContractAnalysis || "",
        contractStatus: hypnoSettings.sessionContractStatus || "",
        sessionTurnCount: hypnoSettings.sessionTurnCount || 0,
        sessionStageTurnCount: hypnoSettings.sessionStageTurnCount || 0
      },
      messageHistory: hypnoMessageHistory,
      stageOrder: HYPNO_SESSION_STAGES,
      trackerProfile: trackerAgentId ? { mode: "configured-agent", id: trackerProfile.id, name: trackerProfile.assistantName || trackerProfile.name } : { mode: "default-primary-agent", id: trackerProfile.id, name: trackerProfile.assistantName || trackerProfile.name },
      instruction: "Return the strict JSON tracker decision for the next visible guided relaxation response. Review the messageHistory to understand the conversational flow and avoid steering the main model into repetition."
    };
    const trackerModules = workingModules.map((item) => item.id === "hypno" ? { ...item, enabled: false } : item);
    const response = await fetch("/api/hypno/tracker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ ...createMessage("user", JSON.stringify(trackerPayload, null, 2)), id: `hypno-tracker-${Date.now()}` }],
        promptProfile: trackerProfile,
        provider: trackerProvider,
        modules: trackerModules
      })
    });
    if (!response.ok) throw new Error(String((await response.json().catch(() => ({})))?.error || "Hypno tracker failed."));
    const data = await response.json().catch(() => ({}));
    const parsed = extractJsonObject(String(data?.content || ""));
    const patch = validateHypnoTrackerDecision(hypnoSettings, parsed);
    const next = modulesWithSettingsPatch(workingModules, "hypno", patch);
    applyModuleSettingsPatch("hypno", patch);
    return next;
  }

  async function generateAssistantResponses(nextMessages: ChatMessage[], rollbackMessages: ChatMessage[], forcedResponders?: PromptProfile[]) {
    if (nextMessages.length === 0 || generationInFlightRef.current) return;
    generationInFlightRef.current = true;
    const baseMessages = stripAssistantMetadataPrefixes(nextMessages);
    const strippedRollbackMessages = stripAssistantMetadataPrefixes(rollbackMessages);
    setChatMessages(baseMessages);
    setIsSending(true);
    setError("");
    try {
      let accumulatedMessages = baseMessages;
      const generationContextPromise = buildGenerationMetadataPrefix();
      const responders = forcedResponders?.length ? forcedResponders : relevantPromptProfiles(nextMessages);
      const firstResponder = responders[0];
      const firstAssistantMessage = firstResponder ? {
        ...createMessage("assistant", ""),
        agentId: firstResponder.id,
        agentName: firstResponder.assistantName || firstResponder.name
      } : undefined;
      if (firstAssistantMessage) {
        setChatMessages([...baseMessages, firstAssistantMessage]);
      }
      const modulesForGeneration = await applyHypnoTrackerBeforeGeneration(baseMessages, modules);
      const generationContext = await generationContextPromise;
      for (const [index, profile] of responders.entries()) {
        const responseMessage = await streamAssistantResponse(accumulatedMessages, strippedRollbackMessages, responseProfileWithGroupContext(profile, responders), selectedPromptProfiles(), generationContext.prefix, generationContext.note, modulesForGeneration, index === 0 ? firstAssistantMessage : undefined);
        if (!responseMessage) break;
        accumulatedMessages = [...stripAssistantMetadataPrefixes(accumulatedMessages), responseMessage];
      }
      if (accumulatedMessages.length > baseMessages.length) generateChatTitle(accumulatedMessages).then(setCurrentChatTitle).catch(() => undefined);
    } finally {
      generationInFlightRef.current = false;
      setIsSending(false);
    }
  }

  async function submitUserText(contentInput: string, attachmentsInput?: typeof pendingAttachments, options: { wrapInQuotes?: boolean } = {}) {
    const content = normalChatInputContent(contentInput, options.wrapInQuotes === true);
    const attachments = attachmentsInput?.length ? attachmentsInput : undefined;
    if ((!content && !attachments) || isSending) return;

    const text = content || `Sent ${attachments!.map((a) => a.name).join(", ")}`;
    setComposerUserHistory((current) => [...current.filter((item) => item !== text), text].slice(-COMPOSER_USER_HISTORY_LIMIT));
    const userMessage = createMessage("user", text);
    const nextMessages = stripAssistantMetadataPrefixes([...messagesRef.current, { ...userMessage, attachments }]);
    setChatMessages(nextMessages);
    setComposerDraft("");
    composerHistoryIndexRef.current = null;
    composerHistoryDraftRef.current = "";
    setPendingAttachments([]);
    await generateAssistantResponses(nextMessages, stripAssistantMetadataPrefixes(messagesRef.current.filter((message) => message.id !== userMessage.id)));
  }

  function submitHypnoChoice(_label: string, value: string) {
    setCallModeHypnoPrompt(null);
    void submitUserText(value).catch((error) => setError(error instanceof Error ? error.message : "Could not submit hypno choice."));
  }

  async function generateHitboxUserMessage(characterInput: unknown, hitboxInput: unknown) {
    const character = String(characterInput || primaryPromptProfile().assistantName || primaryPromptProfile().name || "the character").trim();
    const hitbox = String(hitboxInput || "").replace(/([A-Z])/g, " $1").toLowerCase().trim();
    if (!provider.apiKey?.trim()) return hitbox ? `I touch your ${hitbox}.` : "I reach out and touch you.";
    const response = await fetch(`${provider.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: "system", content: "Write one short first-person user action for a roleplay chat. The user is touching the character at the provided hit area. Return only the user action text, no quotes, no explanation." },
          { role: "user", content: `Character: ${character}\nHit area: ${hitbox || "body"}` }
        ],
        temperature: Math.max(0.2, Math.min(1.2, Number(provider.temperature ?? 0.7))),
        max_tokens: 48,
        stream: false
      })
    });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    return String(data?.choices?.[0]?.message?.content || "").trim();
  }

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    await submitUserText(draftRef.current, pendingAttachments, { wrapInQuotes: chatSettings.wrapNormalChatMessages });
  }

  useEffect(() => {
    function onHitboxMessage(event: Event) {
      const detail = (event as CustomEvent<{ message?: unknown; autoSend?: unknown; character?: unknown; hitbox?: unknown }>).detail || {};
      void (async () => {
        const message = String(detail.message || "").trim() || await generateHitboxUserMessage(detail.character, detail.hitbox);
        if (!message) return;
      if (detail.autoSend === true) {
          await submitUserText(message);
        return;
      }
      setComposerDraft(message);
      })().catch((error) => setError(error instanceof Error ? error.message : "Could not generate hitbox interaction."));
    }

    window.addEventListener("nitral-vrm-hitbox-message", onHitboxMessage);
    return () => window.removeEventListener("nitral-vrm-hitbox-message", onHitboxMessage);
  }, [isSending]);

  async function handleChatFileUpload(files: FileList | null) {
    if (!files?.length || isSending) return;
    const uploaded: string[] = [];
    const pending: typeof pendingAttachments = [];
    const failed: string[] = [];

    for (const file of Array.from(files)) {
      try {
        if (file.type.startsWith("image/")) {
          const url = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(new Error("Could not read file."));
            reader.readAsDataURL(file);
          });
          pending.push({ id: crypto.randomUUID(), type: "image", name: file.name, url, mimeType: file.type || "image/png" });
        } else {
          const content = await file.text();
          await postJson("/api/modules/file-library", { name: file.name, content });
          notifyApp({ kind: "success", title: "File added", message: file.name, source: "file-library" }).catch(() => undefined);
          uploaded.push(file.name);
        }
      } catch {
        failed.push(file.name);
      }
    }

    if (chatFileInputRef.current) chatFileInputRef.current.value = "";
    await refreshBasicModules().catch(() => undefined);

    if (pending.length) setPendingAttachments((prev) => [...prev, ...pending]);

    const msg = `${uploaded.length ? `Added to File Library: ${uploaded.join(", ")}. ` : ""}${failed.length ? `Failed: ${failed.join(", ")}.` : ""}`.trim();
    if (msg) setError(msg);
  }

  function setComposerDraft(value: string) {
    draftRef.current = value;
    setHasDraft(value.trim().length > 0);
    if (composerTextareaRef.current && composerTextareaRef.current.value !== value) {
      composerTextareaRef.current.value = value;
    }
  }

  function navigateComposerHistory(direction: "previous" | "next") {
    const history = composerUserHistory;
    if (history.length === 0) return;
    const draft = draftRef.current;

    const currentIndex = composerHistoryIndexRef.current;
    if (direction === "previous") {
      const nextIndex = currentIndex === null ? history.length - 1 : Math.max(0, currentIndex - 1);
      if (currentIndex === null) composerHistoryDraftRef.current = draft;
      composerHistoryIndexRef.current = nextIndex;
      setComposerDraft(history[nextIndex]);
      return;
    }

    if (currentIndex === null) return;
    const nextIndex = currentIndex + 1;
    if (nextIndex >= history.length) {
      composerHistoryIndexRef.current = null;
      setComposerDraft(composerHistoryDraftRef.current);
      composerHistoryDraftRef.current = "";
      return;
    }

    composerHistoryIndexRef.current = nextIndex;
    setComposerDraft(history[nextIndex]);
  }

  function handleDraftChange(value: string) {
    draftRef.current = value;
    const nextHasDraft = value.trim().length > 0;
    if (nextHasDraft !== hasDraft) setHasDraft(nextHasDraft);
    composerHistoryIndexRef.current = null;
    composerHistoryDraftRef.current = "";
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      navigateComposerHistory(event.key === "ArrowUp" ? "previous" : "next");
      return;
    }

    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    sendMessage();
  }

  async function regenerateLastResponse() {
    const currentMessages = messagesRef.current;
    if (isSending || currentMessages.length === 0) return;
    const lastAssistantIndex = currentMessages.map((message) => message.role).lastIndexOf("assistant");
    const lastUserIndex = currentMessages.map((message) => message.role).lastIndexOf("user");
    if (lastUserIndex === -1) {
      setError("No user message to regenerate from.");
      return;
    }
    if (lastAssistantIndex === -1 || lastAssistantIndex < lastUserIndex) {
      const nextMessages = stripAssistantMetadataPrefixes(currentMessages.slice(0, lastUserIndex + 1));
      setChatMessages(nextMessages);
      await generateAssistantResponses(nextMessages, currentMessages, [primaryPromptProfile()]);
      return;
    }
    const removedMessage = currentMessages[lastAssistantIndex];
    const responder = promptProfiles.find((profile) => profile.id === removedMessage.agentId) ?? primaryPromptProfile();
    const nextMessages = stripAssistantMetadataPrefixes(currentMessages.filter((_, index) => index !== lastAssistantIndex));
    if (nextMessages.length === 0) {
      setError("No chat context remains after removing the assistant response.");
      return;
    }

    setChatMessages(nextMessages);
    await generateAssistantResponses(nextMessages, currentMessages, [responder]);
  }

  async function saveCurrentSession() {
    if (messages.length === 0) return;
    const title = currentChatTitle || await generateChatTitle(messages);
    setCurrentChatTitle(title);
    const id = activeSessionId || crypto.randomUUID();
    const nextSession: ChatSession = {
      id,
      chatNumber: sessions.find((item) => item.id === id)?.chatNumber ?? sessions.length + 1,
      title,
      createdAt: sessions.find((item) => item.id === id)?.createdAt ?? Date.now(),
      messages,
      promptProfile,
      agentIds: activeAgentIds,
      provider
    };
    setActiveSessionId(id);
    setSessions((current) => [nextSession, ...current.filter((item) => item.id !== id)]);
    return nextSession;
  }

  async function startNewChat() {
    stopNativeCallMode();
    if (messages.length > 0) await saveCurrentSession();
    const id = crypto.randomUUID();
    const title = "New Chat";
    const createdAt = Date.now();
    const startingMessages = startingMessagesForProfiles(selectedPromptProfiles());
    const newSessionBase = {
      id,
      title,
      createdAt,
      messages: startingMessages,
      promptProfile: primaryPromptProfile(),
      agentIds: activeAgentIds,
      provider
    };
    setSessions((current) => [{ ...newSessionBase, chatNumber: current.length + 1 }, ...current]);
    setActiveSessionId(id);
    setChatMessages(startingMessages);
    setCurrentChatTitle(title);
    setInspectedSessionId(null);
  }

  function loadSession(session: ChatSession) {
    stopNativeCallMode();
    const sessionAgentIds = session.agentIds?.length ? session.agentIds : [session.promptProfile.id];
    const primarySessionAgentId = sessionAgentIds.find((id) => promptProfiles.some((profile) => profile.id === id));
    setActiveSessionId(session.id);
    setChatMessages(session.messages);
    setCurrentChatTitle(session.title);
    if (primarySessionAgentId) setActivePromptProfileId(primarySessionAgentId);
    setActiveAgentIds(sessionAgentIds);
    setProvider(normalizeProvider(session.provider));
    setActivePage("chat");
  }

  function deleteSession(sessionId: string) {
    setSessions((current) => current.filter((item) => item.id !== sessionId));
    if (activeSessionId === sessionId) {
      stopNativeCallMode();
      setActiveSessionId(null);
    }
  }

  function deleteMessageFromChat(sessionId: string, messageId: string) {
    if (sessionId === "current" || sessionId === activeSessionId) {
      setChatMessages(messagesRef.current.filter((message) => message.id !== messageId));
    }

    if (sessionId !== "current") {
      setSessions((current) => current.map((session) => session.id === sessionId ? { ...session, messages: session.messages.filter((message) => message.id !== messageId) } : session));
    }
  }

  function startEditingMessage(message: ChatMessage) {
    setEditingMessageId(message.id);
    setEditingDraft(message.content);
  }

  function cancelEditingMessage() {
    setEditingMessageId(null);
    setEditingDraft("");
  }

  function saveEditedMessage(sessionId: string, messageId: string) {
    const content = editingDraft.trim();
    if (!content) return;

    if (sessionId === "current" || sessionId === activeSessionId) {
      setChatMessages(messagesRef.current.map((message) => message.id === messageId ? { ...message, content } : message));
    }

    if (sessionId !== "current") {
      setSessions((current) => current.map((session) => session.id === sessionId ? { ...session, messages: session.messages.map((message) => message.id === messageId ? { ...message, content } : message) } : session));
    }

    cancelEditingMessage();
  }

  function visibleMessageContent(message: ChatMessage, hideMetadataPrefix = false) {
    const content = message.role === "assistant" ? stripAllTags(message.content) : message.content;
    if (!hideMetadataPrefix || message.role !== "assistant") return content;
    return content.replace(ASSISTANT_METADATA_PREFIX_RE, "");
  }

  function reminderSettings() {
    const config = modules.find((item) => item.id === "organizer");
    return config?.enabled === true ? config.settings : null;
  }

  function remindersForDate(date: Date) {
    const key = date.toISOString().slice(0, 10);
    return reminders.filter((item) => item.at.slice(0, 10) === key);
  }

  function renderReminderCalendar() {
    const start = new Date();
    start.setDate(1);
    start.setMonth(start.getMonth() + reminderCalendarOffset);
    const end = new Date(start.getFullYear(), start.getMonth() + 5, 1);
    const windowLabel = `${start.toLocaleString([], { month: "short", year: "numeric" })} - ${end.toLocaleString([], { month: "short", year: "numeric" })}`;
    return <div className="reminder-calendar-shell">
      <div className="reminder-calendar-nav"><button type="button" onClick={() => setReminderCalendarOffset((current) => current - 6)} aria-label="Previous 6 months">‹</button><strong>{windowLabel}</strong><button type="button" onClick={() => setReminderCalendarOffset((current) => current + 6)} aria-label="Next 6 months">›</button></div>
      <div className="reminder-calendar-grid">
      {Array.from({ length: 6 }, (_, index) => {
        const month = new Date(start.getFullYear(), start.getMonth() + index, 1);
        const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
        const offset = month.getDay();
        return <section className="reminder-month" key={`${month.getFullYear()}-${month.getMonth()}`}>
          <h4>{month.toLocaleString([], { month: "short", year: "numeric" })}</h4>
          <div className="reminder-weekdays"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>
          <div className="reminder-days">
            {Array.from({ length: offset }, (_, blank) => <span className="blank" key={`b-${blank}`} />)}
            {Array.from({ length: days }, (_, dayIndex) => {
              const date = new Date(month.getFullYear(), month.getMonth(), dayIndex + 1);
              const dayReminders = remindersForDate(date);
              return <span className={dayReminders.length ? "has-reminder" : ""} title={dayReminders.map((item) => `${item.kind}: ${item.title}`).join("\n")} key={date.toISOString()}>{dayIndex + 1}{dayReminders.length ? <i>{dayReminders.length}</i> : null}</span>;
            })}
          </div>
        </section>;
      })}
      </div>
    </div>;
  }

  function pythonSandboxSettings() {
    const config = modules.find((item) => item.id === "computation");
    return config?.enabled === true ? config.settings : null;
  }

  async function runPythonCodeBlock(runId: string, code: string) {
    const settings = pythonSandboxSettings();
    if (!settings) return;

    const maxOutputChars = Math.max(1, Math.min(200000, Number(activeProvider.maxTokens) || 4096));
    setPythonRuns((current) => ({ ...current, [runId]: { status: "running", output: "Running Python..." } }));

    try {
      const resp = await fetch("/api/run-python", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, maxOutputChars }),
      });
      const data = await resp.json() as { success: boolean; output: string; error?: string };
      setPythonRuns((current) => ({ ...current, [runId]: { status: data.success ? "done" : "error", output: data.output || data.error || "[no output]" } }));
    } catch (error) {
      setPythonRuns((current) => ({ ...current, [runId]: { status: "error", output: error instanceof Error ? error.message : "Could not run Python." } }));
    }
  }

  async function runJavaScriptCodeBlock(runId: string, code: string) {
    const settings = pythonSandboxSettings();
    if (!settings) return;

    const maxOutputChars = Math.max(1, Math.min(200000, Number(activeProvider.maxTokens) || 4096));
    setPythonRuns((current) => ({ ...current, [runId]: { status: "running", output: "Running JavaScript..." } }));

    try {
      const resp = await fetch("/api/run-javascript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, maxOutputChars }),
      });
      const data = await resp.json() as { success: boolean; output: string; error?: string };
      setPythonRuns((current) => ({ ...current, [runId]: { status: data.success ? "done" : "error", output: data.output || data.error || "[no output]" } }));
    } catch (error) {
      setPythonRuns((current) => ({ ...current, [runId]: { status: "error", output: error instanceof Error ? error.message : "Could not run JavaScript." } }));
    }
  }

  function imageGenerationSettings() {
    const config = modules.find((item) => item.id === "image-generation");
    return config?.enabled === true ? config.settings : null;
  }

  function imageGenerationProvider(settings: Record<string, unknown>) {
    const providerId = String(settings.providerId || "");
    return providerProfiles.find((item) => item.id === providerId) ?? null;
  }

  function mediaProviderWithModel(settings: Record<string, unknown>, key: "imageModel" | "videoModel") {
    const mediaProvider = imageGenerationProvider(settings);
    const model = String(settings[key] || "").trim();
    return mediaProvider && model ? { ...mediaProvider, model } : mediaProvider;
  }

  function localPromptProfileImagePrompt(profile: PromptProfile) {
    const name = String(profile.assistantName || profile.name || "AI agent").trim();
    const source = buildPromptProfileImageSource(profile).slice(0, 1800).replace(/\s+/g, " ").trim();
    return [
      "anime-realistic hybrid, anime-esque face, large expressive eyes, stylized proportions, stylized PBR materials, subtle stylized shading accents, polished fabric textures, smooth polished character surfaces, cinematic lighting, volumetric light, soft rim light, depth of field, ambient occlusion, soft subsurface scattering, vertical portrait profile image, single subject, head to mid-thigh, centered, front-facing or slight three-quarter angle, looking at viewer, confident pose, readable face and silhouette, detailed outfit, realistic detailed background, no text, no logo, no watermark",
      `character identity: ${name}`,
      source ? `visual cues from agent profile: ${source}` : ""
    ].filter(Boolean).join(", ");
  }

  function localPromptProfileLiveCardPrompt(profile: PromptProfile) {
    const name = String(profile.assistantName || profile.name || "AI agent").trim();
    return [
      "5 second smooth perfect loop, preserve the same identity, face, outfit, portrait-mode cowboy-shot framing, anime-realistic hybrid style, stylized PBR materials, subtle stylized shading accents, polished fabric textures, smooth polished character surfaces, volumetric lighting, depth of field, ambient occlusion, stable facial readability, realistic detailed background",
      "subtle breathing, hair and fabric movement, expression micro-motion, natural secondary motion, atmospheric background motion, soft particles, gentle parallax, no camera cuts, no scene changes, no identity morphing, no text, no logos, no watermarks",
      `character identity: ${name}`
    ].join(", ");
  }

  function imageAgentPrefixes(settings: Record<string, unknown>, agentId?: string) {
    const allPrefixes = settings.agentPrefixes && typeof settings.agentPrefixes === "object" ? settings.agentPrefixes as Record<string, unknown> : {};
    const raw = agentId ? allPrefixes[agentId] : undefined;
    return raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  }

  function imagePromptWithPrefixes(prompt: string, settings: Record<string, unknown>, agentId?: string) {
    const prefixes = imageAgentPrefixes(settings, agentId);
    const positivePrefix = String(prefixes.positive || "").trim();
    const negativePrefix = String(prefixes.negative || "").trim();
    return {
      prompt: [positivePrefix, prompt.trim()].filter(Boolean).join(", "),
      negativePrompt: negativePrefix
    };
  }

  function buildPromptProfileImageSource(profile: PromptProfile) {
    const name = String(profile.assistantName || profile.name || "AI agent").trim();
    return [
      `Agent name: ${name}`,
      `System prompt:\n${profile.blocks.filter((block) => block.enabled).map((block) => block.content).join("\n\n")}`,
      profile.startingMessage ? `Starting message:\n${profile.startingMessage}` : "",
      profile.dialogueExamples ? `Dialogue examples:\n${profile.dialogueExamples}` : ""
    ].filter(Boolean).join("\n\n");
  }

  async function generatePromptProfileImagePrompt(profile: PromptProfile) {
    return requestProfileMediaPrompt("avatar", buildPromptProfileImageSource(profile), providerForAgent(profile));
  }

  async function generatePromptProfileLiveCardPrompt(profile: PromptProfile) {
    return requestProfileMediaPrompt("live-card", buildPromptProfileImageSource(profile), providerForAgent(profile), profile.imageUrl || "");
  }

  async function rewritePromptProfileSection(profile: PromptProfile, section: PromptBlock, instruction: string) {
    const res = await fetch("/api/agents/rewrite-section", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        promptProfile: profile,
        provider: providerForAgent(profile),
        modules,
        sectionId: section.id,
        sectionName: section.name,
        currentContent: section.content,
        instruction
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = String(data?.error || "Agent section rewrite failed.");
      setError(message);
      throw new Error(message);
    }
    const content = String(data?.content || "").trim();
    if (!content) {
      const message = "Agent section rewrite returned empty content.";
      setError(message);
      throw new Error(message);
    }
    setError("");
    return content;
  }

  async function rewriteUserSection(user: UserProfile, sectionId: string, sectionName: string, currentContent: string, instruction: string) {
    const res = await fetch("/api/agents/rewrite-section", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        promptProfile: {
          name: user.name,
          assistantName: user.name,
          blocks: [],
          dialogueExamples: user.dialogueExamples,
          startingMessage: user.startingMessage
        },
        provider: providerProfiles.find((p) => p.id === activeProviderId) ?? provider,
        modules,
        sectionName,
        currentContent,
        instruction
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = String(data?.error || "User section rewrite failed.");
      setError(message);
      throw new Error(message);
    }
    const content = String(data?.content || "").trim();
    if (!content) {
      const message = "User section rewrite returned empty content.";
      setError(message);
      throw new Error(message);
    }
    setError("");
    return content;
  }

  async function selfEditUser(user: UserProfile, provider: ProviderConfig) {
    const res = await fetch("/api/modules/evolution/self-edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        promptProfile: {
          id: user.id,
          name: user.name,
          assistantName: user.name,
          blocks: [
            { id: "description", name: "Description", content: user.description || "", enabled: true, role: "system", position: "top", priority: 50 },
            { id: "personality", name: "Personality", content: user.personality || "", enabled: true, role: "system", position: "top", priority: 55 },
            { id: "appearance", name: "Appearance", content: user.appearance || "", enabled: true, role: "system", position: "top", priority: 60 },
            { id: "response-guidelines", name: "Response Guidelines", content: user.responseGuidelines || "", enabled: true, role: "system", position: "top", priority: 65 },
            { id: "preferences", name: "Preferences", content: user.preferences || "", enabled: true, role: "system", position: "top", priority: 70 }
          ],
          dialogueExamples: user.dialogueExamples,
          startingMessage: user.startingMessage
        },
        provider
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(String(data?.error || "Self-edit failed."));
    return (data.changes || []) as Array<{ section: string; content: string }>;
  }

  async function generateImage(runId: string, prompt: string, agentId?: string) {
    const settings = imageGenerationSettings();
    if (!settings || !prompt.trim() || imageRuns[runId]?.status === "running") return;
    const mediaProvider = mediaProviderWithModel(settings, "imageModel");
    const finalPrompt = imagePromptWithPrefixes(prompt, settings, agentId);
    if (!mediaProvider) {
      const error = "Select a media creation provider in the module settings.";
      setError(error);
      setImageRuns((current) => ({ ...current, [runId]: { ...current[runId], status: "error", prompt: finalPrompt.prompt, error } }));
      return;
    }
    setImageRuns((current) => ({ ...current, [runId]: { ...current[runId], status: "running", prompt: finalPrompt.prompt } }));
    setError("");
    try {
      const res = await fetch("/api/modules/image-generation/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, prompt: finalPrompt.prompt, negativePrompt: finalPrompt.negativePrompt, settings, provider: mediaProvider })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Image generation failed.");
      setImageRuns((current) => ({ ...current, [runId]: appendImageVariant(current[runId], data as ImageGenerationVariant) }));
    } catch (err) {
      const error = err instanceof Error ? err.message : "Image generation failed.";
      setError(error);
      setImageRuns((current) => ({ ...current, [runId]: { ...current[runId], status: "error", prompt: finalPrompt.prompt, error } }));
    }
  }

  async function generatePromptProfileImage(profile: PromptProfile) {
    try {
      await generateProfileMedia("image", profile, await generatePromptProfileImagePrompt(profile), (patch) => updatePromptProfileById(profile.id, patch));
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Agent image generation failed.");
      throw error;
    }
  }

  async function generatePromptProfileVideo(profile: PromptProfile) {
    try {
      await generateProfileMedia("video", profile, await generatePromptProfileLiveCardPrompt(profile), (patch) => updatePromptProfileById(profile.id, patch));
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Agent live card generation failed.");
      throw error;
    }
  }

  async function steerGenerateProfileImage(profile: PromptProfile, instruction: string) {
    const steerProvider = providerForAgent(profile);
    const prompt = await requestSteeredMediaPrompt("avatar", await generatePromptProfileImagePrompt(profile), instruction, steerProvider);
    await generateProfileMedia("image", profile, prompt, (patch) => updatePromptProfileById(profile.id, patch));
  }

  async function steerGenerateProfileVideo(profile: PromptProfile, instruction: string) {
    const steerProvider = providerForAgent(profile);
    const prompt = await requestSteeredMediaPrompt("livecard", await generatePromptProfileLiveCardPrompt(profile), instruction, steerProvider);
    await generateProfileMedia("video", profile, prompt, (patch) => updatePromptProfileById(profile.id, patch));
  }

  async function generateVideo(runId: string, prompt: string, agentId?: string, sourceImageUrl?: string) {
    const settings = imageGenerationSettings();
    if (!settings || !prompt.trim() || videoRuns[runId]?.status === "running") return;
    const mediaProvider = mediaProviderWithModel(settings, "videoModel");
    const promptProfile = agentId ? promptProfiles.find((item) => item.id === agentId) ?? primaryPromptProfile() : primaryPromptProfile();
    const promptProvider = providerForAgent(promptProfile);
    const finalPrompt = imagePromptWithPrefixes(prompt, settings, agentId);
    if (!mediaProvider) {
      const error = "Select a media creation provider in the module settings.";
      setError(error);
      setVideoRuns((current) => ({ ...current, [runId]: { ...current[runId], status: "error", prompt: finalPrompt.prompt, error } }));
      return;
    }
    setVideoRuns((current) => ({ ...current, [runId]: { ...current[runId], status: "running", prompt: finalPrompt.prompt } }));
    setError("");
    try {
      const res = await fetch("/api/modules/image-generation/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, prompt: finalPrompt.prompt, settings, provider: mediaProvider, promptProvider, sourceImageUrl })
      });
      const data = await res.json();
      if (!res.ok) {
        const upstreamError = data?.error || "Video generation failed.";
        if (!sourceImageUrl && /not support/i.test(upstreamError)) {
          const imageProvider = mediaProviderWithModel(settings, "imageModel");
          if (imageProvider) {
            const imageRes = await fetch("/api/modules/image-generation/generate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ agentId, prompt: finalPrompt.prompt, negativePrompt: finalPrompt.negativePrompt, settings, provider: imageProvider })
            });
            const imageData = await imageRes.json();
            if (imageRes.ok && imageData?.url) {
              const retryRes = await fetch("/api/modules/image-generation/generate-video", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ agentId, prompt: finalPrompt.prompt, settings, provider: mediaProvider, promptProvider, sourceImageUrl: imageData.url })
              });
              const retryData = await retryRes.json();
              if (retryRes.ok) {
                setVideoRuns((current) => ({ ...current, [runId]: appendVideoVariant(current[runId], retryData as VideoGenerationVariant) }));
                return;
              }
              throw new Error(retryData?.error || "Video generation failed.");
            }
            throw new Error(imageData?.error || "Failed to generate intermediate image for video.");
          }
        }
        throw new Error(upstreamError);
      }
      setVideoRuns((current) => ({ ...current, [runId]: appendVideoVariant(current[runId], data as VideoGenerationVariant) }));
    } catch (err) {
      const error = err instanceof Error ? err.message : "Video generation failed.";
      setError(error);
      setVideoRuns((current) => ({ ...current, [runId]: { ...current[runId], status: "error", prompt: finalPrompt.prompt, error } }));
    }
  }

  function clearImageRun(runId: string) {
    setImageRuns((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== runId)));
  }

  function clearVideoRun(runId: string) {
    setVideoRuns((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== runId)));
  }

  function selectImageRunVariant(runId: string, index: number) {
    setImageRuns((current) => current[runId] ? { ...current, [runId]: { ...current[runId], selectedIndex: index } } : current);
  }

  function selectVideoRunVariant(runId: string, index: number) {
    setVideoRuns((current) => current[runId] ? { ...current, [runId]: { ...current[runId], selectedIndex: index } } : current);
  }

  function renderMessage(message: ChatMessage, sessionId: string, profile: PromptProfile, options: { hideMetadataPrefix?: boolean } = {}) {
    return <MessageArticle
      editingDraft={editingDraft}
      editingMessageId={editingMessageId}
      hideMetadataPrefix={options.hideMetadataPrefix}
      imageGenerationEnabled={!!imageGenerationSettings()}
      imageRuns={imageRuns}
      videoRuns={videoRuns}
      key={message.id}
      message={message}
      onCancelEditing={cancelEditingMessage}
      onClearImage={clearImageRun}
      onClearVideo={clearVideoRun}
      onDelete={deleteMessageFromChat}
      onEditingDraftChange={setEditingDraft}
      onGenerateImage={generateImage}
       onGenerateVideo={generateVideo}
       onHypnoChoice={submitHypnoChoice}
       onRunPythonCode={runPythonCodeBlock}
       onUpdateImagePrompt={(runId, newPrompt) => setImageRuns((prev) => ({ ...prev, [runId]: { ...prev[runId], prompt: newPrompt } }))}
       onUpdateVideoPrompt={(runId, newPrompt) => setVideoRuns((prev) => ({ ...prev, [runId]: { ...prev[runId], prompt: newPrompt } }))}
      onSaveEdited={saveEditedMessage}
      onStartEditing={startEditingMessage}
      profile={profile}
      pythonRuns={pythonRuns}
      pythonSandboxEnabled={!!pythonSandboxSettings()}
      pythonSandboxRequireConfirmation={pythonSandboxSettings()?.requireConfirmation !== false}
       selectImageRunVariant={selectImageRunVariant}
       selectVideoRunVariant={selectVideoRunVariant}
       sessionId={sessionId}
       userName={activeUser?.name || "User"}
    />;
  }

  function formatTimestamp(timestamp: number) {
    return new Date(timestamp).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
  }

  function messageTimestamp(timestamp: number) {
    return new Date(timestamp).toLocaleString([], { year: "2-digit", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  const currentSessionPreview = useMemo<ChatSession | null>(() => messages.length > 0 ? {
    id: "current",
    chatNumber: activeSessionId ? sessions.find((item) => item.id === activeSessionId)?.chatNumber ?? 0 : 0,
    title: currentChatTitle || messages.find((message) => message.role === "user")?.content.slice(0, 48) || "Current chat",
    createdAt: Date.now(),
    messages,
    promptProfile: primaryPromptProfile(),
    agentIds: activeAgentIds,
    provider
  } : null, [activeAgentIds, activeSessionId, currentChatTitle, messages, provider, promptProfile, promptProfiles, activePromptProfileId, sessions]);

  const visibleChatCards = useMemo(() => currentSessionPreview ? [currentSessionPreview, ...sessions.filter((session) => session.id !== activeSessionId)] : sessions, [activeSessionId, currentSessionPreview, sessions]);

  const visibleChatMessages = useMemo(() => messages.slice(-1), [messages]);

  const chatBackground = backgroundAssetFromUrl(activeBackgroundUrl, backgroundAssets);
  const chatBackgroundDim = Math.max(0, Math.min(100, Number(appearanceSettings.dimStrength ?? 45))) / 100;
  const chatBackgroundBlur = appearanceSettings.blurBackground === true;
  const callModeConfig = moduleConfigById.get("callmode");
  const callModeSettings = settingObject(callModeConfig?.settings);
  const vrmConfig = moduleConfigById.get("vrm");
  const vrmSettings = settingObject(vrmConfig?.settings);
  const callModeActive = callModeConfig?.enabled === true && callModeStatus !== "idle";

  const activeChatAgent = resolveActiveChatAgent(activeAgentIds, promptProfiles);
  const activeChatAgentId = activeChatAgent?.id || "";
  const vrmModelMap = settingObject(vrmSettings.vrmModelMap);
  const resolvedVrmModelUrl = String(settingObject(vrmModelMap[activeChatAgentId]).model || "");
  const activeVrmCharacter = String(activeChatAgent?.assistantName || activeChatAgent?.name || "").trim();
  const vrmModelUrl = resolvedVrmModelUrl;
  const vrmModelSettings = completeVrmModelSettings(vrmSettings, vrmModelUrl);
  const vrmCharacterModels: Array<{ character: string; modelSettings: Record<string, unknown>; modelUrl: string }> =
    vrmModelUrl && activeVrmCharacter
      ? [{ character: activeVrmCharacter, modelUrl: vrmModelUrl, modelSettings: vrmModelSettings }]
      : [];
    const vrmStage = {
        animations: vrmAnimations,
        autoSendHitboxMessage: vrmSettings.vrmAutoSendHitboxMessage === true,
        chestJiggleEnabled: vrmSettings.vrmChestJiggleEnabled === true,
        chestJiggleAccelerometer: vrmSettings.vrmChestJiggleAccelerometer === true,
        chestJiggleStrength: Math.max(0, Math.min(500, Number(vrmSettings.vrmChestJiggleStrength ?? 35) || 35)),
        chestJiggleSoftness: Math.max(0, Math.min(100, Number(vrmSettings.vrmChestJiggleSoftness ?? 45) || 45)),
        chestJiggleGravity: Math.max(0, Math.min(100, Number(vrmSettings.vrmChestJiggleGravity ?? 20) || 20)),
        chestJiggleVertical: Math.max(0, Math.min(250, Number(vrmSettings.vrmChestJiggleVertical ?? 100) || 100)),
        chestJiggleSway: Math.max(0, Math.min(250, Number(vrmSettings.vrmChestJiggleSway ?? 100) || 100)),
        chestJiggleDepth: Math.max(0, Math.min(250, Number(vrmSettings.vrmChestJiggleDepth ?? 70) || 70)),
        enabled: vrmConfig?.enabled === true && vrmSettings.vrmEnabled === true,
        characters: vrmCharacterModels.map((entry) => entry.character),
        characterModels: vrmCharacterModels,
        followCamera: vrmSettings.vrmFollowCamera === true,
        followCursor: vrmSettings.vrmFollowCursor === true,
        hitboxes: vrmSettings.vrmHitboxes === true,
        lightColor: String(vrmSettings.vrmLightColor || "#ffffff"),
        lightIntensity: Number(vrmSettings.vrmLightIntensity ?? 100) || 100,
        lightPreset: String(vrmSettings.vrmLightPreset || "studio"),
        rimLightEnabled: vrmSettings.vrmRimLightEnabled !== false,
        rimLightColor: String(vrmSettings.vrmRimLightColor || "#d9e8ff"),
        rimLightIntensity: Math.max(0, Math.min(250, Number(vrmSettings.vrmRimLightIntensity ?? 85) || 85)),
        fillLightIntensity: Math.max(0, Math.min(200, Number(vrmSettings.vrmFillLightIntensity ?? 35) || 35)),
        ambientLightIntensity: Math.max(0, Math.min(200, Number(vrmSettings.vrmAmbientLightIntensity ?? 45) || 45)),
        keyLightAngle: Math.max(-90, Math.min(90, Number(vrmSettings.vrmKeyLightAngle ?? 35) || 35)),
        lightingContrast: Math.max(0, Math.min(100, Number(vrmSettings.vrmLightingContrast ?? 55) || 55)),
        modelZIndex: Number(vrmSettings.vrmModelZIndex ?? 4) || 4,
        modelsCache: vrmSettings.vrmModelsCache === true,
        naturalIdle: vrmSettings.vrmNaturalIdle !== false,
        blink: vrmSettings.vrmBlink === true,
        animationsCache: vrmSettings.vrmAnimationsCache === true,
        showGrid: vrmSettings.vrmShowGrid === true,
        ttsLipsSync: vrmSettings.vrmTtsLipsSync === true,
        showStatus: vrmSettings.vrmShowStatus === true,
        modelUrl: vrmModelUrl,
    modelSettings: vrmModelSettings,
    positionX: Number(vrmModelSettings.x ?? vrmSettings.vrmModelPositionX ?? 0) || 0,
    positionY: Number(vrmModelSettings.y ?? vrmSettings.vrmModelPositionY ?? 0) || 0,
    positionZ: Number(vrmModelSettings.z ?? 0) || 0,
    rotationX: Number(vrmModelSettings.rx ?? vrmSettings.vrmModelRotationX ?? 0) || 0,
    rotationY: Number(vrmModelSettings.ry ?? vrmSettings.vrmModelRotationY ?? 0) || 0,
    rotationZ: Number(vrmModelSettings.rz ?? 0) || 0,
    scale: Number(vrmModelSettings.scale ?? vrmSettings.vrmModelScale ?? 3) || 3
  };

  function renderModuleSettingsPanel(manifest: ModuleManifest, settings: ModuleSettings): ReactNode {
    return <ModuleSettingsPanelRouter
      activePromptProfile={activePromptProfile}
      activeUserName={activeUser?.name || "User"}
      backgroundAssets={backgroundAssets}
      calculate={(expression) => postJson("/api/modules/calculator/calculate", { expression })}
      classifySentiments={classifySentiments}
      compactJson={compactJson}
      createReminder={createReminder}
      deleteLibraryDocument={deleteLibraryDocument}
      deleteReminder={deleteReminder}
      documents={documents}
      formatBytes={formatBytes}
      formatTimestamp={formatTimestamp}
      manifest={manifest}
      memories={memories}
      moduleEvents={moduleEvents}
      modules={modules}
      notes={notes}
      notifications={notifications}
      onError={setError}
      onMicLevelTest={toggleMicLevelTest}
      onSettingChange={(key, value) => updateModuleSetting(manifest.id, key, value)}
      postJson={postJson}
      provider={provider}
      promptProfiles={promptProfiles}
      providerProfiles={providerProfiles}
      refreshBasicModules={refreshBasicModules}
      refreshNotifications={refreshNotifications}
      refreshReminders={refreshReminders}
      reminderCalendar={renderReminderCalendar()}
      reminderDraft={reminderDraft}
      reminders={reminders}
      selectedDocument={selectedDocument}
      setReminderDraft={setReminderDraft}
      setSimpleDraft={setSimpleDraft}
      settings={settings}
      simpleDraft={simpleDraft}
      summaries={summaries}
      tasks={tasks}
      viewLibraryDocument={viewLibraryDocument}
    />;
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Fullscreen request failed.");
    }
  }

  return (
    <div className="app-shell">
      {isBooting ? <div className="boot-overlay" role="status" aria-live="polite">
        <div className="boot-card">
          <span className="boot-kicker">ErisHub</span>
          <strong>Preparing saved workspace</strong>
          <span>Indexing assets, rendering chat, active background, agent model, and module runtime.</span>
        </div>
      </div> : null}
      {callModeActive && callModeHypnoPrompt ? <div className="hypno-call-choice-overlay" role="dialog" aria-live="polite" aria-label="Hypno prompt">
        <div className="hypno-call-choice-card">
          {callModeHypnoPrompt.prompt ? <strong>{callModeHypnoPrompt.prompt}</strong> : null}
          <div className="hypno-choice-row">{callModeHypnoPrompt.choices.map((choice) => <button type="button" key={choice.label} onClick={() => submitHypnoChoice(choice.label, choice.value)}>{choice.label}</button>)}</div>
          <button className="hypno-call-choice-dismiss" type="button" onClick={() => setCallModeHypnoPrompt(null)}>Dismiss</button>
        </div>
      </div> : null}
      <SidebarNav activePage={activePage} pages={pages} onPageChange={setActivePage} />
      {error || toasts.length ? <div className="toast-stack" aria-live="polite">{error ? <div className="toast-card error" key="app-error" role="button" tabIndex={0} title="Click to copy and dismiss error" onClick={copyAndDismissAppError} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") copyAndDismissAppError(); }}><strong>Error</strong><span>{error}</span></div> : null}{toasts.map((toast) => <div className={`toast-card ${toast.kind}`} key={toast.id} role={toast.kind === "error" ? "button" : undefined} tabIndex={toast.kind === "error" ? 0 : undefined} title={toast.kind === "error" ? "Click to copy and dismiss error" : undefined} onClick={toast.kind === "error" ? () => copyAndDismissToast(toast) : undefined} onKeyDown={toast.kind === "error" ? (event) => { if (event.key === "Enter" || event.key === " ") copyAndDismissToast(toast); } : undefined}><strong>{toast.title}</strong>{toast.message ? <span>{toast.message}</span> : null}</div>)}</div> : null}
      <main className="main-panel">
        {activePage === "editor" ? <EditorPage
          callModeActive={callModeActive}
          callModeLevel={callModeLevel}
          callModeMuted={callModeMuted}
          callModeTtsVolume={callModeTtsVolume}
          chatBackground={chatBackground}
          chatBackgroundBlur={chatBackgroundBlur}
          chatBackgroundDim={chatBackgroundDim}
          chatFileInputRef={chatFileInputRef}
          composerTextareaRef={composerTextareaRef}
          computationEnabled={computationEnabled}
          draggedAgentId={draggedAgentId}
          error=""
          editorCodeCompletionEnabled={chatSettings.editorCodeCompletionEnabled}
          hasDraft={hasDraft}
          inspectedSessionId={inspectedSessionId}
          isChatManagerOpen={isChatManagerOpen}
          isSending={isSending}
          isUtilityMenuOpen={isUtilityMenuOpen}
          modules={modules}
          onCallModeMuteToggle={toggleCallModeMute}
          onCallModeToggle={toggleCallMode}
          onCallModeTtsVolumeChange={(value) => setCallModeTtsVolume(Math.max(0, Math.min(100, value)))}
          promptProfile={promptProfile}
          promptProfiles={promptProfiles}
          provider={provider}
          showRawHistory={showRawHistory}
          visibleChatCards={visibleChatCards}
          vrmStage={vrmStage}
          deleteSession={deleteSession}
          formatTimestamp={formatTimestamp}
          loadSession={loadSession}
          moveSessionAgent={moveSessionAgent}
          messages={messages}
          onDraftChange={handleDraftChange}
          onError={setError}
          onFileUpload={handleChatFileUpload}
          onKeyDown={handleComposerKeyDown}
          onOpenAuditLog={openAuditLog}
          onRegenerate={regenerateLastResponse}
          onRefreshAuditLog={refreshBasicModules}
          onSubmit={sendMessage}
          pendingAttachments={pendingAttachments}
          postJson={postJson}
          pythonRuns={pythonRuns}
          renderMessage={renderMessage}
          runPythonCode={runPythonCodeBlock}
          runJavaScriptCode={runJavaScriptCodeBlock}
          setDraggedAgentId={setDraggedAgentId}
          setInspectedSessionId={setInspectedSessionId}
          setIsChatManagerOpen={setIsChatManagerOpen}
          setIsUtilityMenuOpen={setIsUtilityMenuOpen}
          setPendingAttachments={setPendingAttachments}
          setShowRawHistory={setShowRawHistory}
          startNewChat={startNewChat}
          toggleSessionAgent={toggleSessionAgent}
        /> : <ChatPage
          chatBackground={chatBackground}
          chatBackgroundBlur={chatBackgroundBlur}
          chatBackgroundDim={chatBackgroundDim}
          chatFileInputRef={chatFileInputRef}
          callModeActive={callModeActive}
          callModeLevel={callModeLevel}
          callModeMuted={callModeMuted}
          callModeTtsVolume={callModeTtsVolume}
          composerTextareaRef={composerTextareaRef}
          deleteSession={deleteSession}
          draggedAgentId={draggedAgentId}
          error=""
          formatTimestamp={formatTimestamp}
          handleChatFileUpload={handleChatFileUpload}
          handleComposerKeyDown={handleComposerKeyDown}
          handleDraftChange={handleDraftChange}
          hasDraft={hasDraft}
          hideChatShield={callModeActive && callModeSettings.callModeHideChatShield === true}
          inspectedSessionId={inspectedSessionId}
          isChatManagerOpen={isChatManagerOpen}
          isSending={isSending}
          isUtilityMenuOpen={isUtilityMenuOpen}
          loadSession={loadSession}
          messagesLength={messages.length}
          moveSessionAgent={moveSessionAgent}
          onCallModeMuteToggle={toggleCallModeMute}
          onCallModeToggle={toggleCallMode}
          onCallModeTtsVolumeChange={(value) => setCallModeTtsVolume(Math.max(0, Math.min(100, value)))}
          openAuditLog={openAuditLog}
          onToggleFullscreen={toggleFullscreen}
          pendingAttachments={pendingAttachments}
          promptProfile={promptProfile}
          promptProfiles={promptProfiles}
          regenerateLastResponse={regenerateLastResponse}
          renderMessage={renderMessage}
          sendMessage={sendMessage}
          setDraggedAgentId={setDraggedAgentId}
          setInspectedSessionId={setInspectedSessionId}
          setIsChatManagerOpen={setIsChatManagerOpen}
          setIsUtilityMenuOpen={setIsUtilityMenuOpen}
          setPendingAttachments={setPendingAttachments}
          setShowRawHistory={setShowRawHistory}
          showRawHistory={showRawHistory}
          startNewChat={startNewChat}
          toggleSessionAgent={toggleSessionAgent}
          visibleChatCards={visibleChatCards}
          visibleChatMessages={visibleChatMessages}
          vrmStage={vrmStage}
        />}

        {activePage === "settings" ? <SettingsPage
          appearancePanel={<AppearanceSettingsPanel
            backgroundAssets={backgroundAssets}
            onAutoPick={() => autopickBackgroundWithModel().then((asset) => asset && setAppearanceSettings((current) => ({ ...current, backgroundUrl: asset.url }))).catch((error) => setError(error instanceof Error ? error.message : "Background selection failed."))}
            onError={setError}
            onSettingChange={(key, value) => setAppearanceSettings((current) => ({ ...current, [key]: value }))}
            provider={provider}
            settings={appearanceSettings}
          />}
          editorCodeCompletionEnabled={chatSettings.editorCodeCompletionEnabled}
          onEditorCodeCompletionEnabledChange={(editorCodeCompletionEnabled) => setChatSettings((current) => ({ ...current, editorCodeCompletionEnabled }))}
          onWrapNormalChatMessagesChange={(wrapNormalChatMessages) => setChatSettings((current) => ({ ...current, wrapNormalChatMessages }))}
          providerPanel={<ProviderPage
            activeProviderId={activeProviderId}
            onAddProvider={addProvider}
            onDeleteProvider={deleteProvider}
            onProviderChange={setActiveProviderId}
            onUpdateProvider={updateProvider}
            provider={provider}
            providerProfiles={providerProfiles}
          />}
          wrapNormalChatMessages={chatSettings.wrapNormalChatMessages}
        /> : null}

        {activePage === "agents" ? <AgentsPage
          activePromptProfileId={activePromptProfileId}
          activeProviderId={activeProviderId}
          defaultPromptBlock={defaultPromptProfile.blocks[0]}
          onAddPromptProfile={addPromptProfile}
          onDeletePromptProfile={deletePromptProfile}
          onGeneratePromptProfileImage={generatePromptProfileImage}
          onGeneratePromptProfileVideo={generatePromptProfileVideo}
          onSteerGenerateImage={steerGenerateProfileImage}
          onSteerGenerateVideo={steerGenerateProfileVideo}
          onPromptProfileChange={setActivePromptProfileId}
          onRewritePromptSection={rewritePromptProfileSection}
          onUpdatePromptProfile={updatePromptProfileById}
          promptProfile={promptProfile}
          promptProfiles={promptProfiles}
          providerProfiles={providerProfiles}
        /> : null}

        {activePage === "users" ? <UsersPage
          activeUserId={activeUserId}
          activeProviderId={activeProviderId}
          activeUser={activeUser}
          userProfiles={userProfiles}
          providerProfiles={providerProfiles}
          onActiveUserChange={(userId) => { setActiveUserId(userId); saveState("activeUserId", userId); }}
          onAddUser={addUserProfile}
          onDeleteUser={deleteUserProfile}
          onUpdateUser={updateUserProfile}
          onGenerateUserImage={generateUserProfileImage}
          onGenerateUserVideo={generateUserProfileVideo}
          onSteerGenerateUserImage={steerGenerateUserImage}
          onSteerGenerateUserVideo={steerGenerateUserVideo}
          onRewriteUserSection={rewriteUserSection}
          onSelfEditUser={selfEditUser}
        /> : null}

        {activePage === "modules" ? <ModulesPage
          expandedModuleId={expandedModuleId}
          moduleConfigById={moduleConfigById}
          moduleManifestColumns={moduleManifestColumns}
          moduleManifests={moduleManifests}
          onUpdateModule={updateModule}
          renderModuleSettingsPanel={renderModuleSettingsPanel}
          setExpandedModuleId={setExpandedModuleId}
        /> : null}
      </main>
    </div>
  );
}
