import type { AppModule } from "./types";

export const backgroundMusicModule: AppModule = {
  id: "background-music",
  name: "Background Music",
  description: "Dynamic background music and BGM playback controls.",
  kind: "media",
  defaultEnabled: false,
  defaultSettings: {
    audioEnabled: false,
    audioBgmLocked: false,
    audioBgmRandom: false,
    audioBgmMuted: false,
    audioBgmVolume: 50,
    audioBgmSelected: "",
    audioBgmCooldown: 30,
    audioBgmLockModeVersion: 1
  },
  hooks: {}
};
