import { assetsModule } from "./assetsModule";
import { backgroundMusicModule } from "./backgroundMusic";
import { callModeModule } from "./callMode";
import { classifyModule } from "./classify";
import { computationModule } from "./computation";
import { contactsModule, projectsModule } from "./coreAssistant";
import { environmentalContextModule } from "./environmentalContext";
import { evolutionModule } from "./evolution";
import { imageGenerationModule } from "./imageGeneration";
import { intifaceModule } from "./intiface";
import { hypnoModule } from "./hypno";
import { llamaCppModule } from "./llamaCpp";
import { memoryBankModule } from "./knowledge";
import { moduleEventLogModule } from "./moduleEventLogModule";
import { organizerModule } from "./organizer";
import { relationshipMeterModule } from "./relationshipMeter";
import { sessionSummaryModule } from "./sessionSummary";
import { sipModule } from "./sip";
import { vrmModule } from "./vrm";
import { voiceForgeModule } from "./voiceforge";
import { webSearchModule } from "./webSearch";
import { discordModule } from "./discord";
import { toolPermissionGuardModule } from "./toolPermissionGuard";
import type { AppModule } from "./types";

export const modules: AppModule[] = [assetsModule, backgroundMusicModule, classifyModule, computationModule, relationshipMeterModule, voiceForgeModule, callModeModule, sipModule, evolutionModule, vrmModule, intifaceModule, hypnoModule, llamaCppModule, moduleEventLogModule, toolPermissionGuardModule, organizerModule, memoryBankModule, webSearchModule, contactsModule, projectsModule, sessionSummaryModule, environmentalContextModule, imageGenerationModule, discordModule];

export function getModule(id: string) {
  return modules.find((module) => module.id === id);
}

export function getModuleManifest() {
  return modules.map(({ id, name, description, kind, defaultEnabled, defaultSettings }) => ({
    id,
    name,
    description,
    kind,
    defaultEnabled,
    defaultSettings
  }));
}
