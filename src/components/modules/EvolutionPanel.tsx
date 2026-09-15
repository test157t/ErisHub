import { memo, useCallback, useEffect, useState } from "react";
import type { ModuleManifest, ModuleSettings } from "./types";
import type { PromptProfile, ProviderConfig } from "../../../shared/types";

type EvolutionChange = {
  section: string;
  before: string;
  after: string;
};

type EvolutionEntry = {
  id: string;
  timestamp: string;
  trigger: "auto" | "manual" | "self-edit";
  agentId: string;
  agentName: string;
  changes: EvolutionChange[];
  revertedAt: string | null;
};

type EvolutionPanelProps = {
  activePromptProfile: PromptProfile;
  onError: (message: string) => void;
  onSettingChange: (key: string, value: unknown) => void;
  postJson: (url: string, body: unknown, method?: string) => Promise<unknown>;
  promptProfiles: PromptProfile[];
  provider: ProviderConfig;
  settings: ModuleSettings;
};

const EvolutionPanel = memo(function EvolutionPanel({ activePromptProfile, onError, onSettingChange, postJson, promptProfiles, provider, settings }: EvolutionPanelProps) {
  const [log, setLog] = useState<EvolutionEntry[]>([]);
  const [evolving, setEvolving] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState("");

  const agentId = activePromptProfile.id;

  const fetchLog = useCallback(async () => {
    try {
      const res = await fetch(`/api/modules/evolution/log?agentId=${encodeURIComponent(agentId)}`);
      const data = await res.json();
      if (data.success) setLog(data.log || []);
    } catch { /* ignore */ }
  }, [agentId]);

  useEffect(() => { fetchLog(); }, [fetchLog]);

  async function handleEvolve() {
    setEvolving(true);
    try {
      const recentMessages = [
        { role: "user", content: "Manual evolution trigger." },
        { role: "assistant", content: "Analyzing conversation history..." }
      ];
      const result = await postJson("/api/modules/evolution/evolve", {
        agentId,
        provider,
        messages: recentMessages
      }) as { success: boolean; changes: EvolutionChange[] };
      if (result.success && result.changes?.length > 0) {
        await fetchLog();
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "Evolution failed.");
    } finally {
      setEvolving(false);
    }
  }

  async function handleRevert(entryId: string) {
    try {
      const result = await postJson("/api/modules/evolution/revert", { agentId, entryId }) as { success: boolean };
      if (result.success) await fetchLog();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Revert failed.");
    }
  }

  async function handleDelete(entryId: string) {
    try {
      await postJson("/api/modules/evolution/delete", { agentId, entryId });
      await fetchLog();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Delete failed.");
    }
  }

  async function handleSelfEdit() {
    if (editingAgentId) return;
    setEditingAgentId(agentId);
    try {
      const result = await postJson("/api/modules/evolution/self-edit", {
        promptProfile: activePromptProfile,
        provider
      }) as { success: boolean; changes: EvolutionChange[] };
      if (result.success && result.changes?.length > 0) {
        await fetchLog();
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "Self-edit failed.");
    } finally {
      setEditingAgentId("");
    }
  }

  return <div className="evolution-panel">
    <div className="evolution-settings">
      <label className="evolution-toggle">
        <input checked={Boolean(settings.autoEvolve)} type="checkbox" onChange={(e) => onSettingChange("autoEvolve", e.target.checked)} />
        <span>Auto-evolve after chat</span>
      </label>
      {settings.autoEvolve ? <label className="evolution-range">
        <span>Min messages: {Number(settings.minMessagesForAutoEvolve) || 10}</span>
        <input min={2} max={50} step={1} type="range" value={Number(settings.minMessagesForAutoEvolve) || 10} onChange={(e) => onSettingChange("minMessagesForAutoEvolve", Number(e.target.value))} />
      </label> : null}
      <label className="evolution-toggle">
        <input checked={Boolean(settings.showToasts)} type="checkbox" onChange={(e) => onSettingChange("showToasts", e.target.checked)} />
        <span>Show toast notifications</span>
      </label>
    </div>

    <div className="evolution-actions">
      <button disabled={evolving} type="button" onClick={handleEvolve}>{evolving ? "Evolving..." : "Evolve Now"}</button>
      <button disabled={editingAgentId === agentId} type="button" onClick={handleSelfEdit}>{editingAgentId === agentId ? "Reviewing..." : "Self-Edit Prompt"}</button>
    </div>

    {log.length > 0 ? <div className="evolution-log">
      <h4>Evolution Log</h4>
      {log.slice().reverse().map((entry) => <div className={`evolution-entry ${entry.revertedAt ? "reverted" : ""}`} key={entry.id}>
        <div className="evolution-entry-header">
          <span className="evolution-entry-trigger">{entry.trigger}</span>
          <span className="evolution-entry-date">{new Date(entry.timestamp).toLocaleString()}</span>
          <span className="evolution-entry-agent">{entry.agentName}</span>
          {!entry.revertedAt ? <button className="small-action-button revert-button" type="button" onClick={() => handleRevert(entry.id)}>Revert</button> : <span className="evolution-entry-reverted">Reverted</span>}
          <button className="small-action-button delete-button" type="button" onClick={() => handleDelete(entry.id)}>Delete</button>
        </div>
        <div className="evolution-entry-changes">{entry.changes.map((change, i) => <div className="evolution-change" key={i}>
          <strong>{change.section}</strong>
          <div className="evolution-change-diff">
            <div className="evolution-change-before"><small>Before:</small><pre>{(change.before ?? "").slice(0, 300)}</pre></div>
            <div className="evolution-change-after"><small>After:</small><pre>{(change.after ?? "").slice(0, 300)}</pre></div>
          </div>
        </div>)}</div>
      </div>)}
    </div> : <p className="evolution-empty">No evolution entries yet. Chat with an agent or click "Evolve Now" to begin.</p>}
  </div>;
});

export { EvolutionPanel };
export type { EvolutionChange, EvolutionEntry };
