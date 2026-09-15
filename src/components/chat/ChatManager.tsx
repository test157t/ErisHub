import { memo, ReactNode, SetStateAction } from "react";
import type { ChatMessage, PromptProfile, ProviderConfig } from "../../../shared/types";

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

type ChatManagerProps = {
  draggedAgentId: string | null;
  inspectedSessionId: string | null;
  promptProfiles: PromptProfile[];
  showRawHistory: boolean;
  visibleChatCards: ChatSession[];
  deleteSession: (sessionId: string) => void;
  formatTimestamp: (timestamp: number) => string;
  loadSession: (session: ChatSession) => void;
  moveSessionAgent: (sessionId: string, targetId: string) => void;
  renderMessage: (message: ChatMessage, sessionId: string, profile: PromptProfile) => ReactNode;
  setDraggedAgentId: (value: SetStateAction<string | null>) => void;
  setInspectedSessionId: (value: SetStateAction<string | null>) => void;
  setIsChatManagerOpen: (value: SetStateAction<boolean>) => void;
  setShowRawHistory: (value: SetStateAction<boolean>) => void;
  startNewChat: () => void;
  toggleSessionAgent: (sessionId: string, profileId: string) => void;
};

export const ChatManager = memo(function ChatManager({
  draggedAgentId,
  inspectedSessionId,
  promptProfiles,
  showRawHistory,
  visibleChatCards,
  deleteSession,
  formatTimestamp,
  loadSession,
  moveSessionAgent,
  renderMessage,
  setDraggedAgentId,
  setInspectedSessionId,
  setIsChatManagerOpen,
  setShowRawHistory,
  startNewChat,
  toggleSessionAgent
}: ChatManagerProps) {
  return <div className="modal-backdrop" onClick={() => setIsChatManagerOpen(false)}>
    <section className="chat-manager-panel" onClick={(event) => event.stopPropagation()}>
      <div className="modal-header">
        <h3>Chat Manager</h3>
        <button className="utility-icon" type="button" onClick={() => setIsChatManagerOpen(false)}>×</button>
      </div>
      <div className="chat-manager-actions">
        <button type="button" onClick={startNewChat}>New Chat</button>
      </div>
      <div className="chat-card-grid">
        {visibleChatCards.length === 0 ? <p className="empty-state">No chats yet.</p> : null}
        {visibleChatCards.map((session) => {
          const isSelected = inspectedSessionId === session.id;
          return <article className={`chat-history-card ${isSelected ? "inspecting expanded" : ""}`} key={session.id} onClick={() => {
            if (session.id !== "current") {
              loadSession(session);
              setInspectedSessionId("current");
              return;
            }
            setInspectedSessionId((current) => current === session.id ? null : session.id);
          }}>
            {session.id !== "current" ? <button className="card-delete-x" type="button" aria-label="Delete chat" onClick={(event) => { event.stopPropagation(); deleteSession(session.id); }}>×</button> : null}
            <div className="chat-card-title-row">
              <h4>{session.id === "current" ? `Current: ${session.title}` : `#${session.chatNumber} ${session.title}`}</h4>
            </div>
            <div className="agent-chip-row compact">
              {promptProfiles.map((profile) => <button
                className={`agent-chip ${(session.agentIds ?? [session.promptProfile?.id]).includes(profile.id) ? "active" : ""}`}
                draggable
                key={profile.id}
                onClick={(event) => { event.stopPropagation(); toggleSessionAgent(session.id, profile.id); }}
                onDragEnd={() => setDraggedAgentId(null)}
                onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }}
                onDragStart={(event) => { event.stopPropagation(); setDraggedAgentId(profile.id); }}
                onDrop={(event) => { event.stopPropagation(); if (draggedAgentId) moveSessionAgent(session.id, profile.id); }}
                type="button"
              >{profile.name}</button>)}
            </div>
            <p>{session.messages.length} messages</p>
            <span className="chat-card-time">{session.id === "current" ? "Unsaved" : formatTimestamp(session.createdAt)}</span>
            {isSelected ? <div className="inline-chat-history" onClick={(event) => event.stopPropagation()}>
              <div className="chat-card-actions history-actions"><button type="button" onClick={() => setShowRawHistory((current) => !current)}>{showRawHistory ? "Normal History" : "Raw / Inspect"}</button></div>
              {showRawHistory ? <pre className="prompt-preview manager-prompt-preview">{JSON.stringify({ title: session.title, createdAt: session.id === "current" ? "Unsaved" : formatTimestamp(session.createdAt), agents: session.agentIds, messages: session.messages }, null, 2)}</pre> : <div className="history-message-list">
                {session.messages.map((message) => renderMessage(message, session.id, session.promptProfile))}
              </div>}
            </div> : null}
          </article>;
        })}
      </div>
    </section>
  </div>;
});
