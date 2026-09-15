export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  agentId?: string;
  agentName?: string;
  contextNote?: string;
  classification?: ClassifyResult;
  attachments?: Array<{
    id: string;
    type: "image";
    name: string;
    url: string;
    mimeType: string;
  }>;
  mediaRequests?: Array<{ type: "image" | "video"; prompt: string }>;
  renderedMedia?: Array<{ type: "image" | "video"; src: string; alt: string; poster?: string }>;
  choices?: Array<{ id: string; prompt: string; choices: Array<{ label: string; value: string }> }>;
};

export type PromptBlock = {
  id: string;
  name: string;
  enabled: boolean;
  role: "system" | "user" | "assistant";
  position: "top" | "before-history" | "after-history" | "bottom";
  priority: number;
  content: string;
};

export type ClassifyResult = {
  label: string;
  confidence: number;
};

export type UserProfile = {
  id: string;
  name: string;
  imageUrl?: string;
  videoUrl?: string;
  videoPreviewUrl?: string;
  description?: string;
  personality?: string;
  appearance?: string;
  responseGuidelines?: string;
  preferences?: string;
  dialogueExamples?: string;
  startingMessage?: string;
};

export type PromptProfile = {
  id: string;
  name: string;
  blocks: PromptBlock[];
  assistantName?: string;
  startingMessage?: string;
  dialogueExamples?: string;
  verbosity?: number;
  providerId?: string;
  imageUrl?: string;
  videoUrl?: string;
  videoPreviewUrl?: string;
};

export type ProviderConfig = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  models: string[];
  useGrokResponsesApi: boolean;
  useManagedLlamaCpp: boolean;
  useComfyUi: boolean;
  temperature: number;
  topP: number;
  topK: number;
  minP: number;
  reasoningEffort: "none" | "low" | "medium" | "high";
  contextLength: number;
  maxTokens: number;
};

export type ModuleSettings = Record<string, unknown>;

export type ModuleConfig = {
  id: string;
  enabled: boolean;
  settings: ModuleSettings;
};

export type ChatRequest = {
  messages: ChatMessage[];
  promptProfile: PromptProfile;
  provider: ProviderConfig;
  modules: ModuleConfig[];
  generationMetadataPrefix?: string;
  clientNowIso?: string;
  clientTimeZone?: string;
  clientLocale?: string;
  discordUserId?: string;
  userName?: string;
  userProfile?: {
    description?: string;
    personality?: string;
    appearance?: string;
    responseGuidelines?: string;
    preferences?: string;
    dialogueExamples?: string;
  };
};

export type BuiltPrompt = {
  messages: Array<{ role: ChatRole; content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>; name?: string }>;
  activeBlocks: PromptBlock[];
  activeModules: string[];
};
