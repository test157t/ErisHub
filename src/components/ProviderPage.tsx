import { memo, useEffect, useState } from "react";
import type { ProviderConfig } from "../../shared/types";
import { SettingsCard } from "./SettingsCard";

type ProviderPageProps = {
  activeProviderId: string;
  provider: ProviderConfig;
  providerProfiles: ProviderConfig[];
  onAddProvider: () => void;
  onDeleteProvider: (providerId: string) => void;
  onProviderChange: (providerId: string) => void;
  onUpdateProvider: (changes: Partial<ProviderConfig>) => void;
};

export const ProviderPage = memo(function ProviderPage({ activeProviderId, provider, providerProfiles, onAddProvider, onDeleteProvider, onProviderChange, onUpdateProvider }: ProviderPageProps) {
  const [draft, setDraft] = useState(provider);
  const reasoningEffortOptions: ProviderConfig["reasoningEffort"][] = ["none", "low", "medium", "high"];

  useEffect(() => {
    setDraft(provider);
  }, [provider]);

  function commit<K extends keyof ProviderConfig>(key: K, value: ProviderConfig[K]) {
    if (provider[key] !== value) onUpdateProvider({ [key]: value } as Partial<ProviderConfig>);
  }

  function commitModels(value: string) {
    const models = value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    const model = models.includes(draft.model) ? draft.model : models[0] || draft.model;
    setDraft((current) => ({ ...current, model, models }));
    onUpdateProvider({ model, models });
  }

  return <section className="settings-subpanel provider-page">
    <SettingsCard
      title={<span className="card-title-with-toolbar">
        <span>Connection</span>
        <span className="profile-toolbar">
          <select aria-label="Provider profile" value={activeProviderId} onChange={(event) => onProviderChange(event.target.value)}>
            {providerProfiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <button className="small-action-button" type="button" onClick={onAddProvider}>Add</button>
          <button className="delete-button small-action-button" disabled={providerProfiles.length <= 1} type="button" onClick={() => onDeleteProvider(activeProviderId)}>Delete</button>
        </span>
      </span>}
    >
      <div className="field-grid two-column">
        <label>Name
          <input value={draft.name} onBlur={() => commit("name", draft.name)} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
        </label>
        <label>Base URL
          <input value={draft.baseUrl} onBlur={() => commit("baseUrl", draft.baseUrl)} onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))} />
        </label>
        <label>API Key
          <input value={draft.apiKey} onBlur={() => commit("apiKey", draft.apiKey)} onChange={(event) => setDraft((current) => ({ ...current, apiKey: event.target.value }))} type="password" />
        </label>
        <label>Active Model
          <select value={draft.model} onChange={(event) => { const model = event.target.value; setDraft((current) => ({ ...current, model })); onUpdateProvider({ model }); }}>
            {draft.models.map((model) => <option key={model} value={model}>{model}</option>)}
          </select>
        </label>
        <label className="checkbox_label">
          <input checked={draft.useGrokResponsesApi === true} onChange={(event) => { const useGrokResponsesApi = event.target.checked; setDraft((current) => ({ ...current, useGrokResponsesApi })); commit("useGrokResponsesApi", useGrokResponsesApi); }} type="checkbox" />
          <small>Use Grok Responses API</small>
        </label>
        <label className="checkbox_label">
          <input checked={draft.useManagedLlamaCpp === true} onChange={(event) => { const useManagedLlamaCpp = event.target.checked; setDraft((current) => ({ ...current, useManagedLlamaCpp })); commit("useManagedLlamaCpp", useManagedLlamaCpp); }} type="checkbox" />
          <small>Use managed llama.cpp module</small>
        </label>
        <label className="checkbox_label">
          <input checked={draft.useComfyUi === true} onChange={(event) => { const useComfyUi = event.target.checked; setDraft((current) => ({ ...current, useComfyUi })); commit("useComfyUi", useComfyUi); }} type="checkbox" />
          <small>Use ComfyUI</small>
        </label>
        <label className="provider-model-list">
          Models
          <textarea value={draft.models.join("\n")} onBlur={(event) => commitModels(event.target.value)} onChange={(event) => setDraft((current) => ({ ...current, models: event.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) }))} />
        </label>
      </div>
    </SettingsCard>

    <SettingsCard title="Generation">
      <div className="field-grid four-column generation-grid">
        <label>Temperature
          <input min="0" max="2" step="0.1" type="number" value={draft.temperature} onBlur={() => commit("temperature", Number(draft.temperature))} onChange={(event) => setDraft((current) => ({ ...current, temperature: Number(event.target.value) }))} />
        </label>
        <label>Top P
          <input min="0" max="1" step="0.01" type="number" value={draft.topP} onBlur={() => commit("topP", Number(draft.topP))} onChange={(event) => setDraft((current) => ({ ...current, topP: Number(event.target.value) }))} />
        </label>
        <label>Top K
          <input min="0" step="1" type="number" value={draft.topK} onBlur={() => commit("topK", Number(draft.topK))} onChange={(event) => setDraft((current) => ({ ...current, topK: Number(event.target.value) }))} />
        </label>
        <label>Min P
          <input min="0" max="1" step="0.01" type="number" value={draft.minP} onBlur={() => commit("minP", Number(draft.minP))} onChange={(event) => setDraft((current) => ({ ...current, minP: Number(event.target.value) }))} />
        </label>
        <label>Reasoning Effort
          <select value={draft.reasoningEffort} onChange={(event) => { const reasoningEffort = event.target.value as ProviderConfig["reasoningEffort"]; setDraft((current) => ({ ...current, reasoningEffort })); commit("reasoningEffort", reasoningEffort); }}>
            {reasoningEffortOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label>Context Length
          <input min="1024" step="1024" type="number" value={draft.contextLength} onBlur={() => commit("contextLength", Number(draft.contextLength))} onChange={(event) => setDraft((current) => ({ ...current, contextLength: Number(event.target.value) }))} />
        </label>
        <label>Max Output Tokens
          <input min="1" step="1" type="number" value={draft.maxTokens} onBlur={() => commit("maxTokens", Number(draft.maxTokens))} onChange={(event) => setDraft((current) => ({ ...current, maxTokens: Number(event.target.value) }))} />
        </label>
      </div>
    </SettingsCard>
  </section>;
});
