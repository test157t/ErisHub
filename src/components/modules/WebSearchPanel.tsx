import { memo } from "react";
import { ModuleInfoPanel } from "./ModuleInfoPanel";
import { FieldGrid, ToggleSetting } from "./SettingControls";
import type { ModuleSettingChange, ModuleSettings } from "./types";

type WebSearchPanelProps = {
  settings: ModuleSettings;
  onSettingChange: ModuleSettingChange;
};

export const WebSearchPanel = memo(function WebSearchPanel({ settings, onSettingChange }: WebSearchPanelProps) {
  return <ModuleInfoPanel description="Server-side DuckDuckGo search. No client key, no arbitrary URL fetch." title="Secure search">
    <ToggleSetting checked={settings.autoSearchRequests !== false} onChange={(checked) => onSettingChange("autoSearchRequests", checked)}>Auto-search requested/current info</ToggleSetting>
    <ToggleSetting checked={settings.safeSearch !== false} onChange={(checked) => onSettingChange("safeSearch", checked)}>Safe search</ToggleSetting>
    <FieldGrid>
      <label>Max Results<input min="1" max="10" step="1" value={Number(settings.maxResults ?? 6)} onChange={(event) => onSettingChange("maxResults", Number(event.target.value))} type="number" /></label>
      <label>Max Image Results<input min="1" max="12" step="1" value={Number(settings.maxImageResults ?? 8)} onChange={(event) => onSettingChange("maxImageResults", Number(event.target.value))} type="number" /></label>
      <label>Max Video Results<input min="1" max="12" step="1" value={Number(settings.maxVideoResults ?? 8)} onChange={(event) => onSettingChange("maxVideoResults", Number(event.target.value))} type="number" /></label>
      <label>Region<input value={String(settings.region ?? "us-en")} onChange={(event) => onSettingChange("region", event.target.value)} placeholder="us-en" /></label>
    </FieldGrid>
  </ModuleInfoPanel>;
});
