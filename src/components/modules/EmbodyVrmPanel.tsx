import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { PromptProfile } from "../../../shared/types";
import type { ModuleSettingChange, ModuleSettings } from "./types";

export type VrmAsset = { name: string; url: string };
export type VrmAssets = { models: VrmAsset[]; animations: VrmAsset[] };

const classifyExpressions = ["admiration", "amusement", "anger", "annoyance", "approval", "caring", "confusion", "curiosity", "desire", "disappointment", "disapproval", "disgust", "embarrassment", "excitement", "fear", "gratitude", "grief", "joy", "love", "nervousness", "optimism", "pride", "realization", "relief", "remorse", "sadness", "surprise", "neutral"];
const hitboxNames = ["head", "chest", "groin", "butt", "leftHand", "rightHand", "leftLeg", "rightLeg", "rightFoot", "leftFoot"];
const defaultExpressionMapping: Record<string, string> = { default: "neutral", admiration: "relaxed", amusement: "relaxed", anger: "angry", annoyance: "angry", approval: "relaxed", caring: "relaxed", confusion: "surprised", curiosity: "surprised", desire: "relaxed", disappointment: "angry", disapproval: "angry", disgust: "angry", embarrassment: "surprised", excitement: "surprised", fear: "sad", gratitude: "relaxed", grief: "sad", joy: "relaxed", love: "relaxed", nervousness: "sad", optimism: "relaxed", pride: "relaxed", realization: "surprised", relief: "relaxed", remorse: "sad", sadness: "sad", surprise: "surprised", neutral: "neutral", head: "relaxed", chest: "angry", groin: "angry", butt: "angry", leftHand: "relaxed", rightHand: "relaxed", leftLeg: "surprised", rightLeg: "surprised", rightFoot: "surprised", leftFoot: "surprised" };
const defaultMotionMapping: Record<string, string> = { default: "/assets/vrm/animations/neutral.bvh", admiration: "/assets/vrm/animations/admiration.bvh", amusement: "/assets/vrm/animations/amusement.bvh", anger: "/assets/vrm/animations/anger.bvh", annoyance: "/assets/vrm/animations/annoyance.bvh", approval: "/assets/vrm/animations/approval.bvh", caring: "/assets/vrm/animations/neutral.bvh", confusion: "/assets/vrm/animations/confusion.bvh", curiosity: "/assets/vrm/animations/curiosity.bvh", desire: "/assets/vrm/animations/desire.bvh", disappointment: "/assets/vrm/animations/disappointment.bvh", disapproval: "/assets/vrm/animations/disapproval.bvh", disgust: "/assets/vrm/animations/disgust.bvh", embarrassment: "/assets/vrm/animations/embarrassment.bvh", excitement: "/assets/vrm/animations/excitement.bvh", fear: "/assets/vrm/animations/fear.bvh", gratitude: "/assets/vrm/animations/gratitude.bvh", grief: "/assets/vrm/animations/grief.bvh", joy: "/assets/vrm/animations/joy.bvh", love: "/assets/vrm/animations/love.bvh", nervousness: "/assets/vrm/animations/nervousness.bvh", neutral: "/assets/vrm/animations/neutral.bvh", optimism: "/assets/vrm/animations/optimism.bvh", pride: "/assets/vrm/animations/pride.bvh", realization: "/assets/vrm/animations/realization.bvh", relief: "/assets/vrm/animations/relief.bvh", remorse: "/assets/vrm/animations/remorse.bvh", sadness: "/assets/vrm/animations/sadness.bvh", surprise: "/assets/vrm/animations/surprise.bvh", head: "/assets/vrm/animations/hitarea_head.bvh", chest: "/assets/vrm/animations/hitarea_chest.bvh", groin: "/assets/vrm/animations/hitarea_groin.bvh", butt: "/assets/vrm/animations/hitarea_butt.bvh", leftHand: "/assets/vrm/animations/hitarea_hands.bvh", rightHand: "/assets/vrm/animations/hitarea_hands.bvh", leftLeg: "/assets/vrm/animations/hitarea_leg.bvh", rightLeg: "/assets/vrm/animations/hitarea_leg.bvh", rightFoot: "/assets/vrm/animations/hitarea_foot.bvh", leftFoot: "/assets/vrm/animations/hitarea_foot.bvh" };

type EmbodyVrmPanelProps = {
  onError: (message: string) => void;
  onSettingChange: ModuleSettingChange;
  promptProfiles: PromptProfile[];
  refreshVrmAssets: () => Promise<void>;
  settings: ModuleSettings;
  vrmAssets: VrmAssets;
};

type SectionProps = { children: ReactNode; defaultOpen?: boolean; id: string; title: string };
type VrmExpressionData = { defaults: Record<string, Record<string, number>>; names: string[] };

function boolSetting(settings: ModuleSettings, key: string, fallback = false) {
  return settings[key] === undefined ? fallback : settings[key] === true;
}

function numberSetting(settings: ModuleSettings, key: string, fallback: number) {
  const value = Number(settings[key] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

function stringSetting(settings: ModuleSettings, key: string, fallback = "") {
  return String(settings[key] ?? fallback);
}

function objectSetting(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function assetLabel(value: string, assets: VrmAsset[]) {
  return assets.find((asset) => asset.url === value)?.name || value.split("/").pop()?.replace(/\.(vrm|fbx)$/i, "") || "";
}

function agentImportKey(key: string, promptProfiles: PromptProfile[]) {
  const normalized = key.trim().toLowerCase();
  if (!normalized || normalized === "none") return key;
  return promptProfiles.find((profile) => [profile.id, profile.name, profile.assistantName].filter(Boolean).some((value) => String(value).trim().toLowerCase() === normalized))?.id || key;
}

function normalizeModelPath(value: unknown, vrmAssets: VrmAssets) {
  const raw = String(value || "").trim();
  if (!raw || raw === "none") return "";
  if (vrmAssets.models.some((asset) => asset.url === raw)) return raw;
  const normalized = raw.toLowerCase().replace(/\\/g, "/").replace(/^\/+/, "");
  const noExt = normalized.replace(/\.(vrm|fbx)$/i, "");
  const leaf = noExt.split("/").pop() || noExt;
  return vrmAssets.models.find((asset) => {
    const assetPath = `${asset.url} ${asset.name}`.toLowerCase().replace(/\\/g, "/");
    const assetNoExt = assetPath.replace(/\.(vrm|fbx)/g, "");
    return assetPath.includes(normalized) || assetNoExt.includes(noExt) || assetNoExt.split(/[\s/]+/).includes(leaf);
  })?.url || raw;
}

function settingsForModel(settings: ModuleSettings, model: string) {
  const all = objectSetting(settings.vrmModelSettings);
  return objectSetting(all[model]);
}

function modelSettingsForUi(settings: ModuleSettings, model: string) {
  return settingsForModel(settings, model);
}

function defaultAnimationMapping(name: string) {
  return { expression: defaultExpressionMapping[name] || defaultExpressionMapping.default, motion: defaultMotionMapping[name] || defaultMotionMapping.default, sequence: "" };
}

function defaultMappingGroup(type: "hitbox" | "classify") {
  const names = type === "hitbox" ? hitboxNames : classifyExpressions;
  return Object.fromEntries(names.map((name) => [name, defaultAnimationMapping(name)]));
}

function uniqueOptions(values: string[]) {
  return values.filter((value, index) => value && values.indexOf(value) === index);
}

function sortedUniqueOptions(values: string[]) {
  const seen = new Set<string>();
  const options: string[] = [];
  for (const value of values) {
    const option = value.trim();
    const key = option.toLowerCase();
    if (!option || seen.has(key)) continue;
    seen.add(key);
    options.push(option);
  }
  return options.sort((a, b) => a.localeCompare(b));
}

function clampUnit(value: string | number, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function extractVrmImport(value: Record<string, unknown>) {
  const vrm = objectSetting(value.vrm || value.VRM);
  const source = Object.keys(vrm).length ? vrm : value;
  return {
    characterModelMapping: objectSetting(source.character_model_mapping || source.vrmModelMap),
    modelSettings: objectSetting(source.model_settings || source.vrmModelSettings)
  };
}

function VrmSection({ children, defaultOpen = false, id, title }: SectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return <details className="voiceforge-section native-voiceforge-section vrm-section" open={isOpen} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
    <summary className="voiceforge-section-header" id={`${id}_header`}><span>{title}</span><i className="fa-solid fa-chevron-down" /></summary>
    <div className="voiceforge-section-content" id={`${id}_content`}>{children}</div>
  </details>;
}

function VrmCollapsible({ children, defaultOpen = false, id, title }: SectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return <details className="voice-section-collapsible vrm-section-collapsible" open={isOpen} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
    <summary className="section-header vrm-section-header" data-vrm-section={id} tabIndex={0}><span>{title}</span><i className="fa-solid fa-chevron-down vrm-section-toggle-icon" /></summary>
    <div className="section-content post-sliders vrm-section-content" data-vrm-section-content={id}>{children}</div>
  </details>;
}

function VrmModelSliders({ modelSettings, updateModelNumber }: { modelSettings: Record<string, unknown>; updateModelNumber: (key: string, value: string, min: number, max: number, fallback: number) => void }) {
  const sliders = [
    ["scale", "vrm_model_scale", "Model scale", "x", 0.2, 30, 0.2, 2, "Scale of the vrm model."],
    ["x", "vrm_model_position_x", "Model center X offset", "", -10, 10, 0.1, 0, "Set the model x coordinate (Same as mouse left click/drag)."],
    ["y", "vrm_model_position_y", "Model center Y offset", "", -10, 10, 0.1, 0, "Set the model y coordinate (Same as mouse left click/drag)."],
    ["rx", "vrm_model_rotation_x", "Model X rotation", "", -10, 10, 0.1, 0, "Set the model x rotation (Same as middle mouse/drag)."],
    ["ry", "vrm_model_rotation_y", "Model Y rotation", "", -10, 10, 0.1, 0, "Set the model y rotation (Same as middle mouse/drag)."]
  ] as const;
  return <>{sliders.map(([key, id, label, suffix, min, max, step, fallback, help]) => {
    const value = Number(modelSettings[key] ?? fallback);
    const safeValue = Number.isFinite(value) ? value : fallback;
    return <div className="vrm-parameter" key={key}><div className="vrm-parameter-title"><label htmlFor={id}>{label} (<span id={`${id}_value`}>{safeValue}</span>{suffix})</label></div><div className="vrm-slider-div"><input id={id} min={min} max={max} step={step} type="range" value={safeValue} onChange={(event) => updateModelNumber(key, event.target.value, min, max, fallback)} /><small>{help}</small></div></div>;
  })}</>;
}

function MappingRows({ model, settings, type, updateModelSetting, vrmAssets }: { model: string; settings: ModuleSettings; type: "hitbox" | "classify"; updateModelSetting: (model: string, key: string, value: unknown) => void; vrmAssets: VrmAssets }) {
  const modelSettings = modelSettingsForUi(settings, model);
  const groupKey = type === "hitbox" ? "hitboxes_mapping" : "classify_mapping";
  const names = type === "hitbox" ? hitboxNames : classifyExpressions;
  const group = objectSetting(modelSettings[groupKey]);
  const expressionOptions = uniqueOptions(["none", "neutral", "relaxed", "happy", "angry", "sad", "surprised", ...Object.values(defaultExpressionMapping)]);
  const motionOptions = uniqueOptions(["none", ...vrmAssets.animations.map((asset) => asset.url), ...Object.values(defaultMotionMapping)]);
  const updateRow = (name: string, key: string, value: unknown) => {
    updateModelSetting(model, groupKey, { ...group, [name]: { ...objectSetting(group[name]), [key]: value } });
  };
  return <><div className="voiceforge-map-tools"><button className="menu_button" type="button" onClick={() => updateModelSetting(model, groupKey, defaultMappingGroup(type))}>Reset to defaults</button></div><div className="vrm-mapping-grid">{names.map((name) => {
    const row: Record<string, unknown> = objectSetting(group[name]);
    const expression = String(row.expression || "");
    const motion = String(row.motion || "");
    const expressions = uniqueOptions([expression, ...expressionOptions]);
    const motions = uniqueOptions([motion, ...motionOptions]);
    return <div className="vrm-mapping-row" key={name}><strong>{name}</strong><label>Expression<select className="text_pole" value={expression} onChange={(event) => updateRow(name, "expression", event.target.value)}><option value="">-- Expression --</option>{expressions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label><label>Motion<select className="text_pole" value={motion} onChange={(event) => updateRow(name, "motion", event.target.value)}><option value="">-- Motion --</option>{motions.map((option) => <option key={option} value={option}>{vrmAssets.animations.find((asset) => asset.url === option)?.name || option}</option>)}</select></label></div>;
  })}</div></>;
}

function BlendShapeMappingRows({ expressionData, model, onSettingChange, settings, updateModelSetting }: { expressionData: VrmExpressionData; model: string; onSettingChange: ModuleSettingChange; settings: ModuleSettings; updateModelSetting: (model: string, key: string, value: unknown) => void }) {
  const modelSettings = modelSettingsForUi(settings, model);
  const mapping = objectSetting(modelSettings.blend_shape_mapping);
  const availableBlendShapes = sortedUniqueOptions(expressionData.names);
  const groupNames = sortedUniqueOptions([...availableBlendShapes, ...Object.keys(mapping)]);
  const newGroupName = stringSetting(settings, "vrmBlendShapeGroupName").trim();
  const updateMapping = (next: Record<string, unknown>) => updateModelSetting(model, "blend_shape_mapping", next);
  const groupWithDefaults = (name: string) => {
    const group = objectSetting(mapping[name]);
    const modelDefaults = objectSetting(expressionData.defaults[name]);
    const usableModelDefaults = Object.fromEntries(Object.entries(modelDefaults).filter(([blendShapeName]) => availableBlendShapes.includes(blendShapeName)));
    const builtInDefault = Object.keys(usableModelDefaults).length ? usableModelDefaults : availableBlendShapes.includes(name) ? { [name]: 1 } : {};
    return { ...group, blendShapes: { ...builtInDefault, ...objectSetting(group.blendShapes) }, intensity: clampUnit(String(group.intensity ?? 1), 1) };
  };
  const addGroup = () => {
    if (!newGroupName) return;
    updateMapping({ ...mapping, [newGroupName]: { blendShapes: {}, intensity: 1 } });
    onSettingChange("vrmBlendShapeGroupName", "");
  };
  const updateWeight = (groupName: string, blendShapeName: string, value: string) => {
    const group = groupWithDefaults(groupName);
    updateMapping({ ...mapping, [groupName]: { ...group, blendShapes: { ...objectSetting(group.blendShapes), [blendShapeName]: clampUnit(value) } } });
  };
  const updateIntensity = (groupName: string, value: string) => {
    const group = groupWithDefaults(groupName);
    updateMapping({ ...mapping, [groupName]: { ...group, intensity: clampUnit(value, 1) } });
  };
  const removeGroup = (groupName: string) => {
    const next = { ...mapping };
    delete next[groupName];
    updateMapping(next);
  };

  return <div id="vrm_blend_shape_mapping"><div className="vrm-parameter"><div className="vrm-parameter-title"><label htmlFor="vrm_blend_shape_group_name">New Blend Shape Group:</label></div><div className="vrm-blend-shape-add"><input className="text_pole" id="vrm_blend_shape_group_name" placeholder="e.g., smirk, blush, etc." type="text" value={stringSetting(settings, "vrmBlendShapeGroupName")} onChange={(event) => onSettingChange("vrmBlendShapeGroupName", event.target.value)} /><button className="menu_button" id="vrm_blend_shape_add" type="button" onClick={addGroup}><i className="fa-solid fa-plus" /> Add</button></div></div>{availableBlendShapes.length === 0 ? <div className="empty-state">Load this VRM in the preview to populate model blend shapes.</div> : null}<div id="vrm_blend_shape_groups" className="vrm-blend-shape-groups">{groupNames.length === 0 ? <div className="empty-state">Blend shape groups will be populated here.</div> : groupNames.map((groupName) => {
    const group = groupWithDefaults(groupName);
    const blendShapes = objectSetting(group.blendShapes);
    const isModelExpression = availableBlendShapes.includes(groupName);
    const hasOverride = Object.prototype.hasOwnProperty.call(mapping, groupName);
    return <details className="vrm-blend-shape-group" key={groupName}><summary className="vrm-blend-shape-title"><strong>{groupName}</strong>{isModelExpression ? <span>model built-in</span> : null}{hasOverride ? <button className="menu_button" type="button" onClick={(event) => { event.preventDefault(); removeGroup(groupName); }}>{isModelExpression ? "Clear" : <i className="fa-solid fa-trash" />}</button> : null}<i className="fa-solid fa-chevron-down" /></summary><div className="vrm-blend-shape-weights">{availableBlendShapes.map((blendShapeName) => {
      const weight = clampUnit(String(blendShapes[blendShapeName] ?? 0));
      return <label className="vrm-blend-shape-weight" key={blendShapeName}><span>{blendShapeName}</span><input min={0} max={1} step={0.1} type="range" value={weight} onChange={(event) => updateWeight(groupName, blendShapeName, event.target.value)} /><strong>{weight.toFixed(1)}</strong></label>;
    })}</div><label className="vrm-blend-shape-intensity"><span>Intensity</span><input min={0} max={1} step={0.1} type="range" value={group.intensity} onChange={(event) => updateIntensity(groupName, event.target.value)} /><strong>{group.intensity.toFixed(1)}</strong></label></details>;
  })}</div></div>;
}

export function EmbodyVrmPanel({ onError, onSettingChange, promptProfiles, refreshVrmAssets, settings, vrmAssets }: EmbodyVrmPanelProps) {
  const [modelExpressions, setModelExpressions] = useState<Record<string, VrmExpressionData>>(() => {
    const cache = (window as typeof window & { __nitralVrmModelExpressions?: Record<string, VrmExpressionData> }).__nitralVrmModelExpressions || {};
    return Object.fromEntries(Object.entries(cache).map(([modelUrl, data]) => [modelUrl, { names: sortedUniqueOptions(data.names.map(String)), defaults: data.defaults || {} }]));
  });
  const vrmModelMap = objectSetting(settings.vrmModelMap);
  const selectedAgentId = stringSetting(settings, "vrmSelectedAgentId", promptProfiles[0]?.id || "");
  const selectedAgent = promptProfiles.find((profile) => profile.id === selectedAgentId) || promptProfiles[0];
  const selectedAgentEntry = objectSetting(selectedAgent ? vrmModelMap[selectedAgent.id] : undefined);
  const selectedModel = String(selectedAgentEntry.model || "");
  const selectedModelSettings: Record<string, unknown> = selectedModel ? modelSettingsForUi(settings, selectedModel) : {};
  const selectedDefaultAnimation = objectSetting(selectedModelSettings.animation_default);
  const selectedExpression = String(selectedDefaultAnimation.expression || stringSetting(settings, "vrmDefaultExpression"));
  const selectedMotion = String(selectedDefaultAnimation.motion || stringSetting(settings, "vrmDefaultMotion"));
  const modelsByUrl = useMemo(() => new Set(vrmAssets.models.map((asset) => asset.url)), [vrmAssets.models]);

  useEffect(() => {
    function onModelExpressions(event: Event) {
      const detail = (event as CustomEvent<{ expressionDefaults?: unknown; expressions?: unknown; modelUrl?: string }>).detail || {};
      const modelUrl = String(detail.modelUrl || "");
      const expressions = detail.expressions;
      if (!modelUrl || !Array.isArray(expressions)) return;
      setModelExpressions((current) => ({ ...current, [modelUrl]: { names: sortedUniqueOptions(expressions.map(String)), defaults: objectSetting(detail.expressionDefaults) as Record<string, Record<string, number>> } }));
    }

    window.addEventListener("nitral-vrm-model-expressions", onModelExpressions);
    return () => window.removeEventListener("nitral-vrm-model-expressions", onModelExpressions);
  }, []);

  useEffect(() => {
    if (vrmAssets.models.length === 0) return;
    let changed = false;
    const nextMap = { ...vrmModelMap };
    for (const [agentId, entry] of Object.entries(vrmModelMap)) {
      const current = objectSetting(entry);
      const model = String(current.model || "");
      const normalized = normalizeModelPath(model, vrmAssets);
      if (model && normalized && normalized !== model) {
        nextMap[agentId] = { ...current, model: normalized };
        changed = true;
      }
    }
    if (changed) onSettingChange("vrmModelMap", nextMap);
  }, [onSettingChange, settings, vrmAssets, vrmModelMap]);

  const updateNumber = (key: string, value: string, min: number, max: number, fallback: number) => {
    const raw = Number(value);
    onSettingChange(key, Math.max(min, Math.min(max, Number.isFinite(raw) ? raw : fallback)));
  };
  const updateAgentModel = (agentId: string, model: string) => {
    const current = objectSetting(vrmModelMap[agentId]);
    onSettingChange("vrmSelectedAgentId", agentId);
    onSettingChange("vrmModelMap", { ...vrmModelMap, [agentId]: { ...current, model } });
  };
  const updateModelSetting = (model: string, key: string, value: unknown) => {
    const all = objectSetting(settings.vrmModelSettings);
    onSettingChange("vrmModelSettings", { ...all, [model]: { ...settingsForModel(settings, model), [key]: value } });
  };
  const updateDefaultAnimation = (key: "expression" | "motion", value: string) => {
    if (key === "expression") onSettingChange("vrmDefaultExpression", value);
    if (key === "motion") onSettingChange("vrmDefaultMotion", value);
    if (!selectedModel) return;
    updateModelSetting(selectedModel, "animation_default", { ...selectedDefaultAnimation, [key]: value });
  };
  const updateJiggleAccelerometer = (enabled: boolean) => {
    if (!enabled) {
      onSettingChange("vrmChestJiggleAccelerometer", false);
      return;
    }
    const MotionEventCtor = globalThis.DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
    if (typeof MotionEventCtor?.requestPermission === "function") {
      MotionEventCtor.requestPermission().then((state) => {
        if (state === "granted") onSettingChange("vrmChestJiggleAccelerometer", true);
        else onError("Motion permission was denied.");
      }).catch((error) => onError(error instanceof Error ? error.message : "Motion permission request failed."));
      return;
    }
    onSettingChange("vrmChestJiggleAccelerometer", true);
  };
  const importVrmMap = (text: string) => {
    try {
      const parsed = JSON.parse(text || "{}");
      const imported = extractVrmImport(objectSetting(parsed));
      const nextMap = { ...vrmModelMap };
      for (const [character, modelPath] of Object.entries(imported.characterModelMapping)) {
        const agentId = agentImportKey(character, promptProfiles);
        const model = normalizeModelPath(modelPath, vrmAssets);
        if (model) nextMap[agentId] = { ...objectSetting(nextMap[agentId]), model };
      }
      const nextSettings = { ...objectSetting(settings.vrmModelSettings) };
      for (const [modelPath, modelSettings] of Object.entries(imported.modelSettings)) {
        const model = normalizeModelPath(modelPath, vrmAssets);
        if (model) nextSettings[model] = objectSetting(modelSettings);
      }
      onSettingChange("vrmModelMap", nextMap);
      onSettingChange("vrmModelSettings", nextSettings);
      const firstEntry = Object.entries(nextMap).find(([, entry]) => String(objectSetting(entry).model || ""));
      if (firstEntry) {
        onSettingChange("vrmSelectedAgentId", firstEntry[0]);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "VRM model map JSON is invalid.");
    }
  };

  return <div id="embody-vrm-panel" className="embody-tab-panel active vrm-tab-native">
    <div id="vrm_settings" className="vrm-native-panel">
      <VrmSection id="vrm_global" title="Global Settings">
        <label className="checkbox_label" htmlFor="vrm_enabled_checkbox"><input checked={boolSetting(settings, "vrmEnabled")} id="vrm_enabled_checkbox" name="vrm_enabled_checkbox" onChange={(event) => onSettingChange("vrmEnabled", event.target.checked)} type="checkbox" /><small>Enabled</small></label>
        <label className="checkbox_label" htmlFor="vrm_follow_camera_checkbox"><input checked={boolSetting(settings, "vrmFollowCamera")} id="vrm_follow_camera_checkbox" name="vrm_follow_camera_checkbox" onChange={(event) => onSettingChange("vrmFollowCamera", event.target.checked)} type="checkbox" /><small>Look at camera</small></label>
        <label className="checkbox_label" htmlFor="vrm_follow_cursor_checkbox"><input checked={boolSetting(settings, "vrmFollowCursor")} id="vrm_follow_cursor_checkbox" name="vrm_follow_cursor_checkbox" onChange={(event) => onSettingChange("vrmFollowCursor", event.target.checked)} type="checkbox" /><small>Follow cursor</small></label>
        <label className="checkbox_label" htmlFor="vrm_blink_checkbox"><input checked={boolSetting(settings, "vrmBlink")} id="vrm_blink_checkbox" name="vrm_blink_checkbox" onChange={(event) => onSettingChange("vrmBlink", event.target.checked)} type="checkbox" /><small>Blink</small></label>
        <label className="checkbox_label" htmlFor="vrm_natural_idle_checkbox"><input checked={boolSetting(settings, "vrmNaturalIdle", true)} id="vrm_natural_idle_checkbox" name="vrm_natural_idle_checkbox" onChange={(event) => onSettingChange("vrmNaturalIdle", event.target.checked)} type="checkbox" /><small>Natural idle movements</small></label>
        <label className="checkbox_label" htmlFor="vrm_tts_lips_sync_checkbox"><input checked={boolSetting(settings, "vrmTtsLipsSync")} id="vrm_tts_lips_sync_checkbox" name="vrm_tts_lips_sync_checkbox" onChange={(event) => onSettingChange("vrmTtsLipsSync", event.target.checked)} type="checkbox" /><small>TTS lips sync</small></label>
        <label className="checkbox_label" htmlFor="vrm_auto_send_hitbox_message_checkbox"><input checked={boolSetting(settings, "vrmAutoSendHitboxMessage")} id="vrm_auto_send_hitbox_message_checkbox" name="vrm_auto_send_hitbox_message_checkbox" onChange={(event) => onSettingChange("vrmAutoSendHitboxMessage", event.target.checked)} type="checkbox" /><small>Auto-send interaction</small></label>
        <div className="vrm-parameter"><div className="vrm-parameter-title"><label htmlFor="vrm_hitbox_callmode_sync_delay">Hitbox VoiceForge sync delay (<span id="vrm_hitbox_callmode_sync_delay_value">{numberSetting(settings, "vrmHitboxCallModeSyncDelayMs", 220)}</span> ms)</label></div><div className="vrm-slider-div"><input id="vrm_hitbox_callmode_sync_delay" max={1200} min={0} step={10} type="range" value={numberSetting(settings, "vrmHitboxCallModeSyncDelayMs", 220)} onChange={(event) => updateNumber("vrmHitboxCallModeSyncDelayMs", event.target.value, 0, 1200, 220)} /><small>Delays hitbox animation playback to align with VoiceForge TTS speech.</small></div></div>
        <div className="vrm-parameter"><div className="vrm-parameter-title"><label htmlFor="vrm_hitbox_callmode_wait_tts_start">Hitbox wait for VoiceForge TTS start (<span id="vrm_hitbox_callmode_wait_tts_start_value">{numberSetting(settings, "vrmHitboxCallModeWaitTtsStartMs", 4500)}</span> ms)</label></div><div className="vrm-slider-div"><input id="vrm_hitbox_callmode_wait_tts_start" max={12000} min={0} step={100} type="range" value={numberSetting(settings, "vrmHitboxCallModeWaitTtsStartMs", 4500)} onChange={(event) => updateNumber("vrmHitboxCallModeWaitTtsStartMs", event.target.value, 0, 12000, 4500)} /><small>Max time to wait for Voiceforge TTS start before playing hitbox animation anyway.</small></div></div>
        <div className="vrm-parameter"><div className="vrm-parameter-title"><label htmlFor="vrm_model_z_index">VRM model z-index</label></div><div className="vrm-slider-div"><input className="text_pole" id="vrm_model_z_index" max={9999} min={-9999} step={1} type="number" value={numberSetting(settings, "vrmModelZIndex", 4)} onChange={(event) => updateNumber("vrmModelZIndex", event.target.value, -9999, 9999, 4)} /><small>Controls the VRM canvas stacking order. Higher values render above more UI.</small></div></div>
      </VrmSection>

      <VrmSection id="vrm_jiggle" title="Jiggle Settings">
        <label className="checkbox_label" htmlFor="vrm_chest_jiggle_checkbox"><input checked={boolSetting(settings, "vrmChestJiggleEnabled")} id="vrm_chest_jiggle_checkbox" name="vrm_chest_jiggle_checkbox" onChange={(event) => onSettingChange("vrmChestJiggleEnabled", event.target.checked)} type="checkbox" /><small>Autodetect chest jiggle physics</small></label>
        <label className="checkbox_label" htmlFor="vrm_chest_jiggle_accelerometer_checkbox"><input checked={boolSetting(settings, "vrmChestJiggleAccelerometer")} id="vrm_chest_jiggle_accelerometer_checkbox" name="vrm_chest_jiggle_accelerometer_checkbox" onChange={(event) => updateJiggleAccelerometer(event.target.checked)} type="checkbox" /><small>Mobile motion affects jiggle</small></label>
        <div className="vrm-parameter"><div className="vrm-parameter-title"><label htmlFor="vrm_chest_jiggle_strength">Chest jiggle strength (<span id="vrm_chest_jiggle_strength_value">{numberSetting(settings, "vrmChestJiggleStrength", 35)}</span>%)</label></div><div className="vrm-slider-div"><input id="vrm_chest_jiggle_strength" max={500} min={0} step={5} type="range" value={numberSetting(settings, "vrmChestJiggleStrength", 35)} onChange={(event) => updateNumber("vrmChestJiggleStrength", event.target.value, 0, 500, 35)} /><small>Uses VRM bone names such as breast, bust, mune, and related JRPG-style rig names.</small></div></div>
        <div className="vrm-parameter"><div className="vrm-parameter-title"><label htmlFor="vrm_chest_jiggle_softness">Softness (<span id="vrm_chest_jiggle_softness_value">{numberSetting(settings, "vrmChestJiggleSoftness", 45)}</span>%)</label></div><div className="vrm-slider-div"><input id="vrm_chest_jiggle_softness" max={100} min={0} step={1} type="range" value={numberSetting(settings, "vrmChestJiggleSoftness", 45)} onChange={(event) => updateNumber("vrmChestJiggleSoftness", event.target.value, 0, 100, 45)} /><small>Higher values make motion looser with more delayed follow-through.</small></div></div>
        <div className="vrm-parameter"><div className="vrm-parameter-title"><label htmlFor="vrm_chest_jiggle_gravity">Gravity drop (<span id="vrm_chest_jiggle_gravity_value">{numberSetting(settings, "vrmChestJiggleGravity", 20)}</span>%)</label></div><div className="vrm-slider-div"><input id="vrm_chest_jiggle_gravity" max={100} min={0} step={1} type="range" value={numberSetting(settings, "vrmChestJiggleGravity", 20)} onChange={(event) => updateNumber("vrmChestJiggleGravity", event.target.value, 0, 100, 20)} /><small>Adds heavier downward sag to the simulated spring target.</small></div></div>
        <div className="vrm-parameter"><div className="vrm-parameter-title"><label htmlFor="vrm_chest_jiggle_vertical">Vertical bounce (<span id="vrm_chest_jiggle_vertical_value">{numberSetting(settings, "vrmChestJiggleVertical", 100)}</span>%)</label></div><div className="vrm-slider-div"><input id="vrm_chest_jiggle_vertical" max={250} min={0} step={5} type="range" value={numberSetting(settings, "vrmChestJiggleVertical", 100)} onChange={(event) => updateNumber("vrmChestJiggleVertical", event.target.value, 0, 250, 100)} /><small>Controls up/down bounce from body and device movement.</small></div></div>
        <div className="vrm-parameter"><div className="vrm-parameter-title"><label htmlFor="vrm_chest_jiggle_sway">Side sway (<span id="vrm_chest_jiggle_sway_value">{numberSetting(settings, "vrmChestJiggleSway", 100)}</span>%)</label></div><div className="vrm-slider-div"><input id="vrm_chest_jiggle_sway" max={250} min={0} step={5} type="range" value={numberSetting(settings, "vrmChestJiggleSway", 100)} onChange={(event) => updateNumber("vrmChestJiggleSway", event.target.value, 0, 250, 100)} /><small>Controls left/right response and torso turn lag.</small></div></div>
        <div className="vrm-parameter"><div className="vrm-parameter-title"><label htmlFor="vrm_chest_jiggle_depth">Depth response (<span id="vrm_chest_jiggle_depth_value">{numberSetting(settings, "vrmChestJiggleDepth", 70)}</span>%)</label></div><div className="vrm-slider-div"><input id="vrm_chest_jiggle_depth" max={250} min={0} step={5} type="range" value={numberSetting(settings, "vrmChestJiggleDepth", 70)} onChange={(event) => updateNumber("vrmChestJiggleDepth", event.target.value, 0, 250, 70)} /><small>Controls forward/back response, especially from mobile motion.</small></div></div>
      </VrmSection>

      <VrmSection id="vrm_performance" title="Performances Settings"><label className="checkbox_label" htmlFor="vrm_hitboxes_checkbox"><input checked={boolSetting(settings, "vrmHitboxes")} id="vrm_hitboxes_checkbox" name="vrm_hitboxes_checkbox" onChange={(event) => onSettingChange("vrmHitboxes", event.target.checked)} type="checkbox" /><small>Body hitboxes</small></label><label className="checkbox_label" htmlFor="vrm_models_cache_checkbox"><input checked={boolSetting(settings, "vrmModelsCache")} id="vrm_models_cache_checkbox" name="vrm_models_cache_checkbox" onChange={(event) => onSettingChange("vrmModelsCache", event.target.checked)} type="checkbox" /><small>Use model cache</small></label><label className="checkbox_label" htmlFor="vrm_animations_cache_checkbox"><input checked={boolSetting(settings, "vrmAnimationsCache")} id="vrm_animations_cache_checkbox" name="vrm_animations_cache_checkbox" onChange={(event) => onSettingChange("vrmAnimationsCache", event.target.checked)} type="checkbox" /><small>Use animation cache</small></label></VrmSection>
       <VrmSection id="vrm_debug" title="Debug Settings"><label className="checkbox_label" htmlFor="vrm_show_grid_checkbox"><input checked={boolSetting(settings, "vrmShowGrid")} id="vrm_show_grid_checkbox" name="vrm_show_grid_checkbox" onChange={(event) => onSettingChange("vrmShowGrid", event.target.checked)} type="checkbox" /><small>Show grid</small></label><label className="checkbox_label" htmlFor="vrm_show_status_checkbox"><input checked={boolSetting(settings, "vrmShowStatus")} id="vrm_show_status_checkbox" name="vrm_show_status_checkbox" onChange={(event) => onSettingChange("vrmShowStatus", event.target.checked)} type="checkbox" /><small>Show VRM status</small></label><label className="checkbox_label" htmlFor="vrm_reload_button"><button className="menu_button" id="vrm_reload_button" type="button" onClick={() => refreshVrmAssets().catch(() => undefined)}><i className="fa fa-refresh" aria-hidden="true" /></button><small>Click to reload all VRM models (debug)</small></label></VrmSection>
      <VrmSection id="vrm_scene" title="Scene Settings">
        <VrmCollapsible id="lighting" title="Lighting Settings" defaultOpen>
          <div className="vrm-parameter"><div className="vrm-parameter-title"><label htmlFor="vrm_light_preset">Light preset</label></div><div className="vrm-slider-div"><select className="text_pole" id="vrm_light_preset" value={stringSetting(settings, "vrmLightPreset", "studio")} onChange={(event) => onSettingChange("vrmLightPreset", event.target.value)}><option value="flat">Flat</option><option value="studio">Studio</option><option value="dramatic">Dramatic</option><option value="anime">Anime</option><option value="rim">Rim Highlight</option></select><small>Configures the key, fill, rim, and ambient light balance.</small></div></div>
          <div className="vrm-parameter"><div className="vrm-parameter-title"><label htmlFor="vrm_light_color">Key light color</label></div><div className="vrm-slider-div"><div className="vrm-color-div"><input id="vrm_light_color" type="color" value={stringSetting(settings, "vrmLightColor", "#ffffff")} onChange={(event) => onSettingChange("vrmLightColor", event.target.value)} /><button className="menu_button" id="vrm_light_color_reset_button" type="button" onClick={() => onSettingChange("vrmLightColor", "#ffffff")}><i className="fa-solid fa-recycle" title="Restore default settings" /></button></div><small>Main directional light color.</small></div></div>
          <div className="vrm-parameter"><div className="vrm-parameter-title"><label htmlFor="vrm_light_intensity">Key light intensity (<span id="vrm_light_intensity_value">{numberSetting(settings, "vrmLightIntensity", 100)}</span>%)</label></div><div className="vrm-slider-div"><div className="vrm-slider-reset-div"><input id="vrm_light_intensity" max={250} min={0} step={1} type="range" value={numberSetting(settings, "vrmLightIntensity", 100)} onChange={(event) => updateNumber("vrmLightIntensity", event.target.value, 0, 250, 100)} /><button className="menu_button" id="vrm_light_intensity_reset_button" type="button" onClick={() => onSettingChange("vrmLightIntensity", 100)}><i className="fa-solid fa-recycle" title="Restore default settings" /></button></div><small>Higher values create stronger highlights and shadow contrast.</small></div></div>
          <div className="vrm-parameter"><div className="vrm-parameter-title"><label htmlFor="vrm_key_light_angle">Key light angle (<span id="vrm_key_light_angle_value">{numberSetting(settings, "vrmKeyLightAngle", 35)}</span> deg)</label></div><div className="vrm-slider-div"><input id="vrm_key_light_angle" max={90} min={-90} step={1} type="range" value={numberSetting(settings, "vrmKeyLightAngle", 35)} onChange={(event) => updateNumber("vrmKeyLightAngle", event.target.value, -90, 90, 35)} /><small>Moves the key light around the model for asymmetric body highlights.</small></div></div>
          <label className="checkbox_label" htmlFor="vrm_rim_light_checkbox"><input checked={boolSetting(settings, "vrmRimLightEnabled", true)} id="vrm_rim_light_checkbox" name="vrm_rim_light_checkbox" onChange={(event) => onSettingChange("vrmRimLightEnabled", event.target.checked)} type="checkbox" /><small>Rim highlight light</small></label>
          <div className="vrm-parameter"><div className="vrm-parameter-title"><label htmlFor="vrm_rim_light_color">Rim light color</label></div><div className="vrm-slider-div"><div className="vrm-color-div"><input id="vrm_rim_light_color" type="color" value={stringSetting(settings, "vrmRimLightColor", "#d9e8ff")} onChange={(event) => onSettingChange("vrmRimLightColor", event.target.value)} /><button className="menu_button" id="vrm_rim_light_color_reset_button" type="button" onClick={() => onSettingChange("vrmRimLightColor", "#d9e8ff")}><i className="fa-solid fa-recycle" title="Restore default settings" /></button></div><small>Cool rim colors usually make edges pop without washing out skin.</small></div></div>
          <div className="vrm-parameter"><div className="vrm-parameter-title"><label htmlFor="vrm_rim_light_intensity">Rim intensity (<span id="vrm_rim_light_intensity_value">{numberSetting(settings, "vrmRimLightIntensity", 85)}</span>%)</label></div><div className="vrm-slider-div"><input id="vrm_rim_light_intensity" max={250} min={0} step={1} type="range" value={numberSetting(settings, "vrmRimLightIntensity", 85)} onChange={(event) => updateNumber("vrmRimLightIntensity", event.target.value, 0, 250, 85)} /><small>Accentuates silhouette and curved forms from behind.</small></div></div>
          <div className="vrm-parameter"><div className="vrm-parameter-title"><label htmlFor="vrm_fill_light_intensity">Fill intensity (<span id="vrm_fill_light_intensity_value">{numberSetting(settings, "vrmFillLightIntensity", 35)}</span>%)</label></div><div className="vrm-slider-div"><input id="vrm_fill_light_intensity" max={200} min={0} step={1} type="range" value={numberSetting(settings, "vrmFillLightIntensity", 35)} onChange={(event) => updateNumber("vrmFillLightIntensity", event.target.value, 0, 200, 35)} /><small>Softens dark areas while preserving key-light shape.</small></div></div>
          <div className="vrm-parameter"><div className="vrm-parameter-title"><label htmlFor="vrm_ambient_light_intensity">Ambient intensity (<span id="vrm_ambient_light_intensity_value">{numberSetting(settings, "vrmAmbientLightIntensity", 45)}</span>%)</label></div><div className="vrm-slider-div"><input id="vrm_ambient_light_intensity" max={200} min={0} step={1} type="range" value={numberSetting(settings, "vrmAmbientLightIntensity", 45)} onChange={(event) => updateNumber("vrmAmbientLightIntensity", event.target.value, 0, 200, 45)} /><small>Raises baseline light so shadows do not crush to black.</small></div></div>
          <div className="vrm-parameter"><div className="vrm-parameter-title"><label htmlFor="vrm_lighting_contrast">Lighting contrast (<span id="vrm_lighting_contrast_value">{numberSetting(settings, "vrmLightingContrast", 55)}</span>%)</label></div><div className="vrm-slider-div"><input id="vrm_lighting_contrast" max={100} min={0} step={1} type="range" value={numberSetting(settings, "vrmLightingContrast", 55)} onChange={(event) => updateNumber("vrmLightingContrast", event.target.value, 0, 100, 55)} /><small>Shifts balance from flat viewer lighting to more dramatic contour lighting.</small></div></div>
        </VrmCollapsible>
      </VrmSection>

      <VrmSection id="vrm_model_mapping" title="Model Mapping">
        <div className="voiceforge-map-tools"><button className="menu_button" type="button" onClick={() => navigator.clipboard?.writeText(JSON.stringify({ character_model_mapping: Object.fromEntries(Object.entries(vrmModelMap).map(([agentId, entry]) => [promptProfiles.find((profile) => profile.id === agentId)?.assistantName || promptProfiles.find((profile) => profile.id === agentId)?.name || agentId, objectSetting(entry).model || "none"])), model_settings: settings.vrmModelSettings || {} }, null, 2)).catch(() => undefined)}>Export Map</button><button className="menu_button" type="button" onClick={() => navigator.clipboard?.readText().then(importVrmMap).catch(() => onError("Could not import VRM map from clipboard."))}>Import Map</button></div>
        <div id="vrm_character_map_cards" className="vrm-character-map-cards">
          {promptProfiles.length === 0 ? <p className="empty-state">No agents available.</p> : null}
          {promptProfiles.map((profile, index) => {
            const entry = objectSetting(vrmModelMap[profile.id]);
            const model = String(entry.model || (profile.id === selectedAgentId ? selectedModel : ""));
            const cardModelSettings = model ? modelSettingsForUi(settings, model) : {};
            const updateCardModelNumber = (key: string, value: string, min: number, max: number, fallback: number) => {
              if (!model) return;
              const raw = Number(value);
              updateModelSetting(model, key, Math.max(min, Math.min(max, Number.isFinite(raw) ? raw : fallback)));
            };
            const modelOptions = ["", ...vrmAssets.models.map((asset) => asset.url)];
            return <details className="vrm-character-card" key={profile.id} onToggle={(event) => { if (event.currentTarget.open) onSettingChange("vrmSelectedAgentId", profile.id); }}>
              <summary className="vrm-character-card-header"><strong>{profile.assistantName || profile.name}</strong><span>{assetLabel(model, vrmAssets.models)}</span><button className="vrm-icon-button" type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); navigator.clipboard?.writeText(JSON.stringify(entry, null, 2)).catch(() => undefined); }}><i className="fa-regular fa-copy" /></button><button className="vrm-icon-button" type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); navigator.clipboard?.readText().then((text) => { const pasted = objectSetting(JSON.parse(text)); updateAgentModel(profile.id, normalizeModelPath(pasted.model || pasted.sourceModelPath || pasted.sourceModel || pasted.model_path || text, vrmAssets)); }).catch(() => undefined); }}><i className="fa-solid fa-paste" /></button><i className="fa-solid fa-chevron-down" /></summary>
              <div className="vrm-character-card-content">
                <div className="vrm-parameter" id="vrm_model_div"><div className="vrm-parameter-title"><label htmlFor={`vrm_model_select_${profile.id}`}>VRM Model:</label></div><div><div className="vrm-model-select-div"><button className="menu_button" id="vrm_model_refresh_button" type="button" onClick={() => refreshVrmAssets().catch(() => undefined)}><i className="fa-solid fa-refresh" title="Refresh model list" /></button><select className="text_pole" id={`vrm_model_select_${profile.id}`} value={model} onChange={(event) => updateAgentModel(profile.id, event.target.value)}>{modelOptions.map((option) => <option key={option || "none"} value={option}>{option ? assetLabel(option, vrmAssets.models) : "-- Select Model --"}</option>)}</select><button className="menu_button" id="vrm_model_reset_button" type="button" onClick={() => updateAgentModel(profile.id, "")}><i className="fa-solid fa-recycle" title="Restore default settings" /></button></div><small>Click refresh button to reload models list and unload current model.</small></div></div>
                {profile.id === selectedAgentId ? <p id="vrm_model_loading">Selected model renders in the chat/editor VRM preview area.</p> : null}
                <div id="vrm_model_settings">
                  <VrmCollapsible id="model-settings" title="Model Settings"><VrmModelSliders modelSettings={cardModelSettings} updateModelNumber={updateCardModelNumber} /></VrmCollapsible>
                  <VrmCollapsible id="hitboxes" title="Hit Areas Mapping">{model ? <MappingRows model={model} settings={settings} type="hitbox" updateModelSetting={updateModelSetting} vrmAssets={vrmAssets} /> : <div id="vrm_hitboxes_mapping" className="empty-state">Select a VRM model first.</div>}</VrmCollapsible>
                  <VrmCollapsible id="animations" title="Model Animations"><div className="vrm-parameter"><div className="vrm-parameter-title">Default Animations</div><div className="vrm_expression_select_div vrm-select-div"><div className="vrm-select-div"><select className="text_pole" id="vrm_default_expression_select" value={selectedExpression} onChange={(event) => updateDefaultAnimation("expression", event.target.value)}><option value="">-- Default Expression --</option>{vrmAssets.animations.map((asset) => <option key={asset.url} value={asset.url}>{asset.name}</option>)}</select><button className="vrm_replay_button menu_button" id="vrm_default_expression_replay" type="button"><i className="fa-solid fa-arrow-rotate-left" /></button></div><div className="vrm-select-div"><select className="text_pole" id="vrm_default_motion_select" value={selectedMotion} onChange={(event) => updateDefaultAnimation("motion", event.target.value)}><option value="">-- Default Motion --</option>{vrmAssets.animations.map((asset) => <option key={asset.url} value={asset.url}>{asset.name}</option>)}</select><button className="vrm_replay_button menu_button" id="vrm_default_motion_replay" type="button"><i className="fa-solid fa-arrow-rotate-left" /></button></div><small>Played when classified expression has no mapping set.</small></div></div></VrmCollapsible>
                  <VrmCollapsible id="classified" title="Classified Expressions Mapping">{model ? <MappingRows model={model} settings={settings} type="classify" updateModelSetting={updateModelSetting} vrmAssets={vrmAssets} /> : <div id="vrm_expression_mapping" className="empty-state">Select a VRM model first.</div>}</VrmCollapsible>
                   <VrmCollapsible id="blend-shapes" title="Custom Blend Shape Mapping">{model ? <BlendShapeMappingRows expressionData={modelExpressions[model] || { names: [], defaults: {} }} model={model} onSettingChange={onSettingChange} settings={settings} updateModelSetting={updateModelSetting} /> : <div id="vrm_blend_shape_groups" className="empty-state">Select a VRM model first.</div>}</VrmCollapsible>
                </div>
              </div>
            </details>;
          })}
        </div>
        <div id="vrm_character_select" hidden>{selectedAgentId}</div>
        <div id="vrm_model_editor_backing" style={{ display: "none" }} />
      </VrmSection>
    </div>
  </div>;
}
