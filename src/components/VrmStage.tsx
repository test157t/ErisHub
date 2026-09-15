import { memo, useEffect, useRef, useState } from "react";

type VrmStageProps = {
  animations: string[];
  autoSendHitboxMessage: boolean;
  blink: boolean;
  chestJiggleEnabled: boolean;
  chestJiggleAccelerometer: boolean;
  chestJiggleStrength: number;
  chestJiggleSoftness: number;
  chestJiggleGravity: number;
  chestJiggleVertical: number;
  chestJiggleSway: number;
  chestJiggleDepth: number;
  characters: string[];
  className?: string;
  enabled: boolean;
  followCamera: boolean;
  followCursor: boolean;
  hitboxes: boolean;
  lightColor: string;
  lightIntensity: number;
  lightPreset: string;
  rimLightEnabled: boolean;
  rimLightColor: string;
  rimLightIntensity: number;
  fillLightIntensity: number;
  ambientLightIntensity: number;
  keyLightAngle: number;
  lightingContrast: number;
  modelZIndex: number;
  modelsCache: boolean;
  modelSettings: Record<string, unknown>;
  modelUrl: string;
  characterModels?: Array<{ character: string; modelSettings: Record<string, unknown>; modelUrl: string }>;
  naturalIdle: boolean;
  animationsCache: boolean;
  showGrid: boolean;
  showStatus?: boolean;
  ttsLipsSync: boolean;
  positionX: number;
  positionY: number;
  positionZ: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  scale: number;
};

function loadModule(url: string): Promise<Record<string, any>> {
  return import(/* @vite-ignore */ url);
}

const VERSION = "native-vrm-57";
let sharedRuntime: Record<string, any> | null = null;

function expressionBindDefaults(avatar: Record<string, any>) {
  const expressionMap = avatar.vrm?.expressionManager?.expressionMap || {};
  const defaults: Record<string, Record<string, number>> = {};
  for (const [expressionName, expression] of Object.entries(expressionMap)) {
    const blendShapes: Record<string, number> = {};
    for (const bind of (expression as { _binds?: Array<{ index?: number; primitives?: Array<{ morphTargetDictionary?: Record<string, number> }>; weight?: number }> })._binds || []) {
      for (const primitive of bind.primitives || []) {
        const morphName = Object.entries(primitive.morphTargetDictionary || {}).find(([, index]) => index === bind.index)?.[0];
        if (!morphName) continue;
        blendShapes[morphName] = Math.max(blendShapes[morphName] || 0, Math.max(0, Math.min(1, Number(bind.weight) || 0)));
      }
    }
    defaults[String(expressionName)] = blendShapes;
  }
  return defaults;
}

function shouldForwardHitboxPointer(event: PointerEvent, canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return false;
  const target = event.target instanceof Element ? event.target : document.elementFromPoint(event.clientX, event.clientY);
  const blockedTargetSelector = "button,input,select,textarea,a,[role='button'],.sidebar,.message,.composer,.app-settings-page,.modules-page,.provider-page,.agents-page,.editor-page,.chat-manager-panel,.toast-stack,.boot-overlay,#intiface-chat-media-panel,#intiface-media-menu,video";
  if (target?.closest(blockedTargetSelector)) return false;
  const topElement = document.elementFromPoint(event.clientX, event.clientY);
  if (topElement?.closest(blockedTargetSelector)) return false;
  return true;
}

function hideRuntimeCanvas() {
  const canvas = document.getElementById("vrm-canvas") as HTMLCanvasElement | null;
  if (!canvas) return;
  canvas.style.display = "none";
  canvas.style.visibility = "hidden";
  canvas.style.opacity = "0";
}

function modelSettingsWithTransform(props: VrmStageProps, sourceModelSettings = props.modelSettings) {
  const animationDefault = sourceModelSettings.animation_default && typeof sourceModelSettings.animation_default === "object"
    ? sourceModelSettings.animation_default
    : { expression: "neutral", motion: "/assets/vrm/animations/neutral.bvh", sequence: "" };
  return {
    scale: props.scale,
    x: props.positionX,
    y: props.positionY,
    z: props.positionZ,
    rx: props.rotationX,
    ry: props.rotationY,
    rz: props.rotationZ,
    animation_default: animationDefault,
    classify_mapping: {},
    hitboxes_mapping: {},
    blend_shape_mapping: {},
      ...sourceModelSettings
  };
}

export const VrmStage = memo(function VrmStage(props: VrmStageProps) {
  const { enabled, modelUrl, showStatus } = props;
  const activeModels = (props.characterModels?.length ? props.characterModels : [{ character: props.characters[0] || "", modelSettings: props.modelSettings, modelUrl }])
    .filter((entry) => entry.character && entry.modelUrl);
  const character = activeModels[0]?.character || "";
  const stageRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<Record<string, any> | null>(null);
  const hitboxesEnabledRef = useRef(props.hitboxes);
  const latestPropsRef = useRef(props);
  const [statusLog, setStatusLog] = useState<string[]>([]);

  latestPropsRef.current = props;

  const animationsSignature = props.animations.join("\n");
  const modelSettingsSignature = JSON.stringify(activeModels.map((entry) => [entry.character, entry.modelUrl, entry.modelSettings]));
  const modelsSignature = activeModels.map((entry) => `${entry.character}\t${entry.modelUrl}`).join("\n");
  const blockedReason = !enabled ? "VRM disabled" : activeModels.length === 0 ? "No selected VRM agents" : "";

  function runtimeState(sourceProps = latestPropsRef.current) {
    const models = (sourceProps.characterModels?.length ? sourceProps.characterModels : [{ character: sourceProps.characters[0] || "", modelSettings: sourceProps.modelSettings, modelUrl: sourceProps.modelUrl }])
      .filter((entry) => entry.character && entry.modelUrl);
    const characters = models.map((entry) => entry.character);
    const characterModelMapping = Object.fromEntries(models.map((entry) => [entry.character, entry.modelUrl]));
    const modelSettings = Object.fromEntries(models.map((entry) => [entry.modelUrl, modelSettingsWithTransform(sourceProps, entry.modelSettings)]));

    return {
      animations: sourceProps.animations,
      characters,
      vrm: {
        enabled: true,
        blink: sourceProps.blink,
        natural_idle: sourceProps.naturalIdle,
        hitboxes: sourceProps.hitboxes,
        auto_send_hitbox_message: sourceProps.autoSendHitboxMessage,
        chest_jiggle_enabled: sourceProps.chestJiggleEnabled,
        chest_jiggle_accelerometer: sourceProps.chestJiggleAccelerometer,
        chest_jiggle_strength: sourceProps.chestJiggleStrength,
        chest_jiggle_softness: sourceProps.chestJiggleSoftness,
        chest_jiggle_gravity: sourceProps.chestJiggleGravity,
        chest_jiggle_vertical: sourceProps.chestJiggleVertical,
        chest_jiggle_sway: sourceProps.chestJiggleSway,
        chest_jiggle_depth: sourceProps.chestJiggleDepth,
        follow_camera: sourceProps.followCamera,
        follow_cursor: sourceProps.followCursor,
        tts_lips_sync: sourceProps.ttsLipsSync,
        show_grid: sourceProps.showGrid,
        light_color: sourceProps.lightColor,
        light_intensity: sourceProps.lightIntensity,
        light_preset: sourceProps.lightPreset,
        rim_light_enabled: sourceProps.rimLightEnabled,
        rim_light_color: sourceProps.rimLightColor,
        rim_light_intensity: sourceProps.rimLightIntensity,
        fill_light_intensity: sourceProps.fillLightIntensity,
        ambient_light_intensity: sourceProps.ambientLightIntensity,
        key_light_angle: sourceProps.keyLightAngle,
        lighting_contrast: sourceProps.lightingContrast,
        character_model_mapping: characterModelMapping,
        model_settings: modelSettings,
        models_cache: sourceProps.modelsCache,
        animations_cache: sourceProps.animationsCache,
        model_z_index: sourceProps.modelZIndex
      }
    };
  }

  useEffect(() => {
    function onRuntimeStatus(event: Event) {
      const message = String((event as CustomEvent<{ message?: unknown }>).detail?.message || "");
      if (message) setStatusLog((current) => [...current, message].slice(-12));
    }

    window.addEventListener("nitral-vrm-status", onRuntimeStatus);
    return () => window.removeEventListener("nitral-vrm-status", onRuntimeStatus);
  }, []);

  useEffect(() => {
    setStatusLog(blockedReason ? [blockedReason, `enabled=${enabled}`, `models=${modelsSignature || "(empty)"}`] : []);
    if (blockedReason) {
      const runtime = runtimeRef.current || sharedRuntime;
      const clearedState = runtimeState();
      clearedState.vrm.enabled = false;
      runtime?.setNitralVrmRuntimeState?.(clearedState);
      void runtime?.loadAllModels?.([])?.finally?.(hideRuntimeCanvas);
      hideRuntimeCanvas();
      return;
    }
    let cancelled = false;

    async function boot() {
      const log: string[] = [];
      function emit(msg: string) { log.push(msg); if (!cancelled) setStatusLog([...log]); }

      try {
        if (activeModels.length === 0) { emit("ERROR: no selected VRM agents"); return; }

        emit(`Agents: ${activeModels.map((entry) => `${entry.character}=${entry.modelUrl}`).join(", ")}`);

        emit("Loading VRM runtime…");
        const runtime = await loadModule(`/assets/modules/vrm/vrm/vrm.js?v=${VERSION}`);
        if (cancelled) return;
        sharedRuntime = runtime;
        runtimeRef.current = runtime;
        runtime.setNitralVrmRuntimeState?.(runtimeState());
        runtime.setCursorTracking?.(latestPropsRef.current.followCursor);

        emit("Calling loadScene()…");
        await runtime.loadScene();
        if (cancelled) return;

        const canvas = document.getElementById("vrm-canvas") as HTMLCanvasElement | null;
        if (canvas) {
          if (stageRef.current && canvas.parentElement !== stageRef.current) {
            stageRef.current.appendChild(canvas);
          }
          canvas.className = `vrm-runtime-canvas ${props.className || ""}`.trim();
          canvas.style.display = "block";
          canvas.style.visibility = "visible";
          canvas.style.opacity = "1";
          canvas.style.zIndex = String(props.modelZIndex);
          const bounds = stageRef.current?.getBoundingClientRect();
          if (bounds && bounds.width > 0 && bounds.height > 0) {
            runtime.renderer?.setSize?.(bounds.width, bounds.height);
            if (runtime.camera) {
              runtime.camera.aspect = bounds.width / bounds.height;
              runtime.camera.updateProjectionMatrix?.();
            }
          }
          emit(`Canvas OK: ${canvas.width}x${canvas.height}, z=${canvas.style.zIndex}`);
        } else {
          emit("ERROR: loadScene() returned without creating #vrm-canvas");
          return;
        }

        const characters = activeModels.map((entry) => entry.character);
        emit(`loadAllModels([${characters.join(", ")}]) …`);
        await runtime.loadAllModels(characters);
        if (cancelled) return;

        for (const entry of activeModels) {
        const avatar = runtime.current_avatars?.[entry.character];
        emit(avatar ? `Avatar loaded for ${entry.character} (VRM ${avatar.vrmMetaVersion || "unknown"})` : `WARNING: no avatar for ${entry.character} after loadAllModels`);
        if (avatar) {
          const expressions = avatar.expressions?.names || [];
          const expressionDefaults = expressionBindDefaults(avatar);
          const cache = (window as typeof window & { __nitralVrmModelExpressions?: Record<string, { names: string[]; defaults: Record<string, Record<string, number>> }> }).__nitralVrmModelExpressions || {};
          cache[entry.modelUrl] = { names: expressions, defaults: expressionDefaults };
          (window as typeof window & { __nitralVrmModelExpressions?: Record<string, { names: string[]; defaults: Record<string, Record<string, number>> }> }).__nitralVrmModelExpressions = cache;
          window.dispatchEvent(new CustomEvent("nitral-vrm-model-expressions", { detail: { character: entry.character, modelUrl: entry.modelUrl, expressions, expressionDefaults } }));

        }
        }
       } catch (error) {
         const msg = "ERROR: " + (error instanceof Error ? error.message : String(error));
         if (!cancelled) {
           emit(msg);
           console.error(msg);
         }
       }
    }

    void boot();
    return () => {
      cancelled = true;
      const runtime = runtimeRef.current || sharedRuntime;
      const clearedState = runtimeState({ ...latestPropsRef.current, characterModels: [], characters: [], modelUrl: "" });
      clearedState.vrm.enabled = false;
      runtime?.setNitralVrmRuntimeState?.(clearedState);
      void runtime?.loadAllModels?.([])?.finally?.(hideRuntimeCanvas);
      hideRuntimeCanvas();
    };
  }, [enabled, modelsSignature]);

  useEffect(() => {
    if (!enabled || activeModels.length === 0 || !runtimeRef.current) return;

    runtimeRef.current.setNitralVrmRuntimeState?.(runtimeState());
    runtimeRef.current.setCursorTracking?.(props.followCursor);
    for (const entry of activeModels) runtimeRef.current.updateModel?.(entry.character);
    runtimeRef.current.setLight?.(props.lightColor, props.lightIntensity);
    if (props.hitboxes !== hitboxesEnabledRef.current) {
      hitboxesEnabledRef.current = props.hitboxes;
      runtimeRef.current.clearModelCache?.();
      for (const entry of activeModels) runtimeRef.current.setModel?.(entry.character, entry.modelUrl);
    }
  }, [enabled, modelsSignature, animationsSignature, props.autoSendHitboxMessage, props.blink, props.chestJiggleEnabled, props.chestJiggleAccelerometer, props.chestJiggleStrength, props.chestJiggleSoftness, props.chestJiggleGravity, props.chestJiggleVertical, props.chestJiggleSway, props.chestJiggleDepth, props.followCamera, props.followCursor, props.hitboxes, props.lightColor, props.lightIntensity, props.lightPreset, props.rimLightEnabled, props.rimLightColor, props.rimLightIntensity, props.fillLightIntensity, props.ambientLightIntensity, props.keyLightAngle, props.lightingContrast, modelSettingsSignature, props.modelZIndex, props.modelsCache, props.naturalIdle, props.animationsCache, props.showGrid, props.ttsLipsSync, props.positionX, props.positionY, props.positionZ, props.rotationX, props.rotationY, props.rotationZ, props.scale]);

  useEffect(() => {
    if (!enabled || !modelUrl || !props.followCursor) return;

    function onPointerMove(event: PointerEvent) {
      runtimeRef.current?.setCursorPosition?.(event.clientX, event.clientY);
    }

    document.addEventListener("pointermove", onPointerMove);
    return () => document.removeEventListener("pointermove", onPointerMove);
  }, [enabled, modelUrl, props.followCursor]);

  useEffect(() => {
    if (!enabled || !modelUrl || !character || !props.ttsLipsSync) return;

    function onTtsStart(event: Event) {
      const detail = (event as CustomEvent<{ character?: string }>).detail || {};
      const char = detail.character || character;
      runtimeRef.current?.startRealtimeLipSync?.(char);
      runtimeRef.current?.setPhonePropVisible?.(char, true);
    }

    function onTtsEnd() {
      runtimeRef.current?.stopRealtimeLipSync?.();
      Object.keys(runtimeRef.current?.current_avatars || {}).forEach((char) => {
        runtimeRef.current?.setPhonePropVisible?.(char, false);
      });
    }

    window.addEventListener("voiceforge_tts_lipsync_start", onTtsStart);
    window.addEventListener("voiceforge_tts_lipsync_end", onTtsEnd);
    return () => {
      window.removeEventListener("voiceforge_tts_lipsync_start", onTtsStart);
      window.removeEventListener("voiceforge_tts_lipsync_end", onTtsEnd);
    };
  }, [enabled, modelUrl, character, props.ttsLipsSync]);

  useEffect(() => {
    if (!enabled || !modelUrl || !character || !props.hitboxes) return;

    async function onPointerDown(event: PointerEvent) {
      const canvas = document.getElementById("vrm-canvas") as HTMLCanvasElement | null;
      if (!canvas || !shouldForwardHitboxPointer(event, canvas)) return;
      await runtimeRef.current?.pointerDownHitboxAt?.(event.clientX, event.clientY);
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [enabled, modelUrl, character, props.hitboxes, modelSettingsSignature, props.positionX, props.positionY, props.positionZ, props.rotationX, props.rotationY, props.rotationZ, props.scale]);

if (blockedReason) {
  return showStatus ? <div className="vrm-stage-status">
    <div>{blockedReason}</div>
    <div>enabled={String(enabled)}</div>
    <div>character={character || "(empty)"}</div>
    <div>model={modelUrl || "(empty)"}</div>
  </div> : null;
}

return (
  <>
    <div ref={stageRef} className={`vrm-stage ${props.className || ""}`} aria-label="VRM avatar runtime" />
    {showStatus && statusLog.length > 0 && (
      <div className="vrm-stage-status" onClick={() => { const text = statusLog.join("\n"); if (text) navigator.clipboard?.writeText(text).catch(() => {}); setStatusLog([]); }}>
        {statusLog.map((line, idx) => (
          <div key={idx}>{line}</div>
        ))}
      </div>
    )}
  </>
);
});
