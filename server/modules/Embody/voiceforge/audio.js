globalThis.__nitralEmbodyNative = true;
const nitralState = globalThis.__nitralEmbodyRuntimeState || (globalThis.__nitralEmbodyRuntimeState = {
    callbacks: {},
    chatMessages: [],
    characters: [],
    events: new EventTarget(),
    extension_settings: {
        callmode: {},
        tts: { tts_volume: 100, playbackBar: { tts_volume: 100, playback_speed: 1.0, auto_hide_delay: 2000 } },
        voiceforge: {},
    },
});
const extension_settings = nitralState.extension_settings;
function saveSettingsDebounced() {}
function getRequestHeaders() { return { 'Content-Type': 'application/json' }; }
function getContext() { return { chatMetadata: {}, name2: nitralState.characters[0] || '', characters: nitralState.characters.map((name) => ({ name })), chat: nitralState.chatMessages }; }
function isDataURL(value) { return /^data:/i.test(String(value || '')); }
const SlashCommandParser = { addCommandObject: () => {} };
class SlashCommand { static fromProps(props) { return props; } }
class SlashCommandArgument { static fromProps(props) { return props; } }
class SlashCommandEnumValue { constructor(value, description, type, icon) { Object.assign(this, { value, description, type, icon }); } }
const enumTypes = { name: 'name' };
const enumIcons = { file: 'file' };
const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

const console = { ...globalThis.console, debug: () => {}, log: () => {}, info: () => {} };

export {
    AudioManager,
    initAudioModule,
    getAudioSettings,
};

const DEBUG_PREFIX = '<VoiceForge Audio> ';
const UPDATE_INTERVAL = 1000;

const ASSETS_BGM_FOLDER = 'bgm';
const ASSETS_AMBIENT_FOLDER = 'ambient';
const CHARACTER_BGM_FOLDER = 'bgm';

const DEFAULT_EXPRESSION = 'neutral';
const DEFAULT_EXPRESSIONS = [
    'admiration', 'amusement', 'anger', 'annoyance', 'approval', 'caring',
    'confusion', 'curiosity', 'desire', 'disappointment', 'disapproval',
    'disgust', 'embarrassment', 'excitement', 'fear', 'gratitude', 'grief',
    'joy', 'love', 'nervousness', 'optimism', 'pride', 'realization',
    'relief', 'remorse', 'sadness', 'surprise', 'neutral',
];
const SPRITE_DOM_ID = '#expression-image';

const AUDIO_SLIDER_CURVE_EXPONENT = 1.5;

function sliderPercentToGain(percent) {
    const normalized = Math.max(0, Math.min(100, Number(percent) || 0)) / 100;
    return Math.pow(normalized, AUDIO_SLIDER_CURVE_EXPONENT);
}

/**
 * Default audio settings
 */
const defaultAudioSettings = {
    // Master enable
    audio_enabled: false,
    
    // BGM settings
    bgm_enabled: true,
    bgm_dynamic_enabled: false,
    bgm_locked: true,
    bgm_muted: true,
    bgm_volume: 50,
    bgm_selected: null,
    bgm_cooldown: 30,
    
    // Ambient settings
    ambient_enabled: true,
    ambient_locked: true,
    ambient_muted: true,
    ambient_volume: 50,
    ambient_selected: null,
    
    // VoiceForge background (from streaming TTS)
    voiceforge_bg_enabled: true,
    voiceforge_bg_volume: 30,
    voiceforge_bg_persist: true,  // Keep background playing until different tracks are requested
};

/**
 * Unified Audio Manager
 * Handles BGM, ambient, and VoiceForge background audio
 */
class AudioManager {
    // Audio elements
    bgmElement = null;
    ambientElement = null;
    voiceforgeBgElement = null;  // TTS streaming background
    
    // VoiceForge background tracks state
    
    // State tracking
    currentChatId = null;
    defaultBGMs = null;
    ambients = null;
    characterMusics = {};
    currentCharacterBGM = null;
    currentExpressionBGM = null;
    currentBackground = null;
    cooldownBGM = 0;
    bgmEnded = true;
    bgmUpdateTimeout = null;
    lastBgmPath = '';
    isFading = false;
    
    // VoiceForge background state
    voiceforgeBgStreamInfo = null;
    currentBgCharacter = null;  // Track which character's background is playing
    voiceforgeBgStartKey = null;
    
    // TTS speech playback (WebAudio)
    ttsAudioContext = null;
    ttsAnalyser = null;
    ttsGain = null;
    ttsActiveSource = null;
    ttsPlaybackQueue = Promise.resolve();
    ttsPlaybackToken = 0;
    _ttsAnalyserRegistered = false;
    _ttsVolume = 100;
    
    constructor() {
        // Create audio elements
        this.bgmElement = new Audio();
        this.bgmElement.id = 'audio_bgm';
        
        this.ambientElement = new Audio();
        this.ambientElement.id = 'audio_ambient';
        this.ambientElement.loop = true;
        
        this.voiceforgeBgElement = new Audio();
        this.voiceforgeBgElement.id = 'voiceforge_bg_audio';
        this.voiceforgeBgElement.loop = true;
    }
    
    /**
     * Get audio settings from extension_settings
     * Merges with defaults to ensure all keys exist
     */
    getSettings() {
        if (!extension_settings.tts) {
            extension_settings.tts = {};
        }
        if (!extension_settings.tts.audio) {
            extension_settings.tts.audio = { ...defaultAudioSettings };
        } else {
            // Merge with defaults to ensure new keys are present
            for (const key in defaultAudioSettings) {
                if (!(key in extension_settings.tts.audio)) {
                    extension_settings.tts.audio[key] = defaultAudioSettings[key];
                }
            }
        }
        return extension_settings.tts.audio;
    }

    stableBackgroundSessionId(characterName, tracksKey) {
        const source = `${characterName || 'default'}|${tracksKey || ''}`;
        let hash = 2166136261;
        for (let i = 0; i < source.length; i++) {
            hash ^= source.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return `bg-${(hash >>> 0).toString(36)}`;
    }

    normalizeVoiceForgeBackgroundTracks(tracks) {
        return (Array.isArray(tracks) ? tracks : []).map((track) => {
            if (typeof track === 'string') return track.trim() ? { file: track.trim() } : null;
            if (!track || typeof track !== 'object') return null;
            const file = String(track.file || track.path || track.url || '').trim();
            if (!file) return null;
            return {
                file,
                volume: Number(track.volume ?? 0.5),
                delay: Number(track.delay ?? 0),
                fade_in: Number(track.fade_in ?? track.fadeIn ?? 0),
                fade_out: Number(track.fade_out ?? track.fadeOut ?? 0),
            };
        }).filter(Boolean);
    }
    
    /**
     * Initialize audio module
     */
    async init() {
        // Ensure settings exist
        if (!extension_settings.tts.audio) {
            extension_settings.tts.audio = { ...defaultAudioSettings };
        }
        
        // Apply saved settings
        const settings = this.getSettings();
        
        this.bgmElement.volume = sliderPercentToGain(settings.bgm_volume);
        this.bgmElement.muted = settings.bgm_muted;
        this.bgmElement.loop = settings.bgm_locked;
        
        this.ambientElement.volume = sliderPercentToGain(settings.ambient_volume);
        this.ambientElement.muted = settings.ambient_muted;
        
        this.voiceforgeBgElement.volume = settings.voiceforge_bg_volume * 0.01;
        
        // Setup BGM ended handler
        this.bgmElement.addEventListener('ended', () => {
            console.debug(DEBUG_PREFIX, 'BGM ended');
            if (!settings.bgm_locked) {
                this.bgmEnded = true;
                this.updateBGM();
            }
        });
        
        // Add elements to DOM (hidden)
        document.body.appendChild(this.bgmElement);
        document.body.appendChild(this.ambientElement);
        document.body.appendChild(this.voiceforgeBgElement);
        
        console.debug(DEBUG_PREFIX, 'Audio manager initialized');
        
        // Load saved audio selections after a short delay (to allow UI to initialize)
        // This ensures locked/selected audio plays on page load
        setTimeout(() => this.loadSavedAudio(), 1000);
    }
    
    /**
     * Load saved audio selections on startup
     */
    async loadSavedAudio() {
        const settings = this.getSettings();
        
        if (!settings.audio_enabled) {
            console.debug(DEBUG_PREFIX, 'Audio disabled, skipping saved audio load');
            return;
        }
        
        console.debug(DEBUG_PREFIX, 'Loading saved audio selections...');
        
        let needsUserInteraction = false;
        
        // Load ambient if enabled and has selection
        if (settings.ambient_enabled && settings.ambient_selected) {
            console.debug(DEBUG_PREFIX, 'Loading saved ambient:', settings.ambient_selected);
            this.ambientElement.src = settings.ambient_selected;
            try {
                await this.ambientElement.play();
            } catch (err) {
                console.debug(DEBUG_PREFIX, 'Ambient autoplay blocked:', err.message);
                needsUserInteraction = true;
            }
        }
        
        // Load BGM if enabled and has selection
        if (settings.bgm_enabled && settings.bgm_selected && settings.bgm_locked) {
            console.debug(DEBUG_PREFIX, 'Loading saved BGM:', settings.bgm_selected);
            this.bgmElement.src = settings.bgm_selected;
            this.lastBgmPath = settings.bgm_selected;
            try {
                await this.bgmElement.play();
            } catch (err) {
                console.debug(DEBUG_PREFIX, 'BGM autoplay blocked:', err.message);
                needsUserInteraction = true;
            }
        }
        
        // If autoplay was blocked, set up one-time listener for user interaction
        if (needsUserInteraction) {
            console.debug(DEBUG_PREFIX, 'Autoplay blocked, waiting for user interaction...');
            const resumeAudio = () => {
                this.resumeBlockedAudio();
                document.removeEventListener('click', resumeAudio);
                document.removeEventListener('keydown', resumeAudio);
            };
            document.addEventListener('click', resumeAudio, { once: true });
            document.addEventListener('keydown', resumeAudio, { once: true });
        }
    }
    
    /**
     * Resume audio that was blocked by autoplay policy
     */
    async resumeBlockedAudio() {
        const settings = this.getSettings();
        
        if (!settings.audio_enabled) return;
        
        console.debug(DEBUG_PREFIX, 'User interaction detected, resuming audio...');
        
        if (settings.ambient_enabled && this.ambientElement.src && this.ambientElement.paused) {
            this.ambientElement.play().catch(() => {});
        }
        
        if (settings.bgm_enabled && this.bgmElement.src && this.bgmElement.paused && !settings.bgm_muted) {
            this.bgmElement.play().catch(() => {});
        }
    }
    
    /**
     * Initialize WebAudio context for TTS speech playback
     * Creates AudioContext, AnalyserNode, GainNode chain
     */
    initTtsContext() {
        if (this.ttsAudioContext && this.ttsAudioContext.state !== 'closed') return;
        this.ttsAudioContext = new AudioContext({ latencyHint: 'interactive' });
        this.ttsAnalyser = this.ttsAudioContext.createAnalyser();
        this.ttsAnalyser.fftSize = 512;
        this.ttsAnalyser.smoothingTimeConstant = 0.05;
        this.ttsGain = this.ttsAudioContext.createGain();
        this.ttsGain.gain.value = this._ttsVolume / 100;
        this.ttsAnalyser.connect(this.ttsGain);
        this.ttsGain.connect(this.ttsAudioContext.destination);
        this.registerTtsAnalyser();
    }

    /**
     * Play a TTS audio blob through WebAudio
     * Creates BufferSource, connects to Analyser -> Gain -> destination
     * Returns promise that resolves when playback completes
     */
    async playTtsBlob(blob, onStart) {
        const token = this.ttsPlaybackToken;
        const playback = this.ttsPlaybackQueue.then(() => this._playTtsBlobNow(blob, onStart, token));
        this.ttsPlaybackQueue = playback.catch(() => {});
        return playback;
    }

    async _playTtsBlobNow(blob, onStart, token) {
        this.initTtsContext();
        if (this.ttsAudioContext.state === 'suspended') await this.ttsAudioContext.resume();
        const arrayBuffer = await blob.arrayBuffer();
        const audioBuffer = await this.ttsAudioContext.decodeAudioData(arrayBuffer);
        if (token !== this.ttsPlaybackToken) return;
        const source = this.ttsAudioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.ttsAnalyser);
        this.ttsActiveSource = source;
        await new Promise((resolve) => {
            source.onended = () => resolve();
            source.start();
            if (typeof onStart === 'function') {
                Promise.resolve(onStart(audioBuffer.duration * 1000)).catch((error) => {
                    console.warn(DEBUG_PREFIX, 'TTS onStart callback failed:', error);
                });
            }
        });
        if (this.ttsActiveSource === source) this.ttsActiveSource = null;
    }

    /**
     * Stop active TTS playback
     */
    stopTtsPlayback() {
        this.ttsPlaybackToken += 1;
        this.ttsPlaybackQueue = Promise.resolve();
        if (this.ttsActiveSource) {
            try { this.ttsActiveSource.stop(); } catch (_) { /* ignore */ }
            this.ttsActiveSource = null;
        }
    }

    /**
     * Set TTS volume (0-100)
     */
    setTtsVolume(percent) {
        this._ttsVolume = Math.max(0, Math.min(100, Number(percent) || 0));
        if (this.ttsGain) this.ttsGain.gain.value = this._ttsVolume / 100;
    }

    /**
     * Get TTS AnalyserNode for VRM lipsync
     */
    getTtsAnalyser() {
        return this.ttsAnalyser;
    }

    /**
     * Register window.getVoiceForgeAnalyser for VRM lipsync
     */
    registerTtsAnalyser() {
        if (this._ttsAnalyserRegistered) return;
        this._ttsAnalyserRegistered = true;
        window.getVoiceForgeAnalyser = () => this.ttsAnalyser;
    }

    /**
     * Unregister window.getVoiceForgeAnalyser
     */
    unregisterTtsAnalyser() {
        this._ttsAnalyserRegistered = false;
        delete window.getVoiceForgeAnalyser;
    }

    /**
     * Module worker - called periodically to update audio
     */
    async update() {
        const settings = this.getSettings();
        
        // Always load assets regardless of audio_enabled state
        // This ensures dropdowns are populated even when audio is disabled
        if (this.defaultBGMs === null) {
            console.debug(DEBUG_PREFIX, 'Loading BGM assets...');
            this.defaultBGMs = await this.getAssetsList(ASSETS_BGM_FOLDER);
            this.defaultBGMs = this.defaultBGMs.filter(f => f !== '.placeholder');
            console.debug(DEBUG_PREFIX, 'BGM assets:', this.defaultBGMs);
        }
        
        if (this.ambients === null) {
            console.debug(DEBUG_PREFIX, 'Loading ambient assets...');
            this.ambients = await this.getAssetsList(ASSETS_AMBIENT_FOLDER);
            this.ambients = this.ambients.filter(f => f !== '.placeholder');
            console.debug(DEBUG_PREFIX, 'Ambient assets:', this.ambients);
        }
        
        // Early return if audio disabled - but assets are already loaded above
        if (!settings.audio_enabled) {
            return;
        }
        
        if (this.cooldownBGM > 0) {
            this.cooldownBGM -= UPDATE_INTERVAL;
        }
        
        // Update ambient based on background
        await this.updateAmbientForBackground();
        
        // Update BGM based on character/expression
        await this.updateBGMForCharacter();
    }
    
    /**
     * Update ambient sound based on current background
     */
    async updateAmbientForBackground() {
        const settings = this.getSettings();
        
        if (!settings.ambient_enabled || settings.ambient_locked) {
            return;
        }
        
        let newBackground = $('#bg1').css('background-image');
        const customBackground = getContext()['chatMetadata']['custom_background'];
        
        if (customBackground !== undefined) {
            newBackground = customBackground;
        }
        
        if (!isDataURL(newBackground)) {
            newBackground = newBackground
                .substring(newBackground.lastIndexOf('/') + 1)
                .replace(/\.[^/.]+$/, '')
                .replaceAll('%20', '-')
                .replaceAll(' ', '-');
            
            if (this.currentBackground !== newBackground) {
                this.currentBackground = newBackground;
                console.debug(DEBUG_PREFIX, 'Background changed to:', this.currentBackground);
                await this.updateAmbient();
            }
        }
    }
    
    /**
     * Update BGM based on current character and expression
     */
    async updateBGMForCharacter() {
        const settings = this.getSettings();
        const context = getContext();
        
        if (!settings.bgm_enabled || context.chat.length === 0) {
            return;
        }
        
        const chatIsGroup = context.chat[0].is_group;
        
        // Reset on chat change
        if (context.chatId !== this.currentChatId) {
            this.currentChatId = context.chatId;
            this.characterMusics = {};
            this.cooldownBGM = 0;
        }
        
        if (!chatIsGroup) {
            // Single character chat
            const newCharacter = context.name2;
            
            // Load character BGM if not loaded
            if (this.characterMusics[newCharacter] === undefined) {
                await this.loadCharacterBGM(newCharacter);
                this.currentExpressionBGM = DEFAULT_EXPRESSION;
                return;
            }
            
            // Character changed
            if (this.currentCharacterBGM !== newCharacter) {
                this.currentCharacterBGM = newCharacter;
                await this.updateBGM(false, true);
                this.cooldownBGM = settings.bgm_cooldown * 1000;
                return;
            }
            
            // Check expression change
            const newExpression = settings.bgm_dynamic_enabled
                ? this.getExpression(newCharacter)
                : DEFAULT_EXPRESSION;
            
            if (this.currentExpressionBGM !== newExpression) {
                if (this.cooldownBGM > 0) return;
                
                this.currentExpressionBGM = newExpression;
                await this.updateBGM();
                this.cooldownBGM = settings.bgm_cooldown * 1000;
            }
        } else {
            // Group chat - use last speaker
            const lastMessage = context.chat[context.chat.length - 1];
            const newCharacter = lastMessage?.name;
            const userName = context.name1;
            
            if (!newCharacter || newCharacter === userName) return;
            
            if (this.characterMusics[newCharacter] === undefined) {
                await this.loadCharacterBGM(newCharacter);
                return;
            }
            
            if (this.currentCharacterBGM !== newCharacter) {
                if (this.cooldownBGM > 0) return;
                
                this.currentCharacterBGM = newCharacter;
                this.currentExpressionBGM = DEFAULT_EXPRESSION;
                await this.updateBGM();
                this.cooldownBGM = settings.bgm_cooldown * 1000;
            }
        }
    }
    
    /**
     * Get assets list from server
     */
    async getAssetsList(type) {
        try {
            const result = await fetch('/api/assets/get', {
                method: 'POST',
                headers: getRequestHeaders({ omitContentType: true }),
            });
            const assets = result.ok ? await result.json() : {};
            console.debug(DEBUG_PREFIX, 'Assets API response:', assets);
            const output = assets[type] || [];
            return output.map(f => f.replaceAll('\\', '/'));
        } catch (err) {
            console.error(DEBUG_PREFIX, 'Failed to get assets:', err);
            return [];
        }
    }
    
    /**
     * Get character BGM list
     */
    async getCharacterBgmList(name) {
        try {
            const result = await fetch(
                `/api/assets/character?name=${encodeURIComponent(name)}&category=${CHARACTER_BGM_FOLDER}`,
                { method: 'POST', headers: getRequestHeaders() }
            );
            return result.ok ? await result.json() : [];
        } catch (err) {
            console.error(DEBUG_PREFIX, 'Failed to get character BGM:', err);
            return [];
        }
    }
    
    /**
     * Load character BGM files
     */
    async loadCharacterBGM(character) {
        console.debug(DEBUG_PREFIX, 'Loading BGM for:', character);
        
        const files = await this.getCharacterBgmList(character);
        
        this.characterMusics[character] = {};
        for (const exp of DEFAULT_EXPRESSIONS) {
            this.characterMusics[character][exp] = [];
        }
        
        for (const file of files) {
            for (const exp of DEFAULT_EXPRESSIONS) {
                if (file.includes(exp)) {
                    this.characterMusics[character][exp].push(file);
                }
            }
        }
        
        console.debug(DEBUG_PREFIX, 'BGM map for', character, ':', this.characterMusics[character]);
    }
    
    /**
     * Get current expression for character
     */
    getExpression(character) {
        if (!$(SPRITE_DOM_ID).length) {
            return DEFAULT_EXPRESSION;
        }
        
        const spriteFile = $(`#expression-image[src*="/${character}/"]`).attr('src');
        if (!spriteFile) {
            return DEFAULT_EXPRESSION;
        }
        
        const expression = spriteFile
            .substring(spriteFile.lastIndexOf('/') + 1)
            .replace(/\.[^/.]+$/, '');
        
        if (!expression || !DEFAULT_EXPRESSIONS.includes(expression)) {
            return DEFAULT_EXPRESSION;
        }
        
        return expression;
    }
    
    /**
     * Update BGM playback
     */
    async updateBGM(isUserInput = false, newChat = false) {
        if (this.bgmUpdateTimeout) clearTimeout(this.bgmUpdateTimeout);
        this.bgmUpdateTimeout = setTimeout(() => this._updateBGMInternal(isUserInput, newChat), 250);
    }
    
    async _updateBGMInternal(isUserInput = false, newChat = false) {
        const settings = this.getSettings();
        
        if (!isUserInput && !settings.bgm_dynamic_enabled && this.bgmElement.src && !this.bgmEnded && !newChat) {
            return;
        }
        
        let audioFilePath = '';
        
        if (isUserInput || (settings.bgm_locked && settings.bgm_selected)) {
            audioFilePath = settings.bgm_selected;
        } else {
            let audioFiles = [];
            
            if (settings.bgm_dynamic_enabled && this.currentCharacterBGM) {
                audioFiles = this.characterMusics[this.currentCharacterBGM]?.[this.currentExpressionBGM] || [];
                
                if (audioFiles.length === 0) {
                    audioFiles = this.characterMusics[this.currentCharacterBGM]?.[DEFAULT_EXPRESSION] || this.defaultBGMs || [];
                }
            } else {
                audioFiles = this.defaultBGMs || [];
            }
            
            if (audioFiles.length === 0) return;
            
            audioFilePath = audioFiles[Math.floor(Math.random() * audioFiles.length)];
        }
        
        if (!audioFilePath || audioFilePath === this.lastBgmPath) return;
        
        console.debug(DEBUG_PREFIX, 'Switching BGM to:', audioFilePath);
        this.lastBgmPath = audioFilePath;
        
        const newVolume = sliderPercentToGain(settings.bgm_volume);
        const fadeTime = (isUserInput || settings.bgm_locked) ? 0 : 2000;
        
        if (!this.isFading && fadeTime > 0) {
            this.isFading = true;
            await this.fadeAudio(this.bgmElement, 0, fadeTime);
            this.bgmElement.src = audioFilePath;
            await this.bgmElement.play().catch(() => {});
            await this.fadeAudio(this.bgmElement, newVolume, fadeTime);
            this.isFading = false;
        } else {
            this.bgmElement.src = audioFilePath;
            this.bgmElement.volume = newVolume;
            await this.bgmElement.play().catch(() => {});
        }
        
        this.bgmEnded = false;
    }
    
    /**
     * Update ambient sound playback
     */
    async updateAmbient(isUserInput = false) {
        const settings = this.getSettings();
        
        let audioFilePath = null;
        
        if (isUserInput || settings.ambient_locked) {
            audioFilePath = settings.ambient_selected;
        } else {
            for (const file of (this.ambients || [])) {
                if (file.includes(this.currentBackground)) {
                    audioFilePath = file;
                    break;
                }
            }
        }
        
        if (!audioFilePath) {
            console.debug(DEBUG_PREFIX, 'No ambient for background:', this.currentBackground);
            this.ambientElement.pause();
            this.ambientElement.src = '';
            return;
        }
        
        if (this.ambientElement.src === audioFilePath) return;
        
        console.debug(DEBUG_PREFIX, 'Switching ambient to:', audioFilePath);
        
        const fadeTime = isUserInput ? 0 : 2000;
        const newVolume = sliderPercentToGain(settings.ambient_volume);
        
        await this.fadeAudio(this.ambientElement, 0, fadeTime);
        this.ambientElement.src = audioFilePath;
        await this.ambientElement.play().catch(() => {});
        await this.fadeAudio(this.ambientElement, newVolume, fadeTime);
    }
    
    /**
     * Fade audio element volume
     */
    fadeAudio(element, targetVolume, duration) {
        return new Promise(resolve => {
            if (duration === 0) {
                element.volume = targetVolume;
                resolve();
                return;
            }
            
            const startVolume = element.volume;
            const volumeDiff = targetVolume - startVolume;
            const steps = 20;
            const stepDuration = duration / steps;
            let currentStep = 0;
            
            const interval = setInterval(() => {
                currentStep++;
                element.volume = Math.max(0, Math.min(1, startVolume + (volumeDiff * currentStep / steps)));
                
                if (currentStep >= steps) {
                    clearInterval(interval);
                    element.volume = targetVolume;
                    resolve();
                }
            }, stepDuration);
        });
    }
    
    // =========================================
    // VoiceForge Background Audio (TTS Streaming)
    // =========================================
    
    /**
     * Start VoiceForge background audio stream
     * Called when TTS streaming starts with background enabled
     * @param {Object} bgInfo - Background info from server
     * @param {string} characterName - Name of character speaking (to track changes)
     */
    async startVoiceForgeBackground(bgInfo, characterName = null) {
        const settings = this.getSettings();
        
        console.log(DEBUG_PREFIX, '=== startVoiceForgeBackground ===');
        console.log(DEBUG_PREFIX, 'characterName:', JSON.stringify(characterName), 'type:', typeof characterName);
        console.log(DEBUG_PREFIX, 'currentBgCharacter:', JSON.stringify(this.currentBgCharacter), 'type:', typeof this.currentBgCharacter);
        console.log(DEBUG_PREFIX, 'hasTracks:', bgInfo?.tracks?.length || 0);
        console.log(DEBUG_PREFIX, 'isPlaying:', this.isVoiceForgeBackgroundPlaying());
        console.log(DEBUG_PREFIX, 'STRICT EQUAL:', this.currentBgCharacter === characterName);
        const normalizedTracks = this.normalizeVoiceForgeBackgroundTracks(bgInfo?.tracks);
        const tracksKey = JSON.stringify(normalizedTracks);
        const startKey = `${characterName || ''}|${tracksKey}`;
        const stableSessionId = this.stableBackgroundSessionId(characterName, tracksKey);
        
        // If no tracks provided, optionally stop
        if (!bgInfo || normalizedTracks.length === 0) {
            console.log(DEBUG_PREFIX, 'No background tracks to play');
            if (!settings.voiceforge_bg_persist && this.currentBgCharacter) {
                await this.stopVoiceForgeBackground(1.0, true);
            }
            return;
        }

        if (this.voiceforgeBgStartKey && this.voiceforgeBgStartKey === startKey && this.isVoiceForgeBackgroundPlaying()) {
            console.log(DEBUG_PREFIX, '✓ Same background start already active, keeping existing background');
            return;
        }
        
        // If same tracks are already playing, keep it (regardless of character name)
        if (this.voiceforgeBgTracksOnlyKey && this.voiceforgeBgTracksOnlyKey === tracksKey && this.isVoiceForgeBackgroundPlaying()) {
            console.log(DEBUG_PREFIX, '✓ Same background tracks already active, keeping existing background');
            this.voiceforgeBgStartKey = startKey;
            return;
        }
        
        // If same character is already set, don't restart - just keep playing
        if (this.currentBgCharacter && this.currentBgCharacter === characterName && this.isVoiceForgeBackgroundPlaying()) {
            console.log(DEBUG_PREFIX, '✓ Same character (' + characterName + '), keeping existing background');
            this.voiceforgeBgStartKey = startKey;
            return;
        }
        
        // WHY ARE WE HERE? Log the reason
        if (!this.currentBgCharacter) {
            console.log(DEBUG_PREFIX, '→ No current character set, starting fresh');
        } else {
            console.log(DEBUG_PREFIX, '→ Character mismatch! current:', JSON.stringify(this.currentBgCharacter), 'new:', JSON.stringify(characterName));
        }
        
        // Different character - stop current first
        if (this.currentBgCharacter && this.currentBgCharacter !== characterName) {
            console.log(DEBUG_PREFIX, '✗ Character changed from', this.currentBgCharacter, 'to', characterName);
            await this.stopVoiceForgeBackground(0.5, true);
        }
        
        // Set character BEFORE async operations
        this.currentBgCharacter = characterName;
        this.voiceforgeBgStartKey = startKey;
        this.voiceforgeBgTracksOnlyKey = tracksKey;
        console.log(DEBUG_PREFIX, '→ Starting background for:', characterName);
        
        try {
            console.log(DEBUG_PREFIX, 'Starting VoiceForge background stream...');
            console.log(DEBUG_PREFIX, 'Tracks:', bgInfo.tracks?.length || 0);
            console.log(DEBUG_PREFIX, 'VoiceForge background endpoint:', bgInfo.endpoint);

            // Build same-origin URL for the proxied VoiceForge background stream.
            // Include character name so server can reuse existing stream for same character
            // Use 600s (10 min) duration - loops anyway, smaller file = faster load
            const endpoint = String(bgInfo.endpoint || bgInfo.voiceforge_url || '').trim();
            if (!endpoint) {
                throw new Error('VoiceForge background endpoint is missing');
            }
            const params = new URLSearchParams({
                endpoint,
                session_id: stableSessionId,
                tracks_json: JSON.stringify(normalizedTracks),
                sample_rate: String(bgInfo.sample_rate || 44100),
                duration: '600',
            });
            // Add character parameter if available - server uses this to avoid restarting
            if (characterName) {
                params.set('character', characterName);
            }
            const streamUrl = `/api/modules/voiceforge/background-stream?${params}`;
            console.log(DEBUG_PREFIX, 'Background stream URL:', streamUrl);
            
            // Optionally duck the BGM while TTS plays (fire and forget - don't block)
            if (settings.bgm_enabled && !this.bgmElement.paused) {
                this.fadeAudio(this.bgmElement, sliderPercentToGain(settings.bgm_volume) * 0.3, 500);
            }
            
            // Start background audio - don't block on play() to avoid stalling TTS
            this.voiceforgeBgElement.src = streamUrl;
            this.voiceforgeBgElement.volume = 0;
            
            // Calculate fade settings before async operations
            const maxFadeIn = Math.max(...normalizedTracks.map(t => t.fade_in || 0), 0);
            const fadeTime = maxFadeIn > 0 ? maxFadeIn * 1000 : 500;
            const targetVolume = settings.voiceforge_bg_volume * 0.01;
            
            // Mobile browsers often never fire canplaythrough for streamed audio.
            let fadeStarted = false;
            const startFade = () => {
                if (fadeStarted) return;
                fadeStarted = true;
                this.fadeAudio(this.voiceforgeBgElement, targetVolume, fadeTime);
            };
            this.voiceforgeBgElement.addEventListener('canplay', startFade, { once: true });
            this.voiceforgeBgElement.addEventListener('canplaythrough', startFade, { once: true });
             
            // Start playback (fire and forget - don't await)
            this.voiceforgeBgElement.play().then(startFade).catch((error) => {
                console.warn(DEBUG_PREFIX, 'VoiceForge background play failed:', error);
                this.voiceforgeBgElement.removeEventListener('canplay', startFade);
                this.voiceforgeBgElement.removeEventListener('canplaythrough', startFade);
                this.currentBgCharacter = null;
                this.voiceforgeBgStartKey = null;
                this.voiceforgeBgTracksOnlyKey = null;
            });
            
            this.voiceforgeBgStreamInfo = bgInfo;
            console.log(DEBUG_PREFIX, 'VoiceForge background started for character:', characterName);
            
        } catch (err) {
            console.error(DEBUG_PREFIX, 'Failed to start VoiceForge background:', err);
            // Clear the character claim on failure so next attempt can try again
            console.log(DEBUG_PREFIX, 'CLEARING currentBgCharacter due to error');
            console.trace(DEBUG_PREFIX, 'Stack trace for error clear:');
            this.currentBgCharacter = null;
            this.voiceforgeBgStartKey = null;
        }
    }
    
    /**
     * Stop VoiceForge background audio stream
     * @param {number} fadeOut - Fade out duration in seconds
     * @param {boolean} force - If true, stop even in persist mode (default: false)
     */
    async stopVoiceForgeBackground(fadeOut = 2.0, force = false) {
        const settings = this.getSettings();
        
        console.log(DEBUG_PREFIX, '=== stopVoiceForgeBackground ===');
        console.log(DEBUG_PREFIX, 'force:', force);
        console.log(DEBUG_PREFIX, 'persist mode:', settings.voiceforge_bg_persist);
        console.log(DEBUG_PREFIX, 'currentBgCharacter before:', this.currentBgCharacter);
        
        // In persist mode, don't stop unless forced
        // Use !== false to handle undefined as true (default behavior)
        if (settings.voiceforge_bg_persist !== false && !force) {
            console.log(DEBUG_PREFIX, '→ Persist mode enabled, NOT stopping/clearing');
            return;
        }
        
        try {
            console.log(DEBUG_PREFIX, '→ Actually stopping VoiceForge background...');
            
            // Fade out
            await this.fadeAudio(this.voiceforgeBgElement, 0, fadeOut * 1000);
            this.voiceforgeBgElement.pause();
            this.voiceforgeBgElement.src = '';
            
            // Restore BGM volume
            if (settings.bgm_enabled && !this.bgmElement.paused) {
                await this.fadeAudio(this.bgmElement, sliderPercentToGain(settings.bgm_volume), 1000);
            }
            
            // Notify server to cleanup - include character name for proper tracking cleanup
            const sessionId = this.voiceforgeBgStreamInfo?.session_id;
            const endpoint = String(this.voiceforgeBgStreamInfo?.endpoint || '').trim();
            const stoppingCharacter = this.currentBgCharacter;
            if (sessionId && endpoint) {
                await fetch('/api/modules/voiceforge/background-stop', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ endpoint, session_id: sessionId, character: stoppingCharacter || '' }),
                }).catch(() => {});
            }
            
            this.voiceforgeBgStreamInfo = null;
            this.currentBgCharacter = null;
            this.voiceforgeBgStartKey = null;
            console.log(DEBUG_PREFIX, 'VoiceForge background stopped, currentBgCharacter CLEARED');
            console.trace(DEBUG_PREFIX, 'Stack trace for clear:');
            
        } catch (err) {
            console.error(DEBUG_PREFIX, 'Failed to stop VoiceForge background:', err);
        }
    }
    
    /**
     * Check if VoiceForge background is playing
     */
    isVoiceForgeBackgroundPlaying() {
        return this.voiceforgeBgElement && !this.voiceforgeBgElement.paused;
    }
    
    // =========================================
    // VoiceForge Background Tracks (Persistent)
    // =========================================
    
    // =========================================
    // Volume & Mute Controls
    // =========================================
    
    setBGMVolume(volume) {
        const settings = this.getSettings();
        settings.bgm_volume = volume;
        this.bgmElement.volume = sliderPercentToGain(volume);
        saveSettingsDebounced();
    }
    
    setBGMMuted(muted) {
        const settings = this.getSettings();
        settings.bgm_muted = muted;
        this.bgmElement.muted = muted;
        saveSettingsDebounced();
    }
    
    setBGMLocked(locked) {
        const settings = this.getSettings();
        settings.bgm_locked = locked;
        this.bgmElement.loop = locked;
        saveSettingsDebounced();
    }
    
    setAmbientVolume(volume) {
        const settings = this.getSettings();
        settings.ambient_volume = volume;
        this.ambientElement.volume = sliderPercentToGain(volume);
        saveSettingsDebounced();
    }
    
    setAmbientMuted(muted) {
        const settings = this.getSettings();
        settings.ambient_muted = muted;
        this.ambientElement.muted = muted;
        saveSettingsDebounced();
    }
    
    setVoiceForgeBgVolume(volume) {
        const settings = this.getSettings();
        settings.voiceforge_bg_volume = volume;
        this.voiceforgeBgElement.volume = volume * 0.01;
        saveSettingsDebounced();
    }

    setVoiceForgeBgPersist(persist) {
        const settings = this.getSettings();
        settings.voiceforge_bg_persist = persist !== false;
        saveSettingsDebounced();
    }
    
    setEnabled(enabled) {
        const settings = this.getSettings();
        settings.audio_enabled = enabled;
        
        if (enabled) {
            if (this.bgmElement.src) this.bgmElement.play().catch(() => {});
            if (this.ambientElement.src) this.ambientElement.play().catch(() => {});
        } else {
            this.bgmElement.pause();
            this.ambientElement.pause();
            this.voiceforgeBgElement.pause();
        }
        
        saveSettingsDebounced();
    }
    
    /**
     * Refresh all audio assets
     */
    async refreshAssets() {
        console.debug(DEBUG_PREFIX, 'Refreshing audio assets');
        this.currentChatId = null;
        this.defaultBGMs = null;
        this.ambients = null;
        this.characterMusics = {};
        this.currentCharacterBGM = null;
        this.currentExpressionBGM = null;
        this.currentBackground = null;
    }
    
    /**
     * Get BGM options for UI select
     */
    getBGMOptions() {
        const options = [];
        
        // Add default BGMs
        for (const file of (this.defaultBGMs || [])) {
            options.push({
                label: 'asset: ' + file.replace(/^.*[\\/]/, '').replace(/\.[^/.]+$/, ''),
                value: file,
            });
        }
        
        // Add character BGMs
        for (const char in this.characterMusics) {
            for (const exp in this.characterMusics[char]) {
                for (const file of this.characterMusics[char][exp]) {
                    options.push({
                        label: `${char}: ${file.replace(/^.*[\\/]/, '').replace(/\.[^/.]+$/, '')}`,
                        value: file,
                    });
                }
            }
        }
        
        return options;
    }
    
    /**
     * Get ambient options for UI select
     */
    getAmbientOptions() {
        return (this.ambients || []).map(file => ({
            label: 'asset: ' + file.replace(/^.*[\\/]/, '').replace(/\.[^/.]+$/, ''),
            value: file,
        }));
    }
}

// Singleton instance
let audioManager = null;

/**
 * Get audio manager instance
 */
function getAudioManager() {
    if (!audioManager) {
        audioManager = new AudioManager();
    }
    return audioManager;
}

/**
 * Get audio settings (shortcut)
 */
function getAudioSettings() {
    return getAudioManager().getSettings();
}

/**
 * Initialize audio module
 */
async function initAudioModule() {
    const manager = getAudioManager();
    await manager.init();
    
    // Register slash commands
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'music',
        aliases: ['bgm'],
        helpString: 'Set background music file.',
        callback: async (_, file) => {
            if (!file) return '';
            
            const options = manager.getBGMOptions();
            const fuse = new SillyTavern.libs.Fuse(options.map(o => o.value));
            const results = fuse.search(file.trim().toLowerCase());
            const match = results[0]?.item;
            
            if (match) {
                manager.getSettings().bgm_selected = match;
                await manager.updateBGM(true);
            }
            
            return '';
        },
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'file path',
                isRequired: true,
                acceptsMultiple: false,
                enumProvider: () => getAudioManager().getBGMOptions().map(
                    o => new SlashCommandEnumValue(o.value, null, enumTypes.enum, enumIcons.file)
                ),
            }),
        ],
    }));
    
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'ambient',
        helpString: 'Set ambient audio file.',
        callback: async (_, file) => {
            if (!file) return '';
            
            const options = manager.getAmbientOptions();
            const fuse = new SillyTavern.libs.Fuse(options.map(o => o.value));
            const results = fuse.search(file.trim().toLowerCase());
            const match = results[0]?.item;
            
            if (match) {
                manager.getSettings().ambient_selected = match;
                await manager.updateAmbient(true);
            }
            
            return '';
        },
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'file path',
                isRequired: true,
                acceptsMultiple: false,
                enumProvider: () => getAudioManager().getAmbientOptions().map(
                    o => new SlashCommandEnumValue(o.value, null, enumTypes.enum, enumIcons.file)
                ),
            }),
        ],
    }));
    
    // Command to stop all TTS background audio
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'stopbg',
        aliases: ['killbg', 'stopbackground'],
        helpString: 'Force stop all TTS background audio.',
        callback: async () => {
            await manager.stopVoiceForgeBackground(0.5, true);
            toastr.info('Background audio stopped', 'VoiceForge');
            return '';
        },
    }));
    
    // Start periodic updates
    setInterval(() => manager.update(), UPDATE_INTERVAL);
    
    // Load assets immediately (don't wait for first interval)
    console.debug(DEBUG_PREFIX, 'Loading assets immediately...');
    await manager.update();
    
    // Emit event to notify that assets are ready for UI population
    document.dispatchEvent(new CustomEvent('voiceforge-assets-ready'));
    
    return manager;
}


// Export singleton getter
export { getAudioManager };

