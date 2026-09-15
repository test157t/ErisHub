import { FormEvent, KeyboardEvent, memo, RefObject, SetStateAction } from "react";
import type { ChatMessage } from "../../../shared/types";

type PendingAttachments = NonNullable<ChatMessage["attachments"]>;

type ChatComposerProps = {
  chatFileInputRef: RefObject<HTMLInputElement | null>;
  composerTextareaRef: RefObject<HTMLTextAreaElement | null>;
  hasDraft: boolean;
  isSending: boolean;
  callModeActive?: boolean;
  callModeLevel?: number;
  callModeMuted?: boolean;
  callModeTtsVolume?: number;
  isUtilityMenuOpen: boolean;
  pendingAttachments: PendingAttachments;
  onDraftChange: (value: string) => void;
  onFileUpload: (files: FileList | null) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onCallModeToggle?: () => void;
  onCallModeMuteToggle?: () => void;
  onCallModeTtsVolumeChange?: (value: number) => void;
  onOpenAuditLog: () => void;
  onRegenerate: () => void;
  onToggleFullscreen?: () => void;
  onSubmit: (event?: FormEvent) => void;
  onRunPython?: () => void;
  onRunJavaScript?: () => void;
  runPythonDisabled?: boolean;
  runJavaScriptDisabled?: boolean;
  setIsChatManagerOpen: (value: SetStateAction<boolean>) => void;
  setIsUtilityMenuOpen: (value: SetStateAction<boolean>) => void;
  setPendingAttachments: (value: SetStateAction<PendingAttachments>) => void;
};

export const ChatComposer = memo(function ChatComposer({
  chatFileInputRef,
  composerTextareaRef,
  hasDraft,
  isSending,
  callModeActive,
  callModeLevel = 0,
  callModeMuted,
  callModeTtsVolume = 100,
  isUtilityMenuOpen,
  pendingAttachments,
  onDraftChange,
  onFileUpload,
  onKeyDown,
  onCallModeToggle,
  onCallModeMuteToggle,
  onCallModeTtsVolumeChange,
  onOpenAuditLog,
  onRegenerate,
  onToggleFullscreen,
  onSubmit,
  onRunPython,
  onRunJavaScript,
  runPythonDisabled,
  runJavaScriptDisabled,
  setIsChatManagerOpen,
  setIsUtilityMenuOpen,
  setPendingAttachments
}: ChatComposerProps) {
  return <form className="composer" onSubmit={onSubmit}>
    <div className="chat-utilities" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsUtilityMenuOpen(false); }}>
      <button aria-expanded={isUtilityMenuOpen} aria-haspopup="menu" aria-label="Open chat utilities" className="utility-icon" title="Chat utilities" type="button" onClick={() => setIsUtilityMenuOpen((current) => !current)}>☰</button>
      {isUtilityMenuOpen ? <div className="chat-utility-menu" role="menu">
        <button role="menuitem" type="button" onClick={() => { setIsChatManagerOpen((current) => !current); setIsUtilityMenuOpen(false); }}>Chat Manager</button>
        {onToggleFullscreen ? <button role="menuitem" type="button" onClick={() => { onToggleFullscreen(); setIsUtilityMenuOpen(false); }}>Fullscreen</button> : null}
        <button role="menuitem" type="button" onClick={() => { onOpenAuditLog(); setIsUtilityMenuOpen(false); }}>Audit Log</button>
        <button role="menuitem" type="button" onMouseDown={(event) => { event.preventDefault(); onRegenerate(); setIsUtilityMenuOpen(false); }}>Regenerate</button>
        <button role="menuitem" type="button" onClick={() => { chatFileInputRef.current?.click(); setIsUtilityMenuOpen(false); }}>Attach File</button>
        {onRunPython ? <button disabled={runPythonDisabled} role="menuitem" type="button" onClick={() => { onRunPython(); setIsUtilityMenuOpen(false); }}>Run As Python</button> : null}
        {onRunJavaScript ? <button disabled={runJavaScriptDisabled} role="menuitem" type="button" onClick={() => { onRunJavaScript(); setIsUtilityMenuOpen(false); }}>Run As JavaScript</button> : null}
      </div> : null}
      <input ref={chatFileInputRef} className="chat-file-input" type="file" multiple accept=".txt,.md,.json,.csv,.log,text/*,application/json,image/*" onChange={(event) => onFileUpload(event.target.files)} />
    </div>
    {onCallModeToggle ? <div className={`voiceforge-call-controls ${callModeActive ? "active" : ""}`}>
      {callModeActive ? <div className="voiceforge-call-level" aria-hidden="true"><span style={{ height: `${Math.max(4, Math.min(100, callModeLevel * 100))}%` }} /></div> : null}
      {callModeActive && onCallModeMuteToggle ? <button aria-label={callModeMuted ? "Unmute microphone" : "Mute microphone"} className={`voiceforge-call-mic-button ${callModeMuted ? "muted" : ""}`} title={callModeMuted ? "Unmute microphone" : "Mute microphone"} type="button" onClick={onCallModeMuteToggle}><i className={`fa-solid ${callModeMuted ? "fa-microphone-slash" : "fa-microphone"}`} /></button> : null}
      {callModeActive && onCallModeTtsVolumeChange ? <div className="voiceforge-call-volume"><button aria-label="TTS volume" className="voiceforge-call-volume-button" title={`TTS Volume: ${Math.round(callModeTtsVolume)}%`} type="button"><i className={`fa-solid ${callModeTtsVolume <= 0 ? "fa-volume-xmark" : callModeTtsVolume < 33 ? "fa-volume-off" : callModeTtsVolume < 66 ? "fa-volume-low" : "fa-volume-high"}`} /></button><div className="voiceforge-call-volume-slider"><input aria-label="TTS volume" max={100} min={0} type="range" value={Math.round(callModeTtsVolume)} onChange={(event) => onCallModeTtsVolumeChange(Number(event.target.value))} /></div></div> : null}
      <button aria-label="Toggle call mode" className={`voiceforge-call-button ${callModeActive ? "active" : ""}`} title={callModeActive ? "End Call" : "Call Mode"} type="button" onClick={onCallModeToggle}><i className={`fa-solid ${callModeActive ? "fa-phone-slash" : "fa-phone"}`} /></button>
    </div> : null}
    {pendingAttachments.length ? <div className="pending-attachment-bar">{pendingAttachments.map((att) => <span className="pending-attachment-chip" key={att.id}>{att.name}<button type="button" onClick={() => setPendingAttachments((prev) => prev.filter((a) => a.id !== att.id))}>×</button></span>)}</div> : null}
    <textarea ref={composerTextareaRef} defaultValue="" onChange={(event) => onDraftChange(event.target.value)} onKeyDown={onKeyDown} onPaste={(event) => {
      const data = event.clipboardData;
      if (!data) return;
      const files: File[] = [];
      const seen = new Set<string>();
      const addFile = (file: File | null) => {
        if (!file) return;
        const key = `${file.name || "clipboard"}|${file.type}|${file.size}`;
        if (seen.has(key)) return;
        seen.add(key);
        files.push(file);
      };
      for (let i = 0; i < data.files.length; i++) addFile(data.files[i]);
      for (let i = 0; i < data.items.length; i++) { const item = data.items[i]; if (item.kind === "file") addFile(item.getAsFile()); }
      if (!files.length) return;
      event.preventDefault();
      onFileUpload(files as unknown as FileList);
    }} placeholder="Type a message" rows={1} />
    <button aria-label="Send message" className="send-icon" disabled={isSending || (!hasDraft && !pendingAttachments.length)} type="submit">➤</button>
  </form>;
});
