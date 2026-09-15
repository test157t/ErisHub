import { memo } from "react";
import type { PromptProfile, ProviderConfig } from "../../../shared/types";
import { ModuleInfoPanel } from "./ModuleInfoPanel";
import { FieldGrid, ToggleSetting } from "./SettingControls";
import type { ModuleSettingChange, ModuleSettings } from "./types";

type ImageGenerationPanelProps = {
  promptProfiles: PromptProfile[];
  providerProfiles: ProviderConfig[];
  settings: ModuleSettings;
  onSettingChange: ModuleSettingChange;
};

function imageAgentPrefixes(settings: Record<string, unknown>, agentId?: string) {
  const agentPrefixes = settings.agentPrefixes && typeof settings.agentPrefixes === "object" ? settings.agentPrefixes as Record<string, unknown> : {};
  const scoped = agentId && agentPrefixes[agentId] && typeof agentPrefixes[agentId] === "object" ? agentPrefixes[agentId] as Record<string, unknown> : {};
  return { positive: String(scoped.positive ?? ""), negative: String(scoped.negative ?? "") };
}

export const ImageGenerationPanel = memo(function ImageGenerationPanel({ promptProfiles, providerProfiles, settings, onSettingChange }: ImageGenerationPanelProps) {
  const selectedProviderId = String(settings.providerId ?? "");
  const selectedProvider = providerProfiles.find((profile) => profile.id === selectedProviderId) ?? null;
  const isComfy = selectedProvider?.useComfyUi === true;
  const providerModels = selectedProvider?.models ?? [];
  const imageModel = String(settings.imageModel || "");
  const videoModel = String(settings.videoModel || "");
  return <ModuleInfoPanel className="image-generation-panel" description={["When the user asks for generated media, the model emits an image or video prompt in chat and ErisHub generates it there. Base64 media is saved locally; provider URLs are rendered directly when returned.", "Select the provider profile used for media generation here."]} title="Media Creation">
    <ToggleSetting checked={(settings.autoGenerateImages ?? settings.autoGenerate) === true} onChange={(checked) => onSettingChange("autoGenerateImages", checked)}>Auto-generate image prompts</ToggleSetting>
    <ToggleSetting checked={settings.autoGenerateVideos === true} onChange={(checked) => onSettingChange("autoGenerateVideos", checked)}>Auto-generate video prompts</ToggleSetting>
    <FieldGrid columns="four">
      <label>Provider<select value={selectedProviderId} onChange={(event) => onSettingChange("providerId", event.target.value)}><option value="" disabled>Select provider</option>{providerProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name || profile.model}</option>)}</select></label>
      <label>Image Model<select disabled={!providerModels.length} value={imageModel} onChange={(event) => onSettingChange("imageModel", event.target.value)}><option value="">Provider active model</option>{providerModels.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
      <label>Video Model<select disabled={!providerModels.length} value={videoModel} onChange={(event) => onSettingChange("videoModel", event.target.value)}><option value="">Provider active model</option>{providerModels.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
      <label>Image Size<select value={String(settings.size ?? "provider-default")} onChange={(event) => onSettingChange("size", event.target.value)}><option value="provider-default">Provider default</option><optgroup label="Square"><option value="512x512">512 x 512</option><option value="768x768">768 x 768</option><option value="1024x1024">1024 x 1024</option><option value="1536x1536">1536 x 1536</option></optgroup><optgroup label="Portrait"><option value="512x768">512 x 768</option><option value="768x1024">768 x 1024</option><option value="832x1216">832 x 1216</option><option value="896x1152">896 x 1152</option><option value="1024x1536">1024 x 1536</option></optgroup><optgroup label="Landscape"><option value="768x512">768 x 512</option><option value="1024x768">1024 x 768</option><option value="1152x896">1152 x 896</option><option value="1216x832">1216 x 832</option><option value="1536x1024">1536 x 1024</option></optgroup></select></label>
      <label>Video Size<select value={String(settings.videoSize ?? "provider-default")} onChange={(event) => onSettingChange("videoSize", event.target.value)}><option value="provider-default">Provider default</option><optgroup label="Portrait"><option value="720x1280">720 x 1280</option><option value="1024x1792">1024 x 1792</option></optgroup><optgroup label="Landscape"><option value="1280x720">1280 x 720</option><option value="1792x1024">1792 x 1024</option></optgroup></select></label>
      <label>Video Seconds<input min="1" max="30" step="1" type="number" value={Number(settings.videoSeconds ?? 5)} onChange={(event) => onSettingChange("videoSeconds", Number(event.target.value))} /></label>
    </FieldGrid>
    {isComfy && <>
      <h4>ComfyUI Workflows</h4>
      <div className="field-grid two-column">
        <label>Image Workflow JSON<textarea rows={8} value={String(settings.comfyuiImageWorkflow ?? "")} onChange={(event) => onSettingChange("comfyuiImageWorkflow", event.target.value)} placeholder={"Paste ComfyUI API-format workflow JSON here.\nUse {{PROMPT}} where the prompt text should be injected.\nOptionally {{NEGATIVE_PROMPT}}, {{WIDTH}}, {{HEIGHT}}."} /></label>
        <label>Video Workflow JSON (text-to-video)<textarea rows={8} value={String(settings.comfyuiVideoWorkflow ?? "")} onChange={(event) => onSettingChange("comfyuiVideoWorkflow", event.target.value)} placeholder={"Paste ComfyUI API-format workflow JSON here.\nUse {{PROMPT}} where the prompt text should be injected.\nOptionally {{NEGATIVE_PROMPT}}, {{WIDTH}}, {{HEIGHT}}."} /></label>
        <label>Image-to-Video Workflow JSON<textarea rows={8} value={String(settings.comfyuiImageToVideoWorkflow ?? "")} onChange={(event) => onSettingChange("comfyuiImageToVideoWorkflow", event.target.value)} placeholder={"Paste ComfyUI API-format workflow JSON here.\nUse {{VIDEO_PROMPT}} / {{NEGATIVE_VIDEO_PROMPT}} for text.\nUse {{SOURCE_IMAGE}} for the source image filename.\nOptionally {{WIDTH}}, {{HEIGHT}}."} /></label>
        <label>ComfyUI Directory<input value={String(settings.comfyuiOutputDir ?? "")} onChange={(event) => onSettingChange("comfyuiOutputDir", event.target.value)} placeholder={"e.g. D:/ComfyUI or /home/user/ComfyUI"} /></label>
      </div>
    </>}
    <div className="image-agent-prefix-grid">
      {promptProfiles.map((profile) => {
        const prefixes = imageAgentPrefixes(settings, profile.id);
        const allPrefixes = settings.agentPrefixes && typeof settings.agentPrefixes === "object" ? settings.agentPrefixes as Record<string, unknown> : {};
        const updatePrefix = (key: "positive" | "negative", value: string) => onSettingChange("agentPrefixes", { ...allPrefixes, [profile.id]: { ...prefixes, [key]: value } });
        return <details className="image-agent-prefix-card" key={profile.id}>
          <summary><strong>{profile.assistantName || profile.name}</strong><span>Positive / negative prefixes</span></summary>
          <div className="image-agent-prefix-fields">
            <label>Positive Prefix<textarea value={String(prefixes.positive ?? "")} onChange={(event) => updatePrefix("positive", event.target.value)} rows={2} placeholder="e.g. masterpiece, detailed, character traits" /></label>
            <label>Negative Prefix<textarea value={String(prefixes.negative ?? "")} onChange={(event) => updatePrefix("negative", event.target.value)} rows={2} placeholder="e.g. blurry, extra fingers, low quality" /></label>
          </div>
        </details>;
      })}
    </div>
  </ModuleInfoPanel>;
});
