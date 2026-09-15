import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import type { AfterChatContext, AfterChatEvent, AppModule } from "./types";
import type { PromptBlock, ProviderConfig } from "../../shared/types";
import { findAgentFolderSync, readAgentSection, writeAgentSection } from "./agentSections";
import { completeProvider } from "./providerCompletion";

type EvolutionState = {
  messageCount: number;
};

type EvolutionChange = {
  section: string;
  before: string;
  after: string;
};

type EvolutionEntry = {
  id: string;
  timestamp: string;
  trigger: "auto" | "manual" | "self-edit";
  agentId: string;
  agentName: string;
  changes: EvolutionChange[];
  revertedAt: string | null;
};

const DEFAULT_STATE: EvolutionState = { messageCount: 0 };

function getEvolutionDir(agentIdOrName: string): string {
  const found = findAgentFolderSync(agentIdOrName);
  if (!found) throw new Error(`Agent not found: ${agentIdOrName}`);
  const dir = path.join(found.folder, "evolution");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readState(agentIdOrName: string): EvolutionState {
  try {
    const dir = getEvolutionDir(agentIdOrName);
    const filePath = path.join(dir, "state.json");
    if (!existsSync(filePath)) return { ...DEFAULT_STATE };
    return JSON.parse(readFileSync(filePath, "utf8")) as EvolutionState;
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function writeState(agentIdOrName: string, state: EvolutionState) {
  const dir = getEvolutionDir(agentIdOrName);
  const filePath = path.join(dir, "state.json");
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(state) + "\n", "utf8");
  renameSync(tmpPath, filePath);
}

function readLog(agentIdOrName: string): EvolutionEntry[] {
  try {
    return readAgentSection<EvolutionEntry[]>(agentIdOrName, "evolution", "log.json", []);
  } catch {
    return [];
  }
}

function writeLog(agentIdOrName: string, log: EvolutionEntry[]) {
  writeAgentSection(agentIdOrName, "evolution", "log.json", log);
}

function readAgentProfile(agentIdOrName: string): Record<string, unknown> | null {
  try {
    const found = findAgentFolderSync(agentIdOrName);
    if (!found) return null;
    return found.agent as Record<string, unknown>;
  } catch {
    return null;
  }
}

function writeAgentProfile(agentId: string, profile: Record<string, unknown>) {
  const found = findAgentFolderSync(agentId);
  if (!found) throw new Error("Agent not found.");
  const filePath = path.join(found.folder, `${profile.id || agentId}.json`);
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(profile) + "\n", "utf8");
  renameSync(tmpPath, filePath);
}

function findBlock(blocks: PromptBlock[], id: string): PromptBlock | undefined {
  return blocks.find((b) => b.id === id);
}

function formatBlocksForPrompt(blocks: PromptBlock[], sectionIds: string[]): string {
  return sectionIds.map((id) => {
    const block = findBlock(blocks, id);
    return `--- ${id} ---\n${block?.content || "[empty]"}`;
  }).join("\n\n");
}

const EVOLUTION_META_SYSTEM_PROMPT = `You are an agent evolution analyzer. Observe conversations and identify patterns in the user's preferences and communication style. Based on clear evidence, suggest updates to the agent's prompt sections.

Available sections and their purposes:
- description: The agent's core identity and role (1-2 sentences)
- personality: The agent's character traits, demeanor, and communication style
- appearance: Visual description of the agent's avatar (if applicable)
- response-guidelines: How the agent should structure replies, formatting preferences, behavior rules
- preferences: User's likes, dislikes, preferred topics, interaction patterns inferred from conversation

For each change:
- Reference specific conversation evidence in the section content itself
- Merge new insights with existing content rather than replacing what still holds
- Keep each section focused and concise

Only suggest changes backed by clear conversational evidence. Return empty array if nothing substantial to change.

Respond in exact JSON format:
{"changes":[{"section":"description|personality|appearance|response-guidelines|preferences","content":"updated section content"}]}`;

const RELEVANT_SECTIONS = ["description", "personality", "appearance", "response-guidelines", "preferences"];

async function callProvider(provider: ProviderConfig, systemPrompt: string, userPrompt: string): Promise<string> {
  const content = await completeProvider(provider, [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ], { temperature: Math.max(0.3, Math.min(0.7, Number(provider.temperature ?? 0.5))), maxTokens: 2000 });
  if (!content) throw new Error("Provider returned empty response.");
  return content;
}

function parseEvolutionResponse(content: string): EvolutionChange[] {
  try {
    const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed.changes)) {
      return parsed.changes.filter((c: unknown) =>
        c && typeof c === "object" && typeof (c as Record<string, unknown>).section === "string" && typeof (c as Record<string, unknown>).content === "string"
      ).map((c: { section: string; content: string }) => ({
        section: c.section.toLowerCase(),
        before: "",
        after: c.content
      }));
    }
    return [];
  } catch {
    return [];
  }
}

function applyChanges(blocks: PromptBlock[], changes: EvolutionChange[]): PromptBlock[] {
  const updated = blocks.map((b) => ({ ...b }));
  for (const change of changes) {
    const block = updated.find((b) => b.id === change.section);
    if (block) {
      block.content = change.after;
    } else {
      updated.push({ id: change.section, name: change.section, enabled: true, role: "system", position: "after-history", priority: 50, content: change.after });
    }
  }
  return updated;
}

async function runEvolution(ctx: AfterChatContext, trigger: "auto" | "manual"): Promise<EvolutionChange[]> {
  const profileId = ctx.request.promptProfile.id;
  const profileName = ctx.request.promptProfile.assistantName || ctx.request.promptProfile.name;
  const provider = ctx.request.provider;
  const blocks = ctx.request.promptProfile.blocks || [];

  if (!provider?.apiKey?.trim()) return [];

  const recentMessages = ctx.request.messages.slice(-20);
  if (recentMessages.length < 2) return [];

  const conversationText = recentMessages.map((m) => {
    const role = m.role === "user" ? "User" : m.role === "assistant" ? (m.agentName || "Assistant") : m.role;
    return `${role}: ${m.content}`;
  }).join("\n\n");

  const currentBlocksText = formatBlocksForPrompt(blocks, RELEVANT_SECTIONS);
  const userPrompt = [
    `Agent: ${profileName}`,
    "",
    "Current prompt sections:",
    currentBlocksText,
    "",
    "Recent conversation:",
    conversationText,
    "",
    "Analyze the conversation and suggest updates to the agent's sections if warranted."
  ].join("\n");

  try {
    const rawContent = await callProvider(provider, EVOLUTION_META_SYSTEM_PROMPT, userPrompt);
    const changes = parseEvolutionResponse(rawContent);
    if (changes.length === 0) return [];

    const agentProfile = readAgentProfile(profileId);
    if (!agentProfile) return [];

    const existingBlocks = (agentProfile.promptProfile as { blocks?: PromptBlock[] })?.blocks || [];
    const newBlocks = applyChanges(existingBlocks, changes);
    const updatedProfile = {
      ...agentProfile,
      promptProfile: {
        ...(agentProfile.promptProfile as Record<string, unknown> || {}),
        blocks: newBlocks
      }
    };
    writeAgentProfile(profileId, updatedProfile);

    const entry: EvolutionEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      trigger,
      agentId: profileId,
      agentName: profileName,
      changes: changes.map((c) => ({
        section: c.section,
        before: findBlock(existingBlocks, c.section)?.content || "",
        after: c.after
      })),
      revertedAt: null
    };
    const log = readLog(profileId);
    log.push(entry);
    writeLog(profileId, log);

    return changes;
  } catch {
    return [];
  }
}

async function afterChatComplete(ctx: AfterChatContext): Promise<AfterChatEvent[] | undefined> {
  const settings = ctx.settings as { autoEvolve?: boolean; minMessagesForAutoEvolve?: number; showToasts?: boolean };
  if (!settings.autoEvolve) return undefined;

  const agentId = ctx.request.promptProfile.id;
  const state = readState(agentId);
  state.messageCount = (state.messageCount || 0) + 1;
  writeState(agentId, state);

  const threshold = Math.max(2, Number(settings.minMessagesForAutoEvolve) || 10);
  if (state.messageCount < threshold) return undefined;

  const changes = await runEvolution(ctx, "auto");
  if (changes.length > 0) {
    writeState(agentId, { messageCount: 0 });
    const showToasts = settings.showToasts !== false;
    if (showToasts) {
      return changes.map((c) => ({
        kind: "success" as const,
        title: `${ctx.request.promptProfile.assistantName || ctx.request.promptProfile.name} evolved`,
        message: `Updated ${c.section} section.`
      }));
    }
  }
  return undefined;
}

export function evolveAgent(agentId: string, provider: ProviderConfig, recentMessages: { role: string; content: string; agentName?: string }[]) {
  const mockRequest = {
    promptProfile: { id: agentId, assistantName: "", name: "", blocks: [] as PromptBlock[] },
    provider,
    messages: recentMessages.map((m) => ({ ...m, id: "", createdAt: Date.now() })),
    modules: [],
    clientNowIso: "",
    clientTimeZone: "",
    clientLocale: ""
  } as unknown as AfterChatContext["request"];

  const mockCtx: AfterChatContext = {
    request: mockRequest,
    message: { id: "", role: "assistant", content: "", createdAt: Date.now(), agentId },
    prompt: { messages: [], activeBlocks: [], activeModules: [] },
    actionResults: [],
    settings: {}
  };

  return runEvolution(mockCtx, "manual");
}

export function getEvolutionLog(agentId: string): EvolutionEntry[] {
  return readLog(agentId);
}

export function deleteEvolutionEntry(agentId: string, entryId: string): boolean {
  const log = readLog(agentId);
  const idx = log.findIndex((e) => e.id === entryId);
  if (idx === -1) return false;
  log.splice(idx, 1);
  writeLog(agentId, log);
  return true;
}

export function revertEvolutionEntry(agentId: string, entryId: string): boolean {
  const log = readLog(agentId);
  const entry = log.find((e) => e.id === entryId && !e.revertedAt);
  if (!entry) return false;

  const agentProfile = readAgentProfile(agentId);
  if (!agentProfile) return false;

  const existingBlocks = ((agentProfile.promptProfile as Record<string, unknown>)?.blocks as PromptBlock[]) || [];
  const newBlocks = existingBlocks.map((b) => {
    const change = entry.changes.find((c) => c.section === b.id);
    return change ? { ...b, content: change.before } : b;
  });

  const updatedProfile = {
    ...agentProfile,
    promptProfile: {
      ...(agentProfile.promptProfile as Record<string, unknown> || {}),
      blocks: newBlocks
    }
  };
  writeAgentProfile(agentId, updatedProfile);

  entry.revertedAt = new Date().toISOString();
  writeLog(agentId, log);
  return true;
}

function getPromptBlocks(): PromptBlock[] {
  return [];
}

export const evolutionModule: AppModule = {
  id: "evolution",
  name: "Agent Evolution",
  description: "Analyzes conversations and evolves the agent's prompt sections to reflect learned user preferences.",
  kind: "postprocess",
  defaultEnabled: false,
  defaultSettings: {
    autoEvolve: true,
    minMessagesForAutoEvolve: 10,
    showToasts: true
  },
  hooks: {
    getPromptBlocks,
    afterChatComplete
  }
};
