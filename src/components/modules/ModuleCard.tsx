import { KeyboardEvent, memo, ReactNode, SetStateAction } from "react";
import type { ModuleConfig } from "../../../shared/types";
import type { ModuleManifest } from "./types";

type ModuleCardProps = {
  config?: ModuleConfig;
  hasSettingsPanel: boolean;
  isExpanded: boolean;
  manifest: ModuleManifest;
  settingsMounted: boolean;
  children?: ReactNode;
  onUpdateModule: (moduleId: string, changes: Partial<ModuleConfig>) => void;
  setExpandedModuleId: (value: SetStateAction<string | null>) => void;
};

export const ModuleCard = memo(function ModuleCard({ config, hasSettingsPanel, isExpanded, manifest, settingsMounted, children, onUpdateModule, setExpandedModuleId }: ModuleCardProps) {
  const toggleExpanded = () => setExpandedModuleId((current) => current === manifest.id ? null : manifest.id);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleExpanded();
    }
  };

  return <article className={`module-card module-card-${manifest.id} ${isExpanded ? "expanded" : ""}`}>
    <div
      className="module-card-header"
      role="button"
      tabIndex={0}
      aria-expanded={isExpanded}
      onClick={toggleExpanded}
      onKeyDown={handleKeyDown}
    >
      <div className="module-title-block">
        <div className="module-title-row"><h3>{manifest.name}</h3><span className="module-kind-inline">{manifest.kind}</span></div>
        <span className="module-inline-description">{manifest.description}</span>
      </div>
      <div className="module-actions">
        <label className="module-enable" onClick={(event) => event.stopPropagation()}><input checked={config?.enabled === true} onChange={(event) => onUpdateModule(manifest.id, { enabled: event.target.checked })} type="checkbox" /> {config?.enabled === true ? "Enabled" : "Disabled"}</label>
      </div>
    </div>
    {settingsMounted ? <div className="module-settings" style={{ display: isExpanded && hasSettingsPanel ? "" : "none" }}>
      {children}
    </div> : null}
  </article>;
});
