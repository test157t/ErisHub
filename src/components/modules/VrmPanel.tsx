import { memo, useEffect, useState } from "react";
import type { PromptProfile } from "../../../shared/types";
import { EmbodyVrmPanel, type VrmAssets } from "./EmbodyVrmPanel";
import type { ModuleSettingChange, ModuleSettings } from "./types";

type VrmPanelProps = {
  onError: (message: string) => void;
  onSettingChange: ModuleSettingChange;
  promptProfiles: PromptProfile[];
  settings: ModuleSettings;
};

export const VrmPanel = memo(function VrmPanel({ onError, onSettingChange, promptProfiles, settings }: VrmPanelProps) {
  const [vrmAssets, setVrmAssets] = useState<VrmAssets>({ models: [], animations: [] });

  const refreshVrmAssets = async () => {
    try {
      const response = await fetch("/api/modules/assets/inventory?refresh=true");
      const data = await response.json().catch(() => ({}));
      const vrm = data?.inventory?.modules?.vrm || {};
      const models = Array.isArray(vrm.models) ? vrm.models.map((asset: { name?: string; url?: string }) => ({ name: String(asset.name || asset.url || ""), url: String(asset.url || "") })).filter((asset: { url: string }) => asset.url) : [];
      const animations = Array.isArray(vrm.animations) ? vrm.animations.map((asset: { name?: string; url?: string }) => ({ name: String(asset.name || asset.url || ""), url: String(asset.url || "") })).filter((asset: { url: string }) => asset.url) : [];
      setVrmAssets({ models, animations });
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not refresh VRM assets.");
    }
  };

  useEffect(() => {
    refreshVrmAssets().catch(() => undefined);
  }, []);

  return <EmbodyVrmPanel onError={onError} onSettingChange={onSettingChange} promptProfiles={promptProfiles} refreshVrmAssets={refreshVrmAssets} settings={settings} vrmAssets={vrmAssets} />;
});
