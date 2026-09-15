import type { PromptBlock } from "../../shared/types";
import { readAgentSection, writeAgentSection } from "./agentSections";
import type { AppModule, ModuleContext } from "./types";

export type MemoryItem = {
  id: string;
  scope: "user" | "agent" | "global";
  text: string;
  tags: string;
  createdAt: string;
  updatedAt: string;
};

function memoryAgentId(agentId: string) {
  const id = String(agentId || "").trim();
  if (!id) throw new Error("Agent id is required for memory.");
  return id;
}

function readMemoryFile(agentId: string) {
  const memories = readAgentSection<MemoryItem[]>(memoryAgentId(agentId), "memory", "memories.json", []);
  return Array.isArray(memories) ? memories : [];
}

function writeMemoryFile(agentId: string, memories: MemoryItem[]) {
  writeAgentSection(memoryAgentId(agentId), "memory", "memories.json", memories);
}

function normalizeScope(value: unknown): MemoryItem["scope"] {
  return value === "agent" || value === "global" ? value : "user";
}

export function listMemories(agentId: string, query = "") {
  const q = query.trim().toLowerCase();
  const memories = readMemoryFile(agentId).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return (q ? memories.filter((item) => item.text.toLowerCase().includes(q) || item.tags.toLowerCase().includes(q)) : memories).slice(0, 200);
}

export function createMemory(agentId: string, input: { scope?: string; text: string; tags?: string }) {
  const memories = readMemoryFile(agentId);
  const text = String(input.text || "").trim().slice(0, 1200);
  if (!text) throw new Error("Memory text is required.");
  const existing = memories.find((item) => item.text.toLowerCase() === text.toLowerCase());
  if (existing) return existing;
  const now = new Date().toISOString();
  const item: MemoryItem = {
    id: crypto.randomUUID(),
    scope: normalizeScope(input.scope),
    text,
    tags: String(input.tags || "").trim().slice(0, 240),
    createdAt: now,
    updatedAt: now
  };
  writeMemoryFile(agentId, [item, ...memories]);
  return item;
}

export function updateMemory(agentId: string, id: string, input: Partial<Pick<MemoryItem, "scope" | "text" | "tags">>) {
  const memories = readMemoryFile(agentId);
  const index = memories.findIndex((item) => item.id === id);
  if (index < 0) throw new Error("Memory not found.");
  const current = memories[index];
  const next: MemoryItem = {
    ...current,
    scope: input.scope === "agent" || input.scope === "global" || input.scope === "user" ? input.scope : current.scope,
    text: input.text === undefined ? current.text : String(input.text || "").trim().slice(0, 1200),
    tags: input.tags === undefined ? current.tags : String(input.tags || "").trim().slice(0, 240),
    updatedAt: new Date().toISOString()
  };
  if (!next.text) throw new Error("Memory text is required.");
  memories[index] = next;
  writeMemoryFile(agentId, memories);
  return next;
}

export function deleteMemory(agentId: string, id: string) {
  writeMemoryFile(agentId, readMemoryFile(agentId).filter((item) => item.id !== id));
}

export function clearMemories(agentId: string) {
  writeMemoryFile(agentId, []);
}

export const memoryModule: AppModule = {
  id: "memory",
  name: "Memory",
  description: "Agent-folder memory banks for user, agent, and global facts.",
  kind: "context",
  defaultEnabled: false,
  defaultSettings: { allowModelCreate: true, maxMemories: 12 },
  hooks: {
    getPromptBlocks({ request, settings }: ModuleContext): PromptBlock[] {
      const max = Math.max(1, Math.min(30, Number(settings.maxMemories) || 12));
      const memories = listMemories(request.promptProfile.id).slice(0, max);
      return [{
        id: "memory-context",
        name: "Memory",
        enabled: true,
        role: "system",
        position: "after-history",
        priority: 80,
        content: [
          "Long-term memory:",
          memories.length ? memories.map((item) => `- [${item.scope}] ${item.text}${item.tags ? ` (tags: ${item.tags})` : ""}`).join("\n") : "No saved memories.",
          settings.allowModelCreate === false ? "" : "Use the memory tool to save an important durable fact."
        ].filter(Boolean).join("\n")
      }];
    }
  }
};
