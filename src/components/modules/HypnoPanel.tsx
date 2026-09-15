import { memo } from "react";
import type { PromptProfile } from "../../../shared/types";
import type { ModuleSettingChange, ModuleSettings } from "./types";

type HypnoPanelProps = {
  onSettingChange: ModuleSettingChange;
  promptProfiles: PromptProfile[];
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

function clampNumber(value: string, min: number, max: number, fallback: number) {
  const raw = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(raw) ? raw : fallback));
}

function jsonArraySetting(settings: ModuleSettings, key: string) {
  try {
    const parsed = JSON.parse(stringSetting(settings, key, "[]"));
    return Array.isArray(parsed) ? parsed as Array<Record<string, unknown>> : [];
  } catch {
    return [];
  }
}

export const HypnoPanel = memo(function HypnoPanel({ onSettingChange, promptProfiles, settings }: HypnoPanelProps) {
  const updateNumber = (key: string, value: string, min: number, max: number, fallback: number) => onSettingChange(key, clampNumber(value, min, max, fallback));
  const updateMultiplier = (key: string, value: string, min: number, max: number, fallback: number) => onSettingChange(key, Math.max(min, Math.min(max, (Number(value) || fallback * 100) / 100)));
  const sessionActive = boolSetting(settings, "sessionActive");
  const sessionPaused = boolSetting(settings, "sessionPaused");
  const stage = stringSetting(settings, "sessionStage", "not started") || "not started";
  const progress = Math.max(0, Math.min(100, numberSetting(settings, "sessionStageProgress", 0)));
  const readiness = stringSetting(settings, "sessionReadiness", "");
  const feedback = stringSetting(settings, "sessionFeedback", "");
  const userSignal = stringSetting(settings, "sessionUserSignal", "");
  const modelDecision = stringSetting(settings, "sessionModelDecision", "");
  const technique = stringSetting(settings, "sessionTechnique", "");
  const stageGoal = stringSetting(settings, "sessionStageGoal", "");
  const checkInPrompt = stringSetting(settings, "sessionCheckInPrompt", "");
  const selectedBranchId = stringSetting(settings, "sessionSelectedBranchId", "");
  const selectedBranchScore = numberSetting(settings, "sessionSelectedBranchScore", 0);
  const branchReason = stringSetting(settings, "sessionBranchReason", "");
  const directorNote = stringSetting(settings, "sessionDirectorNote", "");
  const preferenceNotes = stringSetting(settings, "sessionPreferenceNotes", "");
  const memoryCandidate = stringSetting(settings, "sessionMemoryCandidate", "");
  const candidateBranches = jsonArraySetting(settings, "sessionCandidateBranchesJson");
  const sessionPath = jsonArraySetting(settings, "sessionPathJson").slice(-8);
  const nextInstruction = stringSetting(settings, "sessionNextInstruction", "");
  const awaitingFeedback = boolSetting(settings, "sessionAwaitingFeedback");
  const sessionTurnCount = numberSetting(settings, "sessionTurnCount", 0);
  const sessionStageTurnCount = numberSetting(settings, "sessionStageTurnCount", 0);
  const contract = stringSetting(settings, "sessionContract", "");
  const contractStatus = stringSetting(settings, "sessionContractStatus", "");
  const contractAnalysis = stringSetting(settings, "sessionContractAnalysis", "");
  const selectedBranch = candidateBranches.find((branch) => String(branch.id || "") === selectedBranchId);
  const originContract = contract || contractAnalysis || "No session contract yet";

  return <div className="voiceforge-panel native-voiceforge-panel">
    <div className="hypno-evolution-tree">
      <div className="hypno-session-header"><strong>Session Evolution Tree</strong><span className={sessionActive ? sessionPaused ? "paused" : "active" : "idle"}>{sessionActive ? sessionPaused ? "Paused" : "Active" : "Idle"}</span></div>
      <div className="hypno-tree-context">
        {contractStatus ? <span>Contract: {contractStatus}</span> : null}
        {readiness ? <span>Readiness: {readiness}</span> : null}
        {userSignal ? <span>Signal: {userSignal}</span> : null}
        {modelDecision ? <span>Decision: {modelDecision}</span> : null}
        {awaitingFeedback ? <span>Awaiting feedback</span> : null}
        <span>{sessionTurnCount} turns</span>
        <span>{sessionStageTurnCount} stage turns</span>
      </div>

      <div className="hypno-skill-tree" aria-label="Guided relaxation session evolution tree">
        <div className="hypno-skill-tree-topline"><strong>Session Evolution Tree</strong><span>{candidateBranches.length || 0} sampled branches</span></div>
        <div className="hypno-skill-map">
          <ol className="hypno-skill-path" aria-label="Selected ancestor path">
            <li className="hypno-skill-node path origin">
              <div className="hypno-map-node-core"><span>00</span></div>
              <div className="hypno-map-node-label"><strong>Contract</strong><small>{originContract}</small>{contractStatus ? <small>Status: {contractStatus}</small> : null}</div>
            </li>
            {sessionPath.map((node, index) => <li className="hypno-skill-node path" key={`${String(node.at || index)}-${index}`}>
              <div className="hypno-map-node-core"><span>{String(index + 1).padStart(2, "0")}</span></div>
              <div className="hypno-map-node-label"><strong>{String(node.stage || "stage")}</strong><small>{String(node.technique || "technique")}</small></div>
            </li>)}
          </ol>

          <div className="hypno-skill-current-wrap">
            <div className="hypno-skill-node current" aria-current="step">
              <div className="hypno-map-node-core current-core" style={{ background: `conic-gradient(var(--accent) ${progress}%, color-mix(in srgb, var(--text) 9%, transparent) ${progress}% 100%)` }}><span>{progress}%</span></div>
              <div className="hypno-skill-current-copy">
                <div className="hypno-skill-node-title"><span>Current</span><strong>{stage}</strong></div>
                {technique ? <small>{technique}</small> : <small>No technique selected yet</small>}
                {stageGoal ? <small>Goal: {stageGoal}</small> : null}
                {selectedBranchId ? <small>Selected child: {selectedBranchId} · {selectedBranchScore}/100</small> : <small>Awaiting model branch selection</small>}
              </div>
              <details className="hypno-node-details">
                <summary>Node Details</summary>
                {checkInPrompt ? <small>Check-in: {checkInPrompt}</small> : null}
                {branchReason ? <small>Why: {branchReason}</small> : null}
                {directorNote ? <small>Director: {directorNote}</small> : null}
                {feedback ? <small>Feedback: {feedback}</small> : null}
                {nextInstruction ? <small>Next: {nextInstruction}</small> : null}
              </details>
            </div>
          </div>

          <ol className="hypno-skill-branches" aria-label="Sampled child branches">
            {candidateBranches.length ? candidateBranches.map((branch, index) => {
              const id = String(branch.id || `branch-${index + 1}`);
              const isSelected = id === selectedBranchId;
              return <li className={`hypno-skill-node branch ${isSelected ? "active" : ""}`} key={id} aria-current={isSelected ? "true" : undefined}>
                <div className="hypno-map-node-core branch-core"><span>{String(branch.totalScore ?? "?")}</span></div>
                <div className="hypno-map-node-label">
                  <div className="hypno-skill-node-title"><strong>{String(branch.label || id)}</strong>{isSelected ? <span>chosen</span> : null}</div>
                  <small>{String(branch.stage || "stage")} · {String(branch.technique || "technique")}</small>
                  <div className="hypno-branch-score-row" aria-label="Branch score breakdown">
                    <span>Value {String(branch.valueEstimate ?? "?")}</span>
                    <span>Conf {String(branch.confidence ?? "?")}</span>
                    <span>{String(branch.visits ?? "?")} visits</span>
                  </div>
                  {branch.goal ? <small>Goal: {String(branch.goal)}</small> : null}
                </div>
                <details className="hypno-node-details">
                  <summary>Rollout</summary>
                  {branch.rolloutSummary ? <small>{String(branch.rolloutSummary)}</small> : null}
                  <small>Comfort {String(branch.comfortScore ?? "?")} · Goal {String(branch.goalFitScore ?? "?")} · Ready {String(branch.readinessScore ?? "?")} · Novelty {String(branch.noveltyScore ?? "?")} · Intensity {String(branch.intensityScore ?? "?")}</small>
                  {branch.reason ? <small>Why: {String(branch.reason)}</small> : null}
                  {branch.effectsPlan ? <small>Effects: {String(branch.effectsPlan)}</small> : null}
                  {branch.effects && typeof branch.effects === "object" ? <small>Applies: {String((branch.effects as Record<string, unknown>).spiralPreset || "none")} · {String((branch.effects as Record<string, unknown>).particleStyle || "snow")} · {String((branch.effects as Record<string, unknown>).particleCount || 0)} particles</small> : null}
                </details>
              </li>;
            }) : <li className="hypno-skill-node branch empty"><div className="hypno-map-node-core branch-core"><span>?</span></div><div className="hypno-map-node-label"><strong>No sampled branches yet</strong><small>The next tracker pass will expand child nodes from the current session state.</small></div></li>}
          </ol>
        </div>
      </div>

      <details className="hypno-tree-context-details">
        <summary>Preferences and memory context</summary>
        {preferenceNotes ? <small>Preferences: {preferenceNotes}</small> : null}
        {memoryCandidate ? <small>Memory candidate: {memoryCandidate}</small> : null}
        {!preferenceNotes && !memoryCandidate ? <small>No preference or memory context yet.</small> : null}
      </details>
    </div>

    <details className="voiceforge-section native-voiceforge-section">
      <summary className="voiceforge-section-header"><span>Guidance</span><i className="fa-solid fa-chevron-down" /></summary>
      <div className="voiceforge-section-content">
        <div className="voiceforge-inline-grid">
          <label>Pacing<select className="text_pole" value={stringSetting(settings, "pacing", "slow")} onChange={(event) => onSettingChange("pacing", event.target.value)}><option value="slow">Slow</option><option value="medium">Medium</option><option value="very slow">Very slow</option><option value="confusion">Confusion</option></select></label>
          <label>Stage length<select className="text_pole" value={stringSetting(settings, "paragraphLength", "long")} onChange={(event) => onSettingChange("paragraphLength", event.target.value)}><option value="long">Long</option><option value="marathon">Marathon</option><option value="novel">Novel</option></select></label>
        </div>
        <label>Session Tracker Agent<select className="text_pole" value={stringSetting(settings, "trackerAgentId", "")} onChange={(event) => onSettingChange("trackerAgentId", event.target.value)}><option value="">Default primary agent</option>{promptProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.assistantName || profile.name}</option>)}</select><small className="text_muted">Active sessions run the evolution-tree tracker by default; choose a profile only to specialize it.</small></label>
        <label>Contract Agent<select className="text_pole" value={stringSetting(settings, "contractAgentId", "")} onChange={(event) => onSettingChange("contractAgentId", event.target.value)}><option value="">Disabled</option>{promptProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.assistantName || profile.name}</option>)}</select></label>
        <label>Preference Catalog Agent<select className="text_pole" value={stringSetting(settings, "preferenceAgentId", "")} onChange={(event) => onSettingChange("preferenceAgentId", event.target.value)}><option value="">Disabled</option>{promptProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.assistantName || profile.name}</option>)}</select></label>
        <label>Hypnosis Strategy Agent<select className="text_pole" value={stringSetting(settings, "strategyAgentId", "")} onChange={(event) => onSettingChange("strategyAgentId", event.target.value)}><option value="">Disabled</option>{promptProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.assistantName || profile.name}</option>)}</select><small className="text_muted">Adds hidden stage, pacing, and technique strategy before the tracker chooses the next branch.</small></label>
        <label>Creative Variation Agent<select className="text_pole" value={stringSetting(settings, "creativeAgentId", "")} onChange={(event) => onSettingChange("creativeAgentId", event.target.value)}><option value="">Disabled</option>{promptProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.assistantName || profile.name}</option>)}</select><small className="text_muted">Adds hidden wording, imagery, and cadence direction to reduce repetitive session prose.</small></label>
        <label className="checkbox_label"><input checked={boolSetting(settings, "breathworkEnabled", true)} onChange={(event) => onSettingChange("breathworkEnabled", event.target.checked)} type="checkbox" /><small>Allow breathwork pacing</small></label>
        <label className="checkbox_label"><input checked={boolSetting(settings, "callModeSyncEnabled", true)} onChange={(event) => onSettingChange("callModeSyncEnabled", event.target.checked)} type="checkbox" /><small>Sync guided wording with active effects</small></label>
        <label className="checkbox_label"><input checked={boolSetting(settings, "allowModelControl", true)} onChange={(event) => onSettingChange("allowModelControl", event.target.checked)} type="checkbox" /><small>Allow branch-selected effect changes</small></label>
      </div>
    </details>

    <details className="voiceforge-section native-voiceforge-section">
      <summary className="voiceforge-section-header"><span>Experience Effects</span><i className="fa-solid fa-chevron-down" /></summary>
      <div className="voiceforge-section-content">
        <label className="checkbox_label"><input checked={boolSetting(settings, "overlayEnabled", true) && boolSetting(settings, "effectsEnabled", true)} onChange={(event) => { onSettingChange("overlayEnabled", event.target.checked); onSettingChange("effectsEnabled", event.target.checked); }} type="checkbox" /><small>Enable Call Mode hypno visuals</small></label>
        <label>Spiral preset<select className="text_pole" value={stringSetting(settings, "spiralPreset", "none")} onChange={(event) => { onSettingChange("spiralPreset", event.target.value); onSettingChange("spiralEnabled", event.target.value !== "none"); }}><option value="none">None</option><option value="classic-vortex">Classic vortex</option><option value="soft-orbital">Soft orbital</option><option value="breathing-ring">Breathing ring</option><option value="deep-tunnel">Deep tunnel</option><option value="pendulum">Pendulum</option></select></label>
        <label>Particle style<select className="text_pole" value={stringSetting(settings, "particleStyle", "snow")} onChange={(event) => onSettingChange("particleStyle", event.target.value)}><option value="snow">Snow</option><option value="rain">Rain</option><option value="firefly">Fireflies</option></select></label>
        <label>Particle count<div className="voiceforge-range-row"><input className="text_pole" min={0} max={1000} step={10} type="range" value={numberSetting(settings, "particleCount", 250)} onChange={(event) => { updateNumber("particleCount", event.target.value, 0, 1000, 250); onSettingChange("particlesEnabled", Number(event.target.value) > 0); }} /><span>{numberSetting(settings, "particleCount", 250)}</span></div><small className="text_muted">Set to 0 to disable particles.</small></label>
        <label>Particle fall rate<div className="voiceforge-range-row"><input className="text_pole" min={25} max={400} step={5} type="range" value={numberSetting(settings, "particleFallRate", 1) * 100} onChange={(event) => updateMultiplier("particleFallRate", event.target.value, 0.25, 4, 1)} /><span>{Math.round(numberSetting(settings, "particleFallRate", 1) * 100)}%</span></div></label>
        <label>Firefly glow<div className="voiceforge-range-row"><input className="text_pole" min={50} max={400} step={5} type="range" value={numberSetting(settings, "fireflyGlow", 1) * 100} onChange={(event) => updateMultiplier("fireflyGlow", event.target.value, 0.5, 4, 1)} /><span>{Math.round(numberSetting(settings, "fireflyGlow", 1) * 100)}%</span></div></label>
      </div>
    </details>

    <details className="voiceforge-section native-voiceforge-section">
      <summary className="voiceforge-section-header"><span>Whispers And Cues</span><i className="fa-solid fa-chevron-down" /></summary>
      <div className="voiceforge-section-content">
        <label>Visual whisper palette<textarea className="text_pole" rows={5} value={stringSetting(settings, "visualWhispers", "")} onChange={(event) => { onSettingChange("visualWhispers", event.target.value); onSettingChange("visualWhispersEnabled", event.target.value.trim().length > 0); }} /></label>
        <label className="checkbox_label"><input checked={boolSetting(settings, "spokenWhispersEnabled")} onChange={(event) => onSettingChange("spokenWhispersEnabled", event.target.checked)} type="checkbox" /><small>Enable spoken whispers</small></label>
        <label className="checkbox_label"><input checked={boolSetting(settings, "ambientEnabled", true)} onChange={(event) => onSettingChange("ambientEnabled", event.target.checked)} type="checkbox" /><small>Enable ambient hypno audio</small></label>
        <label className="checkbox_label"><input checked={boolSetting(settings, "snapSfxEnabled", true)} onChange={(event) => onSettingChange("snapSfxEnabled", event.target.checked)} type="checkbox" /><small>Enable snap SFX</small></label>
        <label className="checkbox_label"><input checked={boolSetting(settings, "breathCuesEnabled", true) && boolSetting(settings, "breathGuidanceEnabled", true)} onChange={(event) => { onSettingChange("breathCuesEnabled", event.target.checked); onSettingChange("breathGuidanceEnabled", event.target.checked); }} type="checkbox" /><small>Enable breath cues and guidance</small></label>
        <label>Breath guidance lead<div className="voiceforge-range-row"><input className="text_pole" min={0} max={1500} step={10} type="range" value={numberSetting(settings, "breathGuidanceLeadMs", 260)} onChange={(event) => updateNumber("breathGuidanceLeadMs", event.target.value, 0, 1500, 260)} /><span>{numberSetting(settings, "breathGuidanceLeadMs", 260)}ms</span></div></label>
      </div>
    </details>
  </div>;
});
