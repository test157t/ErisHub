import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonArrayStore, writeJsonStore } from "./jsonStore";

export type ModuleEventStatus = "requested" | "allowed" | "blocked" | "invalid" | "duplicate" | "executed" | "error" | "continuation-required";

export type ModuleEvent = {
  id: string;
  createdAt: string;
  source: string;
  action: string;
  status: ModuleEventStatus;
  input?: unknown;
  output?: unknown;
  error?: string;
};

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "module-event-log");
const file = path.join(root, "events.json");

export async function listModuleEvents(limit = 200): Promise<ModuleEvent[]> {
  try {
    return (await readJsonArrayStore<ModuleEvent>(file)).slice(0, Math.max(1, Math.min(1000, limit)));
  } catch {
    return [];
  }
}

async function saveModuleEvents(events: ModuleEvent[]) {
  await writeJsonStore(file, events.slice(0, 1000));
}

export async function recordModuleEvent(input: Omit<ModuleEvent, "id" | "createdAt">) {
  const event: ModuleEvent = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...input
  };
  await saveModuleEvents([event, ...(await listModuleEvents(999))]);
  return event;
}

export async function clearModuleEvents() {
  await saveModuleEvents([]);
}
