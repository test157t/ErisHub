import type { ProviderConfig } from "../../shared/types";
import { findAgentFolderSync } from "./agentSections";
import { completeProvider } from "./providerCompletion";

function agentSystemPrompt(agentName: string) {
  const found = findAgentFolderSync(agentName);
  const agent = found?.agent;
  if (!agent) return `You are ${agentName}. Respond concisely to the following task from another agent.`;
  const displayName = String(agent.assistantName || agent.name || found.folderName || agentName);
  const blocks = Array.isArray(agent.blocks) ? agent.blocks : [];
  const blockText = blocks
    .filter((block) => block && typeof block === "object" && (block as { enabled?: unknown }).enabled !== false)
    .map((block) => {
      const item = block as { name?: unknown; content?: unknown };
      return [`Section: ${String(item.name || "Profile")}`, String(item.content || "").trim()].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 12000);
  return [`You are ${displayName}. You are being delegated a subtask by another agent. Complete only the delegated subtask and return concise, actionable results.`, blockText].filter(Boolean).join("\n\n");
}

export async function callAgent(provider: ProviderConfig, agentName: string, task: string, maxTokens = 500) {
  return completeProvider(provider, [
    { role: "system", content: agentSystemPrompt(agentName) },
    { role: "user", content: task }
  ], { temperature: Number(provider.temperature) || 0.7, maxTokens });
}
