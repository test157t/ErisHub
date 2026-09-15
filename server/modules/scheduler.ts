import type { PromptBlock } from "../../shared/types";
import type { AppModule } from "./types";

const SCHEDULER_PROMPT_BLOCK: PromptBlock = {
  id: "scheduler-guidance",
  name: "Scheduler",
  enabled: true,
  role: "system",
  position: "bottom",
  priority: 35,
  content: "Scheduled work is handled by the app. If the user asks for delayed or recurring work, create an appropriate schedule/task action rather than promising to remember silently."
};

export const schedulerModule: AppModule = {
  id: "scheduler",
  name: "Scheduler",
  description: "Shared background-job surface for due scheduled items, recurring tasks, summaries, cleanup, and module maintenance.",
  kind: "automation",
  defaultEnabled: false,
  defaultSettings: {
    enabledJobs: ["scheduled-items"],
    pollSeconds: 30
  },
  hooks: {
    getPromptBlocks(): PromptBlock[] {
      return [SCHEDULER_PROMPT_BLOCK];
    }
  }
};
