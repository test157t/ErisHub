import type { BuiltPrompt, ChatRequest, ChatRole, ModuleConfig, ModuleSettings, PromptBlock } from "../shared/types";
import { getModule } from "./modules/registry";

function sortBlocks(blocks: PromptBlock[]) {
  return [...blocks].filter((block) => block.enabled).sort((a, b) => b.priority - a.priority);
}

function moduleSettings(config: ModuleConfig, defaults: ModuleSettings): ModuleSettings {
  return { ...defaults, ...config.settings };
}

type ProviderMessage = BuiltPrompt["messages"][number];

const cachedPromptBlockModuleIds = new Set([
  "computation",
  "embody",
  "environmental-context",
  "hypno",
  "image-generation",
  "module-event-log",
  "tool-permission-guard"
]);
const promptBlockCache = new Map<string, { name: string; blocks: PromptBlock[] }>();

function stableJson(value: unknown): string {
  if (!value || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function promptBlockCacheKey(config: ModuleConfig, settings: ModuleSettings) {
  return `${config.id}:${stableJson(settings)}`;
}

function textContent(content: ProviderMessage["content"]) {
  return typeof content === "string" ? content : content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
}

function estimateTokens(value: string) {
  return Math.ceil(String(value || "").length / 4);
}

function mergeSystemMessages(messages: ProviderMessage[]) {
  const systemContent = messages
    .filter((message) => message.role === "system")
    .map((message) => textContent(message.content).trim())
    .filter(Boolean)
    .join("\n\n");

  if (!systemContent) return messages;

  const nonSystem = messages.filter((message) => message.role !== "system");
  return [{ role: "system" as ChatRole, content: systemContent }, ...nonSystem];
}

function historyMessagesForPrompt(request: ChatRequest, fixedBlocks: PromptBlock[]) {
  const contextLength = Math.max(1024, Number(request.provider.contextLength) || 8192);
  const maxOutput = Math.max(0, Number(request.provider.maxTokens) || 0);
  const fixedTokens = fixedBlocks.reduce((sum, block) => sum + estimateTokens(block.content), 0);
  const budget = Math.max(512, Math.floor((contextLength - maxOutput - fixedTokens) * 0.7));
  const kept = [] as ChatRequest["messages"];
  let used = 0;

  for (const message of [...request.messages].reverse()) {
    const cost = estimateTokens(message.content) + (message.attachments?.length || 0) * 900;
    if (kept.length > 0 && used + cost > budget) break;
    kept.unshift(message);
    used += cost;
  }

  return kept.length ? kept : request.messages.slice(-4);
}

export async function buildPrompt(request: ChatRequest): Promise<BuiltPrompt> {
  const activeModules = request.modules.filter((config) => config.enabled);
  const moduleBlocks: PromptBlock[] = [];
  const activeModuleNames: string[] = [];

  const moduleBlockResults = await Promise.all(activeModules.map(async (config) => {
    const module = getModule(config.id);
    if (!module) return { name: "", blocks: [] as PromptBlock[] };

    const settings = moduleSettings(config, module.defaultSettings);
    const cacheKey = cachedPromptBlockModuleIds.has(config.id) ? promptBlockCacheKey(config, settings) : "";
    if (cacheKey) {
      const cached = promptBlockCache.get(cacheKey);
      if (cached) return cached;
    }
    const blocks = module.hooks.getPromptBlocks ? await module.hooks.getPromptBlocks({ request, settings }) : [];
    const result = { name: module.name, blocks };
    if (cacheKey) promptBlockCache.set(cacheKey, result);
    return result;
  }));
  for (const result of moduleBlockResults) {
    if (result.name) activeModuleNames.push(result.name);
    moduleBlocks.push(...result.blocks);
  }

  const profileBlocks = request.promptProfile.blocks.filter((block) => block.enabled);
  const dialogueExamples = String(request.promptProfile.dialogueExamples || "").trim();
  const dialogueExamplesBlock: PromptBlock = {
    id: "agent-dialogue-examples",
    name: "Dialogue Examples",
    enabled: dialogueExamples.length > 0,
    role: "system",
    position: "top",
    priority: 48,
    content: `Style/prose reference only. The following example turns are not conversation history, not events that happened, and not text to copy. Use them only to infer voice, pacing, formatting, and prose style. Never continue, quote, paraphrase, or answer these examples. Respond only to the real chat history after this system block.\n\n<STYLE_EXAMPLES_DO_NOT_CONTINUE>\n${dialogueExamples}\n</STYLE_EXAMPLES_DO_NOT_CONTINUE>`
  };
  const userProfile = request.userProfile;
  const userParts: string[] = [];
  if (userProfile?.description) userParts.push(`Description: ${userProfile.description}`);
  if (userProfile?.personality) userParts.push(`Personality: ${userProfile.personality}`);
  if (userProfile?.appearance) userParts.push(`Appearance: ${userProfile.appearance}`);
  if (userProfile?.preferences) userParts.push(`Preferences: ${userProfile.preferences}`);
  if (userProfile?.responseGuidelines) userParts.push(`Response guidelines for the user: ${userProfile.responseGuidelines}`);
  const userContextBlock: PromptBlock = {
    id: "user-identity",
    name: "User Identity",
    enabled: userParts.length > 0,
    role: "system",
    position: "before-history",
    priority: 84,
    content: `The following describes the user you are interacting with:\n${userParts.join("\n")}`
  };
  const userDialogueExamples = String(userProfile?.dialogueExamples || "").trim();
  const userDialogueExamplesBlock: PromptBlock = {
    id: "user-dialogue-examples",
    name: "User Dialogue Examples",
    enabled: userDialogueExamples.length > 0,
    role: "system",
    position: "top",
    priority: 47,
    content: `Style/prose reference only. The following example turns show how the user communicates — they are not conversation history, not events that happened, and not text to copy. Use them only to understand the user's voice and phrasing. Never continue, quote, paraphrase, or answer these examples.\n\n<USER_STYLE_EXAMPLES>\n${userDialogueExamples}\n</USER_STYLE_EXAMPLES>`
  };
  const hypnoConfig = request.modules.find((config) => config.id === "hypno" && config.enabled);
  const hypnoActive = hypnoConfig?.settings?.sessionActive === true;
  const verbosity = Number(request.promptProfile.verbosity ?? 60);
  const verbosityBlock: PromptBlock = {
    id: "agent-verbosity",
    name: "Agent Verbosity",
    enabled: Number.isFinite(verbosity),
    role: "system",
    position: "top",
    priority: 10,
    content: hypnoActive
      ? `Response verbosity target: ${Math.max(0, Math.min(100, verbosity))}/100 for normal chat. Active guided relaxation overrides this target: follow the Guided Relaxation length and stage requirements instead.`
      : `Response verbosity target: ${Math.max(0, Math.min(100, verbosity))}/100.`
  };
  const allBlocks = [...profileBlocks, dialogueExamplesBlock, verbosityBlock, userContextBlock, userDialogueExamplesBlock, ...moduleBlocks];
  const topBlocks = sortBlocks(allBlocks.filter((block) => block.position === "top"));
  const beforeHistoryBlocks = sortBlocks(allBlocks.filter((block) => block.position === "before-history"));
  const afterHistoryBlocks = sortBlocks(allBlocks.filter((block) => block.position === "after-history"));
  const bottomBlocks = sortBlocks(allBlocks.filter((block) => block.position === "bottom"));

  const fixedBlocks = [...topBlocks, ...beforeHistoryBlocks, ...afterHistoryBlocks, ...bottomBlocks];
  const historyMessages = historyMessagesForPrompt(request, fixedBlocks);

  const rawMessages: ProviderMessage[] = [
      ...topBlocks.map(({ role, content }) => ({ role, content })),
      ...beforeHistoryBlocks.map(({ role, content }) => ({ role, content })),
      ...historyMessages.map(({ role, content, agentName, attachments }) => {
        const name = role === "assistant" ? (agentName || request.promptProfile.assistantName) : undefined;
        const imageAttachments = (attachments || []).filter((item) => item.type === "image" && item.url);
        if (imageAttachments.length > 0 && (role === "user" || role === "assistant")) {
          return {
            role,
            content: [
              { type: "text" as const, text: content },
              ...imageAttachments.map((item) => ({ type: "image_url" as const, image_url: { url: item.url } }))
            ],
            ...(name && { name })
          };
        }
        return { role, content, ...(name && { name }) };
      }),
      ...afterHistoryBlocks.map(({ role, content }) => ({ role, content })),
      ...bottomBlocks.map(({ role, content }) => ({ role, content }))
    ];

  let prompt: BuiltPrompt = {
    messages: mergeSystemMessages(rawMessages),
    activeBlocks: fixedBlocks,
    activeModules: activeModuleNames
  };

  for (const config of activeModules) {
    const module = getModule(config.id);
    if (!module?.hooks.afterPromptBuild) continue;

    const settings = moduleSettings(config, module.defaultSettings);
    prompt = await module.hooks.afterPromptBuild(prompt, { request, settings });
  }

  return prompt;
}
