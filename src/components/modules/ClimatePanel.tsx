import { memo } from "react";
import { ModuleInfoPanel } from "./ModuleInfoPanel";
import { FieldGrid, ToggleSetting } from "./SettingControls";
import type { ModuleSettingChange, ModuleSettings } from "./types";

type ClimatePanelProps = {
  onSettingChange: ModuleSettingChange;
  settings: ModuleSettings;
};

export const ClimatePanel = memo(function ClimatePanel({ onSettingChange, settings }: ClimatePanelProps) {
  return <ModuleInfoPanel className="climate-panel" description="Adds local time/date and optional weather metadata to assistant replies." title="Environmental Context">
    <ToggleSetting checked={settings.prefixEnabled === true} onChange={(checked) => onSettingChange("prefixEnabled", checked)}>Prefix assistant replies</ToggleSetting>
    <ToggleSetting checked={settings.weatherContextEnabled === true} onChange={(checked) => onSettingChange("weatherContextEnabled", checked)}>Include weather</ToggleSetting>
    <FieldGrid className="two-column climate-fields">
      <label>Weather City<input value={String(settings.weatherManualCity ?? "")} onChange={(event) => onSettingChange("weatherManualCity", event.target.value)} placeholder="e.g. Seattle" /></label>
      <label>Refresh Minutes<input min="5" max="240" step="1" value={Number(settings.weatherRefreshMinutes ?? 30)} onChange={(event) => onSettingChange("weatherRefreshMinutes", Number(event.target.value))} type="number" /></label>
    </FieldGrid>
  </ModuleInfoPanel>;
});
