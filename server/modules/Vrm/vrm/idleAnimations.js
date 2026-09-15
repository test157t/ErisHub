import * as THREE from '/assets/modules/embody/lib/three.module.js';
import { DEBUG_PREFIX } from './constants.js';

export const IDLE_MOVEMENT_CONFIGS = {};
let idleConfigLoadPromise = null;

export async function loadIdleMovementConfigs() {
    if (Object.keys(IDLE_MOVEMENT_CONFIGS).length > 0) return IDLE_MOVEMENT_CONFIGS;
    if (!idleConfigLoadPromise) {
        idleConfigLoadPromise = (async () => {
            const response = await fetch(new URL('./idleAnimations.json', import.meta.url), { cache: 'no-store' });
            if (!response.ok) throw new Error(`Idle animation config load failed: ${response.status}`);
            const data = await response.json();
            if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Idle animation config JSON must be an object');
            Object.assign(IDLE_MOVEMENT_CONFIGS, data);
            return IDLE_MOVEMENT_CONFIGS;
        })();
    }
    return await idleConfigLoadPromise;
}

export function generateIdleAnimationClip(vrm, movementConfig, clipName = 'naturalIdle') {
    const tracks = [];
    const duration = movementConfig.duration / 1000;
    const rampDuration = Math.min(3.5, duration * 0.34);
    const holdDuration = Math.max(0.1, duration - (rampDuration * 2));
    for (const [boneName, rotation] of Object.entries(movementConfig.rotations || {})) {
        const bone = vrm.humanoid?.getNormalizedBoneNode(boneName);
        if (!bone) continue;
        const track = generateBoneTrack(bone, boneName, rotation, rampDuration, holdDuration);
        if (track) tracks.push(track);
    }
    if (tracks.length === 0) {
        console.warn(DEBUG_PREFIX, 'No valid bone tracks generated for idle animation:', clipName);
        return null;
    }
    return new THREE.AnimationClip(clipName, duration, tracks);
}

function generateBoneTrack(bone, boneName, rotationDelta, rampDuration, holdDuration) {
    if (!bone || !bone.name) {
        console.warn(DEBUG_PREFIX, 'Invalid bone for track generation:', boneName);
        return null;
    }
    const baseQuat = bone.quaternion.clone();
    const baseEuler = new THREE.Euler().setFromQuaternion(baseQuat);
    const targetEuler = new THREE.Euler(baseEuler.x + (rotationDelta.x || 0), baseEuler.y + (rotationDelta.y || 0), baseEuler.z + (rotationDelta.z || 0));
    const targetQuat = new THREE.Quaternion().setFromEuler(targetEuler);
    const times = [0, rampDuration, rampDuration + holdDuration, rampDuration * 2 + holdDuration];
    const values = [baseQuat.x, baseQuat.y, baseQuat.z, baseQuat.w, targetQuat.x, targetQuat.y, targetQuat.z, targetQuat.w, targetQuat.x, targetQuat.y, targetQuat.z, targetQuat.w, baseQuat.x, baseQuat.y, baseQuat.z, baseQuat.w];
    return new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values);
}

export function generateMultiStageAnimationClip(vrm, config) {
    const tracks = [];
    let maxDuration = 0;
    const allBones = new Set();
    for (const stage of config.stages || []) for (const bone of Object.keys(stage.rotations || {})) allBones.add(bone);
    for (const boneName of allBones) {
        const bone = vrm.humanoid?.getNormalizedBoneNode(boneName);
        if (!bone) continue;
        const baseQuat = bone.quaternion.clone();
        const baseEuler = new THREE.Euler().setFromQuaternion(baseQuat);
        const times = [0];
        const values = [baseQuat.x, baseQuat.y, baseQuat.z, baseQuat.w];
        let currentTime = 0;
        let fromQuat = baseQuat.clone();
        const fps = Math.max(12, Math.min(36, config.sampleRate || 24));
        for (const stage of config.stages || []) {
            const stageDuration = Math.max(0.1, (stage.duration || 1000) / 1000);
            const stageStart = currentTime;
            currentTime += stageDuration;
            const rotation = stage.rotations?.[boneName] || { x: 0, y: 0, z: 0 };
            const targetQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(baseEuler.x + (rotation.x || 0), baseEuler.y + (rotation.y || 0), baseEuler.z + (rotation.z || 0)));
            const steps = Math.max(2, Math.ceil(stageDuration * fps));
            for (let step = 1; step <= steps; step += 1) {
                const progress = step / steps;
                const eased = smootherstep01(progress);
                const quat = fromQuat.clone().slerp(targetQuat, eased);
                times.push(stageStart + stageDuration * progress);
                values.push(quat.x, quat.y, quat.z, quat.w);
            }
            fromQuat = targetQuat;
        }
        const returnDuration = Math.max(1.8, (config.returnDuration || 3200) / 1000);
        const returnStart = currentTime;
        currentTime += returnDuration;
        const returnSteps = Math.max(2, Math.ceil(returnDuration * fps));
        for (let step = 1; step <= returnSteps; step += 1) {
            const progress = step / returnSteps;
            const eased = smootherstep01(progress);
            const quat = fromQuat.clone().slerp(baseQuat, eased);
            times.push(returnStart + returnDuration * progress);
            values.push(quat.x, quat.y, quat.z, quat.w);
        }
        maxDuration = Math.max(maxDuration, currentTime);
        tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values));
    }
    if (!tracks.length) return null;
    return new THREE.AnimationClip(String(config.description || 'multiStageIdle').replace(/\s+/g, ''), maxDuration, tracks);
}

function clamp01(value) { return Math.max(0, Math.min(1, value)); }
function smoothstep01(value) { const t = clamp01(value); return t * t * (3 - 2 * t); }
function smootherstep01(value) { const t = clamp01(value); return t * t * t * (t * (t * 6 - 15) + 10); }

function computeLayerEnvelope(layer, timeSec, durationSec) {
    const start = Math.max(0, layer.startSec || 0);
    const end = Math.max(start, layer.endSec != null ? layer.endSec : durationSec);
    if (timeSec < start || timeSec > end) return 0;
    const attack = Math.max(0.001, layer.attackSec || 0.6);
    const release = Math.max(0.001, layer.releaseSec || 0.6);
    return Math.min(smoothstep01((timeSec - start) / attack), smoothstep01((end - timeSec) / release));
}

function computeLayerSignal(layer, timeSec) {
    if ((layer.mode || 'sine') === 'pulse') {
        const norm = (timeSec - (layer.centerSec || 0)) / Math.max(0.02, layer.widthSec || 0.2);
        return Math.exp(-(norm * norm));
    }
    const sine = Math.sin((Math.PI * 2 * Math.max(0.01, layer.frequencyHz || 0.2) * timeSec) + (layer.phase || 0));
    return layer.mode === 'triangle' ? (2 / Math.PI) * Math.asin(sine) : sine;
}

export function generateLayeredProceduralClip(vrm, config, clipName = 'layeredIdle') {
    const durationSec = Math.max(2, (config.duration || 10000) / 1000);
    const fps = Math.max(12, Math.min(60, config.sampleRate || 30));
    const layers = Array.isArray(config.layers) ? config.layers : [];
    if (!layers.length) return null;
    const boneNames = new Set();
    for (const layer of layers) for (const boneName of Object.keys(layer?.bones || {})) boneNames.add(boneName);
    const tracks = [];
    for (const boneName of boneNames) {
        const bone = vrm.humanoid?.getNormalizedBoneNode(boneName);
        if (!bone) continue;
        const baseQuat = bone.quaternion.clone();
        const baseEuler = new THREE.Euler().setFromQuaternion(baseQuat);
        const times = [];
        const values = [];
        for (let t = 0; t <= durationSec + 0.0001; t += 1 / fps) {
            let dx = 0, dy = 0, dz = 0;
            for (const layer of layers) {
                const boneDelta = layer?.bones?.[boneName];
                if (!boneDelta) continue;
                const weight = computeLayerEnvelope(layer, t, durationSec) * computeLayerSignal(layer, t);
                dx += (boneDelta.x || 0) * weight;
                dy += (boneDelta.y || 0) * weight;
                dz += (boneDelta.z || 0) * weight;
            }
            const targetQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(baseEuler.x + dx, baseEuler.y + dy, baseEuler.z + dz));
            times.push(Math.min(t, durationSec));
            values.push(targetQuat.x, targetQuat.y, targetQuat.z, targetQuat.w);
        }
        tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values));
    }
    return tracks.length ? new THREE.AnimationClip(clipName, durationSec, tracks) : null;
}

export function randomizeMovementConfig(baseConfig) {
    const config = JSON.parse(JSON.stringify(baseConfig));
    const lateralDirection = Math.random() > 0.5 ? 1 : -1;
    const intensityScale = 0.98 + Math.random() * 0.36;
    const randomizeRotationObject = (boneName, rotationObj) => {
        for (const axis of ['x', 'y', 'z']) {
            const base = rotationObj[axis] || 0;
            if (!base) continue;
            const directionalSign = (axis === 'y' || axis === 'z') ? (Math.sign(base) || 1) * lateralDirection : (Math.sign(base) || 1);
            rotationObj[axis] = clampIdleRotation(boneName, axis, Math.abs(base) * directionalSign * (0.9 + Math.random() * 0.2) * intensityScale);
        }
    };
    if (config.rotations) for (const [boneName, rotation] of Object.entries(config.rotations)) randomizeRotationObject(boneName, rotation);
    if (Array.isArray(config.stages)) for (const stage of config.stages) {
        if (stage.rotations) for (const [boneName, rotation] of Object.entries(stage.rotations)) randomizeRotationObject(boneName, rotation);
        if (stage.duration) stage.duration = Math.max(650, Math.round(stage.duration * (0.8 + Math.random() * 0.18)));
    }
    if (config.duration) config.duration = Math.max(2600, Math.round(config.duration * (0.78 + Math.random() * 0.16)));
    if (Array.isArray(config.layers)) for (const layer of config.layers) {
        layer.phase = (layer.phase || 0) + ((Math.random() - 0.5) * 0.6);
        if (layer.frequencyHz) layer.frequencyHz = Math.max(0.05, layer.frequencyHz * (1.0 + Math.random() * 0.22));
        if (layer.bones) for (const [boneName, delta] of Object.entries(layer.bones)) for (const axis of ['x', 'y', 'z']) if (delta[axis]) delta[axis] = clampIdleRotation(boneName, axis, delta[axis] * (0.93 + Math.random() * 0.14));
    }
    if (config.applyModelRotation) config.modelRotation = (config.modelRotationRange.min + Math.random() * (config.modelRotationRange.max - config.modelRotationRange.min)) * (Math.random() > 0.5 ? 1 : -1);
    return config;
}

function clampIdleRotation(boneName, axis, value) {
    const name = String(boneName || '').toLowerCase();
    const limit = name.includes('shoulder') ? 0.24
        : name.includes('upperarm') ? 0.68
            : name.includes('lowerarm') ? 0.78
                : name.includes('hand') ? 0.36
                    : name.includes('upperleg') || name.includes('lowerleg') || name.includes('foot') ? 0.16
                        : name.includes('head') ? 0.34
                            : name.includes('neck') ? 0.22
                                : 0.18;
    return Math.max(-limit, Math.min(limit, Number(value) || 0));
}

function applyProceduralCalibration(config, calibration = null) {
    if (!calibration || !config) return config;
    const calibrated = JSON.parse(JSON.stringify(config));
    const applyBoneScale = (boneName, delta) => {
        if (!delta) return;
        const scale = /shoulder/i.test(boneName) ? calibration.shoulderScale || 1 : (/upperarm|lowerarm|hand/i.test(boneName) ? calibration.armLiftScale || 1 : calibration.bodyScale || 1);
        for (const axis of ['x', 'y', 'z']) if (typeof delta[axis] === 'number') delta[axis] *= scale;
    };
    if (calibrated.rotations) for (const [boneName, delta] of Object.entries(calibrated.rotations)) applyBoneScale(boneName, delta);
    if (Array.isArray(calibrated.stages)) for (const stage of calibrated.stages) if (stage.rotations) for (const [boneName, delta] of Object.entries(stage.rotations)) applyBoneScale(boneName, delta);
    if (Array.isArray(calibrated.layers)) for (const layer of calibrated.layers) if (layer.bones) for (const [boneName, delta] of Object.entries(layer.bones)) applyBoneScale(boneName, delta);
    return calibrated;
}

export function getIdleAnimationClip(character, vrm, movementKey, calibration = null) {
    const baseConfig = IDLE_MOVEMENT_CONFIGS[movementKey];
    const config = applyProceduralCalibration(baseConfig, calibration);
    if (!config) {
        console.warn(DEBUG_PREFIX, 'Unknown idle movement:', movementKey);
        return { clip: null, randomizedRotation: 0 };
    }
    const randomizedConfig = randomizeMovementConfig(config);
    const clip = randomizedConfig.proceduralLayers
        ? generateLayeredProceduralClip(vrm, randomizedConfig, movementKey)
        : randomizedConfig.multiStage
            ? generateMultiStageAnimationClip(vrm, randomizedConfig)
            : generateIdleAnimationClip(vrm, randomizedConfig, movementKey);
    return { clip, randomizedRotation: randomizedConfig.modelRotation || 0 };
}
