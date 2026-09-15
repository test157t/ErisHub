import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PromptBlock } from "../../shared/types";
import type { AppModule, ModuleContext } from "./types";
import { readJsonArrayStore, writeJsonStore } from "./jsonStore";

export type SessionSummary = { id: string; title: string; summary: string; updatedAt: string };
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "session-summary");
const file = path.join(root, "summaries.json");
export async function listSummaries(): Promise<SessionSummary[]> { return readJsonArrayStore<SessionSummary>(file); }
async function saveSummaries(items: SessionSummary[]) { await writeJsonStore(file, items); }
export async function upsertSummary(input: { id?: string; title?: string; summary: string }) { const items = await listSummaries(); const id = input.id || "current"; const existing = items.findIndex((item) => item.id === id); const item = { id, title: String(input.title || "Current Chat").slice(0, 160), summary: String(input.summary || "").trim().slice(0, 8000), updatedAt: new Date().toISOString() }; if (!item.summary) throw new Error("Summary is required."); if (existing >= 0) items[existing] = item; else items.unshift(item); await saveSummaries(items); return item; }
export async function deleteSummary(id: string) { await saveSummaries((await listSummaries()).filter((item) => item.id !== id)); }

function estimateTokens(text: string) { return Math.ceil(String(text || "").length / 4); }

export const sessionSummaryModule: AppModule = { id: "session-summary", name: "Session Summary", description: "Stores compact chat summaries and injects only near provider context limit.", kind: "context", defaultEnabled: false, defaultSettings: { includeSummary: true, thresholdPercent: 80 }, hooks: { async getPromptBlocks({ request, settings }: ModuleContext): Promise<PromptBlock[]> { if (settings.includeSummary === false) return []; const contextLength = Math.max(1024, Number(request.provider.contextLength) || 8192); const maxOutput = Math.max(0, Number(request.provider.maxTokens) || 0); const threshold = Math.max(10, Math.min(100, Number(settings.thresholdPercent) || 80)) / 100; const estimatedInput = request.messages.reduce((sum, message) => sum + estimateTokens(message.content), 0) + request.promptProfile.blocks.reduce((sum, block) => sum + estimateTokens(block.content), 0); if (estimatedInput + maxOutput < contextLength * threshold) return []; const summary = (await listSummaries())[0]; if (!summary) return []; return [{ id: "session-summary-context", name: "Session Summary", enabled: true, role: "system", position: "before-history", priority: 70, content: `Current session summary:\n${summary.summary}` }]; } } };
