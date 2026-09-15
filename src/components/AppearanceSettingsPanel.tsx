import { memo, useMemo, useState } from "react";
import type { ProviderConfig } from "../../shared/types";
import type { BackgroundAsset, ModuleSettings } from "./modules/types";
import { ThemeSettingsPanel } from "./ThemeSettingsPanel";

type AppearanceSettingsPanelProps = {
  backgroundAssets: BackgroundAsset[];
  onAutoPick: () => void;
  onError: (message: string) => void;
  onSettingChange: (key: string, value: unknown) => void;
  provider: ProviderConfig;
  settings: ModuleSettings & {
    backgroundUrl: string;
    blurBackground: boolean;
    dimStrength: number;
  };
};

export const AppearanceSettingsPanel = memo(function AppearanceSettingsPanel({
  backgroundAssets,
  onAutoPick,
  onError,
  onSettingChange,
  provider,
  settings
}: AppearanceSettingsPanelProps) {
  const [chooserOpen, setChooserOpen] = useState(false);
  const [assetType, setAssetType] = useState<"all" | BackgroundAsset["type"]>("all");
  const selectedAsset = backgroundAssets.find((asset) => asset.url === settings.backgroundUrl);
  const visibleAssets = useMemo(
    () => assetType === "all" ? backgroundAssets : backgroundAssets.filter((asset) => asset.type === assetType),
    [assetType, backgroundAssets]
  );

  return <div className="appearance-settings-panel">
    <section className="appearance-focus-section" aria-labelledby="background-settings-heading">
      <div className="appearance-settings-heading">
        <div>
          <h3 id="background-settings-heading">Background</h3>
          <p>Shared by chat and the code editor.</p>
        </div>
        <button type="button" onClick={onAutoPick}>Auto-pick</button>
      </div>
      <div className="background-current">
        <span className="background-current-preview">
          {selectedAsset?.type === "video"
            ? <video aria-label={selectedAsset.name} muted src={selectedAsset.previewUrl || selectedAsset.url} />
            : selectedAsset
              ? <img alt="" src={selectedAsset.previewUrl || selectedAsset.url} />
              : <i className="fa-solid fa-ban" />}
        </span>
        <span className="background-current-copy">
          <strong>{selectedAsset?.name || "No background"}</strong>
          <small>{selectedAsset ? `${selectedAsset.type === "video" ? "Video" : "Image"} background` : "Use the theme surface without an image or video."}</small>
        </span>
        <button type="button" onClick={() => setChooserOpen(true)}>Choose</button>
      </div>
      <div className="background-adjustments">
        <label>
          <span><strong>Dim</strong><small>{settings.dimStrength}%</small></span>
          <input aria-label="Background dimming" min="0" max="100" type="range" value={settings.dimStrength} onChange={(event) => onSettingChange("dimStrength", Number(event.target.value))} />
        </label>
        <label className="settings-option-row">
          <input checked={settings.blurBackground} type="checkbox" onChange={(event) => onSettingChange("blurBackground", event.target.checked)} />
          <span><strong>Blur background</strong><small>Soften the same background in chat and the editor.</small></span>
        </label>
      </div>
    </section>

    <section className="appearance-focus-section" aria-labelledby="theme-settings-heading">
      <div className="appearance-settings-heading">
        <div>
          <h3 id="theme-settings-heading">Themes</h3>
          <p>Browse themes here; open one only when you want to edit it.</p>
        </div>
      </div>
      <ThemeSettingsPanel onError={onError} onSettingChange={onSettingChange} provider={provider} settings={settings} />
    </section>

    {chooserOpen ? <div className="settings-modal" role="dialog" aria-modal="true" aria-label="Choose background">
      <div className="settings-modal-card background-chooser">
        <div className="modal-header">
          <div><strong>Choose a background</strong><small>Applied to chat and the code editor.</small></div>
          <button aria-label="Close background chooser" type="button" onClick={() => setChooserOpen(false)}>×</button>
        </div>
        <div className="background-filter" role="group" aria-label="Background type">
          {(["all", "image", "video"] as const).map((type) => <button className={assetType === type ? "active" : ""} key={type} type="button" onClick={() => setAssetType(type)}>{type === "all" ? "All" : type === "image" ? "Images" : "Videos"}</button>)}
        </div>
        <div className="background-grid">
          <button className={!settings.backgroundUrl ? "selected" : ""} type="button" onClick={() => { onSettingChange("backgroundUrl", ""); setChooserOpen(false); }}>
            <span className="background-tile-empty"><i className="fa-solid fa-ban" /></span><strong>None</strong>
          </button>
          {visibleAssets.map((asset) => <button className={settings.backgroundUrl === asset.url ? "selected" : ""} key={asset.url} type="button" onClick={() => { onSettingChange("backgroundUrl", asset.url); setChooserOpen(false); }}>
            <span>{asset.type === "video" ? <video muted src={asset.previewUrl || asset.url} /> : <img alt="" loading="lazy" src={asset.previewUrl || asset.url} />}</span>
            <strong>{asset.name}</strong><small>{asset.type}</small>
          </button>)}
        </div>
      </div>
    </div> : null}
  </div>;
});
