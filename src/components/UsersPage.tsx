import { ChangeEvent, memo, useCallback, useEffect, useRef, useState, WheelEvent } from "react";
import type { ProviderConfig, UserProfile } from "../../shared/types";
import { SettingsCard } from "./SettingsCard";
import { SelfImproveDialog } from "./SelfImproveDialog";

type UsersPageProps = {
  activeUserId: string;
  activeProviderId: string;
  activeUser: UserProfile;
  userProfiles: UserProfile[];
  providerProfiles: ProviderConfig[];
  onAddUser: () => void;
  onDeleteUser: (userId: string) => void;
  onUpdateUser: (userId: string, changes: Partial<UserProfile>) => void;
  onActiveUserChange: (userId: string) => void;
  onGenerateUserImage: (user: UserProfile) => Promise<void>;
  onGenerateUserVideo: (user: UserProfile) => Promise<void>;
  onSteerGenerateUserImage: (user: UserProfile, instruction: string) => Promise<void>;
  onSteerGenerateUserVideo: (user: UserProfile, instruction: string) => Promise<void>;
  onRewriteUserSection: (user: UserProfile, sectionId: string, sectionName: string, currentContent: string, instruction: string) => Promise<string>;
  onSelfEditUser: (user: UserProfile, provider: ProviderConfig) => Promise<Array<{ section: string; content: string }>>;
};

const userSectionIds = ["description", "personality", "appearance", "responseGuidelines", "preferences"] as const;
const userSectionLabels: Record<string, string> = {
  description: "Description",
  personality: "Personality",
  appearance: "Appearance",
  responseGuidelines: "Response Guidelines",
  preferences: "Preferences"
};

function userInitials(name: string | undefined) {
  return (name ?? "").split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "U";
}

function UserPortrait({ className = "", user }: { className?: string; user: UserProfile }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!("IntersectionObserver" in window)) { setIsVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => setIsVisible(entry.isIntersecting), { rootMargin: "120px" });
    observer.observe(video);
    return () => observer.disconnect();
  }, [user.videoUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isVisible) video.play().catch(() => undefined);
    else video.pause();
  }, [isVisible]);

  const previewUrl = user.videoPreviewUrl || user.videoUrl;
  if (previewUrl && /\.gif(?:$|[?#])/i.test(previewUrl)) return <img alt={`${user.name} portrait`} className={className} src={previewUrl} />;
  if (previewUrl) return <video ref={videoRef} loop muted playsInline preload="metadata" className={className} poster={user.imageUrl || undefined} src={previewUrl} />;
  if (user.imageUrl) return <img alt={`${user.name} portrait`} className={className} src={user.imageUrl} />;
  return <span className={className} style={{ background: "var(--accent)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.5rem", fontWeight: 700, color: "#fff", width: "100%", height: "100%" }}>{userInitials(user.name)}</span>;
}

function UsersPageComponent({ activeUserId, activeProviderId, activeUser, userProfiles, providerProfiles, onAddUser, onDeleteUser, onUpdateUser, onActiveUserChange, onGenerateUserImage, onGenerateUserVideo, onSteerGenerateUserImage, onSteerGenerateUserVideo, onRewriteUserSection, onSelfEditUser }: UsersPageProps) {
  const [draft, setDraft] = useState(activeUser);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [expandedEditorSections, setExpandedEditorSections] = useState<Set<string>>(() => new Set());
  const [expandedPromptSections, setExpandedPromptSections] = useState<Set<string>>(() => new Set());
  const [visiblePromptUserIds, setVisiblePromptUserIds] = useState<Set<string>>(() => new Set());
  const [expandedPortraitId, setExpandedPortraitId] = useState("");
  const [generatingImage, setGeneratingImage] = useState(false);
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [rewritingSectionId, setRewritingSectionId] = useState("");
  const [selfEditing, setSelfEditing] = useState(false);
  const [selfEditMessage, setSelfEditMessage] = useState("");
  const [selfImproveMode, setSelfImproveMode] = useState<"auto" | "interactive">("interactive");
  const [selfImproveChanges, setSelfImproveChanges] = useState<Array<{ section: string; content: string }> | null>(null);
  const [showSelfImproveDialog, setShowSelfImproveDialog] = useState(false);
  const openAddedUserRef = useRef(false);
  const libraryCarouselRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { setDraft(activeUser); }, [activeUser]);
  useEffect(() => {
    if (!openAddedUserRef.current) return;
    openAddedUserRef.current = false;
    setSelectedUserId(activeUserId);
    setVisiblePromptUserIds((current) => new Set(current).add(activeUserId));
  }, [activeUserId]);

  function openUser(userId: string) {
    if (!userId || !userProfiles.some((u) => u.id === userId)) return;
    setSelectedUserId(userId);
    setVisiblePromptUserIds((current) => new Set(current).add(userId));
    if (userId !== activeUserId) onActiveUserChange(userId);
  }

  function commit<K extends keyof UserProfile>(key: K, value: UserProfile[K]) {
    if (activeUser[key] !== value) onUpdateUser(activeUser.id, { [key]: value } as Partial<UserProfile>);
  }

  function commitName() {
    if (!selectedUserId) return;
    const trimmed = draft.name.trim();
    if (!trimmed) return;
    if (activeUser.name !== trimmed) commit("name", trimmed);
  }

  function addUserAndOpen() {
    openAddedUserRef.current = true;
    onAddUser();
  }

  function closeUserDetail() {
    setSelectedUserId("");
  }

  function scrollLibraryCarouselWheel(event: WheelEvent<HTMLDivElement>) {
    const carousel = libraryCarouselRef.current;
    if (!carousel || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    carousel.scrollLeft += event.deltaY;
  }

  function handleDelete() {
    if (userProfiles.length <= 1) return;
    onDeleteUser(selectedUserId);
    setSelectedUserId("");
  }

  function uploadUserImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === "string" ? reader.result : "";
      setDraft((current) => ({ ...current, imageUrl: url, videoUrl: "", videoPreviewUrl: "" }));
      onUpdateUser(selectedUserId, { imageUrl: url, videoUrl: "", videoPreviewUrl: "" });
    };
    reader.readAsDataURL(file);
  }

  async function generateUserImage() {
    if (generatingImage || !selectedUserId) return;
    const user = userProfiles.find((u) => u.id === selectedUserId);
    if (!user) return;
    setGeneratingImage(true);
    try { await onGenerateUserImage(user); }
    finally { setGeneratingImage(false); }
  }

  async function generateUserVideo() {
    if (generatingVideo || !selectedUserId) return;
    const user = userProfiles.find((u) => u.id === selectedUserId);
    if (!user) return;
    setGeneratingVideo(true);
    try { await onGenerateUserVideo(user); }
    finally { setGeneratingVideo(false); }
  }

  async function handleSteerImage() {
    if (!selectedUserId) return;
    const instruction = window.prompt("How should the avatar image prompt be steered?", "");
    if (!instruction?.trim()) return;
    const user = userProfiles.find((u) => u.id === selectedUserId);
    if (!user) return;
    setGeneratingImage(true);
    try { await onSteerGenerateUserImage(user, instruction.trim()); }
    finally { setGeneratingImage(false); }
  }

  async function handleSteerVideo() {
    if (!selectedUserId) return;
    const instruction = window.prompt("How should the live card video prompt be steered?", "");
    if (!instruction?.trim()) return;
    const user = userProfiles.find((u) => u.id === selectedUserId);
    if (!user) return;
    setGeneratingVideo(true);
    try { await onSteerGenerateUserVideo(user, instruction.trim()); }
    finally { setGeneratingVideo(false); }
  }

  function editorSectionKey(sectionId: string) {
    return `${selectedUserId}:${sectionId}`;
  }

  function promptSectionKey(sectionId: string) {
    return `${selectedUserId}:${sectionId}`;
  }

  function toggleEditorSection(sectionId: string) {
    setExpandedEditorSections((current) => {
      const next = new Set(current);
      if (next.has(editorSectionKey(sectionId))) next.delete(editorSectionKey(sectionId));
      else next.add(editorSectionKey(sectionId));
      return next;
    });
  }

  function togglePromptSection(sectionId: string) {
    const key = promptSectionKey(sectionId);
    setExpandedPromptSections((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function togglePromptVisibility() {
    setVisiblePromptUserIds((current) => {
      const next = new Set(current);
      if (next.has(selectedUserId)) next.delete(selectedUserId);
      else next.add(selectedUserId);
      return next;
    });
  }

  async function rewriteSection(id: string) {
    if (rewritingSectionId) return;
    const label = userSectionLabels[id];
    const instruction = window.prompt(`How should ${label} be changed?`, "");
    if (!instruction?.trim()) return;
    setRewritingSectionId(id);
    try {
      const content = await onRewriteUserSection(draft, id, label, (draft as Record<string, string>)[id] ?? "", instruction.trim());
      setDraft((current) => ({ ...current, [id]: content }));
      onUpdateUser(selectedUserId, { [id]: content } as Partial<UserProfile>);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Section rewrite failed.");
    } finally {
      setRewritingSectionId("");
    }
  }

  async function handleSelfEdit(mode: "auto" | "interactive") {
    if (selfEditing) return;
    setSelfEditing(true);
    setSelfEditMessage("");
    const provider = providerProfiles.find((p) => p.id === activeProviderId) ?? providerProfiles[0];
    try {
      const changes = await onSelfEditUser(draft, provider);
      if (changes.length > 0) {
        if (mode === "interactive") {
          setSelfImproveChanges(changes);
          setShowSelfImproveDialog(true);
          setSelfEditing(false);
        } else {
          for (const change of changes) {
            const targetId = change.section === "response-guidelines" ? "responseGuidelines" : change.section;
            if (targetId in draft) {
              setDraft((current) => ({ ...current, [targetId]: change.content }));
              onUpdateUser(selectedUserId, { [targetId]: change.content } as Partial<UserProfile>);
            }
          }
          setSelfEditMessage(`${changes.length} section${changes.length > 1 ? "s" : ""} improved.`);
          setSelfEditing(false);
        }
      } else {
        setSelfEditMessage("No changes suggested.");
        setSelfEditing(false);
      }
    } catch (error) {
      setSelfEditMessage(error instanceof Error ? error.message : "Self-edit failed.");
      setSelfEditing(false);
    }
  }

  const handleSelfImproveApply = useCallback((acceptedChanges: Array<{ section: string; content: string }>) => {
    for (const change of acceptedChanges) {
      const targetId = change.section === "response-guidelines" ? "responseGuidelines" : change.section;
      if (targetId in draft) {
        setDraft((current) => ({ ...current, [targetId]: change.content }));
        onUpdateUser(selectedUserId, { [targetId]: change.content } as Partial<UserProfile>);
      }
    }
  }, [draft, onUpdateUser, selectedUserId]);

  function providerName(providerId: string | undefined) {
    return providerProfiles.find((p) => p.id === providerId)?.name ?? "Active provider";
  }

  function CollapsibleEditorSection({ children, count, sectionId, title }: { children: React.ReactNode; count?: string; sectionId: string; title: string }) {
    const expanded = expandedEditorSections.has(editorSectionKey(sectionId));
    return <div className="agent-editor-section collapsible-agent-editor-section"><button aria-expanded={expanded} className="agent-editor-section-toggle" type="button" onClick={() => toggleEditorSection(sectionId)}><span className="material-symbols-outlined" aria-hidden="true">{expanded ? "expand_less" : "expand_more"}</span><span>{title}</span>{count ? <small>{count}</small> : null}</button>{expanded ? children : null}</div>;
  }

  const isUserSelected = Boolean(selectedUserId && userProfiles.some((u) => u.id === selectedUserId));
  if (isUserSelected) {
    const promptsVisible = visiblePromptUserIds.has(selectedUserId);
    const identityExpanded = expandedEditorSections.has(editorSectionKey("identity"));
    return <section className="page overlay agents-page agent-detail-page">
      <SettingsCard className="agent-detail-page-card">
        <div className="agent-detail-page-header">
          <button className="agent-back-button" type="button" onClick={closeUserDetail}><span className="material-symbols-outlined" aria-hidden="true">arrow_back</span><span>Users</span></button>
          <button className="agent-add-button" type="button" onClick={addUserAndOpen} aria-label="Add user"><span className="material-symbols-outlined">add</span></button>
        </div>
        <div className="agent-detail-hero">
          <div className="agent-detail-identity-card">
            <button className="agent-detail-portrait" type="button" onClick={() => setExpandedPortraitId(activeUser.id)}><UserPortrait user={activeUser} /></button>
            <span className="agent-profile-copy"><strong>{activeUser.name}</strong><small>{providerName(activeProviderId)}</small></span>
          </div>
          <div className={`agent-detail-identity-panel ${identityExpanded ? "expanded" : ""}`}>
            <button aria-expanded={identityExpanded} className="agent-editor-section-toggle" type="button" onClick={() => toggleEditorSection("identity")}><span className="material-symbols-outlined" aria-hidden="true">{identityExpanded ? "expand_less" : "expand_more"}</span><span>Identity</span></button>
            {identityExpanded ? <div className="agent-detail-identity-fields"><div className="field-grid three-column"><label>User Name<input value={draft.name} onBlur={commitName} onChange={(e) => setDraft((current) => ({ ...current, name: e.target.value }))} /></label></div></div> : null}
            <CollapsibleEditorSection count={draft.dialogueExamples ? `${draft.dialogueExamples.length} chars` : "empty"} sectionId="dialogue-examples" title="Dialogue Examples"><label>Dialogue Examples<textarea value={draft.dialogueExamples ?? ""} onBlur={() => commit("dialogueExamples", draft.dialogueExamples ?? "")} onChange={(e) => setDraft((current) => ({ ...current, dialogueExamples: e.target.value }))} placeholder={'User: Can you help me?\nAssistant: Of course. Tell me what you need.\n\nUser: ...\nAssistant: ...'} rows={8} /><span className="setting-hint">Optional style examples sent with the user's context. Use short User/Assistant turns.</span></label></CollapsibleEditorSection>
            <CollapsibleEditorSection count={draft.startingMessage ? `${draft.startingMessage.length} chars` : "empty"} sectionId="starting-message" title="Greeting / Starting Message"><label>Greeting / Starting Message<textarea value={draft.startingMessage ?? ""} onBlur={() => commit("startingMessage", draft.startingMessage ?? "")} onChange={(e) => setDraft((current) => ({ ...current, startingMessage: e.target.value }))} placeholder="Optional first message this user posts when a new chat starts." rows={4} /><span className="setting-hint">Shown as this user's first message in new chats. Leave blank to disable.</span></label></CollapsibleEditorSection>
            <CollapsibleEditorSection count={draft.imageUrl || draft.videoUrl ? "media set" : "empty"} sectionId="model-art" title="Model Art"><div className="agent-image-tools"><div className="agent-image-actions"><label className="small-action-button agent-image-upload"><span className="material-symbols-outlined" aria-hidden="true">upload</span>Upload image<input accept="image/*" type="file" onChange={uploadUserImage} /></label><button className="small-action-button agent-image-action-button" disabled={generatingImage} type="button" onClick={generateUserImage}>{generatingImage ? "Generating..." : "Generate image"}</button><button aria-label="Steer avatar prompt" className="small-action-button" disabled={generatingImage} type="button" onClick={handleSteerImage} title="Steer avatar prompt"><span className="material-symbols-outlined" aria-hidden="true">auto_fix_high</span></button><button className="small-action-button agent-image-action-button" disabled={generatingVideo || !draft.imageUrl} type="button" onClick={generateUserVideo}>{generatingVideo ? "Generating live card..." : "Generate 5s live card"}</button><button aria-label="Steer live card prompt" className="small-action-button" disabled={generatingVideo || !draft.imageUrl} type="button" onClick={handleSteerVideo} title="Steer live card prompt"><span className="material-symbols-outlined" aria-hidden="true">auto_fix_high</span></button><button className="delete-button small-action-button" disabled={!draft.videoUrl && !draft.imageUrl} type="button" onClick={() => { setDraft((current) => ({ ...current, imageUrl: "", videoUrl: "", videoPreviewUrl: "" })); onUpdateUser(selectedUserId, { imageUrl: "", videoUrl: "", videoPreviewUrl: "" }); }}>Remove media</button></div></div></CollapsibleEditorSection>
          </div>
        </div>
        <div className="agent-profile-editor">
          <div className="agent-editor-section">
            <div className="agent-section-header"><h4>Prompting</h4><button aria-label={promptsVisible ? "Hide prompting fields" : "Show prompting fields"} aria-pressed={promptsVisible} className="agent-prompt-visibility-button" type="button" onClick={togglePromptVisibility}><span className="material-symbols-outlined" aria-hidden="true">{promptsVisible ? "visibility_off" : "visibility"}</span>{promptsVisible ? "Hide" : "Show"}</button></div>
            {promptsVisible ? <div className="prompt-editor-grid">
              {userSectionIds.map((id) => {
                const sectionExpanded = expandedPromptSections.has(promptSectionKey(id));
                const label = userSectionLabels[id];
                const content = draft[id] ?? "";
                return <label className="prompt-section-field" key={id}><span className="prompt-section-label"><button aria-expanded={sectionExpanded} className="prompt-section-toggle" type="button" onClick={() => togglePromptSection(id)}><span className="material-symbols-outlined" aria-hidden="true">{sectionExpanded ? "expand_less" : "expand_more"}</span><span>{label}</span>{content ? <small>{content.length} chars</small> : <small>empty</small>}</button><button aria-label={`Rewrite ${label}`} className="prompt-section-wand" disabled={Boolean(rewritingSectionId)} type="button" onClick={() => rewriteSection(id)} title={`Rewrite ${label}`}><span className="material-symbols-outlined" aria-hidden="true">auto_fix_high</span>{rewritingSectionId === id ? "Rewriting..." : ""}</button></span>{sectionExpanded ? <textarea value={content} onBlur={() => commit(id, content)} onChange={(e) => setDraft((current) => ({ ...current, [id]: e.target.value }))} rows={id === "description" ? 10 : 7} /> : null}</label>;
              })}
            </div> : <p className="agent-prompt-collapsed-note">Prompt fields are hidden. Use the eye control to review or edit this user's description, personality, appearance, response guidelines, and preferences.</p>}
          </div>
          <div className="card-footer-actions"><div className="self-improve-dropdown"><button className="small-action-button" disabled={selfEditing} type="button" onClick={() => handleSelfEdit(selfImproveMode)}>{selfEditing ? "Improving..." : "Self-Improve"}</button><button aria-label="Self-improve mode" className="small-action-button self-improve-mode-toggle" disabled={selfEditing} type="button" onClick={() => setSelfImproveMode((prev) => prev === "auto" ? "interactive" : "auto")} title={selfImproveMode === "interactive" ? "Switch to auto-apply" : "Switch to interactive review"}><span className="material-symbols-outlined" aria-hidden="true">{selfImproveMode === "interactive" ? "feedback" : "auto_fix_high"}</span></button></div>{selfEditMessage ? <span className="self-edit-message">{selfEditMessage}</span> : null}<span className="self-improve-mode-label">{selfImproveMode === "interactive" ? "Review" : "Auto"}</span><button className="delete-button small-action-button" disabled={userProfiles.length <= 1} type="button" onClick={handleDelete}>Delete User</button></div>
        </div>
      </SettingsCard>
      {expandedPortraitId === activeUser.id ? <div className="agent-portrait-expanded-overlay" role="dialog" aria-label={`${activeUser.name} portrait`} onClick={() => setExpandedPortraitId("")}><UserPortrait className="agent-portrait-expanded" user={activeUser} /></div> : null}
      {showSelfImproveDialog && selfImproveChanges && selectedUserId ? <SelfImproveDialog proposedChanges={selfImproveChanges} currentBlocks={userSectionIds.map((id) => ({ id: id === "responseGuidelines" ? "response-guidelines" : id, name: userSectionLabels[id], content: draft[id] ?? "", enabled: true, role: "system" as const, position: "top" as const, priority: 50 }))} provider={providerProfiles.find((p) => p.id === activeProviderId) ?? providerProfiles[0]} promptProfile={{ id: selectedUserId, name: activeUser.name, assistantName: activeUser.name, blocks: [], dialogueExamples: draft.dialogueExamples, startingMessage: draft.startingMessage, imageUrl: "", videoUrl: "", videoPreviewUrl: "", providerId: "", verbosity: 60 }} onApply={handleSelfImproveApply} onClose={() => { setShowSelfImproveDialog(false); setSelfImproveChanges(null); }} /> : null}
    </section>;
  }

  return <section className="page overlay agents-page">
    <SettingsCard className="agent-library-card">
      <div className="agent-library-header"><h3>Users</h3><p>Manage user profiles. The active user's details are used across agents.</p><button className="agent-add-button" type="button" onClick={addUserAndOpen} aria-label="Add user"><span className="material-symbols-outlined">add</span></button></div>
      <div className="agent-main-carousel" ref={libraryCarouselRef} onWheel={scrollLibraryCarouselWheel} aria-label="User selector carousel">{userProfiles.filter((u) => u?.id).map((user) => <button className={`agent-profile-card agent-library-tile ${user.id === activeUserId ? "active" : ""}`} key={user.id} type="button" onClick={() => openUser(user.id)}><span className="agent-profile-summary"><span className="agent-avatar-tile"><UserPortrait user={user} /></span><span className="agent-profile-copy"><strong>{user.name}</strong></span></span></button>)}</div>
    </SettingsCard>
  </section>;
}

export const UsersPage = memo(UsersPageComponent);
