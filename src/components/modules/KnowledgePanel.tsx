import { FormEvent, memo, useEffect, useState } from "react";
import type { PromptProfile } from "../../../shared/types";
import { ModuleInfoPanel } from "./ModuleInfoPanel";
import { FieldGrid, ToggleSetting } from "./SettingControls";
import type { MemoryItem, ModuleSettingChange, ModuleSettings, NoteItem, SetSimpleModuleDraft, SimpleModuleDraft } from "./types";

type KnowledgePanelProps = {
  activePromptProfile: PromptProfile;
  memories: MemoryItem[];
  notes: NoteItem[];
  onError: (message: string) => void;
  onSettingChange: ModuleSettingChange;
  postJson: (url: string, body: unknown, method?: string) => Promise<unknown>;
  promptProfiles: PromptProfile[];
  refreshBasicModules: () => void;
  setSimpleDraft: SetSimpleModuleDraft;
  settings: ModuleSettings;
  simpleDraft: SimpleModuleDraft;
  activeUserName: string;
};

export const KnowledgePanel = memo(function KnowledgePanel({ activePromptProfile, memories: _memories, notes, onError, onSettingChange, postJson, promptProfiles, refreshBasicModules, setSimpleDraft, settings, simpleDraft, activeUserName }: KnowledgePanelProps) {
  const [selectedMemoryAgentId, setSelectedMemoryAgentId] = useState(activePromptProfile.id);
  const [agentMemories, setAgentMemories] = useState<MemoryItem[]>([]);
  const [loadingMemories, setLoadingMemories] = useState(false);
  const [assistantFiles, setAssistantFiles] = useState<Array<{ id: string; name: string; content: string; updatedAt: string }>>([]);
  const [profileFacts, setProfileFacts] = useState<[string, string][]>([]);
  const selectedAgent = promptProfiles.find((p) => p.id === selectedMemoryAgentId) ?? activePromptProfile;
  const scopeLabel = (scope: MemoryItem["scope"]) => {
    if (scope === "agent") return selectedAgent.assistantName || selectedAgent.name || "Assistant";
    if (scope === "global") return "Shared";
    return activeUserName;
  };

  const loadAgentMemories = (agentId: string) => {
    setLoadingMemories(true);
    fetch(`/api/modules/memory?agentId=${encodeURIComponent(agentId)}`)
      .then((res) => res.json())
      .then((data) => { setAgentMemories(Array.isArray(data.memories) ? data.memories : []); })
      .catch(() => setAgentMemories([]))
      .finally(() => setLoadingMemories(false));
  };

  const refreshMemoryBank = () => {
    refreshBasicModules();
    loadAgentMemories(selectedMemoryAgentId);
    Promise.all([
      fetch(`/api/modules/memory-bank/assistant-files?agentId=${encodeURIComponent(selectedMemoryAgentId)}`).then((res) => res.json()),
      fetch("/api/modules/memory-bank/profile").then((res) => res.json())
    ]).then(([filesData, profileData]) => {
      setAssistantFiles(Array.isArray(filesData.items) ? filesData.items : []);
      setProfileFacts(profileData.profile?.facts && typeof profileData.profile.facts === "object" ? Object.entries(profileData.profile.facts) as [string, string][] : []);
    }).catch((error) => onError(error instanceof Error ? error.message : "Could not load knowledge records."));
  };

  useEffect(refreshMemoryBank, []);
  useEffect(() => { loadAgentMemories(selectedMemoryAgentId); }, [selectedMemoryAgentId]);

  const addMemory = (event: FormEvent) => {
    event.preventDefault();
    postJson("/api/modules/memory", { agentId: selectedMemoryAgentId, text: simpleDraft.memory })
      .then(() => {
        setSimpleDraft((current) => ({ ...current, memory: "" }));
        loadAgentMemories(selectedMemoryAgentId);
      })
      .catch((error) => onError(error.message));
  };

  const addNote = (event: FormEvent) => {
    event.preventDefault();
    postJson("/api/modules/notes", { title: simpleDraft.noteTitle, content: simpleDraft.noteContent })
      .then(() => {
        setSimpleDraft((current) => ({ ...current, noteTitle: "", noteContent: "" }));
        refreshBasicModules();
      })
      .catch((error) => onError(error.message));
  };

  const deleteMemory = (id: string) => {
    fetch(`/api/modules/memory/${id}?agentId=${encodeURIComponent(selectedMemoryAgentId)}`, { method: "DELETE" })
      .then(() => loadAgentMemories(selectedMemoryAgentId))
      .catch((error) => onError(error instanceof Error ? error.message : "Delete failed."));
  };

  const resetMemories = () => {
    if (!confirm("Reset all saved facts for this agent?")) return;
    fetch(`/api/modules/memory?agentId=${encodeURIComponent(selectedMemoryAgentId)}`, { method: "DELETE" })
      .then(() => loadAgentMemories(selectedMemoryAgentId))
      .catch((error) => onError(error instanceof Error ? error.message : "Could not reset saved facts."));
  };

  return <ModuleInfoPanel className="basic-module-panel" description="Saved facts, notes, profile details, and referenced files for persistent context." title="Memory Bank">
    <ToggleSetting checked={settings.allowModelCreate !== false} onChange={(checked) => onSettingChange("allowModelCreate", checked)}>Allow model-created memory-bank actions</ToggleSetting>
    <label>Agent<select value={selectedMemoryAgentId} onChange={(e) => setSelectedMemoryAgentId(e.target.value)}>{promptProfiles.map((p) => <option key={p.id} value={p.id}>{p.assistantName || p.name}</option>)}</select></label>
    <div className="button-row"><button type="button" onClick={refreshMemoryBank}>Refresh Memory Bank</button></div>
    <FieldGrid className="three-column climate-fields">
      <label>Prompt Facts<input min="1" max="30" step="1" type="number" value={Number(settings.maxMemories ?? 12)} onChange={(event) => onSettingChange("maxMemories", Number(event.target.value))} /></label>
      <label>Prompt Notes<input min="1" max="20" step="1" type="number" value={Number(settings.maxNotes ?? 8)} onChange={(event) => onSettingChange("maxNotes", Number(event.target.value))} /></label>
      <label>Search Facts<input min="0" max="20" step="1" type="number" value={Number(settings.retrievalMaxMemories ?? 5)} onChange={(event) => onSettingChange("retrievalMaxMemories", Number(event.target.value))} /></label>
      <label>Search Notes<input min="0" max="20" step="1" type="number" value={Number(settings.retrievalMaxNotes ?? 3)} onChange={(event) => onSettingChange("retrievalMaxNotes", Number(event.target.value))} /></label>
      <label>Search Documents<input min="0" max="8" step="1" type="number" value={Number(settings.retrievalMaxDocuments ?? 3)} onChange={(event) => onSettingChange("retrievalMaxDocuments", Number(event.target.value))} /></label>
    </FieldGrid>
    <FieldGrid className="three-column climate-fields">
      <label>File Query<input value={String(settings.fileQuery ?? "")} onChange={(event) => onSettingChange("fileQuery", event.target.value)} placeholder="optional context search" /></label>
      <label>File Excerpts<input min="1" max="8" step="1" value={Number(settings.fileMaxExcerpts ?? 4)} onChange={(event) => onSettingChange("fileMaxExcerpts", Number(event.target.value))} type="number" /></label>
      <label>Assistant Files<input min="0" max="40" step="1" value={Number(settings.maxAssistantFiles ?? 12)} onChange={(event) => onSettingChange("maxAssistantFiles", Number(event.target.value))} type="number" /></label>
    </FieldGrid>
    <strong>Saved Facts {loadingMemories ? <small>loading...</small> : <small>({agentMemories.length})</small>}</strong>
    <form className="basic-create-form" onSubmit={addMemory}><input value={simpleDraft.memory} onChange={(event) => setSimpleDraft((current) => ({ ...current, memory: event.target.value }))} placeholder="Remember that..." /><button type="submit">Add Fact</button><button className="delete-button" type="button" onClick={resetMemories}>Reset Facts</button></form>
    <div className="basic-list">{agentMemories.map((item) => <div className="basic-row" key={item.id}><span>[{scopeLabel(item.scope)}] {item.text}</span><button className="small-action-button delete-button" onClick={() => deleteMemory(item.id)} type="button">Delete</button></div>)}</div>
    <strong>Saved Notes</strong>
    <form className="basic-create-form tall" onSubmit={addNote}><input value={simpleDraft.noteTitle} onChange={(event) => setSimpleDraft((current) => ({ ...current, noteTitle: event.target.value }))} placeholder="Title" /><textarea value={simpleDraft.noteContent} onChange={(event) => setSimpleDraft((current) => ({ ...current, noteContent: event.target.value }))} placeholder="Longer note" rows={3} /><button type="submit">Add Note</button></form>
    <div className="basic-list">{notes.map((item) => <div className="basic-row" key={item.id}><span>{item.title}</span><button className="small-action-button delete-button" onClick={() => fetch(`/api/modules/notes/${item.id}`, { method: "DELETE" }).then(refreshBasicModules)} type="button">Delete</button></div>)}</div>
    <strong>Profile Details</strong>
    <div className="basic-list">{profileFacts.length === 0 ? <span>No profile facts yet.</span> : profileFacts.map(([key, value]) => <div className="basic-row" key={key}><strong>{key}</strong><span>{value}</span></div>)}</div>
    <strong>Assistant Files</strong><span>Model-created app-managed text records for drafts, plans, and generated documents.</span>
    <div className="basic-list">{assistantFiles.length === 0 ? <span>No assistant files yet.</span> : assistantFiles.map((item) => <details className="basic-row" key={item.id}><summary><span>{item.name} · {item.content.length} chars</span><button className="small-action-button delete-button" onClick={(event) => { event.stopPropagation(); postJson(`/api/modules/memory-bank/assistant-files/${item.id}?agentId=${encodeURIComponent(selectedMemoryAgentId)}`, {}, "DELETE").then(refreshMemoryBank).catch((error) => onError(error instanceof Error ? error.message : "Delete failed.")); }} type="button">Delete</button></summary><pre>{item.content}</pre></details>)}</div>
  </ModuleInfoPanel>;
});
