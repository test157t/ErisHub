import type { PromptBlock } from "../../shared/types";
import type { AppModule, ModuleContext } from "./types";

export const environmentalContextModule: AppModule = {
  id: "environmental-context",
  name: "Environmental Context",
  description: "Adds local time/date and optional weather context to assistant replies.",
  kind: "context",
  defaultEnabled: false,
  defaultSettings: {
    prefixEnabled: true,
    weatherContextEnabled: true,
    weatherRefreshMinutes: 30,
    weatherManualCity: ""
  },
  hooks: {
    getPromptBlocks({ settings }: ModuleContext): PromptBlock[] {
      return [{
        id: "environmental-context-guidance",
        name: "Environmental Context",
        enabled: true,
        role: "system",
        position: "bottom",
        priority: 52,
        content: settings.prefixEnabled === false
          ? "Environmental context metadata prefixing is disabled."
          : "Environmental context metadata prefixing is enabled and applied by the app runtime."
      }];
    }
  }
};
