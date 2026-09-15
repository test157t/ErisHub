import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonArrayStore, writeJsonStore } from "./jsonStore";

export type NoteItem = { id: string; type: "note"; title: string; content: string; createdAt: string; updatedAt: string };
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "notes");
const file = path.join(root, "notes.json");
export async function listNotes(query = ""): Promise<NoteItem[]> { const items = await readJsonArrayStore<NoteItem>(file); const q = query.trim().toLowerCase(); return q ? items.filter((item) => `${item.title}\n${item.content}`.toLowerCase().includes(q)) : items; }
async function saveNotes(items: NoteItem[]) { await writeJsonStore(file, items); }
export async function createNote(input: { title: string; content: string }) { const items = await listNotes(); const now = new Date().toISOString(); const item: NoteItem = { id: crypto.randomUUID(), type: "note", title: String(input.title || "Untitled").trim().slice(0, 160) || "Untitled", content: String(input.content || "").trim().slice(0, 12000), createdAt: now, updatedAt: now }; if (!item.content) throw new Error("Note content is required."); const existing = items.find((note) => note.title.toLowerCase() === item.title.toLowerCase() && note.content === item.content); if (existing) return existing; items.unshift(item); await saveNotes(items); return item; }
export async function updateNote(id: string, patch: Partial<NoteItem> & { append?: string }) { const items = await listNotes(); const index = items.findIndex((item) => item.id === id); if (index < 0) throw new Error("Note not found."); const current = items[index]; const appended = patch.append ? `${current.content}\n\n${String(patch.append).trim()}` : undefined; items[index] = { ...current, type: "note", title: patch.title ? String(patch.title).trim().slice(0, 160) : current.title, content: appended ?? (patch.content === undefined ? current.content : String(patch.content || "").trim().slice(0, 12000)), updatedAt: new Date().toISOString() }; await saveNotes(items); return items[index]; }
export async function deleteNote(id: string) { await saveNotes((await listNotes()).filter((item) => item.id !== id)); }
