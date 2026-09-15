import { memo, useEffect, useRef, useState } from "react";
import type { ModuleSettingChange, ModuleSettings } from "./types";

type IntifaceInventory = {
  funscripts: Array<{ name: string; path?: string; size?: number; updatedAt?: string; url: string }>;
  media: Array<{ name: string; path?: string; size?: number; updatedAt?: string; url: string }>;
  playModes: Array<{ name: string; path?: string; size?: number; updatedAt?: string; url: string }>;
  lorebooks: Array<{ name: string; path?: string; size?: number; updatedAt?: string; url: string }>;
};

type IntifacePlayMode = {
  category: string;
  color: string;
  defaultEnabled: boolean;
  folder: string;
  icon: string;
  id: string;
  intensityMultiplier: number;
  name: string;
  patterns: string[];
  toggleable: boolean;
};

type IntifacePanelProps = {
  moduleEnabled: boolean;
  onError: (message: string) => void;
  onSettingChange: ModuleSettingChange;
  settings: ModuleSettings;
};

function boolSetting(settings: ModuleSettings, key: string, fallback = false) {
  return settings[key] === undefined ? fallback : settings[key] === true;
}

function numberSetting(settings: ModuleSettings, key: string, fallback: number) {
  const value = Number(settings[key] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

function stringSetting(settings: ModuleSettings, key: string, fallback = "") {
  return String(settings[key] ?? fallback);
}

function objectSetting(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function moduleAssetsFromUnknown(value: unknown): Array<{ name: string; path?: string; size?: number; updatedAt?: string; url: string }> {
  const list = Array.isArray(value) ? value : [];
  const assets: Array<{ name: string; path?: string; size?: number; updatedAt?: string; url: string }> = [];
  for (const entry of list) {
    const item = objectSetting(entry);
    const url = String(item.url || "").trim();
    if (!url) continue;
    const name = String(item.name || url.split("/").pop() || "").trim();
    assets.push({ name: name || url, path: typeof item.path === "string" ? item.path : undefined, size: Number.isFinite(Number(item.size)) ? Number(item.size) : undefined, updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : undefined, url });
  }
  return assets;
}

function arraySetting(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
}

function extractPatternNames(source: string) {
  const body = source.match(/=\s*\{([\s\S]*)\}\s*(?:if\s*\(|$)/)?.[1] || "";
  return Array.from(body.matchAll(/^\s*([a-zA-Z_$][\w$]*)\s*:/gm)).map((match) => match[1]);
}

function withCacheBust(url: string) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}t=${Date.now()}`;
}

const basicIntifacePatterns = ["sine", "triangle", "square", "sawtooth", "pulse", "ramp_up", "ramp_down", "wave", "gentle", "heartbeat", "double_pulse", "stairs", "knock", "rumble", "purr", "throb", "chop", "triplet", "hf_buzz", "lf_swell", "sweep_up", "sweep_down", "gate_hold", "bounce", "notch", "teasing", "tickle", "micro_tease", "abrupt_edge", "crescendo", "rapid_fire", "intense_waves", "build_and_ruin", "held_edge"];

const basicIntifaceMode: IntifacePlayMode = {
  category: "basic",
  color: "var(--muted-2)",
  defaultEnabled: true,
  folder: "basic",
  icon: "fa-wave-square",
  id: "basic",
  intensityMultiplier: 1,
  name: "Basic Waveforms",
  patterns: basicIntifacePatterns,
  toggleable: false
};

function formatAssetSize(size: unknown) {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + " GB";
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
  return bytes + " B";
}

function formatAssetDate(value: unknown) {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function mediaIconFor(name: string) {
  return /\.(mp3|wav|ogg|flac|m4a)$/i.test(name) ? "fa-music" : "fa-film";
}

function formatTimelineLabel(ms: number) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export const IntifacePanel = memo(function IntifacePanel({ moduleEnabled, onError, onSettingChange, settings }: IntifacePanelProps) {
  const [intifaceInventory, setIntifaceInventory] = useState<IntifaceInventory>({ funscripts: [], media: [], playModes: [], lorebooks: [] });
  const [intifacePlayModes, setIntifacePlayModes] = useState<IntifacePlayMode[]>([basicIntifaceMode]);
  const [intifacePatternDurationMs, setIntifacePatternDurationMs] = useState(5000);
  const [intifaceTimelineBlocks, setIntifaceTimelineBlocks] = useState<unknown[]>([]);
  const intifaceRuntimeRef = useRef<{ isClientConnected: () => boolean } | null>(null);
  const [timelineMotorCounts, setTimelineMotorCounts] = useState<Record<string, number>>({ A: 1, B: 1, C: 1, D: 1 });

  const updateNumber = (key: string, value: string, min: number, max: number, fallback: number) => {
    const raw = Number(value);
    const next = Math.max(min, Math.min(max, Number.isFinite(raw) ? raw : fallback));
    onSettingChange(key, next);
  };

  const refreshIntifaceAssets = async () => {
    try {
      const response = await fetch("/api/modules/assets/inventory?refresh=true");
      const data = await response.json().catch(() => ({}));
      const intiface = data?.inventory?.modules?.intiface || {};
      const playModeAssets = moduleAssetsFromUnknown(intiface.playModes);
      setIntifaceInventory({
        funscripts: moduleAssetsFromUnknown(intiface.funscripts),
        media: moduleAssetsFromUnknown(intiface.media),
        playModes: playModeAssets,
        lorebooks: moduleAssetsFromUnknown(intiface.lorebooks)
      });
      const modeJsonAssets = playModeAssets.filter((asset) => /(?:^|\/)mode\.json$/i.test(asset.url));
      const modes = await Promise.all(modeJsonAssets.map(async (asset) => {
        const mode = objectSetting(await fetch(withCacheBust(asset.url), { cache: "no-store" }).then((modeResponse) => modeResponse.json()).catch(() => ({})));
        const folder = asset.url.replace(/\/mode\.json$/i, "");
        const patternSource = await fetch(withCacheBust(folder + "/patterns.js"), { cache: "no-store" }).then((patternResponse) => patternResponse.ok ? patternResponse.text() : "").catch(() => "");
        const ui = objectSetting(mode.ui);
        return {
          category: String(mode.category || "custom"),
          color: String(ui.color || "var(--muted-2)"),
          defaultEnabled: ui.defaultEnabled === true,
          folder: folder.split("/").pop() || String(mode.id || asset.name.replace(/\.json$/i, "")),
          icon: String(ui.icon || "fa-wave-square"),
          id: String(mode.id || asset.name.replace(/\.json$/i, "")),
          intensityMultiplier: Number(mode.intensityMultiplier) || 1,
          name: String(mode.name || mode.id || asset.name.replace(/\.json$/i, "")),
          patterns: extractPatternNames(patternSource),
          toggleable: ui.toggleable !== false
        } satisfies IntifacePlayMode;
      }));
      const byId = new Map<string, IntifacePlayMode>();
      for (const mode of [basicIntifaceMode, ...modes]) byId.set(mode.id, mode);
      setIntifacePlayModes(Array.from(byId.values()));
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not refresh Intiface assets.");
    }
  };

  useEffect(() => {
    refreshIntifaceAssets().catch(() => undefined);
  }, []);

  useEffect(() => {
    const updateMotorCounts = (event: Event) => {
      const detail = objectSetting((event as CustomEvent).detail);
      setTimelineMotorCounts({
        A: Math.max(1, Number(detail.A) || 1),
        B: Math.max(1, Number(detail.B) || 1),
        C: Math.max(1, Number(detail.C) || 1),
        D: Math.max(1, Number(detail.D) || 1)
      });
    };
    window.addEventListener("intiface-timeline-motor-counts", updateMotorCounts);
    return () => window.removeEventListener("intiface-timeline-motor-counts", updateMotorCounts);
  }, []);

  useEffect(() => {
    if (!moduleEnabled) return;
    (async () => {
      try {
        const buttplug = await import("buttplug");
        const cdUrl = "/assets/modules/intiface/intiface/connected_devices.js";
        const mediaUrl = "/assets/modules/intiface/intiface/media_playback.js";
        const executionUrl = "/assets/modules/intiface/intiface/device_execution.js";
        const cd = await import(/* @vite-ignore */ cdUrl);
        const media = await import(/* @vite-ignore */ mediaUrl);
        const execution = await import(/* @vite-ignore */ executionUrl);
        const cdApi = await cd.initConnectedDevices(buttplug);
        media.initMediaModule({
          NAME: "intiface-connect",
          getConnectedDevices: cd.getConnectedDevices,
          getDeviceChannel: cd.getDeviceChannel,
          stopAllDeviceActions: execution.stopAllDeviceActions,
          updateStatus: (message: string, isError?: boolean) => {
            const status = document.getElementById("intiface-status-panel");
            if (status) {
              status.textContent = `Status: ${message}`;
              status.classList.toggle("error", isError === true);
            }
            if (isError) onError(message);
          },
          getRequestHeaders: (options?: { omitContentType?: boolean }) => options?.omitContentType ? {} : { "Content-Type": "application/json" }
        });
        intifaceRuntimeRef.current = cdApi;
        media.initMediaPlayer();
        cdApi.updateButtonStates(cdApi.isClientConnected());
        cdApi.renderDeviceList(cdApi.getConnectedDevices());
      } catch (e) {
        console.error("[Intiface] init failed:", e);
      }
    })();
  }, [moduleEnabled]);

  const intifaceEnabledModes = arraySetting(settings.intifaceEnabledModes);
  const selectedIntifaceMode = stringSetting(settings, "intifaceSelectedMode", "basic");
  const intifacePattern = stringSetting(settings, "intifaceTimelinePattern", "sine");
  const selectedIntifacePlayMode = intifacePlayModes.find((mode) => mode.id === selectedIntifaceMode) || intifacePlayModes[0] || basicIntifaceMode;
  const intifaceAiModes = intifacePlayModes.filter((mode) => mode.toggleable);
  const configuredIntifaceAiModes = intifaceEnabledModes.filter((mode) => mode !== "basic");
  const effectiveIntifaceAiModes = configuredIntifaceAiModes.length ? configuredIntifaceAiModes : intifaceAiModes.map((mode) => mode.id);
  const visibleIntifacePlayModes = [basicIntifaceMode, ...intifaceAiModes.filter((mode) => effectiveIntifaceAiModes.includes(mode.id))];
  const selectedIntifacePatterns = selectedIntifacePlayMode.patterns.length ? selectedIntifacePlayMode.patterns : basicIntifacePatterns;
  const timelineBaseDurationMs = intifacePatternDurationMs;
  const timelineContentDurationMs = Math.max(timelineBaseDurationMs, ...intifaceTimelineBlocks.map((block) => {
    const item = objectSetting(block);
    const startTime = Math.max(0, Number(item.startTime) || 0);
    const duration = Math.max(1, Number(item.duration) || timelineBaseDurationMs);
    return startTime + duration;
  }));
  const removeTimelineBlock = (blockIndex: number) => {
    setIntifaceTimelineBlocks((current) => current.filter((_, entryIndex) => entryIndex !== blockIndex));
  };

  useEffect(() => {
    const labels = Array.from(document.querySelectorAll<HTMLSpanElement>(".intiface-timeline-scale span"));
    if (labels.length < 5) return;
    [0, 0.25, 0.5, 0.75, 1].forEach((part, index) => {
      const label = formatTimelineLabel(timelineContentDurationMs * part);
      if (labels[index].textContent !== label) labels[index].textContent = label;
    });
  }, [timelineContentDurationMs]);

  const searchQuery = stringSetting(settings, "intifaceMediaSearch", "").toLowerCase();
  const mediaType = stringSetting(settings, "intifaceMediaType", "all");
  const mediaSort = stringSetting(settings, "intifaceMediaSort", "name-asc");
  const visibleMedia = intifaceInventory.media
    .filter((asset) => {
      if (searchQuery && !asset.name.toLowerCase().includes(searchQuery)) return false;
      if (mediaType === "audio") return /\.(mp3|wav|ogg|flac|m4a)$/i.test(asset.name);
      if (mediaType === "video") return /\.(mp4|webm|mkv|avi|mov)$/i.test(asset.name);
      return true;
    })
    .sort((a, b) => {
      const dir = mediaSort.endsWith("-desc") ? -1 : 1;
      const field = mediaSort.replace(/-(asc|desc)$/, "");
      switch (field) {
        case "name": return dir * a.name.localeCompare(b.name);
        case "date": return dir * (new Date(a.updatedAt || 0).getTime() - new Date(b.updatedAt || 0).getTime());
        case "size": return dir * ((a.size || 0) - (b.size || 0));
        default: return 0;
      }
    });

  return <div id="embody-intiface-panel" className="embody-tab-panel active intiface-native-panel">
      <div className="intiface-native-title"><strong>Intiface Connect</strong><a href="https://intiface.com/" target="_blank" rel="noreferrer" title="Intiface"><i className="fa-solid fa-circle-question" /></a></div>
      <div id="intiface-status-panel" className={`intiface-status ${moduleEnabled && intifaceRuntimeRef.current?.isClientConnected() ? "connected" : "disconnected"}`}>Status: {moduleEnabled && intifaceRuntimeRef.current?.isClientConnected() ? "Connected" : "Disconnected"}</div>
      <div id="intiface-ai-status" className="intiface-ai-status-card">
        <div className="intiface-ai-row"><span><i className="fa-solid fa-robot" /> <span id="intiface-ai-status-text">AI is ready to control your device via chat commands</span></span><label className="checkbox_label" htmlFor="intiface-ai-enabled"><input checked={boolSetting(settings, "intifaceAiEnabled", true)} id="intiface-ai-enabled" onChange={(event) => onSettingChange("intifaceAiEnabled", event.target.checked)} type="checkbox" /><small>AI Device Control</small></label></div>
        <div className="intiface-sync-settings">
          <label className="checkbox_label" htmlFor="intiface-ai-tts-sync-enabled"><input checked={boolSetting(settings, "intifaceAiTtsSyncEnabled")} id="intiface-ai-tts-sync-enabled" onChange={(event) => onSettingChange("intifaceAiTtsSyncEnabled", event.target.checked)} type="checkbox" /><small>Sync AI commands to VoiceForge spoken chunks</small></label>
          {[ ["intifaceAiTtsSyncOffsetMs", "intiface-ai-tts-sync-offset", "Offset", -1500, 1500, 50, 0], ["intifaceAiTtsSyncTimeoutMs", "intiface-ai-tts-sync-timeout", "Timeout", 300, 5000, 100, 1200], ["intifaceAiSyncStartLeadMs", "intiface-ai-sync-start-lead", "Anim lead", 0, 3000, 50, 1200] ].map(([key, id, label, min, max, step, fallback]) => <div className="intiface-slider-row" key={String(key)}><label htmlFor={String(id)}>{String(label)}</label><input id={String(id)} max={Number(max)} min={Number(min)} step={Number(step)} type="range" value={numberSetting(settings, String(key), Number(fallback))} onChange={(event) => updateNumber(String(key), event.target.value, Number(min), Number(max), Number(fallback))} /><span>{numberSetting(settings, String(key), Number(fallback))}ms</span></div>)}
          <div className="intiface-select-row"><label htmlFor="intiface-ai-tts-interrupt-policy">Interrupt</label><select className="text_pole" id="intiface-ai-tts-interrupt-policy" value={stringSetting(settings, "intifaceAiTtsInterruptPolicy", "grace")} onChange={(event) => onSettingChange("intifaceAiTtsInterruptPolicy", event.target.value)}><option value="grace">Grace (short hold)</option><option value="flush">Flush immediately</option><option value="preserve">Preserve queue</option></select></div>
          <label className="checkbox_label intiface-debug-toggle" htmlFor="intiface-debug-logging-enabled"><input checked={boolSetting(settings, "intifaceDebugLoggingEnabled")} id="intiface-debug-logging-enabled" onChange={(event) => onSettingChange("intifaceDebugLoggingEnabled", event.target.checked)} type="checkbox" /><small>Verbose debug logging (chunk/parse sync)</small></label>
        </div>
      </div>
      <div className="intiface-connect-row"><button className="menu_button connect-button" id="intiface-connect-action-button" type="button"><i className="fa-solid fa-power-off" /> <span className="btn-text">Connect</span></button><input className="text_pole" id="intiface-ip-input" placeholder="ws://127.0.0.1:12345" defaultValue="127.0.0.1:12345" style={{ maxWidth: "180px" }} /><small>Connects to Intiface Central/Engine WebSocket.</small></div>
      <div className="intiface-connect-row"><label className="checkbox_label" htmlFor="intiface-auto-connect"><input checked={boolSetting(settings, "intifaceAutoConnect")} id="intiface-auto-connect" onChange={(event) => onSettingChange("intifaceAutoConnect", event.target.checked)} type="checkbox" /><small>Auto-connect on startup</small></label></div>
      <div id="intiface-devices" className="intiface-device-list" />
      <details className="intiface-native-drawer" id="intiface-playmode-menu"><summary><span><i className="fa-solid fa-gamepad" /> Play Mode</span><i className="fa-solid fa-caret-down" /></summary><div className="intiface-native-drawer-content">
        <div className="intiface-subtitle"><i className="fa-solid fa-layer-group" /> Pattern Categories</div>
        <div className="intiface-playmode-tabs" id="intiface-playmode-tabs-container">{visibleIntifacePlayModes.map((mode) => <button className={mode.id === selectedIntifaceMode ? "active" : ""} key={mode.id} style={{ color: mode.color }} type="button" onClick={() => { onSettingChange("intifaceSelectedMode", mode.id); onSettingChange("intifaceTimelinePattern", mode.patterns[0] || basicIntifacePatterns[0]); }}><i className={`fa-solid ${mode.icon}`} /> {mode.name}</button>)}</div>
        <div className="intiface-control-card">
          {[ ["intifacePatternDurationMs", "intiface-pattern-duration", "fa-solid fa-clock", "Duration", 1000, 1800000, 500, 5000, "s"] ].map(([key, id, icon, label, min, max, step, fallback, suffix]) => {
            const value = String(key) === "intifacePatternDurationMs" ? intifacePatternDurationMs : numberSetting(settings, String(key), Number(fallback));
            const display = suffix === "s" ? `${(value / 1000).toFixed(1)}s` : `${value}${suffix}`;
            return <div className="intiface-slider-row" key={String(key)}><label htmlFor={String(id)}><i className={String(icon)} /> {String(label)}:</label><input id={String(id)} max={Number(max)} min={Number(min)} step={Number(step)} type="range" value={value} onChange={(event) => { const raw = Number(event.target.value); const next = Math.max(Number(min), Math.min(Number(max), Number.isFinite(raw) ? raw : Number(fallback))); if (String(key) === "intifacePatternDurationMs") setIntifacePatternDurationMs(next); else updateNumber(String(key), event.target.value, Number(min), Number(max), Number(fallback)); }} /><span>{display}</span></div>;
          })}
          <div className="intiface-help-text">Set the timeline block duration before placing a pattern</div>
        </div>
        <div className="intiface-pattern-list" id="intiface-pattern-buttons">{selectedIntifacePatterns.map((pattern) => <button className={`menu_button menu-button-like ${intifacePattern === pattern ? "active" : ""}`} key={pattern} type="button" onClick={() => onSettingChange("intifaceTimelinePattern", pattern)}>{pattern.replace(/_/g, " ")}</button>)}</div>
        <div id="intiface-timeline-sequencer" className="intiface-timeline-shell">
          <div className="intiface-timeline-toolbar"><strong><i className="fa-solid fa-sliders" /> Timeline Sequencer</strong><span>Click pattern {"->"} Click timeline to place | Click block to delete | Multi-motor devices phase across motors</span></div>
          <div className="intiface-timeline-scale"><span>0:00</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>
          {(["A", "B", "C", "D"] as const).map((channel) => <div className="intiface-timeline-track" key={channel}>
            <strong className="intiface-channel-label"><i className="fa-solid fa-wave-square" /> {channel}</strong>
            <div className="intiface-track-lane-stack">
            {Array.from({ length: timelineMotorCounts[channel] || 1 }, (_, motorIndex) => motorIndex + 1).map((motor) => <div className="intiface-track-lane" data-channel={channel} data-motor={motor} key={`${channel}-${motor}`} role="presentation" onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const clickPct = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
              const currentEnd = Math.max(timelineBaseDurationMs, ...intifaceTimelineBlocks.map((b) => {
                const bi = objectSetting(b);
                return Math.max(0, Number(bi.startTime) || 0) + Math.max(0, Number(bi.duration) || 0);
              }));
              const startTime = Math.round((clickPct / 100) * currentEnd);
              setIntifaceTimelineBlocks((current) => [...current, { channel, motor, startTime, duration: timelineBaseDurationMs, label: intifacePattern }]);
            }}>
              {(timelineMotorCounts[channel] || 1) > 1 ? <span className="intiface-motor-lane-label">M{motor}</span> : null}
              {intifaceTimelineBlocks.map((block, blockIndex) => ({ block, blockIndex })).filter(({ block }) => objectSetting(block).channel === channel && Math.max(1, Number(objectSetting(block).motor) || 1) === motor).map(({ block, blockIndex }) => {
                const item = objectSetting(block);
                const startTime = Math.max(0, Number(item.startTime) || 0);
                const duration = Math.max(1, Number(item.duration) || 5000);
                const patternLabel = String(item.label || "").trim();
                const leftPct = timelineContentDurationMs > 0 ? (startTime / timelineContentDurationMs) * 100 : 0;
                const widthPct = timelineContentDurationMs > 0 ? (duration / timelineContentDurationMs) * 100 : 18;
                const blockLeftPct = Math.max(0, Math.min(100, leftPct));
                const blockWidthPct = Math.max(6, Math.min(100 - blockLeftPct, widthPct));
                return <button className="intiface-timeline-block" data-motor={motor} data-pattern={patternLabel} key={`${channel}-${blockIndex}`} style={{ left: `${blockLeftPct}%`, width: `${blockWidthPct}%`, background: "rgba(100,150,255,0.3)" }} title={`${patternLabel} | ${formatTimelineLabel(duration)} | ${channel} motor ${motor}`} type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); removeTimelineBlock(blockIndex); }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); removeTimelineBlock(blockIndex); }}>{patternLabel}</button>;
              })}
            </div>)}
            </div>
          </div>)}
          <div className="intiface-timeline-toolbar"><button className="menu_button" id="intiface-timeline-play" type="button">Play</button><button className="menu_button" id="intiface-timeline-pause" type="button">Pause</button><span>Time:</span><input id="intiface-timeline-scrubber" max={timelineContentDurationMs} min={0} type="range" defaultValue={0} /><button className="menu_button" id="intiface-timeline-clear" type="button" onClick={() => setIntifaceTimelineBlocks([])}><i className="fa-solid fa-trash" /></button></div>
          <div className="intiface-timeline-selected"><i className="fa-solid fa-hand-pointer" /> Click a pattern above, then click on a timeline track to place it</div>
        </div>
        <details className="intiface-control-card intiface-subdrawer" id="intiface-ai-modes"><summary><span><i className="fa-solid fa-robot" /> AI Play Modes</span><i className="fa-solid fa-caret-down" /></summary><small>Enable which modes AI can use:</small><div className="intiface-mode-toggle-grid" id="intiface-playmode-toggles-container">{intifaceAiModes.map((mode) => <label className="checkbox_label intiface-ai-mode-pill" key={mode.id} style={{ borderColor: mode.color, background: `${mode.color}22` }}><input checked={effectiveIntifaceAiModes.includes(mode.id)} onChange={(event) => { const current = effectiveIntifaceAiModes; const next = event.target.checked ? [...current, mode.id] : current.filter((entry) => entry !== mode.id); onSettingChange("intifaceEnabledModes", next.filter((entry, index, values) => values.indexOf(entry) === index)); if (!event.target.checked && selectedIntifaceMode === mode.id) { onSettingChange("intifaceSelectedMode", "basic"); onSettingChange("intifaceTimelinePattern", basicIntifacePatterns[0]); } }} type="checkbox" /><small><i className={`fa-solid ${mode.icon}`} style={{ color: mode.color }} /> {mode.name}</small></label>)}</div></details>
      </div></details>

      <details className="intiface-native-drawer" id="intiface-mode-builder"><summary><span><i className="fa-solid fa-wand-magic-sparkles" /> Mode Builder</span><i className="fa-solid fa-caret-down" /></summary><div className="intiface-native-drawer-content"><div className="intiface-subtitle"><i className="fa-solid fa-hammer" /> Create Custom Play Modes</div><small>Design new play modes with custom patterns and sequences.</small><div id="intiface-custom-modes-list" className="intiface-mode-builder-list">{intifaceAiModes.length ? intifaceAiModes.map((mode) => <div className="intiface-mode-builder-row" key={mode.id}><div><strong style={{ color: mode.color }}><i className={`fa-solid ${mode.icon}`} /> {mode.name}</strong><small>{mode.category} | {mode.patterns.length} patterns | {Math.round(mode.intensityMultiplier * 100)}% intensity</small></div><button className="menu_button mode-edit-btn" type="button" onClick={() => { onSettingChange("intifaceModeBuilderId", mode.id); onSettingChange("intifaceModeBuilderName", mode.name); onSettingChange("intifaceModeBuilderIcon", mode.icon); onSettingChange("intifaceModeBuilderColor", mode.color); onSettingChange("intifaceModeBuilderMultiplier", mode.intensityMultiplier); onSettingChange("intifaceSelectedMode", mode.id); }}>Edit</button></div>) : <div className="intiface-empty-box"><i className="fa-solid fa-circle-info" /> Custom modes will appear here</div>}</div><button className="menu_button" id="intiface-create-mode-btn" type="button"><i className="fa-solid fa-plus" /> Create New Mode</button><div id="intiface-mode-editor" className="intiface-builder-card"><div className="intiface-subtitle"><i className="fa-solid fa-pen-to-square" /> Edit Mode</div><input id="intiface-mode-id" type="hidden" value={stringSetting(settings, "intifaceModeBuilderId")} readOnly /><div className="intiface-builder-editors"><label>Display Name<input className="text_pole" id="intiface-mode-name" placeholder="My Custom Mode" value={stringSetting(settings, "intifaceModeBuilderName")} onChange={(event) => onSettingChange("intifaceModeBuilderName", event.target.value)} /></label><label>Personality<input className="text_pole" id="intiface-mode-personality" placeholder="e.g., Cruel, teasing, dominant" value={stringSetting(settings, "intifaceModeBuilderPersonality")} onChange={(event) => onSettingChange("intifaceModeBuilderPersonality", event.target.value)} /></label><label>Description<textarea className="text_pole" id="intiface-mode-description" placeholder="Describe what this mode does..." value={stringSetting(settings, "intifaceModeBuilderDescription")} onChange={(event) => onSettingChange("intifaceModeBuilderDescription", event.target.value)} /></label><label>System Prompt<textarea className="text_pole" id="intiface-mode-system-prompt" placeholder="You are a..." value={stringSetting(settings, "intifaceModeBuilderSystemPrompt")} onChange={(event) => onSettingChange("intifaceModeBuilderSystemPrompt", event.target.value)} /></label><label>Icon (FontAwesome class)<select className="text_pole" id="intiface-mode-icon" value={stringSetting(settings, "intifaceModeBuilderIcon", "fa-star")} onChange={(event) => onSettingChange("intifaceModeBuilderIcon", event.target.value)}>{["fa-star", "fa-heart", "fa-bolt", "fa-fire", "fa-moon", "fa-cloud-moon", "fa-robot", "fa-wave-square", "fa-magic", "fa-hurricane", "fa-skull", "fa-crown", "fa-gem", "fa-music", "fa-bullseye"].map((icon) => <option key={icon} value={icon}>{icon.replace("fa-", "")}</option>)}</select></label><label>Color<input id="intiface-mode-color" type="color" value={stringSetting(settings, "intifaceModeBuilderColor", "#6464ff")} onChange={(event) => onSettingChange("intifaceModeBuilderColor", event.target.value)} /></label></div><div className="intiface-slider-row"><label>Intensity Multiplier</label><input id="intiface-mode-multiplier" max={2} min={0.5} step={0.1} type="range" value={numberSetting(settings, "intifaceModeBuilderMultiplier", 1)} onChange={(event) => updateNumber("intifaceModeBuilderMultiplier", event.target.value, 0.5, 2, 1)} /><span>{numberSetting(settings, "intifaceModeBuilderMultiplier", 1).toFixed(1)}x</span></div><div className="intiface-subtitle"><i className="fa-solid fa-wave-square" /> Waveform Patterns</div><div id="intiface-patterns-list" className="intiface-empty-box">Dynamic pattern entries</div><button className="menu_button" id="intiface-add-pattern-btn" type="button"><i className="fa-solid fa-plus" /> Add Pattern</button><div className="intiface-subtitle"><i className="fa-solid fa-list-ol" /> Sequences</div><div id="intiface-sequences-list" className="intiface-empty-box">Dynamic sequence entries</div><button className="menu_button" id="intiface-add-sequence-btn" type="button"><i className="fa-solid fa-plus" /> Add Sequence</button><div className="intiface-action-row"><button className="menu_button" id="intiface-save-mode-btn" type="button"><i className="fa-solid fa-save" /> Save Mode</button><button className="menu_button" id="intiface-cancel-mode-btn" type="button"><i className="fa-solid fa-times" /> Cancel</button></div><small><i className="fa-solid fa-info-circle" /> Custom modes are stored in your browser. Export to save permanently.</small></div><div className="intiface-action-row"><button className="menu_button" id="intiface-export-modes-btn" type="button"><i className="fa-solid fa-download" /> Export All</button><button className="menu_button" id="intiface-import-modes-btn" type="button"><i className="fa-solid fa-upload" /> Import</button><input accept=".json" id="intiface-import-file" type="file" hidden /></div></div></details>

      <details className="intiface-native-drawer" id="intiface-media-menu"><summary><span><i className="fa-solid fa-film" /> Media Library</span><i className="fa-solid fa-caret-down" /></summary><div className="intiface-native-drawer-content"><div className="intiface-media-toolbar"><input className="text_pole" id="intiface-menu-media-search" placeholder="Search media..." value={stringSetting(settings, "intifaceMediaSearch")} onChange={(event) => { onSettingChange("intifaceMediaSearch", event.target.value); localStorage.setItem("intiface-media-search", event.target.value); }} /><select className="text_pole" id="intiface-menu-media-type" value={stringSetting(settings, "intifaceMediaType", "all")} onChange={(event) => { onSettingChange("intifaceMediaType", event.target.value); localStorage.setItem("intiface-media-type", event.target.value); }}><option value="all">All</option><option value="video">Video</option><option value="audio">Audio</option></select><select className="text_pole" id="intiface-menu-media-sort" value={stringSetting(settings, "intifaceMediaSort", "name-asc")} onChange={(event) => { onSettingChange("intifaceMediaSort", event.target.value); localStorage.setItem("intiface-media-sort", event.target.value); }}><option value="name-asc">A-Z</option><option value="name-desc">Z-A</option><option value="date-desc">Newest</option><option value="date-asc">Oldest</option><option value="size-desc">Size (largest)</option><option value="size-asc">Size (smallest)</option><option value="duration-desc">Length (longest)</option><option value="duration-asc">Length (shortest)</option></select><button className="menu_button" id="intiface-menu-refresh-media-btn" type="button" onClick={() => refreshIntifaceAssets().catch(() => undefined)}><i className="fa-solid fa-rotate" /></button></div><div id="intiface-menu-media-list" className="intiface-list-box intiface-media-list">{visibleMedia.length ? visibleMedia.map((asset) => { const size = formatAssetSize(asset.size); const date = formatAssetDate(asset.updatedAt); return <div className="intiface-list-row intiface-media-row menu-media-file-item" key={asset.url} data-filename={asset.name}><span><i className={`fa-solid ${mediaIconFor(asset.name)}`} /> {asset.name}</span><small>{[size, date].filter(Boolean).join(" | ")}</small></div>; }) : <div className="intiface-empty-box">Click refresh to load media files</div>}</div><div className="intiface-help-box intiface-media-help"><strong>Folders:</strong><br />Media: <code>data/default-user/assets/intiface/media/</code><br />Funscripts: <code>data/default-user/assets/intiface/funscript/</code><br />Playmodes: <code>data/default-user/assets/intiface/playmodes/</code><br /><em>Supports: MP4, WebM, MKV, AVI, MOV + MP3, WAV, OGG, FLAC, M4A<br />Funscripts must match media filenames</em></div></div></details>

      <details className="intiface-native-drawer" id="intiface-funscript-editor"><summary><span><i className="fa-solid fa-pen-ruler" /> Funscript Editor</span><i className="fa-solid fa-caret-down" /></summary><div className="intiface-native-drawer-content"><div className="intiface-media-toolbar"><select className="text_pole" id="intiface-funscript-editor-file" value={stringSetting(settings, "intifaceSelectedFunscript")} onChange={(event) => onSettingChange("intifaceSelectedFunscript", event.target.value)}><option value="">Select a funscript...</option>{intifaceInventory.funscripts.map((asset) => <option key={asset.url} value={asset.url}>{asset.name}</option>)}</select><button className="menu_button" id="intiface-funscript-editor-refresh" type="button" onClick={() => refreshIntifaceAssets().catch(() => undefined)}><i className="fa-solid fa-rotate" /></button><button className="menu_button" id="intiface-funscript-editor-load" type="button">Load</button></div><div className="intiface-wave-box"><div className="intiface-playmode-header"><span>Before + Draft Overlay</span><span><i className="fa-solid fa-minus" /> Before <i className="fa-solid fa-minus" /> Draft/Current</span></div><canvas id="intiface-funscript-wave-compare" width={520} height={140} /></div><div className="intiface-action-row"><button className="menu_button" disabled id="intiface-funscript-editor-accept" type="button"><i className="fa-solid fa-check" /> Save Draft</button><button className="menu_button" disabled id="intiface-funscript-editor-discard" type="button"><i className="fa-solid fa-xmark" /> Discard Draft</button><button className="menu_button" id="intiface-funscript-editor-toggle-json" type="button"><i className="fa-solid fa-code" /> Show JSON</button></div><textarea className="text_pole intiface-json-editor" id="intiface-funscript-editor-json" placeholder="Load a funscript to edit JSON..." value={stringSetting(settings, "intifaceFunscriptJson")} onChange={(event) => onSettingChange("intifaceFunscriptJson", event.target.value)} spellCheck={false} /><div className="intiface-control-card"><label>Programmatic Tools</label><div className="intiface-builder-editors">{[["smooth", "Smooth", "intifaceFunscriptSmoothWindow", 5], ["scale", "Scale %", "intifaceFunscriptScalePercent", 100], ["shift", "Shift ms", "intifaceFunscriptShiftMs", 0], ["decimate", "Decimate gap ms", "intifaceFunscriptDecimateGapMs", 40]].map(([id, label, key, fallback]) => <label className="checkbox_label" key={String(id)}><input checked={boolSetting(settings, `intifaceFunscriptUse${String(id)[0].toUpperCase()}${String(id).slice(1)}`, ["smooth", "decimate"].includes(String(id)))} onChange={(event) => onSettingChange(`intifaceFunscriptUse${String(id)[0].toUpperCase()}${String(id).slice(1)}`, event.target.checked)} type="checkbox" /><small>{String(label)}</small><input className="text_pole" type="number" value={numberSetting(settings, String(key), Number(fallback))} onChange={(event) => onSettingChange(String(key), Number(event.target.value) || 0)} /></label>)}</div><div className="intiface-media-toolbar"><select className="text_pole" id="intiface-funscript-editor-device-profile" value={stringSetting(settings, "intifaceFunscriptDeviceProfile", "auto")} onChange={(event) => onSettingChange("intifaceFunscriptDeviceProfile", event.target.value)}><option value="auto">Auto (connected device)</option><option value="linear">Linear / Stroker</option><option value="vibrate">Vibrator</option><option value="oscillate">Oscillator</option><option value="plug">Plug (thrusty/impact)</option><option value="cage">Cage (teasing/deny)</option><option value="general">General</option></select><button className="menu_button" id="intiface-funscript-editor-apply-optimize" type="button"><i className="fa-solid fa-gauge-high" /> Apply</button></div><div className="intiface-slider-row"><label>Tuning Strength</label><input id="intiface-funscript-editor-optimize-intensity" max={180} min={50} type="range" value={numberSetting(settings, "intifaceFunscriptOptimizeIntensity", 100)} onChange={(event) => updateNumber("intifaceFunscriptOptimizeIntensity", event.target.value, 50, 180, 100)} /><span>{numberSetting(settings, "intifaceFunscriptOptimizeIntensity", 100)}%</span></div></div><label>AI Edit Instructions<textarea className="text_pole" id="intiface-funscript-editor-ai-instructions" placeholder="e.g. smooth the first 30 seconds, reduce peaks over 85, add gentle lead-in" value={stringSetting(settings, "intifaceFunscriptAiInstructions")} onChange={(event) => onSettingChange("intifaceFunscriptAiInstructions", event.target.value)} /></label><div className="intiface-action-row"><button className="menu_button" id="intiface-funscript-editor-format" type="button"><i className="fa-solid fa-wand-magic-sparkles" /> Format</button><button className="menu_button" id="intiface-funscript-editor-ai-edit" type="button"><i className="fa-solid fa-wand-magic-sparkles" /> AI Edit</button><button className="menu_button" id="intiface-funscript-editor-save" type="button"><i className="fa-solid fa-save" /> Save</button></div><div id="intiface-funscript-editor-status">Editor ready</div></div></details>

      <details className="intiface-native-drawer" id="intiface-playback-settings"><summary><span><i className="fa-solid fa-chart-line" /> Playback Settings</span><i className="fa-solid fa-caret-down" /></summary><div className="intiface-native-drawer-content"><div className="intiface-control-card"><div className="intiface-subtitle"><i className="fa-solid fa-sliders" /> Sync Settings</div>{[["intifaceMenuSyncOffsetMs", "intiface-menu-sync-offset", "Sync Offset", -5000, 5000, 0, "ms"], ["intifaceMenuIntensity", "intiface-menu-intensity", "Intensity (0-400%)", 0, 400, 100, "%"], ["intifaceGlobalIntensity", "intiface-global-intensity", "Global Intensity", 10, 400, 100, "%"], ["intifacePollingRateHz", "intiface-polling-rate", "Polling Rate (Hz)", 10, 60, 30, "Hz"], ["intifaceMenuVideoOpacity", "intiface-menu-video-opacity", "Video Opacity", 20, 100, 100, "%"], ["intifaceMenuWidth", "intiface-menu-width", "Player Scale", 20, 100, 100, "%"], ["intifaceMenuZIndex", "intiface-menu-zindex", "Z-Index (stacking order)", 1, 100, 1, ""]].map(([key, id, label, min, max, fallback, suffix]) => <div className="intiface-slider-row" key={String(key)}><label htmlFor={String(id)}>{String(label)}</label><input id={String(id)} max={Number(max)} min={Number(min)} type="range" value={numberSetting(settings, String(key), Number(fallback))} onChange={(event) => updateNumber(String(key), event.target.value, Number(min), Number(max), Number(fallback))} /><span>{numberSetting(settings, String(key), Number(fallback))}{String(suffix)}</span></div>)}<label className="checkbox_label" htmlFor="intiface-menu-loop"><input checked={boolSetting(settings, "intifaceMenuLoop")} id="intiface-menu-loop" onChange={(event) => onSettingChange("intifaceMenuLoop", event.target.checked)} type="checkbox" /><small><i className="fa-solid fa-repeat" /> Loop video</small></label><label className="checkbox_label" htmlFor="intiface-global-invert"><input checked={boolSetting(settings, "intifaceGlobalInvert")} id="intiface-global-invert" onChange={(event) => onSettingChange("intifaceGlobalInvert", event.target.checked)} type="checkbox" /><small>Invert All Device Output (0% {"<->"} 100%)</small></label><label>Player Position<select className="text_pole" id="intiface-menu-position" value={stringSetting(settings, "intifaceMenuPosition", "top")} onChange={(event) => onSettingChange("intifaceMenuPosition", event.target.value)}><option value="top">Top of chat</option><option value="center">Center screen</option></select></label><button className="menu_button" id="intiface-reset-appearance-btn" type="button"><i className="fa-solid fa-rotate-left" /> Reset to defaults</button></div></div></details>

      <details className="intiface-native-drawer" id="intiface-advanced-configuration"><summary><span><i className="fa-solid fa-screwdriver-wrench" /> Advanced Configuration</span><i className="fa-solid fa-caret-down" /></summary><div className="intiface-native-drawer-content"><div className="intiface-subtitle">Intiface WebSocket</div><small>Start Intiface Central or Intiface Engine, then connect to its WebSocket address. Default: 127.0.0.1:12345.</small></div></details>
    </div>;
});
