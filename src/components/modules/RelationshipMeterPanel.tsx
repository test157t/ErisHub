import { memo, useState } from "react";
import type { ModuleConfig, PromptProfile, ProviderConfig } from "../../../shared/types";
import type { ModuleSettingChange, ModuleSettings } from "./types";

type RelationshipMeterPanelProps = {
  classifySentiments: string[];
  modules: ModuleConfig[];
  onError: (message: string) => void;
  onSettingChange: ModuleSettingChange;
  promptProfiles: PromptProfile[];
  provider: ProviderConfig;
  settings: ModuleSettings;
};

const meterKeys = [
  { key: "relationshipLevel", label: "Relationship Level", description: "Overall warmth versus distance", min: -100, max: 100, group: "Overall" },
  { key: "affinity", label: "Affinity", description: "How much they like the user", min: 0, max: 100, group: "Foundation" },
  { key: "trust", label: "Trust", description: "Confidence in the user's intent", min: 0, max: 100, group: "Foundation" },
  { key: "comfort", label: "Comfort", description: "Ease and emotional safety", min: 0, max: 100, group: "Foundation" },
  { key: "familiarity", label: "Familiarity", description: "How known and routine the user feels", min: 0, max: 100, group: "Foundation" },
  { key: "attraction", label: "Attraction", description: "Romantic pull and interest", min: 0, max: 100, group: "Bonding" },
  { key: "chemistry", label: "Chemistry", description: "Playful spark and conversational flow", min: 0, max: 100, group: "Bonding" },
  { key: "romance", label: "Romance", description: "Romantic orientation of the bond", min: 0, max: 100, group: "Bonding" },
  { key: "intimacy", label: "Intimacy", description: "Emotional closeness and vulnerability", min: 0, max: 100, group: "Bonding" },
  { key: "devotion", label: "Devotion", description: "Attachment, loyalty, and priority", min: 0, max: 100, group: "Bonding" },
  { key: "arousal", label: "Arousal", description: "Current flirtatious or charged energy", min: 0, max: 100, group: "Bonding" },
  { key: "tension", label: "Tension", description: "Stress, conflict, or uncertainty", min: 0, max: 100, group: "Friction" },
  { key: "irritation", label: "Irritation", description: "Annoyance or impatience", min: 0, max: 100, group: "Friction" },
  { key: "jealousy", label: "Jealousy", description: "Possessive or competitive pressure", min: 0, max: 100, group: "Friction" }
] as const;

const defaultRelationship = {
  mood: "neutral",
  relationshipLevel: 0,
  affinity: 50,
  trust: 50,
  comfort: 50,
  tension: 0,
  irritation: 0,
  familiarity: 0,
  attraction: 0,
  chemistry: 0,
  romance: 0,
  intimacy: 0,
  devotion: 0,
  jealousy: 0,
  arousal: 0
};

function boolSetting(settings: ModuleSettings, key: string, fallback = false) {
  return settings[key] === undefined ? fallback : settings[key] === true;
}

function objectSetting(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberSetting(value: unknown, fallback: number, min = 0, max = 100) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
}

function meterDisplayValue(key: string, value: number) {
  return key === "relationshipLevel" && value > 0 ? `+${value}` : String(value);
}

function relationshipTier(level: number) {
  if (level <= -75) return "Enemy";
  if (level <= -45) return "Hostile";
  if (level <= -15) return "Wary";
  if (level < 15) return "Stranger";
  if (level < 35) return "Acquaintance";
  if (level < 60) return "Friend";
  if (level < 80) return "Close Friend";
  return "Intimate";
}

function relationshipStage(level: number) {
  if (level <= -75) return "Adversarial";
  if (level <= -45) return "Hostile";
  if (level <= -15) return "Guarded";
  if (level < 15) return "Neutral";
  if (level < 35) return "Positive";
  if (level < 60) return "Affectionate";
  if (level < 80) return "Close";
  return "Deeply Attached";
}

function relationshipMood(value: unknown, moodOptions: string[]) {
  const mood = String(value || "neutral").trim();
  return moodOptions.includes(mood) ? mood : "neutral";
}

function strongestMeter(entry: Record<string, unknown>) {
  const candidates = meterKeys
    .filter((meter) => meter.key !== "relationshipLevel")
    .map((meter) => ({ label: meter.label, value: numberSetting(entry[meter.key], defaultRelationship[meter.key]) }))
    .sort((a, b) => b.value - a.value);
  return candidates[0];
}

export const RelationshipMeterPanel = memo(function RelationshipMeterPanel({ classifySentiments, modules, onError, onSettingChange, promptProfiles, provider, settings }: RelationshipMeterPanelProps) {
  const [baseliningAgentId, setBaseliningAgentId] = useState("");
  const moodOptions = Array.from(new Set([...classifySentiments, "aroused"]));
  const relationships = objectSetting(settings.relationships);
  const updateRelationship = (agentId: string, patch: Record<string, unknown>) => {
    const current = { ...defaultRelationship, ...objectSetting(relationships[agentId]) };
    onSettingChange("relationships", { ...relationships, [agentId]: { ...current, ...patch } });
  };
  const resetRelationship = (agentId: string) => {
    const next = { ...relationships };
    delete next[agentId];
    onSettingChange("relationships", next);
  };
  const establishBaseline = async (profile: PromptProfile) => {
    if (baseliningAgentId) return;
    setBaseliningAgentId(profile.id);
    try {
      const response = await fetch("/api/modules/relationship-meter/baseline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [], promptProfile: profile, provider, modules })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.success === false) throw new Error(String(data?.error || "Relationship baseline failed."));
      const relationship = objectSetting(data.relationship);
      onSettingChange("relationships", { ...relationships, [profile.id]: { ...defaultRelationship, ...relationship } });
    } catch (error) {
      onError(error instanceof Error ? error.message : "Relationship baseline failed.");
    } finally {
      setBaseliningAgentId("");
    }
  };

  return <div className="relationship-meter-panel native-voiceforge-panel">
    <div className="voiceforge-section native-voiceforge-section">
      <div className="voiceforge-section-content">
        <label className="checkbox_label"><input checked={boolSetting(settings, "showInPrompt", true)} onChange={(event) => onSettingChange("showInPrompt", event.target.checked)} type="checkbox" /><small>Inject relationship context into prompts</small></label>
        <label className="checkbox_label"><input checked={boolSetting(settings, "showNumbersToModel", true)} onChange={(event) => onSettingChange("showNumbersToModel", event.target.checked)} type="checkbox" /><small>Include numeric meter values</small></label>
        <label className="checkbox_label"><input checked={boolSetting(settings, "allowModelUpdates", true)} onChange={(event) => onSettingChange("allowModelUpdates", event.target.checked)} type="checkbox" /><small>Allow model to update meters</small></label>
        <label>Max model delta per turn<input className="text_pole" min={1} max={10} type="number" value={Number(settings.maxDeltaPerTurn ?? 3)} onChange={(event) => onSettingChange("maxDeltaPerTurn", Math.max(1, Math.min(10, Number(event.target.value) || 3)))} /></label>
      </div>
    </div>
    <div className="embody-agent-voice-list">
      {promptProfiles.length === 0 ? <p className="empty-state">No agents available.</p> : null}
      {promptProfiles.map((profile) => {
        const agentId = profile.id;
        const entry = { ...defaultRelationship, ...objectSetting(relationships[agentId]) };
        const level = numberSetting(entry.relationshipLevel, 0, -100, 100);
        const relationshipProgress = Math.max(0, Math.min(100, Math.round((level + 100) / 2)));
        const mood = relationshipMood(entry.mood, moodOptions);
        const strongest = strongestMeter(entry);
        return <details className="voiceforge-voice-entry embody-agent-voice-card" key={agentId}>
          <summary className="voice-header"><span className="voice-name">{profile.assistantName || profile.name}</span><div className="voice-header-buttons"><button className="menu_button" disabled={!!baseliningAgentId} type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); establishBaseline(profile).catch(() => undefined); }}>{baseliningAgentId === agentId ? "Baselining..." : "Establish Baseline"}</button><button className="menu_button" type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); resetRelationship(agentId); }}>Reset</button></div></summary>
          <div className="voice-content">
            <div className="relationship-state-card">
              <div><span>Relationship State</span><strong>{relationshipStage(level)}</strong></div>
              <div><span>Mood</span><strong>{mood}</strong></div>
              <div><span>Strongest Signal</span><strong>{strongest.label} {strongest.value}</strong></div>
            </div>
            <div className="relationship-route-card">
              <div className="relationship-route-title"><span>{relationshipTier(level)}</span><strong>{meterDisplayValue("relationshipLevel", level)}</strong></div>
              <div className="relationship-route-track"><div style={{ width: `${relationshipProgress}%` }} /></div>
              <div className="relationship-slider-scale" aria-hidden="true"><span>Adversarial</span><span>Neutral</span><span>Attached</span></div>
            </div>
            <div className="section-content post-sliders">
              {meterKeys.map((meter, index) => {
                const value = numberSetting(entry[meter.key], defaultRelationship[meter.key], meter.min, meter.max);
                const signed = meter.key === "relationshipLevel";
                const previous = meterKeys[index - 1];
                return <div className="relationship-meter-block" key={meter.key}>{!previous || previous.group !== meter.group ? <div className="relationship-meter-group">{meter.group}</div> : null}<label className={`post-slider-row relationship-meter-row ${signed ? "signed-meter-row" : ""}`}><span className="relationship-meter-label"><strong>{meter.label}</strong><small>{meter.description}</small></span><div className="relationship-slider-wrap"><input min={meter.min} max={meter.max} type="range" value={value} onChange={(event) => updateRelationship(agentId, { [meter.key]: Number(event.target.value) })} />{signed ? <div className="relationship-slider-scale" aria-hidden="true"><span>-100</span><span>0</span><span>+100</span></div> : null}</div><span className="slider-value">{meterDisplayValue(meter.key, value)}</span></label></div>;
              })}
            </div>
          </div>
        </details>;
      })}
    </div>
  </div>;
});
