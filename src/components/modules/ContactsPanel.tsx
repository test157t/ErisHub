import { memo, useEffect, useState } from "react";
import { ModuleInfoPanel } from "./ModuleInfoPanel";
import { ToggleSetting } from "./SettingControls";
import type { ModuleSettingChange, ModuleSettings } from "./types";

type ContactsPanelProps = {
  onError: (message: string) => void;
  onSettingChange: ModuleSettingChange;
  settings: ModuleSettings;
};

export const ContactsPanel = memo(function ContactsPanel({ onError, onSettingChange, settings }: ContactsPanelProps) {
  const [contacts, setContacts] = useState<Array<{ id: string; name: string; relationship?: string; notes?: string }>>([]);
  const [query, setQuery] = useState("");
  const [relationship, setRelationship] = useState("all");

  const refreshContacts = () => {
    fetch("/api/modules/core-assistant/contacts")
      .then((res) => res.json())
      .then((data) => setContacts(Array.isArray(data.items) ? data.items : []))
      .catch((error) => onError(error instanceof Error ? error.message : "Could not load contacts."));
  };

  useEffect(refreshContacts, []);

  const normalizedQuery = query.trim().toLowerCase();
  const relationships = Array.from(new Set(contacts.map((item) => item.relationship?.trim()).filter((item): item is string => Boolean(item)))).sort((a, b) => a.localeCompare(b));
  const visibleContacts = contacts
    .filter((item) => relationship === "all" || item.relationship?.trim() === relationship)
    .filter((item) => !normalizedQuery || [item.name, item.relationship, item.notes].some((value) => value?.toLowerCase().includes(normalizedQuery)))
    .sort((a, b) => a.name.localeCompare(b.name));

  return <ModuleInfoPanel className="basic-module-panel" description="People, relationships, birthdays, and contact notes." title="Contacts">
    <ToggleSetting checked={settings.allowModelCreate !== false} onChange={(checked) => onSettingChange("allowModelCreate", checked)}>Allow model-created contact actions</ToggleSetting>
    <div className="module-toolbar contacts-toolbar">
      <label className="module-search-field">Search contacts<input placeholder="Name, relationship, or notes" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <label>Relationship<select value={relationship} onChange={(event) => setRelationship(event.target.value)}><option value="all">All relationships</option>{relationships.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <button type="button" onClick={refreshContacts}>Refresh</button>
    </div>
    <div className="module-list-summary">Showing {visibleContacts.length} of {contacts.length} contacts</div>
    <div className="contact-card-grid">{contacts.length === 0 ? <span className="empty-module-state">No contacts yet.</span> : visibleContacts.length === 0 ? <span className="empty-module-state">No contacts match the current filters.</span> : visibleContacts.map((item) => <article className="contact-card" key={item.id}>
      <div className="contact-avatar" aria-hidden="true">{item.name.trim().charAt(0).toUpperCase() || "?"}</div>
      <div className="contact-card-body">
        <strong>{item.name}</strong>
        <div className="contact-meta">{item.relationship ? <span>{item.relationship}</span> : <span>No relationship set</span>}</div>
        {item.notes ? <p>{item.notes}</p> : null}
      </div>
    </article>)}</div>
  </ModuleInfoPanel>;
});
