export {
    MODULE_NAME,
    extensionFolderPath,
    DEBUG_PREFIX,
    VRM_CANVAS_ID,
    VRM_MODEL_FOLDER,
    CLASSIFY_EXPRESSIONS,
    FALLBACK_EXPRESSION,
    DEFAULT_EXPRESSION_MAPPING,
    DEFAULT_MOTION_MAPPING,
    MIN_SCALE,
    MAX_SCALE,
    ANIMATION_FADE_TIME,
    SPRITE_DIV,
    VN_MODE_DIV,
    DEFAULT_SCALE,
    HITBOXES,
    HIT_BOX_DELAY,
    DEFAULT_LIGHT_COLOR,
    DEFAULT_LIGHT_INTENSITY,
    DEFAULT_CUSTOM_EXPRESSIONS
}

const MODULE_NAME = "VRM";
const VRM_MODEL_FOLDER = "live2d";
const extensionFolderPath = `scripts/extensions/third-party/Extension-Embody`;
const DEBUG_PREFIX = "<VRM module>";
const VRM_CANVAS_ID = "vrm-canvas";
const MIN_SCALE = 0.2;
const MAX_SCALE = 30;
const ANIMATION_FADE_TIME = 0.3;
const SPRITE_DIV = 'expression-wrapper';
const VN_MODE_DIV = 'visual-novel-wrapper';

const DEFAULT_SCALE = 3.0;
const HIT_BOX_DELAY = 100;
const DEFAULT_LIGHT_COLOR = "#FFFFFF";
const DEFAULT_LIGHT_INTENSITY = 100;

const CLASSIFY_EXPRESSIONS = [
    "admiration",
    "amusement",
    "anger",
    "annoyance",
    "approval",
    "caring",
    "confusion",
    "curiosity",
    "desire",
    "disappointment",
    "disapproval",
    "disgust",
    "embarrassment",
    "excitement",
    "fear",
    "gratitude",
    "grief",
    "joy",
    "love",
    "nervousness",
    "optimism",
    "pride",
    "realization",
    "relief",
    "remorse",
    "sadness",
    "surprise",
    "neutral"
];

const FALLBACK_EXPRESSION = "neutral";

const DEFAULT_EXPRESSION_MAPPING = {
    // Fallback
    "default": "neutral",

    // Classify class
    "admiration": "relaxed",
    "amusement": "relaxed",
    "anger": "angry",
    "annoyance": "angry",
    "approval": "relaxed",
    "caring": "relaxed",
    "confusion": "surprised",
    "curiosity": "surprised",
    "desire": "relaxed",
    "disappointment": "angry",
    "disapproval": "angry",
    "disgust": "angry",
    "embarrassment": "surprised",
    "excitement": "surprised",
    "fear": "sad",
    "gratitude": "relaxed",
    "grief": "sad",
    "joy": "relaxed",
    "love": "relaxed",
    "nervousness": "sad",
    "optimism": "relaxed",
    "pride": "relaxed",
    "realization": "surprised",
    "relief": "relaxed",
    "remorse": "sad",
    "sadness": "sad",
    "surprise": "surprised",
    "neutral": "neutral",

    // Hitboxes
    "head": "relaxed",
    "chest": "angry",
    "groin": "angry",
    "butt": "angry",
    "leftHand": "relaxed",
    "rightHand": "relaxed",
    "leftLeg": "surprised",
    "rightLeg": "surprised",
    "rightFoot": "surprised",
    "leftFoot": "surprised"
}

const DEFAULT_MOTION_MAPPING = {
    // Fallback
    "default": "/assets/vrm/animations/neutral.bvh",

    // Classify class
    "admiration": "/assets/vrm/animations/admiration.bvh",
    "amusement": "/assets/vrm/animations/amusement.bvh",
    "anger": "/assets/vrm/animations/anger.bvh",
    "annoyance": "/assets/vrm/animations/annoyance.bvh",
    "approval": "/assets/vrm/animations/approval.bvh",
    "caring": "/assets/vrm/animations/neutral.bvh",
    "confusion": "/assets/vrm/animations/confusion.bvh",
    "curiosity": "/assets/vrm/animations/curiosity.bvh",
    "desire": "/assets/vrm/animations/desire.bvh",
    "disappointment": "/assets/vrm/animations/disappointment.bvh",
    "disapproval": "/assets/vrm/animations/disapproval.bvh",
    "disgust": "/assets/vrm/animations/disgust.bvh",
    "embarrassment": "/assets/vrm/animations/embarrassment.bvh",
    "excitement": "/assets/vrm/animations/excitement.bvh",
    "fear": "/assets/vrm/animations/fear.bvh",
    "gratitude": "/assets/vrm/animations/gratitude.bvh",
    "grief": "/assets/vrm/animations/grief.bvh",
    "joy": "/assets/vrm/animations/joy.bvh",
    "love": "/assets/vrm/animations/love.bvh",
    "nervousness": "/assets/vrm/animations/nervousness.bvh",
    "neutral": "/assets/vrm/animations/neutral.bvh",
    "optimism": "/assets/vrm/animations/optimism.bvh",
    "pride": "/assets/vrm/animations/pride.bvh",
    "realization": "/assets/vrm/animations/realization.bvh",
    "relief": "/assets/vrm/animations/relief.bvh",
    "remorse": "/assets/vrm/animations/remorse.bvh",
    "sadness": "/assets/vrm/animations/sadness.bvh",
    "surprise": "/assets/vrm/animations/surprise.bvh",

    // Hitboxes
    "head": "/assets/vrm/animations/hitarea_head.bvh",
    "chest": "/assets/vrm/animations/hitarea_chest.bvh",
    "groin": "/assets/vrm/animations/hitarea_groin.bvh",
    "butt": "/assets/vrm/animations/hitarea_butt.bvh",
    "leftHand": "/assets/vrm/animations/hitarea_hands.bvh",
    "rightHand": "/assets/vrm/animations/hitarea_hands.bvh",
    "leftLeg": "/assets/vrm/animations/hitarea_leg.bvh",
    "rightLeg": "/assets/vrm/animations/hitarea_leg.bvh",
    "rightFoot": "/assets/vrm/animations/hitarea_foot.bvh",
    "leftFoot": "/assets/vrm/animations/hitarea_foot.bvh"
}

const HITBOXES = {
    "head": {
        "bone": "head",
        "size": {
            "x":0.1,
            "y":0.1,
            "z":0.1,
        },
        "offset": {
            "x":0,
            "y":0.08,
            "z":0,
        },
        "color": 0x6699ff
    },
    "chest": {
        "bone": "upperChest",
        "size": {
            "x":0.15,
            "y":0.1,
            "z":0.08,
        },
        "offset": {
            "x":0,
            "y":0.00,
            "z":-0.1,
        },
        "color": 0x6666ff
    },
    "leftHand": {
        "bone": "leftHand",
        "size": {
            "x":0.07,
            "y":0.07,
            "z":0.07,
        },
        "offset": {
            "x":0.05,
            "y":-0.05,
            "z":0.0,
        },
        "color": 0x6666ff
    },
    "rightHand": {
        "bone": "rightHand",
        "size": {
            "x":0.07,
            "y":0.07,
            "z":0.07,
        },
        "offset": {
            "x":-0.05,
            "y":-0.05,
            "z":0.0,
        },
        "color": 0x6666ff
    },
    "groin": {
        "bone": "hips",
        "size": {
            "x":0.05,
            "y":0.05,
            "z":0.12,
        },
        "offset": {
            "x":0,
            "y":-0.1,
            "z":-0.1,
        },
        "color": 0xff99e6
    },
    "butt": {
        "bone": "hips",
        "size": {
            "x":0.15,
            "y":0.1,
            "z":0.05,
        },
        "offset": {
            "x":0,
            "y":0,
            "z":0.1,
        },
        "color": 0xff00ff
    },
    "leftLeg": {
        "bone": "leftLowerLeg",
        "size": {
            "x":0.1,
            "y":0.2,
            "z":0.1,
        },
        "offset": {
            "x":0,
            "y":0,
            "z":0,
        },
        "color": 0x6600cc
    },
    "rightLeg": {
        "bone": "rightLowerLeg",
        "size": {
            "x":0.1,
            "y":0.2,
            "z":0.1,
        },
        "offset": {
            "x":0,
            "y":0,
            "z":0,
        },
        "color": 0x6600cc
    },
    "leftFoot": {
        "bone": "leftFoot",
        "size": {
            "x":0.1,
            "y":0.1,
            "z":0.1,
        },
        "offset": {
            "x":0,
            "y":0,
            "z":0,
        },
        "color": 0x6600cc
    },
    "rightFoot": {
        "bone": "rightFoot",
        "size": {
            "x":0.1,
            "y":0.1,
            "z":0.1,
        },
        "offset": {
            "x":0,
            "y":0,
            "z":0,
        },
        "color": 0x6600cc
    }
}

const DEFAULT_CUSTOM_EXPRESSIONS = {
    "shy": {
        blendShapes: {
            "aa": 0.0,
            "ih": 0.0,
            "ou": 0.0,
            "ee": 0.0,
            "oh": 0.0
        },
        intensity: 0.6
    },
    "smirk": {
        blendShapes: {
            "aa": 0.0,
            "ih": 0.0,
            "ou": 0.0,
            "ee": 0.0,
            "oh": 0.0
        },
        intensity: 0.7
    },
    "blush": {
        blendShapes: {
            "aa": 0.0,
            "ih": 0.0,
            "ou": 0.0,
            "ee": 0.0,
            "oh": 0.0
        },
        intensity: 0.5
    },
    "wink": {
        blendShapes: {
            "aa": 0.0,
            "ih": 0.0,
            "ou": 0.0,
            "ee": 0.0,
            "oh": 0.0
        },
        intensity: 0.8
    },
    "pout": {
        blendShapes: {
            "aa": 0.0,
            "ih": 0.0,
            "ou": 0.0,
            "ee": 0.0,
            "oh": 0.0
        },
        intensity: 0.6
    },
    "cute": {
        blendShapes: {
            "aa": 0.0,
            "ih": 0.0,
            "ou": 0.0,
            "ee": 0.0,
            "oh": 0.0
        },
        intensity: 0.5
    }
}
