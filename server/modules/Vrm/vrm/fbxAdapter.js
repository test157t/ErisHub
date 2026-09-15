import * as THREE from '/assets/modules/embody/lib/three.module.js';

const VRM_BONE_NAMES = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftEye', 'rightEye', 'jaw',
  'leftShoulder', 'rightShoulder',
  'leftUpperArm', 'rightUpperArm',
  'leftLowerArm', 'rightLowerArm',
  'leftHand', 'rightHand',
  'leftUpperLeg', 'rightUpperLeg',
  'leftLowerLeg', 'rightLowerLeg',
  'leftFoot', 'rightFoot',
  'leftToes', 'rightToes',
];

const VRC_VISEMES = ['aa', 'ee', 'ih', 'oh', 'ou'];

function normalizeViseme(name) {
  const lower = name.toLowerCase().replace(/^vrc[._]?/, '');
  return VRC_VISEMES.includes(lower) ? lower : null;
}

function buildBoneLookup(root) {
  const allBones = {};
  root.traverse((child) => {
    if (child.isBone) allBones[child.name] = child;
  });

  const humanoidBones = {};
  const usedBones = new Set();

  for (const vrmName of VRM_BONE_NAMES) {
    const match = Object.keys(allBones).find((name) =>
      !usedBones.has(name) && name.toLowerCase() === vrmName.toLowerCase()
    );
    if (match) {
      humanoidBones[vrmName] = allBones[match];
      usedBones.add(match);
    }
  }

  return { allBones, humanoidBones };
}

function collectMorphTargets(root) {
  const morphs = {};
  root.traverse((child) => {
    if (!child.isMesh || !child.morphTargetDictionary || !child.morphTargetInfluences) return;
    for (const [name, index] of Object.entries(child.morphTargetDictionary)) {
      (morphs[name] ||= []).push({ mesh: child, index });
    }
  });
  return morphs;
}

export function buildFbxVrmShim(fbxGroup) {
  const { allBones, humanoidBones } = buildBoneLookup(fbxGroup);
  const expressionManager = new FbxExpressionManager(fbxGroup);

  return {
    humanoid: {
      getRawBoneNode(name) { return humanoidBones[name] || null; },
      getNormalizedBoneNode(name) { return humanoidBones[name] || null; },
    },
    expressionManager,
    scene: fbxGroup,
    meta: { metaVersion: 'fbx' },
    lookAt: { target: new THREE.Vector3(0, 0, 0) },
    springBoneManager: { reset() {}, joints: [], colliderGroups: [] },
    blendShapeProxy: null,
    update() {},
    allBoneNames: Object.keys(allBones).sort(),
  };
}

class FbxExpressionManager {
  constructor(root) {
    this._morphs = collectMorphTargets(root);
    this.expressionMap = {};
    this.expressions = [];
    this.lookAtExpressionNames = new Set();

    for (const name of Object.keys(this._morphs)) {
      this.expressionMap[name] = { expressionName: name };
      this.expressions.push({ expressionName: name, overrideMouth: undefined, _embodyLipSyncOverrideMouth: undefined });
    }
  }

  _resolve(name) {
    if (this._morphs[name]) return this._morphs[name];
    const normalized = normalizeViseme(name);
    if (normalized && normalized !== name) {
      for (const [key, targets] of Object.entries(this._morphs)) {
        if (normalizeViseme(key) === normalized) return targets;
      }
    }
    return null;
  }

  getValue(name) {
    const targets = this._resolve(name);
    if (!targets || targets.length === 0) return 0;
    return targets[0].mesh.morphTargetInfluences[targets[0].index] || 0;
  }

  setValue(name, val) {
    const clamped = Math.max(0, Math.min(1, Number(val) || 0));
    const targets = this._resolve(name);
    if (!targets) return;
    for (const { mesh, index } of targets) {
      mesh.morphTargetInfluences[index] = clamped;
    }
  }
}

export { buildBoneLookup, collectMorphTargets };
