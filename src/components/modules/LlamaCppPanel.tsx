import { memo, useEffect, useState } from "react";
import { SettingsCard } from "../SettingsCard";
import type { ModuleSettingChange, ModuleSettings } from "./types";

type LlamaCppPanelProps = { onError: (message: string) => void; onSettingChange: ModuleSettingChange; postJson: (url: string, body: unknown, method?: string) => Promise<unknown>; settings: ModuleSettings };
type LlamaStatus = { running?: boolean; starting?: boolean; healthy?: boolean; baseUrl?: string; output?: string[] };
type LlamaRelease = { tag: string; name: string; assetName: string; assetUrl: string };
type LlamaModel = { name: string; path: string; size: number; updatedAt: string };
type ModelList = { modelsDir: string; models: LlamaModel[] };
type DownloadState = { active: boolean; receivedBytes: number; totalBytes: number; fileName: string; modelPath: string; error: string; completed: boolean };

const backendOptions = [
  { value: "cpu", label: "CPU" },
  { value: "cuda12", label: "CUDA 12" },
  { value: "cuda13", label: "CUDA 13" },
  { value: "vulkan", label: "Vulkan" },
  { value: "hip", label: "HIP Radeon" }
];
const kvCacheOptions = [
  { value: "", label: "Default (f16)" },
  { value: "f16", label: "f16" },
  { value: "q8_0", label: "q8_0" },
  { value: "q4_0", label: "q4_0" },
  { value: "q4_1", label: "q4_1" },
  { value: "iq4_nl", label: "iq4_nl" },
  { value: "bf16", label: "bf16" },
  { value: "f32", label: "f32" }
];
const speculativeModeOptions = [
  { value: "draft-simple", label: "Draft simple" },
  { value: "draft-mtp", label: "MTP draft" },
  { value: "ngram-simple", label: "N-gram simple" },
  { value: "none", label: "Off" }
];

function textSetting(settings: ModuleSettings, key: string) { return String(settings[key] || ""); }
function numberSetting(settings: ModuleSettings, key: string, defaultValue: number) { const value = Number(settings[key]); return Number.isFinite(value) ? value : defaultValue; }
function booleanSetting(settings: ModuleSettings, key: string) { return settings[key] === true; }
function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function readJsonResponse<T>(response: Response, fallbackError: string): Promise<T> {
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(String(data?.error || fallbackError));
  if (!data) throw new Error(fallbackError);
  return data as T;
}

export const LlamaCppPanel = memo(function LlamaCppPanel({ onError, onSettingChange, postJson, settings }: LlamaCppPanelProps) {
  const [status, setStatus] = useState<LlamaStatus | null>(null);
  const [release, setRelease] = useState<LlamaRelease | null>(null);
  const [models, setModels] = useState<ModelList | null>(null);
  const [download, setDownload] = useState<DownloadState | null>(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const backend = textSetting(settings, "backend") || "cpu";
  const modelsDir = textSetting(settings, "modelsDir");

  function installedVersionLabel(result: { installedVersion?: string; tag?: string; name?: string; assetName?: string }) {
    const installedVersion = String(result.installedVersion || "").trim();
    if (installedVersion && installedVersion.toLowerCase() !== "manual") return installedVersion;
    const tag = String(result.tag || "").trim();
    if (tag && tag.toLowerCase() !== "manual") return tag;
    return String(result.assetName || result.name || installedVersion || tag || "").trim();
  }

  function applyModelList(nextModels: ModelList) {
    setModels(nextModels);
    const activeModel = textSetting(settings, "modelPath");
    if (activeModel && !nextModels.models.some((model) => model.path === activeModel)) onSettingChange("modelPath", "");
  }

  useEffect(() => {
    let cancelled = false;
    postJson("/api/llama-cpp/models", { settings })
      .then((data) => { if (!cancelled) applyModelList(data as ModelList); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [modelsDir]);

  useEffect(() => {
    loadStatus(true).catch(() => undefined);
  }, []);

  async function loadStatus(quiet = false) {
    if (!quiet) setBusy("status");
    try {
      const response = await fetch("/api/llama-cpp/status");
      const data = await response.json();
      if (!response.ok) throw new Error(String(data?.error || "llama.cpp status failed."));
      setStatus(data);
      if (!quiet) setNotice(`Status refreshed: ${data.starting ? "starting" : data.running ? data.healthy ? "healthy" : "loading model" : "stopped"}${data.baseUrl ? ` at ${data.baseUrl}` : ""}.`);
    } catch (error) {
      onError(error instanceof Error ? error.message : "llama.cpp status failed.");
    } finally {
      if (!quiet) setBusy("");
    }
  }

  async function checkRelease() {
    setBusy("release");
    try {
      const response = await fetch(`/api/llama-cpp/releases/latest?backend=${encodeURIComponent(backend)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(String(data?.error || "llama.cpp release check failed."));
      setRelease(data);
      onSettingChange("releaseAssetUrl", data.assetUrl);
      setNotice(`Latest ${backend} build: ${data.tag} / ${data.assetName}.`);
    } catch (error) {
      onError(error instanceof Error ? error.message : "llama.cpp release check failed.");
    } finally {
      setBusy("");
    }
  }

  async function installRelease() {
    setBusy("install");
    try {
      const data = await postJson("/api/llama-cpp/install", { settings });
      const result = data as { binaryPath?: string; installDir?: string; installedVersion?: string; assetUrl?: string; tag?: string; name?: string; assetName?: string };
      if (result.binaryPath) onSettingChange("binaryPath", result.binaryPath);
      if (result.installDir) onSettingChange("installDir", result.installDir);
      const versionLabel = installedVersionLabel(result);
      if (versionLabel) onSettingChange("installedVersion", versionLabel);
      if (result.assetUrl) onSettingChange("releaseAssetUrl", result.assetUrl);
      setNotice(`Installed ${versionLabel || "llama.cpp"}.`);
      await loadStatus(true);
    } catch (error) {
      onError(error instanceof Error ? error.message : "llama.cpp install failed.");
    } finally {
      setBusy("");
    }
  }

  async function loadModels() {
    setBusy("models");
    try {
      applyModelList(await postJson("/api/llama-cpp/models", { settings }) as ModelList);
    } catch (error) {
      onError(error instanceof Error ? error.message : "llama.cpp model listing failed.");
    } finally {
      setBusy("");
    }
  }

  async function downloadModel() {
    setBusy("download-model");
    try {
      const startResponse = await fetch("/api/llama-cpp/models/download", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings }) });
      const initial = await readJsonResponse<DownloadState>(startResponse, "llama.cpp model download failed.");
      setDownload(initial);
      while (true) {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        const response = await fetch("/api/llama-cpp/models/download/status");
        const next = await readJsonResponse<DownloadState>(response, "Could not read model download status.");
        setDownload(next);
        if (next.error) throw new Error(next.error);
        if (next.completed) {
          onSettingChange("modelPath", next.modelPath);
          await loadModels();
          return;
        }
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "llama.cpp model download failed.");
    } finally {
      setBusy("");
    }
  }

  function selectModelPath(value: string) {
    onSettingChange("modelPath", value);
  }

  const downloadPercent = download?.totalBytes ? Math.max(0, Math.min(100, Math.round((download.receivedBytes / download.totalBytes) * 100))) : 0;

  async function startServer() {
    setBusy("start");
    try {
      setNotice("Starting llama.cpp server...");
      setStatus({ running: true, starting: true, healthy: false, output: ["Starting server..."] });
      const started = await postJson("/api/llama-cpp/start", { settings }) as LlamaStatus;
      setStatus(started);
      const startedAt = Date.now();
      while (true) {
        await new Promise((resolve) => window.setTimeout(resolve, 250));
        const response = await fetch("/api/llama-cpp/status");
        const data = await readJsonResponse<LlamaStatus>(response, "llama.cpp status failed.");
        setStatus(data);
        if (data.healthy) {
          setNotice(`llama.cpp is healthy${data.baseUrl ? ` at ${data.baseUrl}` : ""}.`);
          return;
        }
        if (!data.running && !data.starting) throw new Error(data.output?.slice(-8).join("\n") || "llama.cpp stopped before becoming healthy.");
        if (Date.now() - startedAt > 90000) throw new Error(data.output?.slice(-8).join("\n") || "llama.cpp did not report healthy within 90 seconds.");
      }
    } catch (error) {
      await loadStatus(true).catch(() => undefined);
      onError(error instanceof Error ? error.message : "llama.cpp start failed.");
      setNotice("llama.cpp failed to start. Check the runtime log below.");
    } finally {
      setBusy("");
    }
  }

  async function stopServer() {
    setBusy("stop");
    try {
      await postJson("/api/llama-cpp/stop", {});
      await loadStatus(true);
    } catch (error) {
      onError(error instanceof Error ? error.message : "llama.cpp stop failed.");
    } finally {
      setBusy("");
    }
  }

  return <div className="llama-cpp-panel">
    <SettingsCard collapsible defaultOpen={false} title="Install">
      <div className="field-grid two-column">
        <label>Backend<select value={backend} onChange={(event) => { onSettingChange("backend", event.target.value); onSettingChange("releaseAssetUrl", ""); setRelease(null); }}>{backendOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label className="inline-button-row">Binary<button className="small-action-button llama-action-button secondary" disabled={Boolean(busy)} onClick={checkRelease} type="button">Check</button>
          <button className="small-action-button llama-action-button primary" disabled={Boolean(busy)} onClick={installRelease} type="button">Install/Update</button></label>
        <label>Server Binary<input value={textSetting(settings, "binaryPath")} onChange={(event) => onSettingChange("binaryPath", event.target.value)} placeholder="Auto-filled after install" /></label>
        <label>Installed Version<input value={textSetting(settings, "installedVersion")} readOnly /></label>
      </div>
      {notice ? <p className="module-note llama-cpp-notice">{notice}</p> : null}
      <details className="voiceforge-section">
        <summary className="voiceforge-section-header"><span>Install details</span></summary>
        <div className="voiceforge-section-content">
          <div className="field-grid two-column">
            <label>Install Directory<input value={textSetting(settings, "installDir")} onChange={(event) => onSettingChange("installDir", event.target.value)} placeholder="Defaults to app data runtime folder" /></label>
            <label>Latest Asset<input value={release?.assetName || textSetting(settings, "releaseAssetUrl")} onChange={(event) => onSettingChange("releaseAssetUrl", event.target.value)} /></label>
          </div>
          {release ? <p className="module-note">Latest: {release.tag} using {release.assetName}</p> : null}
        </div>
      </details>
    </SettingsCard>

    <SettingsCard collapsible defaultOpen={false} title="Models">
      <div className="field-grid two-column">
        <label className="inline-button-row"><span>Download URL</span><input value={textSetting(settings, "modelDownloadUrl")} onChange={(event) => onSettingChange("modelDownloadUrl", event.target.value)} placeholder="HF repo or direct .gguf URL" /><button className="small-action-button llama-action-button primary" disabled={Boolean(busy)} onClick={downloadModel} type="button">Download</button></label>
        <label>Active Model<select value={textSetting(settings, "modelPath")} onChange={(event) => selectModelPath(event.target.value)}>
          <option value="">Select model</option>
          {models?.models.map((model) => <option key={model.path} value={model.path}>{model.name}</option>)}
         </select></label>
        <label>MMProj (multimodal)<select value={textSetting(settings, "mmprojPath")} onChange={(event) => onSettingChange("mmprojPath", event.target.value)}>
          <option value="">None</option>
          {models?.models.map((model) => <option key={model.path} value={model.path}>{model.name}</option>)}
        </select></label>
        <label>Draft/MTP Model<select value={textSetting(settings, "mtpModelPath")} onChange={(event) => onSettingChange("mtpModelPath", event.target.value)}>
          <option value="">None</option>
          {models?.models.map((model) => <option key={model.path} value={model.path}>{model.name}</option>)}
        </select></label>
        <label>Speculative Mode<select value={textSetting(settings, "speculativeMode") || "draft-simple"} onChange={(event) => onSettingChange("speculativeMode", event.target.value)}>{speculativeModeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
        <label>Max Draft Tokens<input min="0" step="1" type="number" value={numberSetting(settings, "specDraftNMax", 0)} onChange={(event) => onSettingChange("specDraftNMax", Number(event.target.value))} placeholder="0 = default" /></label>
      </div>
      {download?.active || download?.completed ? <div className="download-progress-block">
        <progress max="100" value={downloadPercent}>{downloadPercent}%</progress>
        <p className="module-note">{download.fileName || "Downloading..."}: {download.totalBytes ? `${downloadPercent}% (${formatBytes(download.receivedBytes)} / ${formatBytes(download.totalBytes)})` : formatBytes(download.receivedBytes)}{download.completed ? " complete" : ""}</p>
      </div> : null}
    </SettingsCard>

    <SettingsCard collapsible defaultOpen={false} title="Server">
      <div className="field-grid two-column">
        <label>Host<input value={textSetting(settings, "host") || "127.0.0.1"} onChange={(event) => onSettingChange("host", event.target.value)} /></label>
        <label>Port<input min="1" max="65535" step="1" type="number" value={numberSetting(settings, "port", 1234)} onChange={(event) => onSettingChange("port", Number(event.target.value))} /></label>
        <label>Context Length<input min="1024" step="1024" type="number" value={numberSetting(settings, "contextLength", 8192)} onChange={(event) => onSettingChange("contextLength", Number(event.target.value))} /></label>
        <label>Batch Size<input min="32" step="1" type="number" value={numberSetting(settings, "batchSize", 2048)} onChange={(event) => onSettingChange("batchSize", Number(event.target.value))} /></label>
        <label>Ubatch Size<input min="1" step="1" type="number" value={numberSetting(settings, "ubatchSize", 512)} onChange={(event) => onSettingChange("ubatchSize", Number(event.target.value))} /></label>
        <label className="checkbox-row"><input checked={booleanSetting(settings, "flashAttention")} type="checkbox" onChange={(event) => onSettingChange("flashAttention", event.target.checked)} />Flash Attention</label>
        <label className="checkbox-row"><input checked={booleanSetting(settings, "noWarmup")} type="checkbox" onChange={(event) => onSettingChange("noWarmup", event.target.checked)} />Skip Warmup</label>
        <label className="checkbox-row"><input checked={booleanSetting(settings, "cpuMoe")} type="checkbox" onChange={(event) => onSettingChange("cpuMoe", event.target.checked)} />CPU MoE</label>
        <label>N CPU MoE Layers<input min="0" step="1" type="number" value={numberSetting(settings, "nCpuMoe", 0)} onChange={(event) => onSettingChange("nCpuMoe", Number(event.target.value))} placeholder="0 = disabled" /></label>
        <label>MoE Expert Count<input min="0" step="1" type="number" value={numberSetting(settings, "moeNExpert", 0)} onChange={(event) => onSettingChange("moeNExpert", Number(event.target.value))} placeholder="0 = default" /></label>
        <label className="checkbox-row"><input checked={booleanSetting(settings, "enableThinking")} type="checkbox" onChange={(event) => onSettingChange("enableThinking", event.target.checked)} />Enable Reasoning</label>
        <label>Cache Reuse<input min="0" step="1" type="number" value={numberSetting(settings, "cacheReuse", 256)} onChange={(event) => onSettingChange("cacheReuse", Number(event.target.value))} /></label>
        <label>KV Cache Type<select value={textSetting(settings, "kvCacheType")} onChange={(event) => onSettingChange("kvCacheType", event.target.value)}>{kvCacheOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
        <label>Fit<select value={textSetting(settings, "fitMode") || "on"} onChange={(event) => onSettingChange("fitMode", event.target.value)}><option value="on">on</option><option value="off">off</option></select></label>
        <label>GPU Layers<input value={textSetting(settings, "gpuLayers") || "auto"} onChange={(event) => onSettingChange("gpuLayers", event.target.value)} placeholder="auto, all, or a number" /></label>
        <label>Threads<input min="-1" step="1" type="number" value={numberSetting(settings, "threads", -1)} onChange={(event) => onSettingChange("threads", Number(event.target.value))} /></label>
      </div>
    </SettingsCard>

    <SettingsCard collapsible defaultOpen={false} title="Runtime">
      <pre className="runtime-log">{status?.output?.length ? status.output.join("\n") : status?.starting ? "Starting..." : "Server not running."}</pre>
      <div className="runtime-controls-row">
        <div className="buttons">
          <button className="small-action-button llama-action-button primary" disabled={Boolean(busy)} onClick={startServer} type="button">Start</button>
          <button className="delete-button small-action-button llama-action-button danger" disabled={Boolean(busy)} onClick={stopServer} type="button">Stop</button>
          <button className="small-action-button llama-action-button secondary" disabled={Boolean(busy)} onClick={() => loadStatus()} type="button">Refresh</button>
        </div>
        <span className="status">Status: {status?.starting ? "starting..." : status?.running ? status.healthy ? "healthy" : "loading model" : "stopped"}{status?.baseUrl ? ` - ${status.baseUrl}` : ""}</span>
      </div>
    </SettingsCard>
  </div>;
});
