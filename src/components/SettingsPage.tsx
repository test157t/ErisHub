import { memo, ReactNode, useState } from "react";
import { SettingsCard } from "./SettingsCard";

type SettingsPageProps = {
  appearancePanel: ReactNode;
  editorCodeCompletionEnabled: boolean;
  providerPanel: ReactNode;
  onEditorCodeCompletionEnabledChange: (enabled: boolean) => void;
  wrapNormalChatMessages: boolean;
  onWrapNormalChatMessagesChange: (enabled: boolean) => void;
};

export const SettingsPage = memo(function SettingsPage({
  appearancePanel,
  editorCodeCompletionEnabled,
  providerPanel,
  onEditorCodeCompletionEnabledChange,
  wrapNormalChatMessages,
  onWrapNormalChatMessagesChange
}: SettingsPageProps) {
  const [activeCategory, setActiveCategory] = useState<"general" | "appearance" | "providers">("general");
  const categories = [
    { id: "general" as const, icon: "fa-sliders", label: "General", detail: "Chat and editor behavior" },
    { id: "appearance" as const, icon: "fa-palette", label: "Appearance", detail: "Background and themes" },
    { id: "providers" as const, icon: "fa-plug", label: "Providers", detail: "Connections and generation" }
  ];

  return <section className="page overlay app-settings-page">
    <div className="settings-page-header">
      <h2>Settings</h2>
      <p>Configure ErisHub to your preferences.</p>
    </div>

    <div className="settings-workspace">
      <nav className="settings-category-nav" aria-label="Settings categories">
        {categories.map((category) => <button aria-current={activeCategory === category.id ? "page" : undefined} className={activeCategory === category.id ? "active" : ""} key={category.id} type="button" onClick={() => setActiveCategory(category.id)}>
          <i className={`fa-solid ${category.icon}`} />
          <span><strong>{category.label}</strong><small>{category.detail}</small></span>
          <i className="fa-solid fa-chevron-right" />
        </button>)}
      </nav>
      <main className="settings-category-content">
    {activeCategory === "general" ? <SettingsCard className="settings-section-card" title="General">
      <div className="settings-option-list">
        <label className="settings-option-row">
          <input
            checked={wrapNormalChatMessages}
            onChange={(event) => onWrapNormalChatMessagesChange(event.target.checked)}
            type="checkbox"
          />
          <span>
            <strong>Quote user messages</strong>
            <small>Wrap normal chat messages in quotation marks before sending.</small>
          </span>
        </label>
        <label className="settings-option-row">
          <input
            checked={editorCodeCompletionEnabled}
            onChange={(event) => onEditorCodeCompletionEnabledChange(event.target.checked)}
            type="checkbox"
          />
          <span>
            <strong>Editor code completion</strong>
            <small>Enable Alt+Space / Alt-click inline LLM code completions in the editor.</small>
          </span>
        </label>
      </div>
    </SettingsCard> : null}

    {activeCategory === "appearance" ? <SettingsCard className="settings-section-card" title="Appearance">
      {appearancePanel}
    </SettingsCard> : null}

    {activeCategory === "providers" ? providerPanel : null}
      </main>
    </div>
  </section>;
});
