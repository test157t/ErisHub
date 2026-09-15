import type { AppModule } from "./types";

export const callModeModule: AppModule = {
  id: "callmode",
  name: "Call Mode",
  description: "Live voice conversation transport, ASR, microphone handling, and call overlay.",
  kind: "media",
  defaultEnabled: false,
  defaultSettings: {
    callModeSilenceThresholdMs: 800,
    callModeHideChatShield: false,
    callModeRandomCallEnabled: false,
    callModeRandomCallMinMinutes: 10,
    callModeRandomCallMaxMinutes: 45,
    callModeRandomCallCooldownMinutes: 60,
    callModeAsrEndpoint: "http://127.0.0.1:8889",
    callModeAsrModel: "large-v3-turbo",
    callModeWrapQuotes: false,
    callModeNoiseGatePercent: 17,
    callModeMuteReleasesMic: false,
    callModePreferBuiltInMic: true,
    callModeInputDeviceId: "",
    callModeOverlayEnabled: true,
    callModeOverlayTransparency: 50,
    callModeOverlayScale: 100,
    callModeOverlayZIndex: 9998,
    callModeOverlayPositionX: 50,
    callModeOverlayPositionY: 50
  },
  hooks: {}
};
