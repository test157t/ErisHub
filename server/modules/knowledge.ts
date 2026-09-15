import type { PromptBlock } from "../../shared/types";
import { moduleTool, type AppModule, type ModuleContext } from "./types";
import { listMemories } from "./memory";
import { retrievalModule } from "./retrieval";
import { assistantFilesPromptBlocks, getUserProfile } from "./coreAssistant";

function listBlock(title: string, items: string[]) { return `${title}:\n${items.length ? items.join("\n") : "None."}`; }

function memoryScopeLabel(scope: string, context: ModuleContext) {
  if (scope === "agent") return context.request.promptProfile.assistantName || context.request.promptProfile.name || "Assistant";
  if (scope === "global") return "Shared";
  return context.request.userName || "User";
}

export const memoryBankModule: AppModule = {
  id: "memory-bank",
  name: "Memory Bank",
  description: "Saved facts, notes, profile details, and referenced files for persistent context.",
  kind: "context",
  defaultEnabled: false,
  defaultSettings: {
    allowModelCreate: true,
    maxMemories: 12,
    maxNotes: 8,
    retrievalMaxMemories: 5,
    retrievalMaxNotes: 3,
    retrievalMaxDocuments: 3,
    fileQuery: "",
    fileMaxExcerpts: 4,
    maxAssistantFiles: 12
  },
  tools: [moduleTool("memory.create", "Store a durable memory for the active user, agent, or shared context.", ["text"]), moduleTool("note.create", "Create a persistent note.", ["title"]), moduleTool("note.append", "Append content to a persistent note.", ["id"]), moduleTool("file.search", "Search indexed library documents.", ["query"]), moduleTool("file.get", "Retrieve an indexed document by id.", ["id"]), moduleTool("assistant-file.create", "Create an assistant-managed file."), moduleTool("assistant-file.update", "Replace an assistant-managed file.", ["id"]), moduleTool("assistant-file.delete", "Delete an assistant-managed file.", ["id"]), moduleTool("profile.update", "Update a saved user profile detail.", ["key"])],
  hooks: {
    async getPromptBlocks(context: ModuleContext): Promise<PromptBlock[]> {
      const settings = context.settings;
      const memories = listMemories(context.request.promptProfile.id).slice(0, Math.max(1, Math.min(30, Number(settings.maxMemories) || 12)));
      const profile = await getUserProfile();
      const profileFacts = Object.entries(profile.facts).map(([key, value]) => `- ${key}: ${value}`);
      const memoryBlock: PromptBlock = {
        id: "memory-bank-context",
        name: "Memory Bank",
        enabled: true,
        role: "system",
        position: "after-history",
        priority: 80,
        content: [
          listBlock("Saved facts", memories.map((item) => `- [${memoryScopeLabel(item.scope, context)}] ${item.text}${item.tags ? ` (tags: ${item.tags})` : ""}`)),
          listBlock("Profile details", profileFacts),
          settings.allowModelCreate === false ? "" : `Use the memory and note tools for durable facts. Use scope="user" for ${context.request.userName || "the user"}, scope="agent" for ${context.request.promptProfile.assistantName || context.request.promptProfile.name || "the assistant"}, and scope="global" for shared facts.`
        ].filter(Boolean).join("\n")
      };
      const retrievalBlocks = await retrievalModule.hooks!.getPromptBlocks!({ ...context, settings: {
        maxMemories: 0,
        maxNotes: settings.maxNotes,
        maxDocuments: Math.max(Number(settings.retrievalMaxDocuments) || 0, Number(settings.fileMaxExcerpts) || 0),
        documentQuery: settings.fileQuery
      } });
      const assistantFileBlocks = assistantFilesPromptBlocks(context, { allowModelCreate: settings.allowModelCreate, maxFiles: settings.maxAssistantFiles });
      return [memoryBlock, ...retrievalBlocks, ...assistantFileBlocks];
    }
  }
};
