import { memo, useCallback, useEffect, useState } from "react";
import { ModuleInfoPanel } from "./ModuleInfoPanel";
import { FieldGrid } from "./SettingControls";

type SipConfig = {
  publicBaseUrl: string;
  callbackUsername: string;
  callbackPassword: string;
  greeting: string;
};

const defaults: SipConfig = {
  publicBaseUrl: "", callbackUsername: "", callbackPassword: "", greeting: "Hello. How can I help you?"
};

export const SipPanel = memo(function SipPanel() {
  const [config, setConfig] = useState<SipConfig>(defaults);
  const [status, setStatus] = useState("");
  const [checks, setChecks] = useState<Array<{ name: string; ok: boolean; detail: string }>>([]);
  const [callback, setCallback] = useState<{ eventType: string; callId: string; receivedAt: string; state: string; error: string } | null>(null);
  const load = useCallback(() => {
    fetch("/api/modules/sip/config").then((res) => res.json()).then((data) => {
      if (data.config) setConfig({ ...defaults, ...data.config });
    }).catch(() => setStatus("Could not load inbound phone configuration."));
  }, []);
  useEffect(() => { load(); }, [load]);
  const update = (key: keyof SipConfig, value: string | number) => setConfig((current) => ({ ...current, [key]: value }));
  const save = async () => {
    setStatus("Saving...");
    try {
      const response = await fetch("/api/modules/sip/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Save failed.");
      setConfig({ ...defaults, ...data.config });
      setStatus("Saved. Inbound calls are handled by the server while this module remains enabled.");
    } catch (error) {
      setStatus(`Error: ${error instanceof Error ? error.message : "Save failed."}`);
    }
  };
  const checkStatus = async () => {
    setStatus("Checking server configuration...");
    try {
      const response = await fetch("/api/modules/sip/status");
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Status check failed.");
      setChecks(Array.isArray(data.checks) ? data.checks : []);
      setCallback(data.callback || null);
      setStatus(data.ready ? "Ready for an inbound Bandwidth call." : "Configuration needs attention.");
    } catch (error) {
      setStatus(`Error: ${error instanceof Error ? error.message : "Status check failed."}`);
    }
  };
  const inboundUrl = config.publicBaseUrl.replace(/\/+$/, "") ? `${config.publicBaseUrl.replace(/\/+$/, "")}/api/modules/sip/inbound` : "";
  return <ModuleInfoPanel className="basic-module-panel" description="Answer Bandwidth inbound calls with bidirectional live media, ASR, the selected agent, and VoiceForge." title="Inbound Phone">
    <p>Enable this module on its card, then configure your Bandwidth Voice Application answer callback to <code>{inboundUrl || "https://your-public-host/api/modules/sip/inbound"}</code> using the callback Basic-auth credentials below.</p>
    <p>Bandwidth opens <code>{inboundUrl ? inboundUrl.replace(/^https:/, "wss:").replace("/inbound", "/stream") : "wss://your-public-host/api/modules/sip/stream"}</code> after the answer callback. Expose the isolated listener through Tailscale Funnel on public port 8443.</p>
    <p>Calls use the active agent/provider, Call Mode live ASR, and that agent's VoiceForge map.</p>
    <FieldGrid>
      <label>Public HTTPS Base URL<input value={config.publicBaseUrl} onChange={(event) => update("publicBaseUrl", event.target.value)} placeholder="https://erishub.example.com" /></label>
      <label>Callback Username<input value={config.callbackUsername} onChange={(event) => update("callbackUsername", event.target.value)} /></label>
      <label>Callback Password<input type="password" value={config.callbackPassword} onChange={(event) => update("callbackPassword", event.target.value)} /></label>
    </FieldGrid>
    <label>Greeting<input value={config.greeting} onChange={(event) => update("greeting", event.target.value)} /></label>
    <div className="button-row"><button type="button" onClick={save}>Save</button><button type="button" onClick={checkStatus}>Check Readiness</button></div>
    {callback ? <div className="basic-row"><strong>Live callback diagnostic</strong><span>{callback.eventType} ({callback.callId}) at {callback.receivedAt}: {callback.state}{callback.error ? ` - ${callback.error}` : ""}</span></div> : <p>No Bandwidth callback or media stream has reached ErisHub since the server started.</p>}
    {checks.length ? <div className="basic-list">{checks.map((check) => <div className="basic-row" key={check.name}><strong style={{ color: check.ok ? "var(--green)" : "var(--red)" }}>{check.ok ? "Ready" : "Needs setup"}</strong><span>{check.name}: {check.detail}</span></div>)}</div> : null}
    {status ? <pre className="python-sandbox-output done">{status}</pre> : null}
  </ModuleInfoPanel>;
});
