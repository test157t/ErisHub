import type { ChatRequest } from "../../shared/types";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { calculateExpression } from "./calculator";
import { createMemory } from "./memory";
import { createNote, updateNote } from "./notes";
import { createNotification } from "./notifications";
import { createScheduledItem } from "./reminders";
import { getDocument, searchDocuments } from "./fileLibrary";
import { createTask, listTasks, updateTask } from "./tasks";
import { callAgent } from "./agentCall";
import { runWebSearchAction } from "./webSearch";
import { recordModuleEvent } from "./moduleEventLog";
import { checkToolPermission } from "./toolPermissionGuard";
import { applyAssistantFileHashlines, createAssistantFile, createCalendarEvent, createContact, createProject, deleteAssistantFile, updateAssistantFile, updateCalendarEvent, updateContact, updateProject, updateUserProfile } from "./coreAssistant";
import { supportedActionTypeSet } from "./actionDefinitions";

export type ActionMode = "commit" | "inline-result" | "continue";
export type InlineAction = { id: string; type: string; attrs: Record<string, string>; body: string; mode: ActionMode };
export type InlineActionResult = { action: InlineAction; status: "executed" | "blocked" | "invalid" | "duplicate" | "error" | "continuation-required"; result?: unknown; error?: string };

function actionMode(type: string, attrs: Record<string, string>): ActionMode {
  if (type === "calculate") return "inline-result";
  if (type === "hypno.session.start") return "continue";
  if (type === "task.execute") return "continue";
  if ((type === "task.create" || type === "task.update") && attrs.status === "doing") return "continue";
  if (type === "agent.ask" || type === "web.search" || type === "file.search" || type === "file.get" || type === "python.run") return "continue";
  return "commit";
}

function stableActionId(type: string, attrs: Record<string, string>, body: string) {
  const explicit = String(attrs.actionId || attrs.idempotencyKey || "").trim();
  if (explicit) return explicit.slice(0, 120);
  const normalizedAttrs = Object.keys(attrs).filter((key) => key !== "actionId" && key !== "idempotencyKey").sort().reduce<Record<string, string>>((acc, key) => {
    acc[key] = attrs[key];
    return acc;
  }, {});
  return createHash("sha256").update(JSON.stringify({ type, attrs: normalizedAttrs, body })).digest("hex").slice(0, 24);
}

export function stripInlineActions(content: string) {
  return String(content || "").trim();
}

function moduleAllows(request: ChatRequest, id: string, setting = "allowModelCreate") {
  if (id === "memory") {
    const config = request.modules.find((item) => item.id === "memory-bank" && item.enabled);
    return Boolean(config && config.settings?.allowModelCreate !== false);
  }
  if (id === "notes") {
    const config = request.modules.find((item) => item.id === "memory-bank" && item.enabled);
    return Boolean(config && config.settings?.allowModelCreate !== false);
  }
  if (id === "tasks") {
    const config = request.modules.find((item) => item.id === "organizer" && item.enabled);
    return Boolean(config && config.settings?.allowModelCreate !== false);
  }
  if (id === "reminders") {
    const config = request.modules.find((item) => item.id === "organizer" && item.enabled);
    return Boolean(config && config.settings?.allowModelCreate !== false);
  }
  if (id === "assistant-files") {
    const config = request.modules.find((item) => item.id === "memory-bank" && item.enabled);
    return Boolean(config && config.settings?.allowModelCreate !== false);
  }
  if (id === "contacts") {
    const config = request.modules.find((item) => item.id === "contacts" && item.enabled);
    return Boolean(config && config.settings?.allowModelCreate !== false);
  }
  if (id === "user-profile") {
    const config = request.modules.find((item) => item.id === "memory-bank" && item.enabled);
    return Boolean(config && config.settings?.allowModelCreate !== false);
  }
  if (id === "projects") {
    const config = request.modules.find((item) => item.id === "projects" && item.enabled);
    return Boolean(config && config.settings?.allowModelCreate !== false);
  }
  if (id === "calendar") {
    const config = request.modules.find((item) => item.id === "organizer" && item.enabled);
    return Boolean(config && config.settings?.allowModelCreate !== false);
  }
  const config = request.modules.find((item) => item.id === id && item.enabled);
  return Boolean(config && config.settings?.[setting] !== false);
}

function moduleEnabled(request: ChatRequest, id: string) {
  if (id === "notifications") return request.modules.some((item) => item.id === "organizer" && item.enabled);
  if (id === "file-library") return request.modules.some((item) => item.id === "memory-bank" && item.enabled);
  return request.modules.some((item) => item.id === id && item.enabled);
}

function moduleSettings(request: ChatRequest, id: string) {
  if (id === "file-library") return request.modules.find((item) => item.id === "memory-bank" && item.enabled)?.settings || {};
  return request.modules.find((item) => item.id === id && item.enabled)?.settings || {};
}

function hasText(value: unknown) {
  return String(value || "").trim().length > 0;
}

function trimmedText(value: unknown) {
  return String(value || "").trim();
}

async function actionWithTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s.`)), ms); });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function mediaTaskNeedsDeliverable(value: string) {
  return /\b(image|images|picture|pictures|photo|photos|pic|pics|wallpaper|reference|refs)\b/i.test(value);
}

function videoTaskNeedsDeliverable(value: string) {
  return /\b(video|videos|clip|clips|youtube|vimeo|watch|hypnotube|pornhub)\b/i.test(value);
}

function taskNeedsWebSearch(value: string) {
  return mediaTaskNeedsDeliverable(value) || videoTaskNeedsDeliverable(value) || /\b(web\s*search|internet|online|search|look\s*up|lookup|find|current|latest|recent|source|sources)\b/i.test(value);
}

async function automaticMediaFollowup(request: ChatRequest, taskText: string) {
  if (!mediaTaskNeedsDeliverable(taskText) || !moduleEnabled(request, "web-search")) return null;
  const search = await runWebSearchAction(taskText, { ...moduleSettings(request, "web-search"), includeImages: true });
  const images = Array.isArray((search as { images?: unknown }).images) ? (search as { images: Array<{ imageUrl?: unknown; title?: unknown }> }).images : [];
  const firstImage = images.find((item) => String(item?.imageUrl || "").trim());
  if (!firstImage) return { webSearch: search, renderedMedia: [] };
  return {
    webSearch: search,
    renderedMedia: [{ type: "image", src: String(firstImage.imageUrl), alt: String(firstImage.title || taskText) }]
  };
}

async function automaticVideoFollowup(request: ChatRequest, taskText: string) {
  if (!videoTaskNeedsDeliverable(taskText) || !moduleEnabled(request, "web-search")) return null;
  const search = await runWebSearchAction(taskText, { ...moduleSettings(request, "web-search"), includeVideos: true });
  const videos = Array.isArray((search as { videos?: unknown }).videos) ? (search as { videos: Array<{ url?: unknown; title?: unknown }> }).videos : [];
  const firstVideo = videos.find((item) => String(item?.url || "").trim());
  if (!firstVideo) return { webSearch: search, renderedMedia: [] };
  return {
    webSearch: search,
    renderedMedia: [{ type: "video", src: String(firstVideo.url), alt: String(firstVideo.title || taskText) }]
  };
}

async function automaticAnyMediaFollowup(request: ChatRequest, taskText: string) {
  const videoResult = await automaticVideoFollowup(request, taskText);
  if (videoResult) return videoResult;
  return automaticMediaFollowup(request, taskText);
}

async function executeTaskWorkflow(request: ChatRequest, taskId: string) {
  const task = (await listTasks()).find((item) => item.id === taskId);
  if (!task) throw new Error("Task not found.");
  if (task.status === "done" || task.status === "blocked") return { task, workflow: "already-completed", automatic: { renderedMedia: [] } };
  const taskText = [task.title, task.note].filter(Boolean).join(" ");
  await updateTask(task.id, { status: "doing", note: task.note });

  if (videoTaskNeedsDeliverable(taskText)) {
    const search = moduleEnabled(request, "web-search") ? await runWebSearchAction(taskText, { ...moduleSettings(request, "web-search"), includeVideos: true }) : null;
    const videos = search && Array.isArray((search as { videos?: unknown }).videos) ? (search as { videos: Array<{ url?: unknown; title?: unknown }> }).videos : [];
    const firstVideo = videos.find((item) => String(item?.url || "").trim());
    if (firstVideo) {
      const updated = await updateTask(task.id, { status: "done", note: "Completed automatically with a real inline video result." });
      return { task: updated, workflow: "web.video", automatic: { webSearch: search, renderedMedia: [{ type: "video", src: String(firstVideo.url), alt: String(firstVideo.title || taskText) }] } };
    }
    const updated = await updateTask(task.id, { status: "blocked", note: "Blocked: no usable video result was returned." });
    return { task: updated, workflow: "web.video", automatic: { webSearch: search, renderedMedia: [] } };
  }

  if (mediaTaskNeedsDeliverable(taskText)) {
    const automatic = await automaticMediaFollowup(request, taskText);
    if (automatic?.renderedMedia.length) {
      const updated = await updateTask(task.id, { status: "done", note: "Completed automatically with a real inline image result." });
      return { task: updated, workflow: "web.image", automatic };
    }
    const updated = await updateTask(task.id, { status: "blocked", note: "Blocked: no usable image result was returned." });
    return { task: updated, workflow: "web.image", automatic: automatic || { renderedMedia: [] } };
  }

  if (taskNeedsWebSearch(taskText) && moduleEnabled(request, "web-search")) {
    const search = await runWebSearchAction(taskText, moduleSettings(request, "web-search"));
    const hasResults = Array.isArray((search as { web?: unknown }).web) && (search as { web: unknown[] }).web.length > 0;
    const updated = await updateTask(task.id, { status: hasResults ? "done" : "blocked", note: hasResults ? "Completed automatically with web search results." : "Blocked: no web search results were returned." });
    return { task: updated, workflow: "web.search", webSearch: search };
  }

  const updated = await updateTask(task.id, { status: "blocked", note: "Blocked: no automatic executor matched this task. Delegate with agent.ask or use a specific tool action." });
  return { task: updated, workflow: "unmatched" };
}

async function taskDoneWouldLackDeliverable(action: InlineAction, content: string) {
  if (action.type !== "task.update" || action.attrs.status !== "done") return "";
  if (!content) return "";
  const task = (await listTasks()).find((item) => item.id === action.attrs.id);
  const taskText = [task?.title, task?.note, action.attrs.title, action.attrs.note, action.body].filter(Boolean).join(" ");
  if (!mediaTaskNeedsDeliverable(taskText)) return "";
  return content ? "" : "Image/video delivery tasks cannot be marked done until the response includes a real media tool result.";
}



function initialHypnoSessionTree(style: string, ending: string, contract: string) {
  const baseGoal = contract || [style, ending].filter(Boolean).join("; ") || "establish a safe, slow guided relaxation induction";
  const styleHint = style || "guided";
  const branches = [
    {
      id: "breath-anchor-opening",
      label: "Breath anchor opening",
      stage: "induction",
      technique: "breath pacing",
      goal: `open the ${styleHint} session by matching attention to an easy breath rhythm`,
      reason: "Initial rollout prior: a breath anchor gives the guide the clearest first read on pacing, comfort, and readiness.",
      readinessNeeded: "unclear or settling",
      intensity: "low",
      effectsPlan: "breath-synced visuals with minimal pull",
      effects: { spiralPreset: "breathing-ring", particleStyle: "snow", particleCount: 160, whispers: ["breathe", "softly settle"] },
      comfortScore: 92,
      goalFitScore: 82,
      readinessScore: 76,
      noveltyScore: 35,
      intensityScore: 18,
      totalScore: 86,
      visits: 4,
      valueEstimate: 86,
      confidence: 78,
      rolloutSummary: "Most imagined first replies become calmer or give usable pacing feedback without forcing a deeper move."
    },
    {
      id: "body-tension-map",
      label: "Body tension map",
      stage: "induction",
      technique: "progressive relaxation",
      goal: "sample where the body is holding tension and release it region by region",
      reason: "Initial rollout prior: body-based induction can reveal whether the session should evolve toward somatic imagery or remain breath-led.",
      readinessNeeded: "settling",
      intensity: "low",
      effectsPlan: "soft orbital motion and light particles to support body scanning",
      effects: { spiralPreset: "soft-orbital", particleStyle: "snow", particleCount: 140, whispers: ["soften", "release"] },
      comfortScore: 88,
      goalFitScore: 78,
      readinessScore: 68,
      noveltyScore: 42,
      intensityScore: 20,
      totalScore: 80,
      visits: 3,
      valueEstimate: 80,
      confidence: 70,
      rolloutSummary: "Rollouts work best when the user's first feedback mentions heaviness, warmth, tightness, or comfort in the body."
    },
    {
      id: "safe-place-orientation",
      label: "Safe-place orientation",
      stage: "induction",
      technique: "safe-place imagery",
      goal: "build a stable imagined place before asking for stronger absorption",
      reason: "Initial rollout prior: if the contract emphasizes comfort, sleep, uncertainty, or emotional safety, imagery may outperform pure breath pacing.",
      readinessNeeded: "unclear",
      intensity: "low",
      effectsPlan: "dim effects and use sparse fireflies for spaciousness",
      effects: { spiralPreset: "none", particleStyle: "firefly", particleCount: 80, whispers: ["safe", "easy"] },
      comfortScore: 96,
      goalFitScore: 72,
      readinessScore: 82,
      noveltyScore: 36,
      intensityScore: 8,
      totalScore: 84,
      visits: 3,
      valueEstimate: 84,
      confidence: 74,
      rolloutSummary: "Simulated continuations preserve agency well and tend to produce clearer preference feedback before intensifying."
    },
    {
      id: "contract-clarity-branch",
      label: "Contract clarity branch",
      stage: "induction",
      technique: "responsive pacing",
      goal: "ask one compact missing-detail question before committing the induction route",
      reason: "Initial rollout prior: when the contract is thin, one precise question can beat guessing the first experiential direction.",
      readinessNeeded: "not-ready or unclear",
      intensity: "low",
      effectsPlan: "minimal effects while the guide resolves the next branch",
      effects: { spiralPreset: "none", particleStyle: "snow", particleCount: 0, whispers: [] },
      comfortScore: 90,
      goalFitScore: 58,
      readinessScore: 92,
      noveltyScore: 20,
      intensityScore: 0,
      totalScore: 76,
      visits: 2,
      valueEstimate: 76,
      confidence: 68,
      rolloutSummary: "Low visit count because it is valuable only when missing details would otherwise make the first branch brittle."
    }
  ];
  const selected = branches[0];
  return {
    branches,
    selected,
    path: [{ stage: "induction", progress: 10, technique: selected.technique, goal: baseGoal, branchId: selected.id, reason: selected.reason, score: selected.totalScore, effects: selected.effects, readiness: "settling", at: Date.now() }]
  };
}

const projectFileIgnore = new Set([".git", "node_modules", "dist", "build", ".next", ".vite", "coverage", ".cache", "tmp", "temp"]);

function safeProjectPath(rootInput: unknown, fileInput = "") {
  const root = path.resolve(String(rootInput || "").trim());
  if (!root || root === path.parse(root).root) throw new Error("project file actions require root.");
  const target = path.resolve(root, String(fileInput || ""));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error("Path escapes project directory.");
  return { root, target };
}

async function searchProjectFiles(rootInput: unknown, queryInput: unknown) {
  const { root } = safeProjectPath(rootInput);
  const query = String(queryInput || "").trim().toLowerCase();
  if (!query) throw new Error("project.file.search requires query.");
  const results: Array<{ path: string; size: number }> = [];
  async function walk(dir: string) {
    if (results.length >= 60) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= 60 || projectFileIgnore.has(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(root, absolute).replace(/\\/g, "/");
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile() && relative.toLowerCase().includes(query)) {
        const info = await stat(absolute);
        results.push({ path: relative, size: info.size });
      }
    }
  }
  await walk(root);
  return results;
}

async function readProjectFile(rootInput: unknown, fileInput: unknown) {
  const file = String(fileInput || "").trim();
  if (!file) throw new Error("project.file.read requires file.");
  const { target } = safeProjectPath(rootInput, file);
  const info = await stat(target);
  if (info.size > 512 * 1024) throw new Error("Project file is too large to read.");
  return { path: file.replace(/\\/g, "/"), content: await readFile(target, "utf8") };
}

function validateAction(action: InlineAction) {
  if (action.type === "calculate" && !hasText(action.attrs.expression || action.body)) return "calculate requires expression or body.";
  if (action.type === "memory.create" && !hasText(action.attrs.text || action.body)) return "memory.create requires text or body.";
  if (action.type === "task.create" && !hasText(action.attrs.title)) return "task.create requires title.";
  if (action.type === "task.update" && !hasText(action.attrs.id)) return "task.update requires id.";
  if (action.type === "task.execute" && !hasText(action.attrs.id || action.body)) return "task.execute requires id.";
  if (action.type === "note.create" && (!hasText(action.attrs.title) || !hasText(action.attrs.content || action.body))) return "note.create requires title and content/body.";
  if (action.type === "note.append" && (!hasText(action.attrs.id) || !hasText(action.attrs.content || action.body))) return "note.append requires id and content/body.";
  if (action.type === "schedule.create") {
    if (!hasText(action.attrs.title) || !hasText(action.attrs.at)) return "schedule.create requires title and at.";
    if (!Number.isFinite(new Date(action.attrs.at).getTime())) return "schedule.create at must be a valid date/time.";
    if (action.attrs.kind && !["reminder", "alarm"].includes(action.attrs.kind)) return "schedule.create kind must be reminder or alarm.";
  }
  if (action.type === "notification.create" && (!hasText(action.attrs.title) || !hasText(action.attrs.message || action.body))) return "notification.create requires title and message/body.";
  if (action.type === "web.search" && !hasText(action.attrs.query || action.body)) return "web.search requires query or body.";
  if (action.type === "image.generate" && !hasText(action.attrs.prompt || action.body)) return "image.generate requires prompt or body.";
  if (action.type === "video.generate" && !hasText(action.attrs.prompt || action.body)) return "video.generate requires prompt or body.";
  if (action.type === "image.inline" && !hasText(action.attrs.src)) return "image.inline requires src.";
  if (action.type === "video.inline" && !hasText(action.attrs.src)) return "video.inline requires src.";
  if (action.type === "file.search" && !hasText(action.attrs.query || action.body)) return "file.search requires query or body.";
  if (action.type === "file.get" && !hasText(action.attrs.id)) return "file.get requires id.";
  if (action.type === "project.file.search" && (!hasText(action.attrs.root) || !hasText(action.attrs.query || action.body))) return "project.file.search requires root and query.";
  if (action.type === "project.file.read" && (!hasText(action.attrs.root) || !hasText(action.attrs.file))) return "project.file.read requires root and file.";
  if (action.type === "contact.create" && !hasText(action.attrs.name)) return "contact.create requires name.";
  if (action.type === "contact.update" && !hasText(action.attrs.id)) return "contact.update requires id.";
  if (action.type === "calendar.create" && (!hasText(action.attrs.title) || !hasText(action.attrs.startsAt || action.attrs.at))) return "calendar.create requires title and startsAt.";
  if (action.type === "calendar.update" && !hasText(action.attrs.id)) return "calendar.update requires id.";
  if (action.type === "profile.update" && (!hasText(action.attrs.key) || !hasText(action.attrs.value || action.body))) return "profile.update requires key and value.";
  if (action.type === "project.create" && !hasText(action.attrs.name)) return "project.create requires name.";
  if (action.type === "project.update" && !hasText(action.attrs.id)) return "project.update requires id.";
  if (action.type === "project.update" && action.attrs.status && !["enabled", "disabled", "done"].includes(action.attrs.status)) return "project.update status must be enabled, disabled, or done.";
  if (action.type === "agent.ask" && !hasText(action.attrs.agent || action.attrs.name || action.body)) return "agent.ask requires an agent name or task body.";
  if (action.type === "assistant-file.create" && !hasText(action.attrs.content || action.body)) return "assistant-file.create requires content.";
  if (action.type === "assistant-file.update" && !hasText(action.attrs.id)) return "assistant-file.update requires id.";
  if (action.type === "assistant-file.delete" && !hasText(action.attrs.id)) return "assistant-file.delete requires id.";
  if (action.type === "assistant-file.hashline" && (!hasText(action.attrs.id) || !hasText(action.attrs.edits || action.body))) return "assistant-file.hashline requires id and edits/body.";
  if (action.type === "python.run" && !hasText(action.attrs.code || action.body)) return "python.run requires code.";
  if (action.type === "audio.play" && !hasText(action.attrs.name || action.attrs.url || action.body)) return "audio.play requires name or url.";
  if (action.type === "intiface.play" && !hasText(action.attrs.pattern || action.attrs.mode || action.attrs.intensity || action.attrs.command || action.body)) return "intiface.play requires pattern, mode, intensity, or command.";
  if (action.type === "hypno.session.configure" && !hasText(action.attrs.style || action.attrs.shape || action.attrs.ending || action.attrs.stage || action.attrs.contract || action.attrs.technique || action.attrs.stageGoal || action.attrs.goal || action.attrs.checkInPrompt || action.attrs.checkIn || action.body)) return "hypno.session.configure requires style, shape, ending, stage, contract, technique, goal, check-in, or body.";
  if (action.type === "hypno.session.stage" && !hasText(action.attrs.stage || action.attrs.name || action.body)) return "hypno.session.stage requires stage, name, or body.";
  if (action.type === "hypno.session.update" && !hasText(action.attrs.stage || action.attrs.progress || action.attrs.value || action.attrs.readiness || action.attrs.feedback || action.attrs.technique || action.attrs.stageGoal || action.attrs.goal || action.attrs.checkInPrompt || action.attrs.checkIn || action.body)) return "hypno.session.update requires stage, progress, readiness, feedback, technique, goal, check-in, or body.";
  if (action.type === "hypno.session.progress" && !hasText(action.attrs.value || action.attrs.progress || action.attrs.technique || action.attrs.stageGoal || action.attrs.goal || action.attrs.checkInPrompt || action.attrs.checkIn || action.body)) return "hypno.session.progress requires value, progress, technique, goal, check-in, or body.";
  if (action.type === "hypno.session.checkpoint" && !hasText(action.attrs.readiness || action.attrs.feedback || action.attrs.technique || action.attrs.stageGoal || action.attrs.goal || action.attrs.checkInPrompt || action.attrs.checkIn || action.body)) return "hypno.session.checkpoint requires readiness, feedback, technique, goal, check-in, or body.";
  if (action.type === "hypno.spiral.select" && !hasText(action.attrs.preset || action.attrs.id || action.body)) return "hypno.spiral.select requires preset, id, or body.";
  if (action.type === "hypno.whispers.set" && !hasText(action.attrs.items || action.body)) return "hypno.whispers.set requires items or body.";
  if (action.type === "hypno.whisper.add" && !hasText(action.attrs.text || action.body)) return "hypno.whisper.add requires text or body.";
  if (!supportedActionTypeSet.has(action.type)) return `Unsupported action type: ${action.type}`;
  return "";
}

async function updateDelegatedTask(request: ChatRequest, taskId: string, status: "doing" | "done" | "blocked", note: string) {
  if (!taskId || !moduleAllows(request, "tasks")) return null;
  return updateTask(taskId, { status, note: note.slice(0, 500) });
}

async function executeAction(request: ChatRequest, action: InlineAction, depth = 0) {
  if (action.type === "calculate") return calculateExpression(action.attrs.expression || action.body);
  if (action.type === "memory.create" && moduleAllows(request, "memory")) return createMemory(request.promptProfile.id, { scope: action.attrs.scope, text: action.attrs.text || action.body, tags: action.attrs.tags });
  if (action.type === "task.create" && moduleAllows(request, "tasks")) {
    let task = await createTask({ title: action.attrs.title, status: action.attrs.status, note: action.attrs.note || action.body });
    const taskText = [task.title, task.note, action.attrs.title, action.attrs.note, action.body].filter(Boolean).join(" ");
    const automatic = action.attrs.status === "doing" ? await automaticAnyMediaFollowup(request, taskText) : null;
    if (automatic && (mediaTaskNeedsDeliverable(taskText) || videoTaskNeedsDeliverable(taskText))) {
      task = await updateTask(task.id, { status: automatic.renderedMedia.length ? "done" : "blocked", note: automatic.renderedMedia.length ? "Completed automatically with a real inline media result." : "Blocked: no usable image/video result was returned." });
    }
    return automatic ? { task, automatic } : task;
  }
  if (action.type === "task.execute" && moduleAllows(request, "tasks")) return executeTaskWorkflow(request, action.attrs.id || action.body);
  if (action.type === "task.update" && moduleAllows(request, "tasks")) {
    let task = await updateTask(action.attrs.id, { title: action.attrs.title, status: action.attrs.status as any, note: action.attrs.note || action.body });
    const taskText = [task.title, task.note, action.attrs.title, action.attrs.note, action.body].filter(Boolean).join(" ");
    const automatic = action.attrs.status === "doing" ? await automaticAnyMediaFollowup(request, taskText) : null;
    if (automatic && (mediaTaskNeedsDeliverable(taskText) || videoTaskNeedsDeliverable(taskText))) {
      task = await updateTask(task.id, { status: automatic.renderedMedia.length ? "done" : "blocked", note: automatic.renderedMedia.length ? "Completed automatically with a real inline media result." : "Blocked: no usable image/video result was returned." });
    }
    return automatic ? { task, automatic } : task;
  }
  if (action.type === "note.create" && moduleAllows(request, "notes")) return createNote({ title: action.attrs.title, content: action.body || action.attrs.content });
  if (action.type === "note.append" && moduleAllows(request, "notes")) return updateNote(action.attrs.id, { append: action.body || action.attrs.content });
  if (action.type === "schedule.create" && moduleAllows(request, "reminders")) return createScheduledItem({ kind: action.attrs.kind, title: action.attrs.title, at: action.attrs.at, note: action.attrs.note || action.body });
  if (action.type === "notification.create" && moduleEnabled(request, "notifications")) return createNotification({ kind: action.attrs.kind as any, title: action.attrs.title, message: action.body || action.attrs.message, source: "action-bus" });
  if (action.type === "web.search" && moduleEnabled(request, "web-search")) return runWebSearchAction(action.attrs.query || action.body, moduleSettings(request, "web-search"));
  if (action.type === "image.generate" && moduleEnabled(request, "image-generation")) return { prompt: action.attrs.prompt || action.body };
  if (action.type === "video.generate" && moduleEnabled(request, "image-generation")) return { prompt: action.attrs.prompt || action.body };
  if (action.type === "image.inline") return { renderedInline: true, src: action.attrs.src, alt: action.attrs.alt || action.attrs.title || "Inline image" };
  if (action.type === "video.inline") return { renderedInline: true, src: action.attrs.src, alt: action.attrs.alt || action.attrs.title || "Inline video" };
  if (action.type === "file.search" && moduleEnabled(request, "file-library")) return searchDocuments(action.attrs.query || action.body);
  if (action.type === "file.get" && moduleEnabled(request, "file-library")) return getDocument(action.attrs.id);
  if (action.type === "project.file.search" && moduleAllows(request, "projects")) return searchProjectFiles(action.attrs.root, action.attrs.query || action.body);
  if (action.type === "project.file.read" && moduleAllows(request, "projects")) return readProjectFile(action.attrs.root, action.attrs.file);
  if (action.type === "python.run" && moduleAllows(request, "computation")) {
    const code = action.attrs.code || action.body || "";
    const root = action.attrs.root || "";
    const cwd = root ? path.resolve(String(root)) : process.cwd();
    let output = "";
    const proc = spawn("python3", ["-c", "import sys; exec(sys.stdin.read())"], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    const maxOutputChars = Math.max(1, Math.min(200000, Number(request.provider.maxTokens) || 4096));
    const appendOutput = (data: Buffer) => {
      const text = data.toString();
      if (output.length + text.length > maxOutputChars) {
        output += text.slice(0, maxOutputChars - output.length) + "\n[output truncated]";
        try { proc.kill("SIGTERM"); } catch {}
      } else output += text;
    };
    proc.stdout.on("data", appendOutput);
    proc.stderr.on("data", appendOutput);
    proc.stdin.write(code);
    proc.stdin.end();
    await new Promise<void>((resolve) => { proc.on("exit", () => resolve()); proc.on("error", () => resolve()); });
    return { output: output.trimEnd() || "[no output]" };
  }
  if (action.type === "hypno.session.configure" && moduleAllows(request, "hypno", "allowModelControl")) {
    const settings: Record<string, unknown> = {};
    const style = trimmedText(action.attrs.style);
    const shape = trimmedText(action.attrs.shape);
    const ending = trimmedText(action.attrs.ending);
    const stage = trimmedText(action.attrs.stage);
    const contract = trimmedText(action.attrs.contract || action.body);
    const technique = trimmedText(action.attrs.technique);
    const stageGoal = trimmedText(action.attrs.stageGoal || action.attrs.goal);
    const checkInPrompt = trimmedText(action.attrs.checkInPrompt || action.attrs.checkIn);
    if (style) settings.sessionStyle = style;
    if (shape) settings.sessionShape = shape;
    if (ending) settings.sessionEnding = ending;
    if (stage) settings.sessionStage = stage;
    if (contract) settings.sessionContract = contract;
    if (technique) settings.sessionTechnique = technique;
    if (stageGoal) settings.sessionStageGoal = stageGoal;
    if (checkInPrompt) settings.sessionCheckInPrompt = checkInPrompt;
    return { settings };
  }
  if (action.type === "hypno.session.start" && moduleAllows(request, "hypno", "allowModelControl")) {
    const settings: Record<string, unknown> = { sessionActive: true, sessionPaused: false, sessionStage: "induction", sessionShape: "interactive-staged", sessionCandidateBranchesJson: "[]", sessionSelectedBranchId: "", sessionSelectedBranchScore: 0, sessionSelectedBranchEffectsJson: "{}", sessionBranchReason: "", sessionDirectorNote: "", sessionPathJson: "[]", sessionStrategyNotes: "", sessionCreativeNotes: "" };
    const style = trimmedText(action.attrs.style);
    const shape = trimmedText(action.attrs.shape);
    const ending = trimmedText(action.attrs.ending);
    const stage = trimmedText(action.attrs.stage);
    const contract = trimmedText(action.attrs.contract || action.body);
    if (style) settings.sessionStyle = style;
    if (shape) settings.sessionShape = shape;
    if (ending) settings.sessionEnding = ending;
    if (stage) settings.sessionStage = stage;
    if (contract) settings.sessionContract = contract;
    const tree = initialHypnoSessionTree(style, ending, contract);
    settings.sessionStageProgress = 10;
    settings.sessionReadiness = "settling";
    settings.sessionModelDecision = "continue_current_stage";
    settings.sessionNextInstruction = `Begin with ${tree.selected.technique}: ${tree.selected.goal}. Keep intensity low and end with a brief check-in.`;
    settings.sessionTechnique = tree.selected.technique;
    settings.sessionStageGoal = tree.selected.goal;
    settings.sessionCheckInPrompt = "What do you notice first: breath, body, imagery, or a need to adjust?";
    settings.sessionCandidateBranchesJson = JSON.stringify(tree.branches);
    settings.sessionSelectedBranchId = tree.selected.id;
    settings.sessionSelectedBranchScore = tree.selected.totalScore;
    settings.sessionSelectedBranchEffectsJson = JSON.stringify(tree.selected.effects);
    settings.sessionBranchReason = tree.selected.reason;
    settings.sessionDirectorNote = "Initial seeded evolution tree: treat these as priors until the tracker expands the next contextual child nodes.";
    settings.sessionPathJson = JSON.stringify(tree.path);
    settings.sessionAwaitingFeedback = true;
    settings.spiralPreset = tree.selected.effects.spiralPreset;
    settings.spiralEnabled = tree.selected.effects.spiralPreset !== "none";
    settings.particlesEnabled = tree.selected.effects.particleCount > 0;
    settings.particleStyle = tree.selected.effects.particleStyle;
    settings.particleCount = tree.selected.effects.particleCount;
    settings.visualWhispersEnabled = tree.selected.effects.whispers.length > 0;
    settings.visualWhispers = tree.selected.effects.whispers.join("\n");
    return { settings, notification: { kind: "success", title: "Entering hypno mode", message: action.attrs.message || "Guided relaxation session started." } };
  }
  if (action.type === "hypno.session.stage" && moduleAllows(request, "hypno", "allowModelControl")) {
    return { settings: { sessionStage: trimmedText(action.attrs.stage || action.attrs.name || action.body), sessionStageProgress: 0, sessionReadiness: "", sessionFeedback: "", sessionUserSignal: "", sessionModelDecision: "", sessionNextInstruction: "", sessionTechnique: "", sessionStageGoal: "", sessionCheckInPrompt: "", sessionCandidateBranchesJson: "[]", sessionSelectedBranchId: "", sessionSelectedBranchScore: 0, sessionSelectedBranchEffectsJson: "{}", sessionBranchReason: "", sessionDirectorNote: "", sessionAwaitingFeedback: false, sessionStageTurnCount: 0 } };
  }
  if (action.type === "hypno.session.update" && moduleAllows(request, "hypno", "allowModelControl")) {
    const settings: Record<string, unknown> = {};
    const stage = trimmedText(action.attrs.stage || action.attrs.name);
    const progress = trimmedText(action.attrs.progress || action.attrs.value);
    const readiness = trimmedText(action.attrs.readiness);
    const feedback = trimmedText(action.attrs.feedback || action.body);
    const technique = trimmedText(action.attrs.technique);
    const stageGoal = trimmedText(action.attrs.stageGoal || action.attrs.goal);
    const checkInPrompt = trimmedText(action.attrs.checkInPrompt || action.attrs.checkIn);
    if (stage) settings.sessionStage = stage;
    if (progress) settings.sessionStageProgress = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)));
    if (readiness) settings.sessionReadiness = readiness;
    if (feedback) settings.sessionFeedback = feedback;
    if (technique) settings.sessionTechnique = technique;
    if (stageGoal) settings.sessionStageGoal = stageGoal;
    if (checkInPrompt) settings.sessionCheckInPrompt = checkInPrompt;
    return { settings };
  }
  if (action.type === "hypno.session.progress" && moduleAllows(request, "hypno", "allowModelControl")) {
    const raw = trimmedText(action.attrs.value || action.attrs.progress || action.body);
    const value = Math.max(0, Math.min(100, Math.round(Number(raw) || 0)));
    const settings: Record<string, unknown> = { sessionStageProgress: value };
    const readiness = trimmedText(action.attrs.readiness);
    const feedback = trimmedText(action.attrs.feedback || action.body);
    const technique = trimmedText(action.attrs.technique);
    const stageGoal = trimmedText(action.attrs.stageGoal || action.attrs.goal);
    const checkInPrompt = trimmedText(action.attrs.checkInPrompt || action.attrs.checkIn);
    if (readiness) settings.sessionReadiness = readiness;
    if (feedback && feedback !== raw) settings.sessionFeedback = feedback;
    if (technique) settings.sessionTechnique = technique;
    if (stageGoal) settings.sessionStageGoal = stageGoal;
    if (checkInPrompt) settings.sessionCheckInPrompt = checkInPrompt;
    return { settings };
  }
  if (action.type === "hypno.session.checkpoint" && moduleAllows(request, "hypno", "allowModelControl")) {
    const settings: Record<string, unknown> = {};
    const readiness = trimmedText(action.attrs.readiness);
    const feedback = trimmedText(action.attrs.feedback || action.body);
    const progress = trimmedText(action.attrs.progress || action.attrs.value);
    const technique = trimmedText(action.attrs.technique);
    const stageGoal = trimmedText(action.attrs.stageGoal || action.attrs.goal);
    const checkInPrompt = trimmedText(action.attrs.checkInPrompt || action.attrs.checkIn);
    if (readiness) settings.sessionReadiness = readiness;
    if (feedback) settings.sessionFeedback = feedback;
    if (progress) settings.sessionStageProgress = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)));
    if (technique) settings.sessionTechnique = technique;
    if (stageGoal) settings.sessionStageGoal = stageGoal;
    if (checkInPrompt) settings.sessionCheckInPrompt = checkInPrompt;
    return { settings };
  }
  if (action.type === "hypno.session.pause" && moduleAllows(request, "hypno", "allowModelControl")) {
    return { settings: { sessionPaused: true } };
  }
  if (action.type === "hypno.session.resume" && moduleAllows(request, "hypno", "allowModelControl")) {
    return { settings: { sessionPaused: false } };
  }
  if (action.type === "hypno.session.end" && moduleAllows(request, "hypno", "allowModelControl")) {
    return { settings: { sessionActive: false, sessionPaused: false, sessionStyle: "", sessionShape: "", sessionEnding: "", sessionStage: "", sessionStageProgress: 0, sessionReadiness: "", sessionFeedback: "", sessionUserSignal: "", sessionModelDecision: "", sessionNextInstruction: "", sessionTechnique: "", sessionStageGoal: "", sessionCheckInPrompt: "", sessionCandidateBranchesJson: "[]", sessionSelectedBranchId: "", sessionSelectedBranchScore: 0, sessionSelectedBranchEffectsJson: "{}", sessionBranchReason: "", sessionDirectorNote: "", sessionPathJson: "[]", sessionPreferenceNotes: "", sessionMemoryCandidate: "", sessionLastSavedMemoryCandidate: "", sessionStrategyNotes: "", sessionCreativeNotes: "", sessionAwaitingFeedback: false, sessionTurnCount: 0, sessionStageTurnCount: 0, sessionContract: "", sessionContractAnalysis: "", sessionContractStatus: "", spiralEnabled: false, spiralPreset: "none" } };
  }
  if (action.type === "hypno.spiral.select" && moduleAllows(request, "hypno", "allowModelControl")) {
    const preset = action.attrs.preset || action.attrs.id || action.body;
    return { settings: { spiralPreset: preset, spiralEnabled: preset !== "none" } };
  }
  if (action.type === "hypno.whispers.set" && moduleAllows(request, "hypno", "allowModelControl")) {
    const items = (action.attrs.items || action.body).split(/\r?\n|\|/).map((item) => item.trim()).filter(Boolean).slice(0, 24);
    return { settings: { visualWhispers: items.join("\n"), visualWhispersEnabled: true } };
  }
  if (action.type === "hypno.whisper.add" && moduleAllows(request, "hypno", "allowModelControl")) {
    return { settings: { appendVisualWhisper: (action.attrs.text || action.body).trim(), visualWhispersEnabled: true } };
  }
  if (action.type === "hypno.particles.set" && moduleAllows(request, "hypno", "allowModelControl")) {
    const settings: Record<string, unknown> = { particlesEnabled: true };
    if (action.attrs.style) settings.particleStyle = action.attrs.style;
    if (action.attrs.count) settings.particleCount = action.attrs.count;
    return { settings };
  }
  if (action.type === "hypno.choices") return { renderedInline: true };
  if (action.type === "thoughts") return { result: null, note: "internal thoughts" };
  if (action.type === "agent.ask") {
    const agentName = action.attrs.agent || action.attrs.name || "Agent";
    const task = action.body || action.attrs.task || "";
    if (!task) throw new Error("agent.ask requires a task in the body or task attribute.");
    const taskId = action.attrs.taskId || action.attrs.task_id || "";
    await updateDelegatedTask(request, taskId, "doing", `Delegated to ${agentName}.`).catch(() => null);
    try {
      const response = await callAgent(request.provider, agentName, task, Math.max(500, Math.min(2000, Math.round(Number(action.attrs.maxTokens) || 900))));
      const actionResults = depth < 1 ? await executeInlineActions(request, response, depth + 1) : [];
      const failedAction = actionResults.find((item) => item.status === "error" || item.status === "invalid" || item.status === "blocked");
      if (failedAction) await updateDelegatedTask(request, taskId, "blocked", `Delegated to ${agentName}; sub-action failed: ${failedAction.error || failedAction.action.type}.`).catch(() => null);
      else await updateDelegatedTask(request, taskId, "done", `Completed by ${agentName}.`).catch(() => null);
      return { agent: agentName, task, response: stripInlineActions(response), actionResults };
    } catch (error) {
      await updateDelegatedTask(request, taskId, "blocked", `Delegation to ${agentName} failed: ${error instanceof Error ? error.message : "unknown error"}.`).catch(() => null);
      throw error;
    }
  }
  if (action.type === "contact.create" && moduleAllows(request, "contacts")) return createContact(action.attrs);
  if (action.type === "contact.update" && moduleAllows(request, "contacts")) return updateContact(action.attrs.id, action.attrs);
  if (action.type === "calendar.create" && moduleAllows(request, "calendar")) return createCalendarEvent(action.attrs);
  if (action.type === "calendar.update" && moduleAllows(request, "calendar")) return updateCalendarEvent(action.attrs.id, action.attrs);
  if (action.type === "profile.update" && moduleAllows(request, "user-profile")) return updateUserProfile({ ...action.attrs, value: action.attrs.value || action.body });
  if (action.type === "project.create" && moduleAllows(request, "projects")) return createProject(action.attrs);
  if (action.type === "project.update" && moduleAllows(request, "projects")) return updateProject(action.attrs.id, action.attrs);
  if (action.type === "assistant-file.create" && moduleAllows(request, "assistant-files")) return createAssistantFile(request.promptProfile.id, { ...action.attrs, content: action.attrs.content || action.body });
  if (action.type === "assistant-file.update" && moduleAllows(request, "assistant-files")) return updateAssistantFile(request.promptProfile.id, action.attrs.id, { ...action.attrs, content: action.attrs.content || action.body });
  if (action.type === "assistant-file.delete" && moduleAllows(request, "assistant-files")) return deleteAssistantFile(request.promptProfile.id, action.attrs.id);
  if (action.type === "assistant-file.hashline" && moduleAllows(request, "computation", "enableHashlineEdits")) return applyAssistantFileHashlines(request.promptProfile.id, action.attrs.id, { ...action.attrs, edits: action.attrs.edits || action.body });
  if (action.type === "audio.play") return { queuedForClientPlayback: true, name: action.attrs.name || action.body || action.attrs.url };
  if (action.type === "intiface.play" || action.type === "intiface.stop") {
    const settings = moduleSettings(request, "intiface");
    if (!moduleEnabled(request, "intiface") || settings.intifaceAiEnabled === false) throw new Error("Intiface AI control is disabled.");
    return { queuedForClientPlayback: true };
  }
  if (action.type === "discord.send" && moduleEnabled(request, "discord")) {
    const { executeDiscordSend } = await import("./discord");
    return executeDiscordSend(action.attrs);
  }
  if (action.mode === "continue") throw new Error("This continuation action is unsupported or its module is disabled.");
  throw new Error(`Unsupported or disabled action: ${action.type}`);
}

const renderOnlyActionTypes = new Set(["image.inline", "video.inline", "hypno.choices", "thoughts"]);

function toolInputToAction(type: string, input: Record<string, unknown>): InlineAction {
  const attrs = Object.entries(input).reduce<Record<string, string>>((result, [key, value]) => {
    if (key !== "body" && value !== undefined && value !== null) result[key] = typeof value === "string" ? value : JSON.stringify(value);
    return result;
  }, {});
  const body = typeof input.body === "string" ? input.body.trim() : "";
  return { id: stableActionId(type, attrs, body), type, attrs, body, mode: actionMode(type, attrs) };
}

export async function executeToolCall(request: ChatRequest, type: string, input: Record<string, unknown> = {}, depth = 0, sourceContent = ""): Promise<InlineActionResult> {
  const action = toolInputToAction(type, input);
  if (renderOnlyActionTypes.has(action.type)) return { action, status: "executed", result: { renderOnly: true } };

  const eventInput = { actionId: action.id, attrs: action.attrs, body: action.body, mode: action.mode };
  await recordModuleEvent({ source: "action-bus", action: action.type, status: "requested", input: eventInput });
  const validationError = validateAction(action);
  if (validationError) {
    await recordModuleEvent({ source: "action-bus", action: action.type, status: "invalid", input: eventInput, error: validationError });
    return { action, status: "invalid", error: validationError };
  }
  const deliverableError = await taskDoneWouldLackDeliverable(action, sourceContent);
  if (deliverableError) {
    await recordModuleEvent({ source: "action-bus", action: action.type, status: "invalid", input: eventInput, error: deliverableError });
    return { action, status: "invalid", error: deliverableError };
  }
  const permission = await checkToolPermission(request, action.type, { attrs: action.attrs, body: action.body });
  if (!permission.allowed) return { action, status: "blocked", error: permission.reason };
  try {
    const result = await executeAction(request, action, depth);
    const resultRecord = result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : null;
    const automatic = resultRecord && typeof resultRecord.automatic === "object" && !Array.isArray(resultRecord.automatic) ? resultRecord.automatic as Record<string, unknown> : null;
    const autoCompleted = Array.isArray(automatic?.renderedMedia) && automatic.renderedMedia.length > 0;
    const status = action.mode === "continue" && !autoCompleted ? "continuation-required" : "executed";
    await recordModuleEvent({ source: "action-bus", action: action.type, status, input: action.attrs, output: result });
    return { action, status, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Action failed.";
    await recordModuleEvent({ source: "action-bus", action: action.type, status: "error", input: action.attrs, error: message });
    return { action, status: "error", error: message };
  }
}

export async function executeInlineActions(_request: ChatRequest, _content: string, _depth = 0): Promise<InlineActionResult[]> { return []; }

