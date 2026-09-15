import type { PromptBlock } from "../../shared/types";
import { moduleTool, type AppModule, type ModuleContext } from "./types";

const spiralPresets = ["none", "classic-vortex", "soft-orbital", "breathing-ring", "deep-tunnel", "pendulum"];
const STAGE_NAMES = ["induction", "deepener", "body", "reinforcement", "ending"];
const techniqueCatalog = [
  {
    stage: "induction",
    techniques: [
      "breath pacing: slow exhale-led breathing, used when the user wants calm, grounding, or sleep",
      "progressive relaxation: release muscles by region, used when tension or body awareness is central",
      "attention fixation: soft gaze, sound, visual point, or breath anchor, used when focus is scattered",
      "safe-place imagery: stable sensory environment, used when comfort and emotional safety matter"
    ]
  },
  {
    stage: "deepener",
    techniques: [
      "countdown descent: gradual numbers, stairs, elevator, waves, or sinking, used for clear deepening structure",
      "fractionation: briefly rise and settle deeper again, used after readiness or when the user likes layered trance",
      "confusion softening: gentle loops, pattern breaks, and permissive ambiguity, used only when pacing is confusion or requested",
      "somatic heaviness/lightness: contrast weight, warmth, floating, or spaciousness, used when body signals are present"
    ]
  },
  {
    stage: "body",
    techniques: [
      "body scan: move attention through regions with warmth, numbness, softness, or ease",
      "phantom touch suggestion: indirect tactile expectation, tingles, pressure, distance, warmth, and attention shifts",
      "resource imagery: place, object, color, or sensation that embodies the requested outcome",
      "responsive pacing: mirror the user's feedback and adjust intensity, speed, and sensory channel"
    ]
  },
  {
    stage: "reinforcement",
    techniques: [
      "anchor binding: connect the desired state to breath, phrase, gesture, image, or sound",
      "future pacing: rehearse using the desired state after the session",
      "identity-consistent suggestion: phrase benefits as already fitting the user's values and goals",
      "repetition with variation: repeat core suggestions in new sensory language without sounding copied"
    ]
  },
  {
    stage: "ending",
    techniques: [
      "awakening count-up: gradual orientation, energy return, and environmental awareness",
      "sleep transition: reduce interaction, soften language, and leave the user resting if sleep is the ending",
      "continue-state aftercare: keep calm available while ending formal trance mode",
      "grounding close: name body, room, breath, and choice when the user was overwhelmed or paused"
    ]
  }
];

export function techniqueCatalogText() {
  return techniqueCatalog.map((item) => `- ${item.stage}: ${item.techniques.join("; ")}.`).join("\n");
}

function hasExplicitHypnoField(actionResults: Array<{ action?: { type: string }; status: string; result?: unknown }>, field: string): boolean {
  for (const result of actionResults) {
    if (result.status !== "executed") continue;
    if (!String(result.action?.type || "").startsWith("hypno.")) continue;
    const payload = result.result as Record<string, unknown> | undefined;
    const settings = payload?.settings as Record<string, unknown> | undefined;
    if (settings && field in settings) return true;
  }
  return false;
}

export function inferHypnoSessionSettings(
  currentSettings: Record<string, unknown>,
  responseContent: string,
  actionResults: Array<{ action?: { type: string }; status: string; result?: unknown }>
): Record<string, unknown> {
  if (currentSettings.sessionActive !== true) return {};

  const patches: Record<string, unknown> = {};
  const lower = responseContent.replace(/<action\s+[^>]*?(?:\/>|>[\s\S]*?<\/action>)/gi, "").toLowerCase();

  // --- Stage inference ---
  if (!hasExplicitHypnoField(actionResults, "sessionStage")) {
    const currentStage = String(currentSettings.sessionStage || "").toLowerCase();
    const stagePatterns = [
      /\b(move|shift|proceed|advance|transition|progress|go|head|cross)\s+(?:to|into|toward|onto)\s+(?:the\s+)?(deepener|body|reinforcement|ending)\b/i,
      /\b(enter|begin|start)\s+(?:the\s+)?(deepener|body|reinforcement|ending)\b/i,
      /\b(let'?s|time\s+to|ready\s+for)\s+(?:move|transition|progress|go)\s+(?:to|into)\s+(?:the\s+)?(deepener|body|reinforcement|ending)\b/i,
      /\bnext\s+(?:stage|phase|step)[:\s]+(deepener|body|reinforcement|ending)\b/i,
    ];
    for (const pattern of stagePatterns) {
      const match = lower.match(pattern);
      if (match) {
        const inferred = (match[2] || match[1]).toLowerCase();
        if (STAGE_NAMES.includes(inferred)) {
          patches.sessionStage = inferred;
          patches.sessionStageProgress = 0;
          patches.sessionReadiness = "";
          patches.sessionFeedback = "";
          break;
        }
      }
    }
    if (!("sessionStage" in patches) && !currentStage) {
      if (/\b(?:begin|start|induction)\b/i.test(lower) && /(?:relax|trance|breathe|close.your.eyes|settle)/i.test(lower)) {
        patches.sessionStage = "induction";
      }
    }
  }

  // --- Progress inference ---
  if (!hasExplicitHypnoField(actionResults, "sessionStageProgress")) {
    const pct = lower.match(/(\d+)\s*%/);
    if (pct) {
      const val = parseInt(pct[1], 10);
      if (val > 0 && val <= 100) patches.sessionStageProgress = val;
    } else if (patches.sessionStage && !("sessionStageProgress" in patches)) {
      patches.sessionStageProgress = 0;
    } else {
      const phrases: Array<[RegExp, number]> = [
        [/\bjust\s+beginning\b/i, 5], [/\bearly\s+(stage|phase|part)\b/i, 10],
        [/\bquarter\s+way|quarter\s+through|twenty.{0,4}five\b/i, 25],
        [/\ba\s+third|thirty.{0,4}three\b/i, 33],
        [/\bhalfway|half\s+way|middle\s+of|fifty\b/i, 50],
        [/\bseventy|three\s+quarter\b/i, 70],
        [/\bnearly?\s+done|almost\s+done|almost\s+there|wrapping\s+up|final\s+(stage|phase|part)\b/i, 85],
        [/\bcomplete|finished|done\s+with\b/i, 95],
      ];
      for (const [regex, val] of phrases) {
        if (regex.test(lower)) {
          patches.sessionStageProgress = val;
          break;
        }
      }
    }
  }

  // --- Readiness inference ---
  if (!hasExplicitHypnoField(actionResults, "sessionReadiness")) {
    const match = lower.match(/\byou(?:'re| are| seem| feel| look| sound)\s+(?:so|very|feeling|feel|looking?|seem|appear|sound)\s*(settled|calm|relaxed|peaceful|heavy|warm|numb|floaty|floating|drifting|deep|under|ready|drowsy|sleepy|spacious|sinking)\b/i);
    if (match) {
      const state = match[1].toLowerCase();
      if (state) patches.sessionReadiness = state;
    } else if ("sessionStage" in patches && patches.sessionStage !== String(currentSettings.sessionStage || "").toLowerCase()) {
      patches.sessionReadiness = "ready";
    }
  }

  // --- Feedback inference ---
  if (!hasExplicitHypnoField(actionResults, "sessionFeedback")) {
    const fbMatch = lower.match(/\byou(?:'re| are)\s+(?:feeling|starting to feel|beginning to|tell me you)\s+(.+?)\./i);
    if (fbMatch) {
      const fb = fbMatch[1].trim().slice(0, 120);
      if (fb) patches.sessionFeedback = fb;
    }
  }

  return patches;
}

function turnLengthGuidance(paragraphLength: string) {
  if (paragraphLength === "novel") return "For active sessions, write a novel-length immersive segment for the current stage, roughly 24-40 slow paragraphs when token budget allows. Use layered imagery, repeated anchors, gradual state changes, and rich continuity. This is still only the current stage, not the whole session.";
  if (paragraphLength === "marathon") return "For active sessions, write a long immersive segment for the current stage, roughly 14-22 slow paragraphs when token budget allows. This is still only the current stage, not the whole session.";
  return "For active sessions, write a substantial long-form immersive segment for the current stage, roughly 9-14 slow paragraphs when token budget allows. Use repetition with variation, pauses, sensory anchors, and gradual deepening. Do not compress the stage into a short response.";
}

function textSetting(value: unknown, fallback: string) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function boolLine(enabled: boolean, text: string) {
  return enabled ? `- ${text}` : "";
}

function moduleEnabled(ctx: ModuleContext, id: string) {
  return ctx.request.modules.some((moduleConfig) => moduleConfig.id === id && moduleConfig.enabled);
}

export const hypnoModule: AppModule = {
  id: "hypno",
  name: "Guided Relaxation",
  description: "Guided relaxation and hypnotic experience design: pacing, structure, spirals, whispers, breath cues, ambience, and Call Mode effects.",
  kind: "entertainment",
  defaultEnabled: false,
  defaultSettings: {
    sessionActive: false,
    sessionPaused: false,
    sessionStyle: "",
    sessionShape: "interactive-staged",
    sessionEnding: "",
    sessionStage: "",
    sessionStageProgress: 0,
    sessionReadiness: "",
    sessionFeedback: "",
    sessionUserSignal: "",
    sessionModelDecision: "",
    sessionNextInstruction: "",
    sessionTechnique: "",
    sessionStageGoal: "",
    sessionCheckInPrompt: "",
    sessionCandidateBranchesJson: "[]",
    sessionSelectedBranchId: "",
    sessionSelectedBranchScore: 0,
    sessionSelectedBranchEffectsJson: "{}",
    sessionBranchReason: "",
    sessionDirectorNote: "",
    sessionPathJson: "[]",
    sessionPreferenceNotes: "",
    sessionMemoryCandidate: "",
    sessionLastSavedMemoryCandidate: "",
    sessionStrategyNotes: "",
    sessionCreativeNotes: "",
    sessionAwaitingFeedback: false,
    sessionTurnCount: 0,
    sessionStageTurnCount: 0,
    sessionContract: "",
    sessionContractAnalysis: "",
    sessionContractStatus: "",
    trackerAgentId: "",
    preferenceAgentId: "",
    contractAgentId: "",
    strategyAgentId: "",
    creativeAgentId: "",
    pacing: "slow",
    paragraphLength: "long",
    breathworkEnabled: true,
    callModeSyncEnabled: true,
    allowModelControl: true,
    overlayEnabled: true,
    effectsEnabled: true,
    particlesEnabled: true,
    particleStyle: "snow",
    particleCount: 250,
    particleFallRate: 1,
    particleImpactRate: 1,
    fireflyGlow: 1,
    visualWhispersEnabled: true,
    visualWhispers: "breathe for me\nsoftly sinking\nlet go\ndeeper now",
    spokenWhispersEnabled: false,
    spiralEnabled: false,
    spiralPreset: "none",
    snapSfxEnabled: true,
    ambientEnabled: true,
    breathCuesEnabled: true,
    breathGuidanceEnabled: true,
    breathGuidanceLeadMs: 260
  },
  tools: [
    moduleTool("hypno.session.configure", "Configure the guided relaxation session."), moduleTool("hypno.session.start", "Start the configured guided relaxation session."), moduleTool("hypno.session.stage", "Set the current guided relaxation stage."), moduleTool("hypno.session.update", "Update guided relaxation state and feedback."), moduleTool("hypno.session.progress", "Record guided relaxation stage progress."), moduleTool("hypno.session.checkpoint", "Record a guided relaxation readiness checkpoint."), moduleTool("hypno.session.pause", "Pause the guided relaxation session."), moduleTool("hypno.session.resume", "Resume the guided relaxation session."), moduleTool("hypno.session.end", "End the guided relaxation session."), moduleTool("hypno.spiral.select", "Select a guided relaxation visual spiral preset."), moduleTool("hypno.whispers.set", "Set guided relaxation whisper cues."), moduleTool("hypno.whisper.add", "Add a guided relaxation whisper cue."), moduleTool("hypno.particles.set", "Set guided relaxation particle effects."), moduleTool("hypno.choices", "Render a guided-session choice prompt.", ["choices"])
  ],
  hooks: {
    getPromptBlocks(ctx: ModuleContext): PromptBlock[] {
      const { settings } = ctx;
      const pacing = textSetting(settings.pacing, "slow");
      const paragraphLength = textSetting(settings.paragraphLength, "long");
      const sessionActive = settings.sessionActive === true;
      const sessionPaused = settings.sessionPaused === true;
      const sessionStyle = textSetting(settings.sessionStyle, "not set");
      const sessionShape = textSetting(settings.sessionShape, "not set");
      const sessionEnding = textSetting(settings.sessionEnding, "not set");
      const sessionStage = textSetting(settings.sessionStage, "not set");
      const sessionStageProgress = Math.max(0, Math.min(100, Number(settings.sessionStageProgress) || 0));
      const sessionReadiness = textSetting(settings.sessionReadiness, "not set");
      const sessionFeedback = textSetting(settings.sessionFeedback, "not set");
      const sessionUserSignal = textSetting(settings.sessionUserSignal, "not set");
      const sessionModelDecision = textSetting(settings.sessionModelDecision, "not set");
      const sessionNextInstruction = textSetting(settings.sessionNextInstruction, "not set");
      const sessionTechnique = textSetting(settings.sessionTechnique, "not set");
      const sessionStageGoal = textSetting(settings.sessionStageGoal, "not set");
      const sessionCheckInPrompt = textSetting(settings.sessionCheckInPrompt, "not set");
      const sessionCandidateBranchesJson = textSetting(settings.sessionCandidateBranchesJson, "[]");
      const sessionSelectedBranchId = textSetting(settings.sessionSelectedBranchId, "not set");
      const sessionSelectedBranchScore = Math.max(0, Math.min(100, Number(settings.sessionSelectedBranchScore) || 0));
      const sessionSelectedBranchEffectsJson = textSetting(settings.sessionSelectedBranchEffectsJson, "{}");
      const sessionBranchReason = textSetting(settings.sessionBranchReason, "not set");
      const sessionDirectorNote = textSetting(settings.sessionDirectorNote, "not set");
      const sessionPathJson = textSetting(settings.sessionPathJson, "[]");
      const sessionPreferenceNotes = textSetting(settings.sessionPreferenceNotes, "not set");
      const sessionMemoryCandidate = textSetting(settings.sessionMemoryCandidate, "not set");
      const sessionStrategyNotes = textSetting(settings.sessionStrategyNotes, "not set");
      const sessionCreativeNotes = textSetting(settings.sessionCreativeNotes, "not set");
      const sessionAwaitingFeedback = settings.sessionAwaitingFeedback === true;
      const sessionTurnCount = Math.max(0, Math.floor(Number(settings.sessionTurnCount) || 0));
      const sessionStageTurnCount = Math.max(0, Math.floor(Number(settings.sessionStageTurnCount) || 0));
      const sessionContract = textSetting(settings.sessionContract, "not set");
      const sessionContractAnalysis = textSetting(settings.sessionContractAnalysis, "not set");
      const sessionContractStatus = textSetting(settings.sessionContractStatus, "not set");
      const trackerEnabled = sessionActive;
      const spiralPreset = textSetting(settings.spiralPreset, "none");
      const whispers = String(settings.visualWhispers || "").split(/\r?\n|\|/).map((item) => item.trim()).filter(Boolean).slice(0, 16);
      const shouldTrackStages = true;
      const shouldCheckIn = true;
      const organizerEnabled = moduleEnabled(ctx, "organizer");
      const memoryEnabled = moduleEnabled(ctx, "memory-bank");
      const sessionSummaryEnabled = moduleEnabled(ctx, "session-summary");
      const actionGuidance = settings.allowModelControl === false ? "" : "Use guided-relaxation tools sparingly to configure, start, advance, update, pause, resume, or end a session and to adjust its effects.";
      const offerGuidance = sessionActive ? "" : [
        `When the user's state or request makes relaxation directly useful, the main-facing assistant may start or offer a long interactive guided relaxation session. Adapt the decision to context and UI defaults: pacing=${pacing}; paragraphs=${paragraphLength}.`,
        "Do not offer guided relaxation during practical problem-solving unless calming, sleep, focus, grounding, or recovery is clearly relevant to the user's current context.",
        "If the user directly asks to begin hypnosis, trance, a guided session, sleep induction, deepener, or relaxation, do not merely make a brief offer. Either ask one necessary contract question if the desired experience is unclear, or begin the session if enough intent is clear.",
        "If the main-facing assistant decides a session should begin without an explicit request, only do so when the user's current state clearly calls for guided calming, sleep support, grounding, focus recovery, or similar help. Otherwise make a brief offer first.",
        "For a pre-session offer, use neutral choices, not deepening language. Do not repeat the same prompt every time; vary the wording and length naturally.",
        "When a choice card is useful, use the hypno choice tool with a prompt and a short array of label/value choices.",
        "If the user accepts, ask one compact follow-up only when needed. The contract should identify the desired experience, style, stage emphasis, ending, boundaries, and how often to check in. Every session is interactive and staged, so focus the contract on experience rather than format.",
        "Vary choice labels to fit the context.",
        "If the user says no, acknowledge briefly and move on. Do not ask again unless they bring it up."
      ].join("\n");
      const interactiveGuidance = !sessionActive ? "" : [
        "Interactive check-ins are part of the guided session, not optional decoration. End each stage segment with one clear cue for the user to answer before advancing.",
        "Use check-ins to decide the next turn: if the user says yes/ready/deeper, update readiness and either continue deepening the current stage or advance when progress is high enough; if the user says no/not yet/distracted/confused/anxious, checkpoint that feedback, hold or lower progress, and continue or soften the current stage instead of advancing.",
        "Render answer buttons with the hypno choice tool when useful.",
        "In normal chat this appears inline. In Call Mode it also appears as a centered prompt so the user can click instead of speaking. Keep labels short and values clear."
      ].join("\n");
      const supportModuleGuidance = [
        boolLine(organizerEnabled, "Organizer is enabled: for guided sessions, you may create one private task/checklist for the session plan or next checkpoint. Use this sparingly; do not create a new task every turn."),
        boolLine(organizerEnabled, "Organizer scheduling is enabled: if the user chooses sleep, asks for a later check-in, or wants aftercare, you may create a reminder. Only schedule when the user requests or clearly consents."),
        boolLine(memoryEnabled, "Memory Bank is enabled: after explicit user feedback about preferences, effective imagery, limits, disliked phrasing, or successful session structure, you may save one concise preference memory. Do not store sensitive session content unless the user clearly wants it remembered."),
        boolLine(memoryEnabled, "Use remembered preferences to adapt future hypnosis: preferred pacing, imagery, check-in frequency, endings, wording boundaries, and styles that worked or did not work."),
        boolLine(sessionSummaryEnabled, "Session Summary is enabled: keep stage continuity and user feedback clean enough that the conversation summary can preserve where the session is, what stage completed, and what the user reported.")
      ].filter(Boolean).join("\n");

      return [{
        id: "guided-relaxation-guidance",
        name: "Guided Relaxation",
        enabled: true,
        role: "system",
        position: "bottom",
        priority: 57,
        content: [
          "Guided relaxation capability rules:",
          "- The module being enabled means this capability is available, not that every reply should become guided relaxation.",
          sessionActive ? `- A guided relaxation/hypno session is currently active. Paused: ${sessionPaused ? "yes" : "no"}. Style: ${sessionStyle}. Shape: ${sessionShape}. Ending: ${sessionEnding}. Current stage: ${sessionStage}. Stage progress: ${sessionStageProgress}%. Current technique: ${sessionTechnique}. Stage goal: ${sessionStageGoal}. Readiness: ${sessionReadiness}. User signal: ${sessionUserSignal}. Tracker decision: ${sessionModelDecision}. Selected branch: ${sessionSelectedBranchId}. Selected branch score: ${sessionSelectedBranchScore}. Branch reason: ${sessionBranchReason}. Director note: ${sessionDirectorNote}. Awaiting feedback: ${sessionAwaitingFeedback ? "yes" : "no"}. Turn count: ${sessionTurnCount}. Stage turn count: ${sessionStageTurnCount}. Latest feedback: ${sessionFeedback}. Preference notes: ${sessionPreferenceNotes}. Memory candidate: ${sessionMemoryCandidate}. Next check-in prompt: ${sessionCheckInPrompt}. Next instruction: ${sessionNextInstruction}. Contract status: ${sessionContractStatus}. Contract analysis: ${sessionContractAnalysis}. Contract: ${sessionContract}.` : "- No guided relaxation/hypno session is active. Do not start one or use trance/deepening pacing yet. You may briefly offer guided relaxation when relevant to the user's state or request.",
          sessionPaused ? "- The session is paused. Do not continue induction, deepening, body work, reinforcement, or effects-forward pacing until the user resumes or you emit hypno.session.resume after clear user intent." : "",
          "- If offering, ask organically and briefly. If the user says no or declines, drop the topic and do not bring it up again unless the user raises it.",
          "- If the user accepts or directly requests a session, infer obvious contract details and ask only for missing essentials. Once clear, configure and start the session with the guided-relaxation tools before writing induction prose. The start result seeds the initial evolution tree; follow the selected branch.",
          !sessionActive ? `- If you start a session in this reply, call configure and start before writing induction. Follow the paragraph length setting and stop at a natural checkpoint. ${turnLengthGuidance(paragraphLength)}` : "",
          "- When moving phases during an active session, use the stage tool so the app remembers the current stage.",
          sessionActive && !trackerEnabled ? "- During active sessions, update internal stage progress with hypno.session.progress after meaningful progress or after reading user feedback. Use 0-100 for the current stage only, not the whole session. If the user is not relaxed enough, keep the same stage, lower or hold progress, and continue with gentler pacing instead of advancing." : "",
          sessionActive ? "- Progress calibration: early induction is usually 10-35%, settled induction 35-70%, ready-to-advance 80-100%. Do not set 100% unless the stage is genuinely complete and the user is ready." : "",
          sessionActive && !trackerEnabled ? "- Use hypno.session.checkpoint after user feedback or an interactive check-in to record readiness and what needs to happen next. Treat this like a coding-agent task checkpoint: inspect state, update progress/readiness, then continue the current plan." : "",
          sessionActive && !trackerEnabled ? "- Every active guided-session response must update the tracker with hypno.session.update unless the only action is ending the session. This is the session equivalent of an agentic progress update: stage, progress, readiness, and feedback should reflect what just happened and what should happen next." : "",
          sessionActive && trackerEnabled ? "- Hidden background agents have already interpreted the user's latest reply and updated the Monte Carlo-style session evolution tree before this response. Follow the selected branch and controller instruction for this turn instead of independently planning the whole session or emitting routine tracker updates." : "",
          sessionActive ? "- You may emit multiple hypno actions in the same response when they change session state or effects. Do not emit routine or duplicate actions just to satisfy format." : "",
          sessionActive && sessionNextInstruction !== "not set" ? `- Controller instruction for this turn: ${sessionNextInstruction}` : "",
          sessionActive && sessionTechnique !== "not set" ? `- Use this selected technique as the main method for the current stage: ${sessionTechnique}.` : "",
          sessionActive && sessionStageGoal !== "not set" ? `- Current stage goal: ${sessionStageGoal}.` : "",
          sessionActive && sessionCheckInPrompt !== "not set" ? `- Prefer this check-in when ending the segment: ${sessionCheckInPrompt}` : "",
          sessionActive ? `- Session path history JSON, newest last: ${sessionPathJson}` : "",
          sessionActive ? `- Candidate branch JSON for this turn: ${sessionCandidateBranchesJson}` : "",
          sessionActive ? `- Selected branch effects JSON: ${sessionSelectedBranchEffectsJson}` : "",
          sessionActive && sessionSelectedBranchId !== "not set" ? `- Act as the front-facing guide for the selected evolution-tree branch ${sessionSelectedBranchId}. Do not narrate the tree, branch labels, scores, or agent deliberation to the user; embody the chosen path as natural guided prose.` : "",
          sessionActive && sessionSelectedBranchId !== "not set" ? `- The selected branch score is ${sessionSelectedBranchScore}/100. If it is low, keep the prose conservative, slower, and more check-in oriented.` : "",
          sessionActive && sessionDirectorNote !== "not set" ? `- Director note from the controller: ${sessionDirectorNote}` : "",
          sessionActive && sessionPreferenceNotes !== "not set" ? `- User response preference notes from the catalog agent: ${sessionPreferenceNotes}` : "",
          sessionActive && sessionStrategyNotes !== "not set" ? `- Hidden hypnosis strategy notes: ${sessionStrategyNotes}` : "",
          sessionActive && sessionCreativeNotes !== "not set" ? `- Hidden creative writing direction to prevent repetitive phrasing: ${sessionCreativeNotes}` : "",
          sessionActive && sessionContractAnalysis !== "not set" ? `- Hidden contract analysis: ${sessionContractAnalysis}` : "",
          sessionActive && sessionContractStatus !== "not set" ? `- Contract completeness: ${sessionContractStatus}. If essentials are missing, ask one compact front-facing question before deepening.` : "",
          sessionActive ? "- Never write multiple session stages in one assistant response. Do not include headings or prose for future stages. If current stage is induction, do not write deepener/body/reinforcement/ending yet; if deepener, do not write body/reinforcement/ending yet; if body, do not write reinforcement/ending yet." : "",
          sessionActive ? "- End each stage segment with a gentle check-in or clear pause point. Wait for the next user turn or explicit readiness before advancing." : "",
          sessionActive && shouldCheckIn ? "- End guided segments with a brief natural check-in and a structured choice card when useful. Ask about the user's actual state, not a fixed checklist." : "",
          sessionActive && shouldCheckIn ? "- On the next user response, treat their answer as state input. Emit hypno.session.checkpoint with readiness and feedback, then decide: continue same stage, pause, soften, repeat, or advance. Do not ignore the user's state answer." : "",
          sessionActive && shouldCheckIn ? "- Interpret short replies contextually: 'yes', 'ready', 'continue', 'deeper', or similar means proceed only if the current stage has enough progress; 'no', 'not yet', 'repeat', 'slower', 'soften', 'confused', 'too much', or similar means stay in the current stage and adapt; 'pause', 'stop', or 'hold' means pause immediately." : "",
          sessionActive ? `- Active-session length requirement: ${turnLengthGuidance(paragraphLength)}` : "",
          sessionActive ? "- A one-sentence or single-paragraph active-session reply is invalid unless the user explicitly asked for an emergency stop, pause, or very brief answer." : "",
          sessionActive ? "- Treat the active session as a real guided hypnosis script. Do not use shortcut claims like 'you are now asleep', 'you instantly drop', or 'you are fully hypnotized' as substitutes for induction, pacing, or deepening." : "",
          sessionActive ? "- Write the current stage itself, not a summary of it. Use slow cadence, repeated anchors, sensory detail, permissive language, and gradual suggestion. The user should feel guided through the state change instead of being told the state already happened." : "",
          sessionActive ? "- Progress at most one stage per assistant turn and usually remain within the same stage for several turns. Do not jump from induction to ending, or induction to body, in one response." : "",
          sessionActive ? "- Every session is a long interactive staged process: induction settles attention; deepener intensifies absorption; body delivers the requested experience; reinforcement consolidates suggestions; ending either wakes, leaves them resting, or guides sleep according to the contract." : "",
          sessionActive ? "- If the current stage is not set, set it to induction before writing the first segment. If the stage is induction, focus on settling, gaze, breath, and attention. If deepener, focus on descent, heaviness/lightness, counting, loops, or fractionation. If body, focus on the contracted experience. If reinforcement, repeat and bind useful suggestions. If ending, pace the chosen return, sleep, or continue-state carefully." : "",
          "- If the user asks to pause, hold, slow down sharply, or briefly stop without ending, use the pause tool and plain supportive language. If they ask to continue, use the resume tool before continuing.",
          "- When the session is complete, awakened, or intentionally left for sleep/continue mode, use the end tool so the next normal chat does not stay in hypno mode.",
          `- UI guidance defaults: pacing=${pacing}; paragraphs=${paragraphLength}. Sessions are always long, interactive, and staged; the contract customizes the experience, not whether stages/check-ins happen.`,
          "- Do not copy fixed examples or repeat stock cadence. Vary phrasing, imagery, and check-ins according to the latest user signal and session contract.",
          "- Stage plan: induction, then deepener, then body, then reinforcement, then ending. Do not write all stages in one message. Induction starts trance; deepener intensifies absorption; body delivers the requested core experience; reinforcement consolidates suggestions; ending either wakes, leaves them resting, or guides sleep according to the contract.",
          "- Build the experience through those phases. Use the contract and selected evolution-tree branch to decide which stages need more time, what imagery/sensations to use, and what readiness signals matter. Do not rush into later phases until the current phase has done its job and user feedback/readiness supports moving on.",
          "- Technique knowledgebase. Select one primary technique per turn, blend at most one secondary technique, and adapt it to the user's contract and feedback rather than listing techniques visibly.",
          techniqueCatalogText(),
          boolLine(shouldTrackStages, `Privately track this checklist in order: ${STAGE_NAMES.join(" -> ")}. Do not print the checklist unless the user asks; use it to decide whether to continue the current phase or move to the next.`),
          boolLine(shouldCheckIn, "Ask brief check-in questions such as whether the user feels settled, confused, floaty, heavy, light, warm, numb, or ready to go deeper. If the answer suggests they are not ready, continue the current phase; if ready, proceed to the next phase."),
          supportModuleGuidance,
          offerGuidance,
          interactiveGuidance,
          boolLine(pacing === "confusion", "For confusion pacing, use gentle pattern breaks, incomplete loops, ambiguity, and reorientation, while keeping the user comfortable and able to stop."),
          "- Prefer simple sensory anchors, pauses, repetition with variation, and clear consent-respecting language.",
          "- For phantom touch style, use indirect tactile suggestion, expectation, warmth, pressure, tingles, distance, and attention shifts. Keep it suggestive rather than claiming physical contact is actually happening.",
          "- Keep lines TTS-friendly: avoid dense punctuation, long lists, and stage directions unless the user requested script markup.",
          boolLine(settings.breathworkEnabled !== false, "Use breath cues only when they improve pacing; do not overuse them."),
          boolLine(settings.callModeSyncEnabled !== false, "When Call Mode is active, synchronize language with spirals, whispers, particles, ambience, and breath cues without describing UI mechanics."),
          `- Available spiral presets: ${spiralPresets.join(", ")}. Current preset: ${spiralPreset}.`,
          whispers.length ? `- Current whisper palette: ${whispers.join(" | ")}.` : "",
          actionGuidance
        ].filter(Boolean).join("\n")
      }];
    }
  }
};
