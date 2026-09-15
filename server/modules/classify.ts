import type { ChatMessage, ChatRequest, ClassifyResult, ModuleSettings } from "../../shared/types";
import type { AppModule } from "./types";

const GO_EMOTIONS = new Set([
  "admiration", "amusement", "anger", "annoyance", "approval",
  "caring", "confusion", "curiosity", "desire", "disappointment",
  "disapproval", "disgust", "embarrassment", "excitement", "fear",
  "gratitude", "grief", "joy", "love", "nervousness", "optimism",
  "pride", "realization", "relief", "remorse", "sadness", "surprise",
  "neutral"
]);

const EMOTION_KEYWORDS: Record<string, string[]> = {
  joy: ["happy", "joy", "excited", "glad", "great", "wonderful", "amazing", "love", "awesome", "fantastic", "delighted", "pleased", "cheerful", "grateful", "thankful", "blessed", "lucky", "laugh", "smile"],
  sadness: ["sad", "unhappy", "depressed", "sorrow", "grief", "cry", "tears", "heartbroken", "miserable", "melancholy", "blue", "down", "lonely", "alone", "loss", "miss"],
  anger: ["angry", "mad", "furious", "rage", "hate", "annoyed", "irritated", "frustrated", "outrage", "fuming", "livid", "seething", "resentful", "hostile"],
  fear: ["afraid", "fear", "scared", "terrified", "anxious", "nervous", "worried", "panic", "dread", "horror", "shaking", "trembling"],
  surprise: ["surprised", "shocked", "amazed", "astonished", "stunned", "wow", "unexpected", "startled", "astounded"],
  disgust: ["disgust", "disgusted", "gross", "nauseous", "sickened", "revolted", "repulsed", "repelled"],
  neutral: ["okay", "fine", "alright", "sure", "whatever", "meh", "normal", "average", "indifferent"]
};

function minConfidence(settings: ModuleSettings) {
  const value = Number(settings.minConfidence ?? 0);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

export function classifyText(text: string): ClassifyResult {
  const lower = text.toLowerCase();
  const words = lower.replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean);

  const scores: Record<string, number> = {};
  for (const [emotion, keywords] of Object.entries(EMOTION_KEYWORDS)) {
    if (!GO_EMOTIONS.has(emotion)) continue;
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score += 1;
      if (words.includes(kw)) score += 2;
    }
    if (score > 0) scores[emotion] = score;
  }

  let bestLabel = "neutral";
  let bestScore = 0;
  for (const [label, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestLabel = label;
    }
  }

  const total = Math.max(1, Object.values(scores).reduce((a, b) => a + b, 0));
  return {
    label: bestLabel,
    confidence: Math.min(1, bestScore / (total * 0.5))
  };
}

export function classifyAssistantMessage(message: ChatMessage, _settings: ModuleSettings): ClassifyResult | undefined {
  if (message.role !== "assistant") return undefined;
  const result = classifyText(message.content);
  return result.confidence >= minConfidence(_settings) ? result : undefined;
}

export const classifyModule: AppModule = {
  id: "classify",
  name: "Classify",
  description: "Detects assistant message sentiment labels and confidence.",
  kind: "postprocess",
  defaultEnabled: false,
  defaultSettings: {
    minConfidence: 0
  },
  hooks: {
    afterAssistantMessage: (message: ChatMessage, ctx: { request: ChatRequest; settings: ModuleSettings }) => classifyAssistantMessage(message, ctx.settings)
  }
};
