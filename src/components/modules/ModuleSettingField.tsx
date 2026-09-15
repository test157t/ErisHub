import { memo } from "react";
import { ToggleSetting } from "./SettingControls";
import type { ModuleManifest, ModuleSettingChange } from "./types";

type ModuleSettingFieldProps = {
  manifest: ModuleManifest;
  name: string;
  value: unknown;
  onSettingChange: ModuleSettingChange;
};

export const ModuleSettingField = memo(function ModuleSettingField({ manifest, name, value, onSettingChange }: ModuleSettingFieldProps) {
  const settingLabels: Record<string, string> = {
    allowAutomation: "Allow automation actions",
    allowExternalNetwork: "Allow external network actions",
    allowFileAccess: "Allow file access actions",
    requireConfirmationForSideEffects: "Require confirmation for side effects"
  };
  const settingLabel = settingLabels[name] || name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ").replace(/^./, (char) => char.toUpperCase());
  if (manifest.id === "classify" && name === "minConfidence") {
    const confidenceValue = Math.max(0, Math.min(100, Math.round(Number(value ?? 0) * 100)));
    return <label className="module-field range-field"><span>Minimum Confidence <strong>{confidenceValue}%</strong></span><input min="0" max="100" step="1" type="range" value={confidenceValue} onChange={(event) => onSettingChange(name, Number(event.target.value) / 100)} /></label>;
  }
  if (typeof value === "boolean") return <ToggleSetting checked={value} onChange={(checked) => onSettingChange(name, checked)}>{settingLabel}</ToggleSetting>;
  if (typeof value === "number") return <label>{settingLabel}<input value={value} onChange={(event) => onSettingChange(name, Number(event.target.value))} type="number" /></label>;
  return <label>{settingLabel}<textarea value={String(value ?? "")} onChange={(event) => onSettingChange(name, event.target.value)} rows={4} /></label>;
});
