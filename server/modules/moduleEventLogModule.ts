import type { PromptBlock } from "../../shared/types";
import type { AppModule } from "./types";

const EMPTY_PROMPT_BLOCKS: PromptBlock[] = [];

export const moduleEventLogModule: AppModule = {
  id: "module-event-log",
  name: "Audit Log",
  description: "Module action requests, permission checks, execution results, and errors.",
  kind: "automation",
  defaultEnabled: true,
  defaultSettings: {},
  hooks: {
    getPromptBlocks(): PromptBlock[] {
      return EMPTY_PROMPT_BLOCKS;
    }
  }
};
