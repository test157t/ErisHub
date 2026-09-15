import { FormEvent, memo, ReactNode, useEffect, useState } from "react";
import { ModuleInfoPanel } from "./ModuleInfoPanel";
import { FieldGrid, ToggleSetting } from "./SettingControls";
import type { ModuleSettingChange, ModuleSettings, NotificationItem, ReminderDraft, ReminderItem, SetSimpleModuleDraft, SimpleModuleDraft, TaskItem } from "./types";

type OrganizerPanelProps = {
  createReminder: (reminder: ReminderDraft) => Promise<unknown>;
  deleteReminder: (id: string) => Promise<unknown>;
  formatTimestamp: (timestamp: number) => string;
  notifications: NotificationItem[];
  onError: (message: string) => void;
  onSettingChange: ModuleSettingChange;
  postJson: (url: string, body: unknown, method?: string) => Promise<unknown>;
  refreshBasicModules: () => void;
  refreshNotifications: () => void;
  refreshReminders: () => Promise<unknown>;
  reminderCalendar: ReactNode;
  reminderDraft: ReminderDraft;
  reminders: ReminderItem[];
  setReminderDraft: (value: React.SetStateAction<ReminderDraft>) => void;
  setSimpleDraft: SetSimpleModuleDraft;
  settings: ModuleSettings;
  simpleDraft: SimpleModuleDraft;
  tasks: TaskItem[];
};

export const OrganizerPanel = memo(function OrganizerPanel({ createReminder, deleteReminder, formatTimestamp, notifications, onError, onSettingChange, postJson, refreshBasicModules, refreshNotifications, refreshReminders, reminderCalendar, reminderDraft, reminders, setReminderDraft, setSimpleDraft, settings, simpleDraft, tasks }: OrganizerPanelProps) {
  const [events, setEvents] = useState<Array<{ id: string; title: string; startsAt: string; location?: string; status: string }>>([]);

  const refreshCalendar = () => {
    fetch("/api/modules/core-assistant/calendar")
      .then((res) => res.json())
      .then((data) => setEvents(Array.isArray(data.items) ? data.items : []))
      .catch((error) => onError(error instanceof Error ? error.message : "Could not load calendar events."));
  };

  useEffect(refreshCalendar, []);

  const refreshOrganizer = () => {
    refreshBasicModules();
    refreshReminders().catch(() => undefined);
    refreshCalendar();
    refreshNotifications();
  };

  const addTask = (event: FormEvent) => {
    event.preventDefault();
    postJson("/api/modules/tasks", { title: simpleDraft.task })
      .then(() => {
        setSimpleDraft((current) => ({ ...current, task: "" }));
        refreshBasicModules();
      })
      .catch((error) => onError(error.message));
  };

  const addReminder = (event: FormEvent) => {
    event.preventDefault();
    createReminder(reminderDraft)
      .then(() => setReminderDraft({ kind: "reminder", title: "", at: "", note: "" }))
      .catch((error) => onError(error instanceof Error ? error.message : "Could not create reminder."));
  };

  const showSchedulerStatus = () => {
    fetch("/api/modules/scheduler/status")
      .then((res) => res.json())
      .then((data) => setSimpleDraft((current) => ({ ...current, calcResult: JSON.stringify(data.jobs || [], null, 2) })))
      .catch((error) => onError(error.message));
  };

  return <ModuleInfoPanel className="basic-module-panel organizer-panel" description="Tasks, reminders, calendar events, notifications, and due-item automation." title="Organizer">
    <section className="organizer-section organizer-controls">
      <div className="organizer-section-header"><strong>Controls</strong><div className="button-row"><button type="button" onClick={refreshOrganizer}>Refresh</button><button type="button" onClick={showSchedulerStatus}>Scheduler Status</button></div></div>
      <div className="organizer-toggle-grid">
        <ToggleSetting checked={settings.allowModelCreate !== false} onChange={(checked) => onSettingChange("allowModelCreate", checked)}>Allow model-created organizer actions</ToggleSetting>
        <ToggleSetting checked={settings.includeProgress !== false} onChange={(checked) => onSettingChange("includeProgress", checked)}>Include progress in prompt + due alerts</ToggleSetting>
        <ToggleSetting checked={settings.browserNotifications === true} onChange={(checked) => onSettingChange("browserNotifications", checked)}>Browser notifications</ToggleSetting>
      </div>
      <FieldGrid className="two-column climate-fields"><label>Scheduler Poll Seconds<input min="5" max="300" step="5" type="number" value={Number(settings.pollSeconds ?? 30)} onChange={(event) => onSettingChange("pollSeconds", Number(event.target.value))} /></label></FieldGrid>
    </section>

    <div className="organizer-content-grid">
      <section className="organizer-section">
        <div className="organizer-section-header"><strong>Tasks</strong><span>{tasks.length}</span></div>
        <form className="basic-create-form" onSubmit={addTask}><input value={simpleDraft.task} onChange={(event) => setSimpleDraft((current) => ({ ...current, task: event.target.value }))} placeholder="New task" /><button type="submit">Add</button></form>
        <div className="basic-list">{tasks.length === 0 ? <span className="organizer-empty">No tasks.</span> : tasks.map((item) => <div className="basic-row organizer-task-row" key={item.id}><span>[{item.status}] {item.title}</span><select value={item.status} onChange={(event) => postJson(`/api/modules/tasks/${item.id}`, { status: event.target.value }, "PATCH").then(refreshBasicModules)}><option value="todo">todo</option><option value="doing">doing</option><option value="done">done</option><option value="blocked">blocked</option></select><button className="small-action-button delete-button" onClick={() => fetch(`/api/modules/tasks/${item.id}`, { method: "DELETE" }).then(refreshBasicModules)} type="button">Delete</button></div>)}</div>
      </section>

      <section className="organizer-section">
        <div className="organizer-section-header"><strong>Scheduled</strong><span>{reminders.length}</span></div>
        <form className="reminder-create-form" onSubmit={addReminder}>
          <label>Title<input value={reminderDraft.title} onChange={(event) => setReminderDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Take medication" required /></label>
          <label>Date/Time<input value={reminderDraft.at} onChange={(event) => setReminderDraft((current) => ({ ...current, at: event.target.value }))} type="datetime-local" required /></label>
          <label>Note<input value={reminderDraft.note} onChange={(event) => setReminderDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Optional" /></label>
          <button type="submit">Add</button>
        </form>
        <div className="reminder-list">{reminders.length === 0 ? <span className="organizer-empty">No scheduled items yet.</span> : reminders.map((item) => <div className={`reminder-row ${item.notifiedAt ? "done" : ""}`} key={item.id}><div><strong>{item.title}</strong><span>{formatTimestamp(Date.parse(item.at))}{item.note ? ` · ${item.note}` : ""}</span></div><button className="small-action-button delete-button" type="button" onClick={() => deleteReminder(item.id).catch(() => undefined)}>Delete</button></div>)}</div>
      </section>
    </div>

    <section className="organizer-section organizer-wide-section">
      <div className="organizer-section-header"><strong>Calendar Events</strong><span>{events.length}</span></div>
      <div className="basic-list organizer-compact-list">{events.length === 0 ? <span className="organizer-empty">No calendar events yet.</span> : events.map((item) => <div className="basic-row" key={item.id}><span>[{item.status}] {item.title} · {formatTimestamp(Date.parse(item.startsAt))}{item.location ? ` · ${item.location}` : ""}</span></div>)}</div>
    </section>

    <section className="organizer-section organizer-wide-section">
      <div className="organizer-section-header"><strong>Scheduled Items Calendar</strong></div>
      {reminderCalendar}
    </section>

    <section className="organizer-section organizer-wide-section">
      <div className="organizer-section-header"><strong>Notifications</strong><div className="button-row"><button type="button" onClick={() => fetch("/api/modules/notifications/read-all", { method: "POST" }).then(refreshNotifications)}>Mark all read</button><button className="delete-button" type="button" onClick={() => fetch("/api/modules/notifications", { method: "DELETE" }).then(refreshNotifications)}>Clear</button></div></div>
      <div className="basic-list">{notifications.length === 0 ? <span className="organizer-empty">No notifications.</span> : notifications.map((item) => <div className={`basic-row notification-row ${item.readAt ? "done" : ""}`} key={item.id}><span>[{item.kind}] {item.title}: {item.message}</span><button className="small-action-button" type="button" onClick={() => fetch(`/api/modules/notifications/${item.id}/read`, { method: "PATCH" }).then(refreshNotifications)}>Read</button><button className="small-action-button delete-button" type="button" onClick={() => fetch(`/api/modules/notifications/${item.id}`, { method: "DELETE" }).then(refreshNotifications)}>Delete</button></div>)}</div>
    </section>

    {simpleDraft.calcResult ? <pre className="python-sandbox-output done">{simpleDraft.calcResult}</pre> : null}
  </ModuleInfoPanel>;
});
