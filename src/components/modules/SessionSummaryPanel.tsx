import { FormEvent, memo } from "react";
import { ModuleInfoPanel } from "./ModuleInfoPanel";
import { ToggleSetting } from "./SettingControls";
import type { ModuleSettingChange, ModuleSettings, SessionSummaryItem, SetSimpleModuleDraft, SimpleModuleDraft } from "./types";

type SessionSummaryPanelProps = {
  onSettingChange: ModuleSettingChange;
  postJson: (url: string, body: unknown, method?: string) => Promise<unknown>;
  refreshBasicModules: () => void;
  setError: (message: string) => void;
  setSimpleDraft: SetSimpleModuleDraft;
  settings: ModuleSettings;
  simpleDraft: SimpleModuleDraft;
  summaries: SessionSummaryItem[];
};

export const SessionSummaryPanel = memo(function SessionSummaryPanel({ onSettingChange, postJson, refreshBasicModules, setError, setSimpleDraft, settings, simpleDraft, summaries }: SessionSummaryPanelProps) {
  const saveSummary = (event: FormEvent) => {
    event.preventDefault();
    postJson("/api/modules/session-summary", { summary: simpleDraft.summary })
      .then(() => {
        setSimpleDraft((current) => ({ ...current, summary: "" }));
        refreshBasicModules();
      })
      .catch((error) => setError(error.message));
  };

  return <ModuleInfoPanel className="basic-module-panel" description="Stores a compact summary and injects it only when estimated input plus max output approaches provider Context Length." title="Session Summary">
    <ToggleSetting checked={settings.includeSummary !== false} onChange={(checked) => onSettingChange("includeSummary", checked)}>Include summary near context limit</ToggleSetting>
    <label>Threshold %<input min="10" max="100" step="5" type="number" value={Number(settings.thresholdPercent ?? 80)} onChange={(event) => onSettingChange("thresholdPercent", Number(event.target.value))} /></label>
    <form className="basic-create-form tall" onSubmit={saveSummary}>
      <textarea value={simpleDraft.summary} onChange={(event) => setSimpleDraft((current) => ({ ...current, summary: event.target.value }))} placeholder="Session summary" rows={4} />
      <button type="submit">Save Summary</button>
    </form>
    <div className="basic-list">{summaries.map((item) => <div className="basic-row" key={item.id}><span>{item.summary.slice(0, 180)}</span><button className="small-action-button delete-button" onClick={() => fetch(`/api/modules/session-summary/${item.id}`, { method: "DELETE" }).then(refreshBasicModules)} type="button">Delete</button></div>)}</div>
  </ModuleInfoPanel>;
});
