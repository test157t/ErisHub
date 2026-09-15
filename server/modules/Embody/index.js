export * as CallMode from './callmode/call-mode.js';
export { VoiceForgeProvider } from './voiceforge/voiceforge.js';
export { getAudioManager, initAudioModule, getAudioSettings } from './voiceforge/audio.js';
export * as VrmRuntime from './vrm/vrm.js';
export { PlayModeLoader } from './intiface/_loader.js';
export * as IntifaceDevices from './intiface/connected_devices.js';
export * as IntifaceExecution from './intiface/device_execution.js';
export * as IntifaceMedia from './intiface/media_playback.js';

export function initEmbodyNative() {
  globalThis.__nitralEmbodyNative = true;
}
