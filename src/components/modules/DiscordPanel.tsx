import { memo, useCallback, useEffect, useState } from "react";
import { ModuleInfoPanel } from "./ModuleInfoPanel";
import { FieldGrid, ToggleSetting } from "./SettingControls";
import type { ModuleSettingChange, ModuleSettings } from "./types";
import type { ProviderConfig } from "../../../shared/types";

type DiscordPanelProps = {
  onError: (message: string) => void;
  onSettingChange: ModuleSettingChange;
  providerProfiles: ProviderConfig[];
  settings: ModuleSettings;
};

type DiscordConfigState = {
  token: string;
  channelId: string;
  guildId: string;
  autoFireReminders: boolean;
  mentionTargets: Array<{ name: string; userId: string; defaultAgent?: string }>;
  providerId: string;
};

const defaults: DiscordConfigState = { token: "", channelId: "", guildId: "", autoFireReminders: true, mentionTargets: [], providerId: "" };

export const DiscordPanel = memo(function DiscordPanel({ providerProfiles }: DiscordPanelProps) {
  const [saved, setSaved] = useState<DiscordConfigState>(defaults);
  const [draft, setDraft] = useState<DiscordConfigState>(defaults);
  const [status, setStatus] = useState("");
  const [clientId, setClientId] = useState("");
  const [connected, setConnected] = useState(false);
  const [mentionTargetsText, setMentionTargetsText] = useState("[]");
  const mentionTargetsValid = (() => {
    try {
      const parsed = JSON.parse(mentionTargetsText || "[]");
      return Array.isArray(parsed) && parsed.every((item) => item && typeof item === "object" && typeof item.name === "string" && typeof item.userId === "string");
    } catch { return false; }
  })();

  const loadConfig = useCallback(() => {
    fetch("/api/modules/discord/config")
      .then((res) => res.json())
      .then((data) => {
        if (data.config) {
          setSaved(data.config);
          setDraft((p) => {
            const restored: DiscordConfigState = { ...defaults, ...data.config, token: p.token || data.config.token || "" };
            setMentionTargetsText(JSON.stringify(restored.mentionTargets || [], null, 2));
            return restored;
          });
        }
        if (data.clientId) setClientId(data.clientId);
        setConnected(data.connected === true);
        if (data.connected === true) setStatus("Connected.");
        else if (data.warning) setStatus(`Warning: ${data.warning}`);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const save = useCallback(async () => {
    setStatus("Saving…");
    try {
      const mentionTargets = JSON.parse(mentionTargetsText || "[]");
      if (!Array.isArray(mentionTargets)) throw new Error("Mention targets must be a JSON array.");
      const payload = { ...draft, mentionTargets, token: draft.token === "••••••••" ? undefined : draft.token };
      const res = await fetch("/api/modules/discord/config", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!data.success) { setStatus(`Error: ${data.error || "unknown"}`); return; }
      if (data.connected === true) setStatus("Saved. Connected.");
      else if (data.warning) setStatus(`Saved. ${data.warning}`);
      else setStatus("Saved. Connecting bot…");
      setTimeout(loadConfig, 2000);
    } catch (error) {
      setStatus(`Error: ${error instanceof Error ? error.message : "Failed to save"}`);
    }
  }, [draft, loadConfig, mentionTargetsText]);

  const inviteUrl = clientId ? `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=103894016&scope=bot+applications.commands` : "";

  return <ModuleInfoPanel className="basic-module-panel" description="Connect ErisHub to Discord for text, slash-command, and spoken voice-channel conversations." title="Discord">
    <ToggleSetting checked={draft.autoFireReminders} onChange={(checked) => setDraft((p) => ({ ...p, autoFireReminders: checked }))}>Auto-send due reminders to Discord</ToggleSetting>
    <hr />
    <strong>Discord Bot</strong> <span style={{ color: connected ? "var(--green)" : "var(--red)" }}>{connected ? "● Connected" : "○ Disconnected"}</span>
    {inviteUrl ? <p><a href={inviteUrl} target="_blank" rel="noopener noreferrer">Invite bot to server</a> (requires <code>bot</code> + <code>applications.commands</code> scopes). <strong>Must enable <code>MESSAGE CONTENT INTENT</code></strong> in Discord Dev Portal → Bot → Privileged Gateway Intents for <code>@mention</code> to work.</p> : null}
    <p style={{ fontSize: "0.85em", opacity: 0.8 }}>Send <code>join vc</code> to start a spoken conversation in your current voice channel, or <code>leave vc</code> to disconnect. Speech uses the existing Call Mode ASR settings, the selected Discord provider, and the Discord channel agent's VoiceForge mapping. The bot needs View Channel, Connect, Speak, and voice receive access.</p>
    <FieldGrid>
      <label>Bot Token<input type="password" value={draft.token} onChange={(e) => setDraft((p) => ({ ...p, token: e.target.value }))} placeholder={saved?.token ? "(saved)" : "Discord bot token"} /></label>
      <label>Channel ID (for bot-initiated messages)<input value={draft.channelId} onChange={(e) => setDraft((p) => ({ ...p, channelId: e.target.value }))} placeholder="000000000000000000" /></label>
      <label>Guild ID<input value={draft.guildId} onChange={(e) => setDraft((p) => ({ ...p, guildId: e.target.value }))} placeholder="000000000000000000" /></label>
      <label>Discord Provider<select value={draft.providerId} onChange={(e) => setDraft((p) => ({ ...p, providerId: e.target.value }))}>
        <option value="">Use active/profile provider</option>
        {providerProfiles.map((item) => <option key={item.id} value={item.id}>{item.name || item.model || item.id}</option>)}
      </select></label>
    </FieldGrid>
    <label> Mention Targets JSON
      <textarea value={mentionTargetsText} onChange={(e) => setMentionTargetsText(e.target.value)} placeholder='[{"name":"Devoid","userId":"000000000000000000","defaultAgent":"Mia"}]' rows={5} />
    </label>
    <p style={{ color: mentionTargetsValid ? "var(--green)" : "var(--red)", fontSize: "0.85em" }}>{mentionTargetsValid ? "Mention targets JSON is valid." : "Mention targets must be a JSON array like [{\"name\":\"Devoid\",\"userId\":\"123\",\"defaultAgent\":\"Mia\"}]."}</p>
    <p style={{ fontSize: "0.85em", opacity: 0.8 }}>Discord uses the selected provider above. If blank, it falls back to the agent/profile provider, then the active provider.</p>
    <div className="button-row">
      <button type="button" onClick={save}>Save</button>
    </div>
    {status ? <pre className="python-sandbox-output done">{status}</pre> : null}
  </ModuleInfoPanel>;
});
