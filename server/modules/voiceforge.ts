import { moduleTool, type AppModule } from "./types";

export const voiceForgeModule: AppModule = {
  id: "voiceforge",
  name: "VoiceForge",
  description: "Native VoiceForge TTS, voice maps, backend discovery, and generation settings.",
  kind: "media",
  defaultEnabled: false,
  defaultSettings: {
    voiceforgeEnabled: false,
    voiceforgeAutoGeneration: false,
    voiceforgeProviderEndpoint: "",
    voiceforgeAutoConnect: true,
    voiceforgeTtsBackend: "omnivoice",
    voiceforgeChunkSize: 12,
    voiceforgeSeed: 0,
    voiceforgeVoiceMap: {},
    audioVoiceForgeBackgroundVolume: 30,
    audioVoiceForgeBackgroundPersist: true
  },
  tools: [moduleTool("audio.play", "Queue a configured audio cue for client playback.")],
  hooks: {
    getPromptBlocks() {
      return [{
        id: "voiceforge-audio-cue-actions",
        name: "VoiceForge Audio Cue Actions",
        enabled: true,
        role: "system",
        position: "after-history",
        priority: 45,
        content: "You have a dog training clicker sound effect available. Use the audio tool to play it near the words it should align with."
      }];
    }
  }
};
