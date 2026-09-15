import { memo, ReactNode, SetStateAction } from "react";
import type { ModuleConfig } from "../../../shared/types";
import { ModuleCard } from "./ModuleCard";
import type { ModuleManifest, ModuleSettings } from "./types";

type ModulesPageProps = {
  expandedModuleId: string | null;
  moduleConfigById: Map<string, ModuleConfig>;
  moduleManifestColumns: ModuleManifest[][];
  moduleManifests: ModuleManifest[];
  onUpdateModule: (moduleId: string, changes: Partial<ModuleConfig>) => void;
  renderModuleSettingsPanel: (manifest: ModuleManifest, settings: ModuleSettings) => ReactNode;
  setExpandedModuleId: (value: SetStateAction<string | null>) => void;
};

const customSettingsPanelIds = new Set(["assets", "classify", "computation", "embody", "hypno", "llama-cpp", "memory-bank", "organizer", "module-event-log", "image-generation", "web-search", "environmental-context", "projects", "contacts", "session-summary", "sip"]);

export const ModulesPage = memo(function ModulesPage({ expandedModuleId, moduleConfigById, moduleManifestColumns, moduleManifests, onUpdateModule, renderModuleSettingsPanel, setExpandedModuleId }: ModulesPageProps) {
  return <section className="page overlay modules-page">
      {moduleManifests.length === 0 ? <p className="empty-state">No modules registered.</p> : null}
      {moduleManifestColumns.map((column, columnIndex) => <div className="module-column" key={columnIndex}>
        {column.map((manifest) => {
          const config = moduleConfigById.get(manifest.id);
          const isExpanded = expandedModuleId === manifest.id;
          const shouldRenderSettings = isExpanded;
          const settings = config?.settings ?? manifest.defaultSettings;
          const hasSettingsPanel = customSettingsPanelIds.has(manifest.id) || Object.keys(settings).length > 0;

          if (!shouldRenderSettings) {
            return <ModuleCard config={config} hasSettingsPanel={false} isExpanded={false} key={manifest.id} manifest={manifest} onUpdateModule={onUpdateModule} settingsMounted={false} setExpandedModuleId={setExpandedModuleId} />;
          }

          return <ModuleCard config={config} hasSettingsPanel={hasSettingsPanel} isExpanded={isExpanded} key={manifest.id} manifest={manifest} onUpdateModule={onUpdateModule} settingsMounted={true} setExpandedModuleId={setExpandedModuleId}>
            {renderModuleSettingsPanel(manifest, settings)}
          </ModuleCard>;
        })}
      </div>)}
  </section>;
});
