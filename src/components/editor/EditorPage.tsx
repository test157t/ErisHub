import { CSSProperties, ChangeEvent, FormEvent, KeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode, memo, RefObject, SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, ModuleConfig, PromptProfile, ProviderConfig } from "../../../shared/types";
import { VrmStage } from "../VrmStage";
import { ChatComposer } from "../chat/ChatComposer";
import { ChatManager } from "../chat/ChatManager";
import { tokenize } from "../../lib/tokenizer";
import { createProjectApi, deleteProjectApi, listProjectsApi, updateProjectApi, type ProjectRecord } from "../../lib/projectsApi";

type ProjectFileItem = { path: string; name: string; size: number; updatedAt: string };
type GitStatusItem = { x: string; y: string; path: string };
type PythonRunState = { status: "running" | "done" | "error"; output: string };
type BackgroundAsset = { name: string; url: string; previewUrl?: string; type: "image" | "video" };
type PendingAttachments = NonNullable<ChatMessage["attachments"]>;
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

type EditorWorkspaceState = {
  activeProjectId?: string;
  activeProjectFilePath?: string;
  activeProjectFileContent?: string;
  projectDirectory?: string;
  projectFilesSnapshot?: string[];
  openTabs?: string[];
  previewHeight?: number;
  colWidths?: { rail?: number; right?: number };
};

function renderDiffLine(line: string, index: number) {
  const className = line.startsWith("+") ? "editor-git-diff-line added" : line.startsWith("-") ? "editor-git-diff-line removed" : "editor-git-diff-line";
  return <span className={className} key={`${index}:${line}`}>{line || " "}</span>;
}

function editorStateString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function editorStateStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item || "")).filter(Boolean) : [];
}

function readLegacyEditorState(): EditorWorkspaceState {
  try {
    return {
      activeProjectId: localStorage.getItem("editor.activeProjectId") || "",
      activeProjectFilePath: localStorage.getItem("editor.activeProjectFilePath") || "",
      activeProjectFileContent: String(localStorage.getItem("editor.activeProjectFileContent") || "").slice(0, 8000),
      projectDirectory: localStorage.getItem(localStorage.getItem("editor.activeProjectId") ? `editor.projectDirectory.${localStorage.getItem("editor.activeProjectId")}` : "editor.projectDirectory.default") || "",
      projectFilesSnapshot: JSON.parse(localStorage.getItem("editor.projectFilesSnapshot") || "[]"),
      openTabs: JSON.parse(localStorage.getItem("editor.openTabs") || "[]"),
      previewHeight: Number(localStorage.getItem("editor.previewHeight")) || 180,
      colWidths: JSON.parse(localStorage.getItem("editor.colWidths") || "{}")
    };
  } catch {
    return {};
  }
}

type EditorPageProps = {
  callModeActive?: boolean;
  callModeLevel?: number;
  callModeMuted?: boolean;
  callModeTtsVolume?: number;
  chatBackground: BackgroundAsset | null;
  chatBackgroundBlur: boolean;
  chatBackgroundDim: number;
  chatFileInputRef: RefObject<HTMLInputElement | null>;
  composerTextareaRef: RefObject<HTMLTextAreaElement | null>;
  computationEnabled: boolean;
  draggedAgentId: string | null;
  editorCodeCompletionEnabled: boolean;
  error: string;
  hasDraft: boolean;
  inspectedSessionId: string | null;
  isChatManagerOpen: boolean;
  isSending: boolean;
  isUtilityMenuOpen: boolean;
  messages: ChatMessage[];
  modules: ModuleConfig[];
  onCallModeToggle?: () => void;
  onCallModeMuteToggle?: () => void;
  onCallModeTtsVolumeChange?: (value: number) => void;
  promptProfile: PromptProfile;
  promptProfiles: PromptProfile[];
  provider: unknown;
  showRawHistory: boolean;
  visibleChatCards: ChatSession[];
  vrmStage: {
    animations: string[];
    autoSendHitboxMessage: boolean;
    chestJiggleEnabled: boolean;
    chestJiggleAccelerometer: boolean;
    chestJiggleStrength: number;
    chestJiggleSoftness: number;
    chestJiggleGravity: number;
    chestJiggleVertical: number;
    chestJiggleSway: number;
    chestJiggleDepth: number;
    enabled: boolean;
    characters: string[];
    characterModels: Array<{ character: string; modelSettings: Record<string, unknown>; modelUrl: string }>;
    followCamera: boolean;
    followCursor: boolean;
    hitboxes: boolean;
    lightColor: string;
    lightIntensity: number;
    lightPreset: string;
    rimLightEnabled: boolean;
    rimLightColor: string;
    rimLightIntensity: number;
    fillLightIntensity: number;
    ambientLightIntensity: number;
    keyLightAngle: number;
    lightingContrast: number;
    modelZIndex: number;
    modelsCache: boolean;
    naturalIdle: boolean;
    blink: boolean;
    animationsCache: boolean;
    showGrid: boolean;
    showStatus?: boolean;
    ttsLipsSync: boolean;
    modelUrl: string;
    modelSettings: Record<string, unknown>;
    positionX: number;
    positionY: number;
    positionZ: number;
    rotationX: number;
    rotationY: number;
    rotationZ: number;
    scale: number;
  };
  deleteSession: (sessionId: string) => void;
  formatTimestamp: (timestamp: number) => string;
  loadSession: (session: ChatSession) => void;
  moveSessionAgent: (sessionId: string, targetId: string) => void;
  onDraftChange: (value: string) => void;
  onError: (message: string) => void;
  onFileUpload: (files: FileList | null) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onOpenAuditLog: () => void;
  onRegenerate: () => void;
  onRefreshAuditLog: () => void;
  onSubmit: (event?: FormEvent) => void;
  pendingAttachments: PendingAttachments;
  postJson: (url: string, body: unknown, method?: string) => Promise<unknown>;
  pythonRuns: Record<string, PythonRunState>;
  renderMessage: (message: ChatMessage, sessionId: string, profile: PromptProfile, options?: { hideMetadataPrefix?: boolean }) => ReactNode;
  runPythonCode: (runId: string, code: string) => void;
  runJavaScriptCode: (runId: string, code: string) => void;
  setDraggedAgentId: (value: SetStateAction<string | null>) => void;
  setInspectedSessionId: (value: SetStateAction<string | null>) => void;
  setIsChatManagerOpen: (value: SetStateAction<boolean>) => void;
  setIsUtilityMenuOpen: (value: SetStateAction<boolean>) => void;
  setPendingAttachments: (value: SetStateAction<PendingAttachments>) => void;
  setShowRawHistory: (value: SetStateAction<boolean>) => void;
  startNewChat: () => void;
  toggleSessionAgent: (sessionId: string, profileId: string) => void;
};

export const EditorPage = memo(function EditorPage({ callModeActive, callModeLevel = 0, callModeMuted, callModeTtsVolume = 100, chatBackground, chatBackgroundBlur, chatBackgroundDim, chatFileInputRef, composerTextareaRef, computationEnabled, draggedAgentId, editorCodeCompletionEnabled, error, hasDraft, inspectedSessionId, isChatManagerOpen, isSending, isUtilityMenuOpen, messages, modules, onCallModeToggle, onCallModeMuteToggle, onCallModeTtsVolumeChange, promptProfile, promptProfiles, provider, showRawHistory, visibleChatCards, vrmStage, deleteSession, formatTimestamp, loadSession, moveSessionAgent, onDraftChange, onError, onFileUpload, onKeyDown, onOpenAuditLog, onRegenerate, onRefreshAuditLog, onSubmit, pendingAttachments, postJson, pythonRuns, renderMessage, runPythonCode, runJavaScriptCode, setDraggedAgentId, setInspectedSessionId, setIsChatManagerOpen, setIsUtilityMenuOpen, setPendingAttachments, setShowRawHistory, startNewChat, toggleSessionAgent }: EditorPageProps) {
  const legacyEditorState = useMemo(readLegacyEditorState, []);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [projectFiles, setProjectFiles] = useState<ProjectFileItem[]>([]);
  const [workspaceStateLoaded, setWorkspaceStateLoaded] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState(() => editorStateString(legacyEditorState.activeProjectId));
  const [selectedProjectFilePath, setSelectedProjectFilePath] = useState(() => editorStateString(legacyEditorState.activeProjectFilePath));
  const [openTabs, setOpenTabs] = useState<string[]>(() => editorStateStringArray(legacyEditorState.openTabs));
  const [draftName, setDraftName] = useState("");
  const [content, setContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const latestMessage = messages.at(-1);
  const [runId, setRunId] = useState("");
  const [activeTool, setActiveTool] = useState<"projects" | "files" | "scm">("projects");
  const [searchQuery, setSearchQuery] = useState("");
  const [projectDirectory, setProjectDirectory] = useState("");
  const [previewHeight, setPreviewHeight] = useState(() => Math.max(100, Math.min(500, Number(legacyEditorState.previewHeight) || 180)));
  const [colWidths, setColWidths] = useState<{ rail: number; right: number }>(() => ({ rail: Math.max(100, Number(legacyEditorState.colWidths?.rail) || 260), right: Math.max(100, Number(legacyEditorState.colWidths?.right) || 340) }));
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editProjectName, setEditProjectName] = useState("");
  const [editProjectSummary, setEditProjectSummary] = useState("");
  const [gitBranch, setGitBranch] = useState("");
  const [gitStatus, setGitStatus] = useState<GitStatusItem[]>([]);
  const [gitStagedDiff, setGitStagedDiff] = useState("");
  const [gitUnstagedDiff, setGitUnstagedDiff] = useState("");
  const [gitCommitMessage, setGitCommitMessage] = useState("");
  const [gitLoading, setGitLoading] = useState(false);
  const [gitIsRepo, setGitIsRepo] = useState(false);
  const [editorCompletion, setEditorCompletion] = useState("");
  const [editorCompletionBusy, setEditorCompletionBusy] = useState(false);
  const [editorCursorPos, setEditorCursorPos] = useState<{ top: number; left: number } | null>(null);
  const [editorCursor, setEditorCursor] = useState(0);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const editorTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const editorGutterRef = useRef<HTMLDivElement | null>(null);
  const editorMirrorRef = useRef<HTMLPreElement | null>(null);
  const charWidthRef = useRef(0);
  const completionTimerRef = useRef<number | null>(null);
  const completionAbortRef = useRef<AbortController | null>(null);

  const selectedProject = projects.find((item) => item.id === selectedProjectId) || null;
  const selectedProjectFile = projectFiles.find((item) => item.path === selectedProjectFilePath) || null;
  const activeRun = runId ? pythonRuns[runId] : null;
  const lineCount = useMemo(() => content ? content.split("\n").length : 1, [content]);
  const lineNumbers = useMemo(() => Array.from({ length: lineCount }, (_, index) => index + 1), [lineCount]);
  const highlightedLines = useMemo(() => tokenize(content || ""), [content]);

  const isDirty = selectedProjectFile ? Boolean(draftName.trim()) : Boolean(content.trim() || draftName.trim());
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const fileSearchResults = (normalizedSearch ? projectFiles.filter((item) => [item.path, item.name].some((value) => value.toLowerCase().includes(normalizedSearch))) : projectFiles).slice(0, 500);

  const refreshWorkspace = () => {
    return Promise.all([
      listProjectsApi().then((items) => ({ items }))
    ]).then(([projectData]) => {
      const nextProjects = Array.isArray(projectData.items) ? projectData.items : [];
      setProjects(nextProjects);
      if (!selectedProjectId && nextProjects[0]) setSelectedProjectId(nextProjects[0].id);
    }).catch((error) => onError(error instanceof Error ? error.message : "Could not load editor workspace."));
  };

  useEffect(() => {
    refreshWorkspace();
    fetch("/api/workspace-root")
      .then((res) => res.json())
      .then((data) => setWorkspaceRoot(String(data.root || "")))
      .catch(() => undefined);
    fetch("/api/workspace-state")
      .then((res) => res.json())
      .then((data) => {
        const state = data?.state && typeof data.state === "object" && !Array.isArray(data.state) ? data.state as { editor?: EditorWorkspaceState } : {};
        const editor = state.editor && typeof state.editor === "object" && !Array.isArray(state.editor) ? state.editor : legacyEditorState;
        setSelectedProjectId(editorStateString(editor.activeProjectId));
        setSelectedProjectFilePath(editorStateString(editor.activeProjectFilePath));
        setOpenTabs(editorStateStringArray(editor.openTabs));
        if (editorStateString(editor.projectDirectory)) setProjectDirectory(editorStateString(editor.projectDirectory));
        if (Number.isFinite(Number(editor.previewHeight))) setPreviewHeight(Math.max(100, Math.min(500, Math.round(Number(editor.previewHeight)))));
        if (editor.colWidths && typeof editor.colWidths === "object") setColWidths({ rail: Math.max(100, Number(editor.colWidths.rail) || 260), right: Math.max(100, Number(editor.colWidths.right) || 340) });
        if (editorStateString(editor.activeProjectFileContent) && !content) setContent(editorStateString(editor.activeProjectFileContent).slice(0, 8000));
      })
      .catch(() => undefined)
      .finally(() => setWorkspaceStateLoaded(true));
  }, []);

  useEffect(() => {
    if (!workspaceStateLoaded) return;
    const editor: EditorWorkspaceState = {
      activeProjectId: selectedProjectId,
      activeProjectFilePath: selectedProjectFilePath,
      activeProjectFileContent: content.slice(0, 8000),
      projectDirectory,
      projectFilesSnapshot: projectFiles.slice(0, 240).map((item) => item.path),
      openTabs,
      previewHeight,
      colWidths
    };
    const timer = window.setTimeout(() => {
      postJson("/api/workspace-state", { patch: { editor } }, "PATCH").catch(() => undefined);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [workspaceStateLoaded, selectedProjectId, selectedProjectFilePath, content, projectFiles, openTabs, previewHeight, colWidths]);

  const refreshProjectFiles = () => {
    if (!projectDirectory.trim()) {
      setProjectFiles([]);
      return Promise.resolve();
    }
    return fetch(`/api/modules/projects/files?root=${encodeURIComponent(projectDirectory.trim())}`)
      .then((res) => res.json())
      .then((data) => setProjectFiles(Array.isArray(data.files) ? data.files : []))
      .catch((error) => onError(error instanceof Error ? error.message : "Could not load project files."));
  };

  useEffect(() => {
    refreshProjectFiles();
  }, [projectDirectory]);

  useEffect(() => {
    if (!selectedProjectFilePath || !projectDirectory.trim()) return;
    setOpenTabs((current) => current.includes(selectedProjectFilePath) ? current : [...current, selectedProjectFilePath]);
    fetch(`/api/modules/projects/file?root=${encodeURIComponent(projectDirectory.trim())}&file=${encodeURIComponent(selectedProjectFilePath)}`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.file) return;
        setDraftName(selectedProjectFilePath);
        setContent(String(data.file.content || ""));
      })
      .catch((error) => onError(error instanceof Error ? error.message : "Could not open project file."));
  }, [selectedProjectFilePath, projectDirectory]);

  useEffect(() => {
    setProjectDirectory(selectedProject?.directory || "");
  }, [selectedProject?.id, selectedProject?.directory]);

  useEffect(() => {
    if (!selectedProject) return;
    setNewProjectName(selectedProject.name);
  }, [selectedProject]);

  useEffect(() => {
    const chatLog = chatLogRef.current;
    if (!chatLog) return;
    const atBottom = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 120;
    if (atBottom) chatLog.scrollTop = chatLog.scrollHeight;
  }, [latestMessage?.id, latestMessage?.content, latestMessage?.attachments?.length, isSending]);

  const syncGutterHeights = useCallback(() => {
    const mirror = editorMirrorRef.current;
    const gutter = editorGutterRef.current;
    if (!mirror || !gutter) return;
    for (let i = 0; i < Math.min(mirror.children.length, gutter.children.length); i++) {
      const lineHeight = (mirror.children[i] as HTMLElement).getBoundingClientRect().height;
      if (lineHeight > 0) {
        (gutter.children[i] as HTMLElement).style.minHeight = `${lineHeight}px`;
      }
    }
  }, []);

  useEffect(() => {
    syncGutterHeights();
  }, [content, syncGutterHeights]);

  useEffect(() => {
    const mirror = editorMirrorRef.current;
    if (!mirror) return;
    const observer = new ResizeObserver(syncGutterHeights);
    observer.observe(mirror);
    return () => observer.disconnect();
  }, [syncGutterHeights]);

  useEffect(() => {
    if (selectedProject?.status === "disabled") {
      setSelectedProjectId("");
    }
  }, [selectedProject?.status]);

  useEffect(() => {
    const textarea = editorTextareaRef.current;
    const mirror = editorMirrorRef.current;
    if (!textarea || !mirror) return;
    if (charWidthRef.current === 0) {
      const span = document.createElement("span");
      span.style.fontFamily = '"JetBrains Mono", "Fira Code", Consolas, monospace';
      span.style.fontSize = "0.92rem";
      span.style.lineHeight = "1.48";
      span.style.position = "absolute";
      span.style.visibility = "hidden";
      span.style.whiteSpace = "pre";
      span.textContent = "M".repeat(100);
      document.body.appendChild(span);
      charWidthRef.current = span.getBoundingClientRect().width / 100;
      document.body.removeChild(span);
    }
    if (!editorCompletion && !editorCompletionBusy) { setEditorCursorPos(null); return; }
    const cursor = textarea.selectionStart;
    const before = content.slice(0, cursor);
    const lineIdx = before.split("\n").length - 1;
    const lastNl = before.lastIndexOf("\n");
    const offset = cursor - lastNl - 1;
    const lineDiv = mirror.children[Math.min(lineIdx, mirror.children.length - 1)] as HTMLElement | undefined;
    if (!lineDiv) { setEditorCursorPos(null); return; }
    const wrap = textarea.clientWidth - parseFloat(getComputedStyle(textarea).paddingLeft) - parseFloat(getComputedStyle(textarea).paddingRight);
    const charsPerLine = Math.floor(wrap / charWidthRef.current) || 1;
    const visualLine = Math.floor(offset / charsPerLine);
    const x = (offset % charsPerLine) * charWidthRef.current;
    const lineHeight = parseFloat(getComputedStyle(lineDiv).lineHeight) || 22;
    const lineRects = Array.from(mirror.children).slice(0, lineIdx) as HTMLElement[];
    const y = lineRects.reduce((sum, el) => sum + el.getBoundingClientRect().height, 0) + visualLine * lineHeight - textarea.scrollTop;
    setEditorCursorPos({ top: y, left: x });
  }, [editorCompletion, editorCompletionBusy, content, editorCursor]);

  const colDragRef = useRef<{ index: number; startX: number; startWidth: number } | null>(null);
  const previewHeightDragRef = useRef<{ startY: number; height: number } | null>(null);

  const onColDividerDown = (index: number, event: ReactMouseEvent) => {
    event.preventDefault();
    const widths = [colWidths.rail, colWidths.right];
    colDragRef.current = { index, startX: event.clientX, startWidth: widths[index] };
  };

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (colDragRef.current) {
        const dx = event.clientX - colDragRef.current.startX;
        const key = ["rail", "right"][colDragRef.current.index] as "rail" | "right";
        const sign = colDragRef.current.index === 1 ? -1 : 1;
        const newWidth = Math.max(100, Math.min(800, colDragRef.current.startWidth + sign * dx));
        setColWidths((prev) => ({ ...prev, [key]: newWidth }));
      }
      if (previewHeightDragRef.current) {
        const dy = event.clientY - previewHeightDragRef.current.startY;
        setPreviewHeight(Math.max(100, Math.min(500, previewHeightDragRef.current.height + dy)));
      }
    };
    const onUp = () => { colDragRef.current = null; previewHeightDragRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const saveFile = async () => {
    const name = draftName.trim();
    if (!name) return;
    if (!projectDirectory.trim()) {
      onError("Select a project directory before creating or saving files.");
      return;
    }
    setIsSaving(true);
    setSaveError("");
    try {
      const data = await postJson("/api/modules/projects/file", { root: projectDirectory.trim(), file: name, content, projectId: selectedProjectId || undefined }, "PUT") as { file?: ProjectFileItem };
      if (data.file?.path) setSelectedProjectFilePath(data.file.path);
      await refreshProjectFiles();
      onRefreshAuditLog();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save project file.";
      setSaveError(message);
      onError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const createFile = () => {
    setSelectedProjectFilePath("");
    setDraftName("");
    setContent("");
  };

  const closeTab = (path: string) => {
    setOpenTabs((current) => {
      const next = current.filter((item) => item !== path);
      if (selectedProjectFilePath === path) {
        const nextSelected = next.at(-1) || "";
        setSelectedProjectFilePath(nextSelected);
        if (!nextSelected) {
          setDraftName("");
          setContent("");
        }
      }
      return next;
    });
  };

  const createProjectNow = async () => {
    const name = newProjectName.trim();
    if (!name) {
      onError("Project name is required.");
      return;
    }
    try {
      const body: Record<string, unknown> = { name, summary: "" };
      if (projectDirectory.trim()) body.directory = projectDirectory.trim();
      const item = await createProjectApi(body);
      if (item?.id) setSelectedProjectId(item.id);
      setNewProjectName("");
      setShowCreateDialog(false);
      await refreshWorkspace();
      onRefreshAuditLog();
      setActiveTool("projects");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not create project.");
    }
  };

  const deleteProjectNow = async (projectId: string) => {
    const project = projects.find((item) => item.id === projectId);
    if (!project) return;
    if (!window.confirm(`Delete project "${project.name}"?`)) return;
    try {
      await deleteProjectApi(projectId);
      setProjects((current) => current.filter((item) => item.id !== projectId));
      if (selectedProjectId === projectId) {
        setSelectedProjectId("");
        setEditingProjectId(null);
      }
      await refreshWorkspace();
      onRefreshAuditLog();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not delete project.");
    }
  };

  const requestRepoSummaryForProject = async (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    const directory = projectDirectory.trim();
    if (!directory) {
      onError("Select a project directory before summarizing the repo.");
      return;
    }
    let filesForSummary = projectFiles;
    if (!filesForSummary.length) {
      try {
        const data = await fetch(`/api/modules/projects/files?root=${encodeURIComponent(directory)}`).then((res) => res.json());
        filesForSummary = Array.isArray(data.files) ? data.files : [];
        setProjectFiles(filesForSummary);
      } catch {
        filesForSummary = [];
      }
    }
    try {
      const data = await postJson(`/api/modules/core-assistant/projects/${encodeURIComponent(projectId)}/repo-summary`, { provider, root: directory, files: filesForSummary }) as { item?: ProjectRecord };
      if (data.item) {
        setProjects((current) => current.map((item) => item.id === projectId ? { ...item, summary: data.item!.summary || item.summary } : item));
        if (editingProjectId === projectId) setEditProjectSummary(data.item?.summary || "");
      }
      await refreshWorkspace();
      onRefreshAuditLog();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not summarize repo.");
    }
  };

  const updateProjectDirectory = (dir: string, projectId?: string) => {
    setProjectDirectory(dir);
    const id = projectId || selectedProjectId;
    if (id) {
      setProjects((current) => current.map((p) => p.id === id ? { ...p, directory: dir } : p));
      updateProjectApi(id, { directory: dir })
        .catch((err) => onError(err instanceof Error ? err.message : "Could not save project directory."));
    }
  };

  const selectDirectory = async (projectId?: string) => {
    try {
      const resp = await fetch("/api/pick-directory");
      const data = await resp.json() as { success: boolean; path: string };
      if (data.success && data.path) {
        setProjectDirectory(data.path);
        const id = projectId || selectedProjectId;
        if (id) {
          setProjects((current) => current.map((p) => p.id === id ? { ...p, directory: data.path } : p));
          await updateProjectApi(id, { directory: data.path });
        }
        refreshWorkspace().catch(() => undefined);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not pick directory.");
    }
  };

  const runCurrentPythonNow = () => {
    if (!computationEnabled) {
      onError("Enable the Computation module to run Python in the editor.");
      return;
    }
    if (!content.trim()) return;
    const nextRunId = `editor:${Date.now()}`;
    setRunId(nextRunId);
    runPythonCode(nextRunId, content);
  };

  const runCurrentJavaScriptNow = () => {
    if (!computationEnabled) {
      onError("Enable the Computation module to run JavaScript in the editor.");
      return;
    }
    if (!content.trim()) return;
    const nextRunId = `editor-js:${Date.now()}`;
    setRunId(nextRunId);
    runJavaScriptCode(nextRunId, content);
  };

  const requestEditorCompletion = async () => {
    if (!editorCodeCompletionEnabled) return;
    const providerConfig = provider as ProviderConfig | null;
    if (!providerConfig?.model || (providerConfig.useManagedLlamaCpp !== true && (!providerConfig.apiKey?.trim() || !providerConfig.baseUrl))) {
      onError("Configure provider API key/base URL/model for code completion.");
      return;
    }
    const prefix = content.slice(0, editorCursor);
    const suffix = content.slice(editorCursor);
    if (prefix.trim().length < 4) return;
    completionAbortRef.current?.abort();
    const controller = new AbortController();
    completionAbortRef.current = controller;
    setEditorCompletionBusy(true);
    setEditorCompletion("");
    try {
      const response = await fetch("/api/modules/projects/llm-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerConfig, modules, prefix, suffix, filePath: draftName || selectedProjectFilePath || "" }),
        signal: controller.signal
      });
      const data = await response.json();
      if (!response.ok) throw new Error(String(data?.error || "Completion failed."));
      setEditorCompletion(String(data.completion || ""));
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        onError(error instanceof Error ? error.message : "Completion failed.");
      }
    } finally {
      setEditorCompletionBusy(false);
    }
  };

  const applyEditorCompletion = () => {
    const textarea = editorTextareaRef.current;
    if (!textarea || !editorCompletion) return;
    const cursor = textarea.selectionStart;
    const next = `${content.slice(0, cursor)}${editorCompletion}${content.slice(cursor)}`;
    setContent(next);
    setEditorCompletion("");
    requestAnimationFrame(() => {
      if (!editorTextareaRef.current) return;
      const pos = cursor + editorCompletion.length;
      editorTextareaRef.current.selectionStart = pos;
      editorTextareaRef.current.selectionEnd = pos;
      editorTextareaRef.current.focus();
    });
  };

  const onEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.altKey && event.code === "Space") {
      event.preventDefault();
      requestEditorCompletion().catch(() => undefined);
      return;
    }
    if (editorCompletion && event.key === "Tab") {
      event.preventDefault();
      applyEditorCompletion();
      return;
    }
    if (editorCompletion && event.key === "Escape") {
      event.preventDefault();
      setEditorCompletion("");
      return;
    }
  };

  const onEditorChange = (value: string) => {
    setContent(value);
    setEditorCompletion("");
  };

  const refreshGitReview = async () => {
    const root = projectDirectory.trim();
    if (!root) {
      setGitIsRepo(false);
      setGitStatus([]);
      setGitStagedDiff("");
      setGitUnstagedDiff("");
      setGitBranch("");
      return;
    }
    setGitLoading(true);
    try {
      const response = await fetch(`/api/modules/projects/git-review?root=${encodeURIComponent(root)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(String(data?.error || "Could not load git review."));
      setGitIsRepo(data.isRepo === true);
      setGitBranch(String(data.branch || ""));
      setGitStatus(Array.isArray(data.status) ? data.status : []);
      setGitStagedDiff(String(data.stagedDiff || ""));
      setGitUnstagedDiff(String(data.unstagedDiff || ""));
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not load git review.");
    } finally {
      setGitLoading(false);
    }
  };

  const stagePath = async (filePath: string, stage: boolean) => {
    if (!projectDirectory.trim()) return;
    try {
      await postJson("/api/modules/projects/git-review/stage", { root: projectDirectory.trim(), paths: [filePath], stage });
      await refreshGitReview();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not update staging.");
    }
  };

  const ignorePath = async (filePath: string) => {
    if (!projectDirectory.trim()) return;
    try {
      await postJson("/api/modules/projects/git-review/ignore", { root: projectDirectory.trim(), paths: [filePath] });
      await refreshGitReview();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not ignore path.");
    }
  };

  const initGitRepo = async () => {
    if (!projectDirectory.trim()) return;
    setGitLoading(true);
    try {
      await postJson("/api/modules/projects/git-review/init", { root: projectDirectory.trim() });
      await refreshGitReview();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not initialize git repository.");
    }
  };

  const commitNow = async () => {
    if (!projectDirectory.trim()) return;
    const message = gitCommitMessage.trim();
    if (!message) {
      onError("Commit message is required.");
      return;
    }
    try {
      await postJson("/api/modules/projects/git-review/commit", { root: projectDirectory.trim(), message });
      setGitCommitMessage("");
      await refreshGitReview();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not commit.");
    }
  };

  useEffect(() => {
    if (!draftName.trim()) return;
    if (!isDirty) return;
    if (isSaving) return;
    const timer = window.setTimeout(() => {
      saveFile().catch(() => undefined);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [content, draftName, selectedProjectFilePath, selectedProjectId, projectDirectory]);

  useEffect(() => {
    if (activeTool !== "scm") return;
    refreshGitReview().catch(() => undefined);
  }, [activeTool, projectDirectory]);

  useEffect(() => {
    return () => {
      if (completionTimerRef.current) window.clearTimeout(completionTimerRef.current);
      completionAbortRef.current?.abort();
    };
  }, []);

  return <section className="page editor-page" style={{ "--col-rail": `${colWidths.rail}px`, "--col-right": `${colWidths.right}px` } as CSSProperties}>
    <aside className="editor-rail">
      <div className="editor-rail-tabs" aria-label="Editor tools">
        <button className={activeTool === "projects" ? "active" : ""} type="button" onClick={() => setActiveTool("projects")}>Projects</button>
        <button className={activeTool === "files" ? "active" : ""} type="button" onClick={() => setActiveTool("files")}>Files</button>
        <button className={activeTool === "scm" ? "active" : ""} type="button" onClick={() => setActiveTool("scm")}>Git</button>
      </div>
      {activeTool === "projects" ? <section className="editor-panel editor-search-panel">
        <div className="editor-panel-heading">
          <span>Projects</span>
          <input className="editor-filter-input" placeholder="Filter projects" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
          <div className="button-row">
            <button type="button" onClick={refreshWorkspace}>Refresh</button>
            <button type="button" onClick={() => { setNewProjectName(""); setProjectDirectory(""); setShowCreateDialog(true); }}>Create Project</button>
          </div>
        </div>
        <div className="editor-search-results">
          {projects.length === 0 ? <span className="empty-module-state">No projects yet.</span> : projects
            .filter((item) => !normalizedSearch || [item.name, item.status, item.summary || ""].some((value) => value.toLowerCase().includes(normalizedSearch)))
            .map((item) => {
              const isExpanded = editingProjectId === item.id;
              return <div key={`project-${item.id}`} className={`editor-project-card${item.status === "disabled" ? " disabled" : ""}${isExpanded ? " expanded" : ""}`}>
                <div className="project-card-heading" role="button" tabIndex={0}
                  onClick={() => {
                    if (isExpanded) { setEditingProjectId(null); }
                    else { setEditingProjectId(item.id); setEditProjectName(item.name); setEditProjectSummary(item.summary || ""); if (item.status !== "disabled") setSelectedProjectId(item.id); }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      if (isExpanded) { setEditingProjectId(null); }
                      else { setEditingProjectId(item.id); setEditProjectName(item.name); setEditProjectSummary(item.summary || ""); if (item.status !== "disabled") setSelectedProjectId(item.id); }
                    }
                  }}>
                  <strong>{item.name}</strong>
                  <label className="project-enable" onClick={(e) => e.stopPropagation()}><input checked={item.status === "enabled"} onChange={(e) => { const next = e.target.checked ? "enabled" : "disabled"; if (next === "disabled" && selectedProjectId === item.id) { setSelectedProjectId(""); setSelectedProjectFilePath(""); setContent(""); } updateProjectApi(item.id, { status: next }).then(() => { refreshWorkspace(); onRefreshAuditLog(); }).catch((err) => onError(err instanceof Error ? err.message : "Could not update project.")); }} type="checkbox" /> {item.status === "done" ? "Done" : item.status === "enabled" ? "Enabled" : "Disabled"}</label>
                  <span className="expand-caret" aria-hidden="true">{isExpanded ? "\u25BE" : "\u25B8"}</span>
                </div>
                {isExpanded ? <div className="project-expanded-section">
                  <label className="editor-file-name">Name<input value={editProjectName} onChange={(e) => setEditProjectName(e.target.value)} onClick={(e) => e.stopPropagation()} /></label>
                  <label className="editor-file-name">Directory<div className="button-row"><button type="button" onClick={(e) => { e.stopPropagation(); selectDirectory(item.id); }}>Select Directory</button></div><input placeholder="Selected directory" value={projectDirectory} onChange={(e) => updateProjectDirectory(e.target.value, item.id)} onClick={(e) => e.stopPropagation()} /></label>
                  <div className="editor-summary-row">
                    <div className="editor-summary-head"><span>Summary</span><button type="button" onClick={(e) => { e.stopPropagation(); requestRepoSummaryForProject(item.id); }}>Summarize Repo</button></div>
                    <textarea rows={4} value={editProjectSummary} onChange={(e) => setEditProjectSummary(e.target.value)} onClick={(e) => e.stopPropagation()} />
                  </div>
                  <div className="button-row"><button type="button" onClick={(e) => { e.stopPropagation(); if (item.status !== "disabled") { setSelectedProjectId(item.id); setEditingProjectId(null); } else { onError("Cannot open a disabled project."); } }}>Open Project</button><button type="button" onClick={() => setEditingProjectId(null)}>Collapse</button><button type="button" onClick={(e) => { e.stopPropagation(); deleteProjectNow(item.id); }}>Delete</button></div>
                </div> : <p className="editor-project-summary">{item.summary || "No summary"}</p>}
              </div>;
            })}
        </div>
      </section> : null}
      {activeTool === "files" ? <div className="editor-panel editor-file-panel">
        <div className="editor-panel-heading"><span>Files</span><button type="button" onClick={createFile}>New</button></div>
        <label className="editor-file-name">Filter files<input placeholder="Search files" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} /></label>
        <div className="editor-file-list">{!projectDirectory.trim() ? <span className="empty-module-state">Select a project directory in Projects tab.</span> : projectFiles.length === 0 ? <span className="empty-module-state">No project files found.</span> : fileSearchResults.map((item) => <button className={selectedProjectFilePath === item.path ? "active" : ""} key={item.path} type="button" onClick={() => setSelectedProjectFilePath(item.path)}><strong>{item.path}</strong><span>{item.size} bytes</span></button>)}</div>
      </div> : null}
      {activeTool === "scm" ? <section className="editor-panel editor-scm-panel">
        <div className="editor-panel-heading"><span>Git Review</span><button type="button" onClick={() => refreshGitReview()} disabled={gitLoading}>{gitLoading ? "Loading..." : "Refresh"}</button></div>
        {selectedProject?.status === "disabled" ? <div className="editor-context-card"><span>Project is disabled. Enable it in Projects tab.</span></div> : null}
        <div className="editor-context-card">
          <strong>Repository</strong>
          <span>{projectDirectory ? gitIsRepo ? "Git repository detected." : <>Not a git repository. <button type="button" className="editor-git-init-btn" onClick={initGitRepo} disabled={gitLoading}>Initialize Repository</button></> : "Select a project directory first."}</span>
          <span>Project: {selectedProject ? selectedProject.name : "none"}</span>
          <span>Directory: {projectDirectory || "not set"}</span>
          <span>Branch: {gitBranch || "none"}</span>
        </div>
        {gitIsRepo ? <>
          <div className="editor-git-files">
            {gitStatus.length === 0 ? <span className="empty-module-state">Working tree clean.</span> : gitStatus.map((item) => {
              const isStaged = item.x !== " ";
              return <div className="editor-git-file-row" key={`${item.x}${item.y}:${item.path}`}>
                <span className="editor-git-code">{item.x}{item.y}</span>
                <strong>{item.path}</strong>
                <button type="button" onClick={() => stagePath(item.path, !isStaged)}>{isStaged ? "Unstage" : "Stage"}</button>
                <button type="button" onClick={() => ignorePath(item.path)}>Ignore</button>
              </div>;
            })}
          </div>
          <label className="editor-file-name">Commit Message<input placeholder="Describe this change" value={gitCommitMessage} onChange={(event) => setGitCommitMessage(event.target.value)} /></label>
          <div className="button-row"><button type="button" onClick={commitNow} disabled={!gitCommitMessage.trim()}>Commit</button></div>
          <div className="editor-git-diff-grid">
            <section><div className="editor-summary-head"><span>Staged Diff</span></div><pre className="editor-git-diff">{gitStagedDiff ? gitStagedDiff.split("\n").map((line, index) => renderDiffLine(line, index)) : "No staged changes."}</pre></section>
            <section><div className="editor-summary-head"><span>Unstaged Diff</span></div><pre className="editor-git-diff">{gitUnstagedDiff ? gitUnstagedDiff.split("\n").map((line, index) => renderDiffLine(line, index)) : "No unstaged changes."}</pre></section>
          </div>
        </> : null}
      </section> : null}
    </aside>
    <div className="editor-col-divider" onMouseDown={(e) => onColDividerDown(0, e)} />
    <main className="editor-workspace">
      <div className="editor-main-grid">
        <section className="editor-panel editor-code-panel">
          {(openTabs.length || !selectedProjectFilePath && (draftName || content)) ? <div className="editor-file-bar"><div className="editor-open-tabs">{openTabs.map((path) => <span className={`editor-open-tab ${selectedProjectFilePath === path ? "active" : ""}`} key={path}><button type="button" onClick={() => setSelectedProjectFilePath(path)}>{path}</button><button className="editor-tab-close" type="button" onClick={() => closeTab(path)} aria-label={`Close ${path}`}>×</button></span>)}</div>{!selectedProjectFilePath ? <input aria-label="File path" value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder="New file path" /> : null}</div> : null}
          <div className="editor-code-frame"><div className="editor-line-gutter" ref={editorGutterRef} aria-hidden="true">{lineNumbers.map((line) => <span key={line}>{line}</span>)}</div><div className="editor-code-input-wrap" onMouseDown={(event) => { if (event.altKey) requestEditorCompletion().catch(() => undefined); }}><pre className="editor-text-mirror" ref={editorMirrorRef} aria-hidden="true">{highlightedLines.map((line, i) => <div key={i}>{line.length === 0 ? "\u200B" : line.map((token, j) => <span key={j} className={`tk-${token.type}`}>{token.value}</span>)}</div>)}</pre><textarea ref={editorTextareaRef} spellCheck={false} value={content} onChange={(event) => onEditorChange(event.target.value)} onClick={(event) => setEditorCursor(event.currentTarget.selectionStart)} onKeyUp={(event) => setEditorCursor(event.currentTarget.selectionStart)} onSelect={(event) => setEditorCursor(event.currentTarget.selectionStart)} onKeyDown={onEditorKeyDown} onScroll={(event) => { const st = event.currentTarget.scrollTop; if (editorGutterRef.current) editorGutterRef.current.scrollTop = st; if (editorMirrorRef.current) editorMirrorRef.current.scrollTop = st; }} placeholder="Write code or open a project file." />{editorCompletion && editorCursorPos ? <div className="editor-llm-completion" style={{ top: editorCursorPos.top, left: editorCursorPos.left }}>Tab to accept: <span>{editorCompletion}</span></div> : editorCompletionBusy && editorCursorPos ? <div className="editor-llm-completion" style={{ top: editorCursorPos.top, left: editorCursorPos.left }}>Thinking...</div> : null}</div></div>
          <div className="editor-code-meta"><span>{isSaving ? "Saving..." : saveError ? "Save failed" : isDirty ? "Unsaved" : "Saved"}</span><span>{lineCount} lines</span><span>{content.length} chars</span></div>
        </section>
      </div>
    </main>
    <div className="editor-col-divider" onMouseDown={(e) => onColDividerDown(1, e)} />
    <div className="editor-col-chat">
      <aside className="editor-presence-preview" ref={previewRef} aria-label="Active background and VRM preview" style={{ height: previewHeight }}>
        {chatBackground ? <div className="editor-presence-background" style={{ "--chat-bg-dim": String(chatBackgroundDim), "--chat-bg-filter": chatBackgroundBlur ? "blur(4px)" : "none" } as CSSProperties}>
          {chatBackground.type === "video" ? <video autoPlay loop muted playsInline src={chatBackground.url} /> : <img alt="" src={chatBackground.url} />}
        </div> : null}
        <VrmStage className="editor-vrm-stage" {...vrmStage} />
        <div className="editor-preview-height-handle" onMouseDown={(e) => { e.preventDefault(); previewHeightDragRef.current = { startY: e.clientY, height: previewHeight }; }} />
      </aside>
      <div className={`chat-log vn-log editor-chat-log ${messages.length === 0 ? "empty-chat-log" : ""}`} ref={chatLogRef}>
        {messages.length === 0 ? <div className="empty-state chat-empty-state" aria-hidden="true" /> : null}
        {messages.map((message) => renderMessage(message, "current", promptProfile, { hideMetadataPrefix: true }))}
      </div>
    </div>
    {error ? <p className="error-text editor-error-text">{error}</p> : null}
    <ChatComposer
      callModeActive={callModeActive}
      callModeLevel={callModeLevel}
      callModeMuted={callModeMuted}
      callModeTtsVolume={callModeTtsVolume}
      chatFileInputRef={chatFileInputRef}
      composerTextareaRef={composerTextareaRef}
      hasDraft={hasDraft}
      isSending={isSending}
      isUtilityMenuOpen={isUtilityMenuOpen}
      onDraftChange={onDraftChange}
      onFileUpload={onFileUpload}
      onKeyDown={onKeyDown}
      onCallModeMuteToggle={onCallModeMuteToggle}
      onCallModeTtsVolumeChange={onCallModeTtsVolumeChange}
      onCallModeToggle={onCallModeToggle}
      onOpenAuditLog={onOpenAuditLog}
      onRegenerate={onRegenerate}
      onSubmit={onSubmit}
      onRunPython={runCurrentPythonNow}
      onRunJavaScript={runCurrentJavaScriptNow}
      runPythonDisabled={!computationEnabled || activeRun?.status === "running" || !content.trim()}
      runJavaScriptDisabled={!computationEnabled || activeRun?.status === "running" || !content.trim()}
      pendingAttachments={pendingAttachments}
      setIsChatManagerOpen={setIsChatManagerOpen}
      setIsUtilityMenuOpen={setIsUtilityMenuOpen}
      setPendingAttachments={setPendingAttachments}
    />
    {isChatManagerOpen ? <ChatManager
      deleteSession={deleteSession}
      draggedAgentId={draggedAgentId}
      formatTimestamp={formatTimestamp}
      inspectedSessionId={inspectedSessionId}
      loadSession={loadSession}
      moveSessionAgent={moveSessionAgent}
      promptProfiles={promptProfiles}
      renderMessage={renderMessage}
      setDraggedAgentId={setDraggedAgentId}
      setInspectedSessionId={setInspectedSessionId}
      setIsChatManagerOpen={setIsChatManagerOpen}
      setShowRawHistory={setShowRawHistory}
      showRawHistory={showRawHistory}
      startNewChat={startNewChat}
      toggleSessionAgent={toggleSessionAgent}
      visibleChatCards={visibleChatCards}
    /> : null}
    {showCreateDialog ? <div className="editor-dialog-overlay" onClick={() => setShowCreateDialog(false)}>
      <div className="editor-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="editor-panel-heading"><span>Create Project</span></div>
        <label className="editor-file-name">Project Name<input placeholder="My Project" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} /></label>
        <label className="editor-file-name">Directory<div className="button-row"><button type="button" onClick={async () => { try { const r = await fetch("/api/pick-directory"); const d = await r.json() as { success: boolean; path: string }; if (d.success && d.path) setProjectDirectory(d.path); } catch (e) { if (e instanceof Error) onError(e.message); } }}>Select Directory</button></div><input placeholder="Selected directory" value={projectDirectory} onChange={(e) => setProjectDirectory(e.target.value)} /></label>
        <div className="button-row"><button type="button" onClick={createProjectNow}>Create</button><button type="button" onClick={() => setShowCreateDialog(false)}>Cancel</button></div>
      </div>
    </div> : null}
  </section>;
});
