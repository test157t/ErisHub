import { ChangeEvent, memo, ReactNode, useCallback, useEffect, useRef, useState, WheelEvent } from "react";
import type { PromptProfile, ProviderConfig } from "../../shared/types";
import { SettingsCard } from "./SettingsCard";
import { SelfImproveDialog } from "./SelfImproveDialog";

type PromptBlock = PromptProfile["blocks"][number];

type AgentsPageProps = {
  activePromptProfileId: string;
  activeProviderId: string;
  defaultPromptBlock: PromptBlock;
  promptProfile: PromptProfile;
  promptProfiles: PromptProfile[];
  providerProfiles: ProviderConfig[];
  onAddPromptProfile: () => void;
  onDeletePromptProfile: (profileId: string) => void;
  onGeneratePromptProfileImage: (profile: PromptProfile) => Promise<void>;
  onGeneratePromptProfileVideo: (profile: PromptProfile) => Promise<void>;
  onSteerGenerateImage: (profile: PromptProfile, instruction: string) => Promise<void>;
  onSteerGenerateVideo: (profile: PromptProfile, instruction: string) => Promise<void>;
  onPromptProfileChange: (profileId: string) => void;
  onRewritePromptSection: (profile: PromptProfile, section: PromptBlock, instruction: string) => Promise<string>;
  onUpdatePromptProfile: (profileId: string, changes: Partial<PromptProfile>) => void;
};

const promptSectionIds = ["description", "personality", "appearance", "response-guidelines", "preferences"] as const;
const promptSectionLabels: Record<typeof promptSectionIds[number], string> = {
  description: "Description",
  personality: "Personality",
  appearance: "Appearance",
  "response-guidelines": "Response Guidelines",
  preferences: "Preferences"
};

function agentInitials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "AI";
}

function promptBlockTemplate(id: typeof promptSectionIds[number], fallback: PromptBlock): PromptBlock {
  const index = promptSectionIds.indexOf(id);
  return { ...fallback, id, name: promptSectionLabels[id], enabled: true, role: "system", position: "top", priority: 50 + index, content: "" };
}

function promptBlock(profile: PromptProfile, id: typeof promptSectionIds[number], fallback: PromptBlock) {
  return profile.blocks.find((block) => block.id === id) ?? promptBlockTemplate(id, fallback);
}

function promptBlocks(profile: PromptProfile, fallback: PromptBlock) {
  return promptSectionIds.map((id) => promptBlock(profile, id, fallback));
}

function AgentPortrait({ className = "", profile }: { className?: string; profile: PromptProfile }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!("IntersectionObserver" in window)) {
      setIsVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setIsVisible(entry.isIntersecting), { rootMargin: "120px" });
    observer.observe(video);
    return () => observer.disconnect();
  }, [profile.videoUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isVisible) video.play().catch(() => undefined);
    else video.pause();
  }, [isVisible]);

  const previewUrl = profile.videoPreviewUrl || profile.videoUrl;
  if (previewUrl && /\.gif(?:$|[?#])/i.test(previewUrl)) return <img alt={`${profile.name} animated portrait`} className={className} src={previewUrl} />;
  if (previewUrl) return <video ref={videoRef} loop muted playsInline preload="metadata" className={className} poster={profile.imageUrl || undefined} src={previewUrl} />;
  return profile.imageUrl ? <img alt={`${profile.name} portrait`} className={className} src={profile.imageUrl} /> : agentInitials(profile.name);
}

function AgentsPageComponent({ activePromptProfileId, activeProviderId, defaultPromptBlock, promptProfile, promptProfiles, providerProfiles, onAddPromptProfile, onDeletePromptProfile, onGeneratePromptProfileImage, onGeneratePromptProfileVideo, onSteerGenerateImage, onSteerGenerateVideo, onPromptProfileChange, onRewritePromptSection, onUpdatePromptProfile }: AgentsPageProps) {
  const [draft, setDraft] = useState(promptProfile);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [visiblePromptAgentIds, setVisiblePromptAgentIds] = useState<Set<string>>(() => new Set());
  const [expandedPromptSections, setExpandedPromptSections] = useState<Set<string>>(() => new Set());
  const [expandedEditorSections, setExpandedEditorSections] = useState<Set<string>>(() => new Set());
  const [generatingImage, setGeneratingImage] = useState(false);
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [rewritingSectionId, setRewritingSectionId] = useState<string>("");
  const [selfEditing, setSelfEditing] = useState(false);
  const [selfEditMessage, setSelfEditMessage] = useState("");
  const [selfImproveMode, setSelfImproveMode] = useState<"auto" | "interactive">("interactive");
  const [selfImproveChanges, setSelfImproveChanges] = useState<Array<{ section: string; content: string }> | null>(null);
  const [showSelfImproveDialog, setShowSelfImproveDialog] = useState(false);
  const [expandedPortraitId, setExpandedPortraitId] = useState("");
  const openAddedAgentRef = useRef(false);
  const libraryCarouselRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { setDraft(promptProfile); }, [promptProfile]);
  useEffect(() => {
    if (!openAddedAgentRef.current) return;
    openAddedAgentRef.current = false;
    setSelectedAgentId(activePromptProfileId);
    setVisiblePromptAgentIds((current) => new Set(current).add(activePromptProfileId));
  }, [activePromptProfileId]);

  function commit<K extends keyof PromptProfile>(key: K, value: PromptProfile[K]) {
    if (promptProfile[key] !== value) onUpdatePromptProfile(promptProfile.id, { [key]: value } as Partial<PromptProfile>);
  }

  function commitAgentName() {
    if (promptProfile.name !== draft.name || promptProfile.assistantName !== draft.name) onUpdatePromptProfile(promptProfile.id, { name: draft.name, assistantName: draft.name });
  }

  function commitPromptBlocks() {
    const blocks = promptBlocks(draft, defaultPromptBlock);
    if (JSON.stringify(promptBlocks(promptProfile, defaultPromptBlock)) !== JSON.stringify(blocks)) onUpdatePromptProfile(promptProfile.id, { blocks });
  }

  function updatePromptBlock(id: typeof promptSectionIds[number], content: string) {
    setDraft((current) => ({
      ...current,
      blocks: promptBlocks(current, defaultPromptBlock).map((block) => block.id === id ? { ...block, content } : block)
    }));
  }

  async function rewritePromptBlock(id: typeof promptSectionIds[number]) {
    if (rewritingSectionId) return;
    const section = promptBlock(draft, id, defaultPromptBlock);
    const instruction = window.prompt(`How should ${promptSectionLabels[id]} be changed?`, "");
    if (!instruction?.trim()) return;
    setRewritingSectionId(id);
    try {
      const currentProfile = { ...draft, blocks: promptBlocks(draft, defaultPromptBlock) };
      const content = await onRewritePromptSection(currentProfile, section, instruction.trim());
      const nextBlocks = promptBlocks(currentProfile, defaultPromptBlock).map((block) => block.id === id ? { ...block, content } : block);
      setDraft((current) => ({ ...current, blocks: nextBlocks }));
      onUpdatePromptProfile(promptProfile.id, { blocks: nextBlocks });
    } catch (error) {
      alert(error instanceof Error ? error.message : "Agent section rewrite failed.");
    } finally {
      setRewritingSectionId("");
    }
  }

  function providerName(providerId: string | undefined) {
    return providerProfiles.find((provider) => provider.id === providerId)?.name ?? "Active provider";
  }

  function openAgent(profileId: string) {
    setSelectedAgentId(profileId);
    setVisiblePromptAgentIds((current) => new Set(current).add(profileId));
    if (profileId !== activePromptProfileId) onPromptProfileChange(profileId);
  }

  function addAgentAndOpen() {
    openAddedAgentRef.current = true;
    onAddPromptProfile();
  }

  function uploadAgentImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onUpdatePromptProfile(promptProfile.id, { imageUrl: typeof reader.result === "string" ? reader.result : "", videoUrl: "", videoPreviewUrl: "" });
    reader.readAsDataURL(file);
  }

  async function generateAgentImage() {
    if (generatingImage) return;
    setGeneratingImage(true);
    try { await onGeneratePromptProfileImage(promptProfile); }
    finally { setGeneratingImage(false); }
  }

  async function generateAgentVideo() {
    if (generatingVideo) return;
    setGeneratingVideo(true);
    try { await onGeneratePromptProfileVideo(promptProfile); }
    finally { setGeneratingVideo(false); }
  }

  async function handleSteerImage() {
    const instruction = window.prompt("How should the avatar image prompt be steered?", "");
    if (!instruction?.trim()) return;
    setGeneratingImage(true);
    try { await onSteerGenerateImage(promptProfile, instruction.trim()); }
    finally { setGeneratingImage(false); }
  }

  async function handleSteerVideo() {
    const instruction = window.prompt("How should the live card video prompt be steered?", "");
    if (!instruction?.trim()) return;
    setGeneratingVideo(true);
    try { await onSteerGenerateVideo(promptProfile, instruction.trim()); }
    finally { setGeneratingVideo(false); }
  }

  function togglePromptVisibility(profileId: string) {
    setVisiblePromptAgentIds((current) => {
      const next = new Set(current);
      if (next.has(profileId)) next.delete(profileId);
      else next.add(profileId);
      return next;
    });
  }

  function promptSectionKey(profileId: string, sectionId: string) {
    return `${profileId}:${sectionId}`;
  }

  function togglePromptSection(profileId: string, sectionId: string) {
    const key = promptSectionKey(profileId, sectionId);
    setExpandedPromptSections((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function editorSectionKey(profileId: string, sectionId: string) {
    return `${profileId}:${sectionId}`;
  }

  function toggleEditorSection(profileId: string, sectionId: string) {
    const key = editorSectionKey(profileId, sectionId);
    setExpandedEditorSections((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function CollapsibleEditorSection({ children, count, profileId, sectionId, title }: { children: ReactNode; count?: string; profileId: string; sectionId: string; title: string }) {
    const expanded = expandedEditorSections.has(editorSectionKey(profileId, sectionId));
    return <div className="agent-editor-section collapsible-agent-editor-section"><button aria-expanded={expanded} className="agent-editor-section-toggle" type="button" onClick={() => toggleEditorSection(profileId, sectionId)}><span className="material-symbols-outlined" aria-hidden="true">{expanded ? "expand_less" : "expand_more"}</span><span>{title}</span>{count ? <small>{count}</small> : null}</button>{expanded ? children : null}</div>;
  }

  function closeAgentDetail() {
    setSelectedAgentId("");
  }

  function scrollLibraryCarouselWheel(event: WheelEvent<HTMLDivElement>) {
    const carousel = libraryCarouselRef.current;
    if (!carousel || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    carousel.scrollLeft += event.deltaY;
  }

  async function handleSelfEdit(mode: "auto" | "interactive") {
    if (selfEditing) return;
    setSelfEditing(true);
    setSelfEditMessage("");
    const provider = providerProfiles.find((p) => p.id === (activeProviderId || draft.providerId)) ?? providerProfiles[0];
    try {
      const res = await fetch("/api/modules/evolution/self-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptProfile: draft, provider })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Self-edit request failed.");
      if (data.success && Array.isArray(data.changes) && data.changes.length > 0) {
        const changes = (data.changes as Array<{ section: string; content: string }>).map((c) => ({ ...c, section: c.section.toLowerCase() }));
        if (mode === "interactive") {
          setSelfImproveChanges(changes);
          setShowSelfImproveDialog(true);
          setSelfEditing(false);
        } else {
          const existingIds = new Set(draft.blocks.map((b) => b.id));
          const nextBlocks = [
            ...draft.blocks.map((b) => {
              const change = changes.find((c) => c.section === b.id);
              return change ? { ...b, content: change.content } : b;
            }),
            ...changes
              .filter((c) => !existingIds.has(c.section))
              .map((c) => ({
                id: c.section, name: c.section, enabled: true, role: "system" as const, position: "after-history" as const, priority: 50, content: c.content
              }))
          ];
          setDraft((current) => ({ ...current, blocks: nextBlocks }));
          onUpdatePromptProfile(promptProfile.id, { blocks: nextBlocks });
          setSelfEditMessage(`${data.changes.length} section${data.changes.length > 1 ? "s" : ""} improved.`);
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
    const existingIds = new Set(draft.blocks.map((b) => b.id));
    const nextBlocks = [
      ...draft.blocks.map((b) => {
        const change = acceptedChanges.find((c) => c.section === b.id);
        return change ? { ...b, content: change.content } : b;
      }),
      ...acceptedChanges
        .filter((c) => !existingIds.has(c.section))
        .map((c) => ({
          id: c.section, name: c.section, enabled: true, role: "system" as const, position: "after-history" as const, priority: 50, content: c.content
        }))
    ];
    setDraft((current) => ({ ...current, blocks: nextBlocks }));
    onUpdatePromptProfile(promptProfile.id, { blocks: nextBlocks });
  }, [draft.blocks, onUpdatePromptProfile, promptProfile.id]);

  function renderEditor(profile: PromptProfile, promptsVisible: boolean) {
    const identityExpanded = expandedEditorSections.has(editorSectionKey(profile.id, "identity"));
    return <div className="agent-profile-editor">
      <button aria-expanded={identityExpanded} className="agent-editor-section-toggle compact-identity-toggle" type="button" onClick={() => toggleEditorSection(profile.id, "identity")}><span className="material-symbols-outlined" aria-hidden="true">{identityExpanded ? "expand_less" : "expand_more"}</span><span>Identity</span></button>
      <div className="agent-editor-section">
        <div className="agent-section-header"><h4>Prompting</h4><button aria-label={promptsVisible ? "Hide prompting fields" : "Show prompting fields"} aria-pressed={promptsVisible} className="agent-prompt-visibility-button" type="button" onClick={() => togglePromptVisibility(profile.id)}><span className="material-symbols-outlined" aria-hidden="true">{promptsVisible ? "visibility_off" : "visibility"}</span>{promptsVisible ? "Hide" : "Show"}</button></div>
        {promptsVisible ? <div className="prompt-editor-grid">
          {promptSectionIds.map((id) => {
            const sectionExpanded = expandedPromptSections.has(promptSectionKey(profile.id, id));
            const section = promptBlock(draft, id, defaultPromptBlock);
            return <label className="prompt-section-field" key={id}><span className="prompt-section-label"><button aria-expanded={sectionExpanded} className="prompt-section-toggle" type="button" onClick={() => togglePromptSection(profile.id, id)}><span className="material-symbols-outlined" aria-hidden="true">{sectionExpanded ? "expand_less" : "expand_more"}</span><span>{promptSectionLabels[id]}</span>{section.content ? <small>{section.content.length} chars</small> : <small>empty</small>}</button><button aria-label={`Rewrite ${promptSectionLabels[id]}`} className="prompt-section-wand" disabled={Boolean(rewritingSectionId)} type="button" onClick={() => rewritePromptBlock(id)} title={`Rewrite ${promptSectionLabels[id]}`}><span className="material-symbols-outlined" aria-hidden="true">auto_fix_high</span>{rewritingSectionId === id ? "Rewriting..." : ""}</button></span>{sectionExpanded ? <textarea value={section.content} onBlur={commitPromptBlocks} onChange={(event) => updatePromptBlock(id, event.target.value)} rows={id === "description" ? 10 : 7} /> : null}</label>;
          })}
        </div> : <p className="agent-prompt-collapsed-note">Prompt fields are hidden. Use the eye control to review or edit this agent's description, personality, appearance, response guidelines, preferences, examples, and greeting.</p>}
      </div>
      <div className="card-footer-actions"><div className="self-improve-dropdown"><button className="small-action-button" disabled={selfEditing} type="button" onClick={() => handleSelfEdit(selfImproveMode)}>{selfEditing ? "Improving..." : "Self-Improve"}</button><button aria-label="Self-improve mode" className="small-action-button self-improve-mode-toggle" disabled={selfEditing} type="button" onClick={() => setSelfImproveMode((prev) => prev === "auto" ? "interactive" : "auto")} title={selfImproveMode === "interactive" ? "Switch to auto-apply" : "Switch to interactive review"}><span className="material-symbols-outlined" aria-hidden="true">{selfImproveMode === "interactive" ? "feedback" : "auto_fix_high"}</span></button></div>{selfEditMessage ? <span className="self-edit-message">{selfEditMessage}</span> : null}<span className="self-improve-mode-label">{selfImproveMode === "interactive" ? "Review" : "Auto"}</span><button className="delete-button small-action-button" disabled={promptProfiles.length <= 1} type="button" onClick={() => { onDeletePromptProfile(activePromptProfileId); closeAgentDetail(); }}>Delete Agent</button></div>
    </div>;
  }

  if (selectedAgentId) {
    const selectedProfile = promptProfiles.find((profile) => profile.id === selectedAgentId) ?? promptProfile;
    const isActiveSelection = selectedProfile.id === activePromptProfileId;
    const identityExpanded = expandedEditorSections.has(editorSectionKey(selectedProfile.id, "identity"));
    return <section className="page overlay agents-page agent-detail-page">
      <SettingsCard className="agent-detail-page-card">
        <div className="agent-detail-page-header">
          <button className="agent-back-button" type="button" onClick={closeAgentDetail}><span className="material-symbols-outlined" aria-hidden="true">arrow_back</span><span>Agents</span></button>
          <button className="agent-add-button" type="button" onClick={addAgentAndOpen} aria-label="Add agent"><span className="material-symbols-outlined">add</span></button>
        </div>
        <div className="agent-detail-hero">
          <div className="agent-detail-identity-card">
            <button className="agent-detail-portrait" type="button" onClick={() => setExpandedPortraitId(selectedProfile.id)}><AgentPortrait profile={selectedProfile} /></button>
            <span className="agent-profile-copy"><strong>{selectedProfile.name}</strong><small>{providerName(selectedProfile.providerId)}</small></span>
          </div>
          <div className={`agent-detail-identity-panel ${identityExpanded ? "expanded" : ""}`}>
            <button aria-expanded={identityExpanded} className="agent-editor-section-toggle" type="button" onClick={() => toggleEditorSection(selectedProfile.id, "identity")}><span className="material-symbols-outlined" aria-hidden="true">{identityExpanded ? "expand_less" : "expand_more"}</span><span>Identity</span></button>
            {identityExpanded ? <div className="agent-detail-identity-fields"><div className="field-grid three-column"><label>Agent Name<input value={draft.name} onBlur={commitAgentName} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value, assistantName: event.target.value }))} /></label><label>Provider<select value={draft.providerId ?? ""} onChange={(event) => { const providerId = event.target.value || undefined; setDraft((current) => ({ ...current, providerId })); onUpdatePromptProfile(promptProfile.id, { providerId }); }}><option value="">Use active provider</option>{providerProfiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><label className="verbosity-control"><span>Verbosity: {draft.verbosity ?? 60}</span><input min="0" max="100" step="1" type="range" value={draft.verbosity ?? 60} onBlur={() => commit("verbosity", Number(draft.verbosity ?? 60))} onChange={(event) => setDraft((current) => ({ ...current, verbosity: Number(event.target.value) }))} onPointerUp={() => commit("verbosity", Number(draft.verbosity ?? 60))} /></label></div> : null}
            <CollapsibleEditorSection count={draft.dialogueExamples ? `${draft.dialogueExamples.length} chars` : "empty"} profileId={selectedProfile.id} sectionId="dialogue-examples" title="Dialogue Examples"><label>Dialogue Examples<textarea value={draft.dialogueExamples ?? ""} onBlur={() => commit("dialogueExamples", draft.dialogueExamples ?? "")} onChange={(event) => setDraft((current) => ({ ...current, dialogueExamples: event.target.value }))} placeholder={'User: Can you help me?\nAssistant: Of course. Tell me what you need.\n\nUser: ...\nAssistant: ...'} rows={8} /><span className="setting-hint">Optional style examples sent with this agent's system prompt. Use short User/Assistant turns.</span></label></CollapsibleEditorSection>
            <CollapsibleEditorSection count={draft.startingMessage ? `${draft.startingMessage.length} chars` : "empty"} profileId={selectedProfile.id} sectionId="starting-message" title="Greeting / Starting Message"><label>Greeting / Starting Message<textarea value={draft.startingMessage ?? ""} onBlur={() => commit("startingMessage", draft.startingMessage ?? "")} onChange={(event) => setDraft((current) => ({ ...current, startingMessage: event.target.value }))} placeholder="Optional first message this agent posts when a new chat starts." rows={4} /><span className="setting-hint">Shown as this agent's first assistant message in new chats. Leave blank to disable.</span></label></CollapsibleEditorSection>
            <CollapsibleEditorSection count={draft.imageUrl || draft.videoUrl ? "media set" : "empty"} profileId={selectedProfile.id} sectionId="model-art" title="Model Art"><div className="agent-image-tools"><div className="agent-image-actions"><label className="small-action-button agent-image-upload"><span className="material-symbols-outlined" aria-hidden="true">upload</span>Upload image<input accept="image/*" type="file" onChange={uploadAgentImage} /></label><button className="small-action-button agent-image-action-button" disabled={generatingImage} type="button" onClick={generateAgentImage}>{generatingImage ? "Generating..." : "Generate image"}</button><button aria-label="Steer avatar prompt" className="small-action-button" disabled={generatingImage} type="button" onClick={handleSteerImage} title="Steer avatar prompt"><span className="material-symbols-outlined" aria-hidden="true">auto_fix_high</span></button><button className="small-action-button agent-image-action-button" disabled={generatingVideo || !draft.imageUrl} type="button" onClick={generateAgentVideo}>{generatingVideo ? "Generating live card..." : "Generate 5s live card"}</button><button aria-label="Steer live card prompt" className="small-action-button" disabled={generatingVideo || !draft.imageUrl} type="button" onClick={handleSteerVideo} title="Steer live card prompt"><span className="material-symbols-outlined" aria-hidden="true">auto_fix_high</span></button><button className="delete-button small-action-button" disabled={!draft.videoUrl && !draft.imageUrl} type="button" onClick={() => onUpdatePromptProfile(promptProfile.id, { imageUrl: "", videoUrl: "", videoPreviewUrl: "" })}>Remove media</button></div></div></CollapsibleEditorSection>
          </div>
        </div>
        {isActiveSelection ? renderEditor(selectedProfile, visiblePromptAgentIds.has(selectedProfile.id)) : <p className="agent-prompt-collapsed-note">Loading agent editor...</p>}
      </SettingsCard>
      {expandedPortraitId === selectedProfile.id ? <div className="agent-portrait-expanded-overlay" role="dialog" aria-label={`${selectedProfile.name} portrait`} onClick={() => setExpandedPortraitId("")}><AgentPortrait className="agent-portrait-expanded" profile={selectedProfile} /></div> : null}
      {showSelfImproveDialog && selfImproveChanges ? <SelfImproveDialog proposedChanges={selfImproveChanges} currentBlocks={draft.blocks} provider={providerProfiles.find((p) => p.id === (activeProviderId || draft.providerId)) ?? providerProfiles[0]} promptProfile={draft} onApply={handleSelfImproveApply} onClose={() => { setShowSelfImproveDialog(false); setSelfImproveChanges(null); }} /> : null}
    </section>;
  }

  return <section className="page overlay agents-page">
    <SettingsCard className="agent-library-card">
      <div className="agent-library-header"><h3>Agent Library</h3><p>Pick an agent from the carousel to open its dedicated editor page.</p><button className="agent-add-button" type="button" onClick={addAgentAndOpen} aria-label="Add agent"><span className="material-symbols-outlined">add</span></button></div>
      <div className="agent-main-carousel" ref={libraryCarouselRef} onWheel={scrollLibraryCarouselWheel} aria-label="Agent selector carousel">{promptProfiles.map((profile) => <button className={`agent-profile-card agent-library-tile ${profile.id === activePromptProfileId ? "active" : ""}`} key={profile.id} type="button" onClick={() => openAgent(profile.id)}><span className="agent-profile-summary"><span className="agent-avatar-tile"><AgentPortrait profile={profile} /></span><span className="agent-profile-copy"><strong>{profile.name}</strong><small>{providerName(profile.providerId)}</small></span></span></button>)}</div>
    </SettingsCard>
  </section>;
}

export const AgentsPage = memo(AgentsPageComponent);
