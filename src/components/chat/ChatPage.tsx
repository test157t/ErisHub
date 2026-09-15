import { CSSProperties, FormEvent, KeyboardEvent, memo, ReactNode, RefObject, SetStateAction, useEffect, useRef } from "react";
import type { ChatMessage, PromptProfile, ProviderConfig } from "../../../shared/types";
import { VrmStage } from "../VrmStage";
import { ChatComposer } from "./ChatComposer";
import { ChatManager } from "./ChatManager";

type BackgroundAsset = {
  name: string;
  url: string;
  previewUrl?: string;
  type: "image" | "video";
};

type ChatSession = {
  id: string;
  chatNumber: number;
  title: string;
  createdAt: number;
  messages: ChatMessage[];
  promptProfile: PromptProfile;
  agentIds?: string[];
  provider: ProviderConfig;
};

type PendingAttachments = NonNullable<ChatMessage["attachments"]>;

type ChatPageProps = {
  chatBackground: BackgroundAsset | null;
  chatBackgroundBlur: boolean;
  chatBackgroundDim: number;
  chatFileInputRef: RefObject<HTMLInputElement | null>;
  composerTextareaRef: RefObject<HTMLTextAreaElement | null>;
  callModeActive?: boolean;
  callModeLevel?: number;
  callModeMuted?: boolean;
  callModeTtsVolume?: number;
  hideChatShield?: boolean;
  draggedAgentId: string | null;
  error: string;
  hasDraft: boolean;
  inspectedSessionId: string | null;
  isChatManagerOpen: boolean;
  isSending: boolean;
  isUtilityMenuOpen: boolean;
  messagesLength: number;
  pendingAttachments: PendingAttachments;
  promptProfile: PromptProfile;
  promptProfiles: PromptProfile[];
  showRawHistory: boolean;
  visibleChatCards: ChatSession[];
  visibleChatMessages: ChatMessage[];
  vrmStage: {
    animations: string[];
    autoSendHitboxMessage: boolean;
    chestJiggleEnabled: boolean;
    chestJiggleAccelerometer: boolean;
    chestJiggleStrength: number;
    chestJiggleSoftness: number;
    chestJiggleGravity: number;
    chestJiggleVertical: number;
    chestJiggleSway: number;
    chestJiggleDepth: number;
    enabled: boolean;
    characters: string[];
    characterModels: Array<{ character: string; modelSettings: Record<string, unknown>; modelUrl: string }>;
    followCamera: boolean;
    followCursor: boolean;
    hitboxes: boolean;
    lightColor: string;
    lightIntensity: number;
    lightPreset: string;
    rimLightEnabled: boolean;
    rimLightColor: string;
    rimLightIntensity: number;
    fillLightIntensity: number;
    ambientLightIntensity: number;
    keyLightAngle: number;
    lightingContrast: number;
    modelZIndex: number;
    modelsCache: boolean;
    naturalIdle: boolean;
    blink: boolean;
    animationsCache: boolean;
    showGrid: boolean;
    ttsLipsSync: boolean;
    modelUrl: string;
    modelSettings: Record<string, unknown>;
    positionX: number;
    positionY: number;
    positionZ: number;
    rotationX: number;
    rotationY: number;
    rotationZ: number;
    scale: number;
  };
  deleteSession: (sessionId: string) => void;
  formatTimestamp: (timestamp: number) => string;
  handleChatFileUpload: (files: FileList | null) => void;
  handleComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  handleDraftChange: (value: string) => void;
  onCallModeToggle?: () => void;
  onCallModeMuteToggle?: () => void;
  onCallModeTtsVolumeChange?: (value: number) => void;
  openAuditLog: () => void;
  onToggleFullscreen: () => void;
  loadSession: (session: ChatSession) => void;
  moveSessionAgent: (sessionId: string, targetId: string) => void;
  regenerateLastResponse: () => void;
  renderMessage: (message: ChatMessage, sessionId: string, profile: PromptProfile, options?: { hideMetadataPrefix?: boolean }) => ReactNode;
  sendMessage: (event?: FormEvent) => void;
  setDraggedAgentId: (value: SetStateAction<string | null>) => void;
  setInspectedSessionId: (value: SetStateAction<string | null>) => void;
  setIsChatManagerOpen: (value: SetStateAction<boolean>) => void;
  setIsUtilityMenuOpen: (value: SetStateAction<boolean>) => void;
  setPendingAttachments: (value: SetStateAction<PendingAttachments>) => void;
  setShowRawHistory: (value: SetStateAction<boolean>) => void;
  startNewChat: () => void;
  toggleSessionAgent: (sessionId: string, profileId: string) => void;
};

export const ChatPage = memo(function ChatPage({
  chatBackground,
  chatBackgroundBlur,
  chatBackgroundDim,
  chatFileInputRef,
  composerTextareaRef,
  callModeActive,
  callModeLevel,
  callModeMuted,
  callModeTtsVolume,
  hideChatShield,
  draggedAgentId,
  error,
  hasDraft,
  inspectedSessionId,
  isChatManagerOpen,
  isSending,
  isUtilityMenuOpen,
  messagesLength,
  pendingAttachments,
  promptProfile,
  promptProfiles,
  showRawHistory,
  visibleChatCards,
  visibleChatMessages,
  vrmStage,
  deleteSession,
  formatTimestamp,
  handleChatFileUpload,
  handleComposerKeyDown,
  handleDraftChange,
  onCallModeToggle,
  onCallModeMuteToggle,
  onCallModeTtsVolumeChange,
  openAuditLog,
  onToggleFullscreen,
  loadSession,
  moveSessionAgent,
  regenerateLastResponse,
  renderMessage,
  sendMessage,
  setDraggedAgentId,
  setInspectedSessionId,
  setIsChatManagerOpen,
  setIsUtilityMenuOpen,
  setPendingAttachments,
  setShowRawHistory,
  startNewChat,
  toggleSessionAgent
}: ChatPageProps) {
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const renderedChatMessages = hideChatShield ? [] : visibleChatMessages;
  const latestMessage = renderedChatMessages.at(-1);

  useEffect(() => {
    const chatLog = chatLogRef.current;
    const latestBubble = chatLog?.querySelector<HTMLElement>(".message:last-child");
    if (!chatLog || !latestBubble) return;

    const atBottom = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 120;
    if (atBottom) chatLog.scrollTop = chatLog.scrollHeight;
    latestBubble.scrollTop = latestBubble.scrollHeight;
  }, [latestMessage?.id, latestMessage?.content, latestMessage?.attachments?.length, isSending]);

  return <section className={`page chat-page ${callModeActive ? "call-mode-active" : ""}`}>
    {chatBackground ? <div className="chat-background-layer" aria-hidden="true" style={{ "--chat-bg-dim": String(chatBackgroundDim), "--chat-bg-filter": chatBackgroundBlur ? "blur(4px)" : "none" } as CSSProperties}>
      {chatBackground.type === "video"
        ? <video autoPlay loop muted playsInline src={chatBackground.url} />
        : <img alt="" src={chatBackground.url} />}
    </div> : null}
    <VrmStage className="chat-vrm-stage" {...vrmStage} />
    <div className={`chat-log vn-log ${messagesLength === 0 ? "empty-chat-log" : ""} ${hideChatShield ? "hide-chat-shield" : ""}`} ref={chatLogRef}>
      {messagesLength === 0 ? <div className="empty-state chat-empty-state" aria-hidden="true" /> : null}
      {renderedChatMessages.map((message) => renderMessage(message, "current", promptProfile, { hideMetadataPrefix: true }))}
    </div>
    {error ? <p className="error-text">{error}</p> : null}
    <ChatComposer
      chatFileInputRef={chatFileInputRef}
      callModeActive={callModeActive}
      callModeLevel={callModeLevel}
      callModeMuted={callModeMuted}
      callModeTtsVolume={callModeTtsVolume}
      composerTextareaRef={composerTextareaRef}
      hasDraft={hasDraft}
      isSending={isSending}
      isUtilityMenuOpen={isUtilityMenuOpen}
      onDraftChange={handleDraftChange}
      onFileUpload={handleChatFileUpload}
      onKeyDown={handleComposerKeyDown}
      onToggleFullscreen={onToggleFullscreen}
      onCallModeMuteToggle={onCallModeMuteToggle}
      onCallModeTtsVolumeChange={onCallModeTtsVolumeChange}
      onCallModeToggle={onCallModeToggle}
      onOpenAuditLog={openAuditLog}
      onRegenerate={regenerateLastResponse}
      onSubmit={sendMessage}
      pendingAttachments={pendingAttachments}
      setIsChatManagerOpen={setIsChatManagerOpen}
      setIsUtilityMenuOpen={setIsUtilityMenuOpen}
      setPendingAttachments={setPendingAttachments}
    />
    {isChatManagerOpen ? <ChatManager
      deleteSession={deleteSession}
      draggedAgentId={draggedAgentId}
      formatTimestamp={formatTimestamp}
      inspectedSessionId={inspectedSessionId}
      loadSession={loadSession}
      moveSessionAgent={moveSessionAgent}
      promptProfiles={promptProfiles}
      renderMessage={renderMessage}
      setDraggedAgentId={setDraggedAgentId}
      setInspectedSessionId={setInspectedSessionId}
      setIsChatManagerOpen={setIsChatManagerOpen}
      setShowRawHistory={setShowRawHistory}
      showRawHistory={showRawHistory}
      startNewChat={startNewChat}
      toggleSessionAgent={toggleSessionAgent}
      visibleChatCards={visibleChatCards}
    /> : null}
  </section>;
});
