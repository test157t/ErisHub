import { memo, useEffect, useState, type ReactNode } from "react";
import type { ModuleSettingChange, ModuleSettings } from "./types";

type BackgroundMusicPanelProps = {
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

function Section({ children, defaultOpen = true, id, title }: { children: ReactNode; defaultOpen?: boolean; id: string; title: string }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return <details className="voiceforge-section native-voiceforge-section" open={isOpen} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
    <summary className="voiceforge-section-header" id={`${id}_header`}><span>{title}</span><i className="fa-solid fa-chevron-down" /></summary>
    <div className="voiceforge-section-content" id={`${id}_content`}>{children}</div>
  </details>;
}

export const BackgroundMusicPanel = memo(function BackgroundMusicPanel({ onError, onSettingChange, settings }: BackgroundMusicPanelProps) {
  const [audioOptions, setAudioOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [currentTrack, setCurrentTrack] = useState("");
  const selected = stringSetting(settings, "audioBgmSelected");
  const displayedTrack = currentTrack || selected;
  const bgmMuted = boolSetting(settings, "audioBgmMuted");
  const trackLocked = boolSetting(settings, "audioBgmLocked");
  const randomMode = boolSetting(settings, "audioBgmRandom");
  const visibleOptions = displayedTrack && !audioOptions.some((option) => option.value === displayedTrack)
    ? [{ label: displayedTrack.split(/[\\/]/).pop() || displayedTrack, value: displayedTrack }, ...audioOptions]
    : audioOptions;

  const updateNumber = (key: string, value: string, min: number, max: number, fallback: number) => {
    const raw = Number(value);
    onSettingChange(key, Math.max(min, Math.min(max, Number.isFinite(raw) ? raw : fallback)));
  };
  const setManualMode = (enabled: boolean) => {
    onSettingChange("audioBgmLocked", enabled);
    if (enabled) onSettingChange("audioBgmRandom", false);
  };
  const setRandomMode = (enabled: boolean) => {
    onSettingChange("audioBgmRandom", enabled);
    if (enabled) onSettingChange("audioBgmLocked", false);
  };

  const refreshAudioAssets = async () => {
    try {
      const response = await fetch("/api/modules/assets/inventory?refresh=true");
      const data = await response.json().catch(() => ({}));
      const voiceforge = data?.inventory?.modules?.embody?.voiceforge || {};
      const assets = [...(Array.isArray(voiceforge.backgrounds) ? voiceforge.backgrounds : []), ...(Array.isArray(voiceforge.audio) ? voiceforge.audio : [])];
      const options = assets
        .map((asset: { name?: string; url?: string }) => ({ label: String(asset.name || asset.url || ""), value: String(asset.url || "") }))
        .filter((asset: { value: string }) => asset.value);
      setAudioOptions(options);
      window.dispatchEvent(new CustomEvent("nitral-embody-audio-assets", { detail: { assets: options.map((asset) => ({ name: asset.label, url: asset.value })) } }));
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not refresh audio assets.");
    }
  };

  useEffect(() => {
    refreshAudioAssets().catch(() => undefined);
  }, []);
  useEffect(() => {
    const onCurrentTrack = (event: Event) => {
      setCurrentTrack(String((event as CustomEvent<{ src?: unknown }>).detail?.src || ""));
    };
    window.addEventListener("nitral-bgm-current-track", onCurrentTrack);
    return () => window.removeEventListener("nitral-bgm-current-track", onCurrentTrack);
  }, []);

  return <div className="voiceforge-panel native-voiceforge-panel embody-native-panel">
    <Section id="audio_section" title="Background Music">
      <div className="audio-enable-block">
        <label className="checkbox_label" htmlFor="audio_enabled"><input checked={boolSetting(settings, "audioEnabled")} id="audio_enabled" name="audio_enabled" onChange={(event) => onSettingChange("audioEnabled", event.target.checked)} type="checkbox" /><small>Enable Dynamic Audio</small></label>
      </div>
      <div className="audio-ui-block">
        <label>Background Music</label>
        <div className="audio-container">
          <button className={`menu_button audio-player-button ${bgmMuted ? "redOverlayGlow" : ""}`} id="audio_bgm_mute" title="Mute/Unmute" type="button" onClick={() => onSettingChange("audioBgmMuted", !bgmMuted)}>{bgmMuted ? "Unmute" : "Mute"}</button>
          <div className="audio-volume"><input className="audio-slider" id="audio_bgm_volume_slider" max={100} min={0} type="range" value={numberSetting(settings, "audioBgmVolume", 50)} onChange={(event) => updateNumber("audioBgmVolume", event.target.value, 0, 100, 50)} /><span className="audio-volume-label" id="audio_bgm_volume">{numberSetting(settings, "audioBgmVolume", 50)}</span></div>
          <div className="audio-playlist"><select className="text_pole" id="audio_bgm_select" value={displayedTrack} onChange={(event) => onSettingChange("audioBgmSelected", event.target.value)}><option value="">-- Select BGM --</option>{visibleOptions.map((track) => <option key={track.value} value={track.value}>{track.label}</option>)}</select></div>
          <label className="checkbox_label" htmlFor="audio_bgm_manual"><input checked={trackLocked} id="audio_bgm_manual" onChange={(event) => setManualMode(event.target.checked)} type="checkbox" /><small>Manual</small></label>
          <label className="checkbox_label" htmlFor="audio_bgm_random"><input checked={randomMode} id="audio_bgm_random" onChange={(event) => setRandomMode(event.target.checked)} type="checkbox" /><small>Random</small></label>
        </div>
        <small className="text_muted">Auto mode matches BGM to the current background name. Manual uses the selected track. Random picks a stable random track per background.</small>
      </div>
      <div className="audio-cooldown-row"><label htmlFor="audio_bgm_cooldown">BGM switch cooldown (seconds)</label><input className="text_pole wide30p" id="audio_bgm_cooldown" min={0} type="number" value={numberSetting(settings, "audioBgmCooldown", 30)} onChange={(event) => updateNumber("audioBgmCooldown", event.target.value, 0, 3600, 30)} /></div>
      <button className="menu_button audio-refresh-assets" id="audio_refresh_assets" type="button" onClick={() => refreshAudioAssets().catch(() => undefined)}>Refresh Audio Assets</button>
    </Section>
  </div>;
});
