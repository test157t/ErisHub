import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { PromptBlock, PromptProfile, ProviderConfig } from "../../shared/types";

type Change = { section: string; content: string };

const sectionLabels: Record<string, string> = {
  description: "Description",
  personality: "Personality",
  appearance: "Appearance",
  "response-guidelines": "Response Guidelines",
  preferences: "Preferences"
};

type SelfImproveDialogProps = {
  proposedChanges: Change[];
  currentBlocks: PromptBlock[];
  provider: ProviderConfig;
  promptProfile: PromptProfile;
  onApply: (acceptedChanges: Change[]) => void;
  onClose: () => void;
};

const nameToId: Record<string, string> = {
  description: "description", personality: "personality", appearance: "appearance",
  "response-guidelines": "response-guidelines", "response guidelines": "response-guidelines", "Response Guidelines": "response-guidelines",
  preferences: "preferences"
};

function normalizeId(section: string): string {
  return nameToId[section] || nameToId[section.toLowerCase()] || section;
}

function normalizeChanges(raw: Change[]): Change[] {
  return raw.map((c) => ({ ...c, section: normalizeId(c.section) }));
}

function currentContent(blocks: PromptBlock[], sectionId: string): string {
  return blocks.find((b) => b.id === sectionId)?.content || "";
}

function SelfImproveDialogComponent({ proposedChanges: initialChanges, currentBlocks, provider, promptProfile, onApply, onClose }: SelfImproveDialogProps) {
  const [changes, setChanges] = useState<Change[]>(() => normalizeChanges(initialChanges));
  const [accepted, setAccepted] = useState<Set<string>>(() => new Set(normalizeChanges(initialChanges).map((c) => c.section)));
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [chatInput, setChatInput] = useState("");
  const [refining, setRefining] = useState(false);
  const [error, setError] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const toggleAccepted = useCallback((section: string) => {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }, []);

  const handleSend = useCallback(async () => {
    const msg = chatInput.trim();
    if (!msg || refining) return;
    setChatInput("");
    setError("");
    setChatMessages((prev) => [...prev, { role: "user", content: msg }]);
    setRefining(true);

    try {
      const res = await fetch("/api/modules/evolution/self-edit/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promptProfile,
          provider,
          proposedChanges: changes,
          conversation: chatMessages,
          newMessage: msg
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Request failed.");

      const assistantMsg = data.response || "(no response)";
      setChatMessages((prev) => [...prev, { role: "assistant", content: assistantMsg }]);

      if (Array.isArray(data.updatedChanges) && data.updatedChanges.length > 0) {
        const normalized = (data.updatedChanges as Change[]).map((c) => ({ ...c, section: normalizeId(c.section) }));
        setChanges((prev) => {
          const updated = [...prev];
          for (const uc of normalized) {
            const idx = updated.findIndex((c) => c.section === uc.section);
            if (idx >= 0) updated[idx] = uc;
            else updated.push(uc);
          }
          return updated;
        });
        setAccepted((prev) => {
          const next = new Set(prev);
          for (const uc of normalized) next.add(uc.section);
          return next;
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refine request failed.");
    } finally {
      setRefining(false);
      inputRef.current?.focus();
    }
  }, [chatInput, refining, promptProfile, provider, changes, chatMessages]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleApply = useCallback(() => {
    const acceptedChanges = changes.filter((c) => accepted.has(c.section));
    if (acceptedChanges.length > 0) onApply(acceptedChanges);
    onClose();
  }, [changes, accepted, onApply, onClose]);

  const acceptedCount = changes.filter((c) => accepted.has(c.section)).length;

  return (
    <div className="self-improve-overlay" role="dialog" aria-modal="true" aria-label="Self improve review" onClick={onClose}>
      <div className="self-improve-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="self-improve-header">
          <h3>Review Self-Improvements</h3>
          <button type="button" className="utility-icon" onClick={onClose}>×</button>
        </div>

        <div className="self-improve-body">
          <div className="self-improve-changes">
            {changes.length === 0 ? (
              <p className="self-improve-no-changes">No changes were suggested.</p>
            ) : (
              changes.map((change) => {
                const before = currentContent(currentBlocks, change.section);
                return (
                  <label key={change.section} className={`self-improve-card ${accepted.has(change.section) ? "accepted" : "rejected"}`}>
                    <div className="self-improve-card-header">
                      <span className="self-improve-card-title">{sectionLabels[change.section] || change.section}</span>
                      <input type="checkbox" checked={accepted.has(change.section)} onChange={() => toggleAccepted(change.section)} />
                    </div>
                    <div className="self-improve-card-diff">
                      <div className="self-improve-diff-side">
                        <small>Before</small>
                        <pre>{before || "(empty)"}</pre>
                      </div>
                      <div className="self-improve-diff-arrow">
                        <span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
                      </div>
                      <div className="self-improve-diff-side">
                        <small>After</small>
                        <pre>{change.content}</pre>
                      </div>
                    </div>
                  </label>
                );
              })
            )}
          </div>

          <div className="self-improve-chat">
            <div className="self-improve-chat-log">
              {chatMessages.length === 0 ? (
                <p className="self-improve-chat-placeholder">Ask the agent about the proposed changes, or request refinements.</p>
              ) : (
                chatMessages.map((m, i) => (
                  <div key={i} className={`self-improve-chat-message ${m.role}`}>
                    <strong>{m.role === "user" ? "You" : promptProfile.name || promptProfile.assistantName || "Agent"}</strong>
                    <span>{m.content}</span>
                  </div>
                ))
              )}
              {refining ? <div className="self-improve-chat-message assistant"><strong>{promptProfile.name || promptProfile.assistantName || "Agent"}</strong><span className="self-improve-typing">...</span></div> : null}
              <div ref={chatEndRef} />
              {error ? <p className="error-text">{error}</p> : null}
            </div>
            <div className="self-improve-chat-input-row">
              <textarea ref={inputRef} value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={handleKeyDown} placeholder="Ask about the changes..." rows={2} disabled={refining} />
              <button type="button" className="small-action-button" disabled={refining || !chatInput.trim()} onClick={handleSend}>Send</button>
            </div>
          </div>
        </div>

        <div className="self-improve-footer">
          <span className="self-improve-summary">{acceptedCount} of {changes.length} changes accepted</span>
          <div className="self-improve-footer-actions">
            <button type="button" className="small-action-button" onClick={onClose}>Cancel</button>
            <button type="button" className="small-action-button" disabled={acceptedCount === 0} onClick={handleApply}>Apply Accepted</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export const SelfImproveDialog = memo(SelfImproveDialogComponent);
