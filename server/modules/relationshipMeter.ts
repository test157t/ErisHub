import type { PromptBlock } from "../../shared/types";
import type { AppModule, ModuleContext } from "./types";

const meterKeys = ["relationshipLevel", "affinity", "trust", "comfort", "familiarity", "attraction", "chemistry", "romance", "intimacy", "devotion", "arousal", "tension", "irritation", "jealousy"];
const relationshipMoods = new Set(["admiration", "amusement", "anger", "annoyance", "approval", "caring", "confusion", "curiosity", "desire", "disappointment", "disapproval", "disgust", "embarrassment", "excitement", "fear", "gratitude", "grief", "joy", "love", "nervousness", "optimism", "pride", "realization", "relief", "remorse", "sadness", "surprise", "neutral", "aroused"]);

function clampMeter(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : fallback;
}

function clampRelationshipLevel(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(-100, Math.min(100, Math.round(number))) : fallback;
}

function relationshipTier(level: number) {
  if (level <= -75) return "enemy";
  if (level <= -45) return "hostile";
  if (level <= -15) return "wary";
  if (level < 15) return "stranger";
  if (level < 35) return "acquaintance";
  if (level < 60) return "friend";
  if (level < 80) return "close friend";
  return "intimate";
}

function relationshipStage(level: number) {
  if (level <= -75) return "adversarial";
  if (level <= -45) return "hostile";
  if (level <= -15) return "guarded";
  if (level < 15) return "neutral";
  if (level < 35) return "positive";
  if (level < 60) return "affectionate";
  if (level < 80) return "close";
  return "deeply attached";
}

function relationshipMood(value: unknown) {
  const mood = String(value || "neutral").trim();
  return relationshipMoods.has(mood) ? mood : "neutral";
}

function promptMeterLine(key: string, entry: ReturnType<typeof relationshipEntry>, includeNumbers: boolean) {
  const value = entry[key as keyof typeof entry];
  if (!includeNumbers) return `- ${key}: ${value}`;
  return key === "relationshipLevel" ? `- ${key}: ${value}/-100..100` : `- ${key}: ${value}/100`;
}

function relationshipEntry(settings: Record<string, unknown>, agentId: string, agentName: string) {
  const relationships = settings.relationships && typeof settings.relationships === "object" && !Array.isArray(settings.relationships) ? settings.relationships as Record<string, unknown> : {};
  const raw = relationships[agentId] || relationships[agentName] || {};
  const entry = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return {
    mood: relationshipMood(entry.mood),
    relationshipLevel: clampRelationshipLevel(entry.relationshipLevel, 0),
    affinity: clampMeter(entry.affinity, 50),
    trust: clampMeter(entry.trust, 50),
    comfort: clampMeter(entry.comfort, 50),
    familiarity: clampMeter(entry.familiarity, 0),
    attraction: clampMeter(entry.attraction, 0),
    chemistry: clampMeter(entry.chemistry, 0),
    romance: clampMeter(entry.romance, 0),
    intimacy: clampMeter(entry.intimacy, 0),
    devotion: clampMeter(entry.devotion, 0),
    arousal: clampMeter(entry.arousal, 0),
    tension: clampMeter(entry.tension, 0),
    irritation: clampMeter(entry.irritation, 0),
    jealousy: clampMeter(entry.jealousy, 0)
  };
}

export const relationshipMeterModule: AppModule = {
  id: "relationship-meter",
  name: "Relationship Meter",
  description: "Per-agent relationship continuity meters for state, mood, affection, bonding, intimacy, friction, and arousal.",
  kind: "context",
  defaultEnabled: false,
  defaultSettings: {
    showInPrompt: true,
    showNumbersToModel: true,
    analyzerAgentId: "",
    relationships: {}
  },
  hooks: {
    getPromptBlocks(ctx: ModuleContext): PromptBlock[] {
      if (ctx.settings.showInPrompt === false) return [];
      const profiles = ctx.request.promptProfile ? [ctx.request.promptProfile] : [];
      const blocks = profiles.map((profile) => {
        const agentId = String(profile.id || "");
        const agentName = String(profile.assistantName || profile.name || agentId || "Assistant");
        const entry = relationshipEntry(ctx.settings, agentId, agentName);
        const tier = relationshipTier(entry.relationshipLevel);
        const stage = relationshipStage(entry.relationshipLevel);
        const numbers = meterKeys.map((key) => promptMeterLine(key, entry, ctx.settings.showNumbersToModel !== false)).join("\n");
        return {
          id: `relationship-meter-${agentId || agentName}`,
          name: "Relationship Meter",
          enabled: true,
          role: "system" as const,
          position: "bottom" as const,
          priority: 52,
          content: [
            `Relationship continuity for ${agentName}:`,
            `- mood: ${entry.mood}`,
            `- tier: ${tier}`,
            `- relationshipState: ${stage}`,
            numbers,
            "Use this as private continuity. Do not mention meter names or numeric values unless the user asks. Let it subtly affect tone, boundaries, warmth, and caution."
          ].join("\n")
        };
      });
      return blocks;
    }
  }
};
