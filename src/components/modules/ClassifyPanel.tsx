import { memo } from "react";
import { ModuleInfoPanel } from "./ModuleInfoPanel";
import { ModuleSettingField } from "./ModuleSettingField";
import type { BackgroundAsset, ModuleManifest, ModuleSettingChange, ModuleSettings } from "./types";

type ClassifyPanelProps = {
  backgroundAssets: BackgroundAsset[];
  labels: string[];
  manifest: ModuleManifest;
  settings: ModuleSettings;
  onSettingChange: ModuleSettingChange;
};

export const ClassifyPanel = memo(function ClassifyPanel({ backgroundAssets, labels, manifest, settings, onSettingChange }: ClassifyPanelProps) {
  return <>
    <ModuleInfoPanel description={["Classify emits sentiment labels and confidence.", `Labels: ${labels.join(", ")}`]} title="Sentiment detector" />
    <ModuleSettingField manifest={manifest} name="minConfidence" onSettingChange={onSettingChange} value={Number(settings.minConfidence ?? 0)} />
  </>;
});
