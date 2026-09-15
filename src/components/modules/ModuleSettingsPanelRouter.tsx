import { memo, ReactNode, SetStateAction } from "react";
import type { ModuleConfig, PromptProfile, ProviderConfig } from "../../../shared/types";
import { AssetsPanel } from "./AssetsPanel";
import { BackgroundMusicPanel } from "./BackgroundMusicPanel";
import { ClassifyPanel } from "./ClassifyPanel";
import { ClimatePanel } from "./ClimatePanel";
import { ComputationPanel } from "./ComputationPanel";
import { ContactsPanel } from "./ContactsPanel";
import { CallModePanel, VoiceForgePanel } from "./EmbodyPanel";
import { EvolutionPanel } from "./EvolutionPanel";
import { HypnoPanel } from "./HypnoPanel";
import { ImageGenerationPanel } from "./ImageGenerationPanel";
import { IntifacePanel } from "./IntifacePanel";
import { LlamaCppPanel } from "./LlamaCppPanel";
import { KnowledgePanel } from "./KnowledgePanel";
import { ModuleSettingField } from "./ModuleSettingField";
import { ModuleEventLogPanel } from "./ModuleEventLogPanel";
import { OrganizerPanel } from "./OrganizerPanel";
import { ProjectsPanel } from "./ProjectsPanel";
import { RelationshipMeterPanel } from "./RelationshipMeterPanel";
import { SessionSummaryPanel } from "./SessionSummaryPanel";
import { VrmPanel } from "./VrmPanel";
import { WebSearchPanel } from "./WebSearchPanel";
import { DiscordPanel } from "./DiscordPanel";
import { SipPanel } from "./SipPanel";
import type { BackgroundAsset, LibraryDocumentItem, LibraryDocumentPreview, MemoryItem, ModuleEventItem, ModuleManifest, ModuleSettings, NoteItem, NotificationItem, ReminderDraft, ReminderItem, SessionSummaryItem, SetSimpleModuleDraft, SimpleModuleDraft, TaskItem } from "./types";

type ModuleAssetItem = { name: string; path: string; url: string; size: number; updatedAt: string; type: string };

type ModuleSettingsPanelRouterProps = {
  activePromptProfile: PromptProfile;
  activeUserName: string;
  backgroundAssets: BackgroundAsset[];
  calculate: (expression: string) => Promise<unknown>;
  classifySentiments: string[];
  compactJson: (value: unknown) => string;
  createReminder: (reminder: ReminderDraft) => Promise<unknown>;
  deleteLibraryDocument: (id: string) => Promise<unknown>;
  deleteReminder: (id: string) => Promise<unknown>;
  documents: LibraryDocumentItem[];
  formatBytes: (bytes: number) => string;
  formatTimestamp: (timestamp: number) => string;
  manifest: ModuleManifest;
  memories: MemoryItem[];
  moduleEvents: ModuleEventItem[];
  modules: ModuleConfig[];
  notes: NoteItem[];
  notifications: NotificationItem[];
  onError: (message: string) => void;
  onMicLevelTest: () => void;
  onSettingChange: (key: string, value: unknown) => void;
  postJson: (url: string, body: unknown, method?: string) => Promise<unknown>;
  provider: ProviderConfig;
  promptProfiles: PromptProfile[];
  providerProfiles: ProviderConfig[];
  refreshBasicModules: () => void;
  refreshNotifications: () => void;
  refreshReminders: () => Promise<unknown>;
  reminderCalendar: ReactNode;
  reminderDraft: ReminderDraft;
  reminders: ReminderItem[];
  selectedDocument: LibraryDocumentPreview | null;
  setReminderDraft: (value: SetStateAction<ReminderDraft>) => void;
  setSimpleDraft: SetSimpleModuleDraft;
  settings: ModuleSettings;
  simpleDraft: SimpleModuleDraft;
  summaries: SessionSummaryItem[];
  tasks: TaskItem[];
  viewLibraryDocument: (id: string) => Promise<unknown>;
};

export const ModuleSettingsPanelRouter = memo(function ModuleSettingsPanelRouter({ activePromptProfile, activeUserName, backgroundAssets, calculate, classifySentiments, compactJson, createReminder, deleteLibraryDocument, deleteReminder, documents, formatBytes, formatTimestamp, manifest, memories, moduleEvents, modules, notes, notifications, onError, onMicLevelTest, onSettingChange, postJson, provider, promptProfiles, providerProfiles, refreshBasicModules, refreshNotifications, refreshReminders, reminderCalendar, reminderDraft, reminders, selectedDocument, setReminderDraft, setSimpleDraft, settings, simpleDraft, summaries, tasks, viewLibraryDocument }: ModuleSettingsPanelRouterProps) {
  switch (manifest.id) {
    case "assets":
      return <AssetsPanel />;
    case "background-music":
      return <BackgroundMusicPanel onError={onError} onSettingChange={onSettingChange} settings={settings} />;
    case "environmental-context":
      return <ClimatePanel onSettingChange={onSettingChange} settings={settings} />;
    case "classify":
      return <ClassifyPanel backgroundAssets={backgroundAssets} labels={classifySentiments} manifest={manifest} onSettingChange={onSettingChange} settings={settings} />;
    case "web-search":
      return <WebSearchPanel onSettingChange={onSettingChange} settings={settings} />;
    case "computation":
      return <ComputationPanel calculate={calculate} onError={onError} onSettingChange={onSettingChange} setSimpleDraft={setSimpleDraft} settings={settings} simpleDraft={simpleDraft} />;
    case "relationship-meter":
      return <RelationshipMeterPanel classifySentiments={classifySentiments} modules={modules} onError={onError} onSettingChange={onSettingChange} promptProfiles={promptProfiles} provider={provider} settings={settings} />;
    case "organizer":
      return <OrganizerPanel createReminder={createReminder} deleteReminder={deleteReminder} formatTimestamp={formatTimestamp} notifications={notifications} onError={onError} onSettingChange={onSettingChange} postJson={postJson} refreshBasicModules={refreshBasicModules} refreshNotifications={refreshNotifications} refreshReminders={refreshReminders} reminderCalendar={reminderCalendar} reminderDraft={reminderDraft} reminders={reminders} setReminderDraft={setReminderDraft} setSimpleDraft={setSimpleDraft} settings={settings} simpleDraft={simpleDraft} tasks={tasks} />;
    case "memory-bank":
      return <KnowledgePanel activePromptProfile={activePromptProfile} activeUserName={activeUserName} memories={memories} notes={notes} onError={onError} onSettingChange={onSettingChange} postJson={postJson} promptProfiles={promptProfiles} refreshBasicModules={refreshBasicModules} setSimpleDraft={setSimpleDraft} settings={settings} simpleDraft={simpleDraft} />;
    case "projects":
      return <ProjectsPanel onError={onError} onSettingChange={onSettingChange} settings={settings} />;
    case "contacts":
      return <ContactsPanel onError={onError} onSettingChange={onSettingChange} settings={settings} />;
    case "voiceforge":
      return <VoiceForgePanel onError={onError} onMicLevelTest={onMicLevelTest} onSettingChange={onSettingChange} promptProfiles={promptProfiles} settings={settings} />;
    case "callmode":
      return <CallModePanel onError={onError} onMicLevelTest={onMicLevelTest} onSettingChange={onSettingChange} promptProfiles={promptProfiles} settings={settings} />;
    case "vrm":
      return <VrmPanel onError={onError} onSettingChange={onSettingChange} promptProfiles={promptProfiles} settings={settings} />;
    case "intiface":
      return <IntifacePanel moduleEnabled={modules.find((item) => item.id === "intiface")?.enabled === true} onError={onError} onSettingChange={onSettingChange} settings={settings} />;
    case "hypno":
      return <HypnoPanel onSettingChange={onSettingChange} promptProfiles={promptProfiles} settings={settings} />;
    case "llama-cpp":
      return <LlamaCppPanel onError={onError} onSettingChange={onSettingChange} postJson={postJson} settings={settings} />;
    case "session-summary":
      return <SessionSummaryPanel onSettingChange={onSettingChange} postJson={postJson} refreshBasicModules={refreshBasicModules} setError={onError} setSimpleDraft={setSimpleDraft} settings={settings} simpleDraft={simpleDraft} summaries={summaries} />;
    case "module-event-log":
      return <ModuleEventLogPanel compactJson={compactJson} formatTimestamp={formatTimestamp} moduleEvents={moduleEvents} refreshBasicModules={refreshBasicModules} />;
    case "discord":
      return <DiscordPanel onError={onError} onSettingChange={onSettingChange} providerProfiles={providerProfiles} settings={settings} />;
    case "sip":
      return <SipPanel />;
    case "image-generation":
      return <ImageGenerationPanel onSettingChange={onSettingChange} promptProfiles={promptProfiles} providerProfiles={providerProfiles} settings={settings} />;
    case "evolution":
      return <EvolutionPanel activePromptProfile={activePromptProfile} onError={onError} onSettingChange={onSettingChange} postJson={postJson} promptProfiles={promptProfiles} provider={provider} settings={settings} />;
    default:
      return Object.entries(settings).map(([key, value]) => <ModuleSettingField key={key} manifest={manifest} name={key} onSettingChange={onSettingChange} value={value} />);
  }
});
