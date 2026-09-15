import type { BuiltPrompt, ChatMessage, ChatRequest, ClassifyResult, ModuleSettings, PromptBlock } from "../../shared/types";

export type ModuleKind = "prompt" | "context" | "tool" | "postprocess" | "media" | "automation" | "entertainment";

export type ModuleContext = {
  request: ChatRequest;
  settings: ModuleSettings;
};

export type AfterChatEvent = {
  kind: "info" | "success";
  title: string;
  message: string;
};

export type AfterChatContext = {
  request: ChatRequest;
  message: ChatMessage;
  prompt: BuiltPrompt;
  actionResults: unknown[];
  settings: ModuleSettings;
};

export type ModuleTool = {
  action: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export function moduleTool(action: string, description: string, required: string[] = []): ModuleTool {
  return {
    action,
    description,
    inputSchema: {
      type: "object",
      properties: {
        body: { type: "string", description: "Optional body content for this tool." },
        id: { type: "string" }, query: { type: "string" }, title: { type: "string" }, content: { type: "string" }, prompt: { type: "string" }, expression: { type: "string" }, text: { type: "string" }, name: { type: "string" }, status: { type: "string" }, note: { type: "string" }, at: { type: "string" }, startsAt: { type: "string" }, endsAt: { type: "string" }, root: { type: "string" }, file: { type: "string" }, code: { type: "string" }, scope: { type: "string" }, tags: { type: "string" }, user: { type: "string" }, message: { type: "string" }, kind: { type: "string" }, src: { type: "string" }, alt: { type: "string" }, poster: { type: "string" }, choices: { type: "array", items: { type: "object", properties: { label: { type: "string" }, value: { type: "string" } }, required: ["label"] } }
      },
      required,
      additionalProperties: true
    }
  };
}

export type AppModule = {
  id: string;
  name: string;
  description: string;
  kind: ModuleKind;
  defaultEnabled: boolean;
  defaultSettings: ModuleSettings;
  tools?: ModuleTool[];
  hooks: {
    getPromptBlocks?: (ctx: ModuleContext) => Promise<PromptBlock[]> | PromptBlock[];
    afterPromptBuild?: (prompt: BuiltPrompt, ctx: ModuleContext) => Promise<BuiltPrompt> | BuiltPrompt;
    afterAssistantMessage?: (message: ChatMessage, ctx: ModuleContext) => Promise<ClassifyResult | undefined> | ClassifyResult | undefined;
    afterChatComplete?: (ctx: AfterChatContext) => Promise<AfterChatEvent[] | undefined>;
  };
};
