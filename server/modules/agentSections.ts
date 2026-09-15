import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { statSync } from "node:fs";
import path from "node:path";
import { appDataRoot } from "./assets";

export const agentsRoot = path.join(appDataRoot, "agents");

function safeAgentFolderName(value: string) {
  return value.trim().replace(/[<>:"/\\|?*]/g, "_") || "Agent";
}

function readJsonFile(filePath: string) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function listAgentFolders() {
  if (!existsSync(agentsRoot)) return [];
  return readdirSync(agentsRoot).flatMap((entry) => {
    const folder = path.join(agentsRoot, entry);
    if (!statSync(folder).isDirectory()) return [];
    const jsonFile = readdirSync(folder).find((file) => file.endsWith(".json") && file !== "_index.json");
    if (!jsonFile) return [];
    try {
      const agent = readJsonFile(path.join(folder, jsonFile));
      return agent && typeof agent === "object" && !Array.isArray(agent) ? [{ folder, folderName: entry, agent: agent as Record<string, unknown> }] : [];
    } catch {
      return [];
    }
  });
}

export function findAgentFolderSync(agentIdOrName: string) {
  const key = String(agentIdOrName || "").trim();
  if (!key) return null;
  const normalizedKey = key.toLowerCase();
  for (const entry of listAgentFolders()) {
    const id = String(entry.agent.id || "");
    const names = [String(entry.agent.name || ""), String(entry.agent.assistantName || ""), entry.folderName].filter(Boolean);
    if (id === key || names.some((name) => name === key || name.toLowerCase() === normalizedKey)) return entry;
  }
  return null;
}

export function ensureAgentFolderSync(agent: Record<string, unknown>) {
  const existing = findAgentFolderSync(String(agent.id || agent.name || ""));
  if (existing) return existing;
  const folderName = safeAgentFolderName(String(agent.name || agent.assistantName || agent.id || "Agent"));
  const folder = path.join(agentsRoot, folderName);
  mkdirSync(folder, { recursive: true });
  return { folder, folderName, agent };
}

export function readAgentSection<T>(agentIdOrName: string, section: string, fileName: string, defaultValue: T): T {
  const found = findAgentFolderSync(agentIdOrName);
  if (!found) return defaultValue;
  const filePath = path.join(found.folder, section, fileName);
  if (!existsSync(filePath)) return defaultValue;
  return readJsonFile(filePath) as T;
}

export function writeAgentSection(agentIdOrName: string, section: string, fileName: string, value: unknown) {
  const found = findAgentFolderSync(agentIdOrName);
  if (!found) throw new Error("Agent not found.");
  const sectionFolder = path.join(found.folder, section);
  mkdirSync(sectionFolder, { recursive: true });
  const filePath = path.join(sectionFolder, fileName);
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(value)}\n`, "utf8");
  renameSync(tmpPath, filePath);
}

export function removeAgentSectionFile(agentIdOrName: string, section: string, fileName: string) {
  const found = findAgentFolderSync(agentIdOrName);
  if (!found) return;
  rmSync(path.join(found.folder, section, fileName), { force: true });
}
