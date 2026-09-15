import type { AppModule } from "./types";

export const assetsModule: AppModule = {
  id: "assets",
  name: "Assets",
  description: "Indexes local chat backgrounds.",
  kind: "media",
  defaultEnabled: true,
  defaultSettings: {},
  hooks: {}
};
