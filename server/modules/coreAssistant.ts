import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PromptBlock } from "../../shared/types";
import { moduleTool, type AppModule, type ModuleContext } from "./types";
import { readAgentSection, writeAgentSection } from "./agentSections";
import { readJsonStore, writeJsonStore } from "./jsonStore";

type ContactItem = { id: string; name: string; relationship?: string; notes?: string; birthday?: string; tags?: string; updatedAt: string; createdAt: string };
type CalendarItem = { id: string; title: string; startsAt: string; endsAt?: string; location?: string; attendees?: string; note?: string; status: "scheduled" | "cancelled"; updatedAt: string; createdAt: string };
type UserProfile = { facts: Record<string, string>; updatedAt?: string };
export type ProjectStatus = "enabled" | "disabled" | "done";
type ProjectItem = { id: string; name: string; status: ProjectStatus; directory?: string; summary?: string; decisions: string[]; openQuestions: string[]; updatedAt: string; createdAt: string };
export type AssistantFile = { id: string; name: string; content: string; updatedAt: string; createdAt: string };

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "core-assistant");

function capped(value: unknown, max: number) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanContent(value: unknown, max: number) {
  return String(value || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim().slice(0, max);
}

function nowIso() { return new Date().toISOString(); }

function validDate(value: unknown, label: string) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} must be a valid date/time.`);
  return date.toISOString();
}

function readAgentJson<T>(agentId: string, fileName: string, fallback: T): T {
  return readAgentSection<T>(agentId, "files", fileName, fallback);
}

function writeAgentJson(agentId: string, fileName: string, value: unknown) {
  writeAgentSection(agentId, "files", fileName, value);
}

async function readJson<T>(name: string, fallback: T): Promise<T> {
  return readJsonStore(path.join(root, name), fallback);
}

async function writeJson(name: string, value: unknown) {
  await writeJsonStore(path.join(root, name), value);
}

export async function listContacts() { return readJson<ContactItem[]>("contacts.json", []); }
export async function createContact(input: Record<string, unknown>) {
  const items = await listContacts();
  const item: ContactItem = { id: crypto.randomUUID(), name: capped(input.name, 120) || "Unnamed contact", relationship: capped(input.relationship, 80) || undefined, notes: cleanContent(input.notes, 1200) || undefined, birthday: capped(input.birthday, 40) || undefined, tags: capped(input.tags, 180) || undefined, createdAt: nowIso(), updatedAt: nowIso() };
  await writeJson("contacts.json", [item, ...items].slice(0, 500));
  return item;
}
export async function updateContact(id: string, input: Record<string, unknown>) {
  const items = await listContacts();
  let updated: ContactItem | undefined;
  const next = items.map((item) => item.id === id ? updated = { ...item, name: capped(input.name ?? item.name, 120) || item.name, relationship: input.relationship === undefined ? item.relationship : capped(input.relationship, 80) || undefined, notes: input.notes === undefined ? item.notes : cleanContent(input.notes, 1200) || undefined, birthday: input.birthday === undefined ? item.birthday : capped(input.birthday, 40) || undefined, tags: input.tags === undefined ? item.tags : capped(input.tags, 180) || undefined, updatedAt: nowIso() } : item);
  if (!updated) throw new Error("Contact not found.");
  await writeJson("contacts.json", next);
  return updated;
}
export async function searchContacts(query: string) {
  const q = query.toLowerCase().trim();
  return (await listContacts()).filter((item) => [item.name, item.relationship, item.notes, item.tags].join(" ").toLowerCase().includes(q)).slice(0, 20);
}

export async function listCalendar() { return readJson<CalendarItem[]>("calendar.json", []); }
export async function createCalendarEvent(input: Record<string, unknown>) {
  const items = await listCalendar();
  const item: CalendarItem = { id: crypto.randomUUID(), title: capped(input.title, 160) || "Appointment", startsAt: validDate(input.startsAt || input.at, "startsAt"), endsAt: input.endsAt ? validDate(input.endsAt, "endsAt") : undefined, location: capped(input.location, 180) || undefined, attendees: capped(input.attendees, 240) || undefined, note: cleanContent(input.note, 1000) || undefined, status: "scheduled", createdAt: nowIso(), updatedAt: nowIso() };
  await writeJson("calendar.json", [item, ...items].slice(0, 500));
  return item;
}
export async function updateCalendarEvent(id: string, input: Record<string, unknown>) {
  const items = await listCalendar();
  let updated: CalendarItem | undefined;
  const next = items.map((item) => item.id === id ? updated = { ...item, title: capped(input.title ?? item.title, 160) || item.title, startsAt: input.startsAt || input.at ? validDate(input.startsAt || input.at, "startsAt") : item.startsAt, endsAt: input.endsAt === undefined ? item.endsAt : input.endsAt ? validDate(input.endsAt, "endsAt") : undefined, location: input.location === undefined ? item.location : capped(input.location, 180) || undefined, attendees: input.attendees === undefined ? item.attendees : capped(input.attendees, 240) || undefined, note: input.note === undefined ? item.note : cleanContent(input.note, 1000) || undefined, status: input.status === "cancelled" ? "cancelled" : item.status, updatedAt: nowIso() } : item);
  if (!updated) throw new Error("Calendar event not found.");
  await writeJson("calendar.json", next);
  return updated;
}

export async function getUserProfile() { return readJson<UserProfile>("user-profile.json", { facts: {} }); }
export async function updateUserProfile(input: Record<string, unknown>) {
  const profile = await getUserProfile();
  const key = capped(input.key, 80);
  if (!key) throw new Error("Profile key is required.");
  const value = cleanContent(input.value, 1200);
  const facts = { ...profile.facts };
  if (value) facts[key] = value; else delete facts[key];
  const next = { facts, updatedAt: nowIso() };
  await writeJson("user-profile.json", next);
  return next;
}

function projectStatus(value: unknown): ProjectStatus {
  if (value === "disabled" || value === "paused") return "disabled";
  if (value === "done") return "done";
  return "enabled";
}

function requestedProjectStatus(value: unknown): ProjectStatus {
  if (value === "enabled" || value === "disabled" || value === "done") return value;
  throw new Error("Project status must be enabled, disabled, or done.");
}

export async function listProjects() {
  return (await readJson<Array<Omit<ProjectItem, "status"> & { status?: unknown }>>("projects.json", []))
    .map((item) => ({ ...item, status: projectStatus(item.status) }));
}
export async function createProject(input: Record<string, unknown>) {
  const items = await listProjects();
  const item: ProjectItem = { id: crypto.randomUUID(), name: capped(input.name, 160) || "Project", status: "enabled", directory: typeof input.directory === "string" ? input.directory.slice(0, 520) || undefined : undefined, summary: cleanContent(input.summary, 1200) || undefined, decisions: [], openQuestions: [], createdAt: nowIso(), updatedAt: nowIso() };
  await writeJson("projects.json", [item, ...items].slice(0, 200));
  return item;
}
export async function updateProject(id: string, input: Record<string, unknown>) {
  const items = await listProjects();
  let updated: ProjectItem | undefined;
  const next = items.map((item) => {
    if (item.id !== id) return item;
    const decisions = input.decision ? [...item.decisions, cleanContent(input.decision, 600)].filter(Boolean).slice(-80) : item.decisions;
    const openQuestions = input.openQuestion ? [...item.openQuestions, cleanContent(input.openQuestion, 600)].filter(Boolean).slice(-80) : item.openQuestions;
    updated = { ...item, name: capped(input.name ?? item.name, 160) || item.name, status: input.status === undefined ? item.status : requestedProjectStatus(input.status), directory: typeof input.directory === "string" ? input.directory.slice(0, 520) || undefined : item.directory, summary: input.summary === undefined ? item.summary : cleanContent(input.summary, 1200) || undefined, decisions, openQuestions, updatedAt: nowIso() };
    return updated;
  });
  if (!updated) throw new Error("Project not found.");
  await writeJson("projects.json", next);
  return updated;
}

export async function deleteProject(id: string) {
  const items = await listProjects();
  const next = items.filter((item) => item.id !== id);
  if (next.length === items.length) throw new Error("Project not found.");
  await writeJson("projects.json", next);
  return { id };
}

export function listAssistantFiles(agentId: string) {
  return readAgentJson<AssistantFile[]>(agentId, "assistant-files.json", []);
}

export function createAssistantFile(agentId: string, input: Record<string, unknown>) {
  const items = listAssistantFiles(agentId);
  const content = cleanContent(input.content, 20000);
  if (!content) throw new Error("Assistant file content is required.");
  const item: AssistantFile = { id: crypto.randomUUID(), name: capped(input.name, 160) || "untitled.txt", content, createdAt: nowIso(), updatedAt: nowIso() };
  writeAgentJson(agentId, "assistant-files.json", [item, ...items].slice(0, 200));
  return item;
}

export function updateAssistantFile(agentId: string, id: string, input: Record<string, unknown>) {
  const items = listAssistantFiles(agentId);
  let updated: AssistantFile | undefined;
  const next = items.map((item) => item.id === id ? updated = { ...item, name: capped(input.name ?? item.name, 160) || item.name, content: input.content === undefined ? item.content : cleanContent(input.content, 20000), updatedAt: nowIso() } : item);
  if (!updated) throw new Error("Assistant file not found.");
  writeAgentJson(agentId, "assistant-files.json", next);
  return updated;
}

export function deleteAssistantFile(agentId: string, id: string) {
  const items = listAssistantFiles(agentId);
  const next = items.filter((item) => item.id !== id);
  if (next.length === items.length) throw new Error("Assistant file not found.");
  writeAgentJson(agentId, "assistant-files.json", next);
  return { id };
}

export function applyAssistantFileHashlines(agentId: string, id: string, input: Record<string, unknown>) {
  const edits = cleanContent(input.edits || input.content || input.body, 20000).split("\n").map((line) => {
    const match = /^(\d+):(.*)$/.exec(line);
    if (!match) return null;
    return { lineNumber: Number(match[1]), value: match[2].replace(/^\s/, "") };
  }).filter((item): item is { lineNumber: number; value: string } => !!item && Number.isInteger(item.lineNumber) && item.lineNumber >= 1);
  if (!edits.length) throw new Error("Hashline edits require lines like `12: replacement text`.");

  const items = listAssistantFiles(agentId);
  let updated: AssistantFile | undefined;
  const next = items.map((item) => {
    if (item.id !== id) return item;
    const lines = item.content.split("\n");
    for (const edit of edits) {
      if (edit.lineNumber > lines.length) throw new Error(`Hashline ${edit.lineNumber} is outside ${item.name}.`);
      lines[edit.lineNumber - 1] = edit.value;
    }
    updated = { ...item, content: lines.join("\n"), updatedAt: nowIso() };
    return updated;
  });
  if (!updated) throw new Error("Assistant file not found.");
  writeAgentJson(agentId, "assistant-files.json", next);
  return updated;
}

function listBlock(title: string, items: string[]) { return `${title}:\n${items.length ? items.join("\n") : "None."}`; }

export const contactsModule: AppModule = { id: "contacts", name: "Contacts", description: "People, relationships, birthdays, and contact notes.", kind: "context", defaultEnabled: false, defaultSettings: { allowModelCreate: true }, tools: [moduleTool("contact.create", "Create a contact.", ["name"]), moduleTool("contact.update", "Update a contact.", ["id"])], hooks: { async getPromptBlocks({ settings }: ModuleContext): Promise<PromptBlock[]> { const contacts = (await listContacts()).slice(0, 20); return [{ id: "contacts-context", name: "Contacts", enabled: true, role: "system", position: "after-history", priority: 79, content: [listBlock("Contacts", contacts.map((item) => `- ${item.id}: ${item.name}${item.relationship ? ` (${item.relationship})` : ""}${item.birthday ? ` birthday=${item.birthday}` : ""}${item.notes ? ` - ${item.notes}` : ""}`)), settings.allowModelCreate === false ? "" : "Use the contact tools to manage contacts."].filter(Boolean).join("\n") }]; } } };
export const projectsModule: AppModule = { id: "projects", name: "Projects", description: "Project goals, decisions, open questions, status, and editor workspace context.", kind: "context", defaultEnabled: false, defaultSettings: { allowModelCreate: true }, tools: [moduleTool("project.create", "Create a project.", ["name"]), moduleTool("project.update", "Update a project.", ["id"]), moduleTool("project.file.search", "Search files in a project root.", ["root", "query"]), moduleTool("project.file.read", "Read a project file.", ["root", "file"])], hooks: { async getPromptBlocks({ settings }: ModuleContext): Promise<PromptBlock[]> { const projects = (await listProjects()).filter((item) => item.status === "enabled").slice(0, 12); return [{ id: "projects-context", name: "Projects", enabled: true, role: "system", position: "after-history", priority: 80, content: [listBlock("Projects", projects.map((item) => `- ${item.id}: [${item.status}] ${item.name}${item.summary ? ` - ${item.summary}` : ""}${item.decisions.length ? ` decisions=${item.decisions.slice(-3).join("; ")}` : ""}${item.openQuestions.length ? ` open=${item.openQuestions.slice(-3).join("; ")}` : ""}`)), settings.allowModelCreate === false ? "" : "Use the project tools to manage projects and inspect project files."].filter(Boolean).join("\n") }]; } } };

export function assistantFilesPromptBlocks(context: ModuleContext, settings: { allowModelCreate?: unknown; maxFiles?: unknown }): PromptBlock[] {
  const files = listAssistantFiles(context.request.promptProfile.id).slice(0, Math.max(1, Math.min(40, Number(settings.maxFiles) || 12)));
  return [{ id: "assistant-files-context", name: "Assistant Files", enabled: true, role: "system", position: "after-history", priority: 74, content: [listBlock("Assistant-managed files", files.map((item) => `- ${item.id}: ${item.name} (${item.content.length} chars)`)), settings.allowModelCreate === false ? "" : "Use the available assistant-file tools to manage these files."].filter(Boolean).join("\n") }];
}
