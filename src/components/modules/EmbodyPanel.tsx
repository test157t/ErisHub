import { memo, useEffect, useState, type ReactNode } from "react";
import type { PromptProfile } from "../../../shared/types";
import type { ModuleSettingChange, ModuleSettings } from "./types";

type EmbodyPanelProps = {
  onError: (message: string) => void;
  onMicLevelTest: () => void;
  onSettingChange: ModuleSettingChange;
  panel?: "voiceforge" | "callmode";
  promptProfiles: PromptProfile[];
  settings: ModuleSettings;
};

type SectionProps = {
  children: ReactNode;
  defaultOpen?: boolean;
  id: string;
  title: string;
};

type VoiceForgeDiscovery = {
  audioPrompts: Array<{ name: string; path?: string }>;
  rvcModels: string[];
  backgroundTracks: Array<{ name: string; path: string }>;
  modules: Record<string, unknown>;
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

function promptDataFromUnknown(value: unknown): Array<{ name: string; path?: string }> {
  const data = objectSetting(value);
  const prompts = Array.isArray(data.prompts) ? data.prompts : [];
  return prompts.map((prompt) => {
    if (typeof prompt === "string") return { name: prompt };
    const item = objectSetting(prompt);
    const name = String(item.name || item.filename || item.path || "").trim();
    return name ? { name, path: typeof item.path === "string" ? item.path : undefined } : null;
  }).filter((item): item is { name: string; path?: string } => Boolean(item));
}

function trackDataFromUnknown(value: unknown): Array<{ name: string; path: string }> {
  const data = objectSetting(value);
  const tracks = Array.isArray(data.files) ? data.files : Array.isArray(data.tracks) ? data.tracks : Array.isArray(value) ? value : [];
  return tracks.map((track) => {
    if (typeof track === "string") return { name: track.split(/[\\/]/).pop()?.replace(/\.[^/.]+$/, "") || track, path: track };
    const item = objectSetting(track);
    const path = String(item.path || item.url || item.file || "").trim();
    const name = String(item.name || item.filename || path.split(/[\\/]/).pop()?.replace(/\.[^/.]+$/, "") || "").trim();
    return path ? { name: name || path, path } : null;
  }).filter((item): item is { name: string; path: string } => Boolean(item));
}

const defaultRvcSettings: Record<string, unknown> = {
  pitch_algo: "rmvpe",
  pitch_level: 0,
  index_influence: 0.75,
  respiration_median_filtering: 3,
  envelope_ratio: 0.25,
  consonant_breath_protection: 0.5
};

const defaultPostSettings: Record<string, unknown> = {
  asmr_enabled: false,
  asmr_breathiness: 60,
  asmr_mouth_detail: 25,
  asmr_tingles: 30,
  asmr_crispness: 35,
  asmr_warmth: 20,
  asmr_intimacy: 20,
  asmr_softness: 15,
  highpass: 0,
  lowpass: 0,
  bass_freq: 120,
  bass_gain: 0,
  treble_freq: 6000,
  treble_gain: 0,
  reverb_delay: 0,
  reverb_decay: 0,
  crystalizer: 0,
  deesser: 0,
  audio_8d_enabled: false,
  audio_8d_mode: "center",
  audio_8d_quality: "balanced",
  audio_8d_speed: 0.08,
  audio_8d_depth: 90,
  audio_8d_distance: 0.25
};

const disabledVoiceMarker = "disabled";
const defaultVoiceMarker = "[Default Voice]";

function agentImportKey(key: string, promptProfiles: PromptProfile[]) {
  const normalized = key.trim().toLowerCase();
  if (!normalized) return key;
  if (key === defaultVoiceMarker || key === disabledVoiceMarker) return key;
  return promptProfiles.find((profile) => [profile.id, profile.name, profile.assistantName].filter(Boolean).some((value) => String(value).trim().toLowerCase() === normalized))?.id || key;
}

function normalizeImportedAgentMap(value: Record<string, unknown>, promptProfiles: PromptProfile[]) {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [agentImportKey(key, promptProfiles), entry]));
}

function extractVoiceMapImport(value: Record<string, unknown>) {
  const tts = objectSetting(value.tts);
  const voiceForgeTts = objectSetting(tts.VoiceForge || tts.voiceforge);
  const voiceForgeRoot = objectSetting(value.VoiceForge || value.voiceforge);
  if (voiceForgeTts.voiceMap) return objectSetting(voiceForgeTts.voiceMap);
  if (voiceForgeRoot.voiceMap) return objectSetting(voiceForgeRoot.voiceMap);
  if (value.voiceMap) return objectSetting(value.voiceMap);
  if (value.voiceforgeVoiceMap) return objectSetting(value.voiceforgeVoiceMap);
  return value;
}

const kokoroVoices = [
  { name: "af_sarah", label: "Sarah (Female US)" },
  { name: "af_bella", label: "Bella (Female US)" },
  { name: "af_heart", label: "Heart (Female US)" },
  { name: "af_nicole", label: "Nicole (Female US)" },
  { name: "af_sky", label: "Sky (Female US)" },
  { name: "am_michael", label: "Michael (Male US)" },
  { name: "am_echo", label: "Echo (Male US)" },
  { name: "am_onyx", label: "Onyx (Male US)" },
  { name: "am_fable", label: "Fable (Male US)" },
  { name: "am_puck", label: "Puck (Male US)" },
  { name: "am_sage", label: "Sage (Male US)" },
  { name: "bf_emma", label: "Emma (Female UK)" },
  { name: "bf_isabella", label: "Isabella (Female UK)" },
  { name: "bf_alice", label: "Alice (Female UK)" },
  { name: "bm_george", label: "George (Male UK)" },
  { name: "bm_lewis", label: "Lewis (Male UK)" },
  { name: "bm_daniel", label: "Daniel (Male UK)" }
];

function Section({ children, defaultOpen = false, id, title }: SectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return <details className="voiceforge-section native-voiceforge-section" open={isOpen} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
    <summary className="voiceforge-section-header" id={`${id}_header`}><span>{title}</span><i className="fa-solid fa-chevron-down" /></summary>
    <div className="voiceforge-section-content" id={`${id}_content`}>{children}</div>
  </details>;
}

function Subsection({ children, defaultOpen = false, id, title }: SectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return <details className="voiceforge-subsection" open={isOpen} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
    <summary className="voiceforge-subsection-header" id={`${id}_header`}><span>{title}</span><i className="fa-solid fa-chevron-down" /></summary>
    <div className="voiceforge-subsection-content" id={`${id}_content`}>{children}</div>
  </details>;
}

const VoiceForgeCallModePanel = memo(function VoiceForgeCallModePanel({ onError, onMicLevelTest, onSettingChange, panel, promptProfiles, settings }: EmbodyPanelProps) {
  const [activeTab, setActiveTab] = useState<"voiceforge" | "callmode">("voiceforge");
  const selectedTab = panel ?? activeTab;
  const [status, setStatus] = useState("");
  const [connectionState, setConnectionState] = useState<"idle" | "checking" | "connected" | "error">("idle");
  const [discovery, setDiscovery] = useState<VoiceForgeDiscovery>({ audioPrompts: [], rvcModels: [], backgroundTracks: [], modules: {} });
  const voiceMap = objectSetting(settings.voiceforgeVoiceMap);
  const voiceMapJson = JSON.stringify(voiceMap, null, 2);

  const updateNumber = (key: string, value: string, min: number, max: number, fallback: number) => {
    const raw = Number(value);
    const next = Math.max(min, Math.min(max, Number.isFinite(raw) ? raw : fallback));
    onSettingChange(key, next);
  };
  const updateVoiceMap = (value: string) => {
    try {
      const parsed = extractVoiceMapImport(JSON.parse(value || "{}"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Voice map must be a JSON object.");
      onSettingChange("voiceforgeVoiceMap", normalizeImportedAgentMap(parsed, promptProfiles));
    } catch (error) {
      onError(error instanceof Error ? error.message : "Voice map JSON is invalid.");
    }
  };
  const updateAgentVoice = (agentId: string, key: string, value: unknown) => {
    const current = objectSetting(voiceMap[agentId]);
    onSettingChange("voiceforgeVoiceMap", { ...voiceMap, [agentId]: { ...current, [key]: value } });
  };
  const updateAgentBackend = (agentId: string, backend: string) => {
    const current = objectSetting(voiceMap[agentId]);
    const next: Record<string, unknown> = { ...current, tts_backend: backend };
    if (backend === "kokoro" && (!next.kokoro_voice || next.kokoro_voice === defaultVoiceMarker || next.kokoro_voice === disabledVoiceMarker)) {
      next.kokoro_voice = kokoroVoices[0].name;
    }
    if (backend === "pocket_tts" && (!next.pocket_tts_voice || next.pocket_tts_voice === defaultVoiceMarker || next.pocket_tts_voice === disabledVoiceMarker)) {
      next.pocket_tts_voice = "alba";
    }
    onSettingChange("voiceforgeVoiceMap", { ...voiceMap, [agentId]: next });
  };
  const updateAgentNested = (agentId: string, group: "rvc" | "post", key: string, value: unknown) => {
    const current = objectSetting(voiceMap[agentId]);
    const defaults = group === "rvc" ? defaultRvcSettings : defaultPostSettings;
    const nested = { ...defaults, ...objectSetting(current[group]) };
    onSettingChange("voiceforgeVoiceMap", { ...voiceMap, [agentId]: { ...current, [group]: { ...nested, [key]: value } } });
  };
  const updateAgentTrack = (agentId: string, index: number, key: string, value: unknown) => {
    const current = objectSetting(voiceMap[agentId]);
    const tracks = Array.isArray(current.bg_tracks) ? [...current.bg_tracks] : [];
    tracks[index] = { ...(objectSetting(tracks[index])), [key]: value };
    onSettingChange("voiceforgeVoiceMap", { ...voiceMap, [agentId]: { ...current, bg_tracks: tracks } });
  };
  const addAgentTrack = (agentId: string) => {
    const current = objectSetting(voiceMap[agentId]);
    const tracks = Array.isArray(current.bg_tracks) ? [...current.bg_tracks] : [];
    tracks.push({ path: "", volume: 0.5, delay: 0, fade_in: 2, fade_out: 2 });
    onSettingChange("voiceforgeVoiceMap", { ...voiceMap, [agentId]: { ...current, bg_tracks: tracks } });
  };
  const removeAgentTrack = (agentId: string, index: number) => {
    const current = objectSetting(voiceMap[agentId]);
    const tracks = Array.isArray(current.bg_tracks) ? [...current.bg_tracks] : [];
    tracks.splice(index, 1);
    onSettingChange("voiceforgeVoiceMap", { ...voiceMap, [agentId]: { ...current, bg_tracks: tracks } });
  };
  const clearAgentVoice = (agentId: string) => {
    const next = { ...voiceMap };
    delete next[agentId];
    onSettingChange("voiceforgeVoiceMap", next);
  };
  const testVoiceForge = async () => {
    const endpoint = stringSetting(settings, "voiceforgeProviderEndpoint").replace(/\/+$/, "");
    setConnectionState("checking");
    setStatus("Connecting...");
    try {
      const response = await fetch("/api/modules/voiceforge/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.success === false) throw new Error(String(data?.error || "VoiceForge discovery failed."));
      const modules = objectSetting(data.modules);
      setDiscovery({
        audioPrompts: Array.isArray(data.audioPrompts) ? data.audioPrompts : [],
        rvcModels: Array.isArray(data.rvcModels) ? data.rvcModels.map(String) : [],
        backgroundTracks: Array.isArray(data.backgroundTracks) ? data.backgroundTracks : [],
        modules
      });
      setConnectionState("connected");
      setStatus("Connected to VoiceForge");
    } catch (error) {
      const message = error instanceof Error ? error.message : "VoiceForge connection failed.";
      setConnectionState("error");
      setStatus(message);
      onError(message);
    }
  };
  useEffect(() => {
    if (selectedTab === "voiceforge" && boolSetting(settings, "voiceforgeAutoConnect", true)) testVoiceForge().catch(() => undefined);
  }, [selectedTab]);
  const moduleStatusItems = [
    ["pocket_tts", "Pocket TTS"],
    ["kokoro", "Kokoro"],
    ["rvc", "RVC"],
    ["postprocess", "Post-Process"]
  ].map(([key, label]) => `${discovery.modules[key] ? "✓" : "✗"} ${label}`);

  return <div className="embody-panel embody-native-panel embody-upstream-panel">
    {!panel ? <div className="embody-tabs">
      <button className={`menu_button embody-tab ${activeTab === "voiceforge" ? "active" : ""}`} type="button" onClick={() => setActiveTab("voiceforge")}>VoiceForge</button>
      <button className={`menu_button embody-tab ${activeTab === "callmode" ? "active" : ""}`} type="button" onClick={() => setActiveTab("callmode")}>Call Mode</button>
    </div> : null}

    {selectedTab === "voiceforge" ? <div id="embody-voiceforge-panel" className="embody-tab-panel active">
      <div id="voiceforge_connection_mount" className="voiceforge-main-panel">
        <div id="tts_status" className={`voiceforge-connection-status ${connectionState}`}><span className="voiceforge-status-dot">●</span> {status || "Not connected to VoiceForge"}</div>
        {connectionState === "connected" ? <small className="voiceforge-modules-status">{moduleStatusItems.join(" | ")}</small> : null}
        {connectionState === "connected" ? <small className="voiceforge-discovery-status">Prompts: {discovery.audioPrompts.length} | RVC models: {discovery.rvcModels.length} | Voice backgrounds: {discovery.backgroundTracks.length}</small> : null}
        <div className="voiceforge-connect-row"><label>VoiceForge Server URL:<input className="text_pole" placeholder="https://voiceforge.example:8888" value={stringSetting(settings, "voiceforgeProviderEndpoint")} onChange={(event) => onSettingChange("voiceforgeProviderEndpoint", event.target.value)} /><small className="text_muted">VoiceForge server must be running</small></label>
        <button className="menu_button voiceforge-connect-button" disabled={connectionState === "checking"} type="button" onClick={() => testVoiceForge().catch(() => undefined)}>Connect</button></div>
        <label className="checkbox_label voiceforge-connect-toggle" htmlFor="voiceforge_auto_connect"><input checked={boolSetting(settings, "voiceforgeAutoConnect", true)} id="voiceforge_auto_connect" onChange={(event) => onSettingChange("voiceforgeAutoConnect", event.target.checked)} type="checkbox" /><small>Auto-connect on startup</small></label>
      </div>
      <Section id="tts_provider" title="Generation Settings">
        <form id="tts_provider_settings">
          <div className="voiceforge-provider-settings">
            <label>Chunk Size<input className="text_pole" min={3} max={100} type="number" value={numberSetting(settings, "voiceforgeChunkSize", 12)} onChange={(event) => updateNumber("voiceforgeChunkSize", event.target.value, 3, 100, 12)} /></label>
            <label>Seed<input className="text_pole" type="number" value={numberSetting(settings, "voiceforgeSeed", 0)} onChange={(event) => onSettingChange("voiceforgeSeed", Number(event.target.value) || 0)} /></label>
          </div>
        </form>
        <label className="checkbox_label" htmlFor="tts_enabled"><input checked={boolSetting(settings, "voiceforgeEnabled")} id="tts_enabled" onChange={(event) => onSettingChange("voiceforgeEnabled", event.target.checked)} type="checkbox" /><small>Enabled</small></label>
        <label className="checkbox_label" htmlFor="tts_auto_generation"><input checked={boolSetting(settings, "voiceforgeAutoGeneration")} id="tts_auto_generation" onChange={(event) => onSettingChange("voiceforgeAutoGeneration", event.target.checked)} type="checkbox" /><small>Auto Generation</small></label>
      </Section>
      <Section defaultOpen={false} id="voiceforge_background_audio" title="Background Audio">
        <div className="audio-ui-block">
          <label>VoiceForge TTS Background Audio</label>
          <div className="audio-container voiceforge-bg-audio-container">
            <div className="audio-volume"><input className="audio-slider" id="callmode_audio_voiceforge_bg_volume_slider" max={100} min={0} type="range" value={numberSetting(settings, "audioVoiceForgeBackgroundVolume", 30)} onChange={(event) => updateNumber("audioVoiceForgeBackgroundVolume", event.target.value, 0, 100, 30)} /><span className="audio-volume-label">{numberSetting(settings, "audioVoiceForgeBackgroundVolume", 30)}</span></div>
            <button className="menu_button audio-player-button" type="button">Stop Background</button>
          </div>
          <label className="checkbox_label" htmlFor="callmode_audio_voiceforge_bg_persist"><input checked={boolSetting(settings, "audioVoiceForgeBackgroundPersist", true)} id="callmode_audio_voiceforge_bg_persist" onChange={(event) => onSettingChange("audioVoiceForgeBackgroundPersist", event.target.checked)} type="checkbox" /><small>Keep playing until voice changes</small></label>
        </div>
      </Section>
      <Section defaultOpen={false} id="tts_voicemap" title="Agent Voice Map">
        <div className="voiceforge-map-tools"><button className="menu_button" type="button" onClick={() => navigator.clipboard?.writeText(voiceMapJson).catch(() => undefined)}>Export Map</button><button className="menu_button" type="button" onClick={() => navigator.clipboard?.readText().then(updateVoiceMap).catch(() => onError("Could not import voice map from clipboard."))}>Import Map</button></div>
        <small className="text_muted">Voice mappings are keyed by ErisHub agent id. Import replaces the native map after JSON validation.</small>
        <div id="tts_voicemap_block" className="embody-agent-voice-list">
          {promptProfiles.length === 0 ? <p className="empty-state">No agents available.</p> : null}
          {promptProfiles.map((profile) => {
            const entry = objectSetting(voiceMap[profile.id]);
            const rvc = { ...defaultRvcSettings, ...objectSetting(entry.rvc) };
            const post = { ...defaultPostSettings, ...objectSetting(entry.post) };
            const tracks = Array.isArray(entry.bg_tracks) ? entry.bg_tracks : [];
            const backend = String(entry.tts_backend || settings.voiceforgeTtsBackend || "omnivoice");
            const selectedPrompt = String(entry.audio_prompt || entry.omnivoice_voice || defaultVoiceMarker);
            const selectedRvcModel = String(entry.rvc_model || "");
            const selectedPocketVoice = String(entry.pocket_tts_voice || defaultVoiceMarker);
            const selectedKokoroVoice = String(entry.kokoro_voice || defaultVoiceMarker);
            const promptOptions = [defaultVoiceMarker, disabledVoiceMarker, ...discovery.audioPrompts.map((prompt) => prompt.name), ...(selectedPrompt && ![defaultVoiceMarker, disabledVoiceMarker].includes(selectedPrompt) ? [selectedPrompt] : [])].filter((value, index, values) => values.indexOf(value) === index);
            const rvcOptions = ["", ...discovery.rvcModels, ...(selectedRvcModel && !discovery.rvcModels.includes(selectedRvcModel) ? [selectedRvcModel] : [])];
            const pocketOptions = [defaultVoiceMarker, disabledVoiceMarker, "alba", "marius", "javert", "jean", "fantine", "cosette", "eponine", "azelma", ...(selectedPocketVoice && ![defaultVoiceMarker, disabledVoiceMarker, "alba", "marius", "javert", "jean", "fantine", "cosette", "eponine", "azelma"].includes(selectedPocketVoice) ? [selectedPocketVoice] : [])];
            const kokoroOptions = [defaultVoiceMarker, disabledVoiceMarker, ...kokoroVoices.map((voice) => voice.name), ...(selectedKokoroVoice && ![defaultVoiceMarker, disabledVoiceMarker, ...kokoroVoices.map((voice) => voice.name)].includes(selectedKokoroVoice) ? [selectedKokoroVoice] : [])];
            const discoveredTrackPaths = discovery.backgroundTracks.map((track) => track.path);
            return <details className="voiceforge-voice-entry embody-agent-voice-card" key={profile.id}>
              <summary className="voice-header"><span className="voice-name">{profile.assistantName || profile.name}</span><div className="voice-header-buttons"><button className="menu_button" type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); navigator.clipboard?.writeText(JSON.stringify(entry, null, 2)).catch(() => undefined); }}>Copy</button><button className="menu_button" type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); navigator.clipboard?.readText().then((text) => { const parsed = JSON.parse(text); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid voice settings."); onSettingChange("voiceforgeVoiceMap", { ...voiceMap, [profile.id]: parsed }); }).catch((error) => onError(error instanceof Error ? error.message : "Could not paste voice settings.")); }}>Paste</button><button className="menu_button" type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); clearAgentVoice(profile.id); }}>Clear</button></div></summary>
              <div className="voice-content">
                <div className="voice-section">
                  <div className="voice-settings">
                    <label>TTS Backend:<select className="text_pole" value={backend} onChange={(event) => updateAgentBackend(profile.id, event.target.value)}><option value="pocket_tts">Pocket TTS</option><option value="kokoro">Kokoro</option><option value="omnivoice">OmniVoice</option></select></label>
                    {backend === "omnivoice" ? <label>Voice Prompt:<select className="text_pole" value={selectedPrompt} onChange={(event) => updateAgentVoice(profile.id, "audio_prompt", event.target.value)}>{promptOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label> : null}
                    {backend === "pocket_tts" ? <label>Voice:<select className="text_pole" value={selectedPocketVoice} onChange={(event) => updateAgentVoice(profile.id, "pocket_tts_voice", event.target.value)}>{pocketOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label> : null}
                    {backend === "kokoro" ? <label>Voice:<select className="text_pole" value={selectedKokoroVoice} onChange={(event) => updateAgentVoice(profile.id, "kokoro_voice", event.target.value)}>{kokoroOptions.map((option) => <option key={option} value={option}>{kokoroVoices.find((voice) => voice.name === option)?.label || option}</option>)}</select></label> : null}
                    <label>RVC Model:<select className="text_pole" value={selectedRvcModel} onChange={(event) => updateAgentVoice(profile.id, "rvc_model", event.target.value || null)}>{rvcOptions.map((option) => <option key={option || "none"} value={option}>{option || "None"}</option>)}</select></label>
                  </div>
                  <div className="voice-toggles">
                    <label title="Apply RVC voice conversion"><input checked={entry.enable_rvc !== false} onChange={(event) => updateAgentVoice(profile.id, "enable_rvc", event.target.checked)} type="checkbox" /><span>RVC</span></label>
                    <label title="Apply post-processing effects"><input checked={entry.enable_post !== false} onChange={(event) => updateAgentVoice(profile.id, "enable_post", event.target.checked)} type="checkbox" /><span>Post-FX</span></label>
                    <label title="Blend background audio"><input checked={entry.enable_background === true} onChange={(event) => updateAgentVoice(profile.id, "enable_background", event.target.checked)} type="checkbox" /><span>Background</span></label>
                  </div>
                </div>
                <details className="voice-section-collapsible"><summary className="section-header">RVC Parameters</summary><div className="section-content post-sliders"><label>Pitch Algorithm:<select className="text_pole" value={String(rvc.pitch_algo)} onChange={(event) => updateAgentNested(profile.id, "rvc", "pitch_algo", event.target.value)}><option value="pm">pm</option><option value="harvest">harvest</option><option value="dio">dio</option><option value="crepe">crepe</option><option value="mangio-crepe">mangio-crepe</option><option value="rmvpe">rmvpe</option><option value="rmvpe+">rmvpe+</option><option value="mangio-crepe+">mangio-crepe+</option></select></label>{[["pitch_level", "Pitch Level", -24, 24, 1], ["index_influence", "Index Influence", 0, 1, 0.01], ["envelope_ratio", "Envelope Ratio", 0, 1, 0.01], ["consonant_breath_protection", "Breath Protection", 0, 1, 0.01]].map(([key, label, min, max, step]) => <label className="post-slider-row" key={String(key)}>{label}:<input min={Number(min)} max={Number(max)} step={Number(step)} type="range" value={Number(rvc[String(key)] ?? 0)} onChange={(event) => updateAgentNested(profile.id, "rvc", String(key), Number(event.target.value))} /><span className="slider-value">{String(rvc[String(key)] ?? 0)}</span></label>)}<label>Respiration Filter:<input className="text_pole" min={0} max={99} type="number" value={Number(rvc.respiration_median_filtering ?? 3)} onChange={(event) => updateAgentNested(profile.id, "rvc", "respiration_median_filtering", Number(event.target.value) || 0)} /></label></div></details>
                <details className="voice-section-collapsible"><summary className="section-header">Background Tracks</summary><div className="section-content"><div className="bg-tracks-list">{tracks.map((track, index) => { const item = objectSetting(track); const selectedPath = String(item.path || ""); const trackOptions = ["", ...discovery.backgroundTracks.map((trackOption) => trackOption.path), ...(selectedPath && !discoveredTrackPaths.includes(selectedPath) ? [selectedPath] : [])]; return <div className="voiceforge-bg-track" key={index}><label>Track<select className="text_pole" value={selectedPath} onChange={(event) => updateAgentTrack(profile.id, index, "path", event.target.value)}>{trackOptions.map((option) => <option key={option || "none"} value={option}>{option ? discovery.backgroundTracks.find((trackOption) => trackOption.path === option)?.name || option : "None"}</option>)}</select></label><label>Volume<input className="text_pole" min={0} max={1} step={0.05} type="number" value={Number(item.volume ?? 0.5)} onChange={(event) => updateAgentTrack(profile.id, index, "volume", Number(event.target.value) || 0)} /></label><label>Delay<input className="text_pole" type="number" value={Number(item.delay ?? 0)} onChange={(event) => updateAgentTrack(profile.id, index, "delay", Number(event.target.value) || 0)} /></label><button className="menu_button" type="button" onClick={() => removeAgentTrack(profile.id, index)}>Remove</button></div>; })}</div>{discovery.backgroundTracks.length === 0 ? <small className="text_muted">Connect to VoiceForge to load background track options.</small> : null}<button className="menu_button" type="button" onClick={() => addAgentTrack(profile.id)}>Add Track</button></div></details>
                <details className="voice-section-collapsible"><summary className="section-header">ASMR Enhancement</summary><div className="section-content post-sliders"><label className="checkbox_label"><input checked={post.asmr_enabled === true} onChange={(event) => updateAgentNested(profile.id, "post", "asmr_enabled", event.target.checked)} type="checkbox" /><span>Enable TTS-to-ASMR Texture</span></label>{[["asmr_breathiness", "Breath Layer"], ["asmr_mouth_detail", "Mouth Sounds"], ["asmr_tingles", "Tingle Focus"], ["asmr_crispness", "Crisp Presence"], ["asmr_warmth", "Close Warmth"], ["asmr_intimacy", "Intimacy Lift"], ["asmr_softness", "Edge Softness"]].map(([key, label]) => <label className="post-slider-row" key={key}>{label}:<input min={0} max={100} type="range" value={Number(post[key] ?? 0)} onChange={(event) => updateAgentNested(profile.id, "post", key, Number(event.target.value))} /><span className="slider-value">{String(post[key] ?? 0)}</span></label>)}</div></details>
                <details className="voice-section-collapsible"><summary className="section-header">EQ / Filtering</summary><div className="section-content post-sliders"><div className="voiceforge-inline-grid">{[["highpass", "Highpass (Hz)", 0, 500], ["lowpass", "Lowpass (Hz)", 0, 20000], ["bass_freq", "Bass Freq (Hz)", 20, 500], ["treble_freq", "Treble Freq (Hz)", 1000, 20000]].map(([key, label, min, max]) => <label key={String(key)}>{label}:<input className="text_pole" min={Number(min)} max={Number(max)} type="number" value={Number(post[String(key)] ?? 0)} onChange={(event) => updateAgentNested(profile.id, "post", String(key), Number(event.target.value) || 0)} /></label>)}</div>{[["bass_gain", "Bass Gain (dB)", -24, 24, 0.1], ["treble_gain", "Treble Gain (dB)", -24, 24, 0.1]].map(([key, label, min, max, step]) => <label className="post-slider-row" key={String(key)}>{label}:<input min={Number(min)} max={Number(max)} step={Number(step)} type="range" value={Number(post[String(key)] ?? 0)} onChange={(event) => updateAgentNested(profile.id, "post", String(key), Number(event.target.value))} /><span className="slider-value">{String(post[String(key)] ?? 0)}</span></label>)}</div></details>
                <details className="voice-section-collapsible"><summary className="section-header">Reverb</summary><div className="section-content post-sliders"><label>Delay (ms):<input className="text_pole" min={0} max={500} type="number" value={Number(post.reverb_delay ?? 0)} onChange={(event) => updateAgentNested(profile.id, "post", "reverb_delay", Number(event.target.value) || 0)} /></label><label className="post-slider-row">Decay:<input min={0} max={0.9} step={0.05} type="range" value={Number(post.reverb_decay ?? 0)} onChange={(event) => updateAgentNested(profile.id, "post", "reverb_decay", Number(event.target.value))} /><span className="slider-value">{String(post.reverb_decay ?? 0)}</span></label></div></details>
                <details className="voice-section-collapsible"><summary className="section-header">Effects</summary><div className="section-content post-sliders">{[["crystalizer", "Crystalizer", 0, 20, 0.1], ["deesser", "De-esser", 0, 1, 0.01]].map(([key, label, min, max, step]) => <label className="post-slider-row" key={String(key)}>{label}:<input min={Number(min)} max={Number(max)} step={Number(step)} type="range" value={Number(post[String(key)] ?? 0)} onChange={(event) => updateAgentNested(profile.id, "post", String(key), Number(event.target.value))} /><span className="slider-value">{String(post[String(key)] ?? 0)}</span></label>)}</div></details>
                <details className="voice-section-collapsible"><summary className="section-header">Spatial Audio</summary><div className="section-content post-sliders"><label className="checkbox_label"><input checked={post.audio_8d_enabled === true} onChange={(event) => updateAgentNested(profile.id, "post", "audio_8d_enabled", event.target.checked)} type="checkbox" /><span>Enable Spatial Audio</span></label><label>Ear Position:<select className="text_pole" value={String(post.audio_8d_mode || "center")} onChange={(event) => updateAgentNested(profile.id, "post", "audio_8d_mode", event.target.value)}><option value="center">Center front</option><option value="static">Left ear whisper</option><option value="static_right">Right ear whisper</option><option value="extreme">Alternate ear zones</option><option value="sweep">Slow left-right sweep</option><option value="rotate">Full 8D rotation</option></select></label><label>Binaural Quality:<select className="text_pole" value={String(post.audio_8d_quality || "balanced")} onChange={(event) => updateAgentNested(profile.id, "post", "audio_8d_quality", event.target.value)}><option value="fast">Fast streaming</option><option value="balanced">Balanced</option><option value="ultra">Ultra ASMR</option></select></label>{[["audio_8d_speed", "Movement Speed", 0.01, 0.5, 0.01], ["audio_8d_depth", "Movement Arc", 0, 360, 1], ["audio_8d_distance", "Ear Distance", 0, 1, 0.01]].map(([key, label, min, max, step]) => <label className="post-slider-row" key={String(key)}>{label}:<input min={Number(min)} max={Number(max)} step={Number(step)} type="range" value={Number(post[String(key)] ?? 0)} onChange={(event) => updateAgentNested(profile.id, "post", String(key), Number(event.target.value))} /><span className="slider-value">{String(post[String(key)] ?? 0)}</span></label>)}</div></details>
              </div>
            </details>;
          })}
        </div>
      </Section>
    </div> : null}

    {selectedTab === "callmode" ? <div id="embody-callmode-panel" className="embody-tab-panel active">
      <div id="voiceforge_call_mode_settings" className="voiceforge-section native-voiceforge-section">
        <p className="text_muted voiceforge-call-intro">Live voice conversation. Click <i className="fa-solid fa-phone" /> to start. ASR options are in General below.</p>
        <Subsection id="call_mode_general" title="General">
          <label>Silence Detection (ms)<input className="text_pole" id="voiceforge_call_silence" min={250} max={10000} step={1} type="number" value={numberSetting(settings, "callModeSilenceThresholdMs", 800)} onChange={(event) => updateNumber("callModeSilenceThresholdMs", event.target.value, 250, 10000, 800)} /><small className="text_muted">How long to wait after you stop speaking</small></label>
          <label className="checkbox_label" htmlFor="voiceforge_call_hide_shield"><input checked={boolSetting(settings, "callModeHideChatShield")} id="voiceforge_call_hide_shield" onChange={(event) => onSettingChange("callModeHideChatShield", event.target.checked)} type="checkbox" /><small>Hide chat shield during call mode</small></label>
          <label className="checkbox_label" htmlFor="voiceforge_random_call_enabled"><input checked={boolSetting(settings, "callModeRandomCallEnabled")} id="voiceforge_random_call_enabled" onChange={(event) => onSettingChange("callModeRandomCallEnabled", event.target.checked)} type="checkbox" /><small>Allow AI to randomly start call mode</small></label>
          {boolSetting(settings, "callModeRandomCallEnabled") ? <div id="voiceforge_random_call_settings" className="voiceforge-inline-grid"><label>Min (min):<input className="text_pole" min={1} max={10080} type="number" value={numberSetting(settings, "callModeRandomCallMinMinutes", 10)} onChange={(event) => updateNumber("callModeRandomCallMinMinutes", event.target.value, 1, 10080, 10)} /></label><label>Max (min):<input className="text_pole" min={1} max={10080} type="number" value={numberSetting(settings, "callModeRandomCallMaxMinutes", 45)} onChange={(event) => updateNumber("callModeRandomCallMaxMinutes", event.target.value, 1, 10080, 45)} /></label><label>Cooldown (min):<input className="text_pole" min={0} max={10080} type="number" value={numberSetting(settings, "callModeRandomCallCooldownMinutes", 60)} onChange={(event) => updateNumber("callModeRandomCallCooldownMinutes", event.target.value, 0, 10080, 60)} /></label><small className="text_muted">When idle, starts call mode after a random delay between min and max.</small></div> : null}
          <label>ASR Server URL:<input className="text_pole" id="voiceforge_asr_endpoint" placeholder="http://127.0.0.1:8889" value={stringSetting(settings, "callModeAsrEndpoint", "http://127.0.0.1:8889")} onChange={(event) => onSettingChange("callModeAsrEndpoint", event.target.value)} /><small className="text_muted">Unified ASR endpoint (Whisper Turbo / GLM-ASR / Parakeet v3)</small></label>
          <label>ASR Model:<select className="text_pole" id="voiceforge_asr_model" value={stringSetting(settings, "callModeAsrModel", "large-v3-turbo")} onChange={(event) => onSettingChange("callModeAsrModel", event.target.value)}><optgroup label="Whisper (OpenAI)"><option value="large-v3-turbo">large-v3-turbo (fast+accurate)</option></optgroup><optgroup label="GLM-ASR"><option value="glm-asr-nano">GLM-ASR Nano (whispers)</option></optgroup><optgroup label="Parakeet (NVIDIA)"><option value="parakeet-tdt-0.6b-v3">Parakeet TDT 0.6B v3 (multilingual)</option></optgroup></select></label>
          <label className="checkbox_label" htmlFor="voiceforge_asr_wrap_quotes"><input checked={boolSetting(settings, "callModeWrapQuotes")} id="voiceforge_asr_wrap_quotes" onChange={(event) => onSettingChange("callModeWrapQuotes", event.target.checked)} type="checkbox" /><small>Wrap transcriptions in "quotes"</small></label>
          <label>Mic Gate Threshold<div className="voiceforge-range-row"><input className="text_pole" id="voiceforge_call_noise_gate" min={1} max={100} step={1} type="range" value={numberSetting(settings, "callModeNoiseGatePercent", 17)} onChange={(event) => updateNumber("callModeNoiseGatePercent", event.target.value, 1, 100, 17)} /><span>{numberSetting(settings, "callModeNoiseGatePercent", 17)}%</span></div><small className="text_muted">Higher = ignores quieter sounds (Discord-style gate)</small></label>
          <label className="checkbox_label" htmlFor="voiceforge_call_prefer_builtin_mic"><input checked={boolSetting(settings, "callModePreferBuiltInMic", true)} id="voiceforge_call_prefer_builtin_mic" onChange={(event) => onSettingChange("callModePreferBuiltInMic", event.target.checked)} type="checkbox" /><small>Prefer phone built-in mic on mobile</small></label>
          <label>Mic Device ID<input className="text_pole" id="voiceforge_call_input_device_id" placeholder="Auto" value={stringSetting(settings, "callModeInputDeviceId")} onChange={(event) => onSettingChange("callModeInputDeviceId", event.target.value)} /><small className="text_muted">Optional exact input deviceId. Leave blank to auto-pick the phone mic on mobile.</small></label>
          <label className="checkbox_label" htmlFor="voiceforge_call_mute_releases_mic"><input checked={boolSetting(settings, "callModeMuteReleasesMic")} id="voiceforge_call_mute_releases_mic" onChange={(event) => onSettingChange("callModeMuteReleasesMic", event.target.checked)} type="checkbox" /><small>Release mic when muted (Android: routes audio to headphones)</small></label>
          <div id="voiceforge_call_mic_level_panel"><div id="voiceforge_call_mic_level_track"><div id="voiceforge_call_mic_level_fill" /><div id="voiceforge_call_mic_gate_marker" style={{ left: `${numberSetting(settings, "callModeNoiseGatePercent", 17)}%` }} /></div><div id="voiceforge_call_mic_level_status" className="text_muted">Level 0% | Gate {numberSetting(settings, "callModeNoiseGatePercent", 17)}% | closed (idle)</div><button className="menu_button" id="voiceforge_call_mic_test_button" type="button" onClick={onMicLevelTest}>Start Mic Test</button></div>
        </Subsection>
        <Subsection id="call_mode_display" title="Call Display">
          <label className="checkbox_label" htmlFor="voiceforge_call_overlay_enabled"><input checked={boolSetting(settings, "callModeOverlayEnabled", true)} id="voiceforge_call_overlay_enabled" onChange={(event) => onSettingChange("callModeOverlayEnabled", event.target.checked)} type="checkbox" /><small>Show visual overlay during call mode</small></label>
          <div id="voiceforge_overlay_settings" className="voiceforge-indented-field"><label>Transparency:<div className="voiceforge-range-row"><input className="text_pole" min={0} max={100} type="range" value={numberSetting(settings, "callModeOverlayTransparency", 50)} onChange={(event) => updateNumber("callModeOverlayTransparency", event.target.value, 0, 100, 50)} /><span>{numberSetting(settings, "callModeOverlayTransparency", 50)}%</span></div></label><label>Scale:<div className="voiceforge-range-row"><input className="text_pole" min={10} max={500} step={5} type="range" value={numberSetting(settings, "callModeOverlayScale", 100)} onChange={(event) => updateNumber("callModeOverlayScale", event.target.value, 10, 500, 100)} /><span>{numberSetting(settings, "callModeOverlayScale", 100)}%</span></div><small className="text_muted">Overlay size multiplier (10% to 500%)</small></label><label>Z-Index:<input className="text_pole" min={0} max={99999} type="number" value={numberSetting(settings, "callModeOverlayZIndex", 9998)} onChange={(event) => updateNumber("callModeOverlayZIndex", event.target.value, 0, 99999, 9998)} /><small className="text_muted">Higher values appear on top</small></label><label>Position X:<div className="voiceforge-range-row"><input className="text_pole" min={0} max={100} type="range" value={numberSetting(settings, "callModeOverlayPositionX", 50)} onChange={(event) => updateNumber("callModeOverlayPositionX", event.target.value, 0, 100, 50)} /><span>{numberSetting(settings, "callModeOverlayPositionX", 50)}%</span></div></label><label>Position Y:<div className="voiceforge-range-row"><input className="text_pole" min={0} max={100} type="range" value={numberSetting(settings, "callModeOverlayPositionY", 50)} onChange={(event) => updateNumber("callModeOverlayPositionY", event.target.value, 0, 100, 50)} /><span>{numberSetting(settings, "callModeOverlayPositionY", 50)}%</span></div></label></div>
        </Subsection>
      </div>
    </div> : null}


  </div>;
});

export const VoiceForgePanel = memo(function VoiceForgePanel(props: Omit<EmbodyPanelProps, "panel">) {
  return <VoiceForgeCallModePanel {...props} panel="voiceforge" />;
});

export const CallModePanel = memo(function CallModePanel(props: Omit<EmbodyPanelProps, "panel">) {
  return <VoiceForgeCallModePanel {...props} panel="callmode" />;
});
