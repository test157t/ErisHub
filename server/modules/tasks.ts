import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PromptBlock } from "../../shared/types";
import type { AppModule, ModuleContext } from "./types";
import { readJsonArrayStore, writeJsonStore } from "./jsonStore";

export type TaskItem = { id: string; title: string; status: "todo" | "doing" | "done" | "blocked"; note?: string; createdAt: string; updatedAt: string };
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "tasks");
const file = path.join(root, "tasks.json");

export async function listTasks(): Promise<TaskItem[]> { return readJsonArrayStore<TaskItem>(file); }
async function saveTasks(items: TaskItem[]) { await writeJsonStore(file, items); }
export async function createTask(input: { title: string; status?: string; note?: string }) { const items = await listTasks(); const now = new Date().toISOString(); const title = String(input.title || "").trim().slice(0, 180); if (!title) throw new Error("Task title is required."); const existing = items.find((item) => item.title.toLowerCase() === title.toLowerCase() && item.status !== "done"); if (existing) return existing; const status = input.status === "doing" || input.status === "done" || input.status === "blocked" ? input.status : "todo"; const item: TaskItem = { id: crypto.randomUUID(), title, status, note: String(input.note || "").trim().slice(0, 500) || undefined, createdAt: now, updatedAt: now }; items.push(item); await saveTasks(items); return item; }
export async function updateTask(id: string, patch: Partial<TaskItem>) { const items = await listTasks(); const index = items.findIndex((item) => item.id === id); if (index < 0) throw new Error("Task not found."); const current = items[index]; const status = patch.status === "todo" || patch.status === "doing" || patch.status === "done" || patch.status === "blocked" ? patch.status : current.status; items[index] = { ...current, title: patch.title ? String(patch.title).trim().slice(0, 180) : current.title, status, note: patch.note === undefined ? current.note : String(patch.note || "").trim().slice(0, 500), updatedAt: new Date().toISOString() }; const saved = status === "done" ? items.filter((item) => item.id !== id) : items; await saveTasks(saved); return items[index]; }
export async function deleteTask(id: string) { await saveTasks((await listTasks()).filter((item) => item.id !== id)); }

const taskWorkflowGuidance = "For existing tasks, prefer the task execution tool. It loads the task, infers required tools, executes them, validates output, and updates status. Use task creation only for work that should persist beyond the current reply. Use task updates only for manual status changes.";

export const tasksModule: AppModule = {
  id: "tasks",
  name: "Tasks",
  description: "Local to-do/task board with model-created and user-managed tasks.",
  kind: "automation",
  defaultEnabled: false,
  defaultSettings: { allowModelCreate: true, includeDone: false },
  hooks: { async getPromptBlocks({ settings }: ModuleContext): Promise<PromptBlock[]> { const tasks = (await listTasks()).filter((item) => settings.includeDone === true || item.status !== "done").slice(0, 30); return [{ id: "tasks-context", name: "Tasks", enabled: true, role: "system", position: "after-history", priority: 78, content: [`Tasks:`, tasks.length ? tasks.map((item) => `- ${item.id}: [${item.status}] ${item.title}${item.note ? ` (${item.note})` : ""}`).join("\n") : "No active tasks.", settings.allowModelCreate === false ? "" : taskWorkflowGuidance].filter(Boolean).join("\n") }]; } }
};
