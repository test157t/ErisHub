import type { PromptBlock } from "../../shared/types";
import { moduleTool, type AppModule } from "./types";

const MEDIA_CREATION_PROMPT_BLOCK: PromptBlock = {
  id: "media-creation-guidance",
  name: "Media Creation Guidance",
  enabled: true,
  role: "system",
  position: "bottom",
  priority: 18,
  content: "When the user asks for an image, use the image generation tool with a concise visual prompt. When they ask for a video, use the video generation tool with a concise motion prompt. If the user asks for media of you or your character, describe your current character/persona visually. Do not claim the media is finished until the tool result appears."
};

export const imageGenerationModule: AppModule = {
  id: "image-generation",
  name: "Media Creation",
  description: "Generate images and videos from prompts through server-side OpenAI media endpoints.",
  kind: "tool",
  defaultEnabled: false,
  defaultSettings: {
    size: "provider-default",
    videoSize: "provider-default",
    videoSeconds: 5,
    providerId: "",
    imageModel: "",
    videoModel: "",
    autoGenerateImages: true,
    autoGenerateVideos: false,
    comfyuiImageWorkflow: "",
    comfyuiVideoWorkflow: "",
    comfyuiImageToVideoWorkflow: "",
    comfyuiOutputDir: "",
    agentPrefixes: {}
  },
  tools: [moduleTool("image.generate", "Generate an image from a visual prompt."), moduleTool("video.generate", "Generate a video from a visual prompt.")],
  hooks: {
    getPromptBlocks(): PromptBlock[] {
      return [MEDIA_CREATION_PROMPT_BLOCK];
    }
  }
};
