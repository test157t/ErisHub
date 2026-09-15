import * as THREE from '/assets/modules/embody/lib/three.module.js';
import { GLTFLoader } from '/assets/modules/embody/lib/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from '/assets/modules/embody/lib/jsm/loaders/FBXLoader.js';
import { OrbitControls } from '/assets/modules/embody/lib/jsm/controls/OrbitControls.js';
import { VRMALoader } from '/assets/modules/embody/lib/jsm/loaders/VRMALoader.js';
import { VRMLoaderPlugin, VRMUtils, VRMSpringBoneCollider, VRMSpringBoneColliderShapeSphere } from '/assets/modules/embody/lib/three-vrm.module.js';
import { loadBVHAnimation, loadMixamoAnimation, loadMMDAnimation } from './animationLoader.js';
import { MMDLoader } from '/assets/modules/embody/lib/jsm/loaders/MMDLoader.js';
import { buildFbxVrmShim } from './fbxAdapter.js';

if (typeof globalThis.toastr === 'undefined') {
    globalThis.toastr = { error() {}, info() {}, success() {}, warning() {}, clear() {} };
}

if (!globalThis.$) {
    globalThis.$ = (selector) => {
        const elements = typeof selector === 'string'
            ? selector.trimStart().startsWith('<')
                ? (() => { const t = document.createElement('template'); t.innerHTML = selector; return Array.from(t.content.children); })()
                : selector.includes(':visible')
                    ? (() => {
                        const parts = selector.split(',').map(s => s.trim());
                        const result = [];
                        for (const part of parts) {
                            const clean = part.replace(/:visible/g, '').trim();
                            if (!clean) continue;
                            for (const node of document.querySelectorAll(clean)) {
                                if (node.getClientRects().length > 0) result.push(node);
                            }
                        }
                        return result;
                    })()
                    : Array.from(document.querySelectorAll(selector))
            : selector instanceof NodeList || Array.isArray(selector) ? Array.from(selector) : selector ? [selector] : [];
        const element = elements[0] || null;
        const api = {
            0: element,
            length: elements.length,
            addClass: (name) => { for (const item of elements) item?.classList?.add?.(...String(name).split(/\s+/).filter(Boolean)); return api; },
            removeClass: (name) => { for (const item of elements) item?.classList?.remove?.(...String(name).split(/\s+/).filter(Boolean)); return api; },
            toggleClass: (name, force) => { for (const item of elements) for (const cls of String(name).split(/\s+/).filter(Boolean)) item?.classList?.toggle?.(cls, force); return api; },
            text: (value) => { if (value === undefined) return element?.textContent || ''; for (const item of elements) item.textContent = String(value); return api; },
            val: (value) => { if (value === undefined) return element?.value; for (const item of elements) item.value = value; return api; },
            is: (query) => query === ':visible' ? !!(element && element.getClientRects().length) : !!element?.matches?.(query),
            show: () => { for (const item of elements) if (item?.style) item.style.display = ''; return api; },
            hide: () => { for (const item of elements) if (item?.style) item.style.display = 'none'; return api; },
            toggle: (force) => { for (const item of elements) if (item?.style) item.style.display = force ? '' : 'none'; return api; },
            slideToggle: () => { for (const item of elements) if (item?.style) item.style.display = item.style.display === 'none' ? '' : 'none'; return api; },
            append: (content) => { for (const item of elements) appendContent(item, content); return api; },
            prepend: (content) => { for (const item of elements) prependContent(item, content); return api; },
            empty: () => { for (const item of elements) item.textContent = ''; return api; },
            find: (query) => globalThis.$(element ? element.querySelectorAll(query) : []),
            remove: () => { for (const item of elements) item?.remove?.(); return api; },
            trigger: (type) => { for (const item of elements) item?.dispatchEvent?.(new Event(String(type).split('.')[0], { bubbles: true })); return api; },
            on: (type, delegatedOrListener, listener) => { for (const item of elements) item?.addEventListener?.(String(type).split('.')[0], listener || delegatedOrListener); return api; },
            off: () => api,
            prop: (name, value) => { if (value === undefined) return element?.[name]; for (const item of elements) item[name] = value; return api; },
            attr: (name, value) => { if (value === undefined) return element?.getAttribute?.(name); for (const item of elements) item?.setAttribute?.(name, value); return api; },
            css: (name, value) => { if (typeof name === 'object') { for (const item of elements) Object.assign(item.style, name); return api; } if (value === undefined) return element ? getComputedStyle(element).getPropertyValue(name) : ''; for (const item of elements) item.style[name] = value; return api; },
            data: (name, value) => { if (!element) return undefined; element.__nitralData ||= {}; if (value === undefined) return element.__nitralData[name]; for (const item of elements) { item.__nitralData ||= {}; item.__nitralData[name] = value; } return api; },
            closest: (query) => globalThis.$(element?.closest?.(query)),
            not: (query) => globalThis.$(elements.filter((item) => !item.matches?.(query))),
            toArray: () => elements,
            first: () => globalThis.$(elements[0]),
            filter: (callback) => globalThis.$(elements.filter((el, i) => callback.call(el, i, el))),
            end: () => api,
        };
        return api;
    };
}
function appendContent(parent, content) {
    if (!parent) return;
    if (typeof content === 'string') parent.insertAdjacentHTML('beforeend', content);
    else if (content?.nodeType) parent.appendChild(content);
    else if (content?.toArray) for (const item of content.toArray()) parent.appendChild(item);
}
function prependContent(parent, content) {
    if (!parent) return;
    if (typeof content === 'string') parent.insertAdjacentHTML('afterbegin', content);
    else if (content?.nodeType) parent.prepend(content);
    else if (content?.toArray) for (const item of content.toArray().reverse()) parent.prepend(item);
}

globalThis.__nitralEmbodyNative = true;
const nitralVrmState = globalThis.__nitralVrmRuntimeState || (globalThis.__nitralVrmRuntimeState = {
    animations_files: [],
    chatMessages: [],
    characters: [],
    callbacks: {},
    extension_settings: {
        vrm: { enabled: false, follow_camera: false, follow_cursor: false, blink: false, natural_idle: true, tts_lips_sync: false, auto_send_hitbox_message: false, hitbox_callmode_sync_delay_ms: 220, hitbox_callmode_wait_tts_start_ms: 4500, chest_jiggle_enabled: false, chest_jiggle_accelerometer: false, chest_jiggle_strength: 35, chest_jiggle_softness: 45, chest_jiggle_gravity: 20, chest_jiggle_vertical: 100, chest_jiggle_sway: 100, chest_jiggle_depth: 70, model_z_index: 4, hitboxes: false, models_cache: false, animations_cache: false, show_grid: false, light_color: '#ffffff', light_intensity: 82, light_preset: 'studio', rim_light_enabled: true, rim_light_color: '#bcd8ff', rim_light_intensity: 48, fill_light_intensity: 32, ambient_light_intensity: 36, key_light_angle: 32, lighting_contrast: 58, character_model_mapping: {}, model_settings: {} },
        expressions: { api: 0, custom: [] },
    },
});
export const getRequestHeaders = () => ({ 'Content-Type': 'application/json' });
const saveSettings = () => {};
export const saveSettingsDebounced = () => {};
const sendMessageAsUser = (message, options = {}) => {
    window.dispatchEvent(new CustomEvent('nitral-vrm-hitbox-message', { detail: { message, autoSend: options.autoSend === true, character: options.character, hitbox: options.hitbox } }));
};
export const getContext = () => ({ name2: nitralVrmState.characters[0] || '', groupId: null, characters: nitralVrmState.characters.map((name) => ({ name, avatar: `${name}.png` })), chat: nitralVrmState.chatMessages });
export const extension_settings = nitralVrmState.extension_settings;
export const getApiUrl = () => window.location.origin;
export const doExtrasFetch = (...args) => fetch(...args);
export const modules = [];
export const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const animations_files = nitralVrmState.animations_files;
const currentChatMembers = () => nitralVrmState.characters.slice();

function normalizeVrmSettingsKey(value) {
    return String(value || '').trim().toLowerCase().replaceAll('\\', '/').replace(/^\/+/, '').replace(/\.(vrm|fbx)$/i, '');
}

function resolveVrmModelSettings(modelPath) {
    const settings = extension_settings.vrm.model_settings || {};
    const direct = settings[modelPath];
    if (direct && typeof direct === 'object') return direct;

    const target = normalizeVrmSettingsKey(modelPath);
    const targetLeaf = target.split('/').pop() || target;
    const match = Object.entries(settings).find(([key]) => {
        const candidate = normalizeVrmSettingsKey(key);
        const candidateLeaf = candidate.split('/').pop() || candidate;
        return candidate === target || candidateLeaf === targetLeaf;
    });

    const resolved = match?.[1] && typeof match[1] === 'object' ? match[1] : {};
    const animationDefault = resolved.animation_default && typeof resolved.animation_default === 'object' ? resolved.animation_default : {};
    const defaultScale = /\.fbx$/i.test(modelPath) ? 1 : 3;
    return {
        scale: Number(resolved.scale ?? defaultScale) || defaultScale,
        x: Number(resolved.x ?? 0) || 0,
        y: Number(resolved.y ?? 0) || 0,
        z: Number(resolved.z ?? 0) || 0,
        rx: Number(resolved.rx ?? 0) || 0,
        ry: Number(resolved.ry ?? 0) || 0,
        rz: Number(resolved.rz ?? 0) || 0,
        ...resolved,
        animation_default: {
            expression: animationDefault.expression || 'neutral',
            motion: animationDefault.motion || '/assets/vrm/animations/neutral.bvh',
            sequence: animationDefault.sequence || '',
        },
        classify_mapping: resolved.classify_mapping && typeof resolved.classify_mapping === 'object' ? resolved.classify_mapping : {},
        hitboxes_mapping: resolved.hitboxes_mapping && typeof resolved.hitboxes_mapping === 'object' ? resolved.hitboxes_mapping : {},
        blend_shape_mapping: resolved.blend_shape_mapping && typeof resolved.blend_shape_mapping === 'object' ? resolved.blend_shape_mapping : {},
    };
}

function animationFileExists(animationPath) {
    const raw = String(animationPath || '').trim();
    if (!raw || raw === 'none') return false;
    const normalized = raw.toLowerCase().replaceAll('\\', '/').replace(/^\/+/, '').replace(/\.[^/.]+$/, '');
    const leaf = normalized.split('/').pop() || normalized;
    return animations_files.some((filePath) => {
        const candidate = String(filePath || '').trim().toLowerCase().replaceAll('\\', '/').replace(/^\/+/, '').replace(/\.[^/.]+$/, '');
        const candidateLeaf = candidate.split('/').pop() || candidate;
        return candidate === normalized || candidate.endsWith('/' + normalized) || candidateLeaf === leaf;
    });
}

function fbxResourceBase(modelPath) {
    const normalized = String(modelPath || '').replaceAll('\\', '/');
    const slash = normalized.lastIndexOf('/');
    return slash >= 0 ? normalized.slice(0, slash + 1) : '';
}

function fbxSidecarTextureUrl(url, basePath) {
    const raw = String(url || '').replaceAll('\\', '/');
    if (!raw || /^(data:|blob:|https?:\/\/)/i.test(raw)) return url;
    const base = String(basePath || '');
    const withoutQuery = raw.split(/[?#]/)[0];
    const leaf = withoutQuery.split('/').pop();
    if (!leaf) return url;
    const isImage = /\.(png|jpe?g|tga|psd|webp)$/i.test(leaf);
    if (isImage && base && raw.startsWith(base)) {
        const relative = raw.slice(base.length).replace(/^\/+/, '');
        if (relative && !relative.includes('/')) return `${base}textures/${leaf}`;
    }
    if (/^[a-z]:\//i.test(raw) || /^file:\/\//i.test(raw) || raw.includes(':/')) return `${base}textures/${leaf}`;
    return url;
}

function normalizeFbxRenderedHeight(fbxGroup, targetHeight, label) {
    fbxGroup.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(fbxGroup);
    const height = box.max.y - box.min.y;
    if (!(height > targetHeight)) return { height, scale: 1 };
    const scale = Math.max(0.0001, targetHeight / height);
    fbxGroup.scale.multiplyScalar(scale);
    fbxGroup.updateMatrixWorld(true);
    console.debug(DEBUG_PREFIX, `FBX ${label} height normalization`, { height, targetHeight, scale, resultingScale: fbxGroup.scale.x });
    return { height, scale };
}

function emitNitralVrmStatus(message, detail = {}) {
    try {
        window.dispatchEvent(new CustomEvent('nitral-vrm-status', { detail: { message, ...detail } }));
    } catch (_) {}
}

function resolveDefaultIdleMotion(modelPath) {
    const configured = resolveVrmModelSettings(modelPath).animation_default.motion;
    if (configured && configured !== 'none' && animationFileExists(configured)) {
        return configured;
    }

    const preferred = animations_files.find((filePath) => /(^|[/_\-.\s])(neutral|idle|stand|breath|breathe)(\d+)?(\.|$|[/_\-.\s])/i.test(String(filePath || '')));
    return preferred || 'none';
}

export function setNitralVrmRuntimeState(state = {}) {
    Object.assign(extension_settings.vrm, state.vrm || {});
    if (Array.isArray(state.animations)) {
        nitralVrmState.animations_files.splice(0, nitralVrmState.animations_files.length, ...state.animations);
    }
    if (Array.isArray(state.characters)) nitralVrmState.characters = state.characters;
    if (Array.isArray(state.chat)) nitralVrmState.chatMessages = state.chat;
    applyModelZIndex(extension_settings.vrm.model_z_index);
}

export function applyModelZIndex(zIndex) {
    document.documentElement.style.setProperty('--vrm-canvas-z-index', String(Number.isFinite(Number(zIndex)) ? Math.round(Number(zIndex)) : 4));
    const canvas = document.getElementById('vrm-canvas');
    if (canvas) canvas.style.zIndex = getComputedStyle(document.documentElement).getPropertyValue('--vrm-canvas-z-index') || '4';
}

import {
    MODULE_NAME,
    DEBUG_PREFIX,
    VRM_CANVAS_ID,
    FALLBACK_EXPRESSION,
    ANIMATION_FADE_TIME,
    SPRITE_DIV,
    VN_MODE_DIV,
    HITBOXES,
    HIT_BOX_DELAY
} from "./constants.js";

import {
    IDLE_MOVEMENT_CONFIGS,
    loadIdleMovementConfigs,
    getIdleAnimationClip
} from './idleAnimations.js';

const console = { ...globalThis.console, debug: () => {}, log: () => {}, info: () => {} };
const getExpressionLabel = async (text) => {
    const content = String(text || '').toLowerCase();
    if (/\b(love|happy|joy|smile|glad|delight)/.test(content)) return 'joy';
    if (/\b(angry|mad|annoyed|furious)/.test(content)) return 'anger';
    if (/\b(sad|cry|upset|grief)/.test(content)) return 'sadness';
    if (/\b(scared|afraid|fear)/.test(content)) return 'fear';
    if (/\b(surprise|shocked|wow)/.test(content)) return 'surprise';
    return 'neutral';
};

export {
    loadScene,
    loadAllModels,
    setModel,
    unloadModel,
    getVRM,
    setExpression,
    setMotion,
    setMotionSequence,
    setCursorPosition,
    setCursorTracking,
    markUserActivity,
    playAnimationSequence,
    clearAnimationSequence,
    startRealtimeLipSync,
    stopRealtimeLipSync,
    updateExpression,
    talk,
  updateModel,
  current_avatars,
  renderer,
  camera,
  VRM_CONTAINER_NAME,
  clearModelCache,
  clearAnimationCache,
  setLight,
   setBackground
  ,getModelRotationWithoutCursorOffset
  ,setPhonePropVisible
  ,syncCharacterCollisionProxies
  ,clickHitboxAt
  ,pointerDownHitboxAt
}

const VRM_CONTAINER_NAME = "VRM_CONTAINER";
const VRM_COLLIDER_NAME = "VRM_COLLIDER"
const VRM_PHONE_PROP_NAME = "VRM_PHONE_PROP";
const PHONE_PROP_FBX_PATH = '/scripts/extensions/third-party/Extension-Embody/vrm/objects/phone.fbx';
const PHONE_PROP_TARGET_MAX_DIM = 0.16;
const PHONE_RIGHT_LOCAL_ROTATION = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.98, 1.58, 0.22));
const PHONE_RIGHT_LOCAL_OFFSET = new THREE.Vector3(0.048, 0.018, 0.014);
const PHONE_LEFT_LOCAL_ROTATION_DEFAULT = { x: -0.41, y: -0.28, z: 1.24 };
const PHONE_LEFT_LOCAL_OFFSET_DEFAULT = { x: -0.073, y: -0.035, z: -0.006 };
const phoneTmpWorldPos = new THREE.Vector3();
const phoneTmpWorldQuat = new THREE.Quaternion();
const phoneTmpOffset = new THREE.Vector3();
const phoneTmpLocalOffset = new THREE.Vector3();
const phoneTmpLocalQuat = new THREE.Quaternion();
const phoneTmpLocalEuler = new THREE.Euler();
const phonePropBBox = new THREE.Box3();
const phonePropBBoxSize = new THREE.Vector3();

let phonePropTemplate = null;
let phonePropTemplatePromise = null;

function decoratePhonePropObject(object, baseScale = 1, fromTemplate = false) {
    object.name = VRM_PHONE_PROP_NAME;
    object.visible = false;
    object.userData.phoneBaseScale = baseScale;
    object.userData.phoneFromTemplate = fromTemplate;
    object.traverse((node) => {
        if (!node?.isMesh) {
            return;
        }
        node.castShadow = false;
        node.receiveShadow = false;
    });
    return object;
}

function clonePhonePropFromTemplate() {
    if (!phonePropTemplate) {
        return null;
    }
    const clone = phonePropTemplate.clone(true);
    const baseScale = Number(phonePropTemplate.userData?.phoneBaseScale);
    return decoratePhonePropObject(clone, Number.isFinite(baseScale) ? baseScale : 1, true);
}

async function ensurePhonePropTemplateLoaded() {
    if (phonePropTemplate) {
        return phonePropTemplate;
    }
    if (phonePropTemplatePromise) {
        return phonePropTemplatePromise;
    }

    const loader = new FBXLoader();
    phonePropTemplatePromise = loader.loadAsync(PHONE_PROP_FBX_PATH)
        .then((object) => {
            phonePropBBox.setFromObject(object);
            phonePropBBox.getSize(phonePropBBoxSize);
            const maxDim = Math.max(phonePropBBoxSize.x, phonePropBBoxSize.y, phonePropBBoxSize.z);
            const baseScale = maxDim > 0 ? PHONE_PROP_TARGET_MAX_DIM / maxDim : 1;
            phonePropTemplate = decoratePhonePropObject(object, baseScale, true);
            return phonePropTemplate;
        })
        .catch((error) => {
            throw error;
        })
        .finally(() => {
            phonePropTemplatePromise = null;
        });

    return phonePropTemplatePromise;
}

function disposePhonePropObject(object) {
    if (!object) {
        return;
    }
    object.traverse((node) => {
        if (!node?.isMesh) {
            return;
        }
        node.geometry?.dispose?.();
        if (Array.isArray(node.material)) {
            for (const material of node.material) {
                material?.dispose?.();
            }
        } else {
            node.material?.dispose?.();
        }
    });
}

function upgradeAvatarPhonePropIfTemplateReady(character) {
    const avatar = current_avatars[character];
    if (!avatar || !phonePropTemplate) {
        return;
    }

    const currentProp = avatar.phoneProp;
    if (currentProp?.userData?.phoneFromTemplate) {
        return;
    }

    const replacement = clonePhonePropFromTemplate();
    if (!replacement) {
        return;
    }

    replacement.visible = !!currentProp?.visible;
    if (scene) {
        scene.add(replacement);
    }
    avatar.phoneProp = replacement;

    if (currentProp) {
        if (currentProp.parent) {
            currentProp.parent.remove(currentProp);
        }
        disposePhonePropObject(currentProp);
    }

    updatePhonePropTransform(character);
}

function getHumanoidBoneNode(vrm, boneName) {
    return vrm?.humanoid?.getNormalizedBoneNode?.(boneName)
        || vrm?.humanoid?.getRawBoneNode?.(boneName)
        || null;
}

function getVrmMetaVersion(vrm) {
    const raw = String(vrm?.meta?.metaVersion ?? '').trim();
    if (raw.startsWith('1')) return '1';
    if (raw.startsWith('0')) return '0';
    return raw || 'unknown';
}

function isVrm0(vrm) {
    return getVrmMetaVersion(vrm) === '0';
}

function applyLegacyVrm0ArmRestPose(vrm) {
    if (!isVrm0(vrm)) return;
    const armRestZ = THREE.MathUtils.degToRad(25);
    const rightUpperArm = getHumanoidBoneNode(vrm, "rightUpperArm");
    const rightLowerArm = getHumanoidBoneNode(vrm, "rightLowerArm");
    const leftUpperArm = getHumanoidBoneNode(vrm, "leftUpperArm");
    const leftLowerArm = getHumanoidBoneNode(vrm, "leftLowerArm");
    if (rightUpperArm) rightUpperArm.rotation.z = -armRestZ;
    if (rightLowerArm) rightLowerArm.rotation.z = 0.2;
    if (leftUpperArm) leftUpperArm.rotation.z = armRestZ;
    if (leftLowerArm) leftLowerArm.rotation.z = -0.2;
}

function applyFbxNeutralRestPose(vrm) {
    if (vrm?.meta?.metaVersion !== 'fbx') return;
    const leftUpperArm = getHumanoidBoneNode(vrm, "leftUpperArm");
    const rightUpperArm = getHumanoidBoneNode(vrm, "rightUpperArm");
    const leftLowerArm = getHumanoidBoneNode(vrm, "leftLowerArm");
    const rightLowerArm = getHumanoidBoneNode(vrm, "rightLowerArm");
    const leftHand = getHumanoidBoneNode(vrm, "leftHand");
    const rightHand = getHumanoidBoneNode(vrm, "rightHand");

    const upperArmOpen = THREE.MathUtils.degToRad(7);
    const upperArmForward = THREE.MathUtils.degToRad(2);
    const lowerArmBend = THREE.MathUtils.degToRad(6);
    const handRelax = THREE.MathUtils.degToRad(5);

    if (leftUpperArm) leftUpperArm.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(upperArmForward, 0, upperArmOpen)));
    if (rightUpperArm) rightUpperArm.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(upperArmForward, 0, -upperArmOpen)));
    if (leftLowerArm) leftLowerArm.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -lowerArmBend)));
    if (rightLowerArm) rightLowerArm.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, lowerArmBend)));
    if (leftHand) leftHand.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(handRelax, 0, 0)));
    if (rightHand) rightHand.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(handRelax, 0, 0)));
}

const CACHED_BONE_NAMES = [
    'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
    'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm',
    'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand',
];

function buildAvatarBoneCache(vrm) {
    const bones = {};
    for (const boneName of CACHED_BONE_NAMES) {
        bones[boneName] = getHumanoidBoneNode(vrm, boneName);
    }
    return bones;
}

function buildAvatarExpressionCache(vrm) {
    const expressionMap = vrm?.expressionManager?.expressionMap || {};
    const names = Object.keys(expressionMap);
    return {
        names,
        visemes: names.filter(name => VRM_VISEME_SET.has(name)),
        nonVisemes: names.filter(name => !VRM_VISEME_SET.has(name)),
    };
}

function getCachedBone(avatar, boneName) {
    if (!avatar) return null;
    if (!avatar.bones) {
        avatar.bones = buildAvatarBoneCache(avatar.vrm);
    }
    if (avatar.bones[boneName] === undefined) {
        avatar.bones[boneName] = getHumanoidBoneNode(avatar.vrm, boneName);
    }
    return avatar.bones[boneName] || null;
}

function getCachedTorsoControlBone(avatar) {
    return getCachedBone(avatar, "upperChest") || getCachedBone(avatar, "chest") || getCachedBone(avatar, "spine");
}

const CHEST_JIGGLE_BONE_PATTERN = /(breast|bust|boob|oppai|mune|nyu|chichi|chestsoft|softbody|jiggle|乳|胸)/i;
const CHEST_JIGGLE_EXCLUDE_PATTERN = /(hair|head|neck|face|eye|ear|skirt|cloth|sleeve|arm|hand|leg|knee|foot|tail|ribbon|accessory|acc|cape|coat)/i;
const CHEST_JIGGLE_LEFT_PATTERN = /(^|[_\-.\s])(l|left|左)([_\-.\s]|$)|(_l|\.l|left|左)/i;
const CHEST_JIGGLE_RIGHT_PATTERN = /(^|[_\-.\s])(r|right|右)([_\-.\s]|$)|(_r|\.r|right|右)/i;
const CHEST_JIGGLE_MAX_BONES = 8;
const CHEST_JIGGLE_TMP_WORLD = new THREE.Vector3();
const CHEST_JIGGLE_TMP_DELTA = new THREE.Vector3();
const CHEST_JIGGLE_TMP_INV_QUAT = new THREE.Quaternion();
const CHEST_JIGGLE_TMP_QUAT = new THREE.Quaternion();
const CHEST_JIGGLE_TMP_EULER = new THREE.Euler();
const CHEST_JIGGLE_TMP_POS = new THREE.Vector3();
const CHEST_JIGGLE_TMP_CHEST_POS = new THREE.Vector3();
const CHEST_JIGGLE_TMP_MAT = new THREE.Matrix4();
const CHEST_JIGGLE_MOTION = { active: false, x: 0, y: 0, z: 0, smoothX: 0, smoothY: 0, smoothZ: 0, impulseX: 0, impulseY: 0, impulseZ: 0, lastAt: 0 };

function onChestJiggleDeviceMotion(event) {
    const source = event.accelerationIncludingGravity || event.acceleration;
    if (!source) return;
    const x = Number(source.x) || 0;
    const y = Number(source.y) || 0;
    const z = Number(source.z) || 0;
    CHEST_JIGGLE_MOTION.smoothX = CHEST_JIGGLE_MOTION.smoothX * 0.88 + x * 0.12;
    CHEST_JIGGLE_MOTION.smoothY = CHEST_JIGGLE_MOTION.smoothY * 0.88 + y * 0.12;
    CHEST_JIGGLE_MOTION.smoothZ = CHEST_JIGGLE_MOTION.smoothZ * 0.88 + z * 0.12;
    CHEST_JIGGLE_MOTION.impulseX = x - CHEST_JIGGLE_MOTION.smoothX;
    CHEST_JIGGLE_MOTION.impulseY = y - CHEST_JIGGLE_MOTION.smoothY;
    CHEST_JIGGLE_MOTION.impulseZ = z - CHEST_JIGGLE_MOTION.smoothZ;
    CHEST_JIGGLE_MOTION.lastAt = performance.now();
}

function syncChestJiggleDeviceMotion() {
    const enabled = extension_settings.vrm?.chest_jiggle_enabled === true && extension_settings.vrm?.chest_jiggle_accelerometer === true;
    if (enabled === CHEST_JIGGLE_MOTION.active) return;
    CHEST_JIGGLE_MOTION.active = enabled;
    if (enabled) {
        window.addEventListener('devicemotion', onChestJiggleDeviceMotion, { passive: true });
    } else {
        window.removeEventListener('devicemotion', onChestJiggleDeviceMotion);
        CHEST_JIGGLE_MOTION.x = CHEST_JIGGLE_MOTION.y = CHEST_JIGGLE_MOTION.z = 0;
        CHEST_JIGGLE_MOTION.smoothX = CHEST_JIGGLE_MOTION.smoothY = CHEST_JIGGLE_MOTION.smoothZ = 0;
        CHEST_JIGGLE_MOTION.impulseX = CHEST_JIGGLE_MOTION.impulseY = CHEST_JIGGLE_MOTION.impulseZ = 0;
        CHEST_JIGGLE_MOTION.lastAt = 0;
    }
}

function getChestJiggleDeviceMotionForce() {
    syncChestJiggleDeviceMotion();
    if (!CHEST_JIGGLE_MOTION.active || performance.now() - CHEST_JIGGLE_MOTION.lastAt > 350) return { x: 0, y: 0, z: 0 };
    const scale = 0.0032;
    return {
        x: Math.max(-0.035, Math.min(0.035, CHEST_JIGGLE_MOTION.impulseX * scale)),
        y: Math.max(-0.035, Math.min(0.035, CHEST_JIGGLE_MOTION.impulseY * scale)),
        z: Math.max(-0.035, Math.min(0.035, CHEST_JIGGLE_MOTION.impulseZ * scale)),
    };
}

function getChestJiggleStrength() {
    const raw = Number(extension_settings.vrm?.chest_jiggle_strength ?? 35);
    return Math.max(0, Math.min(500, Number.isFinite(raw) ? raw : 35)) / 100;
}

function getChestJigglePercent(key, fallback, max = 100) {
    const raw = Number(extension_settings.vrm?.[key] ?? fallback);
    return Math.max(0, Math.min(max, Number.isFinite(raw) ? raw : fallback)) / 100;
}

function getChestJiggleConfig() {
    const softness = getChestJigglePercent('chest_jiggle_softness', 45);
    return {
        gain: 0.78 + softness * 0.72,
        stiffness: Math.max(8, 30 * (1.25 - softness * 0.72)),
        damping: Math.max(0.16, 0.8 * (1.2 - softness * 0.68)),
        maxAngle: THREE.MathUtils.degToRad(7 * (0.85 + softness * 0.55)),
        gravity: getChestJigglePercent('chest_jiggle_gravity', 20),
        vertical: getChestJigglePercent('chest_jiggle_vertical', 100, 250),
        sway: getChestJigglePercent('chest_jiggle_sway', 100, 250),
        depth: getChestJigglePercent('chest_jiggle_depth', 70, 250),
    };
}

function isChestJiggleEnabled() {
    return extension_settings.vrm?.chest_jiggle_enabled === true && getChestJiggleStrength() > 0;
}

function detectChestJiggleBones(vrm) {
    const chest = getHumanoidBoneNode(vrm, 'upperChest') || getHumanoidBoneNode(vrm, 'chest') || getHumanoidBoneNode(vrm, 'spine');
    const matches = [];
    const seen = new Set();
    const isDescendantOf = (node, ancestor) => {
        let current = node;
        while (current) {
            if (current === ancestor) return true;
            current = current.parent;
        }
        return false;
    };

    const addMatch = (bone, driver, side = 0, source = 'named', mode = 'bone') => {
        if (!bone || seen.has(bone)) return;
        seen.add(bone);
        matches.push({
            bone,
            driver: driver || bone.parent || bone,
            side,
            source,
            mode,
            applied: new THREE.Quaternion(),
            lastDriverPosition: new THREE.Vector3(),
            lastDriverQuaternion: new THREE.Quaternion(),
            hasDriverTransform: false,
            lastMovementX: 0,
            lastMovementY: 0,
            lastAngularX: 0,
            lastAngularY: 0,
            lastAngularZ: 0,
            posX: 0,
            posZ: 0,
            velX: 0,
            velZ: 0,
        });
    };

    const sideForBone = (bone, name) => {
        if (CHEST_JIGGLE_LEFT_PATTERN.test(name)) return -1;
        if (CHEST_JIGGLE_RIGHT_PATTERN.test(name)) return 1;
        if (chest) {
            chest.getWorldPosition(CHEST_JIGGLE_TMP_CHEST_POS);
            bone.getWorldPosition(CHEST_JIGGLE_TMP_POS);
            const dx = CHEST_JIGGLE_TMP_POS.x - CHEST_JIGGLE_TMP_CHEST_POS.x;
            if (Math.abs(dx) > 0.01) return dx < 0 ? -1 : 1;
        }
        return bone.position.x < 0 ? -1 : bone.position.x > 0 ? 1 : 0;
    };

    const collect = (requireChestDescendant) => vrm?.scene?.traverse?.((obj) => {
        if (!obj?.isBone || !obj?.name || seen.has(obj)) return;
        const name = String(obj.name || '');
        if (!CHEST_JIGGLE_BONE_PATTERN.test(name)) return;
        if (requireChestDescendant && chest && !isDescendantOf(obj, chest) && obj !== chest) return;
        addMatch(obj, obj.parent || obj, sideForBone(obj, name), 'named');
    });

    collect(true);
    if (matches.length === 0) {
        collect(false);
    }

    matches.sort((a, b) => {
        const sideScore = Math.abs(b.side) - Math.abs(a.side);
        if (sideScore !== 0) return sideScore;
        return String(a.bone.name).length - String(b.bone.name).length;
    });

    return { anchor: chest, bones: matches.slice(0, CHEST_JIGGLE_MAX_BONES) };
}

function getChestJiggleState(avatar) {
    if (!avatar) return null;
    if (!avatar.chestJiggleState || avatar.chestJiggleState.vrm !== avatar.vrm) {
        const detected = detectChestJiggleBones(avatar.vrm);
        const manager = avatar.vrm?.springBoneManager;
        if (manager?.joints) {
            const jiggleBoneSet = new Set(detected.bones.map((item) => item?.bone).filter(Boolean));
            for (const joint of manager.joints) {
                let found = false;
                for (const jiggleBone of jiggleBoneSet) {
                    let current = jiggleBone;
                    while (current) {
                        if (current === joint.bone) { found = true; break; }
                        current = current.parent;
                    }
                    if (found) break;
                }
                if (found) {
                    joint.settings.dragForce = 0.4;
                    joint.settings.stiffness = 1.0;
                }
            }
        }

        avatar.chestJiggleState = {
            vrm: avatar.vrm,
            anchor: detected.anchor,
            bones: detected.bones,
            lastAnchorPosition: new THREE.Vector3(),
            lastAnchorQuaternion: new THREE.Quaternion(),
            hasAnchorPosition: false,
        };
        console.debug(DEBUG_PREFIX, 'Chest jiggle detected bones:', detected.bones.map((item) => `${item.bone?.name || '(unnamed)'}:${item.source || 'unknown'}`).filter(Boolean));
    }
    return avatar.chestJiggleState;
}

function clearChestJiggle(avatar) {
    const state = avatar?.chestJiggleState;
    if (!state?.bones) return;
    for (const item of state.bones) {
        if (item.applied && item.applied.angleTo(IDENTITY_QUATERNION) > 0.0001) {
            item.bone.quaternion.multiply(CHEST_JIGGLE_TMP_INV_QUAT.copy(item.applied).invert());
            item.applied.identity();
        }
        item.posX = 0;
        item.posZ = 0;
        item.velX = 0;
        item.velZ = 0;
        item.hasDriverTransform = false;
        item.lastMovementX = 0;
        item.lastMovementY = 0;
        item.lastAngularX = 0;
        item.lastAngularY = 0;
        item.lastAngularZ = 0;
    }
    state.hasAnchorPosition = false;
}

function removeAppliedChestJigglePose(avatar) {
    const state = avatar?.chestJiggleState;
    if (!state?.bones) return;
    for (const item of state.bones) {
        if (item.applied && item.applied.angleTo(IDENTITY_QUATERNION) > 0.0001) {
            item.bone.quaternion.multiply(CHEST_JIGGLE_TMP_INV_QUAT.copy(item.applied).invert());
            item.applied.identity();
        }
    }
}

function applyChestJiggle(avatar, character, deltaTime, poseAlreadyCleared = false) {
    if (!isChestJiggleEnabled()) {
        syncChestJiggleDeviceMotion();
        clearChestJiggle(avatar);
        return;
    }

    const state = getChestJiggleState(avatar);
    if (!state?.bones.length) return;

    const dt = Math.max(1 / 120, Math.min(1 / 20, Number(deltaTime) || 1 / 60));
    const strength = getChestJiggleStrength();
    const config = getChestJiggleConfig();
    const time = performance.now() / 1000;
    const breath = Math.sin(time * 1.65) * 0.0025 * strength * config.vertical;
    const gravityDrop = config.gravity * 0.035 * strength;
    const jiggleGain = 6.5 * config.gain;
    const stiffness = config.stiffness;
    const damping = config.damping;
    const maxAngle = config.maxAngle * strength;
    const deviceMotion = getChestJiggleDeviceMotionForce();
    if (!poseAlreadyCleared) {
        removeAppliedChestJigglePose(avatar);
    }

    avatar.objectContainer?.updateMatrixWorld?.(true);

    for (const item of state.bones) {
        let tracked = item.driver || item.bone.parent || item.bone;
        tracked.getWorldPosition(CHEST_JIGGLE_TMP_WORLD);
        tracked.getWorldQuaternion(CHEST_JIGGLE_TMP_QUAT);

        if (!item.hasDriverTransform) {
            item.lastDriverPosition.copy(CHEST_JIGGLE_TMP_WORLD);
            item.lastDriverQuaternion.copy(CHEST_JIGGLE_TMP_QUAT);
            item.hasDriverTransform = true;
            continue;
        }

        CHEST_JIGGLE_TMP_DELTA.copy(CHEST_JIGGLE_TMP_WORLD).sub(item.lastDriverPosition);
        item.lastDriverPosition.copy(CHEST_JIGGLE_TMP_WORLD);
        CHEST_JIGGLE_TMP_INV_QUAT.copy(item.lastDriverQuaternion).invert().multiply(CHEST_JIGGLE_TMP_QUAT);
        CHEST_JIGGLE_TMP_EULER.setFromQuaternion(CHEST_JIGGLE_TMP_INV_QUAT, 'XYZ');
        item.lastDriverQuaternion.copy(CHEST_JIGGLE_TMP_QUAT);

        const rawMovementX = CHEST_JIGGLE_TMP_DELTA.x;
        const rawMovementY = CHEST_JIGGLE_TMP_DELTA.y;
        const rawAngularX = CHEST_JIGGLE_TMP_EULER.x;
        const rawAngularY = CHEST_JIGGLE_TMP_EULER.y;
        const rawAngularZ = CHEST_JIGGLE_TMP_EULER.z;
        const accelX = rawMovementX - item.lastMovementX;
        const accelY = rawMovementY - item.lastMovementY;
        const angularAccelX = rawAngularX - item.lastAngularX;
        const angularAccelY = rawAngularY - item.lastAngularY;
        const angularAccelZ = rawAngularZ - item.lastAngularZ;
        item.lastMovementX = rawMovementX;
        item.lastMovementY = rawMovementY;
        item.lastAngularX = rawAngularX;
        item.lastAngularY = rawAngularY;
        item.lastAngularZ = rawAngularZ;

        const movementX = Math.max(-0.08, Math.min(0.08, ((rawMovementX + accelX * 2.2) * jiggleGain + deviceMotion.x) * config.sway));
        const movementY = Math.max(-0.08, Math.min(0.08, ((rawMovementY + accelY * 2.2) * jiggleGain + deviceMotion.y) * config.vertical));
        const angularX = Math.max(-0.055, Math.min(0.055, (rawAngularX + angularAccelX * 2.4) * jiggleGain));
        const angularY = Math.max(-0.085, Math.min(0.085, ((rawAngularY + angularAccelY * 2.4) * jiggleGain + deviceMotion.z) * config.depth));
        const angularZ = Math.max(-0.085, Math.min(0.085, (rawAngularZ + angularAccelZ * 2.4) * jiggleGain * config.sway));

        const side = item.side || (item.bone.position.x < 0 ? -1 : item.bone.position.x > 0 ? 1 : 0);
        const sideAxisSign = 1;
        const targetX = Math.max(-maxAngle, Math.min(maxAngle, (((-movementY * 1.1) + (-angularX * 0.42)) * strength + breath + gravityDrop)));
        const targetZ = Math.max(-maxAngle, Math.min(maxAngle, ((-movementX * 1.7) + (-angularY * 0.36) + (-angularZ * 0.28)) * strength * sideAxisSign));

        item.velX += (targetX - item.posX) * stiffness * dt;
        item.velZ += (targetZ - item.posZ) * stiffness * dt;
        item.velX *= Math.max(0, 1 - damping * dt);
        item.velZ *= Math.max(0, 1 - damping * dt);
        item.posX = Math.max(-maxAngle, Math.min(maxAngle, item.posX + item.velX * dt));
        item.posZ = Math.max(-maxAngle, Math.min(maxAngle, item.posZ + item.velZ * dt));

        item.applied.setFromEuler(CHEST_JIGGLE_TMP_EULER.set(-item.posX, -item.posZ, 0, 'XYZ'));
        item.bone.quaternion.multiply(item.applied);
        item.bone.updateMatrix?.();
        item.bone.updateMatrixWorld?.(true);
    }
}

function buildProceduralRigCalibration(vrm, hipsHeight = 1) {
    const leftShoulder = getHumanoidBoneNode(vrm, 'leftShoulder');
    const rightShoulder = getHumanoidBoneNode(vrm, 'rightShoulder');
    const leftUpperArm = getHumanoidBoneNode(vrm, 'leftUpperArm');
    const rightUpperArm = getHumanoidBoneNode(vrm, 'rightUpperArm');

    const shoulderSpan = (leftShoulder && rightShoulder)
        ? leftShoulder.getWorldPosition(new THREE.Vector3()).distanceTo(rightShoulder.getWorldPosition(new THREE.Vector3()))
        : 0.36;

    const leftArmLen = (leftUpperArm && leftUpperArm.children?.[0])
        ? leftUpperArm.getWorldPosition(new THREE.Vector3()).distanceTo(leftUpperArm.children[0].getWorldPosition(new THREE.Vector3()))
        : 0.28;
    const rightArmLen = (rightUpperArm && rightUpperArm.children?.[0])
        ? rightUpperArm.getWorldPosition(new THREE.Vector3()).distanceTo(rightUpperArm.children[0].getWorldPosition(new THREE.Vector3()))
        : 0.28;

    const meanArmLen = Math.max(0.18, (leftArmLen + rightArmLen) * 0.5);
    const scaleFromHips = Math.max(0.8, Math.min(1.25, (Number(hipsHeight) || 1) / 0.95));
    const shoulderScale = Math.max(0.88, Math.min(1.24, shoulderSpan / 0.36));
    const armLiftScale = Math.max(0.84, Math.min(1.28, (meanArmLen / 0.28) * 0.95 + (shoulderScale * 0.05)));

    return {
        bodyScale: Math.max(0.9, Math.min(1.2, scaleFromHips)),
        shoulderScale,
        armLiftScale,
        shoulderMobility: Math.max(0.85, Math.min(1.25, shoulderScale * 0.98 + armLiftScale * 0.06)),
        cursorBodyScale: Math.max(0.88, Math.min(1.16, scaleFromHips * 0.96 + shoulderScale * 0.04)),
    };
}

function applySpringBoneAntiClipPatch(vrm, hipsHeight = 1) {
    if (!vrm) {
        return;
    }

    const vrmUserData = vrm.userData || (vrm.userData = {});
    const manager = vrm?.springBoneManager;
    if (!manager || !manager.joints || manager.joints.size === 0) {
        return;
    }

    const patchVersion = 3;
    if (vrmUserData.stvSpringPatchApplied && vrmUserData.stvSpringPatchVersion === patchVersion) {
        return;
    }

    const removeExistingAutoColliders = () => {
        const autoPrefix = 'stv_auto_collider_';
        for (const joint of manager.joints) {
            if (!Array.isArray(joint?.colliderGroups)) {
                continue;
            }
            for (const group of joint.colliderGroups) {
                if (!Array.isArray(group?.colliders)) {
                    continue;
                }
                group.colliders = group.colliders.filter((collider) => {
                    const isAuto = String(collider?.name || '').startsWith(autoPrefix);
                    if (isAuto && collider.parent) {
                        collider.parent.remove(collider);
                    }
                    return !isAuto;
                });
            }
            joint.colliderGroups = joint.colliderGroups.filter((group) => Array.isArray(group?.colliders) && group.colliders.length > 0);
        }
    };

    removeExistingAutoColliders();

    const scale = Math.max(0.72, Math.min(1.45, Number(hipsHeight) || 1));
    const colliders = [];

    const addBodySphereCollider = (boneName, offset, radius) => {
        const bone = getHumanoidBoneNode(vrm, boneName);
        if (!bone) return;

        const shape = new VRMSpringBoneColliderShapeSphere({
            offset: new THREE.Vector3(offset[0], offset[1], offset[2]),
            radius: radius * scale,
        });
        const collider = new VRMSpringBoneCollider(shape);
        collider.name = `stv_auto_collider_${boneName}`;
        bone.add(collider);
        collider.updateWorldMatrix(true, false);
        colliders.push(collider);
    };

    addBodySphereCollider('head', [0.0, 0.015, 0.02], 0.1);
    addBodySphereCollider('neck', [0.0, 0.012, 0.02], 0.08);
    addBodySphereCollider('upperChest', [0.0, 0.01, 0.03], 0.09);

    if (colliders.length === 0) {
        vrmUserData.stvSpringPatchApplied = true;
        return;
    }

    const autoColliderGroup = {
        name: 'stv_auto_anticlip_body',
        colliders,
    };

    const dynamicNamePattern = /(hair|bang|ahoge|ponytail|twintail|braid|sidehair|fringe|earring|ribbon|accessor|antenna|tail|curl|strand)/i;
    const chestDynamicExcludePattern = /(breast|bust|boob|oppai|mune|chest)/i;
    const head = getHumanoidBoneNode(vrm, 'head');
    const neck = getHumanoidBoneNode(vrm, 'neck');

    const isDescendantOf = (node, ancestor) => {
        let current = node;
        while (current) {
            if (current === ancestor) return true;
            current = current.parent;
        }
        return false;
    };

    for (const joint of manager.joints) {
        const bone = joint?.bone;
        const boneName = String(bone?.name || '');
        const excludedDynamic = chestDynamicExcludePattern.test(boneName);
        const likelyHeadAttachment = dynamicNamePattern.test(boneName);
        const attachedToHead = !!bone && ((head && isDescendantOf(bone, head)) || (neck && isDescendantOf(bone, neck)));

        const shouldAttachColliderGroup = !excludedDynamic && (likelyHeadAttachment || attachedToHead);

        if (!shouldAttachColliderGroup) {
            continue;
        }

        if (!Array.isArray(joint.colliderGroups)) {
            joint.colliderGroups = [];
        }
        if (!joint.colliderGroups.includes(autoColliderGroup)) {
            joint.colliderGroups.push(autoColliderGroup);
        }

        const settings = joint.settings || {};
        settings.hitRadius = Math.max(0.014 * scale, Number(settings.hitRadius) || 0);
        joint.settings = settings;
    }

    manager.setInitState();
    manager.reset();
    vrmUserData.stvSpringPatchApplied = true;
    vrmUserData.stvSpringPatchVersion = patchVersion;
}

function getPreferredPhoneHandBone(vrm, preferredSide = "auto") {
    const side = String(preferredSide || "auto").toLowerCase();
    const preferLeft = side === "left";

    const primaryHumanoidBones = preferLeft
        ? ["leftHand", "leftLowerArm", "leftUpperArm"]
        : ["rightHand", "rightLowerArm", "rightUpperArm"];

    const secondaryHumanoidBones = preferLeft
        ? ["rightHand", "rightLowerArm", "rightUpperArm"]
        : ["leftHand", "leftLowerArm", "leftUpperArm"];

    const humanoidFallback = primaryHumanoidBones
        .map((boneName) => getHumanoidBoneNode(vrm, boneName))
        .find(Boolean)
        || secondaryHumanoidBones
            .map((boneName) => getHumanoidBoneNode(vrm, boneName))
            .find(Boolean)
        || getHumanoidBoneNode(vrm, "chest")
        || getHumanoidBoneNode(vrm, "spine");

    if (humanoidFallback) {
        return humanoidFallback;
    }

    // Last resort for rigs where humanoid mapping is incomplete.
    let best = null;
    let secondaryBest = null;
    vrm?.scene?.traverse?.((obj) => {
        if ((!obj?.isBone || !obj?.name) || (best && secondaryBest)) {
            return;
        }
        const name = String(obj.name).toLowerCase();
        const isRight = name.includes('r_hand') || name.includes('rhand') || name.includes('right_hand') || name.includes('hand_r') || name.includes('wrist_r');
        const isLeft = name.includes('l_hand') || name.includes('lhand') || name.includes('left_hand') || name.includes('hand_l') || name.includes('wrist_l');

        if (preferLeft && isLeft) {
            best = obj;
            return;
        }
        if (!preferLeft && isRight) {
            best = obj;
            return;
        }

        if (!secondaryBest && (isRight || isLeft || name.includes('hand') || name.includes('wrist'))) {
            secondaryBest = obj;
        }
    });
    return best || secondaryBest;
}

function attachPhonePropToAvatar(character, options = {}) {
    const avatar = current_avatars[character];
    const vrm = avatar?.vrm;
    if (!avatar || !vrm) {
        return null;
    }

    const requestedSide = String(options?.handPreference || avatar.phonePropSide || "right").toLowerCase();
    const normalizedRequestedSide = requestedSide === "left" ? "left" : "right";
    if (avatar.phonePropSide !== normalizedRequestedSide) {
        avatar.phonePropBone = null;
    }
    avatar.phonePropSide = normalizedRequestedSide;

    const handBone = avatar.phonePropBone || getPreferredPhoneHandBone(vrm, normalizedRequestedSide);
    if (!handBone) {
        return null;
    }
    avatar.phonePropBone = handBone;

    if (avatar.phoneProp && !avatar.phoneProp.userData?.phoneFromTemplate && phonePropTemplate) {
        upgradeAvatarPhonePropIfTemplateReady(character);
    }

    const phoneProp = avatar.phoneProp || clonePhonePropFromTemplate();
    if (!phoneProp) {
        return null;
    }
    avatar.phoneProp = phoneProp;

    if (!phoneProp.userData?.phoneFromTemplate) {
        ensurePhonePropTemplateLoaded().then(() => {
            upgradeAvatarPhonePropIfTemplateReady(character);
        });
    }

    if (scene && phoneProp.parent !== scene) {
        scene.add(phoneProp);
    }

    return phoneProp;
}

function updatePhonePropTransform(character) {
    const avatar = current_avatars[character];
    const phoneProp = avatar?.phoneProp;
    const vrm = avatar?.vrm;
    if (!avatar || !phoneProp || !phoneProp.visible || !vrm) {
        return;
    }

    const side = avatar.phonePropSide === "left" ? "left" : "right";
    const localOffset = phoneTmpLocalOffset;
    let localRotation = PHONE_RIGHT_LOCAL_ROTATION;

    if (side === "left") {
        phoneTmpLocalEuler.set(
            PHONE_LEFT_LOCAL_ROTATION_DEFAULT.x,
            PHONE_LEFT_LOCAL_ROTATION_DEFAULT.y,
            PHONE_LEFT_LOCAL_ROTATION_DEFAULT.z
        );
        phoneTmpLocalQuat.setFromEuler(phoneTmpLocalEuler);
        localRotation = phoneTmpLocalQuat;

        localOffset.set(
            PHONE_LEFT_LOCAL_OFFSET_DEFAULT.x,
            PHONE_LEFT_LOCAL_OFFSET_DEFAULT.y,
            PHONE_LEFT_LOCAL_OFFSET_DEFAULT.z
        );
    } else {
        localOffset.copy(PHONE_RIGHT_LOCAL_OFFSET);
    }

    let handBone = avatar.phonePropBone;
    if (!handBone || !handBone.parent) {
        handBone = getPreferredPhoneHandBone(vrm, side);
        avatar.phonePropBone = handBone;
    }
    if (!handBone) {
        return;
    }

    handBone.getWorldPosition(phoneTmpWorldPos);
    handBone.getWorldQuaternion(phoneTmpWorldQuat);

    const modelScale = Math.max(0.5, Number(avatar?.objectContainer?.scale?.x) || 1);
    const baseScale = Number(phoneProp.userData?.phoneBaseScale);
    const safeBaseScale = Number.isFinite(baseScale) ? baseScale : 1;
    phoneTmpOffset.copy(localOffset).multiplyScalar(modelScale).applyQuaternion(phoneTmpWorldQuat);

    phoneProp.position.copy(phoneTmpWorldPos).add(phoneTmpOffset);
    phoneProp.quaternion.copy(phoneTmpWorldQuat).multiply(localRotation);
    phoneProp.scale.setScalar(modelScale * safeBaseScale);
}

function setPhonePropVisible(character, visible = true, options = {}) {
    const avatar = current_avatars[character];
    if (!avatar) {
        return false;
    }

    if (!visible) {
        if (avatar.phoneProp) {
            avatar.phoneProp.visible = false;
        }
        return true;
    }

    const phoneProp = attachPhonePropToAvatar(character, options);
    if (!phoneProp) {
        return false;
    }

    phoneProp.visible = true;
    updatePhonePropTransform(character);
    return true;
}

// Avatars
let current_avatars = {} // contain loaded avatar variables

// Caches
let models_cache = {};
let animations_cache = {};
// 3D Scene
let renderer = undefined;
let scene = undefined;
let camera = undefined;
let light = undefined;
let fillLight = undefined;
let rimLight = undefined;
let ambientLight = undefined;

// gltf and vrm
let currentInstanceId = 0;
let modelId = 0;
let clock = undefined;
const lookAtTarget = new THREE.Object3D();
const IDLE_ANIMS = ["idle", "breathe", "nod", "shrug", "think", "relax", "glance"];

// VRMA idle animation files cache
let vrmaIdleFiles = [];
let vrmaIdleCache = {}; // Cache loaded VRMA clips

const naturalIdleTimers = {};
const proceduralState = {};
const activeIdleAnimations = {}; // Track active procedural idle animations
const nextIdleEligibleTime = {};
const proceduralBoneBasePoses = {};
const idlePoseBlendJobs = {};

// Store base bone poses to restore after VRMA animations
const vrmaBoneBasePoses = {};

// Store base Y position to restore after VRMA animations (prevents height drop)
const vrmaBaseYPosition = {};

// Track last idle animation completion time for cooldown
const lastIdleCompletionTime = {};

const inactivityState = {
  lastActiveAt: Date.now(),
  intensity: 0,
  suppressUntil: 0,
  lastCursorX: window.innerWidth / 2,
  lastCursorY: window.innerHeight / 2,
  lastCursorActivityAt: 0
};
let lastSpeechActivityPingAt = 0;

let cursorTrackingEnabled = false;
let lastAppliedGridVisible = null;
let cursorPosition = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
let cursorNormalizedX = 0;
let cursorNormalizedY = 0;
let cursorTrackingDirty = true;
let cursorTrackingViewportWidth = window.innerWidth;
let cursorTrackingViewportHeight = window.innerHeight;
let cursorTarget = new THREE.Object3D();
let blendedTarget = new THREE.Object3D();
let cursorTiltState = {};
const cursorRaycaster = new THREE.Raycaster();
const cursorNdc = new THREE.Vector2();
const cursorTargetPos = new THREE.Vector3();
const expressionBlendJobs = {};
const idleFrameJobs = {};
const socialLookState = {};
const cursorBodyFollowState = {};
const ambientPresenceState = {};
const ambientExpressionState = {};
const selfContactState = {};
const presenceState = {};
const eyeMicroMotionState = {};
const speechBodyMotionState = {};
const recentExpressionDispatch = new Map(); // key: character|chat_id -> signature

const IDENTITY_QUATERNION = new THREE.Quaternion();
const VRM_MAX_PIXEL_RATIO = 1.35;
const VRM_LOW_LOAD_PIXEL_RATIO = 1.0;
const VRM_ACTIVE_FRAME_INTERVAL_MS = 1000 / 60;
const VRM_OVERLAY_ACTIVE_FRAME_INTERVAL_MS = 1000 / 45;
const VRM_DEFAULT_FRAME_INTERVAL_MS = 1000 / 30;
const VRM_IDLE_FRAME_INTERVAL_MS = 1000 / 20;
const VRM_HELPER_SYNC_INTERVAL_MS = 1000 / 15;
const VRM_PHONE_SYNC_INTERVAL_MS = 1000 / 30;
const VRM_LOAD_SETTLE_MS = 4500;
let lastVrmFrameAt = 0;
let vrmLowQualityUntil = 0;
let appliedVrmPixelRatio = 0;
let callOverlayVisibleCached = false;
let lastCallOverlayVisibilityCheckAt = 0;

function setIdleFrameJob(character, jobKey, update) {
  if (!character || !jobKey || typeof update !== 'function') return;
  if (!idleFrameJobs[character]) {
    idleFrameJobs[character] = new Map();
  }
  idleFrameJobs[character].set(jobKey, update);
}

function clearIdleFrameJob(character, jobKey) {
  if (!idleFrameJobs[character]) return;
  idleFrameJobs[character].delete(jobKey);
  if (idleFrameJobs[character].size === 0) {
    delete idleFrameJobs[character];
  }
}

function clearIdleFrameJobs(character) {
  if (character) {
    delete idleFrameJobs[character];
    return;
  }
  for (const key of Object.keys(idleFrameJobs)) {
    delete idleFrameJobs[key];
  }
}

function updateIdleFrameJobs(character, nowMs, deltaTime) {
  const jobs = idleFrameJobs[character];
  if (!jobs || jobs.size === 0) return;

  for (const [jobKey, update] of [...jobs.entries()]) {
    const keepRunning = update(nowMs, deltaTime) !== false;
    if (!keepRunning) {
      jobs.delete(jobKey);
    }
  }
  if (jobs.size === 0) {
    delete idleFrameJobs[character];
  }
}

function suspendNaturalIdle(character, minDelayMs = 3000) {
  const now = Date.now();
  const current = nextIdleEligibleTime[character] || 0;
  nextIdleEligibleTime[character] = Math.max(current, now + Math.max(300, Number(minDelayMs) || 3000));
}

function stopProceduralIdleForCharacter(character, vrm = null) {
  clearNaturalIdleTimer(character);
  clearIdleManagedTimers(character);
  const avatarVrm = vrm || current_avatars[character]?.vrm;
  if (avatarVrm && cursorTiltState[character]) {
    resetCursorTilt(avatarVrm, character);
  }

  const idleAction = activeIdleAnimations[character];
  if (idleAction) {
    const fadeMs = Math.max(120, ANIMATION_FADE_TIME * 1000);
    if (idleAction.fadeOut) {
      idleAction.fadeOut(ANIMATION_FADE_TIME);
    }
    if (idleAction.stop) {
      setManagedCharacterTimer(character, 'idleStopAfterFade', fadeMs + 30, () => {
        if (idleAction.stop) {
          idleAction.stop();
        }
      });
    }
    delete activeIdleAnimations[character];

    if (avatarVrm) {
      restoreIdleBasePoses(character, avatarVrm, { durationMs: fadeMs + 120 });
    }
  }
}

function scheduleNaturalIdleCheck(character, modelId, delayMs = 0, _reason = "") {
  if (!character || !Number.isFinite(Number(modelId))) {
    return;
  }

  clearNaturalIdleTimer(character);

  const now = Date.now();
  const nextEligible = nextIdleEligibleTime[character] || 0;
  const cooldownDelay = Math.max(0, nextEligible - now);
  const baseDelay = Math.max(0, Number(delayMs) || 0);
  const finalDelay = Math.max(baseDelay, cooldownDelay);

  setNaturalIdleTimer(character, finalDelay, () => {
    naturalIdleMovement(character, modelId);
  });

}

const animationManagerState = {};

function getAnimationManagerState(character) {
  if (!character) {
    return {
      sequenceGeneration: 0,
      timeoutIds: new Set(),
      managedTimers: new Map(),
    };
  }

  if (!animationManagerState[character]) {
    animationManagerState[character] = {
      sequenceGeneration: 0,
      timeoutIds: new Set(),
      managedTimers: new Map(),
    };
  }

  return animationManagerState[character];
}

function clearAnimationManagerTimeouts(character) {
  const managerState = animationManagerState[character];
  if (!managerState) {
    return;
  }

  for (const timeoutId of managerState.timeoutIds) {
    clearTimeout(timeoutId);
  }
  managerState.timeoutIds.clear();
}

function setManagedCharacterTimer(character, timerKey, delayMs, callback) {
  if (!character || !timerKey) {
    return null;
  }

  const managerState = getAnimationManagerState(character);
  if (!managerState.managedTimers) {
    managerState.managedTimers = new Map();
  }

  const existingTimer = managerState.managedTimers.get(timerKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timeoutId = setTimeout(() => {
    const state = animationManagerState[character];
    if (state?.managedTimers?.get(timerKey) === timeoutId) {
      state.managedTimers.delete(timerKey);
    }
    callback();
  }, Math.max(0, Number(delayMs) || 0));

  managerState.managedTimers.set(timerKey, timeoutId);
  return timeoutId;
}

function clearManagedCharacterTimer(character, timerKey) {
  const managerState = animationManagerState[character];
  if (!managerState?.managedTimers || !timerKey) {
    return;
  }

  const timeoutId = managerState.managedTimers.get(timerKey);
  if (timeoutId) {
    clearTimeout(timeoutId);
    managerState.managedTimers.delete(timerKey);
  }
}

function clearAllManagedCharacterTimers(character) {
  const managerState = animationManagerState[character];
  if (!managerState?.managedTimers) {
    return;
  }

  for (const timeoutId of managerState.managedTimers.values()) {
    clearTimeout(timeoutId);
  }
  managerState.managedTimers.clear();
}

function setNaturalIdleTimer(character, delayMs, callback) {
  clearNaturalIdleTimer(character);
  const timeoutId = setManagedCharacterTimer(character, 'naturalIdleLoop', delayMs, () => {
    if (naturalIdleTimers[character] === timeoutId) {
      delete naturalIdleTimers[character];
    }
    callback();
  });
  if (timeoutId) {
    naturalIdleTimers[character] = timeoutId;
  }
  return timeoutId;
}

function clearNaturalIdleTimer(character) {
  clearManagedCharacterTimer(character, 'naturalIdleLoop');
  if (naturalIdleTimers[character]) {
    clearTimeout(naturalIdleTimers[character]);
    delete naturalIdleTimers[character];
  }
}

function clearIdleManagedTimers(character) {
  clearManagedCharacterTimer(character, 'idleStopAfterFade');
  clearManagedCharacterTimer(character, 'naturalIdleExpression');
  clearManagedCharacterTimer(character, 'naturalIdleVrmaExpression');
  clearManagedCharacterTimer(character, 'naturalIdleFadeCleanup');
}

function invalidateSequenceGeneration(character) {
  const managerState = getAnimationManagerState(character);
  managerState.sequenceGeneration += 1;
  clearAnimationManagerTimeouts(character);
  return managerState.sequenceGeneration;
}

function scheduleSequenceTimeout(character, generation, callback, delayMs = 0) {
  const managerState = getAnimationManagerState(character);
  const timeoutId = setTimeout(() => {
    const state = animationManagerState[character];
    if (state?.timeoutIds) {
      state.timeoutIds.delete(timeoutId);
    }

    const activeGeneration = sequencePlaybackState[character]?.generation;
    if (activeGeneration !== generation) {
      return;
    }

    callback();
  }, Math.max(0, Number(delayMs) || 0));

  managerState.timeoutIds.add(timeoutId);
  return timeoutId;
}

function isCharacterInIdleMotion(character) {
  const avatar = current_avatars[character];
  if (!avatar) return false;

  const motionName = avatar.motion?.name;
  const modelPath = extension_settings.vrm.character_model_mapping?.[character];
  const defaultMotion = modelPath ? resolveDefaultIdleMotion(modelPath) : null;
  return isIdleMotionName(motionName, defaultMotion);
}

function markUserActivity(_source = "generic") {
  if (_source === "cursor") {
    return;
  }
  const now = Date.now();
  inactivityState.lastActiveAt = now;
  inactivityState.suppressUntil = now + 1800;
  inactivityState.intensity *= 0.55;
}

function getRawInactivityIntensity(now = Date.now()) {
  if (now < inactivityState.suppressUntil) {
    return 0;
  }
  const idleStartMs = 5000;
  const fullIdleMs = 45000;
  const idleDuration = Math.max(0, now - inactivityState.lastActiveAt);
  const normalized = (idleDuration - idleStartMs) / (fullIdleMs - idleStartMs);
  return Math.max(0, Math.min(1, normalized));
}

function updateInactivityIntensity(deltaTime) {
  const target = getRawInactivityIntensity();
  const blendRate = target > inactivityState.intensity ? 0.45 : 8.5;
  const alpha = 1 - Math.exp(-Math.max(0, deltaTime) * blendRate);
  inactivityState.intensity += (target - inactivityState.intensity) * alpha;
  inactivityState.intensity = Math.max(0, Math.min(1, inactivityState.intensity));
  return inactivityState.intensity;
}

function isCharacterSpeaking(character, nowMs = Date.now()) {
  const avatar = current_avatars[character];
  if (!avatar) return false;
  return Number(avatar.talkEnd || 0) > nowMs || isCharacterLipSyncActive(character);
}

function getPresenceProfile(character, nowMs = Date.now(), inactivityIntensity = 0) {
  const speaking = isCharacterSpeaking(character, nowMs);
  const recentlyActive = nowMs - inactivityState.lastActiveAt < 6500;
  const naturalPresence = extension_settings.vrm.natural_idle === true && isCharacterInIdleMotion(character);
  let mode = 'relaxed';

  if (speaking) {
    mode = 'speaking';
  } else if (recentlyActive && naturalPresence) {
    mode = 'listening';
  } else if (inactivityIntensity > 0.42 && naturalPresence) {
    mode = 'thinking';
  } else if (inactivityIntensity < 0.16 && naturalPresence) {
    mode = 'attentive';
  }

  let state = presenceState[character];
  if (!state) {
    state = {
      mode,
      modeSince: nowMs,
      listeningNodAt: nowMs + 2800 + Math.random() * 4600,
      speechWasActive: false,
      speechEndedAt: 0,
    };
    presenceState[character] = state;
  }

  if (state.mode !== mode) {
    state.mode = mode;
    state.modeSince = nowMs;
    if (mode === 'listening') {
      state.listeningNodAt = nowMs + 1800 + Math.random() * 4200;
    }
  }

  if (speaking) {
    state.speechWasActive = true;
  } else if (state.speechWasActive) {
    state.speechWasActive = false;
    state.speechEndedAt = nowMs;
  }

  return {
    mode,
    naturalPresence,
    speaking,
    recentlyActive,
    speechRecovery: !speaking && nowMs - state.speechEndedAt < 1200,
    inactivityIntensity,
  };
}

function getAttentionTargetWithMicroMotion(character, baseTarget, cursorInfluence, presenceProfile, nowMs = Date.now()) {
  if (!baseTarget) return null;

  let state = eyeMicroMotionState[character];
  if (!state) {
    state = {
      targetObject: new THREE.Object3D(),
      offset: new THREE.Vector3(),
      offsetTarget: new THREE.Vector3(),
      nextShiftAt: 0,
      awayUntil: 0,
      awayOffset: new THREE.Vector3(),
    };
    eyeMicroMotionState[character] = state;
  }
  if (baseTarget.parent && state.targetObject.parent !== baseTarget.parent) {
    baseTarget.parent.add(state.targetObject);
  }

  const naturalPresence = presenceProfile?.naturalPresence === true;
  const mode = presenceProfile?.mode || 'relaxed';
  const speaking = presenceProfile?.speaking === true;
  const sequenceBusy = getProceduralControlProfile(character).sequenceBusy;
  const microEnabled = naturalPresence && !sequenceBusy;
  const glanceEnabled = microEnabled && !speaking && extension_settings.vrm.natural_idle === true;

  if (glanceEnabled && nowMs >= state.awayUntil && Math.random() < 0.0035) {
    const scale = mode === 'thinking' ? 0.18 : mode === 'listening' ? 0.11 : 0.14;
    state.awayOffset.set(
      (Math.random() * 2 - 1) * scale,
      (mode === 'thinking' ? -0.08 : (Math.random() * 0.12 - 0.04)),
      0
    );
    state.awayUntil = nowMs + 650 + Math.random() * 1050;
  }

  if (microEnabled && nowMs >= state.nextShiftAt) {
    const baseAmplitude = speaking ? 0.008 : mode === 'listening' ? 0.018 : mode === 'thinking' ? 0.032 : 0.023;
    const cursorScale = 1 - Math.min(0.55, Math.max(0, cursorInfluence || 0) * 0.35);
    state.offsetTarget.set(
      (Math.random() * 2 - 1) * baseAmplitude * cursorScale,
      (Math.random() * 2 - 1) * baseAmplitude * 0.65,
      0
    );
    state.nextShiftAt = nowMs + (speaking ? 900 : 420) + Math.random() * (speaking ? 1300 : 1500);
  } else if (!microEnabled) {
    state.offsetTarget.set(0, 0, 0);
    state.awayOffset.set(0, 0, 0);
    state.awayUntil = 0;
  }

  state.offset.lerp(state.offsetTarget, microEnabled ? 0.12 : 0.2);
  const awayWeight = glanceEnabled && nowMs < state.awayUntil ? 1 : 0;
  const away = state.awayOffset.clone().multiplyScalar(awayWeight);
  state.targetObject.position.copy(baseTarget.position).add(state.offset).add(away);
  return state.targetObject;
}

function clearEyeMicroMotion(character) {
  const state = eyeMicroMotionState[character];
  state?.targetObject?.parent?.remove?.(state.targetObject);
  delete eyeMicroMotionState[character];
}

function getLookAtStateForCharacter(character) {
  const followCursor = cursorTrackingEnabled && extension_settings.vrm.follow_cursor;
  const followCamera = extension_settings.vrm.follow_camera;
  const now = Date.now();
  const presenceProfile = getPresenceProfile(character, now, inactivityState.intensity);
  const idleAction = activeIdleAnimations[character];
  const idleActionActive = Boolean(idleAction && (!idleAction.isRunning || idleAction.isRunning()));

  if (!followCursor) {
    delete socialLookState[character];
    const target = followCamera ? lookAtTarget : null;
    return {
      target: getAttentionTargetWithMicroMotion(character, target, 0, presenceProfile, now),
      cursorInfluence: 0
    };
  }

  if (!followCamera) {
    delete socialLookState[character];
    return {
      target: getAttentionTargetWithMicroMotion(character, cursorTarget, 1, presenceProfile, now),
      cursorInfluence: 1
    };
  }

  const cursorX = (cursorPosition.x / window.innerWidth) * 2 - 1;
  const cursorY = -(cursorPosition.y / window.innerHeight) * 2 + 1;
  const idleCursorDelayMs = 5000;
  const cameraReturnGlanceMinMs = 7000;
  const cameraReturnGlanceMaxMs = 11000;
  const returnGlanceMinMs = 1200;
  const returnGlanceMaxMs = 2000;
  const movementThreshold = 0.008;
  const allowReturnGlance = !idleActionActive;
  let state = socialLookState[character];

  if (!state) {
    state = {
      mode: "cursor",
      cameraBlend: 0,
      lastMovementAt: now,
      lastCursorX: cursorX,
      lastCursorY: cursorY,
      idleCursorWorldPos: cursorTarget.position.clone(),
      nextReturnGlanceAt: 0,
      returnGlanceUntil: 0
    };
    socialLookState[character] = state;
  }

  const cursorDelta = Math.hypot(cursorX - state.lastCursorX, cursorY - state.lastCursorY);
  state.lastCursorX = cursorX;
  state.lastCursorY = cursorY;

  if (cursorDelta > movementThreshold) {
    state.lastMovementAt = now;
    state.mode = "cursor";
    state.idleCursorWorldPos.copy(cursorTarget.position);
    state.nextReturnGlanceAt = 0;
    state.returnGlanceUntil = 0;
  } else if (now - state.lastMovementAt >= idleCursorDelayMs) {
    if (state.mode === "cursor") {
      state.mode = "camera";
      state.idleCursorWorldPos.copy(cursorTarget.position);
      state.nextReturnGlanceAt = now + cameraReturnGlanceMinMs + Math.random() * (cameraReturnGlanceMaxMs - cameraReturnGlanceMinMs);
      state.returnGlanceUntil = 0;
    } else if (allowReturnGlance && state.mode === "camera" && state.nextReturnGlanceAt > 0 && now >= state.nextReturnGlanceAt) {
      state.mode = "return_cursor";
      state.returnGlanceUntil = now + returnGlanceMinMs + Math.random() * (returnGlanceMaxMs - returnGlanceMinMs);
      state.nextReturnGlanceAt = 0;
    } else if (state.mode === "return_cursor" && now >= state.returnGlanceUntil) {
      state.mode = "camera";
      state.nextReturnGlanceAt = now + cameraReturnGlanceMinMs + Math.random() * (cameraReturnGlanceMaxMs - cameraReturnGlanceMinMs);
    }
  }

  if (!allowReturnGlance && state.mode === "return_cursor") {
    state.mode = "camera";
    state.returnGlanceUntil = 0;
    state.nextReturnGlanceAt = now + cameraReturnGlanceMinMs + Math.random() * (cameraReturnGlanceMaxMs - cameraReturnGlanceMinMs);
  }

  let targetBlend = state.mode === "camera" ? 1 : 0;
  if (presenceProfile.mode === 'speaking' || presenceProfile.mode === 'listening') {
    targetBlend = Math.max(targetBlend, 0.72);
  } else if (presenceProfile.mode === 'thinking') {
    targetBlend = Math.max(targetBlend, 0.48);
  }
  const blendToCameraSpeed = 0.05;
  const blendToCursorSpeed = 0.22;
  const blendSpeed = targetBlend > state.cameraBlend ? blendToCameraSpeed : blendToCursorSpeed;
  state.cameraBlend += (targetBlend - state.cameraBlend) * blendSpeed;
  state.cameraBlend = Math.max(0, Math.min(1, state.cameraBlend));

  const activeCursorTargetPos = state.mode === "return_cursor" ? state.idleCursorWorldPos : cursorTarget.position;
  blendedTarget.position.copy(activeCursorTargetPos).lerp(lookAtTarget.position, state.cameraBlend);

  const cursorInfluenceScale = state.mode === "return_cursor" ? 0.45 : 1;

  return {
    target: getAttentionTargetWithMicroMotion(character, blendedTarget, (1 - state.cameraBlend) * cursorInfluenceScale, presenceProfile, now),
    cursorInfluence: (1 - state.cameraBlend) * cursorInfluenceScale
  };
}

// Cursor tracking functions
function setCursorPosition(x, y) {
  const dx = x - inactivityState.lastCursorX;
  const dy = y - inactivityState.lastCursorY;
  const movementForActivityThreshold = 14;
  const activityCooldownMs = 260;

  if (Math.hypot(dx, dy) > movementForActivityThreshold) {
    inactivityState.lastCursorX = x;
    inactivityState.lastCursorY = y;
    const now = Date.now();
    if (now - inactivityState.lastCursorActivityAt >= activityCooldownMs) {
      inactivityState.lastCursorActivityAt = now;
      markUserActivity("cursor");
    }
  }
  cursorPosition.x = x;
  cursorPosition.y = y;
  const width = Math.max(1, window.innerWidth || 1);
  const height = Math.max(1, window.innerHeight || 1);
  cursorNormalizedX = (x / width) * 2 - 1;
  cursorNormalizedY = -(y / height) * 2 + 1;
  cursorTrackingDirty = true;
}

function setCursorTracking(enabled) {
  cursorTrackingEnabled = enabled;
  cursorTrackingDirty = true;
  if (!enabled) {
    for (const character in socialLookState) {
      delete socialLookState[character];
    }
    for (const character in cursorBodyFollowState) {
      delete cursorBodyFollowState[character];
    }
  }
}

function getCursorBodyFollowWeight(character, inactivityIntensity = 0) {
  const idleAction = activeIdleAnimations[character];
  const idleActive = Boolean(idleAction && (!idleAction.isRunning || idleAction.isRunning()));
  const idleBodyWeight = 0.92 - (0.12 * inactivityIntensity);
  const targetWeight = idleActive ? Math.max(0.78, idleBodyWeight) : 1;

  if (cursorBodyFollowState[character] === undefined) {
    cursorBodyFollowState[character] = targetWeight;
    return targetWeight;
  }

  const currentWeight = cursorBodyFollowState[character];
  const blendSpeed = targetWeight < currentWeight ? 0.22 : 0.2;
  const nextWeight = currentWeight + (targetWeight - currentWeight) * blendSpeed;
  cursorBodyFollowState[character] = Math.max(0, Math.min(1, nextWeight));
  return cursorBodyFollowState[character];
}

const activeNaturalMovements = {};
const modelRotationJobs = {};

function applyNaturalMovementWithSlerp(vrm, boneName, movementConfig, character, modelId) {
    const bone = getHumanoidBoneNode(vrm, boneName);
    if (!bone) return;

    const startTime = Date.now();
    const baseQuat = bone.quaternion.clone();
    const baseEuler = new THREE.Euler().setFromQuaternion(baseQuat);
    const targetEuler = new THREE.Euler(
        baseEuler.x + movementConfig.x,
        baseEuler.y + movementConfig.y,
        baseEuler.z + movementConfig.z
    );
    const targetQuat = new THREE.Quaternion().setFromEuler(targetEuler);

    const rampDuration = 3500;
    const holdDuration = 5000;
    const totalDuration = rampDuration * 2 + holdDuration;

    function updateMovement() {
        if (current_avatars[character]?.vrm !== vrm ||
            current_avatars[character]?.["id"] !== modelId) {
            return;
        }

        const now = Date.now();
        const elapsed = now - startTime;

        if (elapsed >= totalDuration) {
            bone.quaternion.slerp(baseQuat, 0.03);
            if (bone.quaternion.angleTo(baseQuat) > 0.001) {
                requestAnimationFrame(updateMovement);
            } else {
                bone.quaternion.slerp(baseQuat, 0.2);
                delete activeNaturalMovements[character];
            }
            return;
        }

        let t = 0;
        if (elapsed < rampDuration) {
            t = easeInOutCubic(elapsed / rampDuration);
            bone.quaternion.slerpQuaternions(baseQuat, targetQuat, t);
        } else if (elapsed < rampDuration + holdDuration) {
            bone.quaternion.slerp(targetQuat, 0.2);
        } else {
            const rampDownElapsed = elapsed - rampDuration - holdDuration;
            t = easeInOutCubic(rampDownElapsed / rampDuration);
            bone.quaternion.slerpQuaternions(targetQuat, baseQuat, t);
        }

        requestAnimationFrame(updateMovement);
    }

    activeNaturalMovements[character] = updateMovement;
    updateMovement();
}

function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function setExpressionValueWithWinkSupport(expressionManager, expressionName, value) {
    const clamped = Math.min(1, Math.max(0, value));

    if (expressionName === 'blinkLeft' || expressionName === 'blinkRight') {
        const opposite = expressionName === 'blinkLeft' ? 'blinkRight' : 'blinkLeft';
        const curved = 1 - Math.pow(1 - clamped, 2);
        const boosted = Math.min(1, curved * 1.25);
        expressionManager.setValue(expressionName, boosted);
        expressionManager.setValue(opposite, 0);

        const blinkAssist = Math.min(1, boosted * 0.55);
        expressionManager.setValue('blink', Math.max(expressionManager.getValue('blink') || 0, blinkAssist));
        return;
    }

    expressionManager.setValue(expressionName, clamped);
}

// Helper to apply brief expressions during idle movements
function applyIdleExpression(vrm, character, expressionName, intensity = 0.7, duration = 2000, useClassifiedMapping = true) {
    if (!vrm.expressionManager) return;

    let finalExpression = expressionName;
    let finalIntensity = intensity;

    // Check if this is a winking expression - set flag to prevent automatic blink interference
    const isWinking = expressionName === 'blinkLeft' || expressionName === 'blinkRight';
    if (isWinking && current_avatars[character]) {
        current_avatars[character].winking = true;
        current_avatars[character].customWinking = true;
    }

    // Check if expressionName is a classified emotion and get mapping
    if (useClassifiedMapping) {
        const model_path = extension_settings.vrm.character_model_mapping[character];
        if (model_path) {
            const modelSettings = resolveVrmModelSettings(model_path);
            if (modelSettings.classify_mapping && modelSettings.classify_mapping[expressionName]) {
                const mapping = modelSettings.classify_mapping[expressionName];
                if (mapping.expression && mapping.expression !== 'none') {
                    finalExpression = mapping.expression;
                }
                // Use intensity from mapping if available
                if (mapping.intensity !== undefined) {
                    finalIntensity = mapping.intensity;
                }
            }
        }
    }

    // Check for custom blend shape mapping
    const blendShapeMapping = getBlendShapeMapping(character, finalExpression);
    if (blendShapeMapping && blendShapeMapping.blendShapes) {
        applyCustomBlendShapeGroupIdle(vrm, character, finalExpression, blendShapeMapping, finalIntensity, duration, isWinking);
        return;
    }

    const startTime = Date.now();
    const rampDuration = duration * 0.3;
    const holdDuration = duration * 0.4;
    const jobKey = `idleExpression:${finalExpression}`;

    setIdleFrameJob(character, jobKey, (nowMs) => {
        if (!current_avatars[character]) return false;

        const elapsed = nowMs - startTime;

        if (elapsed >= duration) {
            // Explicitly reset expression to 0 for blink-type expressions
            vrm.expressionManager.setValue(finalExpression, 0);
            // Clear winking state - let eyes return to neutral
            if (isWinking && current_avatars[character]) {
                vrm.expressionManager.setValue('blinkLeft', 0);
                vrm.expressionManager.setValue('blinkRight', 0);
                vrm.expressionManager.setValue('blink', 0);
                current_avatars[character].winking = false;
                current_avatars[character].customWinking = false;
            }
            return false;
        }

        let amplitude = 0;
        if (elapsed < rampDuration) {
            amplitude = easeInOutCubic(elapsed / rampDuration);
        } else if (elapsed < rampDuration + holdDuration) {
            amplitude = 1;
        } else {
            amplitude = 1 - easeInOutCubic((elapsed - rampDuration - holdDuration) / (duration - rampDuration - holdDuration));
        }

        setExpressionValueWithWinkSupport(vrm.expressionManager, finalExpression, finalIntensity * amplitude);
        return true;
    });
}

// Helper to apply custom blend shape groups during idle animations
function applyCustomBlendShapeGroupIdle(vrm, character, expressionName, blendMapping, intensity = 1.0, duration = 2000, isWinking = false) {
    if (!vrm || !vrm.expressionManager) return;

    // Set winking flag if this is a wink expression
    if (isWinking && current_avatars[character]) {
        current_avatars[character].winking = true;
        current_avatars[character].customWinking = true;
    }

    const startTime = Date.now();
    const rampDuration = duration * 0.3;
    const holdDuration = duration * 0.4;
    const blendShapes = blendMapping.blendShapes || {};
    const jobKey = `idleBlendShape:${expressionName}`;

    setIdleFrameJob(character, jobKey, (nowMs) => {
        if (!current_avatars[character]) return false;

        const elapsed = nowMs - startTime;

        if (elapsed >= duration) {
            // Explicitly reset all blend shapes to 0
            for (const blendShapeName in blendShapes) {
                vrm.expressionManager.setValue(blendShapeName, 0);
            }
            // Clear winking state - let eyes return to neutral
            if (current_avatars[character]) {
                vrm.expressionManager.setValue('blinkLeft', 0);
                vrm.expressionManager.setValue('blinkRight', 0);
                vrm.expressionManager.setValue('blink', 0);
                current_avatars[character].winking = false;
                current_avatars[character].customWinking = false;
            }
            return false;
        }

        let amplitude = 0;
        if (elapsed < rampDuration) {
            amplitude = easeInOutCubic(elapsed / rampDuration);
        } else if (elapsed < rampDuration + holdDuration) {
            amplitude = 1;
        } else {
            amplitude = 1 - easeInOutCubic((elapsed - rampDuration - holdDuration) / (duration - rampDuration - holdDuration));
        }

        for (const [blendShapeName, weight] of Object.entries(blendShapes)) {
            const adjustedIntensity = Math.min(1.0, Math.max(0.0, weight * intensity * amplitude));
            setExpressionValueWithWinkSupport(vrm.expressionManager, blendShapeName, adjustedIntensity);
        }

        return true;
    });
}

// Helper to apply subtle model Y rotation during idle movements
function applyModelRotation(vrm, character, modelId, targetYaw, duration = 7000) {
    const objectContainer = current_avatars[character]?.["objectContainer"];
    if (!objectContainer) return;

    // Avoid conflicting body controllers: cursor tracking and natural model rotation
    // should not drive root yaw at the same time.
    if (cursorTrackingEnabled && extension_settings.vrm.follow_cursor) {
        return;
    }

    const jobId = (modelRotationJobs[character] || 0) + 1;
    modelRotationJobs[character] = jobId;
    
    const startYaw = objectContainer.rotation.y;
    const startTime = Date.now();
    const rampDuration = duration * 0.3;
    const holdDuration = duration * 0.4;
    const totalDuration = duration;
    const jobKey = 'modelRotation';
    
    setIdleFrameJob(character, jobKey, (nowMs) => {
        if (current_avatars[character]?.["id"] !== modelId) return false;
        if (modelRotationJobs[character] !== jobId) return false;

        if (cursorTrackingEnabled && extension_settings.vrm.follow_cursor) {
            if (modelRotationJobs[character] === jobId) {
                delete modelRotationJobs[character];
            }
            return false;
        }
        
        const elapsed = nowMs - startTime;
        
        if (elapsed >= totalDuration) {
            // Return to base
            objectContainer.rotation.y += (startYaw - objectContainer.rotation.y) * 0.03;
            if (Math.abs(objectContainer.rotation.y - startYaw) <= 0.001 && modelRotationJobs[character] === jobId) {
                delete modelRotationJobs[character];
                return false;
            }
            return true;
        }
        
        let amplitude = 0;
        if (elapsed < rampDuration) {
            amplitude = easeInOutCubic(elapsed / rampDuration);
        } else if (elapsed < rampDuration + holdDuration) {
            amplitude = 1;
        } else {
            amplitude = 1 - easeInOutCubic((elapsed - rampDuration - holdDuration) / rampDuration);
        }
        
        const currentTarget = startYaw + (targetYaw * amplitude);
        objectContainer.rotation.y += (currentTarget - objectContainer.rotation.y) * 0.04;

        return true;
    });
}

// Helper to get available blend shape names from VRM model
function getAvailableBlendShapeNames(vrm) {
    if (!vrm || !vrm.blendShapeProxy) return [];

    const blendShapeNames = [];
    const expressionMap = vrm.expressionManager?.expressionMap || {};

    for (const expressionName in expressionMap) {
        blendShapeNames.push(expressionName);
    }

    return blendShapeNames;
}

// Helper to apply custom blend shape mapping
function applyCustomBlendShape(vrm, blendShapeName, intensity = 1.0) {
    if (!vrm || !vrm.expressionManager) return;

    const expressionMap = vrm.expressionManager.expressionMap;
    if (!expressionMap[blendShapeName]) {
        console.debug(DEBUG_PREFIX, 'Blend shape not found:', blendShapeName);
        return;
    }

    vrm.expressionManager.setValue(blendShapeName, intensity);
}

// Helper to apply custom blend shape mapping with multiple blend shapes
function applyCustomBlendShapeGroup(character, vrm, blendShapeGroup, intensity = 1.0) {
    if (!vrm || !vrm.expressionManager) return;

    const model_path = extension_settings.vrm.character_model_mapping[character];
    if (!model_path) return;

    const modelSettings = resolveVrmModelSettings(model_path);
    const blendMapping = modelSettings?.blend_shape_mapping?.[blendShapeGroup];
    
    if (!blendMapping || !blendMapping.blendShapes) return;

    for (const [blendShapeName, weight] of Object.entries(blendMapping.blendShapes)) {
        const adjustedIntensity = Math.min(1.0, Math.max(0.0, weight * intensity));
        applyCustomBlendShape(vrm, blendShapeName, adjustedIntensity);
    }
}

// Helper to get blend shape mapping for an expression name
function getBlendShapeMapping(character, expressionName) {
    const model_path = extension_settings.vrm.character_model_mapping[character];
    if (!model_path) return null;
    
    const modelSettings = resolveVrmModelSettings(model_path);
    if (!modelSettings?.blend_shape_mapping) return null;
    
    return modelSettings.blend_shape_mapping[expressionName] || null;
}

// Helper to reset all blend shapes to 0
function resetAllBlendShapes(vrm) {
    if (!vrm || !vrm.expressionManager) return;

    const expressionMap = vrm.expressionManager.expressionMap;
    for (const expressionName in expressionMap) {
        vrm.expressionManager.setValue(expressionName, 0.0);
    }
}

const NATURAL_MOVEMENTS = {
  slowHeadTurn: {
    type: 'head',
    duration: 12000,
    description: 'slow head turn',
    action: (vrm, character, modelId) => {
      const direction = Math.random() > 0.5 ? 1 : -1;
      const angleY = (Math.random() * 0.35 + 0.17) * direction;
      const angleX = (Math.random() * 0.16 - 0.08);
      const angleZ = (Math.random() * 0.1 - 0.05) * direction;

      // Head movement
      const headConfig = {
        x: angleX,
        y: angleY,
        z: angleZ
      };
      applyNaturalMovementWithSlerp(vrm, "head", headConfig, character, modelId);

      // Neck follows with natural follow-through
      const neck = vrm.humanoid?.getNormalizedBoneNode("neck");
      if (neck) {
        setTimeout(() => {
          const neckConfig = {
            x: angleX * 0.5,
            y: angleY * 0.42,
            z: angleZ * 0.6
          };
          applyNaturalMovementWithSlerp(vrm, "neck", neckConfig, character, modelId);
        }, 200);
      }

      // More pronounced model rotation to follow head
      const modelRotation = direction * (Math.random() * 0.1 + 0.08);
      applyModelRotation(vrm, character, modelId, modelRotation, 10000);
    }
  },
  headTilt: {
    type: 'head',
    duration: 12000,
    description: 'curious head tilt',
    action: (vrm, character, modelId) => {
      const direction = Math.random() > 0.5 ? 1 : -1;
      // More exaggerated tilt
      const angleZ = (Math.random() * 0.35 + 0.27) * direction;
      const angleX = (Math.random() * 0.12 - 0.06);
      const angleY = (Math.random() * 0.16 - 0.08) * direction;

      // Apply to head
      const headConfig = {
        x: angleX,
        y: angleY,
        z: angleZ
      };
      applyNaturalMovementWithSlerp(vrm, "head", headConfig, character, modelId);

      // Add neck follow with more natural movement
      const neck = vrm.humanoid?.getNormalizedBoneNode("neck");
      if (neck) {
        setTimeout(() => {
          const neckConfig = {
            x: angleX * 0.5,
            y: angleY * 0.35,
            z: angleZ * 0.57
          };
          applyNaturalMovementWithSlerp(vrm, "neck", neckConfig, character, modelId);
        }, 200);
      }

      // 30% chance to wink during head tilt
      if (Math.random() > 0.7) {
        const winkEye = direction > 0 ? 'blinkLeft' : 'blinkRight';
        setTimeout(() => {
          applyIdleExpression(vrm, character, winkEye, 0.9, 1500);
        }, 1000);
      }
      // 40% chance for curious smile
      else if (Math.random() > 0.6) {
        setTimeout(() => {
          applyIdleExpression(vrm, character, 'happy', 0.4, 2000);
        }, 500);
      }
    }
  },
  slowGlance: {
    type: 'head',
    duration: 10000,
    description: 'casual glance',
    action: (vrm, character, modelId) => {
      const directionX = Math.random() > 0.5 ? 1 : -1;
      const directionY = Math.random() > 0.5 ? 1 : -1;

      const angleX = (Math.random() * 0.14 + 0.05) * directionX;
      const angleY = (Math.random() * 0.28 + 0.13) * directionY;
      const angleZ = (Math.random() * 0.16 - 0.08);

      // More noticeable model rotation with glance
      const modelRotation = directionY * (Math.random() * 0.07 + 0.05);
      applyModelRotation(vrm, character, modelId, modelRotation, 9000);

      // 50% chance for curious expression
      if (Math.random() > 0.5) {
        setTimeout(() => applyIdleExpression(vrm, character, 'surprised', 0.5, 2000), 400);
      }

      // Head glance - more pronounced
      const headConfig = {
        x: angleX,
        y: angleY,
        z: angleZ
      };
      applyNaturalMovementWithSlerp(vrm, "head", headConfig, character, modelId);

      // Neck follows naturally
      const neck = vrm.humanoid?.getNormalizedBoneNode("neck");
      if (neck) {
        setTimeout(() => {
          const neckConfig = {
            x: angleX * 0.5,
            y: angleY * 0.54,
            z: angleZ * 0.5
          };
          applyNaturalMovementWithSlerp(vrm, "neck", neckConfig, character, modelId);
        }, 300);
      }

      // Spine twist for more natural look
      const spine = vrm.humanoid?.getNormalizedBoneNode("spine");
      if (spine) {
        setTimeout(() => {
          const spineConfig = {
            x: angleX * 0.25,
            y: angleY * 0.43,
            z: angleZ * 0.38
          };
          applyNaturalMovementWithSlerp(vrm, "spine", spineConfig, character, modelId);
        }, 500);
      }
    }
  },
  lookAround: {
    type: 'head',
    duration: 16000,
    description: 'looking around',
    action: (vrm, character, modelId) => {
      // Model rotation that follows to look pattern - more dynamic
      const modelRotation1 = 0.09;
      const modelRotation2 = -0.08;

      setTimeout(() => applyModelRotation(vrm, character, modelId, modelRotation1, 4500), 500);
      setTimeout(() => applyModelRotation(vrm, character, modelId, modelRotation2, 4500), 7000);

      // 60% chance for slight smile during look
      if (Math.random() > 0.4) {
        setTimeout(() => applyIdleExpression(vrm, character, 'happy', 0.45, 1800), 300);
      }

      const directions = [
        { x: 0.12, y: 0.32, duration: 3500 },
        { x: 0.05, y: 0.08, duration: 2500 },
        { x: 0.1, y: -0.28, duration: 3500 },
        { x: 0.02, y: -0.06, duration: 3000 }
      ];

            const head = vrm.humanoid?.getNormalizedBoneNode("head");
            if (!head) return;
            const baseEuler = new THREE.Euler().setFromQuaternion(head.quaternion.clone());
            const baseQuat = new THREE.Quaternion().setFromEuler(baseEuler);
            const jobKey = 'naturalLookAround';
            const state = {
                phase: 'step',
                stepIndex: 0,
                startAt: Date.now(),
                waitUntil: 0,
                startQuat: head.quaternion.clone(),
                targetQuat: null,
                returnQuat: null,
            };

            const setStepTarget = () => {
                const step = directions[state.stepIndex];
                state.phase = 'step';
                state.startAt = Date.now();
                state.startQuat = head.quaternion.clone();
                state.targetQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(
                    baseEuler.x + step.x,
                    baseEuler.y + step.y,
                    baseEuler.z
                ));
            };
            setStepTarget();

            setIdleFrameJob(character, jobKey, (nowMs) => {
                if (current_avatars[character]?.vrm !== vrm || current_avatars[character]?.["id"] !== modelId) return false;

                if (state.phase === 'wait') {
                    if (nowMs < state.waitUntil) return true;
                    setStepTarget();
                }

                if (state.phase === 'return') {
                    const progress = Math.min((nowMs - state.startAt) / 2500, 1);
                    head.quaternion.slerpQuaternions(state.returnQuat, baseQuat, easeInOutCubic(progress));
                    return progress < 1;
                }

                const step = directions[state.stepIndex];
                const progress = Math.min((nowMs - state.startAt) / step.duration, 1);
                head.quaternion.slerpQuaternions(state.startQuat, state.targetQuat, easeInOutCubic(progress));
                if (progress < 1) return true;

                state.stepIndex++;
                if (state.stepIndex < directions.length) {
                    state.phase = 'wait';
                    state.waitUntil = nowMs + 1200;
                    return true;
                }

                state.phase = 'return';
                state.startAt = nowMs;
                state.returnQuat = head.quaternion.clone();
                return true;
            });
        }
    },
    shoulderShrug: {
        type: 'body',
        duration: 6000,
        description: 'shoulder shrug',
        action: (vrm, character, modelId) => {
            const bothShoulders = Math.random() > 0.6;
            const leftShoulder = vrm.humanoid?.getNormalizedBoneNode("leftShoulder");
            const rightShoulder = vrm.humanoid?.getNormalizedBoneNode("rightShoulder");

            if (!leftShoulder && !rightShoulder) return;

            const shrugAmount = Math.random() * 0.12 + 0.06;
            const startTime = Date.now();
            const baseLeft = leftShoulder?.quaternion.clone();
            const baseRight = rightShoulder?.quaternion.clone();

            const rampDuration = 2500;
            const holdDuration = 4000;
            const totalDuration = rampDuration * 2 + holdDuration;

            setIdleFrameJob(character, 'naturalShoulderShrug', (nowMs) => {
                if (current_avatars[character]?.vrm !== vrm || current_avatars[character]?.["id"] !== modelId) return false;

                const elapsed = nowMs - startTime;

                if (elapsed >= totalDuration) {
                    if (leftShoulder && baseLeft) leftShoulder.quaternion.slerp(baseLeft, 0.03);
                    if (rightShoulder && baseRight && bothShoulders) rightShoulder.quaternion.slerp(baseRight, 0.03);

                    const stillMoving = (leftShoulder && baseLeft && leftShoulder.quaternion.angleTo(baseLeft) > 0.001) ||
                        (rightShoulder && baseRight && bothShoulders && rightShoulder.quaternion.angleTo(baseRight) > 0.001);
                    return !!stillMoving;
                }

                let amplitude = 0;
                if (elapsed < rampDuration) {
                    amplitude = easeInOutCubic(elapsed / rampDuration);
                } else if (elapsed < rampDuration + holdDuration) {
                    amplitude = 1;
                } else {
                    amplitude = 1 - easeInOutCubic((elapsed - rampDuration - holdDuration) / rampDuration);
                }

                const shrugQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-shrugAmount * amplitude, 0, 0));
                if (leftShoulder && baseLeft) leftShoulder.quaternion.slerp(baseLeft.clone().multiply(shrugQuat), 0.04);
                if (rightShoulder && baseRight && bothShoulders) rightShoulder.quaternion.slerp(baseRight.clone().multiply(shrugQuat), 0.04);
                return true;
            });
        }
    },
    armStretch: {
        type: 'body',
        duration: 8000,
        description: 'arm stretch',
        action: (vrm, character, modelId) => {
            const side = Math.random() > 0.5 ? "left" : "right";
            const upperArm = vrm.humanoid?.getNormalizedBoneNode(`${side}UpperArm`);
            const lowerArm = vrm.humanoid?.getNormalizedBoneNode(`${side}LowerArm`);

            if (!upperArm) return;

            const startTime = Date.now();
            const baseUpper = upperArm.quaternion.clone();
            const baseLower = lowerArm?.quaternion.clone();

            const rampDuration = 3000;
            const holdDuration = 5000;
            const totalDuration = rampDuration * 2 + holdDuration;

            setIdleFrameJob(character, 'naturalArmStretch', (nowMs) => {
                if (current_avatars[character]?.vrm !== vrm || current_avatars[character]?.["id"] !== modelId) return false;

                const elapsed = nowMs - startTime;

                if (elapsed >= totalDuration) {
                    upperArm.quaternion.slerp(baseUpper, 0.03);
                    if (lowerArm && baseLower) lowerArm.quaternion.slerp(baseLower, 0.03);

                    return upperArm.quaternion.angleTo(baseUpper) > 0.001 ||
                        (lowerArm && baseLower && lowerArm.quaternion.angleTo(baseLower) > 0.001);
                }

                let amplitude = 0;
                if (elapsed < rampDuration) {
                    amplitude = easeInOutCubic(elapsed / rampDuration);
                } else if (elapsed < rampDuration + holdDuration) {
                    amplitude = 1;
                } else {
                    amplitude = 1 - easeInOutCubic((elapsed - rampDuration - holdDuration) / rampDuration);
                }

                const stretchQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(
                    -0.2 * amplitude,
                    0,
                    (side === "left" ? 0.25 : -0.25) * amplitude
                ));
                upperArm.quaternion.slerp(baseUpper.clone().multiply(stretchQuat), 0.04);

                if (lowerArm && baseLower) {
                    const elbowBend = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.12 * amplitude, 0, 0));
                    lowerArm.quaternion.slerp(baseLower.clone().multiply(elbowBend), 0.04);
                }

                return true;
            });
        }
    },
  weightShift: {
    type: 'body',
    duration: 10000,
    description: 'weight shift with spine twist',
    action: (vrm, character, modelId) => {
      const direction = Math.random() > 0.5 ? 1 : -1;

      // More pronounced model rotation with weight shift
      const modelRotation = direction * (Math.random() * 0.1 + 0.08);
      applyModelRotation(vrm, character, modelId, modelRotation, 9000);

      // Spine: shift + twist - much more visible
      const spineConfig = {
        x: Math.random() * 0.06 - 0.03,
        y: (Math.random() * 0.22 + 0.1) * direction,
        z: (Math.random() * 0.2 + 0.05) * direction
      };
      applyNaturalMovementWithSlerp(vrm, "spine", spineConfig, character, modelId);

      // Upper chest follows for more natural movement
      const upperChest = getHumanoidBoneNode(vrm, "upperChest") || getHumanoidBoneNode(vrm, "chest") || getHumanoidBoneNode(vrm, "spine");
      if (upperChest) {
        setTimeout(() => {
          const chestConfig = {
            x: Math.random() * 0.04 - 0.02,
            y: (Math.random() * 0.1 + 0.05) * direction,
            z: (Math.random() * 0.12 + 0.04) * direction
          };
          applyNaturalMovementWithSlerp(vrm, "upperChest", chestConfig, character, modelId);
        }, 200);
      }

      // Hips: counter-rotation for balance
      const hips = vrm.humanoid?.getNormalizedBoneNode("hips");
      if (hips) {
        setTimeout(() => {
          const hipsConfig = {
            x: Math.random() * 0.06 - 0.03,
            y: -(Math.random() * 0.12 + 0.05) * direction,
            z: (Math.random() * 0.15 + 0.05) * direction
          };
          applyNaturalMovementWithSlerp(vrm, "hips", hipsConfig, character, modelId);
        }, 350);
      }

      // 40% chance for thoughtful expression
      if (Math.random() > 0.6) {
        setTimeout(() => applyIdleExpression(vrm, character, 'neutral', 0.5, 1500), 800);
      }
    }
  },
  neckStretch: {
    type: 'neck',
    duration: 10000,
    description: 'neck stretch',
    action: (vrm, character, modelId) => {
      const directionX = Math.random() > 0.5 ? 1 : -1;
      const directionY = Math.random() > 0.5 ? 1 : -1;
      const directionZ = Math.random() > 0.5 ? 1 : -1;

      // Neck tilt - more pronounced stretching motion
      const neckConfig = {
        x: (Math.random() * 0.12 + 0.06) * directionX,
        y: (Math.random() * 0.25 + 0.05) * directionY,
        z: (Math.random() * 0.4 + 0.15) * directionZ
      };
      applyNaturalMovementWithSlerp(vrm, "neck", neckConfig, character, modelId);

      // Head follows for natural stretching
      const head = vrm.humanoid?.getNormalizedBoneNode("head");
      if (head) {
        setTimeout(() => {
          const headConfig = {
            x: neckConfig.x * 0.7,
            y: neckConfig.y * 0.6,
            z: neckConfig.z * 0.8
          };
          applyNaturalMovementWithSlerp(vrm, "head", headConfig, character, modelId);
        }, 200);
      }

      // 50% chance for expression during stretch
      if (Math.random() > 0.5) {
        setTimeout(() => applyIdleExpression(vrm, character, 'surprised', 0.55, 2200), 500);
      }
    }
  },
  subtleNod: {
    type: 'head',
    duration: 8000,
    description: 'subtle nod',
    action: (vrm, character, modelId) => {
      const direction = Math.random() > 0.5 ? 1 : -1;
      // More pronounced nod with slight natural variation
      const headConfig = {
        x: Math.random() * 0.14 + 0.08,
        y: (Math.random() * 0.05) * direction,
        z: (Math.random() * 0.03) * direction
      };
      applyNaturalMovementWithSlerp(vrm, "head", headConfig, character, modelId);

      // Neck follows naturally
      const neck = vrm.humanoid?.getNormalizedBoneNode("neck");
      if (neck) {
        setTimeout(() => {
          const neckConfig = {
            x: headConfig.x * 0.55,
            y: headConfig.y * 0.6,
            z: headConfig.z * 0.5
          };
          applyNaturalMovementWithSlerp(vrm, "neck", neckConfig, character, modelId);
        }, 200);
      }

      // 70% chance for gentle smile during nod
      if (Math.random() > 0.3) {
        setTimeout(() => applyIdleExpression(vrm, character, 'happy', 0.5, 1500), 1000);
      }
    }
  },
  hipShift: {
    type: 'hips',
    duration: 11000,
    description: 'hip shift with rotation',
    action: (vrm, character, modelId) => {
      const direction = Math.random() > 0.5 ? 1 : -1;

      // Model rotation with hip shift - more dynamic
      const modelRotation = direction * (Math.random() * 0.08 + 0.08);
      applyModelRotation(vrm, character, modelId, modelRotation, 9500);

      // Hip tilt + rotation for more dynamic movement
      const hipConfig = {
        x: (Math.random() * 0.08 - 0.04),
        y: (Math.random() * 0.25 + 0.1) * direction,
        z: (Math.random() * 0.22 + 0.12) * direction
      };
      applyNaturalMovementWithSlerp(vrm, "hips", hipConfig, character, modelId);

      // Upper chest counter-movement for balance
      const upperChest = getHumanoidBoneNode(vrm, "upperChest") || getHumanoidBoneNode(vrm, "chest") || getHumanoidBoneNode(vrm, "spine");
      if (upperChest) {
        setTimeout(() => {
          const chestConfig = {
            x: (Math.random() * 0.05 - 0.025),
            y: (Math.random() * 0.08 + 0.04) * direction,
            z: (Math.random() * 0.08 + 0.04) * direction
          };
          applyNaturalMovementWithSlerp(vrm, "upperChest", chestConfig, character, modelId);
        }, 250);
      }

      // Spine counter-movement for balance
      const spine = vrm.humanoid?.getNormalizedBoneNode("spine");
      if (spine) {
        setTimeout(() => {
          const spineConfig = {
            x: (Math.random() * 0.08 - 0.04),
            y: -(Math.random() * 0.15 + 0.08) * direction,
            z: -(Math.random() * 0.12 + 0.07) * direction
          };
          applyNaturalMovementWithSlerp(vrm, "spine", spineConfig, character, modelId);
        }, 400);
      }

      // 40% chance for curious expression
      if (Math.random() > 0.6) {
        setTimeout(() => applyIdleExpression(vrm, character, 'surprised', 0.6, 2200), 700);
      }
    }
  },
  feminineHipSway: {
    type: 'hips',
    duration: 14000,
    description: 'feminine hip sway',
    action: (vrm, character, modelId) => {
      const swayAmount = Math.random() * 0.25 + 0.22;
      const direction = Math.random() > 0.5 ? 1 : -1;

      // Model sways with hips - more pronounced
      const modelRotation = direction * (Math.random() * 0.08 + 0.06);
      applyModelRotation(vrm, character, modelId, modelRotation, 12000);

      // Hip sway with rotation - more dynamic
      const hipConfig = {
        x: (Math.random() * 0.08 - 0.04),
        y: Math.random() * 0.15,
        z: swayAmount
      };
      applyNaturalMovementWithSlerp(vrm, "hips", hipConfig, character, modelId);

      // Upper chest follows for more graceful movement
      const upperChest = getHumanoidBoneNode(vrm, "upperChest") || getHumanoidBoneNode(vrm, "chest") || getHumanoidBoneNode(vrm, "spine");
      if (upperChest) {
        setTimeout(() => {
          const chestConfig = {
            x: (Math.random() * 0.06 - 0.03),
            y: -(Math.random() * 0.12 + 0.05),
            z: -swayAmount * 0.35
          };
          applyNaturalMovementWithSlerp(vrm, "upperChest", chestConfig, character, modelId);
        }, 200);
      }

      // Spine follows with delay
      const spine = vrm.humanoid?.getNormalizedBoneNode("spine");
      if (spine) {
        setTimeout(() => {
          const spineConfig = {
            x: (Math.random() * 0.06 - 0.03),
            y: -(Math.random() * 0.1),
            z: -swayAmount * 0.52
          };
          applyNaturalMovementWithSlerp(vrm, "spine", spineConfig, character, modelId);
        }, 400);
      }

      // Neck slight movement for elegance
      const neck = vrm.humanoid?.getNormalizedBoneNode("neck");
      if (neck) {
        setTimeout(() => {
          const neckConfig = {
            x: (Math.random() * 0.04 - 0.02),
            y: -(Math.random() * 0.08),
            z: (Math.random() * 0.1 - 0.05)
          };
          applyNaturalMovementWithSlerp(vrm, "neck", neckConfig, character, modelId);
        }, 600);
      }

      // 70% chance for pleasant expression
      if (Math.random() > 0.3) {
        setTimeout(() => applyIdleExpression(vrm, character, 'happy', 0.5, 2200), 1200);
      }
    }
  },
  coyHeadTilt: {
    type: 'head',
    duration: 11000,
    description: 'coy head tilt',
    action: (vrm, character, modelId) => {
      const direction = Math.random() > 0.5 ? 1 : -1;
      // More pronounced coy tilt with slight angle variation
      const headConfig = {
        x: Math.random() * 0.1 + 0.1,
        y: (Math.random() * 0.12) * direction,
        z: -(Math.random() * 0.16 + 0.22) * direction
      };
      applyNaturalMovementWithSlerp(vrm, "head", headConfig, character, modelId);

      // Neck follows for more natural movement
      const neck = vrm.humanoid?.getNormalizedBoneNode("neck");
      if (neck) {
        setTimeout(() => {
          const neckConfig = {
            x: headConfig.x * 0.53,
            y: headConfig.y * 0.5,
            z: headConfig.z * 0.58
          };
          applyNaturalMovementWithSlerp(vrm, "neck", neckConfig, character, modelId);
        }, 200);
      }

      // 70% chance for shy or cute expression
      const expression = Math.random() > 0.3 ? 'relaxed' : 'shy';
      setTimeout(() => applyIdleExpression(vrm, character, expression, 1.0, 2500), 1200);
    }
  },
  chestLift: {
    type: 'chest',
    duration: 9000,
    description: 'chest lift',
    action: (vrm, character, modelId) => {
      const upperChest = getHumanoidBoneNode(vrm, "upperChest") || getHumanoidBoneNode(vrm, "chest") || getHumanoidBoneNode(vrm, "spine");
      if (!upperChest) return;
      const boneName = getHumanoidBoneNode(vrm, "upperChest") ? "upperChest" : getHumanoidBoneNode(vrm, "chest") ? "chest" : "spine";

      // Keep this subtle to avoid exaggerated lean-back posture.
      const chestConfig = {
        x: Math.random() * 0.06 + 0.08,
        y: Math.random() * 0.04 - 0.02,
        z: Math.random() * 0.03 - 0.015
      };
      applyNaturalMovementWithSlerp(vrm, boneName, chestConfig, character, modelId);

      // Open arms slightly so hands do not rest into the thighs during this pose.
      const armOpenAmount = Math.random() * 0.05 + 0.06;
      applyNaturalMovementWithSlerp(vrm, "leftUpperArm", { x: -0.02, y: 0, z: armOpenAmount }, character, modelId);
      applyNaturalMovementWithSlerp(vrm, "rightUpperArm", { x: -0.02, y: 0, z: -armOpenAmount }, character, modelId);

      // Spine follows naturally
      const spine = getHumanoidBoneNode(vrm, "spine");
      if (spine) {
        setTimeout(() => {
          const spineConfig = {
            x: chestConfig.x * 0.35,
            y: chestConfig.y * 0.5,
            z: chestConfig.z * 0.5
          };
          applyNaturalMovementWithSlerp(vrm, "spine", spineConfig, character, modelId);
        }, 250);
      }

      // Neck slight adjustment for natural lift
      const neck = vrm.humanoid?.getNormalizedBoneNode("neck");
      if (neck) {
        setTimeout(() => {
          const neckConfig = {
            x: -chestConfig.x * 0.2,
            y: 0,
            z: 0
          };
          applyNaturalMovementWithSlerp(vrm, "neck", neckConfig, character, modelId);
        }, 400);
      }

      // 60% chance for confident or proud expression
      if (Math.random() > 0.4) {
        const expression = Math.random() > 0.5 ? 'happy' : 'relaxed';
        setTimeout(() => applyIdleExpression(vrm, character, expression, 1.0, 2000), 1800);
      }
    }
  },
};

// debug
const gridHelper = new THREE.GridHelper( 20, 20 );
const axesHelper = new THREE.AxesHelper( 10 );

function updateCursorTracking() {
  if (!cursorTrackingEnabled || !camera || !renderer) return;

  const width = Math.max(1, window.innerWidth || 1);
  const height = Math.max(1, window.innerHeight || 1);
  if (width !== cursorTrackingViewportWidth || height !== cursorTrackingViewportHeight) {
    cursorTrackingViewportWidth = width;
    cursorTrackingViewportHeight = height;
    cursorNormalizedX = (cursorPosition.x / width) * 2 - 1;
    cursorNormalizedY = -(cursorPosition.y / height) * 2 + 1;
    cursorTrackingDirty = true;
  }

  if (!cursorTrackingDirty) return;
  cursorTrackingDirty = false;

  cursorNdc.set(cursorNormalizedX, cursorNormalizedY);
  cursorRaycaster.setFromCamera(cursorNdc, camera);

  const distance = 5.0;  // Far enough for natural eye movement range
  cursorTargetPos.copy(camera.position).add(cursorRaycaster.ray.direction.multiplyScalar(distance));

  cursorTarget.position.copy(cursorTargetPos);
}

function getProceduralControlProfile(character) {
  const avatar = current_avatars[character];
  const rigCal = avatar?.proceduralCalibration || null;
  const modelPath = extension_settings?.vrm?.character_model_mapping?.[character];
  const defaultMotion = modelPath ? resolveDefaultIdleMotion(modelPath) : null;
  const currentMotionName = avatar?.motion?.name || 'none';
  const currentMotionAction = avatar?.motion?.animation;
  const sequenceBusy = Boolean(animationSequences?.[character] || sequencePlaybackState?.[character]?.active || sequencePlaybackState?.[character]?.waiting);
  const runningNonIdleMotion = Boolean(currentMotionAction && currentMotionAction.isRunning && currentMotionAction.isRunning() && !isIdleMotionName(currentMotionName, defaultMotion));
  const idleAction = activeIdleAnimations[character];
  const idleActionActive = Boolean(idleAction && (!idleAction.isRunning || idleAction.isRunning()));
  const activeIdleName = String(getActiveIdleClipName(character) || '').toLowerCase();
  const chestGestureActive = activeIdleName.includes('chestadjustgesture') || activeIdleName.includes('chestshaketease');
  const lipSyncActive = isCharacterLipSyncActive(character);

  const profile = {
    cursorGlobal: 1,
    cursorBody: rigCal?.cursorBodyScale || 1,
    cursorShoulders: (rigCal?.shoulderMobility || 1) * 0.9,
    cursorNeckScale: 1,
    ambientWeight: 0.55,
    selfContactWeight: 0.45,
    mode: 'default',
    sequenceBusy,
    runningNonIdleMotion,
    idleActionActive,
    chestGestureActive,
    lipSyncActive,
  };

  if (sequenceBusy || runningNonIdleMotion) {
    profile.mode = 'motion_priority';
    profile.cursorBody = 0.2;
    profile.cursorShoulders = 0.15;
    profile.cursorNeckScale = 0.92;
    profile.ambientWeight = 0.08;
    profile.selfContactWeight = 0;
  } else if (chestGestureActive) {
    profile.mode = 'gesture_priority';
    profile.cursorBody = 0.42;
    profile.cursorShoulders = 0.38;
    profile.cursorNeckScale = 1.02;
    profile.ambientWeight = 0.8;
    profile.selfContactWeight = 0;
  } else if (idleActionActive) {
    profile.mode = 'idle_blend';
    profile.cursorBody = 0.78;
    profile.cursorShoulders = 0.72;
    profile.cursorNeckScale = 1.18;
    profile.ambientWeight = 1;
    profile.selfContactWeight = 1;
  }

  if (lipSyncActive) {
    profile.cursorBody *= 0.9;
    profile.cursorShoulders *= 0.85;
    profile.ambientWeight *= 0.75;
  }

  profile.cursorBody = Math.max(0.08, Math.min(1.25, profile.cursorBody));
  profile.cursorShoulders = Math.max(0.06, Math.min(1.25, profile.cursorShoulders));
  profile.cursorNeckScale = Math.max(0.7, Math.min(1.35, profile.cursorNeckScale));
  profile.ambientWeight = Math.max(0, Math.min(1.3, profile.ambientWeight));
  profile.selfContactWeight = Math.max(0, Math.min(1.1, profile.selfContactWeight));

  return profile;
}

function applyCursorTiltAndShift(vrm, character, influenceTarget = 1, controlProfile = null) {
  const avatar = current_avatars[character];
  const objectContainer = avatar?.["objectContainer"];
  if (!objectContainer) return;
  const getRawBone = (boneName) => vrm?.humanoid?.getRawBoneNode?.(boneName) || null;

  if (!cursorTiltState[character]) {
    cursorTiltState[character] = {
      currentYaw: 0, currentPitch: 0,
      shoulderCurrentYaw: 0, shoulderCurrentRoll: 0,
      bodyCursorX: 0, bodyCursorY: 0,
      spineCurrentYaw: 0, spineCurrentRoll: 0,
      modelCurrentYaw: 0, modelCurrentPitch: 0,
      neckCurrentYaw: 0, neckCurrentPitch: 0,
      headCurrentYaw: 0, headCurrentPitch: 0,
      modelAppliedYaw: 0, modelAppliedPitch: 0,
      influence: 0,
      spineAppliedQuat: new THREE.Quaternion(),
      chestAppliedQuat: new THREE.Quaternion(),
      neckAppliedQuat: new THREE.Quaternion(),
      headAppliedQuat: new THREE.Quaternion(),
      leftShoulderAppliedQuat: new THREE.Quaternion(),
      rightShoulderAppliedQuat: new THREE.Quaternion(),
      leftUpperArmAppliedQuat: new THREE.Quaternion(),
      rightUpperArmAppliedQuat: new THREE.Quaternion(),
      tempQuat: new THREE.Quaternion(),
      tempEuler: new THREE.Euler(),
      tempQuat2: new THREE.Quaternion(),
      tempEuler2: new THREE.Euler(),
    };
  }

  const state = cursorTiltState[character];

  const control = controlProfile || getProceduralControlProfile(character);
  const bodyCursorScale = control.cursorBody;
  const shoulderScale = control.cursorShoulders;
  const neckCursorScale = Math.max(0.72, (0.72 + bodyCursorScale * 0.28) * control.cursorNeckScale);

  const cursorX = cursorNormalizedX;
  const cursorY = cursorNormalizedY;

  const smoothstep = (edge0, edge1, value) => {
    const t = Math.max(0, Math.min(1, (value - edge0) / Math.max(0.0001, edge1 - edge0)));
    return t * t * (3 - 2 * t);
  };

  const absCursorX = Math.abs(cursorX);
  const absCursorY = Math.abs(cursorY);
  const turnStrength = smoothstep(0.08, 0.5, absCursorX);
  const extremeTurnStrength = smoothstep(0.34, 0.8, absCursorX);
  const pitchStrength = smoothstep(0.1, 0.62, absCursorY);

  const neckGain = 1.02 + (0.28 * turnStrength);
  const chestGain = 0.36 + (0.76 * turnStrength);
  const modelGain = 0.08 + (0.52 * turnStrength) + (0.2 * extremeTurnStrength);

  state.influence += ((influenceTarget * control.cursorGlobal) - state.influence) * 0.45;
  state.influence = Math.max(0, Math.min(1, state.influence));

  state.bodyCursorX += (cursorX - state.bodyCursorX) * 0.42;
  state.bodyCursorY += (cursorY - state.bodyCursorY) * 0.38;

  // HIERARCHY: Eyes > Head > Neck > Upper Body > Lower Body

  // MODEL Y ROTATION (Lower body horizontal) - Moderate turn
  const targetModelYaw = state.bodyCursorX * 0.095 * state.influence * bodyCursorScale * modelGain;
  const baseModelYaw = objectContainer.rotation.y - state.modelAppliedYaw;
  state.modelCurrentYaw += (targetModelYaw - state.modelCurrentYaw) * 0.34;
  // Clamp additive model yaw to prevent drift
  state.modelCurrentYaw = Math.max(-0.34, Math.min(0.34, state.modelCurrentYaw));
  state.modelAppliedYaw = state.modelCurrentYaw;
  objectContainer.rotation.y = baseModelYaw + state.modelAppliedYaw;

  // MODEL X ROTATION (forward/back lean). Cursor low leans in, cursor high leans back.
  const targetModelPitch = -state.bodyCursorY * 0.085 * state.influence * bodyCursorScale * (0.3 + 0.7 * pitchStrength);
  const baseModelPitch = objectContainer.rotation.x - state.modelAppliedPitch;
  state.modelCurrentPitch += (targetModelPitch - state.modelCurrentPitch) * 0.28;
  // Clamp additive model pitch to prevent drift
  state.modelCurrentPitch = Math.max(-0.18, Math.min(0.16, state.modelCurrentPitch));
  state.modelAppliedPitch = state.modelCurrentPitch;
  objectContainer.rotation.x = baseModelPitch + state.modelAppliedPitch;

  const spine = getRawBone("spine");
  if (spine) {
    const spineTargetYaw = state.bodyCursorX * 0.065 * state.influence * bodyCursorScale * (0.32 + 0.62 * turnStrength);
    const spineTargetRoll = -state.bodyCursorX * 0.028 * state.influence * bodyCursorScale * (0.22 + 0.55 * turnStrength);
    state.spineCurrentYaw += (spineTargetYaw - state.spineCurrentYaw) * 0.34;
    state.spineCurrentRoll += (spineTargetRoll - state.spineCurrentRoll) * 0.34;
    state.spineCurrentYaw = Math.max(-0.2, Math.min(0.2, state.spineCurrentYaw));
    state.spineCurrentRoll = Math.max(-0.14, Math.min(0.14, state.spineCurrentRoll));

    const spineQuat = state.tempQuat.setFromEuler(state.tempEuler.set(0, state.spineCurrentYaw, state.spineCurrentRoll));
    spine.quaternion.multiply(spineQuat);
    state.spineAppliedQuat.copy(spineQuat);
  }

  // UPPER CHEST - Moderate head/chest tracking (reduced pitch to prevent excessive leaning)
  const targetYaw = state.bodyCursorX * 0.105 * state.influence * bodyCursorScale * chestGain;
  const targetPitch = -state.bodyCursorY * 0.11 * state.influence * bodyCursorScale * (0.55 + 0.55 * pitchStrength);

  // Smooth interpolation towards target with limits to prevent drift
  state.currentYaw += (targetYaw - state.currentYaw) * 0.42;
  state.currentPitch += (targetPitch - state.currentPitch) * 0.38;

  // Clamp cursor offsets to prevent excessive accumulation
  state.currentYaw = Math.max(-0.48, Math.min(0.48, state.currentYaw));
  state.currentPitch = Math.max(-0.68, Math.min(0.68, state.currentPitch));

  const torsoBone = getRawBone("upperChest") || getRawBone("chest") || getRawBone("spine");
  const cursorQuat = state.tempQuat.setFromEuler(state.tempEuler.set(state.currentPitch, state.currentYaw, -state.currentYaw * 0.08));
  if (torsoBone) torsoBone.quaternion.multiply(cursorQuat);
  state.chestAppliedQuat.copy(cursorQuat);

  const leftShoulder = getRawBone("leftShoulder");
  const rightShoulder = getRawBone("rightShoulder");
  if (leftShoulder && rightShoulder) {
    const shoulderTargetYaw = state.bodyCursorX * 0.07 * state.influence * shoulderScale * (0.35 + 0.75 * turnStrength);
    const shoulderTargetRoll = state.bodyCursorX * 0.04 * state.influence * shoulderScale * (0.35 + 0.7 * turnStrength);

    state.shoulderCurrentYaw += (shoulderTargetYaw - state.shoulderCurrentYaw) * 0.34;
    state.shoulderCurrentRoll += (shoulderTargetRoll - state.shoulderCurrentRoll) * 0.34;
    state.shoulderCurrentYaw = Math.max(-0.24, Math.min(0.24, state.shoulderCurrentYaw));
    state.shoulderCurrentRoll = Math.max(-0.2, Math.min(0.2, state.shoulderCurrentRoll));

    const leftQuat = state.tempQuat.setFromEuler(state.tempEuler.set(0, state.shoulderCurrentYaw * 0.55, state.shoulderCurrentRoll));
    const rightQuat = state.tempQuat2.setFromEuler(state.tempEuler2.set(0, state.shoulderCurrentYaw * 0.55, -state.shoulderCurrentRoll));

    leftShoulder.quaternion.multiply(leftQuat);
    rightShoulder.quaternion.multiply(rightQuat);
    state.leftShoulderAppliedQuat.copy(leftQuat);
    state.rightShoulderAppliedQuat.copy(rightQuat);
  }

  const leftUpperArm = getRawBone("leftUpperArm");
  const rightUpperArm = getRawBone("rightUpperArm");
  if (leftUpperArm && rightUpperArm) {
    const armSwing = state.bodyCursorX * 0.07 * state.influence * shoulderScale * (0.3 + 0.75 * turnStrength);
    const armLift = Math.max(0, -state.bodyCursorY) * 0.07 * state.influence * shoulderScale;
    const leftArmQuat = state.tempQuat.setFromEuler(state.tempEuler.set(-armLift, armSwing * 0.35, armSwing));
    const rightArmQuat = state.tempQuat2.setFromEuler(state.tempEuler2.set(-armLift, armSwing * 0.35, armSwing));
    leftUpperArm.quaternion.multiply(leftArmQuat);
    rightUpperArm.quaternion.multiply(rightArmQuat);
    state.leftUpperArmAppliedQuat.copy(leftArmQuat);
    state.rightUpperArmAppliedQuat.copy(rightArmQuat);
  }

  // Neck rotation - add extra movement between chest and head
  const neck = getRawBone("neck");
  if (neck) {
    const neckTargetYaw = cursorX * 0.24 * state.influence * neckCursorScale * neckGain;
    const neckTargetPitch = -cursorY * 0.075 * state.influence * neckCursorScale * (0.8 + 0.35 * pitchStrength);

    state.neckCurrentYaw += (neckTargetYaw - state.neckCurrentYaw) * 0.52;
    state.neckCurrentPitch += (neckTargetPitch - state.neckCurrentPitch) * 0.48;

    // Clamp neck offsets to prevent excessive accumulation
    state.neckCurrentYaw = Math.max(-0.74, Math.min(0.74, state.neckCurrentYaw));
    state.neckCurrentPitch = Math.max(-0.64, Math.min(0.64, state.neckCurrentPitch));

    const neckCursorQuat = state.tempQuat.setFromEuler(state.tempEuler.set(state.neckCurrentPitch, state.neckCurrentYaw, -state.neckCurrentYaw * 0.05));
    neck.quaternion.multiply(neckCursorQuat);
    state.neckAppliedQuat.copy(neckCursorQuat);
  }

  // Head/eyes are handled by VRM's built-in lookAt.target - no manual bone manipulation
}

function decayCursorTilt(vrm, character) {
  if (!cursorTiltState[character]) return;
  applyCursorTiltAndShift(vrm, character, 0);

  const state = cursorTiltState[character];
  if (
    state.influence < 0.01 &&
    Math.abs(state.modelAppliedYaw) < 0.001 &&
    Math.abs(state.modelAppliedPitch) < 0.001 &&
    (state.spineAppliedQuat || IDENTITY_QUATERNION).angleTo(IDENTITY_QUATERNION) < 0.001 &&
    state.chestAppliedQuat.angleTo(IDENTITY_QUATERNION) < 0.001 &&
    state.neckAppliedQuat.angleTo(IDENTITY_QUATERNION) < 0.001 &&
    state.headAppliedQuat.angleTo(IDENTITY_QUATERNION) < 0.001 &&
    (state.leftShoulderAppliedQuat || IDENTITY_QUATERNION).angleTo(IDENTITY_QUATERNION) < 0.001 &&
    (state.rightShoulderAppliedQuat || IDENTITY_QUATERNION).angleTo(IDENTITY_QUATERNION) < 0.001 &&
    (state.leftUpperArmAppliedQuat || IDENTITY_QUATERNION).angleTo(IDENTITY_QUATERNION) < 0.001 &&
    (state.rightUpperArmAppliedQuat || IDENTITY_QUATERNION).angleTo(IDENTITY_QUATERNION) < 0.001
  ) {
    resetCursorTilt(vrm, character);
  }
}

function resetSpeechBodyMotion(character, vrm = null) {
  const state = speechBodyMotionState[character];
  if (!state) return;
  const avatarVrm = vrm || current_avatars[character]?.vrm;
  const getRawBone = (boneName) => avatarVrm?.humanoid?.getRawBoneNode?.(boneName) || null;

  for (const [boneName, appliedQuat] of Object.entries(state.applied || {})) {
    const bone = getRawBone(boneName);
    if (bone && appliedQuat) {
      bone.quaternion.multiply(appliedQuat.clone().invert());
    }
  }

  delete speechBodyMotionState[character];
}

function applySpeechBodyMotion(vrm, character, deltaTime = 0.016, presenceProfile = null) {
  const avatar = current_avatars[character];
  if (!avatar || extension_settings.vrm.natural_idle !== true) {
    resetSpeechBodyMotion(character, vrm);
    return;
  }

  const active = presenceProfile?.speaking === true || presenceProfile?.speechRecovery === true || presenceProfile?.mode === 'listening';
  const getRawBone = (boneName) => vrm?.humanoid?.getRawBoneNode?.(boneName) || null;
  const chest = getRawBone('upperChest') || getRawBone('chest') || getRawBone('spine');
  const neck = getRawBone('neck');
  const head = getRawBone('head');
  if (!chest && !neck && !head) {
    resetSpeechBodyMotion(character, vrm);
    return;
  }

  let state = speechBodyMotionState[character];
  if (!state) {
    state = {
      time: Math.random() * 10,
      weight: 0,
      nodPulse: 0,
      nextListeningNodAt: Date.now() + 1800 + Math.random() * 4200,
      applied: {
        upperChest: new THREE.Quaternion(),
        chest: new THREE.Quaternion(),
        spine: new THREE.Quaternion(),
        neck: new THREE.Quaternion(),
        head: new THREE.Quaternion(),
      }
    };
    speechBodyMotionState[character] = state;
  }

  const now = Date.now();
  state.time += Math.max(0, deltaTime);
  const targetWeight = active ? 1 : 0;
  state.weight += (targetWeight - state.weight) * Math.min(1, deltaTime * (targetWeight > state.weight ? 5 : 7));

  const expressionMgr = avatar.vrm?.expressionManager;
  const visemeEnergy = expressionMgr ? Math.max(...VRM_VISEMES.map((name) => expressionMgr.getValue(name) || 0)) : 0;
  const textTalkActive = Number(avatar.talkEnd || 0) > now;
  const textEnergy = textTalkActive ? 0.35 + 0.25 * Math.sin((avatar.talkEnd - now) * 0.036) : 0;
  const speechEnergy = presenceProfile?.speaking ? Math.max(visemeEnergy, textEnergy, 0.22) : 0;

  if (presenceProfile?.mode === 'listening' && now >= state.nextListeningNodAt) {
    state.nodPulse = 1;
    state.nextListeningNodAt = now + 4200 + Math.random() * 7600;
  }
  state.nodPulse *= Math.pow(0.08, Math.max(0, deltaTime));

  const recoveryPulse = presenceProfile?.speechRecovery ? Math.max(0, 1 - ((now - (presenceState[character]?.speechEndedAt || now)) / 1200)) : 0;
  const phraseBob = Math.sin(state.time * 7.5) * speechEnergy * 0.014;
  const chestPitch = (-0.008 - phraseBob - recoveryPulse * 0.01) * state.weight;
  const neckPitch = (phraseBob * 0.65 + state.nodPulse * 0.026 - recoveryPulse * 0.012) * state.weight;
  const headPitch = (phraseBob * 0.5 + state.nodPulse * 0.034 - recoveryPulse * 0.018) * state.weight;
  const headYaw = Math.sin(state.time * 1.7) * speechEnergy * 0.018 * state.weight;

  const applyAdditive = (boneName, bone, targetEuler) => {
    if (!bone) return;
    const previous = state.applied[boneName] || new THREE.Quaternion();
    const baseQuat = bone.quaternion.clone().multiply(previous.clone().invert());
    const nextQuat = new THREE.Quaternion().setFromEuler(targetEuler);
    bone.quaternion.copy(baseQuat).multiply(nextQuat);
    state.applied[boneName] = nextQuat.clone();
  };

  const chestName = chest?.name === getRawBone('upperChest')?.name ? 'upperChest' : chest?.name === getRawBone('chest')?.name ? 'chest' : 'spine';
  applyAdditive(chestName, chest, new THREE.Euler(chestPitch, headYaw * 0.28, 0));
  applyAdditive('neck', neck, new THREE.Euler(neckPitch, headYaw * 0.55, 0));
  applyAdditive('head', head, new THREE.Euler(headPitch, headYaw, 0));

  if (!active && state.weight < 0.01) {
    resetSpeechBodyMotion(character, vrm);
  }
}

function getBoneQuaternionWithoutAmbientOffset(character, boneName, currentQuaternion) {
  let baseQuaternion = currentQuaternion.clone();
  const ambientState = ambientPresenceState[character];

  if (boneName === 'upperChest' && ambientState) {
    baseQuaternion.multiply(ambientState.chestAppliedQuat.clone().invert());
  }

  if (boneName === 'neck' && ambientState) {
    baseQuaternion.multiply(ambientState.neckAppliedQuat.clone().invert());
  }

  if (boneName === 'leftShoulder' && ambientState) {
    baseQuaternion.multiply((ambientState.leftShoulderAppliedQuat || new THREE.Quaternion()).clone().invert());
  }

  if (boneName === 'rightShoulder' && ambientState) {
    baseQuaternion.multiply((ambientState.rightShoulderAppliedQuat || new THREE.Quaternion()).clone().invert());
  }

  if (boneName === 'leftUpperArm' && ambientState) {
    baseQuaternion.multiply((ambientState.leftUpperArmAppliedQuat || new THREE.Quaternion()).clone().invert());
  }

  if (boneName === 'rightUpperArm' && ambientState) {
    baseQuaternion.multiply((ambientState.rightUpperArmAppliedQuat || new THREE.Quaternion()).clone().invert());
  }

  return baseQuaternion;
}

function getAmbientAppliedQuaternionForBone(character, boneName) {
  const state = ambientPresenceState[character];
  if (!state) {
    return new THREE.Quaternion();
  }

  if (boneName === 'upperChest') {
    return state.chestAppliedQuat.clone();
  }

  if (boneName === 'neck') {
    return state.neckAppliedQuat.clone();
  }

  if (boneName === 'leftShoulder') {
    return (state.leftShoulderAppliedQuat || new THREE.Quaternion()).clone();
  }

  if (boneName === 'rightShoulder') {
    return (state.rightShoulderAppliedQuat || new THREE.Quaternion()).clone();
  }

  if (boneName === 'leftUpperArm') {
    return (state.leftUpperArmAppliedQuat || new THREE.Quaternion()).clone();
  }

  if (boneName === 'rightUpperArm') {
    return (state.rightUpperArmAppliedQuat || new THREE.Quaternion()).clone();
  }

  return new THREE.Quaternion();
}

function getCombinedAdditiveQuaternionForBone(character, boneName) {
  return getAmbientAppliedQuaternionForBone(character, boneName);
}

function getModelRotationWithoutCursorOffset(character) {
  const objectContainer = current_avatars[character]?.["objectContainer"];
  if (!objectContainer) {
    return null;
  }

  const state = cursorTiltState[character];
  if (!state) {
    return {
      x: objectContainer.rotation.x,
      y: objectContainer.rotation.y,
      z: objectContainer.rotation.z,
    };
  }

  return {
    x: objectContainer.rotation.x - state.modelAppliedPitch,
    y: objectContainer.rotation.y - state.modelAppliedYaw,
    z: objectContainer.rotation.z,
  };
}

function resetCursorTilt(vrm, character) {
  if (!cursorTiltState[character]) return;

  const state = cursorTiltState[character];
  const avatar = current_avatars[character];
  const objectContainer = avatar?.["objectContainer"];

  // Remove additive model offsets and preserve model's own baseline rotation.
  if (objectContainer) {
    objectContainer.rotation.y -= state.modelAppliedYaw;
    objectContainer.rotation.x -= state.modelAppliedPitch;
  }

  // Raw-bone cursor offsets are frame-local after vrm.update(); the next update clears them.
  delete cursorTiltState[character];
}

function resetAmbientPresence(vrm, character) {
  const state = ambientPresenceState[character];
  if (!state) return;

  const avatar = current_avatars[character];
  const objectContainer = avatar?.["objectContainer"];
  if (objectContainer) {
    objectContainer.position.y -= state.modelAppliedY;
  }

  const torsoBone = getCachedTorsoControlBone(avatar);
  if (torsoBone) {
    torsoBone.quaternion.multiply(state.chestAppliedQuat.clone().invert());
  }

  const neck = getCachedBone(avatar, "neck");
  if (neck) {
    neck.quaternion.multiply(state.neckAppliedQuat.clone().invert());
  }

  const leftShoulder = getCachedBone(avatar, "leftShoulder");
  if (leftShoulder) {
    leftShoulder.quaternion.multiply((state.leftShoulderAppliedQuat || new THREE.Quaternion()).clone().invert());
  }

  const rightShoulder = getCachedBone(avatar, "rightShoulder");
  if (rightShoulder) {
    rightShoulder.quaternion.multiply((state.rightShoulderAppliedQuat || new THREE.Quaternion()).clone().invert());
  }

  const leftUpperArm = getCachedBone(avatar, "leftUpperArm");
  if (leftUpperArm) {
    leftUpperArm.quaternion.multiply((state.leftUpperArmAppliedQuat || new THREE.Quaternion()).clone().invert());
  }

  const rightUpperArm = getCachedBone(avatar, "rightUpperArm");
  if (rightUpperArm) {
    rightUpperArm.quaternion.multiply((state.rightUpperArmAppliedQuat || new THREE.Quaternion()).clone().invert());
  }

  delete ambientPresenceState[character];
}

function applyAmbientPresence(vrm, character, deltaTime, inactivityIntensity = 0, controlProfile = null, presenceProfile = null) {
  const avatar = current_avatars[character];
  const objectContainer = avatar?.["objectContainer"];
  const torsoBone = getCachedTorsoControlBone(avatar);
  const neck = getCachedBone(avatar, "neck");
  const leftShoulder = getCachedBone(avatar, "leftShoulder");
  const rightShoulder = getCachedBone(avatar, "rightShoulder");
  const leftUpperArm = getCachedBone(avatar, "leftUpperArm");
  const rightUpperArm = getCachedBone(avatar, "rightUpperArm");

  if (!objectContainer || !torsoBone || !neck) {
    if (ambientPresenceState[character]) {
      resetAmbientPresence(vrm, character);
    }
    return;
  }

  let state = ambientPresenceState[character];
  if (!state) {
    state = {
      time: Math.random() * 100,
      phase: Math.random() * Math.PI * 2,
      weight: 0,
      microShift: 0,
      microShiftTarget: 0,
      nextMicroShiftAt: 0,
      chestAppliedQuat: new THREE.Quaternion(),
      neckAppliedQuat: new THREE.Quaternion(),
      leftShoulderAppliedQuat: new THREE.Quaternion(),
      rightShoulderAppliedQuat: new THREE.Quaternion(),
      leftUpperArmAppliedQuat: new THREE.Quaternion(),
      rightUpperArmAppliedQuat: new THREE.Quaternion(),
      posturePitch: 0,
      postureYaw: 0,
      postureRoll: 0,
      neckPitch: 0,
      neckYaw: 0,
      modelAppliedY: 0
    };
    ambientPresenceState[character] = state;
  }

  state.time += Math.max(0, deltaTime);
  if (state.time >= state.nextMicroShiftAt) {
    state.microShiftTarget = (Math.random() * 2 - 1) * (0.012 + 0.018 * inactivityIntensity);
    state.nextMicroShiftAt = state.time + 3.5 + Math.random() * 4.5;
  }

  const shouldBeActive = extension_settings.vrm.natural_idle && isCharacterInIdleMotion(character);
  const control = controlProfile || getProceduralControlProfile(character);
  const presenceBaseIntensity = presenceProfile?.speaking ? 0.34 : presenceProfile?.mode === 'listening' ? 0.42 : presenceProfile?.mode === 'attentive' ? 0.18 : 0;
  const intensityScale = Math.pow(Math.max(presenceBaseIntensity, Math.min(1, inactivityIntensity)), 0.85);
  const targetWeight = shouldBeActive ? intensityScale * control.ambientWeight : 0;
  const weightBlendSpeed = targetWeight > state.weight ? 0.02 : 0.06;
  state.weight += (targetWeight - state.weight) * weightBlendSpeed;
  state.weight = Math.max(0, Math.min(1, state.weight));

  state.microShift += (state.microShiftTarget - state.microShift) * 0.01;

  const breath = Math.sin(state.time * 1.05 + state.phase) * (0.006 + 0.007 * inactivityIntensity) * state.weight;
  const sway = Math.sin(state.time * 0.42 + state.phase * 0.7) * (0.004 + 0.005 * inactivityIntensity) * state.weight;
  const microYaw = state.microShift * state.weight;
  const presenceMode = presenceProfile?.mode || 'relaxed';
  const postureTarget = {
    pitch: presenceMode === 'listening' ? -0.035 : presenceMode === 'speaking' ? -0.018 : presenceMode === 'thinking' ? 0.018 : presenceMode === 'attentive' ? -0.012 : 0,
    yaw: presenceMode === 'thinking' ? microYaw * 1.2 : microYaw * 0.45,
    roll: presenceMode === 'thinking' ? sway * 0.65 : sway * 0.28,
    neckPitch: presenceMode === 'listening' ? 0.026 : presenceMode === 'speaking' ? -0.01 : presenceMode === 'thinking' ? 0.035 : 0,
    neckYaw: presenceMode === 'thinking' ? microYaw * 0.95 : microYaw * 0.45,
  };
  const postureBlend = Math.min(1, Math.max(0.08, deltaTime * 5.5));
  state.posturePitch += (postureTarget.pitch - state.posturePitch) * postureBlend;
  state.postureYaw += (postureTarget.yaw - state.postureYaw) * postureBlend;
  state.postureRoll += (postureTarget.roll - state.postureRoll) * postureBlend;
  state.neckPitch += (postureTarget.neckPitch - state.neckPitch) * postureBlend;
  state.neckYaw += (postureTarget.neckYaw - state.neckYaw) * postureBlend;

  const chestBaseQuat = torsoBone.quaternion.clone().multiply(state.chestAppliedQuat.clone().invert());
  const chestAmbientEuler = new THREE.Euler(
    breath + sway * 0.18 + state.posturePitch,
    microYaw * 0.35 + state.postureYaw,
    sway * 0.32 + state.postureRoll
  );
  const chestAmbientQuat = new THREE.Quaternion().setFromEuler(chestAmbientEuler);
  torsoBone.quaternion.copy(chestBaseQuat).multiply(chestAmbientQuat);
  state.chestAppliedQuat.copy(chestAmbientQuat);

  const neckBaseQuat = neck.quaternion.clone().multiply(state.neckAppliedQuat.clone().invert());
  const neckAmbientEuler = new THREE.Euler(
    -breath * 0.3 + state.neckPitch,
    microYaw * 0.6 + state.neckYaw,
    -sway * 0.25
  );
  const neckAmbientQuat = new THREE.Quaternion().setFromEuler(neckAmbientEuler);
  neck.quaternion.copy(neckBaseQuat).multiply(neckAmbientQuat);
  state.neckAppliedQuat.copy(neckAmbientQuat);

  if (leftShoulder && rightShoulder && leftUpperArm && rightUpperArm) {
    const shoulderRoll = Math.sin(state.time * 0.76 + state.phase * 0.35) * (0.014 + 0.012 * inactivityIntensity) * state.weight;
    const shoulderYaw = Math.sin(state.time * 0.52 + state.phase * 0.9) * (0.012 + 0.01 * inactivityIntensity) * state.weight;
    const armSwing = Math.sin(state.time * 0.88 + state.phase * 1.2) * (0.02 + 0.015 * inactivityIntensity) * state.weight;

    const leftShoulderBase = leftShoulder.quaternion.clone().multiply((state.leftShoulderAppliedQuat || new THREE.Quaternion()).clone().invert());
    const rightShoulderBase = rightShoulder.quaternion.clone().multiply((state.rightShoulderAppliedQuat || new THREE.Quaternion()).clone().invert());
    const leftUpperArmBase = leftUpperArm.quaternion.clone().multiply((state.leftUpperArmAppliedQuat || new THREE.Quaternion()).clone().invert());
    const rightUpperArmBase = rightUpperArm.quaternion.clone().multiply((state.rightUpperArmAppliedQuat || new THREE.Quaternion()).clone().invert());

    const leftShoulderQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, shoulderYaw * 0.4, shoulderRoll));
    const rightShoulderQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, shoulderYaw * 0.4, -shoulderRoll));
    const leftUpperArmQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-armSwing, shoulderYaw * 0.25, shoulderRoll * 0.35));
    const rightUpperArmQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-armSwing, -shoulderYaw * 0.25, -shoulderRoll * 0.35));

    leftShoulder.quaternion.copy(leftShoulderBase).multiply(leftShoulderQuat);
    rightShoulder.quaternion.copy(rightShoulderBase).multiply(rightShoulderQuat);
    leftUpperArm.quaternion.copy(leftUpperArmBase).multiply(leftUpperArmQuat);
    rightUpperArm.quaternion.copy(rightUpperArmBase).multiply(rightUpperArmQuat);

    state.leftShoulderAppliedQuat.copy(leftShoulderQuat);
    state.rightShoulderAppliedQuat.copy(rightShoulderQuat);
    state.leftUpperArmAppliedQuat.copy(leftUpperArmQuat);
    state.rightUpperArmAppliedQuat.copy(rightUpperArmQuat);
  }

  const baseY = objectContainer.position.y - state.modelAppliedY;
  const targetY = Math.sin(state.time * 1.05 + state.phase * 0.5) * (0.0035 + 0.0035 * inactivityIntensity) * state.weight;
  state.modelAppliedY += (targetY - state.modelAppliedY) * 0.08;
  objectContainer.position.y = baseY + state.modelAppliedY;

  if (
    !shouldBeActive &&
    state.weight < 0.01 &&
    Math.abs(state.modelAppliedY) < 0.0005 &&
    state.chestAppliedQuat.angleTo(IDENTITY_QUATERNION) < 0.0008 &&
    state.neckAppliedQuat.angleTo(IDENTITY_QUATERNION) < 0.0008 &&
    (state.leftShoulderAppliedQuat || IDENTITY_QUATERNION).angleTo(IDENTITY_QUATERNION) < 0.0008 &&
    (state.rightShoulderAppliedQuat || IDENTITY_QUATERNION).angleTo(IDENTITY_QUATERNION) < 0.0008 &&
    (state.leftUpperArmAppliedQuat || IDENTITY_QUATERNION).angleTo(IDENTITY_QUATERNION) < 0.0008 &&
    (state.rightUpperArmAppliedQuat || IDENTITY_QUATERNION).angleTo(IDENTITY_QUATERNION) < 0.0008
  ) {
    resetAmbientPresence(vrm, character);
  }
}

function resetAmbientExpressionDynamics(character) {
  const state = ambientExpressionState[character];
  const expressionMgr = current_avatars[character]?.["vrm"]?.expressionManager;
  if (state && expressionMgr) {
    for (const expressionName of Object.keys(state.currentAdd || {})) {
      const current = expressionMgr.getValue(expressionName) || 0;
      const additive = state.currentAdd[expressionName] || 0;
      expressionMgr.setValue(expressionName, Math.max(0, current - additive));
    }
  }
  delete ambientExpressionState[character];
}

function resetSelfContactGuard(character, vrm = null) {
  const state = selfContactState[character];
  if (!state) return;

  const avatarVrm = vrm || current_avatars[character]?.vrm;
  if (avatarVrm) {
    for (const [boneName, appliedQuat] of Object.entries(state.applied || {})) {
      const bone = avatarVrm.humanoid?.getNormalizedBoneNode(boneName);
      if (bone && appliedQuat) {
        bone.quaternion.multiply(appliedQuat.clone().invert());
      }
    }
  }

  delete selfContactState[character];
}

function ensureSelfContactState(character) {
  let state = selfContactState[character];
  if (!state) {
    state = {
      leftWeight: 0,
      rightWeight: 0,
      applied: {
        leftUpperArm: new THREE.Quaternion(),
        leftLowerArm: new THREE.Quaternion(),
        rightUpperArm: new THREE.Quaternion(),
        rightLowerArm: new THREE.Quaternion(),
      }
    };
    selfContactState[character] = state;
  }
  return state;
}

function computeContactAvoidanceWeight(point, zones) {
  let strongest = 0;
  const delta = new THREE.Vector3();

  for (const zone of zones) {
    if (!zone.center || !Number.isFinite(zone.radius) || zone.radius <= 0) continue;
    delta.copy(point).sub(zone.center);
    const dist = delta.length();
    if (dist >= zone.radius) continue;
    const penetration = (zone.radius - dist) / zone.radius;
    strongest = Math.max(strongest, penetration * (zone.weight || 1));
  }

  return Math.max(0, Math.min(1, strongest));
}

function applyBoneContactOffset(bone, appliedQuat, targetEuler) {
  if (!bone || !appliedQuat) return;
  const baseQuat = bone.quaternion.clone().multiply(appliedQuat.clone().invert());
  const targetQuat = new THREE.Quaternion().setFromEuler(targetEuler);
  bone.quaternion.copy(baseQuat).multiply(targetQuat);
  appliedQuat.copy(targetQuat);
}

function getActiveIdleClipName(character) {
  const action = activeIdleAnimations[character];
  if (!action) return '';
  if (typeof action.getClip === 'function') {
    return action.getClip()?.name || '';
  }
  return action._clip?.name || '';
}

function applySelfContactGuard(vrm, character, deltaTime = 0.016, controlProfile = null) {
  const control = controlProfile || getProceduralControlProfile(character);
  if (control.selfContactWeight <= 0.001) {
    resetSelfContactGuard(character, vrm);
    return;
  }

  if (!vrm?.humanoid) {
    resetSelfContactGuard(character, vrm);
    return;
  }

  const leftHand = getHumanoidBoneNode(vrm, 'leftHand');
  const rightHand = getHumanoidBoneNode(vrm, 'rightHand');
  const leftUpperArm = getHumanoidBoneNode(vrm, 'leftUpperArm');
  const rightUpperArm = getHumanoidBoneNode(vrm, 'rightUpperArm');
  const leftLowerArm = getHumanoidBoneNode(vrm, 'leftLowerArm');
  const rightLowerArm = getHumanoidBoneNode(vrm, 'rightLowerArm');
  const upperChest = getHumanoidBoneNode(vrm, 'upperChest') || getHumanoidBoneNode(vrm, 'chest');
  const chest = getHumanoidBoneNode(vrm, 'chest') || upperChest;
  const leftUpperLeg = getHumanoidBoneNode(vrm, 'leftUpperLeg');
  const rightUpperLeg = getHumanoidBoneNode(vrm, 'rightUpperLeg');

  if (!leftHand || !rightHand || !leftUpperArm || !rightUpperArm || !leftLowerArm || !rightLowerArm || !upperChest) {
    resetSelfContactGuard(character, vrm);
    return;
  }

  const state = ensureSelfContactState(character);
  const chestForward = new THREE.Vector3(0, 0, 1).applyQuaternion(upperChest.getWorldQuaternion(new THREE.Quaternion())).multiplyScalar(0.055);
  const chestCenter = upperChest.getWorldPosition(new THREE.Vector3()).add(chestForward);
  const chestCenterSecondary = chest ? chest.getWorldPosition(new THREE.Vector3()).add(chestForward.clone().multiplyScalar(0.7)) : chestCenter.clone();
  const leftThighCenter = leftUpperLeg ? leftUpperLeg.getWorldPosition(new THREE.Vector3()) : null;
  const rightThighCenter = rightUpperLeg ? rightUpperLeg.getWorldPosition(new THREE.Vector3()) : null;

  if (leftThighCenter) {
    leftThighCenter.add(new THREE.Vector3(0.015, 0.02, 0.045));
  }
  if (rightThighCenter) {
    rightThighCenter.add(new THREE.Vector3(-0.015, 0.02, 0.045));
  }

  const leftHandPos = leftHand.getWorldPosition(new THREE.Vector3());
  const rightHandPos = rightHand.getWorldPosition(new THREE.Vector3());

  const leftWeightTarget = computeContactAvoidanceWeight(leftHandPos, [
    { center: chestCenter, radius: 0.19, weight: 1.0 },
    { center: chestCenterSecondary, radius: 0.17, weight: 0.9 },
    { center: leftThighCenter, radius: 0.16, weight: 0.85 },
  ]);

  const rightWeightTarget = computeContactAvoidanceWeight(rightHandPos, [
    { center: chestCenter, radius: 0.19, weight: 1.0 },
    { center: chestCenterSecondary, radius: 0.17, weight: 0.9 },
    { center: rightThighCenter, radius: 0.16, weight: 0.85 },
  ]);

  const upRate = 0.24;
  const downRate = 0.16;
  const leftBlend = leftWeightTarget > state.leftWeight ? upRate : downRate;
  const rightBlend = rightWeightTarget > state.rightWeight ? upRate : downRate;
  const dtScale = Math.max(0.45, Math.min(1.75, deltaTime * 60));

  const activationDeadzone = 0.22;
  const maxAvoidanceWeight = 0.5;
  const leftGoal = (leftWeightTarget <= activationDeadzone ? 0 : Math.min(maxAvoidanceWeight, (leftWeightTarget - activationDeadzone) / (1 - activationDeadzone))) * control.selfContactWeight;
  const rightGoal = (rightWeightTarget <= activationDeadzone ? 0 : Math.min(maxAvoidanceWeight, (rightWeightTarget - activationDeadzone) / (1 - activationDeadzone))) * control.selfContactWeight;

  state.leftWeight += (leftGoal - state.leftWeight) * leftBlend * dtScale;
  state.rightWeight += (rightGoal - state.rightWeight) * rightBlend * dtScale;
  state.leftWeight = Math.max(0, Math.min(1, state.leftWeight));
  state.rightWeight = Math.max(0, Math.min(1, state.rightWeight));

  const leftUpperEuler = new THREE.Euler(
    -0.03 * state.leftWeight,
    0.17 * state.leftWeight,
    0.15 * state.leftWeight
  );
  const leftLowerEuler = new THREE.Euler(
    -0.02 * state.leftWeight,
    0.1 * state.leftWeight,
    0.09 * state.leftWeight
  );

  const rightUpperEuler = new THREE.Euler(
    -0.03 * state.rightWeight,
    -0.17 * state.rightWeight,
    -0.15 * state.rightWeight
  );
  const rightLowerEuler = new THREE.Euler(
    -0.02 * state.rightWeight,
    -0.1 * state.rightWeight,
    -0.09 * state.rightWeight
  );

  applyBoneContactOffset(leftUpperArm, state.applied.leftUpperArm, leftUpperEuler);
  applyBoneContactOffset(leftLowerArm, state.applied.leftLowerArm, leftLowerEuler);
  applyBoneContactOffset(rightUpperArm, state.applied.rightUpperArm, rightUpperEuler);
  applyBoneContactOffset(rightLowerArm, state.applied.rightLowerArm, rightLowerEuler);

  if (
    state.leftWeight < 0.005 &&
    state.rightWeight < 0.005 &&
    state.applied.leftUpperArm.angleTo(IDENTITY_QUATERNION) < 0.001 &&
    state.applied.leftLowerArm.angleTo(IDENTITY_QUATERNION) < 0.001 &&
    state.applied.rightUpperArm.angleTo(IDENTITY_QUATERNION) < 0.001 &&
    state.applied.rightLowerArm.angleTo(IDENTITY_QUATERNION) < 0.001
  ) {
    resetSelfContactGuard(character, vrm);
  }
}

function isAmbientExpressionCompatible(character) {
  const baseExpression = current_avatars[character]?.["expression"];
  if (!baseExpression || baseExpression === "none") return true;
  return baseExpression === "neutral" || baseExpression === "relaxed" || baseExpression === "happy";
}

function pickAmbientExpressionMode(presenceMode = 'relaxed') {
  if (presenceMode === 'speaking') return Math.random() < 0.72 ? 'engaged' : 'soft';
  if (presenceMode === 'listening') return Math.random() < 0.68 ? 'attentive' : 'curious';
  if (presenceMode === 'thinking') return Math.random() < 0.7 ? 'thoughtful' : 'curious';
  const roll = Math.random();
  if (roll < 0.44) return "soft";
  if (roll < 0.72) return "thoughtful";
  if (roll < 0.9) return "giggly";
  return "bashful";
}

function getAmbientExpressionAdditions(mode, time) {
  if (mode === "soft") {
    return {
      relaxed: 0.08 + Math.sin(time * 0.55) * 0.012,
      happy: 0.035
    };
  }

  if (mode === "attentive") {
    return {
      relaxed: 0.055,
      surprised: 0.025 + Math.sin(time * 0.7) * 0.008
    };
  }

  if (mode === "curious") {
    return {
      surprised: 0.045 + Math.sin(time * 0.85) * 0.012,
      relaxed: 0.055
    };
  }

  if (mode === "engaged") {
    return {
      happy: 0.07 + Math.sin(time * 1.6) * 0.018,
      relaxed: 0.045
    };
  }

  if (mode === "thoughtful") {
    return {
      relaxed: 0.09 + Math.sin(time * 0.6) * 0.015,
      surprised: 0.015
    };
  }

  if (mode === "giggly") {
    return {
      happy: 0.15 + Math.sin(time * 2.1) * 0.03,
      relaxed: 0.07
    };
  }

  if (mode === "bashful") {
    return {
      relaxed: 0.11,
      happy: 0.06 + Math.sin(time * 0.9) * 0.01,
      surprised: 0.03
    };
  }

  return {};
}

function applyAmbientExpressionDynamics(character, deltaTime, inactivityIntensity = 0, presenceProfile = null) {
  const avatar = current_avatars[character];
  const expressionMgr = avatar?.["vrm"]?.expressionManager;
  if (!expressionMgr) {
    delete ambientExpressionState[character];
    return;
  }

  const presenceMode = presenceProfile?.mode || 'relaxed';
  const shouldBeActive = extension_settings.vrm.natural_idle &&
    isCharacterInIdleMotion(character) &&
    isAmbientExpressionCompatible(character) &&
    !current_avatars[character]?.customWinking &&
    (presenceProfile?.speaking ? true : inactivityIntensity > 0.04 || presenceProfile?.recentlyActive === true);

  let state = ambientExpressionState[character];
  if (!state) {
    state = {
      time: Math.random() * 100,
      mode: null,
      modeWeight: 0,
      modeUntil: 0,
      nextModeAt: 0,
      currentAdd: {
        happy: 0,
        relaxed: 0,
        surprised: 0
      }
    };
    ambientExpressionState[character] = state;
  }

  state.time += Math.max(0, deltaTime);

  if (shouldBeActive) {
    const modeBias = presenceMode === 'speaking' || presenceMode === 'listening' ? 0.07 : 0.04;
    const triggerChance = (modeBias + 0.08 * Math.max(0.15, inactivityIntensity)) * Math.min(1, Math.max(0.2, deltaTime * 60));
    if (!state.mode && state.time >= state.nextModeAt && Math.random() < triggerChance) {
      state.mode = pickAmbientExpressionMode(presenceMode);
      state.modeUntil = state.time + 2.2 + Math.random() * (presenceMode === 'speaking' ? 1.8 : 2.8);
    }
    if (state.mode && state.time >= state.modeUntil) {
      state.mode = null;
      state.nextModeAt = state.time + (presenceMode === 'speaking' ? 3.5 : 6.5) + Math.random() * 5.5;
    }
  } else {
    state.mode = null;
  }

  const activityWeight = presenceProfile?.speaking ? 0.45 : presenceProfile?.recentlyActive ? 0.38 : Math.max(0, Math.min(1, inactivityIntensity));
  const targetModeWeight = shouldBeActive && state.mode ? activityWeight : 0;
  const modeBlendSpeed = targetModeWeight > state.modeWeight ? 0.03 : 0.05;
  state.modeWeight += (targetModeWeight - state.modeWeight) * modeBlendSpeed;
  state.modeWeight = Math.max(0, Math.min(1, state.modeWeight));

  const targetAdd = { happy: 0, relaxed: 0, surprised: 0 };
  if (state.mode && state.modeWeight > 0.001) {
    const modeAdd = getAmbientExpressionAdditions(state.mode, state.time);
    for (const key of Object.keys(targetAdd)) {
      targetAdd[key] = Math.max(0, (modeAdd[key] || 0) * state.modeWeight * (0.7 + 0.6 * inactivityIntensity));
    }
  }

  for (const expressionName of Object.keys(targetAdd)) {
    const prevAdd = state.currentAdd[expressionName] || 0;
    const current = expressionMgr.getValue(expressionName) || 0;
    const baseValue = Math.max(0, current - prevAdd);
    const nextAdd = prevAdd + (targetAdd[expressionName] - prevAdd) * 0.08;
    state.currentAdd[expressionName] = Math.max(0, nextAdd);
    expressionMgr.setValue(expressionName, Math.min(1, baseValue + state.currentAdd[expressionName]));
  }

  if (!shouldBeActive && state.modeWeight < 0.01) {
    resetAmbientExpressionDynamics(character);
  }
}

// animate
function syncCharacterCollisionProxies(character, includeHitboxes = false) {
    const avatar = current_avatars[character];
    if (!avatar) {
        return;
    }

    const vrm = avatar["vrm"];
    const objectContainer = avatar["objectContainer"];
    const collider = avatar["collider"];
    const hips = vrm?.humanoid?.getNormalizedBoneNode("hips");

    if (!objectContainer || !collider || !hips) {
        return;
    }

    hips.getWorldPosition(collider.position);
    hips.getWorldQuaternion(collider.quaternion);
    collider.scale.copy(objectContainer.scale);

    if (!includeHitboxes) {
        return;
    }

    for (const body_part in avatar["hitboxes"]) {
        const bone = vrm.humanoid?.getNormalizedBoneNode(HITBOXES[body_part]["bone"]);
        if (bone !== null) {
            const hitboxContainer = avatar["hitboxes"][body_part]["offsetContainer"];
            bone.getWorldPosition(hitboxContainer.position);
            bone.getWorldQuaternion(hitboxContainer.quaternion);
            hitboxContainer.scale.copy(objectContainer.scale);
        }
    }
}

function hasRunningIdleFrameJobs() {
    return Object.values(idleFrameJobs).some((jobs) => jobs?.size > 0);
}

function hasVisiblePhoneProp() {
    return Object.values(current_avatars).some((avatar) => avatar?.phoneProp?.visible);
}

function hasRunningMixerAction(mixer) {
    const actions = Array.isArray(mixer?._actions) ? mixer._actions : [];
    return actions.some((action) => action?.enabled && (!action.isRunning || action.isRunning()));
}

function isCallOverlayVisible(nowMs = Date.now()) {
    if (nowMs - lastCallOverlayVisibilityCheckAt < 500) {
        return callOverlayVisibleCached;
    }
    lastCallOverlayVisibilityCheckAt = nowMs;

    const overlay = document.getElementById('voiceforge_call_overlay');
    if (!overlay || overlay.classList.contains('vf-overlay-no-effects')) {
        callOverlayVisibleCached = false;
        return false;
    }

    const style = window.getComputedStyle(overlay);
    callOverlayVisibleCached = style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
    return callOverlayVisibleCached;
}

function applyVrmRenderQuality(nowMs = Date.now()) {
    if (!renderer) {
        return;
    }

    const maxPixelRatio = (nowMs < vrmLowQualityUntil || isCallOverlayVisible(nowMs))
        ? VRM_LOW_LOAD_PIXEL_RATIO
        : VRM_MAX_PIXEL_RATIO;
    const targetPixelRatio = Math.max(1, Math.min(window.devicePixelRatio || 1, maxPixelRatio));
    if (Math.abs(targetPixelRatio - appliedVrmPixelRatio) < 0.01) {
        return;
    }

    renderer.setPixelRatio(targetPixelRatio);
    appliedVrmPixelRatio = targetPixelRatio;
}

function getVrmFrameInterval(nowMs) {
    if (Object.keys(current_avatars).length === 0) {
        return VRM_IDLE_FRAME_INTERVAL_MS;
    }

    if (isAnyCharacterSpeaking(nowMs) || realtimeLipSyncActive || hasRunningIdleFrameJobs() || isChestJiggleEnabled()) {
        return isCallOverlayVisible(nowMs) ? VRM_OVERLAY_ACTIVE_FRAME_INTERVAL_MS : VRM_ACTIVE_FRAME_INTERVAL_MS;
    }

    if (
        cursorTrackingEnabled ||
        extension_settings.vrm.show_grid ||
        hasVisiblePhoneProp() ||
        Object.values(current_avatars).some((avatar) => hasRunningMixerAction(avatar?.animation_mixer))
    ) {
        return VRM_DEFAULT_FRAME_INTERVAL_MS;
    }

    return VRM_IDLE_FRAME_INTERVAL_MS;
}

function shouldRunThrottledUpdate(avatar, key, nowMs, intervalMs) {
    const prop = `_last${key}At`;
    const lastAt = Number(avatar?.[prop] || 0);
    if ((nowMs - lastAt) < intervalMs) {
        return false;
    }
    avatar[prop] = nowMs;
    return true;
}

function animate() {
    requestAnimationFrame( animate );
    if (renderer !== undefined && scene !== undefined && camera !== undefined) {
        const nowMs = Date.now();
        const frameInterval = getVrmFrameInterval(nowMs);
        if (lastVrmFrameAt > 0 && (nowMs - lastVrmFrameAt) < frameInterval) {
            return;
        }
        lastVrmFrameAt = nowMs;

        const deltaTime = clock.getDelta();
        applyVrmRenderQuality(nowMs);

        if (isAnyCharacterSpeaking(nowMs) && nowMs - lastSpeechActivityPingAt > 250) {
            markUserActivity("speech");
            lastSpeechActivityPingAt = nowMs;
        }
        const inactivityIntensity = updateInactivityIntensity(deltaTime);

        if (cursorTrackingEnabled) {
            updateCursorTracking();
        }

        for(const character in current_avatars) {
            const avatar = current_avatars[character];
            const vrm = avatar["vrm"];
            const mixer = avatar["animation_mixer"];
            const lookAtState = getLookAtStateForCharacter(character);
            const proceduralControl = getProceduralControlProfile(character);
            const presenceProfile = getPresenceProfile(character, nowMs, inactivityIntensity);
            removeAppliedChestJigglePose(avatar);

            // Set lookAt target before the final VRM update.
            vrm.lookAt.target = lookAtState.target;

            mixer.update( deltaTime );
            
            applyAmbientPresence(vrm, character, deltaTime, inactivityIntensity, proceduralControl, presenceProfile);
            applyAmbientExpressionDynamics(character, deltaTime, inactivityIntensity, presenceProfile);
            applySelfContactGuard(vrm, character, deltaTime, proceduralControl);
            updateIdleFrameJobs(character, nowMs, deltaTime);
            updateTextTalkMouth(character, vrm, nowMs);
            if (realtimeLipSyncActive && realtimeLipSyncCharacter === character) {
                updateRealtimeLipSync(nowMs);
            }

            vrm.update( deltaTime );
            // Raw-bone cursor offsets must run after VRM sync so idles cannot invert stale offsets.
            if (cursorTrackingEnabled && extension_settings.vrm.follow_cursor) {
                const cursorBodyWeight = getCursorBodyFollowWeight(character, inactivityIntensity);
                applyCursorTiltAndShift(vrm, character, lookAtState.cursorInfluence * cursorBodyWeight, proceduralControl);
            } else {
                decayCursorTilt(vrm, character);
            }
            applySpeechBodyMotion(vrm, character, deltaTime, presenceProfile);
            if (vrm?.meta?.metaVersion === 'fbx' && shouldRunThrottledUpdate(avatar, 'FbxPoseDebug', nowMs, 1200)) {
                console.debug(DEBUG_PREFIX, 'FBX hips bone:', vrm.humanoid?.getRawBoneNode?.('hips')?.name);
            }
            applyChestJiggle(avatar, character, deltaTime);

            const shouldSyncCollisionProxies = extension_settings.vrm.show_grid;
            if (shouldSyncCollisionProxies && shouldRunThrottledUpdate(avatar, 'HelperSync', nowMs, VRM_HELPER_SYNC_INTERVAL_MS)) {
                syncCharacterCollisionProxies(character, extension_settings.vrm.hitboxes);
            }

            if (avatar._gridVisible !== shouldSyncCollisionProxies) {
                avatar["collider"].visible = shouldSyncCollisionProxies;
                for (const body_part in avatar["hitboxes"]) {
                    avatar["hitboxes"][body_part]["offsetContainer"].visible = shouldSyncCollisionProxies;
                }
                avatar._gridVisible = shouldSyncCollisionProxies;
            }

            if (avatar.phoneProp?.visible && shouldRunThrottledUpdate(avatar, 'PhoneSync', nowMs, VRM_PHONE_SYNC_INTERVAL_MS)) {
                updatePhonePropTransform(character);
            }
        }
        // Show/hide helper grid
        if (lastAppliedGridVisible !== extension_settings.vrm.show_grid) {
            gridHelper.visible = extension_settings.vrm.show_grid;
            axesHelper.visible = extension_settings.vrm.show_grid;
            lastAppliedGridVisible = extension_settings.vrm.show_grid;
        }

        renderer.render( scene, camera );
    }
}

animate();

async function loadScene() {
    for (const character of Object.keys(current_avatars)) {
        await unloadModel(character);
    }

    if (renderer) {
        renderer.dispose();
        if (typeof renderer.forceContextLoss === 'function') {
            renderer.forceContextLoss();
        }
    }

    clock = new THREE.Clock();
    current_avatars = {};
    models_cache = {};
    animations_cache = {};
    for (const character in socialLookState) {
        delete socialLookState[character];
    }
    for (const character in cursorBodyFollowState) {
        delete cursorBodyFollowState[character];
    }
    for (const character in ambientPresenceState) {
        delete ambientPresenceState[character];
    }
    for (const character in ambientExpressionState) {
        delete ambientExpressionState[character];
    }
    for (const character in selfContactState) {
        delete selfContactState[character];
    }
    for (const character in presenceState) {
        delete presenceState[character];
    }
    for (const character in eyeMicroMotionState) {
        clearEyeMicroMotion(character);
    }
    for (const character in speechBodyMotionState) {
        delete speechBodyMotionState[character];
    }
    const instanceId = currentInstanceId + 1;
    currentInstanceId = instanceId;

    // Delete the canvas
    if (document.getElementById(VRM_CANVAS_ID) !== null) {
        document.getElementById(VRM_CANVAS_ID).remove();
        // Hide sprite divs
    }
    
    $('#' + SPRITE_DIV).addClass('vrm-hidden');
    $('#' + VN_MODE_DIV).addClass('vrm-hidden');

    globalThis.console.log('[vrm:loadScene] extension_settings.vrm.enabled =', extension_settings.vrm.enabled);
    globalThis.console.log('[vrm:loadScene] extension_settings keys =', Object.keys(extension_settings));
    globalThis.console.log('[vrm:loadScene] extension_settings.vrm keys =', Object.keys(extension_settings.vrm));
    if (!extension_settings.vrm.enabled) {
        globalThis.console.log('[vrm:loadScene] enabled is false, returning early');
        $('#' + SPRITE_DIV).removeClass('vrm-hidden');
        $('#' + VN_MODE_DIV).removeClass('vrm-hidden');
        return
    }
    globalThis.console.log('[vrm:loadScene] enabled is true, WILL create canvas');

    clock.start();
    lastVrmFrameAt = 0;
    vrmLowQualityUntil = Date.now() + VRM_LOAD_SETTLE_MS;

    // renderer
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setSize( window.innerWidth, window.innerHeight );
    appliedVrmPixelRatio = Math.min(window.devicePixelRatio || 1, VRM_LOW_LOAD_PIXEL_RATIO);
    renderer.setPixelRatio( appliedVrmPixelRatio );
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.88;
    renderer.domElement.id = VRM_CANVAS_ID;
    document.body.appendChild( renderer.domElement );

    // camera
    camera = new THREE.PerspectiveCamera( 50.0, window.innerWidth / window.innerHeight, 0.1, 100.0 );
    //const camera = new THREE.PerspectiveCamera( 60, window.innerWidth / window.innerHeight, 1, 1000 );
    camera.position.set( 0.0, 1.0, 5.0 );

    // camera controls
    //const controls = new OrbitControls( camera, renderer.domElement );
    //controls.screenSpacePanning = true;
    //controls.target.set( 0.0, 1.0, 0.0 );
    //controls.update();

    // scene
    scene = new THREE.Scene();
    
    // Grid debuging helpers
    scene.add( gridHelper );
    scene.add( axesHelper );
    gridHelper.visible = extension_settings.vrm.show_grid;
    axesHelper.visible = extension_settings.vrm.show_grid;

    // light
    light = new THREE.DirectionalLight();
    fillLight = new THREE.DirectionalLight();
    rimLight = new THREE.DirectionalLight();
    ambientLight = new THREE.HemisphereLight(0xffffff, 0x25202a, 0.45);
    setLight(extension_settings.vrm.light_color, extension_settings.vrm.light_intensity);
    scene.add( ambientLight );
    scene.add( fillLight );
    scene.add( rimLight );
    scene.add( light );

    // lookat target
    camera.add( lookAtTarget );
    camera.add( cursorTarget );
    camera.add( blendedTarget );

    //current_characters = currentChatMembers();
    //await loadAllModels(current_characters);

    //console.debug(DEBUG_PREFIX,"DEBUG",renderer);
}

async function loadAllModels(current_characters) {
    const desiredModels = new Map();

    if (extension_settings.vrm.enabled) {
        for (const character of current_characters) {
            const model_path = extension_settings.vrm.character_model_mapping[character];
            if (model_path !== undefined && model_path !== 'none') {
                desiredModels.set(character, model_path);
            }
        }
    }

    for (const [character, avatar] of Object.entries(current_avatars)) {
        const desiredPath = desiredModels.get(character);
        if (!desiredPath || avatar.model_path !== desiredPath) {
            await unloadModel(character);
        }
    }

    if (!extension_settings.vrm.enabled) {
        return;
    }

    for (const [character, model_path] of desiredModels.entries()) {
        if (current_avatars[character] === undefined) {
            await setModel(character, model_path);
        }
    }
}

async function setModel(character,model_path) {
    let model;
    // Model is cached
    if (models_cache[model_path] !== undefined) {
        model = models_cache[model_path];
        await initModel(model);
    }
    else {
        model = await loadModel(model_path);
    }

    await unloadModel(character);

    // Error occured
    if (model === null) {
        extension_settings.vrm.character_model_mapping[character] = undefined;
        return;
    }

    // Set as character model and start animations
    modelId++;
    current_avatars[character] = model;
    current_avatars[character]["id"] = modelId;
    current_avatars[character]["objectContainer"].name = VRM_CONTAINER_NAME+"_"+character;
    current_avatars[character]["collider"].name = VRM_COLLIDER_NAME+"_"+character;

    // Load default expression/motion
    const isFbxAvatar = model?.vrm?.meta?.metaVersion === 'fbx' || /\.fbx$/i.test(model_path);
    const settings = resolveVrmModelSettings(model_path);
    const expression = settings.animation_default.expression;
    const motion = resolveDefaultIdleMotion(model_path);

    if (expression !== undefined && expression != "none") {
        console.debug(DEBUG_PREFIX,"Set default expression to",expression);
        await setExpression(character, expression);
    }
    if (motion !== undefined && motion != "none") {
        console.debug(DEBUG_PREFIX,"Set default motion to",motion);
        await setMotion(character, motion, true);
    }

    if (extension_settings.vrm.blink)
        blink(character, modelId);
    textTalk(character, modelId);
    markUserActivity("model-load");
    vrmLowQualityUntil = Date.now() + VRM_LOAD_SETTLE_MS;
    suspendNaturalIdle(character, 800);
    scheduleNaturalIdleCheck(character, modelId, 900, "model-load");
    current_avatars[character]["objectContainer"].visible = true;
    current_avatars[character]["collider"].visible = extension_settings.vrm.show_grid;
    
    scene.add(current_avatars[character]["objectContainer"]);
    scene.add(current_avatars[character]["collider"]);
    for(const hitbox in current_avatars[character]["hitboxes"])
        scene.add(current_avatars[character]["hitboxes"][hitbox]["offsetContainer"]);

    triggerLoadGreetingMotion(character, model_path, modelId);
}

async function unloadModel(character) {
    // unload existing model
    if (current_avatars[character] !== undefined) {
        console.debug(DEBUG_PREFIX,"Unloading avatar of",character);
        clearChestJiggle(current_avatars[character]);
        const container = current_avatars[character]["objectContainer"];
        const collider = current_avatars[character]["collider"];
        const phoneProp = current_avatars[character]["phoneProp"];

        scene.remove(scene.getObjectByName(container.name));
        scene.remove(scene.getObjectByName(collider.name));
        if (phoneProp) {
            if (phoneProp.parent) {
                phoneProp.parent.remove(phoneProp);
            }
            if (!extension_settings.vrm.models_cache) {
                disposePhonePropObject(phoneProp);
            }
        }
        for(const hitbox in current_avatars[character]["hitboxes"]) {
            console.debug(DEBUG_PREFIX,"REMOVING",current_avatars[character]["hitboxes"][hitbox]["offsetContainer"])
            scene.remove(scene.getObjectByName(current_avatars[character]["hitboxes"][hitbox]["offsetContainer"].name));
        }

        // unload animations
        current_avatars[character]["animation_mixer"].stopAllAction();
        if (current_avatars[character]["motion"]["animation"]  !== null) {
            current_avatars[character]["motion"]["animation"].stop();
            current_avatars[character]["motion"]["animation"].terminated = true;
            current_avatars[character]["motion"]["animation"] = null;
        }

        clearNaturalIdleTimer(character);

    clearAnimationSequence(character);
    clearAnimationManagerTimeouts(character);
    clearAllManagedCharacterTimers(character);

    if (activeNaturalMovements[character]) {
        delete activeNaturalMovements[character];
    }
    
  // Clear idle animation for this character
  if (activeIdleAnimations[character]) {
    if (activeIdleAnimations[character].isRunning && activeIdleAnimations[character].fadeOut) {
      activeIdleAnimations[character].fadeOut(ANIMATION_FADE_TIME);
    }
    if (activeIdleAnimations[character].stop) {
      activeIdleAnimations[character].stop();
    }
    delete activeIdleAnimations[character];
  }

  restoreIdleBasePoses(character, current_avatars[character]["vrm"], { immediate: true });

  // Clear VRMA base poses for this character
  if (vrmaBoneBasePoses[character]) {
    delete vrmaBoneBasePoses[character];
  }

  // Clear VRMA base Y position for this character
  if (vrmaBaseYPosition[character]) {
    delete vrmaBaseYPosition[character];
  }

  // Clear idle completion time for this character
  if (lastIdleCompletionTime[character]) {
    delete lastIdleCompletionTime[character];
  }

  if (nextIdleEligibleTime[character]) {
    delete nextIdleEligibleTime[character];
  }

  if (proceduralState[character]) {
    delete proceduralState[character];
  }

  if (socialLookState[character]) {
    delete socialLookState[character];
  }

  if (cursorBodyFollowState[character] !== undefined) {
    delete cursorBodyFollowState[character];
  }

  if (realtimeLipSyncCharacter === character) {
    stopRealtimeLipSync();
  }

  if (expressionBlendJobs[character]) {
    delete expressionBlendJobs[character];
  }

  if (idlePoseBlendJobs[character]) {
    delete idlePoseBlendJobs[character];
  }

  if (modelRotationJobs[character]) {
    delete modelRotationJobs[character];
  }

  clearIdleFrameJobs(character);

  if (cursorTiltState[character]) {
    resetCursorTilt(current_avatars[character]["vrm"], character);
  }

  if (ambientPresenceState[character]) {
    resetAmbientPresence(current_avatars[character]["vrm"], character);
  }

  if (ambientExpressionState[character]) {
    resetAmbientExpressionDynamics(character);
  }

  if (selfContactState[character]) {
    resetSelfContactGuard(character, current_avatars[character]["vrm"]);
  }

  if (speechBodyMotionState[character]) {
    resetSpeechBodyMotion(character, current_avatars[character]["vrm"]);
  }

  delete presenceState[character];
  clearEyeMicroMotion(character);

  if (animationManagerState[character]) {
    delete animationManagerState[character];
  }

  delete current_avatars[character];

        container.visible = false;
        collider.visible = false;
        if (!extension_settings.vrm.models_cache) {
            await container.traverse(obj => obj.dispose?.());
            await collider.traverse(obj => obj.dispose?.());
        }
    }
}

async function loadModel(model_path) { // Only cache the model if character=null
    const isFbx = /\.fbx$/i.test(model_path);
    let vrm, vrmMetaVersion, hipsHeight, sceneToUse, modelSettings;

    if (isFbx) {
        console.debug(DEBUG_PREFIX, 'Loading FBX model from', model_path);
        const fbxBasePath = fbxResourceBase(model_path);
        const manager = new THREE.LoadingManager();
        manager.setURLModifier((url) => fbxSidecarTextureUrl(url, fbxBasePath));
        const loader = new FBXLoader(manager);
        loader.setResourcePath(fbxBasePath);
        let fbxGroup;
        try {
            const response = await fetch(model_path, { cache: 'no-store' });
            if (!response.ok) throw new Error(`FBX asset request failed (${response.status}) for ${model_path}`);
            const contentType = response.headers.get('content-type') || '';
            const buffer = await response.arrayBuffer();
            if (!buffer.byteLength) throw new Error(`FBX asset is empty: ${model_path}`);
            const headerText = new TextDecoder().decode(buffer.slice(0, Math.min(buffer.byteLength, 256))).trimStart().toLowerCase();
            if (contentType.includes('text/html') || headerText.startsWith('<!doctype') || headerText.startsWith('<html')) {
                throw new Error(`FBX URL returned HTML instead of an FBX file: ${model_path}`);
            }
            fbxGroup = loader.parse(buffer, fbxBasePath);
            fbxGroup.traverse((obj) => { obj.frustumCulled = false; });
            // FBX exports can arrive in centimeter-scale units. Only shrink oversized
            // imports here; user model scale remains the source of truth for sizing.
            const box = new THREE.Box3().setFromObject(fbxGroup);
            const rawHeight = box.max.y - box.min.y;
            const TARGET_HEIGHT = 1.8;
            const autoScale = (rawHeight > TARGET_HEIGHT) ? Math.max(0.001, TARGET_HEIGHT / rawHeight) : 1;
            if (autoScale !== 1) {
                console.debug(DEBUG_PREFIX, 'Auto-scaling FBX model from height', rawHeight.toFixed(2), 'by factor', autoScale.toFixed(4));
                fbxGroup.scale.set(autoScale, autoScale, autoScale);
            }
            // VRChat/Unity avatar FBX packages already use a usable forward axis for
            // this stage. Keep package orientation intact; forcing a correction here
            // turns Unity avatars sideways.
            fbxGroup.updateMatrixWorld(true);
            const finalNormalization = normalizeFbxRenderedHeight(fbxGroup, TARGET_HEIGHT, 'post-adapter');
            modelSettings = resolveVrmModelSettings(model_path);
            vrm = buildFbxVrmShim(fbxGroup);
            applyFbxNeutralRestPose(vrm);
            fbxGroup.updateMatrixWorld(true);
            vrmMetaVersion = 'fbx';
            const hipsBone = vrm.humanoid?.getNormalizedBoneNode('hips');
            if (hipsBone) {
                const hipsWorld = new THREE.Vector3();
                const rootWorld = new THREE.Vector3();
                hipsBone.getWorldPosition(hipsWorld);
                fbxGroup.getWorldPosition(rootWorld);
                hipsHeight = Math.abs(hipsWorld.y - rootWorld.y);
            } else {
                hipsHeight = 1;
            }
            sceneToUse = fbxGroup;
            let visibleMeshCount = 0;
            fbxGroup.traverse((obj) => { if (obj.isMesh) visibleMeshCount++; });
            const fbxDebug = { height: rawHeight, autoScale, finalHeight: finalNormalization.height, finalAutoScale: finalNormalization.scale, modelScale: modelSettings.scale, hipsHeight, rootScale: fbxGroup.scale.x, meshes: visibleMeshCount, expressions: Object.keys(vrm.expressionManager?.expressionMap || {}).length };
            console.debug(DEBUG_PREFIX, 'FBX loaded:', fbxDebug);
            emitNitralVrmStatus(`FBX scale: raw=${rawHeight.toFixed(3)} final=${finalNormalization.height.toFixed(3)} root=${fbxGroup.scale.x.toFixed(5)} model=${Number(modelSettings.scale).toFixed(3)} hips=${Number(hipsHeight).toFixed(3)}`, { fbxDebug });
        } catch (error) {
            console.error(DEBUG_PREFIX,"Error when loading FBX",model_path,":",error);
            toastr.error('Wrong avatar file:'+model_path, DEBUG_PREFIX + ' cannot load', { timeOut: 10000, extendedTimeOut: 20000, preventDuplicates: true });
            return null;
        }
    } else {
        // gltf and vrm
        const loader = new GLTFLoader();
        loader.crossOrigin = 'anonymous';

        loader.register( ( parser ) => {
            return new VRMLoaderPlugin( parser );
        } );

        let gltf;
        try {
            gltf = await loader.loadAsync(model_path,
                // called after loaded
                () => {
                },
                // called while loading is progressing
                ( progress ) => {
                    const percent = Math.round(100.0 * ( progress.loaded / progress.total ));
                    $("#vrm_model_loading_percent").text(percent);
                },
                // called when loading has errors
                ( error ) => {
                    console.debug(DEBUG_PREFIX,"Error when loading",model_path,":",error)
                    toastr.error('Wrong avatar file:'+model_path, DEBUG_PREFIX + ' cannot load', { timeOut: 10000, extendedTimeOut: 20000, preventDuplicates: true });
                    return;
                }
            );
        }
        catch (error) {
            console.debug(DEBUG_PREFIX,"Error when loading",model_path,":",error)
            toastr.error('Wrong avatar file:'+model_path, DEBUG_PREFIX + ' cannot load', { timeOut: 10000, extendedTimeOut: 20000, preventDuplicates: true });
            return null;
        }

        vrm = gltf.userData.vrm;
        vrmMetaVersion = getVrmMetaVersion(vrm);
        console.debug(DEBUG_PREFIX, 'Loaded VRM model version', vrmMetaVersion, 'from', model_path);
        const vrmHipsY = vrm.humanoid?.getNormalizedBoneNode( 'hips' ).position.y;
        const vrmRootY = vrm.scene.position.y;
        hipsHeight = Math.abs( vrmHipsY - vrmRootY );
        sceneToUse = gltf.scene;

        // calling these functions greatly improves the performance
        VRMUtils.removeUnnecessaryVertices( gltf.scene );
        VRMUtils.removeUnnecessaryJoints( gltf.scene );

        // Disable frustum culling
        vrm.scene.traverse( ( obj ) => {
            obj.frustumCulled = false;
        } );

        // VRM0 assets often need a small legacy arm rest correction. VRM1 normalized
        // humanoids should not be forcibly rotated here; doing so can leave stiff arms.
        vrm.springBoneManager.reset();
        applySpringBoneAntiClipPatch(vrm, hipsHeight);
        applyLegacyVrm0ArmRestPose(vrm);

        // Add vrm to scene
        VRMUtils.rotateVRM0(vrm); // rotate if the VRM is VRM0.0
        modelSettings = resolveVrmModelSettings(model_path);
    }

    const scale = modelSettings.scale;
    // Create a group to set model center as rotation/scaling origin
    const object_container = new THREE.Group(); // First container to scale/position center model
    object_container.visible = false;
    object_container.name = VRM_CONTAINER_NAME;
    object_container.model_path = model_path; // link to character for mouse controls
    object_container.scale.set(scale,scale,scale);
    object_container.position.y = 0.5; // offset to center model
    const verticalOffset = new THREE.Group(); // Second container to rotate center model
    verticalOffset.position.y = -hipsHeight; // offset model for rotate on "center"
    verticalOffset.add(vrm.scene)
    object_container.add(verticalOffset);
    //object_container.parent = scene;
    
    // Collider used to detect mouse click
    const boundingBox = new THREE.Box3(new THREE.Vector3(-0.5,-1.0,-0.5), new THREE.Vector3(0.5,1.0,0.5));
    const dimensions = new THREE.Vector3().subVectors( boundingBox.max, boundingBox.min );
    // make a BoxGeometry of the same size as Box3
    const boxGeo = new THREE.BoxGeometry(dimensions.x, dimensions.y, dimensions.z);
    // move new mesh center so it's aligned with the original object
    const matrix = new THREE.Matrix4().setPosition(dimensions.addVectors(boundingBox.min, boundingBox.max).multiplyScalar( 0.5 ));
    boxGeo.applyMatrix4(matrix);
    // make a mesh
    const collider = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({
        visible: true,
        side: THREE.BackSide,
        wireframe: true,
        color:0xffff00
    }));
    collider.name = VRM_COLLIDER_NAME;
    collider.material.side = THREE.BackSide;
    //scene.add(collider);
    
    // Avatar dynamic settings
    const proceduralCalibration = buildProceduralRigCalibration(vrm, hipsHeight);
    const model = {
        "id": null,
        "model_path": model_path,
        "vrmMetaVersion": vrmMetaVersion,
        "vrm": vrm, // the actual vrm object
        "hipsHeight": hipsHeight, // its original hips height, used for scaling loaded animation
        "proceduralCalibration": proceduralCalibration,
        "bones": buildAvatarBoneCache(vrm),
        "expressions": buildAvatarExpressionCache(vrm),
        "objectContainer": object_container, // the actual 3d group containing the vrm scene, handle centered position/rotation/scaling
        "collider": collider,
        "expression": "none",
        "animation_mixer": new THREE.AnimationMixer(vrm.scene),
        "motion": {
            "name": "none",
            "animation": null
        },
        "phoneProp": null,
        "phonePropBone": null,
        "phonePropSide": "right",
        "talkEnd": 0,
        "hitboxes": {}
    };

    // Hit boxes
    if (extension_settings.vrm.hitboxes) {
        for(const body_part in HITBOXES)
        {
            const bone = vrm.humanoid.getNormalizedBoneNode(HITBOXES[body_part]["bone"])
            if (bone !== null) {
                const position = new THREE.Vector3();
                position.setFromMatrixPosition(bone.matrixWorld);
                console.debug(DEBUG_PREFIX,"Creating hitbox for",body_part,"at",position);

                const size = HITBOXES[body_part]["size"];
                const offset = HITBOXES[body_part]["offset"];

                // Collider used to detect mouse click
                const boundingBox = new THREE.Box3(new THREE.Vector3(-size.x,-size.y,-size.z), new THREE.Vector3(size.x,size.y,size.z));
                const dimensions = new THREE.Vector3().subVectors( boundingBox.max, boundingBox.min );
                // make a BoxGeometry of the same size as Box3
                const boxGeo = new THREE.BoxGeometry(dimensions.x, dimensions.y, dimensions.z);
                // move new mesh center so it's aligned with the original object
                const matrix = new THREE.Matrix4().setPosition(dimensions.addVectors(boundingBox.min, boundingBox.max).multiplyScalar( 0.5 ));
                boxGeo.applyMatrix4(matrix);
                // make a mesh
                const collider = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({
                    visible: true,
                    side: THREE.BackSide,
                    wireframe: true,
                    color:HITBOXES[body_part]["color"]
                }));
                collider.name = body_part;
                if (vrm.meta?.metaVersion === '1')
                    collider.position.set(offset.x/hipsHeight,offset.y/hipsHeight,-offset.z/hipsHeight);
                else
                    collider.position.set(-offset.x/hipsHeight,offset.y/hipsHeight,offset.z/hipsHeight);
                // Create a offset container
                const offset_container = new THREE.Group(); // First container to scale/position center model
                offset_container.name = model_path+"_offsetContainer_hitbox_"+body_part;
                offset_container.visible = true;
                offset_container.add(collider);
                //scene.add(offset_container)

                //object_container.localToWorld(position);
                //position.add(new THREE.Vector3(offset.x,offset.y,offset.z));
                //collider.position.set(position.x,position.y,position.z);
                //scene.add(collider);

                model["hitboxes"][body_part] = {
                    "offsetContainer":offset_container,
                    "collider":collider
                }
            }
        }
    }

    //console.debug(DEBUG_PREFIX,vrm);

    // Cache model
    if (extension_settings.vrm.models_cache)
        models_cache[model_path] = model;

    await initModel(model);
    
    return model;
}

async function initModel(model) {
  const object_container = model["objectContainer"];
  const model_path = model["model_path"];

  const modelSettings = resolveVrmModelSettings(model_path);
  object_container.scale.x = modelSettings.scale;
  object_container.scale.y = modelSettings.scale;
  object_container.scale.z = modelSettings.scale;

  object_container.position.x = modelSettings.x;
  object_container.position.y = modelSettings.y;
  object_container.position.z = 0.0;

  object_container.rotation.x = modelSettings.rx;
  object_container.rotation.y = modelSettings.ry;
  object_container.rotation.z = 0.0;

  scheduleAnimationCacheWarmup(model);
}

function scheduleAnimationCacheWarmup(model) {
    const model_path = model?.model_path;
    if (!model_path || !extension_settings.vrm.animations_cache || animations_cache[model_path]?._warmupStarted) {
        return;
    }

    animations_cache[model_path] ??= {};
    animations_cache[model_path]._warmupStarted = true;

    setTimeout(async () => {
        const cache = animations_cache[model_path];
        if (!cache || !extension_settings.vrm.animations_cache) {
            return;
        }

        const modelSettings = resolveVrmModelSettings(model_path);
        const animationNames = [modelSettings.animation_default?.motion];
        for (const key in modelSettings.classify_mapping || {}) {
            animationNames.push(modelSettings.classify_mapping[key]?.motion);
        }
        const normalizedNames = animationNames.filter(Boolean).map((name) => String(name));

        for (const file of animations_files) {
            if (!normalizedNames.some((name) => file.includes(name)) || cache[file] !== undefined) {
                continue;
            }
            const clip = await loadAnimation(model.vrm, model.hipsHeight, file);
            if (clip !== undefined) {
                cache[file] = clip;
            }
            await delay(0);
        }
    }, 1200);
}

async function setExpression(character, value) {
    if (current_avatars[character] === undefined) {
        console.debug(DEBUG_PREFIX,"WARNING requested setExpression of character without vrm loaded:",character,"(loaded",current_avatars,")");
        return;
    }

    const vrm = current_avatars[character]["vrm"];
    const current_expression = current_avatars[character]["expression"];

    if (value == "none")
        value = "neutral";

    if (current_expression === value) {
        return;
    }

    console.debug(DEBUG_PREFIX,"Switch expression of",character,"from",current_expression,"to",value);

    const expressionManager = vrm.expressionManager;
    if (!expressionManager || !expressionManager.expressionMap) {
        return;
    }

    const expressionMap = expressionManager.expressionMap;
    const previousBlendShapeMapping = getBlendShapeMapping(character, current_expression);
    const blendShapeMapping = getBlendShapeMapping(character, value);

    if (blendShapeMapping && blendShapeMapping.blendShapes) {
        // Switching into a custom blend shape group can touch many channels.
        // Reset once to guarantee clean state.
        resetAllBlendShapes(vrm);

        const intensity = blendShapeMapping.intensity || 1.0;
        applyCustomBlendShapeGroup(character, vrm, value, intensity);
        current_avatars[character]["expression"] = value;
    } else {
        if (expressionMap[value] === undefined) {
            console.debug(DEBUG_PREFIX, 'Expression not found:', value);
            value = "neutral";
        }

        if (previousBlendShapeMapping && previousBlendShapeMapping.blendShapes) {
            // Switching away from a custom blend shape group: clear stale channels.
            resetAllBlendShapes(vrm);
        } else if (current_expression && current_expression !== value && expressionMap[current_expression] !== undefined) {
            expressionManager.setValue(current_expression, 0.0);
            if (current_expression === 'blinkLeft' || current_expression === 'blinkRight') {
                expressionManager.setValue('blinkLeft', 0.0);
                expressionManager.setValue('blinkRight', 0.0);
                expressionManager.setValue('blink', 0.0);
            }
        }

        setExpressionValueWithWinkSupport(expressionManager, value, 1.0);
        current_avatars[character]["expression"] = value;
    }
}

function isCharacterLipSyncActive(character) {
  if (!extension_settings.vrm.tts_lips_sync) return false;
  if (realtimeLipSyncActive && realtimeLipSyncCharacter === character) return true;
  return false;
}

function isAnyCharacterSpeaking(nowMs = Date.now()) {
  for (const character of Object.keys(current_avatars)) {
    const talkEnd = current_avatars[character]?.talkEnd || 0;
    if (talkEnd > nowMs) {
      return true;
    }
    if (isCharacterLipSyncActive(character)) {
      return true;
    }
  }
  return false;
}

async function blendToExpression(character, targetExpression, durationMs = 220, preserveVisemes = null) {
  const avatar = current_avatars[character];
  const expressionMgr = avatar?.vrm?.expressionManager;
  if (!expressionMgr) return;

  const jobId = (expressionBlendJobs[character] || 0) + 1;
  expressionBlendJobs[character] = jobId;

  const expressionNames = avatar.expressions?.names || Object.keys(expressionMgr.expressionMap || {});
  const startValues = {};
  for (const name of expressionNames) {
    startValues[name] = expressionMgr.getValue(name) || 0;
  }

  await setExpression(character, targetExpression);

  if (current_avatars[character] === undefined || expressionBlendJobs[character] !== jobId) {
    return;
  }

  const targetValues = {};
  for (const name of expressionNames) {
    targetValues[name] = expressionMgr.getValue(name) || 0;
    expressionMgr.setValue(name, startValues[name]);
  }

  const startTime = performance.now();

  const step = () => {
    if (current_avatars[character] === undefined || expressionBlendJobs[character] !== jobId) {
      return;
    }

    const elapsed = performance.now() - startTime;
    const progress = Math.min(1, elapsed / Math.max(1, durationMs));
    const eased = easeInOutCubic(progress);
    const preserveLipSync = isCharacterLipSyncActive(character);
    const preserveBlink = !!current_avatars[character]?.winking || !!current_avatars[character]?.customWinking;

    for (const name of expressionNames) {
      if ((preserveLipSync && VRM_VISEME_SET.has(name)) || (preserveBlink && VRM_BLINK_SET.has(name))) {
        continue;
      }
      const from = startValues[name] || 0;
      const to = targetValues[name] || 0;
      setExpressionIfChanged(expressionMgr, name, from + (to - from) * eased);
    }

    if (preserveVisemes) {
      for (const [visemeName, visemeValue] of Object.entries(preserveVisemes)) {
        setExpressionIfChanged(expressionMgr, visemeName, visemeValue);
      }
    }

    if (progress < 1) {
      requestAnimationFrame(step);
    }
  };

  requestAnimationFrame(step);
}

async function restoreExpressionState(character, expressionName) {
  if (current_avatars[character] === undefined) return;

  const targetExpression = expressionName && expressionName !== "none"
    ? expressionName
    : (current_avatars[character]["expression"] || "neutral");

  const expressionMgr = current_avatars[character]["vrm"]?.expressionManager;
  const preserveLipSync = isCharacterLipSyncActive(character) && expressionMgr;
  const visemeNames = ['aa', 'ee', 'ih', 'oh', 'ou'];
  const visemeValues = {};

  if (preserveLipSync) {
    for (const visemeName of visemeNames) {
      visemeValues[visemeName] = expressionMgr.getValue(visemeName) || 0;
    }
  }

  await blendToExpression(character, targetExpression, 240, preserveLipSync ? visemeValues : null);
}

async function loadAnimation(vrm, hipsHeight, motion_file_path) {
    motion_file_path = String(motion_file_path || '').trim().replaceAll('\\', '/');
    const animationPathCandidates = [motion_file_path];
    if (motion_file_path.startsWith('/')) {
        animationPathCandidates.push(motion_file_path.replace(/^\/+/, ''));
    } else if (motion_file_path && !/^(?:https?:|blob:|data:)/i.test(motion_file_path)) {
        animationPathCandidates.push(`/${motion_file_path.replace(/^\/+/, '')}`);
    }
    let clip;
    let lastLoadError = null;
    try {
        for (const candidatePath of animationPathCandidates.filter(Boolean).filter((value, index, array) => array.indexOf(value) === index)) {
            const candidatePathLower = candidatePath.toLowerCase();
            try {
                // Mixamo animation
                if (candidatePathLower.endsWith(".fbx")) {
                    clip = await loadMixamoAnimation(candidatePath, vrm, hipsHeight);
                }
                else if (candidatePathLower.endsWith(".bvh")) {
                    clip = await loadBVHAnimation(candidatePath, vrm, hipsHeight);
                }
                else if (candidatePathLower.endsWith(".vmd")) {
                    // MMD motion file
                    clip = await loadMMDAnimation(candidatePath, vrm, hipsHeight);
                }
                else if (candidatePathLower.endsWith(".vrma")) {
                    // VRMA (VRM Animation) file — not supported on FBX models
                    if (vrm?.meta?.metaVersion === 'fbx') {
                        throw new Error('VRMA animations require a VRM model (skipped for FBX model)');
                    }
                    const vrmaLoader = new VRMALoader();
                    const result = await vrmaLoader.loadAsync(candidatePath, vrm);
                    clip = result ? result.clip : null;
                }
                else {
                    toastr.error('Wrong animation file format:' + motion_file_path, DEBUG_PREFIX + ' cannot play animation', { timeOut: 10000, extendedTimeOut: 20000, preventDuplicates: true });
                    return null;
                }

                if (clip) {
                    motion_file_path = candidatePath;
                    break;
                }
            } catch (error) {
                lastLoadError = error;
            }
        }

        if (!clip) {
            if (lastLoadError) {
                throw lastLoadError;
            }
            toastr.error('Animation file did not produce a playable clip: ' + motion_file_path, DEBUG_PREFIX + ' cannot play animation', { timeOut: 10000, extendedTimeOut: 20000, preventDuplicates: true });
            return null;
        }
    }
    catch (error) {
        console.warn(DEBUG_PREFIX, 'Failed to load animation', motion_file_path, error);
        toastr.error('Failed to load animation: ' + motion_file_path, DEBUG_PREFIX + ' cannot play animation', { timeOut: 10000, extendedTimeOut: 20000, preventDuplicates: true });
        return null;
    }
    return clip;
}

async function setMotion(character, motion_file_path, loop=false, force=false, random=true, options = {} ) {
    if (current_avatars[character] === undefined) {
        console.debug(DEBUG_PREFIX,"WARNING requested setMotion of character without vrm loaded:",character,"(loaded",current_avatars,")");
        return;
    }
    const model_path = extension_settings.vrm.character_model_mapping[character];
    const vrm = current_avatars[character]["vrm"];
    const hipsHeight = current_avatars[character]["hipsHeight"];
    const defaultMotion = resolveDefaultIdleMotion(model_path);

    // IMPORTANT: mixer might be undefined / invalid depending on load order or prior errors.
    let mixer = current_avatars[character]["animation_mixer"];

    const current_motion_name = current_avatars[character]["motion"]["name"];
    const current_motion_animation= current_avatars[character]["motion"]["animation"];
    let clip = undefined;

    console.debug(DEBUG_PREFIX,"Switch motion for",character,"from",current_motion_name,"to",motion_file_path,"loop=",loop,"force=",force,"random=",random);

    // Ensure VRM is actually present
    if (!vrm || !vrm.scene) {
        console.debug(DEBUG_PREFIX,"WARNING setMotion called but VRM/vrm.scene missing for character:",character,vrm);
        return;
    }

    // Ensure AnimationMixer exists and has a valid root
    // (The error you saw happens when mixer root is undefined and clipAction reads root.uuid.)
    if (!mixer || typeof mixer.clipAction !== 'function') {
        mixer = new THREE.AnimationMixer(vrm.scene);
        current_avatars[character]["animation_mixer"] = mixer;
        console.debug(DEBUG_PREFIX,"Created new AnimationMixer for",character);
    } else {
        // Some builds of three keep the root on _root; if it’s missing, recreate safely.
        // This is a pragmatic guard against mixer being created with an undefined root.
        if (!mixer._root) {
            mixer = new THREE.AnimationMixer(vrm.scene);
            current_avatars[character]["animation_mixer"] = mixer;
            console.debug(DEBUG_PREFIX,"Recreated AnimationMixer due to missing root for",character);
        }
    }

    // Disable current animation
    if (motion_file_path == "none") {
        if (current_motion_animation !== null) {
            current_motion_animation.fadeOut(ANIMATION_FADE_TIME);
            current_motion_animation.terminated = true;
        }
        current_avatars[character]["motion"]["name"] = "none";
        current_avatars[character]["motion"]["animation"] = null;
        return;
    }

    // Resolve known animation path first
    motion_file_path = resolveAnimationPath(motion_file_path);
    if (!motion_file_path) {
      console.warn(DEBUG_PREFIX, "Animation path could not be resolved for", character);
      return;
    }
    motion_file_path = ensureAnimationFileExtension(motion_file_path);

    // Pick random animationX
    const filename = motion_file_path.replace(/\.[^/.]+$/, "").replace(/\d+$/, "").toLowerCase();
    if (random) {
        let same_motion = []
        for(const i of animations_files) {
            const candidate = String(i || '').replace(/\.[^/.]+$/, "").replace(/\d+$/, "").toLowerCase().replaceAll('\\', '/');
            const normalizedFilename = filename.replaceAll('\\', '/');
            if (candidate === normalizedFilename || candidate.endsWith('/' + normalizedFilename)) {
              same_motion.push(i)
            }
        }
        if (same_motion.length > 0) {
          motion_file_path = same_motion[Math.floor(Math.random() * same_motion.length)];
          console.debug(DEBUG_PREFIX,"Picked a random animation among",same_motion,":",motion_file_path);
        } else {
          console.debug(DEBUG_PREFIX,"No random variants found for",filename,"using",motion_file_path);
        }
    }

  // new animation
  if (current_motion_name != motion_file_path || loop || force) {
    clearManagedCharacterTimer(character, 'postMotionRestore');
    const targetIsIdleMotion = isIdleMotionName(motion_file_path, defaultMotion);

    if (!targetIsIdleMotion) {
      suspendNaturalIdle(character, 1800);
      clearNaturalIdleTimer(character);
      if (activeIdleAnimations[character]) {
        stopProceduralIdleForCharacter(character, vrm);
        console.debug(DEBUG_PREFIX,"Faded out idle overlay for non-idle animation");
      }
    }

    if (animations_cache[model_path] !== undefined && animations_cache[model_path][motion_file_path] !== undefined) {
      clip = animations_cache[model_path][motion_file_path];
    }
    else {
      clip = await loadAnimation(vrm, hipsHeight, motion_file_path);

      if (clip === null) {
        return;
      }

      if (extension_settings.vrm.animations_cache)
        animations_cache[model_path][motion_file_path] = clip;
    }

    // Guard: loadAnimation should return an AnimationClip, but be defensive
    if (!clip || typeof clip.duration !== 'number') {
      console.debug(DEBUG_PREFIX,"WARNING loadAnimation did not return a valid AnimationClip for",motion_file_path,clip);
      return;
    }

    // create AnimationAction for VRM
    const new_motion_animation = mixer.clipAction( clip );

    // Fade out current animation
    if ( current_motion_animation !== null ) {
      current_motion_animation.fadeOut( ANIMATION_FADE_TIME );
      current_motion_animation.terminated = true;
      console.debug(DEBUG_PREFIX,"Fade out previous animation");
    }

        // Fade in new animation
        new_motion_animation
            .reset()
            .setEffectiveTimeScale( 1 )
            .setEffectiveWeight( 1 )
            .fadeIn( ANIMATION_FADE_TIME )
            .play();
        new_motion_animation.terminated = false;
        console.debug(DEBUG_PREFIX,"Loading new animation",motion_file_path);

  current_avatars[character]["motion"]["name"] = motion_file_path;
  current_avatars[character]["motion"]["animation"] = new_motion_animation;
  
  // Restart natural idle if switching to an idle animation
  const isIdleMotion = isIdleMotionName(motion_file_path, defaultMotion);
  if (isIdleMotion && extension_settings.vrm.natural_idle && loop) {
    console.debug(DEBUG_PREFIX, "Switched to idle animation, scheduling natural idle check for", character);
    const modelId = current_avatars[character]["id"];
    const idleCheckDelayMs = Math.max(800, Math.round(ANIMATION_FADE_TIME * 1000) + 300);
    scheduleNaturalIdleCheck(character, modelId, idleCheckDelayMs, "setMotion-idle-loop");
  }

    // Fade out animation after full loop
    if (!loop) {
      const restoreDelayMs = Math.max(0, (clip.duration * 1000) - (ANIMATION_FADE_TIME * 1000));
      setManagedCharacterTimer(character, 'postMotionRestore', restoreDelayMs, () => {
        const currentAction = current_avatars[character]?.motion?.animation;
        if (currentAction === new_motion_animation && !new_motion_animation.terminated) {
          new_motion_animation.terminated = true;
          const postMotionIdleDelayMs = 1200;
          suspendNaturalIdle(character, postMotionIdleDelayMs);
          const restoreMotion = resolveDefaultIdleMotion(model_path) || "none";
          setMotion(character, restoreMotion, true, true, false);
          if (options.restoreExpression) {
            restoreExpressionState(character, options.restoreExpression);
          }
        }
      });
    }

    }
}

// Animation Sequence System
// Store for animation sequences per character
const animationSequences = {};
const sequencePlaybackState = {};

function isIdleMotionName(motionName, defaultMotion = null) {
    const normalize = (value) => String(value || '')
        .trim()
        .toLowerCase()
        .replaceAll('\\', '/')
        .replace(/\.[^/.]+$/, '')
        .replace(/\d+$/, '')
        .replace(/^\/+/, '');
    const motionNameBase = normalize(motionName);
    const defaultMotionBase = normalize(defaultMotion);
    const motionLeaf = motionNameBase.split('/').pop() || motionNameBase;
    const defaultLeaf = defaultMotionBase.split('/').pop() || defaultMotionBase;
    return motionName === "none"
        || IDLE_ANIMS.some((idle) => motionLeaf === idle)
        || (!!defaultMotionBase && (motionNameBase === defaultMotionBase || motionLeaf === defaultLeaf));
}

function resolveAnimationPath(animationName) {
    const raw = String(animationName || '').trim();
    if (!raw) {
        return null;
    }

    const normalizedRaw = raw.toLowerCase().replaceAll('\\', '/');
    const normalizedNoLeadingSlash = normalizedRaw.replace(/^\/+/, '');
    for (const filePath of animations_files) {
        const normalizedPath = String(filePath || '').trim().toLowerCase().replaceAll('\\', '/');
        if (!normalizedPath) {
            continue;
        }
        const normalizedPathNoLeadingSlash = normalizedPath.replace(/^\/+/, '');
        if (normalizedPath === normalizedRaw ||
            normalizedPathNoLeadingSlash === normalizedNoLeadingSlash ||
            normalizedPath.endsWith('/' + normalizedNoLeadingSlash) ||
            normalizedPathNoLeadingSlash.endsWith('/' + normalizedNoLeadingSlash)) {
            return filePath;
        }
    }

    // Handle extensionless paths like "/assets/vrm/animations/neutral"
    // by matching against known animation files by basename/path without extension.
    const targetNoExt = normalizedNoLeadingSlash.replace(/\.[^/.]+$/, '');
    const targetLeafNoExt = targetNoExt.split('/').pop() || targetNoExt;

    for (const filePath of animations_files) {
        const normalizedPath = String(filePath || '').trim().toLowerCase().replaceAll('\\', '/').replace(/^\/+/, '');
        if (!normalizedPath) {
            continue;
        }

        const candidateNoExt = normalizedPath.replace(/\.[^/.]+$/, '');
        const candidateLeafNoExt = candidateNoExt.split('/').pop() || candidateNoExt;

        if (candidateNoExt === targetNoExt || candidateNoExt.endsWith('/' + targetNoExt) || candidateLeafNoExt === targetLeafNoExt) {
            return filePath;
        }
    }

    return normalizedNoLeadingSlash || raw;
}

function resolveGreetingMotionPath(model_path) {
    const modelSettings = resolveVrmModelSettings(model_path);
    const configuredGreeting = modelSettings?.animation_on_load?.motion
        || modelSettings?.animation_greeting?.motion
        || modelSettings?.greeting_motion
        || modelSettings?.greetingMotion;

    const pickRandom = (items) => {
        if (!Array.isArray(items) || items.length === 0) {
            return null;
        }
        return items[Math.floor(Math.random() * items.length)];
    };

    const allVrmaFiles = animations_files
        .map((filePath) => String(filePath || '').trim().replaceAll('\\', '/').replace(/^\/+/, ''))
        .filter((normalizedPath) => normalizedPath && normalizedPath.toLowerCase().endsWith('.vrma'));

    if (configuredGreeting && configuredGreeting !== 'none') {
        const resolved = ensureAnimationFileExtension(resolveAnimationPath(configuredGreeting));
        if (resolved && resolved !== 'none') {
            const resolvedNoExt = String(resolved).replace(/\.[^/.]+$/, '').toLowerCase();
            const resolvedLeafNoExt = resolvedNoExt.split('/').pop() || resolvedNoExt;
            const resolvedBase = resolvedNoExt.replace(/\d+$/, '');
            const resolvedLeafBase = resolvedLeafNoExt.replace(/\d+$/, '');

            const greetingVariants = allVrmaFiles.filter((candidatePath) => {
                const candidateNoExt = candidatePath.replace(/\.[^/.]+$/, '').toLowerCase();
                const candidateLeafNoExt = candidateNoExt.split('/').pop() || candidateNoExt;
                const candidateBase = candidateNoExt.replace(/\d+$/, '');
                const candidateLeafBase = candidateLeafNoExt.replace(/\d+$/, '');

                return candidateBase === resolvedBase
                    || candidateLeafBase === resolvedLeafBase
                    || candidateNoExt === resolvedNoExt
                    || candidateLeafNoExt === resolvedLeafNoExt;
            });

            return pickRandom(greetingVariants) || resolved;
        }
    }

    const greetingCandidates = allVrmaFiles.filter((candidatePath) => {
        const leaf = candidatePath.split('/').pop() || candidatePath;
        return leaf.toLowerCase().includes('greeting');
    });

    return pickRandom(greetingCandidates);
}

function triggerLoadGreetingMotion(character, model_path, expectedModelId) {
    if (/\.fbx$/i.test(model_path)) {
        return;
    }

    const greetingMotion = resolveGreetingMotionPath(model_path);
    if (!greetingMotion) {
        return;
    }

    clearManagedCharacterTimer(character, 'greetingStart');
    clearManagedCharacterTimer(character, 'greetingWatchdog');

    setManagedCharacterTimer(character, 'greetingStart', 250, () => {
        if (!current_avatars[character] || current_avatars[character]["id"] !== expectedModelId) {
            return;
        }

        setMotionSequence(character, [{ animation: greetingMotion }], {
            replace: true,
            clearOnComplete: true,
            restoreBaseIdle: true,
            priority: 'high',
            replace: true,
        }).catch((error) => {
            console.warn(DEBUG_PREFIX, 'Failed to play load greeting motion for', character, greetingMotion, error);
        });

        setManagedCharacterTimer(character, 'greetingWatchdog', 12000, async () => {
            if (!current_avatars[character] || current_avatars[character]["id"] !== expectedModelId) {
                return;
            }
            const queueState = sequencePlaybackState[character];
            if (queueState?.active || queueState?.waiting || animationSequences[character]) {
                clearAnimationSequence(character);
                const defaultMotion = resolveDefaultIdleMotion(model_path) || 'none';
                try {
                    await setMotion(character, defaultMotion, true, true, false);
                } catch (e) {
                    console.warn(DEBUG_PREFIX, 'Greeting watchdog failed to restore idle for', character, e);
                }
            }
        });
    });
}

function ensureAnimationFileExtension(animationPath) {
    const raw = String(animationPath || '').trim();
    if (!raw) {
        return raw;
    }

    const normalized = raw.replaceAll('\\', '/').replace(/^\/+/, '');
    if (/\.[a-z0-9]+$/i.test(normalized)) {
        return normalized;
    }

    const normalizedNoExt = normalized.replace(/\.[^/.]+$/, '').toLowerCase();
    const leafNoExt = normalizedNoExt.split('/').pop() || normalizedNoExt;

    for (const filePath of animations_files) {
        const candidate = String(filePath || '').trim().replaceAll('\\', '/').replace(/^\/+/, '');
        if (!candidate) {
            continue;
        }

        const candidateNoExt = candidate.replace(/\.[^/.]+$/, '').toLowerCase();
        const candidateLeafNoExt = candidateNoExt.split('/').pop() || candidateNoExt;

        if (candidateNoExt === normalizedNoExt || candidateNoExt.endsWith('/' + normalizedNoExt) || candidateLeafNoExt === leafNoExt) {
            return candidate;
        }
    }

    return `${normalized}.bvh`;
}

/**
 * Play a sequence of animations for a character
 * @param {string} character - Character name
 * @param {Array} sequence - Array of animation sequence items
 * @param {Object} options - Playback options
 * @param {boolean} options.loop - Whether to loop the entire sequence
 * @param {boolean} options.clearOnComplete - Whether to clear the sequence queue when done
 * @returns {Promise<boolean>} - Success status
 * 
 * Sequence item format:
 * {
 *   animation: string,      // Animation file path or name
 *   duration: number,     // How long to play (ms), or null for full animation
 *   wait: number,         // Wait time after animation before next (ms)
 *   expression: string,   // Expression to set during this animation
 *   loop: boolean,        // Whether to loop this specific animation
 *   transition: string    // Transition type: 'fade', 'cut', or 'crossfade'
 * }
 */
async function playAnimationSequence(character, sequence, options = {}) {
    if (current_avatars[character] === undefined) {
        console.warn(DEBUG_PREFIX, "Cannot play sequence - character not loaded:", character);
        return false;
    }

    if (!Array.isArray(sequence) || sequence.length === 0) {
        console.warn(DEBUG_PREFIX, "Invalid sequence provided for", character);
        return false;
    }

    suspendNaturalIdle(character, 1800);
    stopProceduralIdleForCharacter(character, current_avatars[character]?.vrm);

    const managerState = getAnimationManagerState(character);
    const hasExistingQueue = !!animationSequences[character];
    const shouldReplaceQueue = !!options.replace;
    const shouldAppendToQueue = hasExistingQueue && !shouldReplaceQueue && options.append === true;

    if (shouldAppendToQueue) {
        const existing = animationSequences[character];
        const priority = String(options.priority || 'normal').toLowerCase();
        const activeGeneration = sequencePlaybackState[character]?.generation ?? managerState.sequenceGeneration;

        if (!sequencePlaybackState[character]) {
            sequencePlaybackState[character] = {
                active: false,
                startedAt: Date.now(),
                priority,
                generation: activeGeneration,
            };
        }

        if (sequence.length === 1 && existing.items.length > 0) {
            const normalizeAnimationName = (name) => {
                if (!name || name === 'none') {
                    return 'none';
                }
                const resolved = resolveAnimationPath(name);
                return ensureAnimationFileExtension(resolved || name);
            };

            const incoming = sequence[0] || {};
            const lastQueued = existing.items[existing.items.length - 1] || {};
            const sameAnimation = normalizeAnimationName(incoming.animation) === normalizeAnimationName(lastQueued.animation);
            const sameExpression = String(incoming.expression || 'none') === String(lastQueued.expression || 'none');
            const sameWait = Number(incoming.wait || 0) === Number(lastQueued.wait || 0);

            if (sameAnimation && sameExpression && sameWait) {
                console.debug(DEBUG_PREFIX, 'Skipping duplicate appended sequence item for', character, incoming);
                return true;
            }
        }

        existing.items.push(...sequence);
        console.debug(DEBUG_PREFIX, "Appended", sequence.length, `${priority}-priority sequence item(s) for`, character);

        const isPlaybackActive = !!sequencePlaybackState[character]?.active;
        if (!isPlaybackActive) {
            console.debug(DEBUG_PREFIX, "Sequence queue was idle after append; resuming playback for", character);
            playNextInSequence(character, activeGeneration).catch((err) => {
                console.warn(DEBUG_PREFIX, "Failed to resume appended sequence for", character, err);
            });
        }

        return true;
    }

    const activeGeneration = invalidateSequenceGeneration(character);

    sequencePlaybackState[character] = {
        active: true,
        startedAt: Date.now(),
        priority: String(options.priority || 'normal').toLowerCase(),
        generation: activeGeneration,
    };

    // Store sequence and options
    animationSequences[character] = {
        items: sequence,
        currentIndex: -1,
        options: {
            loop: options.loop || false,
            clearOnComplete: options.clearOnComplete !== false,
            ...options
        }
    };

    if (options.deferIfBusy) {
        const avatar = current_avatars[character];
        const modelPath = extension_settings.vrm.character_model_mapping[character];
        const defaultMotion = resolveDefaultIdleMotion(modelPath);
        const currentMotionName = avatar?.motion?.name || 'none';
        const currentMotionAction = avatar?.motion?.animation;
        const isCurrentActionRunning = Boolean(
            currentMotionAction
            && typeof currentMotionAction.isRunning === 'function'
            && currentMotionAction.isRunning()
            && !currentMotionAction.terminated,
        );
        const isBusyNonIdle = isCurrentActionRunning && !isIdleMotionName(currentMotionName, defaultMotion);

        if (isBusyNonIdle) {
            sequencePlaybackState[character] = {
                ...(sequencePlaybackState[character] || {}),
                active: false,
                waiting: true,
                startedAt: Date.now(),
                priority: String(options.priority || 'normal').toLowerCase(),
                generation: activeGeneration,
            };

            const waitForCurrentMotionToFinish = () => {
                const pendingQueue = animationSequences[character];
                const pendingAvatar = current_avatars[character];
                const pendingGeneration = sequencePlaybackState[character]?.generation;
                if (pendingGeneration !== activeGeneration) {
                    return;
                }
                if (!pendingQueue || !pendingAvatar) {
                    delete sequencePlaybackState[character];
                    return;
                }

                const pendingModelPath = extension_settings.vrm.character_model_mapping[character];
                const pendingDefaultMotion = resolveDefaultIdleMotion(pendingModelPath);
                const pendingMotionName = pendingAvatar?.motion?.name || 'none';
                const pendingAction = pendingAvatar?.motion?.animation;
                const pendingActionRunning = Boolean(
                    pendingAction
                    && typeof pendingAction.isRunning === 'function'
                    && pendingAction.isRunning()
                    && !pendingAction.terminated,
                );
                const stillBusy = pendingActionRunning && !isIdleMotionName(pendingMotionName, pendingDefaultMotion);

                if (stillBusy) {
                    scheduleSequenceTimeout(character, activeGeneration, waitForCurrentMotionToFinish, 120);
                    return;
                }

                sequencePlaybackState[character] = {
                    ...(sequencePlaybackState[character] || {}),
                    active: true,
                    waiting: false,
                    lastStepAt: Date.now(),
                    generation: activeGeneration,
                };

                playNextInSequence(character, activeGeneration).catch((err) => {
                    console.warn(DEBUG_PREFIX, "Failed to start deferred sequence for", character, err);
                });
            };

            scheduleSequenceTimeout(character, activeGeneration, waitForCurrentMotionToFinish, 120);
            console.debug(DEBUG_PREFIX, "Deferring sequence start until current non-idle motion finishes for", character);
            return true;
        }
    }

    console.debug(DEBUG_PREFIX, "Starting animation sequence for", character, "with", sequence.length, "items");
    
    // Start playing the sequence
    await playNextInSequence(character, activeGeneration);
    return true;
}

/**
 * Play the next animation in a character's sequence
 * @param {string} character - Character name
 */
async function playNextInSequence(character, expectedGeneration = null) {
    if (expectedGeneration !== null && sequencePlaybackState[character]?.generation !== expectedGeneration) {
        return;
    }

    const seqData = animationSequences[character];
    if (!seqData) {
        delete sequencePlaybackState[character];
        return;
    }

    const activeGeneration = expectedGeneration ?? sequencePlaybackState[character]?.generation ?? getAnimationManagerState(character).sequenceGeneration;

    sequencePlaybackState[character] = {
        ...(sequencePlaybackState[character] || {}),
        active: true,
        lastStepAt: Date.now(),
        generation: activeGeneration,
    };

    seqData.currentIndex++;

    // Check if we've reached the end
    if (seqData.currentIndex >= seqData.items.length) {
        if (seqData.options.loop) {
            // Loop back to start
            seqData.currentIndex = 0;
            console.debug(DEBUG_PREFIX, "Looping sequence for", character);
        } else {
            // Sequence complete
            console.debug(DEBUG_PREFIX, "Sequence complete for", character);
            const avatar = current_avatars[character];
            const currentAction = avatar?.motion?.animation;
            if (currentAction && !currentAction.terminated) {
                currentAction.terminated = true;
                currentAction.fadeOut?.(ANIMATION_FADE_TIME);
                setManagedCharacterTimer(character, 'sequenceActionCleanup', Math.round(ANIMATION_FADE_TIME * 1000) + 80, () => {
                    currentAction.stop?.();
                });
            }
            if (seqData.options.restoreExpression) {
                restoreExpressionState(character, seqData.options.restoreExpression);
            }
            if (seqData.options.restoreBaseIdle !== false) {
                const modelPath = extension_settings.vrm.character_model_mapping[character];
                const defaultMotion = resolveDefaultIdleMotion(modelPath);
                if (defaultMotion && defaultMotion !== 'none' && current_avatars[character] !== undefined) {
                    try {
                        await setMotion(character, defaultMotion, true, true, false);
                    } catch (e) {
                        console.warn(DEBUG_PREFIX, "Failed restoring base idle after sequence for", character, e);
                    }
                }
                if (current_avatars[character] !== undefined) {
                    scheduleNaturalIdleCheck(character, current_avatars[character].id, 250, "sequence-complete");
                }
            }
            if (seqData.options.clearOnComplete) {
                delete animationSequences[character];
            }
            clearAnimationManagerTimeouts(character);
            delete sequencePlaybackState[character];
            return;
        }
    }

    const item = seqData.items[seqData.currentIndex];
    const vrm = current_avatars[character]?.vrm;
    const model_path = extension_settings.vrm.character_model_mapping[character];

    if (!vrm || !model_path) {
        console.warn(DEBUG_PREFIX, "Cannot play sequence item - VRM or model path missing");
        clearAnimationManagerTimeouts(character);
        delete animationSequences[character];
        delete sequencePlaybackState[character];
        return;
    }

    suspendNaturalIdle(character, 1200);
    stopProceduralIdleForCharacter(character, vrm);

    console.debug(DEBUG_PREFIX, "Playing sequence item", seqData.currentIndex + 1, "/", seqData.items.length, "for", character, ":", item);

    // Set expression if specified
    if (item.expression && item.expression !== "none") {
        await setExpression(character, item.expression);
    }

    // Resolve animation file path
    let animationFile = item.animation;

    // Handle 'none' animation - skip to next item after wait
    if (animationFile === 'none') {
        console.debug(DEBUG_PREFIX, "Skipping 'none' animation for", character);
        scheduleSequenceTimeout(character, activeGeneration, () => {
            playNextInSequence(character, activeGeneration);
        }, item.wait || 0);
        return;
    }

    animationFile = resolveAnimationPath(animationFile);
    animationFile = ensureAnimationFileExtension(animationFile);

    if (!animationFile) {
        console.warn(DEBUG_PREFIX, "Animation not found:", item.animation);
        scheduleSequenceTimeout(character, activeGeneration, () => {
            playNextInSequence(character, activeGeneration);
        }, item.wait || 0);
        return;
    }

    if (!animationFile.includes('.')) {
        // Try to find matching animation file
        const fuse = new Fuse(animations_files);
        const results = fuse.search(animationFile);
        if (results.length > 0) {
            animationFile = results[0].item;
        }
    }

    if (!animationFile) {
        console.warn(DEBUG_PREFIX, "Animation not found:", item.animation);
        // Skip to next
        scheduleSequenceTimeout(character, activeGeneration, () => {
            playNextInSequence(character, activeGeneration);
        }, item.wait || 0);
        return;
    }

    // Determine transition type
    const transition = item.transition || seqData.options.transition || 'crossfade';
    const fadeSecondsRaw = Number.isFinite(item.fadeSec) ? Number(item.fadeSec) : Number(seqData.options.fadeSec);
    const fadeDurationSec = Number.isFinite(fadeSecondsRaw)
        ? Math.max(0, Math.min(1.2, fadeSecondsRaw))
        : ANIMATION_FADE_TIME;
    const isLoop = item.loop || false;

    // Play the animation
    // We need to handle the playback duration manually
    const hipsHeight = current_avatars[character]["hipsHeight"];
    let clip = null;

    // Load or get from cache
    if (animations_cache[model_path] !== undefined && animations_cache[model_path][animationFile] !== undefined) {
        clip = animations_cache[model_path][animationFile];
    } else {
        clip = await loadAnimation(vrm, hipsHeight, animationFile);
        if (clip && extension_settings.vrm.animations_cache) {
            animations_cache[model_path][animationFile] = clip;
        }
    }

    if (!clip || typeof clip.duration !== 'number') {
        console.warn(DEBUG_PREFIX, "Failed to load animation clip:", animationFile);
        scheduleSequenceTimeout(character, activeGeneration, () => {
            playNextInSequence(character, activeGeneration);
        }, item.wait || 0);
        return;
    }

    // Get mixer and play animation
    let mixer = current_avatars[character]["animation_mixer"];
    const current_motion_animation = current_avatars[character]["motion"]["animation"];

    // Ensure mixer exists
    if (!mixer || typeof mixer.clipAction !== 'function') {
        mixer = new THREE.AnimationMixer(vrm.scene);
        current_avatars[character]["animation_mixer"] = mixer;
    }

    // Create new animation action
    const new_motion_animation = mixer.clipAction(clip);
    new_motion_animation.setLoop(isLoop ? THREE.LoopRepeat : THREE.LoopOnce);
    new_motion_animation.clampWhenFinished = false;

    new_motion_animation
        .reset()
        .setEffectiveTimeScale(1)
        .setEffectiveWeight(1)
        .play();

    // Handle transition after the target action is active so crossfades overlap.
    if (current_motion_animation !== null) {
        if (transition === 'cut') {
            current_motion_animation.stop();
        } else if (transition === 'crossfade') {
            current_motion_animation.crossFadeTo(new_motion_animation, fadeDurationSec, false);
        } else {
            current_motion_animation.fadeOut(fadeDurationSec);
            new_motion_animation.fadeIn(fadeDurationSec);
        }
        current_motion_animation.terminated = true;
    } else if (transition !== 'cut') {
        new_motion_animation.fadeIn(fadeDurationSec);
    }
    new_motion_animation.terminated = false;

    // Update current motion tracking
    current_avatars[character]["motion"]["name"] = animationFile;
    current_avatars[character]["motion"]["animation"] = new_motion_animation;

    // Determine playback duration
    let playDuration;
    if (item.duration !== undefined && item.duration !== null) {
        // Use specified duration
        playDuration = item.duration;
    } else if (isLoop) {
        // Loop indefinitely (but we need to move on eventually, so use a long duration)
        playDuration = 10000; // 10 seconds max for loop items in sequences
    } else {
        // Use full animation duration
        playDuration = clip.duration * 1000;
    }

    // Schedule next item. Start the next action at the fade lead point so the
    // next transition overlaps this action instead of waiting for a fade-to-zero.
    const waitTime = item.wait || 0;
    const fadeLeadMs = Math.min(fadeDurationSec * 1000, Math.max(0, playDuration - 120));
    const totalTime = Math.max(0, playDuration - fadeLeadMs);

    scheduleSequenceTimeout(character, activeGeneration, () => {
        scheduleSequenceTimeout(character, activeGeneration, () => {
            if (!new_motion_animation.terminated) {
                new_motion_animation.terminated = true;
            }
            playNextInSequence(character, activeGeneration);
        }, waitTime);
    }, totalTime);
}

/**
 * Clear a character's animation sequence
 * @param {string} character - Character name
 */
function clearAnimationSequence(character) {
    invalidateSequenceGeneration(character);
    if (animationSequences[character]) {
        delete animationSequences[character];
        console.debug(DEBUG_PREFIX, "Cleared animation sequence for", character);
    }
    if (sequencePlaybackState[character]) {
        delete sequencePlaybackState[character];
    }
}

/**
 * Set and immediately play a motion sequence from a parsed string or array
 * @param {string} character - Character name
 * @param {string|Array} sequence - Sequence definition (string like "wave,wait:500,point" or array)
 * @param {Object} options - Playback options
 */
async function setMotionSequence(character, sequence, options = {}) {
    let parsedSequence;

    if (typeof sequence === 'string') {
        // Parse sequence string
        // Format: "animation1,animation2,wait:500,animation3:duration:2000"
        parsedSequence = parseSequenceString(sequence);
    } else if (Array.isArray(sequence)) {
        parsedSequence = sequence;
    } else {
        console.warn(DEBUG_PREFIX, "Invalid sequence format for", character);
        return false;
    }

    if (parsedSequence.length === 0) {
        console.warn(DEBUG_PREFIX, "Empty sequence for", character);
        return false;
    }

    return await playAnimationSequence(character, parsedSequence, options);
}

/**
 * Parse a sequence string into array format
 * @param {string} str - Sequence string
 * @returns {Array} Parsed sequence array
 */
function parseSequenceString(str) {
    const items = [];
    const parts = str.split(',').map(p => p.trim()).filter(p => p);

    for (const part of parts) {
        // Check for special commands
        if (part.startsWith('wait:')) {
            const waitTime = parseInt(part.split(':')[1]) || 500;
            items.push({ wait: waitTime, animation: 'none' });
            continue;
        }

        if (part.startsWith('expression:')) {
            const expr = part.split(':')[1];
            if (items.length > 0) {
                items[items.length - 1].expression = expr;
            }
            continue;
        }

        // Parse animation with optional parameters
        // Format: animationName[:duration:ms][:loop:true][:transition:fade]
        const params = part.split(':');
        const animation = params[0];
        
        const item = { animation };
        
        for (let i = 1; i < params.length; i += 2) {
            const key = params[i];
            const value = params[i + 1];
            
            if (!value) continue;
            
            switch (key) {
                case 'duration':
                    item.duration = parseInt(value);
                    break;
                case 'wait':
                    item.wait = parseInt(value);
                    break;
                case 'loop':
                    item.loop = value === 'true';
                    break;
                case 'transition':
                    item.transition = value;
                    break;
                case 'expression':
                    item.expression = value;
                    break;
            }
        }

        items.push(item);
    }

    return items;
}

async function updateExpression(chat_id) {
    const message = getContext().chat[chat_id];
    if (!message) {
        return;
    }

    const character = message.name;
    const model_path = extension_settings.vrm.character_model_mapping[character];

    const dedupeKey = `${character}|${chat_id}`;
    const signature = `${character}|${chat_id}|${String(message?.mes || '').trim()}`;
    const previous = recentExpressionDispatch.get(dedupeKey);
    if (previous === signature) {
        console.debug(DEBUG_PREFIX, 'Skipping duplicate classify dispatch for', character, 'chat_id=', chat_id);
        return;
    }
    recentExpressionDispatch.set(dedupeKey, signature);
    if (recentExpressionDispatch.size > 400) {
        recentExpressionDispatch.clear();
    }

    if (message.is_user || message.is_system)
        return;

    if (model_path === undefined) {
        console.debug(DEBUG_PREFIX, 'No model assigned to', character);
        return;
    }

    const expression = await getExpressionLabel(message.mes);
    const modelSettings = resolveVrmModelSettings(model_path);
    const expressionMapping = modelSettings.classify_mapping?.[expression] || {};
    let model_expression = expressionMapping.expression || 'none';
    let model_motion = expressionMapping.motion || 'none';
    let sequence = expressionMapping.sequence || '';

    // Fallback animations
    if (model_expression == 'none') {
        model_expression = modelSettings.animation_default.expression;
    }

    const sequenceText = String(sequence || '').trim();

    // Keep classify motion optional: if mapping motion is "none" and no sequence is set,
    // update expression only and leave current motion untouched.

    const avatar = current_avatars[character];
    if (avatar && !sequenceText) {
        const normalizeMotionName = (name) => {
            if (!name || name === 'none') {
                return 'none';
            }
            const resolved = resolveAnimationPath(name);
            return ensureAnimationFileExtension(resolved || name);
        };

        const targetMotion = normalizeMotionName(model_motion);
        const currentMotion = normalizeMotionName(avatar["motion"]?.["name"]);
        const sameExpression = avatar["expression"] === model_expression;
        const sameMotion = targetMotion === currentMotion;
        const queueState = sequencePlaybackState[character];
        const hasSequenceWork = Boolean(animationSequences[character] || queueState?.active || queueState?.waiting);

        if (sameExpression && sameMotion && !hasSequenceWork) {
            console.debug(DEBUG_PREFIX, 'Skipping classify dispatch (already at target expression/motion) for', character);
            return;
        }
    }

    await setExpression(character, model_expression);

    let resolvedClassifyMotion = null;
    if (model_motion && model_motion !== 'none') {
        resolvedClassifyMotion = ensureAnimationFileExtension(resolveAnimationPath(model_motion));
        if (!resolvedClassifyMotion) {
            const fuse = new Fuse(animations_files || []);
            const results = fuse.search(String(model_motion));
            const fileItem = results[0]?.item;
            resolvedClassifyMotion = ensureAnimationFileExtension(resolveAnimationPath(fileItem || model_motion));
        }
    }

    console.debug(DEBUG_PREFIX, 'Classify mapping dispatch', {
        character,
        expression,
        model_expression,
        model_motion,
        resolvedClassifyMotion,
        sequenceText,
    });
    
    // Play classify output through the sequence queue with deterministic replacement.
    // Using replace avoids inheriting stale queue options (e.g. looping queues).
    if (sequenceText) {
        await setMotionSequence(character, sequence, {
            loop: false,
            replace: true,
            clearOnComplete: true,
            restoreBaseIdle: true,
            deferIfBusy: false,
            priority: 'high',
        });
    } else if (resolvedClassifyMotion) {
        await setMotionSequence(character, [{ animation: resolvedClassifyMotion }], {
            loop: false,
            replace: true,
            clearOnComplete: true,
            restoreBaseIdle: true,
            deferIfBusy: false,
            priority: 'high',
        });
    } else {
        console.debug(DEBUG_PREFIX, 'Classify motion unresolved/none; applied expression only for', character, model_motion);
    }
}


// Scan for VRMA idle animation files
async function scanVRMAIdleFiles() {
  if (vrmaIdleFiles.length > 0) return; // Already scanned

  const possibleFiles = [
    'FanningSelfOff_Idle.vrma',
    'FullBodyStretch_Idle.vrma',
    'Impatient_Idle.vrma',
    'InspectHands_Idle.vrma',
    'KickingGround_Idle.vrma',
    'LookBehind_Idle.vrma',
    'Sigh_Idle.vrma',
    'Yawn_Stretch_Idle.vrma'
  ];

  const basePath = '/assets/vrm/idles/';

  for (const file of possibleFiles) {
    const path = `${basePath}${file}`;
    try {
      const response = await fetch(path, { method: 'HEAD', cache: 'no-store' });
      if (response.ok) {
        vrmaIdleFiles.push(path);
      } else {
        console.warn(DEBUG_PREFIX, 'VRMA idle asset unavailable:', path, response.status);
      }
    } catch (error) {
      console.warn(DEBUG_PREFIX, 'VRMA idle asset check failed:', path, error);
    }
  }

  console.debug(DEBUG_PREFIX, "Found VRMA idle files:", vrmaIdleFiles);
}

// Load a VRMA idle animation
async function loadVRMAIdleAnimation(vrm, hipsHeight, vrmaPath) {
  if (vrmaIdleCache[vrmaPath]) {
    return vrmaIdleCache[vrmaPath];
  }
  
  const vrmaLoader = new VRMALoader();
  const result = await vrmaLoader.loadAsync(vrmaPath, vrm);
  
  if (result && result.clip) {
    vrmaIdleCache[vrmaPath] = result.clip;
    return result.clip;
  }
  
  return null;
}

function getIdleMovementBones(config) {
  const bones = new Set();
  if (!config) return [];

  if (config.rotations) {
    Object.keys(config.rotations).forEach((bone) => bones.add(bone));
  }

  if (Array.isArray(config.stages)) {
    for (const stage of config.stages) {
      if (stage.rotations) {
        Object.keys(stage.rotations).forEach((bone) => bones.add(bone));
      }
    }
  }

  return Array.from(bones);
}

function captureProceduralIdleBasePoses(character, vrm, movementConfig) {
  const bones = getIdleMovementBones(movementConfig);
  if (bones.length === 0) return;

  proceduralBoneBasePoses[character] = {};
  for (const boneName of bones) {
    const bone = vrm.humanoid?.getNormalizedBoneNode(boneName);
    if (bone) {
      proceduralBoneBasePoses[character][boneName] = getBoneQuaternionWithoutAmbientOffset(character, boneName, bone.quaternion);
    }
  }
}

function restoreIdleBasePoses(character, vrm, options = {}) {
  const immediate = options.immediate === true;
  const requestedDurationMs = options.durationMs;
  const minCorrectionAngle = options.minCorrectionAngle ?? 0.02;
  const minYCorrection = options.minYCorrection ?? 0.002;

  if (!vrm) {
    delete proceduralBoneBasePoses[character];
    delete vrmaBoneBasePoses[character];
    delete vrmaBaseYPosition[character];
    return;
  }

  if (idlePoseBlendJobs[character]) {
    idlePoseBlendJobs[character] += 1;
  } else {
    idlePoseBlendJobs[character] = 1;
  }
  const blendJobId = idlePoseBlendJobs[character];

  const combinedBasePoses = {
    ...(proceduralBoneBasePoses[character] || {}),
    ...(vrmaBoneBasePoses[character] || {})
  };

  const baseY = vrmaBaseYPosition[character];

  delete proceduralBoneBasePoses[character];
  delete vrmaBoneBasePoses[character];
  delete vrmaBaseYPosition[character];

  const objectContainer = current_avatars[character]?.["objectContainer"];

  if (immediate) {
    for (const [boneName, baseQuat] of Object.entries(combinedBasePoses)) {
      const bone = vrm.humanoid?.getNormalizedBoneNode(boneName);
      if (bone) {
        bone.quaternion.copy(baseQuat);
      }
    }

    if (baseY !== undefined && objectContainer) {
      objectContainer.position.y = baseY;
    }
    return;
  }

  const startBoneQuats = {};
  let maxCorrectionAngle = 0;
  for (const [boneName, baseQuat] of Object.entries(combinedBasePoses)) {
    const bone = vrm.humanoid?.getNormalizedBoneNode(boneName);
    if (bone) {
      const boneBaseQuat = getBoneQuaternionWithoutAmbientOffset(character, boneName, bone.quaternion);
      const correctionAngle = boneBaseQuat.angleTo(baseQuat);
      if (correctionAngle < minCorrectionAngle) {
        continue;
      }
      maxCorrectionAngle = Math.max(maxCorrectionAngle, correctionAngle);
      startBoneQuats[boneName] = {
        start: boneBaseQuat,
        target: baseQuat
      };
    }
  }

  const startY = objectContainer?.position.y;
  const needsYCorrection = baseY !== undefined && startY !== undefined && Math.abs(baseY - startY) >= minYCorrection;

  if (Object.keys(startBoneQuats).length === 0 && !needsYCorrection) {
    return;
  }

  const angleNormalized = Math.min(1, maxCorrectionAngle / 0.5);
  const adaptiveDurationMs = 320 + (angleNormalized * 460);
  const durationMs = Math.max(1, Math.round(requestedDurationMs ?? adaptiveDurationMs));
  const startTime = performance.now();

  const step = () => {
    if (current_avatars[character] === undefined || idlePoseBlendJobs[character] !== blendJobId) {
      return;
    }

    const elapsed = performance.now() - startTime;
    const progress = Math.min(1, elapsed / Math.max(1, durationMs));
    const eased = easeInOutCubic(progress);

    for (const [boneName, quats] of Object.entries(startBoneQuats)) {
      const bone = vrm.humanoid?.getNormalizedBoneNode(boneName);
      if (bone) {
        const blendedBaseQuat = new THREE.Quaternion().slerpQuaternions(quats.start, quats.target, eased);
        const additiveQuat = getCombinedAdditiveQuaternionForBone(character, boneName);
        bone.quaternion.copy(blendedBaseQuat).multiply(additiveQuat);
      }
    }

    if (needsYCorrection && objectContainer && startY !== undefined) {
      objectContainer.position.y = startY + (baseY - startY) * eased;
    }

    if (progress < 1) {
      requestAnimationFrame(step);
    }
  };

  requestAnimationFrame(step);
}

function getCharacterIdleProfile(character) {
  if (!proceduralState[character]) {
    proceduralState[character] = {
      pauseMinMs: 900 + Math.floor(Math.random() * 600),
      pauseMaxMs: 2600 + Math.floor(Math.random() * 900),
      cooldownMinMs: 2200 + Math.floor(Math.random() * 900),
      cooldownMaxMs: 5200 + Math.floor(Math.random() * 1400),
      expressionChanceScale: 0.45 + Math.random() * 0.3,
      expressionIntensityScale: 0.7 + Math.random() * 0.3,
      modelRotationScale: 0.45 + Math.random() * 0.25,
      vrmaChance: 0.08 + Math.random() * 0.07,
      lastMovementKey: null,
      recentMovements: [],
      idleCycleQueue: []
    };
  }

  return proceduralState[character];
}

function shuffleInPlace(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = items[i];
    items[i] = items[j];
    items[j] = temp;
  }
  return items;
}

function buildIdleCycleQueue() {
  const movementKeys = Object.keys(IDLE_MOVEMENT_CONFIGS).filter((key) => IDLE_MOVEMENT_CONFIGS[key]?.enabled !== false);
  const queue = [
    ...movementKeys.map((key) => ({ type: 'procedural', key })),
    ...vrmaIdleFiles.map((vrmaPath) => ({ type: 'vrma', key: vrmaPath }))
  ];

  return shuffleInPlace(queue);
}

function pickNextIdleChoice(character) {
  const profile = getCharacterIdleProfile(character);

  if (!Array.isArray(profile.idleCycleQueue) || profile.idleCycleQueue.length === 0) {
    profile.idleCycleQueue = buildIdleCycleQueue();
  }

  if (!profile.idleCycleQueue.length) {
    return null;
  }

  return profile.idleCycleQueue.shift();
}

async function naturalIdleMovement(character, modelId) {
  if (current_avatars[character] === undefined || current_avatars[character]["id"] != modelId) {
    clearNaturalIdleTimer(character);
    return;
  }

  const vrm = current_avatars[character]["vrm"];
  const motionName = current_avatars[character]["motion"]["name"];
  const currentMotionAction = current_avatars[character]["motion"]["animation"];
  const model_path = extension_settings.vrm.character_model_mapping[character];
  const defaultMotion = resolveDefaultIdleMotion(model_path);
  let mixer = current_avatars[character]["animation_mixer"];

  const hasSequenceQueued = !!animationSequences[character];
  const hasSequenceActive = !!sequencePlaybackState[character]?.active;
  if (hasSequenceQueued || hasSequenceActive) {
    const delayTime = Math.floor(Math.random() * 1200) + 800;
    setNaturalIdleTimer(character, delayTime, () => {
      naturalIdleMovement(character, modelId);
    });
    return;
  }

  const hasRunningNonIdleMotion = !!(currentMotionAction && currentMotionAction.isRunning && currentMotionAction.isRunning() && !isIdleMotionName(motionName, defaultMotion));
  if (hasRunningNonIdleMotion) {
    const delayTime = Math.floor(Math.random() * 1200) + 800;
    setNaturalIdleTimer(character, delayTime, () => {
      naturalIdleMovement(character, modelId);
    });
    return;
  }

  const idleProfile = getCharacterIdleProfile(character);
  const inactivityIntensity = getRawInactivityIntensity();
  const profileExpressionChanceScale = idleProfile.expressionChanceScale * (0.85 + 0.75 * inactivityIntensity);
  const profileExpressionIntensityScale = idleProfile.expressionIntensityScale * (0.85 + 0.55 * inactivityIntensity);
  const profileModelRotationScale = idleProfile.modelRotationScale * (0.85 + 0.55 * inactivityIntensity);
  const pauseMinMs = Math.max(1200, Math.round(idleProfile.pauseMinMs * (1 - 0.4 * inactivityIntensity)));
  const pauseMaxMs = Math.max(pauseMinMs + 400, Math.round(idleProfile.pauseMaxMs * (1 - 0.35 * inactivityIntensity)));
  const cooldownMinMs = Math.max(4500, Math.round(idleProfile.cooldownMinMs * (1 - 0.45 * inactivityIntensity)));
  const cooldownMaxMs = Math.max(cooldownMinMs + 1500, Math.round(idleProfile.cooldownMaxMs * (1 - 0.35 * inactivityIntensity)));

  const isIdle = isIdleMotionName(motionName, defaultMotion);

  if (!isIdle || !extension_settings.vrm.natural_idle) {
    const delayTime = Math.floor(Math.random() * 10000) + 10000;
    setNaturalIdleTimer(character, delayTime, () => {
      naturalIdleMovement(character, modelId);
    });
    return;
  }

  const runningIdleAction = activeIdleAnimations[character];
  if (runningIdleAction?.isRunning && runningIdleAction.isRunning()) {
    setNaturalIdleTimer(character, 2000, () => {
      naturalIdleMovement(character, modelId);
    });
    return;
  }

  await loadIdleMovementConfigs();

  // Check cooldown window for this character
  const now = Date.now();
  const nextEligible = nextIdleEligibleTime[character] || 0;

  if (now < nextEligible) {
    const remainingCooldown = nextEligible - now;
    setNaturalIdleTimer(character, remainingCooldown, () => {
      naturalIdleMovement(character, modelId);
    });
    return;
  }

  // Ensure mixer exists
  if (!mixer || typeof mixer.clipAction !== 'function') {
    mixer = new THREE.AnimationMixer(vrm.scene);
    current_avatars[character]["animation_mixer"] = mixer;
  }

  // Scan for VRMA files on first run
  await scanVRMAIdleFiles();

  const isFbxAvatar = vrm?.meta?.metaVersion === 'fbx';

  let clip = null;
  let clipDuration = 0;
  let isVRMA = false;
  let vrmaFileName = '';
  let movementConfig = null;
  let randomizedRotation = 0;

  const totalChoices = Math.max(1, Object.keys(IDLE_MOVEMENT_CONFIGS).length + vrmaIdleFiles.length);
  for (let attempts = 0; attempts < totalChoices && !clip; attempts++) {
    const choice = pickNextIdleChoice(character);
    if (!choice) {
      break;
    }

    if (choice.type === 'vrma') {
      if (isFbxAvatar) {
        continue;
      }
      const hipsHeight = current_avatars[character]["hipsHeight"];
      console.debug(DEBUG_PREFIX, "Loading VRMA idle animation:", choice.key, "for", character);
      try {
        clip = await loadVRMAIdleAnimation(vrm, hipsHeight, choice.key);
        if (clip) {
          clipDuration = clip.duration;
          isVRMA = true;
          vrmaFileName = choice.key.split('/').pop();
          console.debug(DEBUG_PREFIX, "Loaded VRMA idle animation:", choice.key, "duration:", clipDuration);
        }
      } catch (error) {
        console.warn(DEBUG_PREFIX, "Failed to load VRMA idle animation:", choice.key, error);
      }
      continue;
    }

    movementConfig = IDLE_MOVEMENT_CONFIGS[choice.key];
    console.debug(DEBUG_PREFIX, "Natural idle animation:", choice.key, "-", movementConfig?.description || "unknown", "for", character);
    const result = getIdleAnimationClip(character, vrm, choice.key, current_avatars[character]?.proceduralCalibration);
    clip = result.clip;
    randomizedRotation = result.randomizedRotation;
    if (clip) {
      clipDuration = clip.duration;
    }
  }

  if (!clip) {
    console.warn(DEBUG_PREFIX, "Failed to resolve any idle animation for", character);
    const nextDelay = Math.floor(Math.random() * 10000) + 10000;
    setNaturalIdleTimer(character, nextDelay, () => {
      naturalIdleMovement(character, modelId);
    });
    return;
  }

  // Fade out previous idle animation if exists
  const prevIdleAction = activeIdleAnimations[character];
  if (prevIdleAction && prevIdleAction.isRunning && prevIdleAction.isRunning()) {
    prevIdleAction.fadeOut(ANIMATION_FADE_TIME);
    console.debug(DEBUG_PREFIX, "Fade out previous idle animation");
  }

  if (cursorTiltState[character]) {
    resetCursorTilt(vrm, character);
  }

  // For VRMA files, store base bone poses and Y position before playing
  // This prevents accumulation of bone rotations and height drops over multiple VRMA plays
  if (isVRMA) {
    vrmaBoneBasePoses[character] = {};
    const bonesToTrack = ['hips', 'spine', 'upperChest', 'chest'];
    for (const boneName of bonesToTrack) {
      const bone = vrm.humanoid?.getNormalizedBoneNode(boneName);
      if (bone) {
        vrmaBoneBasePoses[character][boneName] = getBoneQuaternionWithoutAmbientOffset(character, boneName, bone.quaternion);
      }
    }
    // Store the base Y position to prevent height drop
    const objectContainer = current_avatars[character]?.["objectContainer"];
    if (objectContainer) {
      vrmaBaseYPosition[character] = objectContainer.position.y;
      console.debug(DEBUG_PREFIX, "Stored base Y position:", vrmaBaseYPosition[character], "for VRMA animation");
    }
  }

  // Create and play new idle animation. Procedural JSON idles are additive overlays on top of neutral/default.
  let playbackClip = clip;
  if (!isVRMA && THREE.AnimationUtils?.makeClipAdditive) {
    playbackClip = clip.clone();
    THREE.AnimationUtils.makeClipAdditive(playbackClip);
    playbackClip.blendMode = THREE.AdditiveAnimationBlendMode;
  }
  const idleAction = mixer.clipAction(playbackClip);
  if (!isVRMA && THREE.AdditiveAnimationBlendMode !== undefined) {
    idleAction.blendMode = THREE.AdditiveAnimationBlendMode;
  }
  idleAction
    .reset()
    .setLoop(THREE.LoopOnce) // Don't loop - play once
    .setEffectiveTimeScale(1)
    .setEffectiveWeight(isVRMA ? 1 : 0.95)
    .fadeIn(ANIMATION_FADE_TIME)
    .play();
  idleAction.clampWhenFinished = true;

  activeIdleAnimations[character] = idleAction;
  
  if (isVRMA) {
    console.debug(DEBUG_PREFIX, "Playing VRMA idle animation:", vrmaFileName, "duration:", clipDuration, "for", character);
  } else {
    console.debug(DEBUG_PREFIX, "Playing procedural idle animation:", movementConfig?.description, "duration:", clipDuration, "for", character);
  }

  // Apply model rotation if configured (procedural only)
  if (!isVRMA && movementConfig && movementConfig.applyModelRotation && randomizedRotation !== 0) {
    const objectContainer = current_avatars[character]?.["objectContainer"];
    if (objectContainer) {
      const targetYaw = randomizedRotation * profileModelRotationScale;
      const duration = movementConfig.duration || 10000;
      applyModelRotation(vrm, character, modelId, targetYaw, duration);
    }
  }

  // Apply expression if configured
  if (!isVRMA && movementConfig && movementConfig.expressionChance) {
    const expressionChance = Math.min(0.95, movementConfig.expressionChance * profileExpressionChanceScale);
    if (Math.random() < expressionChance) {
    const expressions = movementConfig.expressions || ['happy'];
    const randomExpression = expressions[Math.floor(Math.random() * expressions.length)];
    const delay = Math.random() * 1000 + 500;
    const expressionIntensity = Math.min(1.0, (0.45 + Math.random() * 0.35) * profileExpressionIntensityScale);
    const expressionDuration = Math.round(1400 + Math.random() * 1400);
    setManagedCharacterTimer(character, 'naturalIdleExpression', delay, () => {
      if (current_avatars[character]?.vrm === vrm) {
        applyIdleExpression(vrm, character, randomExpression, expressionIntensity, expressionDuration);
      }
    });
    }
  }
  
  // VRMA files also get expressions (40% chance)
  if (isVRMA && Math.random() < 0.35) {
    const expressions = ['happy', 'relaxed', 'surprised'];
    const randomExpression = expressions[Math.floor(Math.random() * expressions.length)];
    const delay = Math.random() * 1000 + 500;
    const expressionIntensity = Math.min(1.0, (0.45 + Math.random() * 0.3) * profileExpressionIntensityScale);
    const expressionDuration = Math.round(1400 + Math.random() * 1200);
    setManagedCharacterTimer(character, 'naturalIdleVrmaExpression', delay, () => {
      if (current_avatars[character]?.vrm === vrm) {
        applyIdleExpression(vrm, character, randomExpression, expressionIntensity, expressionDuration);
      }
    });
  }

  // Schedule next idle animation after this one completes
  const clipDurationMs = clipDuration * 1000;
  const pauseAfter = Math.floor(
    Math.random() * (pauseMaxMs - pauseMinMs + 1)
  ) + pauseMinMs;

  // For VRMA files, use a longer fade-out and restore base poses
  // to prevent bone rotation accumulation and snapping
  const fadeOutDurationSec = isVRMA ? Math.min(1.2, clipDuration * 0.2) : ANIMATION_FADE_TIME;
  const fadeOutDurationMs = Math.max(1, Math.round(fadeOutDurationSec * 1000));

  // Schedule fade-out - for VRMA start fading before end to blend smoothly
  const fadeOutDelay = isVRMA
    ? Math.max(clipDurationMs - fadeOutDurationMs - 200, clipDurationMs * 0.75)
    : clipDurationMs + pauseAfter;

  // First timeout: fade out the current animation
  setNaturalIdleTimer(character, fadeOutDelay, () => {
    const currentAction = activeIdleAnimations[character];
    if (currentAction) {
      if (cursorTiltState[character]) {
        resetCursorTilt(vrm, character);
      }
      // For VRMA, stop the action after fade to prevent bone pose lingering
      if (isVRMA) {
        currentAction.fadeOut(fadeOutDurationSec);
        setManagedCharacterTimer(character, 'naturalIdleFadeCleanup', fadeOutDurationMs + 100, () => {
          currentAction.stop();
          restoreIdleBasePoses(character, vrm, { durationMs: Math.min(420, fadeOutDurationMs + 160) });
          console.debug(DEBUG_PREFIX, "Restored base pose after VRMA animation with smoothing");
        });
        console.debug(DEBUG_PREFIX, "Fading out VRMA idle animation with pose restoration");
      } else {
        currentAction.fadeOut(fadeOutDurationSec);
        setManagedCharacterTimer(character, 'naturalIdleFadeCleanup', fadeOutDurationMs + 60, () => {
          if (currentAction.stop) {
            currentAction.stop();
          }
          restoreIdleBasePoses(character, vrm, { durationMs: fadeOutDurationMs + 120 });
        });
        console.debug(DEBUG_PREFIX, "Fade out idle animation before next");
      }
    }

      // Record completion time and schedule next idle after cooldown
      // The cooldown is enforced in naturalIdleMovement itself
      const completionTime = Date.now();
      lastIdleCompletionTime[character] = completionTime;
      const cooldownDuration = Math.floor(
        Math.random() * (cooldownMaxMs - cooldownMinMs + 1)
      ) + cooldownMinMs;
      nextIdleEligibleTime[character] = completionTime + cooldownDuration;
      console.debug(DEBUG_PREFIX, "Idle animation completed for", character, "at", completionTime, "- starting cooldown");
      
      // Keep cursor/body offsets blended continuously to avoid visible snaps.
      
      // Schedule next idle after fade completes (add extra time for VRMA pose restoration)
      const nextDelay = isVRMA ? fadeOutDurationMs + 200 + pauseAfter : 0;
      setNaturalIdleTimer(character, nextDelay, () => {
        naturalIdleMovement(character, modelId);
      });

  });
}

// Blink
function blink(character, modelId) {
    const avatar = current_avatars[character];
    if (avatar?.vrm?.expressionManager) {
        // Check for winking state and clear it
        const blinkLeftVal = avatar.vrm.expressionManager.getValue('blinkLeft') || 0;
        const blinkRightVal = avatar.vrm.expressionManager.getValue('blinkRight') || 0;
        if (blinkLeftVal > 0.1 || blinkRightVal > 0.1) {
            avatar.vrm.expressionManager.setValue('blinkLeft', 0);
            avatar.vrm.expressionManager.setValue('blinkRight', 0);
            avatar.winking = false;
            avatar.customWinking = false;
        }
    }

    if (current_avatars[character] === undefined || current_avatars[character]["id"] != modelId) {
        console.debug(DEBUG_PREFIX,"Stopping blink model is no more loaded:",character,modelId)
        clearManagedCharacterTimer(character, 'blinkClose');
        clearManagedCharacterTimer(character, 'blinkLoop');
        return;
    }

    const vrm = current_avatars[character]["vrm"];

    const now = Date.now();
    const presenceProfile = getPresenceProfile(character, now, inactivityState.intensity);
    const blinktimeout = Math.floor(Math.random() * 180) + (presenceProfile.mode === 'thinking' ? 90 : 45);
    setManagedCharacterTimer(character, 'blinkClose', blinktimeout, () => {
      const activeAvatar = current_avatars[character];
      if (activeAvatar?.["id"] !== modelId) {
        return;
      }
      activeAvatar["vrm"]?.expressionManager?.setValue("blink",0);
    });
    
    vrm.expressionManager.setValue("blink",1.0);

    const minDelay = presenceProfile.speaking ? 2600 : presenceProfile.mode === 'listening' ? 3200 : presenceProfile.mode === 'thinking' ? 1400 : 1900;
    const maxExtra = presenceProfile.speaking ? 6200 : presenceProfile.mode === 'listening' ? 7600 : presenceProfile.mode === 'thinking' ? 3600 : 8200;
    const rand = Math.round(minDelay + Math.random() * maxExtra);
    setManagedCharacterTimer(character, 'blinkLoop', rand, () => {
      blink(character, modelId);
    });
}

function updateTextTalkMouth(character, vrm, nowMs) {
    if (extension_settings.vrm.tts_lips_sync || !current_avatars[character]?._textTalkEnabled) {
        return;
    }

    const talkEnd = Number(current_avatars[character]["talkEnd"] || 0);
    if (talkEnd > nowMs) {
        const mouth_y = (Math.sin(talkEnd - nowMs) + 1) / 2;
        vrm.expressionManager.setValue("aa", mouth_y);
        return;
    }

    vrm.expressionManager.setValue(current_avatars[character]["expression"], 1.0);
    vrm.expressionManager.setValue("aa", 0.0);
}

// Legacy entry point retained for loadModel callers. Actual updates happen in animate().
async function textTalk(character, modelId) {
    if (current_avatars[character] !== undefined && current_avatars[character]["id"] == modelId) {
        current_avatars[character]._textTalkEnabled = true;
    }
}

// Add text duration to current_avatars[character]["talkEnd"]
// Overrided by tts lip sync option
async function talk(chat_id) {
    // TTS lip sync overide
    if (extension_settings.vrm.tts_lips_sync)
        return;

    const context = getContext();
    const chat = Array.isArray(context?.chat) ? context.chat : null;
    const id = Number(chat_id);
    if (!chat || !Number.isInteger(id) || id < 0 || id >= chat.length) {
        console.warn(DEBUG_PREFIX, 'Skipping talk animation; invalid chat id', { chat_id, length: chat?.length || 0 });
        return;
    }

    const message = chat[id];
    if (!message || typeof message !== 'object') {
        console.warn(DEBUG_PREFIX, 'Skipping talk animation; chat entry invalid', { chat_id: id });
        return;
    }

    // No model for user or system
    if (message.is_user || message.is_system)
        return;

    const text = message.mes;
    const character = message.name;

    console.debug(DEBUG_PREFIX,"Playing mouth animation for",character," message:",text);

    // No model loaded for character
    if(current_avatars[character] === undefined) {
        console.debug(DEBUG_PREFIX,"No model loaded, cannot animate talk")
        return;
    }

    current_avatars[character]["talkEnd"] = Date.now() + text.length * 50;
    markUserActivity("text-speech");
}

// handle window resizes
window.addEventListener( 'resize', onWindowResize, false );

function onWindowResize(){
    if (camera !== undefined && renderer !== undefined) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();

        renderer.setSize( window.innerWidth, window.innerHeight );
        renderer.setPixelRatio( Math.min(window.devicePixelRatio || 1, VRM_MAX_PIXEL_RATIO) );
    }
}

// Update a character model to fit the saved settings
async function updateModel(character) {
    if (current_avatars[character] !== undefined) {
        const object_container = current_avatars[character]["objectContainer"];
        const model_path = extension_settings.vrm.character_model_mapping[character];

        const modelSettings = resolveVrmModelSettings(model_path);
        object_container.scale.x = modelSettings.scale;
        object_container.scale.y = modelSettings.scale;
        object_container.scale.z = modelSettings.scale;

        object_container.position.x = modelSettings.x;
        object_container.position.y = modelSettings.y;
        object_container.position.z = modelSettings.z; //0.0; // In case somehow it get away from 0

        object_container.rotation.x = modelSettings.rx;
        object_container.rotation.y = modelSettings.ry;
        object_container.rotation.z = modelSettings.rz; //0.0; // In case somehow it get away from 0

    }
}

// Currently loaded character VRM accessor
function getVRM(character) {
    if (current_avatars[character] === undefined)
        return undefined;
    return current_avatars[character]["vrm"];
}

const activeNativeHitboxFlashes = new Map();

function setHitboxActiveState(character, hitbox, active) {
    const collider = current_avatars[character]?.hitboxes?.[hitbox]?.collider;
    const material = collider?.material;
    if (!material?.color) {
        return;
    }

    const key = `${character}:${hitbox}`;
    if (active) {
        if (!activeNativeHitboxFlashes.has(key)) {
            activeNativeHitboxFlashes.set(key, material.color.clone());
        }
        material.color.set(0xffffff);
        return;
    }

    const originalColor = activeNativeHitboxFlashes.get(key);
    if (originalColor) {
        material.color.copy(originalColor);
        activeNativeHitboxFlashes.delete(key);
    }
}

async function pointerDownHitboxAt(clientX, clientY) {
    const hit = await findHitboxAt(clientX, clientY);
    if (!hit) {
        return false;
    }

    setHitboxActiveState(hit.character, hit.hitbox, true);
    void delay(HIT_BOX_DELAY).then(() => setHitboxActiveState(hit.character, hit.hitbox, false));
    await playHitboxMapping(hit.character, hit.hitbox);

    return true;
}

async function clickHitboxAt(clientX, clientY) {
    const hit = await findHitboxAt(clientX, clientY);
    if (!hit) {
        return false;
    }

    await playHitboxMapping(hit.character, hit.hitbox);
    return true;
}

async function findHitboxAt(clientX, clientY) {
    if (!extension_settings.vrm.hitboxes || !camera || !renderer) {
        return null;
    }

    const rect = renderer.domElement.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        return null;
    }

    const pointer = new THREE.Vector2(
        ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);

    for (const character in current_avatars) {
        const avatar = current_avatars[character];
        syncCharacterCollisionProxies(character, true);
        avatar.objectContainer?.updateMatrixWorld?.(true);
        avatar.collider?.updateMatrixWorld?.(true);

        const hitboxObjects = [];
        for (const hitbox in avatar.hitboxes) {
            const collider = avatar.hitboxes[hitbox]?.collider;
            if (collider) {
                collider.updateMatrixWorld?.(true);
                hitboxObjects.push(collider);
            }
        }

        const intersects = raycaster.intersectObjects(hitboxObjects, false);
        if (intersects.length > 0) {
            return { character, hitbox: intersects[0].object.name };
        }
    }

    return null;
}

async function playHitboxMapping(character, hitbox) {
    const avatar = current_avatars[character];
    if (!avatar) {
        return;
    }
    markUserActivity("hitbox");

    const model_path = avatar.model_path;
    const mapped = resolveVrmModelSettings(model_path).hitboxes_mapping?.[hitbox] || {};
    const previousExpression = avatar.expression || "neutral";
    const model_expression = mapped.expression || "none";
    const model_motion = mapped.motion || "none";
    const sequence = String(mapped.sequence || "").trim();

    if (model_expression !== "none") {
        await setExpression(character, model_expression);
    }
    if (sequence) {
        await setMotionSequence(character, sequence, {
            loop: false,
            replace: true,
            clearOnComplete: true,
            restoreBaseIdle: true,
            restoreExpression: previousExpression,
            deferIfBusy: false,
            priority: 'high',
            transition: 'crossfade',
            fadeSec: 0.42,
        });
    } else if (model_motion !== "none") {
        const resolvedHitboxMotion = ensureAnimationFileExtension(resolveAnimationPath(model_motion));
        if (!resolvedHitboxMotion) {
            console.warn(DEBUG_PREFIX, 'Hitbox motion unresolved for', character, hitbox, model_motion);
            return;
        }

        await setMotionSequence(character, [{ animation: resolvedHitboxMotion }], {
            loop: false,
            replace: true,
            clearOnComplete: true,
            restoreBaseIdle: true,
            restoreExpression: previousExpression,
            deferIfBusy: false,
            priority: 'high',
            transition: 'crossfade',
            fadeSec: 0.42,
        });
    }

    if (extension_settings.vrm.auto_send_hitbox_message === true) {
        sendMessageAsUser('', { autoSend: true, character, hitbox });
    }
}

function clearModelCache() {
    models_cache = {};
}

function clearAnimationCache() {
    animations_cache = {};
}

// Real-time lip sync using VoiceForge's shared analyser
// Much simpler than per-chunk analysis - just reads actual audio output
let realtimeLipSyncActive = false;
let realtimeLipSyncCharacter = null;
let realtimeLipSyncAnimationId = null;
let realtimeLipSyncLastUpdate = 0;
let realtimeLipSyncFrequencyData = null;
let realtimeLipSyncTimeData = null;

const REALTIME_MOUTH_THRESHOLD = 0.024;
const REALTIME_MOUTH_BOOST = 1.55;
const REALTIME_MOUTH_CUTOFF = 0.05;
const REALTIME_UPDATE_INTERVAL = 16; // ~60fps for smoother animation
const EXPRESSION_SET_EPSILON = 0.01;
const VRM_VISEMES = ['aa', 'ee', 'ih', 'oh', 'ou'];
const VRM_BLINK_EXPRESSIONS = ['blink', 'blinkLeft', 'blinkRight'];
const VRM_VISEME_SET = new Set(VRM_VISEMES);
const VRM_BLINK_SET = new Set(VRM_BLINK_EXPRESSIONS);
const REALTIME_EXPRESSION_DUCK_VALUE = 0.08;

// Per-viseme decay rates - very aggressive for snappy closure at 60fps
const VISEME_DECAY = {
    aa: 0.42,  // Open mouth - decay per frame at 60fps
    ee: 0.38,  // Spread lips - fast
    ih: 0.38,  // Similar to ee
    oh: 0.46,  // Round mouth - slightly slower
    ou: 0.42,  // Pucker
};

function setExpressionIfChanged(expressionMgr, name, value, epsilon = EXPRESSION_SET_EPSILON) {
    if (!expressionMgr) return;
    const clamped = Math.max(0, Math.min(1, Number(value) || 0));
    const current = expressionMgr.getValue(name) || 0;
    if (Math.abs(current - clamped) >= epsilon || (clamped === 0 && current !== 0)) {
        expressionMgr.setValue(name, clamped);
    }
}

function setMouthOverrideSuspendedForLipSync(expressionMgr, suspended) {
    if (!expressionMgr || !Array.isArray(expressionMgr.expressions)) return;

    for (const expression of expressionMgr.expressions) {
        const name = expression?.expressionName;
        if (!name || VRM_VISEME_SET.has(name)) continue;

        if (suspended) {
            if (expression.overrideMouth && expression.overrideMouth !== 'none' && expression._embodyLipSyncOverrideMouth === undefined) {
                expression._embodyLipSyncOverrideMouth = expression.overrideMouth;
                expression.overrideMouth = 'none';
            }
        } else if (expression._embodyLipSyncOverrideMouth !== undefined) {
            expression.overrideMouth = expression._embodyLipSyncOverrideMouth;
            delete expression._embodyLipSyncOverrideMouth;
        }
    }
}

function duckMouthOwningExpressionsForLipSync(avatar, expressionMgr, duck) {
    if (!avatar || !expressionMgr) return;

    const expressionNames = avatar.expressions?.nonVisemes || Object.keys(expressionMgr.expressionMap || {}).filter(name => !VRM_VISEME_SET.has(name));
    const lookAtNames = new Set(expressionMgr.lookAtExpressionNames || []);

    for (const name of expressionNames) {
        if (VRM_BLINK_SET.has(name) || lookAtNames.has(name)) continue;

        if (duck) {
            const current = expressionMgr.getValue(name) || 0;
            if (current > REALTIME_EXPRESSION_DUCK_VALUE) {
                setExpressionIfChanged(expressionMgr, name, REALTIME_EXPRESSION_DUCK_VALUE, 0.02);
            }
        } else if (name === avatar.expression) {
            setExpressionValueWithWinkSupport(expressionMgr, name, 1.0);
        } else if (!VRM_BLINK_SET.has(name) && !lookAtNames.has(name)) {
            const current = expressionMgr.getValue(name) || 0;
            if (current <= REALTIME_EXPRESSION_DUCK_VALUE + 0.02) {
                setExpressionIfChanged(expressionMgr, name, 0, 0.02);
            }
        }
    }
}

function updateRealtimeLipSync(now = Date.now()) {
    if (!realtimeLipSyncActive || !realtimeLipSyncCharacter) return;
    if (now - realtimeLipSyncLastUpdate < REALTIME_UPDATE_INTERVAL) return;

    const character = realtimeLipSyncCharacter;
    const analyser = window.getVoiceForgeAnalyser?.();
    const avatar = current_avatars[character];
    const expressionMgr = avatar?.vrm?.expressionManager;
    if (!analyser || !expressionMgr) return;

    setMouthOverrideSuspendedForLipSync(expressionMgr, true);
    duckMouthOwningExpressionsForLipSync(avatar, expressionMgr, true);

    realtimeLipSyncLastUpdate = now;

    if (!realtimeLipSyncFrequencyData || realtimeLipSyncFrequencyData.length !== analyser.frequencyBinCount) {
        realtimeLipSyncFrequencyData = new Uint8Array(analyser.frequencyBinCount);
    }
    if (!realtimeLipSyncTimeData || realtimeLipSyncTimeData.length !== analyser.fftSize) {
        realtimeLipSyncTimeData = new Uint8Array(analyser.fftSize);
    }
    analyser.getByteFrequencyData(realtimeLipSyncFrequencyData);
    analyser.getByteTimeDomainData(realtimeLipSyncTimeData);
    const array = realtimeLipSyncFrequencyData;

    let rmsSum = 0;
    for (let i = 0; i < realtimeLipSyncTimeData.length; i++) {
        const sample = (realtimeLipSyncTimeData[i] - 128) / 128;
        rmsSum += sample * sample;
    }
    const rms = Math.sqrt(rmsSum / Math.max(1, realtimeLipSyncTimeData.length));

    const binCount = array.length;
    const sampleRate = analyser.context?.sampleRate || 48000;
    const binHz = sampleRate / (binCount * 2);
    const veryLowEnd = Math.floor(400 / binHz);
    const lowEnd = Math.floor(800 / binHz);
    const midEnd = Math.floor(1500 / binHz);
    const highEnd = Math.floor(2500 / binHz);

    let veryLowSum = 0, lowSum = 0, midSum = 0, highSum = 0, totalSum = 0;
    const analysisEnd = Math.min(binCount, highEnd + 50);
    for (let i = 0; i < analysisEnd; i++) {
        const val = array[i];
        totalSum += val;
        if (i < veryLowEnd) veryLowSum += val;
        else if (i < lowEnd) lowSum += val;
        else if (i < midEnd) midSum += val;
        else if (i < highEnd) highSum += val;
    }

    const veryLowAvg = veryLowSum / Math.max(1, veryLowEnd);
    const lowAvg = lowSum / Math.max(1, lowEnd - veryLowEnd);
    const midAvg = midSum / Math.max(1, midEnd - lowEnd);
    const highAvg = highSum / Math.max(1, highEnd - midEnd);
    const totalAvg = totalSum / Math.max(1, analysisEnd);
    const speechActive = rms > REALTIME_MOUTH_THRESHOLD || totalAvg > 11;

    if (speechActive) {
        const baseOpen = Math.min(1.0, Math.max(0, (rms - REALTIME_MOUTH_THRESHOLD) * 18) * REALTIME_MOUTH_BOOST + Math.max(0, totalAvg - 8) / 140);
        const totalEnergy = veryLowAvg + lowAvg + midAvg + highAvg + 0.1;
        const ouWeight = (veryLowAvg * 1.5) / totalEnergy;
        const ohWeight = (lowAvg * 1.3 + veryLowAvg * 0.5) / totalEnergy;
        const aaWeight = (midAvg * 1.5 + lowAvg * 0.5) / totalEnergy;
        const eeWeight = (highAvg * 0.8 + midAvg * 0.4) / totalEnergy;
        const ihWeight = (highAvg * 1.2) / totalEnergy;

        setExpressionIfChanged(expressionMgr, "ou", baseOpen * ouWeight * 1.0);
        setExpressionIfChanged(expressionMgr, "oh", baseOpen * ohWeight * 1.1);
        setExpressionIfChanged(expressionMgr, "aa", baseOpen * aaWeight * 1.3);
        setExpressionIfChanged(expressionMgr, "ee", baseOpen * eeWeight * 0.9);
        setExpressionIfChanged(expressionMgr, "ih", baseOpen * ihWeight * 0.7);
    } else {
        for (const name of VRM_VISEMES) {
            const current = expressionMgr.getValue(name) || 0;
            const decayed = current * VISEME_DECAY[name];
            setExpressionIfChanged(expressionMgr, name, decayed < REALTIME_MOUTH_CUTOFF ? 0 : decayed);
        }
    }
}

function startRealtimeLipSync(character) {
    if (!extension_settings.vrm.tts_lips_sync) return;

    if (realtimeLipSyncActive && realtimeLipSyncCharacter === character) {
        return; // Already running for this character
    }
    
    stopRealtimeLipSync(); // Stop any existing
    
    realtimeLipSyncActive = true;
    realtimeLipSyncCharacter = character;
    realtimeLipSyncLastUpdate = 0;
    markUserActivity("tts-lipsync-start");
    
    console.debug(DEBUG_PREFIX, "Starting real-time lip sync for", character);
}

function stopRealtimeLipSync() {
    if (realtimeLipSyncAnimationId) {
        cancelAnimationFrame(realtimeLipSyncAnimationId);
        realtimeLipSyncAnimationId = null;
    }
    
    // Close mouth
    if (realtimeLipSyncCharacter && current_avatars[realtimeLipSyncCharacter]) {
        const avatar = current_avatars[realtimeLipSyncCharacter];
        const expressionMgr = avatar["vrm"].expressionManager;
        duckMouthOwningExpressionsForLipSync(avatar, expressionMgr, false);
        setMouthOverrideSuspendedForLipSync(expressionMgr, false);
        expressionMgr.setValue("aa", 0);
        expressionMgr.setValue("ee", 0);
        expressionMgr.setValue("ih", 0);
        expressionMgr.setValue("oh", 0);
        expressionMgr.setValue("ou", 0);
    }
    
    realtimeLipSyncActive = false;
    realtimeLipSyncCharacter = null;
    realtimeLipSyncFrequencyData = null;
    realtimeLipSyncTimeData = null;
    console.debug(DEBUG_PREFIX, "Stopped real-time lip sync");
}

// Expose for VoiceForge to control
window.vrmStartLipSync = startRealtimeLipSync;
window.vrmStopLipSync = stopRealtimeLipSync;

function clampPercent(value, fallback, max = 250) {
    const raw = Number(value ?? fallback);
    return Math.max(0, Math.min(max, Number.isFinite(raw) ? raw : fallback)) / 100;
}

function getLightingPresetConfig() {
    const preset = String(extension_settings.vrm?.light_preset || 'studio').toLowerCase();
    const presets = {
        flat: { key: 0.62, fill: 0.68, rim: 0.12, ambient: 0.72, contrast: 0.25, elevation: 1.1 },
        studio: { key: 0.78, fill: 0.38, rim: 0.38, ambient: 0.48, contrast: 0.5, elevation: 1.42 },
        dramatic: { key: 0.95, fill: 0.18, rim: 0.62, ambient: 0.28, contrast: 0.78, elevation: 1.55 },
        anime: { key: 0.82, fill: 0.48, rim: 0.45, ambient: 0.58, contrast: 0.44, elevation: 1.3 },
        rim: { key: 0.62, fill: 0.22, rim: 0.86, ambient: 0.34, contrast: 0.68, elevation: 1.28 },
    };
    return presets[preset] || presets.studio;
}

// color: any valid color format
// intensity: percent
function setLight(color, intensity) {
    if (!light) return;

    const preset = getLightingPresetConfig();
    const contrast = clampPercent(extension_settings.vrm?.lighting_contrast, 58, 100);
    const contrastMix = preset.contrast * 0.72 + contrast * 0.5;
    const keyIntensity = clampPercent(intensity, 82, 250) * preset.key * (0.78 + contrastMix * 0.28);
    const fillIntensity = clampPercent(extension_settings.vrm?.fill_light_intensity, 32, 200) * preset.fill * (0.92 - contrastMix * 0.32);
    const ambientIntensity = clampPercent(extension_settings.vrm?.ambient_light_intensity, 36, 200) * preset.ambient * (0.9 - contrastMix * 0.24);
    const rimIntensity = clampPercent(extension_settings.vrm?.rim_light_intensity, 48, 250) * preset.rim * (0.62 + contrastMix * 0.32);
    const angle = THREE.MathUtils.degToRad(Number(extension_settings.vrm?.key_light_angle ?? 35) || 35);
    const keyX = Math.sin(angle) * 2.2;
    const keyZ = Math.cos(angle) * 1.55;

    light.color = new THREE.Color(color || '#ffffff');
    light.intensity = keyIntensity;
    light.position.set(keyX, preset.elevation, keyZ).normalize();

    if (fillLight) {
        fillLight.color = new THREE.Color('#fff0dc');
        fillLight.intensity = fillIntensity;
        fillLight.position.set(-keyX * 0.7, 0.72, keyZ * 0.75).normalize();
    }

    if (rimLight) {
        rimLight.color = new THREE.Color(extension_settings.vrm?.rim_light_color || '#bcd8ff');
        rimLight.intensity = extension_settings.vrm?.rim_light_enabled === false ? 0 : rimIntensity;
        rimLight.position.set(-keyX * 0.42, 1.18, -2.25).normalize();
    }

    if (ambientLight) {
        ambientLight.color = new THREE.Color('#fff5ea');
        ambientLight.groundColor = new THREE.Color('#24202c');
        ambientLight.intensity = ambientIntensity;
    }
}

function setBackground(scenePath, scale, position, rotation) {

    if (background) {
        scene.remove(scene.getObjectByName(background.name));
    }

    if (scenePath.endsWith(".fbx")) {
        const fbxLoader = new FBXLoader()
        fbxLoader.load(
            scenePath,
        (object) => {
            // object.traverse(function (child) {
            //     if ((child as THREE.Mesh).isMesh) {
            //         // (child as THREE.Mesh).material = material
            //         if ((child as THREE.Mesh).material) {
            //             ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).transparent = false
            //         }
            //     }
            // })
            // object.scale.set(.01, .01, .01)
            background = object;
            background.scale.set(scale, scale, scale);
            background.position.set(position.x,position.y,position.z);
            background.rotation.set(rotation.x,rotation.y,rotation.z);
            background.name = "background";
            scene.add(background);
        },
        undefined,
        (error) => {
            console.error(DEBUG_PREFIX, 'Failed to load FBX background:', error)
        }
        )
    }

    if (scenePath.endsWith(".gltf")) {
        const loader = new GLTFLoader();

        loader.load( scenePath, function ( gltf ) {

            background = gltf.scene;
            background.scale.set(scale, scale, scale);
            background.position.set(position.x,position.y,position.z);
            background.rotation.set(rotation.x,rotation.y,rotation.z);
            scene.add(background);

        }, undefined, function ( error ) {

            console.error( error );

        } );
    }
}
