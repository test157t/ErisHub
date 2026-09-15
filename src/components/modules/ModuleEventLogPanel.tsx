import { memo, useState } from "react";
import { ModuleInfoPanel } from "./ModuleInfoPanel";
import type { ModuleEventItem } from "./types";

type ModuleEventLogPanelProps = {
  compactJson: (value: unknown) => string;
  formatTimestamp: (timestamp: number) => string;
  moduleEvents: ModuleEventItem[];
  refreshBasicModules: () => void;
};

export const ModuleEventLogPanel = memo(function ModuleEventLogPanel({ compactJson, formatTimestamp, moduleEvents, refreshBasicModules }: ModuleEventLogPanelProps) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [status, setStatus] = useState("all");

  const normalizedQuery = query.trim().toLowerCase();
  const sources = Array.from(new Set(moduleEvents.map((item) => item.source).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const statuses = Array.from(new Set(moduleEvents.map((item) => item.status).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const visibleEvents = moduleEvents.filter((item) => {
    if (source !== "all" && item.source !== source) return false;
    if (status !== "all" && item.status !== status) return false;
    if (!normalizedQuery) return true;
    return [item.source, item.action, item.status, item.error, compactJson(item.input), compactJson(item.output)].some((value) => value?.toLowerCase().includes(normalizedQuery));
  });

  return <ModuleInfoPanel className="basic-module-panel" description="Module action requests, permission checks, execution results, and errors." title="Audit Log">
    <div className="module-toolbar audit-toolbar">
      <label className="module-search-field">Search events<input placeholder="Action, source, payload, or error" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <label>Source<select value={source} onChange={(event) => setSource(event.target.value)}><option value="all">All sources</option>{sources.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option>{statuses.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <button type="button" onClick={refreshBasicModules}>Refresh</button>
      <button className="delete-button" type="button" onClick={() => fetch("/api/modules/module-event-log", { method: "DELETE" }).then(refreshBasicModules)}>Clear</button>
    </div>
    <div className="module-list-summary">Showing {visibleEvents.length} of {moduleEvents.length} events</div>
    <div className="audit-event-list">{moduleEvents.length === 0 ? <span className="empty-module-state">No module events yet.</span> : visibleEvents.length === 0 ? <span className="empty-module-state">No module events match the current filters.</span> : visibleEvents.map((item) => {
      const isProblem = item.status === "error" || item.status === "blocked" || item.status === "invalid";
      return <details className={`audit-event-card ${isProblem ? "problem" : ""}`} key={item.id}>
        <summary><span className={`audit-status ${item.status}`}>{item.status}</span><span className="audit-event-main"><strong>{item.action}</strong><small>{item.source} · {formatTimestamp(Date.parse(item.createdAt))}</small></span>{item.error ? <span className="audit-error">{item.error}</span> : null}</summary>
        <div className="audit-event-details">{item.input !== undefined ? <pre className="python-sandbox-output done">Input: {compactJson(item.input)}</pre> : null}{item.output !== undefined ? <pre className="python-sandbox-output done">Output: {compactJson(item.output)}</pre> : null}</div>
      </details>;
    })}</div>
  </ModuleInfoPanel>;
});
