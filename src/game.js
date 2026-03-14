/**
 * game.js
 * Main game world — state management, update loop, entity spawning.
 *
 * Battle Trinity edition: 3-team time-limited jewel-control action game
 * with capturable TriLock bases, value-tiered jewels, job system and hate control.
 */

import { Base, Player, MemoryCrystal, Particle, RainDrop, Projectile, FACTIONS, JOBS,
         PLAYER_RADIUS, CRYSTAL_RADIUS, BASE_RADIUS, JEWEL_TIERS, ABILITY_RANGE,
         CAPTURE_RANGE, MAX_CARRY } from './entities.js';
import { Renderer } from './renderer.js';
import { HUD } from './hud.js';
import { AudioEngine } from './audio.js';
import { ReplayManager } from './replay.js';

const RAIN_COUNT      = 220;
const CRYSTAL_COUNT   = 12;
const TRILOCK_COUNT   = 5;             // neutral capturable bases
const DATA_STREAM_COUNT = 30;
const AI_ABILITY_CHANCE = 0.008;       // per-agent per-frame probability (~once every 12 s)
const PROJECTILE_HIT_TOLERANCE = 4;    // extra px added to collision radii
const KILL_SCORE = 5;
const ASSIST_SCORE = 2;
const ASSIST_WINDOW = 5;
const MATCH_DURATION = 300;            // 5-minute match (seconds)
const QUICK_MODE_SCALE = 0.6;
const BONUS_LEGENDARY_CHANCE = 0.3;    // probability of legendary (vs rare) for bonus spawns
const AURA_EMISSION_INTERVAL = 0.14;
const REPLAY_DEFAULT_ZOOM = 1.2;
const REPLAY_MIN_ZOOM = 1;
const REPLAY_MAX_ZOOM = 2.5;
const REPLAY_ZOOM_RATE = 1.2;
const REPLAY_PAN_SPEED = 320;
const REPLAY_TRAIL_HISTORY_LENGTH = 8;

const CAMERA_ZOOM_THRESHOLD = 1.001;
const SPRINT_ACTIVATION_SPEED_RATIO = 0.55;
const MAX_JEWEL_INSET_RATIO = 0.28;
const BASE_ALERT_RANGE = BASE_RADIUS + 84;
const BASE_ALERT_COOLDOWN = 5;
const DEATH_MARKER_DURATION = 5;
const PIN_DURATION = 10;
const NEXUS_GUARDIAN_INITIAL_SPAWN = 120;
const NEXUS_GUARDIAN_RESPAWN_TIME = 240;
const NEXUS_GUARDIAN_BASE_HEALTH = 2400;
const NEXUS_GUARDIAN_HEALTH_SCALE = 1.5;
const NEXUS_GUARDIAN_RADIUS = 70;
const NEXUS_GUARDIAN_ARENA_RADIUS = 120;
const NEXUS_GUARDIAN_ATTACK_INTERVAL = 4.2;
const NEXUS_GUARDIAN_AOE_RADIUS = 150;
const NEXUS_GUARDIAN_AOE_DAMAGE = 26;
const NEXUS_GUARDIAN_TARGET_DAMAGE = 42;
const NEXUS_GUARDIAN_DPS_PER_PLAYER = 22;
const NEXUS_GUARDIAN_REQUIRED_ATTACKERS = 2;
const GUARDIAN_BLESSING_DURATION = 60;
const GUARDIAN_BLESSING = {
  speedMult: 1.15,
  crystalPickupRangeMult: 1.5,
  respawnTimeMult: 0.5,
};

const PIN_TYPES = {
  gather:  { label: '集合', emoji: '📍', radius: 130 },
  danger:  { label: '危険', emoji: '⚠️', radius: 165 },
  crystal: { label: 'クリスタル', emoji: '💎', radius: 140 },
};

const MODE_RULES = {
  standard: {
    playersPerFaction: 5,
    matchDuration: MATCH_DURATION,
    winScore: 150,
    trilockCount: TRILOCK_COUNT,
    baseMarginRatio: 0.32,
    trilockRingRatio: 0.18,
    spawnOrbit: 40,
    spawnOrbitVariance: 20,
    crystalCountMult: 1,
    bonusJewelInterval: 20,
    crystalRainInterval: 1.5,
    featureTriggerScale: 1,
    guardianInitialSpawn: NEXUS_GUARDIAN_INITIAL_SPAWN,
    guardianRespawnTime: NEXUS_GUARDIAN_RESPAWN_TIME,
    normalInset: 60,
    rareSpreadRatio: 0.25,
    legendarySpreadRatio: 0.15,
    jobAssignment: ['warrior', 'mage', 'healer', 'scout', 'warrior'],
  },
  quick: {
    playersPerFaction: 2,
    matchDuration: 180,
    winScore: 80,
    trilockCount: 3,
    baseMarginRatio: 0.22,
    trilockRingRatio: 0.11,
    spawnOrbit: 28,
    spawnOrbitVariance: 12,
    crystalCountMult: QUICK_MODE_SCALE,
    bonusJewelInterval: 20 / QUICK_MODE_SCALE,
    crystalRainInterval: 1.5 / QUICK_MODE_SCALE,
    featureTriggerScale: 80 / 150,
    guardianInitialSpawn: NEXUS_GUARDIAN_INITIAL_SPAWN * QUICK_MODE_SCALE,
    guardianRespawnTime: NEXUS_GUARDIAN_RESPAWN_TIME * QUICK_MODE_SCALE,
    normalInset: 110,
    rareSpreadRatio: 0.18,
    legendarySpreadRatio: 0.10,
    jobAssignment: ['warrior', 'scout'],
  },
  tutorial: {
    playersPerFaction: 1,
    matchDuration: MATCH_DURATION,
    winScore: 0,
    trilockCount: 1,
    baseMarginRatio: 0.24,
    trilockRingRatio: 0.12,
    spawnOrbit: 0,
    spawnOrbitVariance: 0,
    crystalCountMult: 0.25,
    bonusJewelInterval: Number.POSITIVE_INFINITY,
    crystalRainInterval: 1.5,
    featureTriggerScale: 1,
    guardianInitialSpawn: Number.POSITIVE_INFINITY,
    guardianRespawnTime: Number.POSITIVE_INFINITY,
    normalInset: 120,
    rareSpreadRatio: 0.16,
    legendarySpreadRatio: 0.10,
    jobAssignment: ['warrior'],
  },
  practice: {
    playersPerFaction: 1,
    matchDuration: MATCH_DURATION,
    winScore: 0,
    trilockCount: 1,
    baseMarginRatio: 0.24,
    trilockRingRatio: 0.12,
    spawnOrbit: 0,
    spawnOrbitVariance: 0,
    crystalCountMult: 0.4,
    bonusJewelInterval: Number.POSITIVE_INFINITY,
    crystalRainInterval: 1.5,
    featureTriggerScale: 1,
    guardianInitialSpawn: Number.POSITIVE_INFINITY,
    guardianRespawnTime: Number.POSITIVE_INFINITY,
    normalInset: 120,
    rareSpreadRatio: 0.16,
    legendarySpreadRatio: 0.10,
    jobAssignment: ['warrior'],
  },
};

function getModeRules(mode = 'standard') {
  return MODE_RULES[mode] ?? MODE_RULES.standard;
}

const SANDBOX_JOB_ORDER = ['warrior', 'mage', 'healer', 'scout'];
const JOB_SWITCH_SHORTCUTS = {
  Digit1: 'warrior',
  Digit2: 'mage',
  Digit3: 'healer',
  Digit4: 'scout',
};
const TUTORIAL_STEPS = [
  {
    id: 'movement',
    title: 'STEP 1 · MOVEMENT / CAMERA',
    body: 'Move with WASD or Arrow keys, then press V to enter spectator mode, C to cycle the camera, and V again to return to your agent.',
    highlightIds: ['status-left', 'spectator-panel'],
  },
  {
    id: 'crystal',
    title: 'STEP 2 · CRYSTAL DELIVERY',
    body: 'Pick up the highlighted crystal and carry it back into your home base to score. Deliveries are the fastest way to build momentum.',
    highlightIds: ['crystal-counter', 'status-left'],
  },
  {
    id: 'capture',
    title: 'STEP 3 · BASE CAPTURE',
    body: 'Stand inside the neutral TriLock until the capture ring completes. Captured bases become extra delivery points for your faction.',
    highlightIds: ['score-panel'],
  },
  {
    id: 'jobs',
    title: 'STEP 4 · JOB ABILITIES',
    body: 'Swap between all four jobs with the training buttons or 1-4, then press Space once with each job to feel the difference in range and role.',
    highlightIds: ['status-right'],
    showJobSwitcher: true,
  },
  {
    id: 'alliance',
    title: 'STEP 5 · TEMPORARY ALLIANCE',
    body: 'When one faction runs away with the score, the other two temporarily ally. Watch the banner, then press Tab to lock onto the priority target.',
    highlightIds: ['alliance-indicator', 'score-panel'],
  },
  {
    id: 'chaos',
    title: 'STEP 6 · CHAOS EVENT RESPONSE',
    body: 'Chaos Events disrupt every match. Move outside the EMP Storm ring before the timer expires to finish the tutorial.',
    highlightIds: ['chaos-event-banner'],
  },
];

function createFeatureContracts(modeRules) {
  return FEATURE_CONTRACTS.map(contract => ({
    ...contract,
    triggerScore: Math.max(20, Math.round(contract.triggerScore * modeRules.featureTriggerScale)),
  }));
}

// ── Alliance system ──────────────────────────────────────────────────────────
const ALLIANCE_FORM_THRESHOLD    = 20; // score gap to trigger temporary alliance
const ALLIANCE_DISSOLVE_THRESHOLD = 10; // score gap to dissolve alliance (hysteresis)

// ── Chaos Events ─────────────────────────────────────────────────────────────
const CHAOS_EVENT_INTERVAL = 30;       // seconds between events
const CHAOS_EVENT_INITIAL_DELAY = 15;  // first event after 15 s

const CHAOS_EVENTS = [
  {
    type: 'emp_storm',
    name: 'EMP STORM',
    duration: 8,
    description: 'Energy regen disabled in the EMP zone!',
    color: '#ffcc00',
    emoji: '⚡',
  },
  {
    type: 'crystal_rain',
    name: 'CRYSTAL RAIN',
    duration: 15,
    description: 'Bonus crystals raining down!',
    color: '#a0d4ff',
    emoji: '💎',
    spawnInterval: 1.5,            // spawn a bonus crystal every 1.5 s
  },
  {
    type: 'nexus_overload',
    name: 'NEXUS OVERLOAD',
    duration: 8,
    description: 'All base shields down — rush the enemy!',
    color: '#ff66ff',
    emoji: '💥',
  },
  {
    type: 'data_storm',
    name: 'DATA STORM',
    duration: 30,
    description: 'Minimap jammed. Cooldowns x1.5. One base pays x3.',
    color: '#7df2ff',
    emoji: '📡',
  },
];

const CHAOS_ZONE_MARGIN = 80;      // px inset from canvas edge for EMP zone placement

// Feature contract chain — each contract triggers when the actor reaches the score threshold.
// On completion the actor receives a bonus and their agents receive a timed buff.
const FEATURE_CONTRACTS = [
  {
    actor: 'blue',
    triggerScore: 100,
    action: 'Activate Overclock Uplink',
    bonusScore: 15,
    visualDuration: 6,
    buff: { speedMult: 1.5, regenMult: 2.0 },
  },
  {
    actor: 'green',
    triggerScore: 120,
    action: 'Deploy Firewall',
    bonusScore: 15,
    visualDuration: 6,
    buff: { healPerSec: 8 },
  },
  {
    actor: 'red',
    triggerScore: 150,
    action: 'Core Meltdown',
    bonusScore: 15,
    visualDuration: 6,
    buff: { damageMult: 2.0 },
  },
];

// ── AI difficulty parameters ───────────────────────────────────────────────
const AI_DIFFICULTY = {
  easy:   { speedMult: 0.70, aggroMult: 0.60, abilityMult: 0.40 },
  normal: { speedMult: 1.00, aggroMult: 1.00, abilityMult: 1.00 },
  hard:   { speedMult: 1.20, aggroMult: 1.30, abilityMult: 1.60 },
  expert: { speedMult: 1.40, aggroMult: 1.60, abilityMult: 2.20 },
};

// ── Starting crystal counts ────────────────────────────────────────────────
const STARTING_CRYSTALS = { low: 6, normal: 12, high: 20 };

export class Game {
  constructor(canvas, options = {}) {
    this.canvas   = canvas;
    this.renderer = new Renderer(canvas);
    this.hud      = new HUD();
    this.audio    = new AudioEngine();
    this.replay   = new ReplayManager(this);
    this.running  = false;
    this._lastTs  = 0;
    this._lastDt  = 0;
    this.playerFaction = options.playerFaction ?? 'blue';

    const gameMode = MODE_RULES[options.gameMode] ? options.gameMode : 'standard';
    this.modeRules = getModeRules(gameMode);

    // ── Lobby config (all settings from the pre-match lobby) ───────────────
    this.config = {
      matchDuration:      options.matchDuration      ?? this.modeRules.matchDuration,
      winScore:           options.winScore           ?? this.modeRules.winScore,
      chaosEnabled:       options.chaosEnabled       ?? true,
      chaosInterval:      options.chaosInterval      ?? CHAOS_EVENT_INTERVAL,
      gameMode,
      startingCrystals:   options.startingCrystals   ?? 'normal',
      aiDifficulty: {
        blue:  options.aiDifficulty?.blue  ?? 'normal',
        green: options.aiDifficulty?.green ?? 'normal',
        red:   options.aiDifficulty?.red   ?? 'normal',
      },
    };
    this.damageNumbers = [];
    this.trainingMessage = '';
    this.tutorial = null;
    this.practiceState = null;
    this._tutorialPendingAdvance = false;
    this._tutorialMetrics = {
      movementDistance: 0,
      spectatorUsed: false,
      cameraCycleUsed: false,
      targetUsed: false,
      usedJobs: {},
      deliveryDone: false,
    };

    this.width  = 0;
    this.height = 0;

    // World state
    this.bases       = {};   // home bases { blue, green, red }
    this.trilocks    = [];   // neutral capturable TriLock bases
    this.players     = [];
    this.crystals    = [];
    this.sparks      = [];
    this.dataStreams  = [];
    this.rain        = [];
    this.scores      = { blue: 0, green: 0, red: 0 };
    this.stats       = {
      blue: { kills: 0, deaths: 0, assists: 0, crystals: 0 },
      green: { kills: 0, deaths: 0, assists: 0, crystals: 0 },
      red: { kills: 0, deaths: 0, assists: 0, crystals: 0 },
    };
    this.events      = [];
    this.projectiles = [];
    this.damageLedger = new Map();
    this.matchEnded = false;
    this.winnerFaction = null;
    this.victoryTimer = 0;
    this.elapsed = 0;
    this.matchTimer = this.config.matchDuration;   // countdown (seconds)
    // Feature contract chain — current contract is featureContracts[featureIndex]
    this.featureContracts = createFeatureContracts(this.modeRules).map(c => ({
      ...c,
      completed: false,
      visualTimer: 0,
    }));
    this.featureIndex = 0;

    // Active faction buffs: { blue: { speedMult, regenMult, … , timer }, … }
    this.factionBuffs = {};
    this.guardianBlessings = {};
    this.localPlayer = null;
    this.spectatorMode = false;
    this.spectatorCameraMode = 'overhead';
    this.spectatorTarget = null;
    this.spectatorCamera = { x: 0, y: 0, zoom: 1 };
    this.input = {
      up: false,
      down: false,
      left: false,
      right: false,
      ability: false,
      target: false,
      drop: false,
      rally: false,
      zoomIn: false,
      zoomOut: false,
    };
    this._abilityLatch = false;
    this._targetLatch = false;
    this._dropLatch = false;
    this._rallyLatch = false;
    this.focusedEnemy = null;
    this.rallySignal = null;
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.minimapPins = [];
    this.recentDeaths = [];
    this.baseAttackAlerts = {
      blue: { active: false, cooldown: 0 },
      green: { active: false, cooldown: 0 },
      red: { active: false, cooldown: 0 },
    };
    this.settings = {
      gameSpeed: 1,
      effectQuality: 'high',
      hudVisible: true,
      crtEnabled: true,
      panelOpen: false,
    };
    this._bindInput();
    this._initSettingsPanel();
    this._applySettings();

    // ── Alliance (temporary 2-vs-1 pact) ─────────────────────────────────
    // When active: { members: [faction, faction], target: faction }
    this.alliance = null;

    // ── Chaos Events ───────────────────────────────────────────────────────
    this.chaosEvent = null;          // active event object or null
    this.chaosEventTimer = CHAOS_EVENT_INITIAL_DELAY;  // countdown to next event
    this._crystalRainAccum = 0;      // accumulator for crystal rain spawns
    this.highValueBase = null;
    this.nexusGuardian = null;

    // ── Jewel respawn timer ─────────────────────────────────────────────────
    this._jewelRespawnAccum = 0;
    this._configureModeState();
  }

  _isTutorialMode() {
    return this.config.gameMode === 'tutorial';
  }

  _isPracticeMode() {
    return this.config.gameMode === 'practice';
  }

  _isSandboxMode() {
    return this._isTutorialMode() || this._isPracticeMode();
  }

  _configureModeState() {
    this.matchTimer = this._isSandboxMode() ? Number.POSITIVE_INFINITY : this.config.matchDuration;
    this.trainingMessage = this._isPracticeMode()
      ? 'PRACTICE SANDBOX — Switch jobs with 1-4 and test abilities on the dummy agents.'
      : '';
    this.practiceState = this._isPracticeMode() ? { lastSwitchedJob: null } : null;
    this._tutorialMetrics = {
      movementDistance: 0,
      spectatorUsed: false,
      cameraCycleUsed: false,
      targetUsed: false,
      usedJobs: {},
      deliveryDone: false,
    };
    if (this._isTutorialMode()) {
      this.tutorial = {
        stepIndex: 0,
        complete: false,
        transitioned: false,
      };
    } else {
      this.tutorial = null;
    }
  }

  // ── Feature contract accessor (used by HUD and renderer) ─────────────────
  get nextFeature() {
    return this.featureContracts[this.featureIndex] ?? null;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  start(chosenFaction = 'blue') {
    this.chosenFaction = chosenFaction;
    this._resize();
    window.addEventListener('resize', () => this._resize());
    this._spawn();
    this.replay.beginRecording();
    this.running = true;
    requestAnimationFrame(ts => this._loop(ts));
  }

  _resize() {
    this.width  = window.innerWidth;
    this.height = window.innerHeight;
    this.renderer.resize(this.width, this.height);
    if (!this.camera.x && !this.camera.y) this.resetReplayCamera();

    // Reposition bases on resize
    if (Object.keys(this.bases).length > 0) {
      this._positionBases();
      if (this.trilocks.length > 0) this._positionTriLocks();
      this._positionNexusGuardian();
    }
    this._updateSpectatorState(0);
  }

  // ── Spawn ─────────────────────────────────────────────────────────────────

  _spawn() {
    const W = this.width, H = this.height;

    // ── Home bases (triangle layout, un-capturable) ─────────────────────
    this._positionBases();

    // ── TriLock neutral bases ───────────────────────────────────────────
    this._spawnTriLocks();
    this._resetNexusGuardian();

    // ── Players (playersPerFaction per faction) ───────────────────────────
    const playersPerFaction = this.modeRules.playersPerFaction;
    for (const faction of ['blue', 'green', 'red']) {
      const base = this.bases[faction];
      const diff = AI_DIFFICULTY[this.config.aiDifficulty[faction]] ?? AI_DIFFICULTY.normal;
      for (let i = 0; i < playersPerFaction; i++) {
        const angle = (i / playersPerFaction) * Math.PI * 2;
        const r     = this.modeRules.spawnOrbit + Math.random() * this.modeRules.spawnOrbitVariance;
        const p = new Player(
          faction, i,
          base.x + Math.cos(angle) * r,
          base.y + Math.sin(angle) * r,
          { jobAssignment: this.modeRules.jobAssignment },
        );
        // Apply AI difficulty scaling only to non-player-controlled agents.
        // The human player is the first member (i === 0) of their chosen faction.
        const isHumanPlayer = faction === this.playerFaction && i === 0;
        if (!isHumanPlayer) {
          p.speed                = Math.round(p.speed * diff.speedMult);
          p.aggro                = Math.min(1, p.aggro * diff.aggroMult);
          p.abilityDifficultyMult = diff.abilityMult;  // per-frame ability chance scalar
        }
        if (this._isSandboxMode() && !isHumanPlayer) {
          p.aiDisabled = true;
          p.isDummy = true;
          p.abilityDifficultyMult = 0;
        }
        // Stagger cooldowns
        p.cooldown = Math.random() * p.abilityMax;
        this.players.push(p);
      }
    }
    this.localPlayer = this.players.find(p => p.faction === this.playerFaction)
      ?? this.players.find(p => p.faction === 'blue')
      ?? null;
    if (this.localPlayer) this.localPlayer.isPlayerControlled = true;
    this.spectatorTarget = this.localPlayer ?? this.players[0] ?? null;
    this._focusSpectatorCamera(this.width / 2, this.height / 2, 1);

    // ── Jewels (value-tiered, centre-weighted) ─────────────────────────
    this._spawnInitialJewels();

    // ── Rain ──────────────────────────────────────────────────────────────
    for (let i = 0; i < RAIN_COUNT; i++) {
      const d   = new RainDrop(W, H);
      d.y = Math.random() * H; // pre-scatter
      this.rain.push(d);
    }

    // ── Data stream particles ─────────────────────────────────────────────
    this._initDataStreams();
    this.resetReplayCamera();
    if (this._isSandboxMode()) this._setupSandboxMode();
  }

  _bindInput() {
    const setKey = (code, down) => {
      if (code === 'KeyW' || code === 'ArrowUp') this.input.up = down;
      if (code === 'KeyS' || code === 'ArrowDown') this.input.down = down;
      if (code === 'KeyA' || code === 'ArrowLeft') this.input.left = down;
      if (code === 'KeyD' || code === 'ArrowRight') this.input.right = down;
      if (code === 'Space') this.input.ability = down;
      if (code === 'Tab') this.input.target = down;
      if (code === 'KeyE') this.input.drop = down;
      if (code === 'KeyQ') this.input.rally = down;
      if (code === 'Equal' || code === 'NumpadAdd') this.input.zoomIn = down;
      if (code === 'Minus' || code === 'NumpadSubtract') this.input.zoomOut = down;
      return (
        code === 'KeyW' || code === 'ArrowUp' ||
        code === 'KeyS' || code === 'ArrowDown' ||
        code === 'KeyA' || code === 'ArrowLeft' ||
        code === 'KeyD' || code === 'ArrowRight' ||
        code === 'Space' || code === 'Tab' ||
        code === 'KeyE' || code === 'KeyQ' ||
        code === 'Equal' || code === 'NumpadAdd' ||
        code === 'Minus' || code === 'NumpadSubtract'
      );
    };
    window.addEventListener('keydown', e => {
      if (e.code === 'Escape' && !e.repeat) {
        e.preventDefault();
        this._toggleSettingsPanel();
        return;
      }
      if (this._isSettingsEventTarget(e.target)) return;

      let handled = setKey(e.code, true);
      if (!e.repeat && JOB_SWITCH_SHORTCUTS[e.code] && this._isSandboxMode()) {
        this.switchLocalJob(JOB_SWITCH_SHORTCUTS[e.code]);
        handled = true;
      }
      if (!e.repeat) {
        if (e.code === 'KeyV') {
          if (this._isTutorialMode()) this._tutorialMetrics.spectatorUsed = true;
          this._toggleSpectatorMode();
          handled = true;
        } else if (e.code === 'KeyC') {
          if (this._isTutorialMode()) this._tutorialMetrics.cameraCycleUsed = true;
          this._cycleSpectatorCameraMode();
          handled = true;
        } else if (e.code === 'BracketLeft') {
          this._cycleSpectatorTarget(-1);
          handled = true;
        } else if (e.code === 'BracketRight') {
          this._cycleSpectatorTarget(1);
          handled = true;
        }
      }
      if (handled) e.preventDefault();
    });
    window.addEventListener('keyup', e => {
      if (e.code === 'Escape' || this._isSettingsEventTarget(e.target)) return;
      if (setKey(e.code, false)) e.preventDefault();
    });
    this.canvas.addEventListener('click', e => this._handleCanvasClick(e));
  }

  _isSettingsEventTarget(target) {
    return !!(this._settingsPanel && target instanceof Element && this._settingsPanel.contains(target));
  }

  _initSettingsPanel() {
    const panel = document.getElementById('settings-panel');
    if (!panel) return;

    const speed = document.getElementById('setting-game-speed');
    const quality = document.getElementById('setting-effect-quality');
    const hudToggle = document.getElementById('setting-hud-visible');
    const crtToggle = document.getElementById('setting-crt-enabled');

    this._settingsPanel = panel;
    this._settingsControls = { speed, quality, hudToggle, crtToggle };

    if (speed) {
      speed.value = String(this.settings.gameSpeed);
      speed.addEventListener('change', () => {
        this.settings.gameSpeed = Number(speed.value) || 1;
      });
    }

    if (quality) {
      quality.value = this.settings.effectQuality;
      quality.addEventListener('change', () => {
        this.settings.effectQuality = quality.value === 'low' ? 'low' : 'high';
      });
    }

    if (hudToggle) {
      hudToggle.checked = this.settings.hudVisible;
      hudToggle.addEventListener('change', () => {
        this.settings.hudVisible = hudToggle.checked;
        this._applySettings();
      });
    }

    if (crtToggle) {
      crtToggle.checked = this.settings.crtEnabled;
      crtToggle.addEventListener('change', () => {
        this.settings.crtEnabled = crtToggle.checked;
        this._applySettings();
      });
    }
  }

  _toggleSettingsPanel() {
    this.settings.panelOpen = !this.settings.panelOpen;
    this._resetInput();
    this._applySettings();
    if (this.settings.panelOpen) {
      this._settingsControls?.speed?.focus();
    }
  }

  _resetInput() {
    this.input.up = false;
    this.input.down = false;
    this.input.left = false;
    this.input.right = false;
    this.input.ability = false;
    this._abilityLatch = false;
  }

  _applySettings() {
    document.body.classList.toggle('hud-hidden', !this.settings.hudVisible);
    document.body.classList.toggle('crt-disabled', !this.settings.crtEnabled);
    if (this._settingsPanel) {
      this._settingsPanel.classList.toggle('is-open', this.settings.panelOpen);
      this._settingsPanel.setAttribute('aria-hidden', String(!this.settings.panelOpen));
    }
  }

  _handleCanvasClick(event) {
    const point = this.renderer.screenToMinimapWorld?.(event.clientX, event.clientY, this);
    if (!point) return;
    this._issueMinimapPin(point.x, point.y);
    event.preventDefault();
  }

  getRespawnPoint(player) {
    if (!this._isSandboxMode()) return null;
    const cx = this.width / 2;
    const cy = this.height / 2;
    if (player === this.localPlayer) return { x: cx, y: cy + 95 };
    const dummies = this.players.filter(candidate => candidate.isDummy);
    const index = Math.max(0, dummies.indexOf(player));
    const points = [
      { x: cx - 90, y: cy - 10 },
      { x: cx + 90, y: cy - 10 },
      { x: cx, y: cy - 120 },
    ];
    return points[index] ?? { x: cx + (index - 1) * 90, y: cy - 40 };
  }

  _setupSandboxMode() {
    this.featureContracts = [];
    this.featureIndex = 0;
    this.factionBuffs = {};
    this.guardianBlessings = {};
    this.focusedEnemy = null;
    this.rallySignal = null;
    this.minimapPins = [];
    this.events = [];
    this.projectiles = [];
    this.damageNumbers = [];
    for (const player of this.players) {
      player.energy = 100;
      player.cooldown = 0;
      player.cooldown2 = 0;
      player.ultCooldown = 0;
      player.carrying = [];
      player.alive = true;
      player.respawnTimer = 0;
      player.target = null;
      player.state = 'roam';
      player.health = player.baseMaxHealth;
      player.maxHealth = player.baseMaxHealth;
      player.trailPoints = [];
      const point = this.getRespawnPoint(player);
      if (point) {
        player.x = point.x;
        player.y = point.y;
      }
    }

    this.crystals = [];
    this.scores = { blue: 0, green: 0, red: 0 };
    this.stats = {
      blue: { kills: 0, deaths: 0, assists: 0, crystals: 0 },
      green: { kills: 0, deaths: 0, assists: 0, crystals: 0 },
      red: { kills: 0, deaths: 0, assists: 0, crystals: 0 },
    };
    this.alliance = null;
    this.chaosEvent = null;
    this.chaosEventTimer = Number.POSITIVE_INFINITY;
    this.nexusGuardian = {
      ...this.nexusGuardian,
      state: 'waiting',
      timer: Number.POSITIVE_INFINITY,
      health: 0,
      maxHealth: NEXUS_GUARDIAN_BASE_HEALTH,
    };

    if (this._isPracticeMode()) {
      const cx = this.width / 2;
      const cy = this.height / 2;
      const rareTier = JEWEL_TIERS.find(tier => tier.tier === 'rare') ?? JEWEL_TIERS[0];
      this.crystals.push(
        new MemoryCrystal(cx, cy + 40, JEWEL_TIERS[0]),
        new MemoryCrystal(cx - 120, cy + 65, JEWEL_TIERS[0]),
        new MemoryCrystal(cx + 120, cy + 65, rareTier),
      );
      if (this.trilocks[0]) {
        this.trilocks[0].faction = null;
        this.trilocks[0].captureFaction = null;
        this.trilocks[0].captureProgress = 0;
        this.trilocks[0].level = 0;
        this.trilocks[0].x = cx;
        this.trilocks[0].y = cy - 135;
      }
    }

    if (this._isTutorialMode()) this._prepareTutorialStep();
  }

  _currentTutorialStep() {
    return this.tutorial ? TUTORIAL_STEPS[this.tutorial.stepIndex] ?? null : null;
  }

  _prepareTutorialStep() {
    if (!this.tutorial || !this.localPlayer) return;
    const local = this.localPlayer;
    const cx = this.width / 2;
    const cy = this.height / 2;
    const step = this._currentTutorialStep();
    this._tutorialPendingAdvance = false;
    this._tutorialMetrics.deliveryDone = false;
    this._tutorialMetrics.targetUsed = false;
    this.focusedEnemy = null;
    this.rallySignal = null;
    this.spectatorMode = false;
    this.spectatorCameraMode = 'overhead';
    this.spectatorTarget = local;
    this.projectiles = [];
    this.damageNumbers = [];
    this.sparks = [];
    this.events = [];
    this.chaosEvent = null;
    this.alliance = null;
    for (const player of this.players) {
      player.energy = 100;
      player.cooldown = 0;
      player.cooldown2 = 0;
      player.ultCooldown = 0;
      player.carrying = [];
      player.health = player.baseMaxHealth;
      player.maxHealth = player.baseMaxHealth;
      player.alive = true;
      player.respawnTimer = 0;
      player.target = null;
      player.state = 'roam';
      player.trailPoints = [];
      const point = this.getRespawnPoint(player);
      if (point) {
        player.x = point.x;
        player.y = point.y;
      }
    }
    this.crystals = [];
    this.scores = { blue: 0, green: 0, red: 0 };
    for (const base of this.trilocks) {
      base.faction = null;
      base.captureFaction = null;
      base.captureProgress = 0;
      base.level = 0;
      base.crystalsStored = 0;
      base.x = cx;
      base.y = cy - 120;
    }
    if (!step) return;

    if (step.id === 'movement') {
      this._tutorialMetrics.movementDistance = 0;
      this._tutorialMetrics.spectatorUsed = false;
      this._tutorialMetrics.cameraCycleUsed = false;
      local.x = cx;
      local.y = cy + 120;
    } else if (step.id === 'crystal') {
      const home = this.bases[local.faction];
      local.x = home.x;
      local.y = Math.min(this.height - PLAYER_RADIUS - 18, home.y + 95);
      this.crystals.push(new MemoryCrystal(home.x, local.y - 48, JEWEL_TIERS[0]));
    } else if (step.id === 'capture') {
      local.x = cx;
      local.y = cy - 40;
    } else if (step.id === 'jobs') {
      this._tutorialMetrics.usedJobs = {};
      local.setJob('warrior', { refillEnergy: true, resetCooldowns: true, preserveHealthRatio: false });
      local.x = cx;
      local.y = cy + 90;
    } else if (step.id === 'alliance') {
      local.x = cx;
      local.y = cy + 90;
      this.scores = { blue: 65, green: 38, red: 20 };
      this._updateAlliance();
      this._tutorialMetrics.targetUsed = false;
    } else if (step.id === 'chaos') {
      local.x = cx;
      local.y = cy + 100;
      this.chaosEvent = {
        type: 'emp_storm',
        name: 'EMP STORM',
        duration: 12,
        description: 'Exit the EMP field to restore your systems.',
        color: '#ffcc00',
        emoji: '⚡',
        remaining: 12,
        x: cx,
        y: cy + 30,
        radius: 120,
      };
    }
  }

  _positionBases() {
    const W = this.width, H = this.height;
    const cx = W / 2, cy = H / 2;
    const margin = Math.min(W, H) * this.modeRules.baseMarginRatio;

    const positions = {
      blue:  { x: cx,                  y: cy - margin },                         // top centre
      green: { x: cx - margin * 0.88,  y: cy + margin * 0.58 },                  // bottom left
      red:   { x: cx + margin * 0.88,  y: cy + margin * 0.58 },                  // bottom right
    };

    for (const [faction, pos] of Object.entries(positions)) {
      if (this.bases[faction]) {
        this.bases[faction].x = pos.x;
        this.bases[faction].y = pos.y;
      } else {
        const base = new Base(faction, pos.x, pos.y, true);  // isHome = true
        this.bases[faction] = base;
      }
    }
  }

  /** Spawn neutral TriLock bases in a ring around the centre of the map. */
  _spawnTriLocks() {
    if (this.trilocks.length > 0) {
      // Reposition on resize
      this._positionTriLocks();
      return;
    }
    const W = this.width, H = this.height;
    const cx = W / 2, cy = H / 2;
    const ringR = Math.min(W, H) * this.modeRules.trilockRingRatio;
    for (let i = 0; i < this.modeRules.trilockCount; i++) {
      const angle = (i / this.modeRules.trilockCount) * Math.PI * 2 - Math.PI / 2;
      const tx = cx + Math.cos(angle) * ringR;
      const ty = cy + Math.sin(angle) * ringR;
      this.trilocks.push(new Base(null, tx, ty, false));
    }
  }

  _positionTriLocks() {
    const W = this.width, H = this.height;
    const cx = W / 2, cy = H / 2;
    const ringR = Math.min(W, H) * this.modeRules.trilockRingRatio;
    for (let i = 0; i < this.trilocks.length; i++) {
      const angle = (i / this.trilocks.length) * Math.PI * 2 - Math.PI / 2;
      this.trilocks[i].x = cx + Math.cos(angle) * ringR;
      this.trilocks[i].y = cy + Math.sin(angle) * ringR;
    }
  }

  _guardianSpawnPoint() {
    return { x: this.width / 2, y: this.height / 2 };
  }

  _resetNexusGuardian() {
    const { x, y } = this._guardianSpawnPoint();
    this.nexusGuardian = {
      x,
      y,
      radius: NEXUS_GUARDIAN_RADIUS,
      arenaRadius: NEXUS_GUARDIAN_ARENA_RADIUS,
      aoeRadius: NEXUS_GUARDIAN_AOE_RADIUS,
      state: 'pending',
      timer: this.modeRules.guardianInitialSpawn,
      health: 0,
      maxHealth: NEXUS_GUARDIAN_BASE_HEALTH,
      spawnCount: 0,
      attackTimer: NEXUS_GUARDIAN_ATTACK_INTERVAL,
      nextAttack: 'aoe',
      damageByFaction: { blue: 0, green: 0, red: 0 },
      lastDamager: null,
    };
  }

  _positionNexusGuardian() {
    if (!this.nexusGuardian) return;
    const { x, y } = this._guardianSpawnPoint();
    this.nexusGuardian.x = x;
    this.nexusGuardian.y = y;
  }

  /**
   * Spawn jewels with value tiers. Higher-value jewels spawn closer to the centre.
   * Uses the JEWEL_TIERS weight distribution and distance-from-centre bias.
   * Count is determined by the lobby startingCrystals config.
   */
  _spawnInitialJewels() {
    const W = this.width, H = this.height;
    const cx = W / 2, cy = H / 2;
    const count = this._getCrystalTarget();
    for (let i = 0; i < count; i++) {
      this.crystals.push(this._createJewel(cx, cy, W, H));
    }
  }

  _createJewel(cx, cy, W, H) {
    // Pick tier using weighted random
    const r = Math.random();
    let cumulative = 0;
    let tier = JEWEL_TIERS[0];
    for (const t of JEWEL_TIERS) {
      cumulative += t.weight;
      if (r <= cumulative) { tier = t; break; }
    }

    // Position: higher-tier jewels spawn closer to centre
    const inset = Math.min(this.modeRules.normalInset, Math.min(W, H) * MAX_JEWEL_INSET_RATIO);
    let x, y;
    if (tier.tier === 'legendary') {
      // Centre zone (inner 30%)
      const spread = Math.min(W, H) * this.modeRules.legendarySpreadRatio;
      x = cx + (Math.random() - 0.5) * spread * 2;
      y = cy + (Math.random() - 0.5) * spread * 2;
    } else if (tier.tier === 'rare') {
      // Mid zone (inner 50%)
      const spread = Math.min(W, H) * this.modeRules.rareSpreadRatio;
      x = cx + (Math.random() - 0.5) * spread * 2;
      y = cy + (Math.random() - 0.5) * spread * 2;
    } else {
      // Standard uses the full field; Quick Match stays in the central combat area.
      x = inset + Math.random() * (W - inset * 2);
      y = inset + Math.random() * (H - inset * 2);
    }
    x = Math.max(inset, Math.min(W - inset, x));
    y = Math.max(inset, Math.min(H - inset, y));
    return new MemoryCrystal(x, y, tier);
  }

  _getCrystalTarget() {
    const baseCount = STARTING_CRYSTALS[this.config.startingCrystals] ?? CRYSTAL_COUNT;
    return Math.max(3, Math.round(baseCount * this.modeRules.crystalCountMult));
  }

  _initDataStreams() {
    const bases = Object.values(this.bases);
    for (let i = 0; i < DATA_STREAM_COUNT; i++) {
      const fromBase = bases[Math.floor(Math.random() * bases.length)];
      const toBase   = bases[Math.floor(Math.random() * bases.length)];
      this.dataStreams.push({
        fromBase,
        toBase,
        t:     Math.random(),
        speed: 0.12 + Math.random() * 0.18,
        color: FACTIONS[fromBase.faction].color,
        x: fromBase.x,
        y: fromBase.y,
        alpha: 0.6 + Math.random() * 0.4,
      });
    }
  }

  // ── Main loop ─────────────────────────────────────────────────────────────

  _loop(ts) {
    if (!this.running) return;
    const dt = Math.min((ts - this._lastTs) / 1000, 0.05) * this.settings.gameSpeed;
    this._lastTs = ts;
    this._lastDt = dt;

    this._update(dt);
    this.renderer.render(this, dt);
    this.hud.update(this);

    requestAnimationFrame(t => this._loop(t));
  }

  // ── Update ────────────────────────────────────────────────────────────────

  _update(dt) {
    if (this.replay.isActive) {
      this._updateReplayCamera(dt);
      this.replay.update(dt);
      return;
    }
    if (this.matchEnded) {
      this.victoryTimer -= dt;
      if (!this.replay.hasReplay && this.victoryTimer <= 0) this._restart();
      return;
    }
    this.elapsed += dt;
    if (Number.isFinite(this.matchTimer)) this.matchTimer -= dt;

    // Home bases
    for (const base of Object.values(this.bases)) base.update(dt);

    // TriLock capture logic
    this._updateTriLocks(dt);
    if (!this._isSandboxMode()) this._updateNexusGuardian(dt);

    // Alliance evaluation (before AI so targeting reflects current pact)
    this._updateAlliance();
    this._updateCommandState(dt);
    this._updateMinimapAlerts(dt);

    // Players
    for (const player of this.players) {
      if (player.isPlayerControlled && !this.spectatorMode) this._updateLocalPlayer(player, dt);
      else player.update(dt, this);
      this._updatePassiveEffects(player, dt);
      // Energy regeneration (buffed by faction overclock, blocked by EMP Storm)
      if (player.alive && player.energy < 100) {
        let regenBlocked = false;
        if (this.chaosEvent?.type === 'emp_storm') {
          const ce = this.chaosEvent;
          const dx = player.x - ce.x;
          const dy = player.y - ce.y;
          if (Math.sqrt(dx * dx + dy * dy) < ce.radius) {
            regenBlocked = true;
          }
        }
        if (!regenBlocked) {
          const regenMult = this.factionBuffs[player.faction]?.regenMult ?? 1;
          player.energy = Math.min(100, player.energy + 8 * regenMult * dt);
        }
      }
      if (player.alive && player.passiveState?.bioRegenActive) {
        const regenPerSec = player.maxHealth * (player.passive.regenPctPerSec ?? 0);
        player.health = Math.min(player.maxHealth, player.health + regenPerSec * dt);
      }
      // Faction heal-over-time buff (Deploy Firewall)
      const healBuff = this.factionBuffs[player.faction]?.healPerSec;
      if (player.alive && healBuff) {
        player.health = Math.min(player.maxHealth, player.health + healBuff * dt);
      }

      const buff = this.factionBuffs[player.faction];
      const guardianBlessing = this.guardianBlessings[player.faction];
      const passiveAura = player.passiveState?.deliveryBonusActive ||
        player.passiveState?.bioRegenActive ||
        player.passiveState?.nearbyAllyBonus ||
        player.passiveState?.overclockStacks > 0 ||
        player.passiveState?.sprintActive;
      if (player.alive && (buff || guardianBlessing || passiveAura)) {
        player.auraTimer -= dt;
        if (player.auraTimer <= 0) {
          this.sparks.push(...Particle.aura(player.x, player.y, FACTIONS[player.faction].color, 2));
          player.auraTimer = AURA_EMISSION_INTERVAL;
        }
      }
    }

    // Ability firing (AI triggers periodically)
    for (const player of this.players) {
      if (player.isPlayerControlled && !this.spectatorMode) {
        if (this.input.ability && !this._abilityLatch) {
          this._abilityLatch = true;
          const proj = player.tryAbility(this);
          if (proj) {
            if (this._isTutorialMode()) this._tutorialMetrics.usedJobs[player.job] = true;
            this.projectiles.push(proj);
            this.audio.playAbility(player.faction, player.job);
            this.events.push({
              text: `${player.faction.toUpperCase()} fired ${player.abilityName.toUpperCase()}`,
              faction: player.faction,
              ttl: 2,
            });
          }
        } else if (!this.input.ability) {
          this._abilityLatch = false;
        }
        continue;
      }
      if (player.alive && Math.random() < AI_ABILITY_CHANCE * (player.abilityDifficultyMult ?? 1)) {
        const proj = player.tryAbility(this);
        if (proj) {
          this.projectiles.push(proj);
          this.audio.playAbility(player.faction, player.job);
          this.events.push({
            text: `${player.faction.toUpperCase()} fired ${player.abilityName.toUpperCase()}`,
            faction: player.faction,
            ttl: 2,
          });
        }
      }
    }

    // Projectiles
    this._updateProjectiles(dt);

    // Crystals
    for (const c of this.crystals) c.update(dt);

    // Next feature contract (who/when/what + completion effects)
    if (!this._isSandboxMode()) this._updateNextFeature(dt);
    this._updateGuardianBlessings(dt);

    // Chaos events (EMP Storm, Crystal Rain, Nexus Overload)
    this._updateChaosEvents(dt);

    // Re-spawn delivered jewels (value-tiered, centre-weighted)
    const active = this.crystals.filter(c => !c.delivered);
    const crystalTarget = this._getCrystalTarget();
    if (active.length < crystalTarget * 0.5) {
      this.crystals = this.crystals.filter(c => !c.delivered);
      const cx = this.width / 2, cy = this.height / 2;
      const toSpawn = crystalTarget - this.crystals.length;
      for (let i = 0; i < toSpawn; i++) {
        this.crystals.push(this._createJewel(cx, cy, this.width, this.height));
      }
    }

    // Time-based high-value jewel injection (every 20 s a bonus rare/legendary spawns at centre)
    this._jewelRespawnAccum += dt;
    if (this._jewelRespawnAccum >= this.modeRules.bonusJewelInterval) {
      this._jewelRespawnAccum = 0;
      const cx = this.width / 2, cy = this.height / 2;
      const bonusTier = Math.random() < BONUS_LEGENDARY_CHANCE ? JEWEL_TIERS[2] : JEWEL_TIERS[1];
      const spread = Math.min(this.width, this.height) * 0.08;
      const bx = cx + (Math.random() - 0.5) * spread * 2;
      const by = cy + (Math.random() - 0.5) * spread * 2;
      this.crystals.push(new MemoryCrystal(bx, by, bonusTier));
      this.events.push({
        text: `💎 A ${bonusTier.tier.toUpperCase()} JEWEL appeared in the centre!`,
        faction: 'blue',
        ttl: 3,
      });
    }

    // Sparks
    for (const p of this.sparks) p.update(dt);
    this.sparks = this.sparks.filter(p => !p.dead);
    this.damageNumbers = this.damageNumbers
      .map(number => ({
        ...number,
        y: number.y - 36 * dt,
        ttl: number.ttl - dt,
      }))
      .filter(number => number.ttl > 0);

    // Rain
    for (const d of this.rain) d.update(dt);

    // Data streams
    for (const s of this.dataStreams) {
      s.t += s.speed * dt;
      if (s.t >= 1) {
        s.t = 0;
        // swap direction occasionally
        if (Math.random() < 0.3) {
          const tmp   = s.fromBase;
          s.fromBase  = s.toBase;
          s.toBase    = tmp;
          s.color     = FACTIONS[s.fromBase.faction].color;
        }
      }
      s.x = s.fromBase.x + (s.toBase.x - s.fromBase.x) * s.t;
      s.y = s.fromBase.y + (s.toBase.y - s.fromBase.y) * s.t;
    }

    // Random spark events (ambient)
    if (Math.random() < 0.04) {
      const f = ['blue', 'green', 'red'][Math.floor(Math.random() * 3)];
      const base = this.bases[f];
      this.sparks.push(...Particle.burst(
        base.x + (Math.random() - 0.5) * 60,
        base.y + (Math.random() - 0.5) * 60,
        FACTIONS[f].color, 4));
    }

    this._updateSpectatorState(dt);
    this._updateModeScenario(dt);
    this._checkMatchEnd();
    this.replay.recordFrame();
  }

  _updateModeScenario(dt) {
    if (this._isTutorialMode()) {
      const step = this._currentTutorialStep();
      const local = this.localPlayer;
      if (!step || !local) return;
      if (step.id === 'movement') {
        this._tutorialPendingAdvance =
          this._tutorialMetrics.movementDistance >= 120 &&
          this._tutorialMetrics.spectatorUsed &&
          this._tutorialMetrics.cameraCycleUsed;
      } else if (step.id === 'crystal') {
        this._tutorialPendingAdvance = this._tutorialMetrics.deliveryDone;
      } else if (step.id === 'capture') {
        this._tutorialPendingAdvance = this.trilocks.some(base => base.faction === local.faction);
      } else if (step.id === 'jobs') {
        this._tutorialPendingAdvance = SANDBOX_JOB_ORDER.every(jobId => this._tutorialMetrics.usedJobs[jobId]);
      } else if (step.id === 'alliance') {
        this._tutorialPendingAdvance = !!this.alliance && this._tutorialMetrics.targetUsed;
      } else if (step.id === 'chaos') {
        if (this.chaosEvent) {
          this.chaosEvent.remaining = Math.max(0, this.chaosEvent.remaining - dt);
          const inside = Math.hypot(local.x - this.chaosEvent.x, local.y - this.chaosEvent.y) <= this.chaosEvent.radius;
          this._tutorialPendingAdvance = !inside;
          if (this.chaosEvent.remaining <= 0) this.chaosEvent = null;
        }
      }
      return;
    }

    if (this._isPracticeMode()) {
      const local = this.localPlayer;
      if (!local) return;
      local.energy = Math.min(100, local.energy + 18 * dt);
      if (local.cooldown > 0) local.cooldown = Math.max(0, local.cooldown - dt * 1.35);
    }
  }

  _spawnDamageNumber(x, y, value, color = '#ffd966') {
    if (!this._isSandboxMode()) return;
    this.damageNumbers.push({
      x,
      y,
      value,
      color,
      ttl: 0.9,
    });
  }

  switchLocalJob(jobId) {
    if (!this._isSandboxMode() || !this.localPlayer || !JOBS[jobId]) return;
    this.localPlayer.setJob(jobId, {
      refillEnergy: true,
      resetCooldowns: true,
      preserveHealthRatio: false,
    });
    this.trainingMessage = `${JOBS[jobId].label.toUpperCase()} LINKED — Press Space to test ${this.localPlayer.abilityName.toUpperCase()}.`;
    if (this.practiceState) this.practiceState.lastSwitchedJob = jobId;
  }

  advanceTutorial() {
    if (!this.tutorial || !this._tutorialPendingAdvance) return;
    if (this.tutorial.stepIndex >= TUTORIAL_STEPS.length - 1) {
      this.tutorial.complete = true;
      return;
    }
    this.tutorial.stepIndex += 1;
    this._prepareTutorialStep();
  }

  skipTutorial() {
    if (!this._isTutorialMode()) return;
    this._transitionToMode('standard');
  }

  startMainMatchFromTutorial() {
    if (!this.tutorial?.complete) return;
    this._transitionToMode('standard');
  }

  _transitionToMode(mode) {
    if (!MODE_RULES[mode]) return;
    this.config.gameMode = mode;
    this.modeRules = getModeRules(mode);
    this.config.matchDuration = this.modeRules.matchDuration;
    this.config.winScore = this.modeRules.winScore;
    this.config.chaosEnabled = mode === 'standard';
    this.config.chaosInterval = CHAOS_EVENT_INTERVAL;
    if (mode === 'standard') this.config.startingCrystals = 'normal';
    else if (this._isSandboxMode()) this.config.startingCrystals = 'low';
    this.matchEnded = false;
    this.winnerFaction = null;
    this.victoryTimer = 0;
    this.elapsed = 0;
    this.events = [];
    this.projectiles = [];
    this.players = [];
    this.crystals = [];
    this.trilocks = [];
    this.sparks = [];
    this.rain = [];
    this.dataStreams = [];
    this.damageNumbers = [];
    this.bases = {};
    this.focusedEnemy = null;
    this.rallySignal = null;
    this.alliance = null;
    this.spectatorMode = false;
    this.spectatorCameraMode = 'overhead';
    this.spectatorTarget = null;
    this.minimapPins = [];
    this.recentDeaths = [];
    this.baseAttackAlerts = {
      blue: { active: false, cooldown: 0 },
      green: { active: false, cooldown: 0 },
      red: { active: false, cooldown: 0 },
    };
    this._configureModeState();
    this._spawn();
    this.replay.beginRecording();
  }

  getGuideState() {
    if (this._isTutorialMode()) {
      const step = this._currentTutorialStep();
      if (!step) return null;
      const progress = this._getTutorialProgressText(step.id);
      return {
        visible: true,
        mode: 'tutorial',
        title: step.title,
        body: step.body,
        stepIndex: this.tutorial.stepIndex + 1,
        stepCount: TUTORIAL_STEPS.length,
        highlightIds: step.highlightIds ?? [],
        progress,
        showJobSwitcher: !!step.showJobSwitcher,
        canAdvance: this._tutorialPendingAdvance,
        advanceLabel: this.tutorial.complete ? 'START STANDARD MATCH' : 'NEXT STEP',
        complete: this.tutorial.complete,
      };
    }
    if (this._isPracticeMode()) {
      return {
        visible: true,
        mode: 'practice',
        title: 'PRACTICE MODE · SANDBOX',
        body: this.trainingMessage || 'Switch jobs freely with the buttons or 1-4, then attack the dummy agents with Space. Respawns are unlimited and the match never times out.',
        highlightIds: ['status-right'],
        showJobSwitcher: true,
      };
    }
    return null;
  }

  _getTutorialProgressText(stepId) {
    if (stepId === 'movement') {
      return `MOVE ${Math.min(120, Math.round(this._tutorialMetrics.movementDistance))}/120 · VIEW ${this._tutorialMetrics.spectatorUsed ? 'OK' : 'WAIT'} · CAMERA ${this._tutorialMetrics.cameraCycleUsed ? 'OK' : 'WAIT'}`;
    }
    if (stepId === 'crystal') {
      return this._tutorialMetrics.deliveryDone ? 'DELIVERY COMPLETE' : 'DELIVER 1 CRYSTAL TO YOUR HOME BASE';
    }
    if (stepId === 'capture') {
      return this.trilocks.some(base => base.faction === this.localPlayer?.faction)
        ? 'TRILOCK CAPTURED'
        : 'STAND INSIDE THE TRILOCK RING';
    }
    if (stepId === 'jobs') {
      const done = SANDBOX_JOB_ORDER.filter(jobId => this._tutorialMetrics.usedJobs[jobId]).length;
      return `JOBS TESTED ${done}/${SANDBOX_JOB_ORDER.length}`;
    }
    if (stepId === 'alliance') {
      return this._tutorialMetrics.targetUsed ? 'TARGET PRIORITY CONFIRMED' : 'PRESS TAB AFTER THE ALLIANCE BANNER APPEARS';
    }
    if (stepId === 'chaos') {
      return 'EXIT THE EMP STORM RING';
    }
    return '';
  }

  getObservedPlayer() {
    return this.spectatorMode
      ? (this.spectatorTarget ?? this.localPlayer ?? null)
      : this.localPlayer;
  }

  getCameraState() {
    return this.spectatorMode
      ? { ...this.spectatorCamera, mode: this.spectatorCameraMode, active: true }
      : { x: this.width / 2, y: this.height / 2, zoom: 1, mode: 'overhead', active: false };
  }

  _updateLocalPlayer(player, dt) {
    player.glowPulse += dt * 2.2;
    if (!player.alive) {
      player.respawnTimer -= dt;
      if (player.respawnTimer <= 0) {
        player.alive = true;
        player.maxHealth = player.baseMaxHealth;
        player.health = player.maxHealth;
        player.energy = 100;
        player.cooldown = 0;
        player.cooldown2 = 0;
        player.ultCooldown = 0;
        const point = this.getRespawnPoint(player);
        if (point) {
          player.x = point.x;
          player.y = point.y;
        } else {
          const base = this.bases[player.faction];
          player.x = base.x + (Math.random() - 0.5) * 60;
          player.y = base.y + (Math.random() - 0.5) * 60;
        }
        player.carrying = [];
      }
      return;
    }

    if (player.cooldown > 0) player.cooldown = Math.max(0, player.cooldown - dt);

    const dx = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0);
    const dy = (this.input.down ? 1 : 0) - (this.input.up ? 1 : 0);
    const speedMult = (this.factionBuffs?.[player.faction]?.speedMult ?? 1) *
      (player.passiveState?.speedMult ?? 1) *
      this._getGuardianBlessing(player.faction).speedMult;
    const effSpeed = player.speed * speedMult;
    const prevX = player.x;
    const prevY = player.y;
    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy) || 1;
      player.vx = (dx / len) * effSpeed;
      player.vy = (dy / len) * effSpeed;
    } else {
      player.vx *= 0.82;
      player.vy *= 0.82;
    }
    player.x += player.vx * dt;
    player.y += player.vy * dt;
    player.x = Math.max(PLAYER_RADIUS, Math.min(this.width - PLAYER_RADIUS, player.x));
    player.y = Math.max(PLAYER_RADIUS, Math.min(this.height - PLAYER_RADIUS, player.y));
    if (this._isTutorialMode()) {
      this._tutorialMetrics.movementDistance += Math.hypot(player.x - prevX, player.y - prevY);
    }
    player._updateTrail();

    // Deliver jewels to any owned base (home or captured TriLock)
    if (player.carrying.length > 0) {
      const deliveryBase = this._nearestOwnedBase(player.x, player.y, player.faction);
      if (deliveryBase && Math.hypot(player.x - deliveryBase.x, player.y - deliveryBase.y) < BASE_RADIUS - 5) {
        let totalScore = 0;
        for (const jewel of player.carrying) {
          const pts = deliveryBase.deliverJewel(jewel.value);
          totalScore += this._applyDeliveryPassive(player, deliveryBase, pts);
          jewel.delivered = true;
          this.sparks.push(...Particle.burst(deliveryBase.x, deliveryBase.y, jewel.tierColor, 5, {
            speedMin: 70,
            speedMax: 220,
            lifeMin: 0.45,
            lifeMax: 1.05,
            sizeMin: 2.2,
            sizeMax: 4.2,
            drag: 1.2,
            gravity: 12,
          }));
        }
        this.scores[player.faction] += totalScore;
        this.stats[player.faction].crystals += player.carrying.length;
        if (this._isTutorialMode()) this._tutorialMetrics.deliveryDone = true;
        this.sparks.push(...Particle.ring(deliveryBase.x, deliveryBase.y, FACTIONS[player.faction].color, BASE_RADIUS * 0.55, {
          life: 0.85,
          growth: 150,
          lineWidth: 4,
        }));
        this.events.push({
          text: `${player.faction.toUpperCase()} PLAYER delivered ${player.carrying.length} JEWEL${player.carrying.length > 1 ? 'S' : ''} (+${totalScore})`,
          faction: player.faction,
          ttl: 3,
        });
        player.carrying = [];
      }
    }

    // Pick up nearby jewels (up to MAX_CARRY)
    if (player.carrying.length < MAX_CARRY) {
      const nearest = this._nearestFreeCrystal(player.x, player.y, player);
      if (nearest) {
        const d = Math.hypot(player.x - nearest.x, player.y - nearest.y);
        if (d < this._getCrystalPickupRadius(player.faction)) {
          nearest.carrier = player;
          nearest.pickupLockOwner = null;
          nearest.pickupLockTimer = 0;
          player.carrying.push(nearest);
          this.audio.playCrystalPickup(nearest.tier);
        }
      }
    }
  }

  _updateProjectiles(dt) {
    for (const proj of this.projectiles) {
      proj.update(dt);

      // Bio Shield follows its owner and heals nearby allies
      if (proj.type === 'bioshield' && proj.owner) {
        proj.x = proj.owner.x;
        proj.y = proj.owner.y;
        for (const p of this.players) {
          if (!p.alive || p.faction !== proj.faction) continue;
          const dx = p.x - proj.x, dy = p.y - proj.y;
          if (Math.sqrt(dx * dx + dy * dy) < proj.radius) {
            p.health = Math.min(p.maxHealth, p.health + 15 * dt);
          }
        }
        continue;
      }

      // Railshot & Power Dash — hit enemies
      for (const p of this.players) {
        if (!p.alive || p.faction === proj.faction) continue;
        if (this._isAlly(proj.faction, p.faction)) continue;   // skip allied faction
        const dx = p.x - proj.x, dy = p.y - proj.y;
        if (Math.sqrt(dx * dx + dy * dy) < p.radius + proj.radius + PROJECTILE_HIT_TOLERANCE) {
          this._registerDamage(p, proj.faction);
          proj.owner?.markCombat(this.elapsed);
          p.markCombat(this.elapsed);
          p.health -= proj.damage;
          this._spawnDamageNumber(p.x, p.y - 14, Math.round(proj.damage), FACTIONS[proj.faction].color);
          this.sparks.push(...Particle.burst(p.x, p.y, FACTIONS[proj.faction].color, 8));
          if (p.health <= 0) {
            this._recordElimination(p, proj.owner ?? proj.faction, 'ability KO');
          }
          proj.hit = true;
          break;
        }
      }
    }
    this.projectiles = this.projectiles.filter(p => !p.dead);
  }

  _updateNextFeature(dt) {
    // Tick down active faction buffs
    for (const [faction, buff] of Object.entries(this.factionBuffs)) {
      buff.timer -= dt;
      if (buff.timer <= 0) delete this.factionBuffs[faction];
    }

    const feature = this.nextFeature;
    if (!feature) return;   // all contracts fulfilled

    if (feature.visualTimer > 0) {
      feature.visualTimer = Math.max(0, feature.visualTimer - dt);
    }

    if (!feature.completed && (this.scores[feature.actor] ?? 0) >= feature.triggerScore) {
      feature.completed = true;
      this.scores[feature.actor] += feature.bonusScore;
      feature.visualTimer = feature.visualDuration;
      this.events.push({
        text: `${feature.actor.toUpperCase()} completed ${feature.action} (+${feature.bonusScore})`,
        faction: feature.actor,
        ttl: 3,
      });

      // Apply timed buff to the completing faction
      if (feature.buff) {
        this.factionBuffs[feature.actor] = {
          ...feature.buff,
          timer: feature.visualDuration,
        };
      }
    }

    // Advance past the completed contract once its visual timer expires.
    // When featureIndex exceeds the array length, nextFeature returns null
    // and the HUD shows "ALL CONTRACTS FULFILLED".
    if (feature.completed && feature.visualTimer <= 0 &&
        this.featureIndex < this.featureContracts.length) {
      this.featureIndex++;
    }
  }

  _updateGuardianBlessings(dt) {
    for (const [faction, buff] of Object.entries(this.guardianBlessings)) {
      buff.timer -= dt;
      if (buff.timer <= 0) delete this.guardianBlessings[faction];
    }
  }

  // ── Chaos Events ─────────────────────────────────────────────────────────

  _updateChaosEvents(dt) {
    if (!this.config.chaosEnabled && !this.chaosEvent) return;

    // Tick active event
    if (this.chaosEvent) {
      this.chaosEvent.remaining -= dt;

      // Crystal Rain: spawn extra jewels periodically (value-tiered)
      if (this.chaosEvent.type === 'crystal_rain') {
        this._crystalRainAccum += dt;
        const interval = this.chaosEvent.spawnInterval;
        while (this._crystalRainAccum >= interval) {
          this._crystalRainAccum -= interval;
          const cx = this.width / 2, cy = this.height / 2;
          this.crystals.push(this._createJewel(cx, cy, this.width, this.height));
        }
      }

      if (this.chaosEvent.remaining <= 0) {
        this.events.push({
          text: `${this.chaosEvent.emoji} ${this.chaosEvent.name} has ended`,
          faction: 'blue',
          ttl: 3,
        });
        this._clearChaosEvent();
        this.chaosEventTimer = this.config.chaosInterval;
      }
      return;
    }

    // Countdown to next event
    this.chaosEventTimer -= dt;
    if (this.chaosEventTimer <= 0) {
      this._triggerChaosEvent();
    }
  }

  _triggerChaosEvent() {
    const spec = CHAOS_EVENTS[Math.floor(Math.random() * CHAOS_EVENTS.length)];
    const event = {
      ...spec,
      remaining: spec.duration,
      spawnInterval: spec.type === 'crystal_rain' ? this.modeRules.crystalRainInterval : spec.spawnInterval,
    };

    // EMP Storm: pick a random zone on the map
    if (spec.type === 'emp_storm') {
      const m = CHAOS_ZONE_MARGIN;
      event.x = m + Math.random() * (this.width - m * 2);
      event.y = m + Math.random() * (this.height - m * 2);
      event.radius = 120 + Math.random() * 60;  // 120-180 px radius
    } else if (spec.type === 'data_storm') {
      const targetBase = this._setRandomHighValueBase();
      if (targetBase) {
        event.targetLabel = this._formatBaseLabel(targetBase);
        event.description = `Minimap jammed. Cooldowns x1.5. ${event.targetLabel} pays x3.`;
      }
      this._stretchActiveCooldowns(1.5);
    }

    this.chaosEvent = event;
    this._crystalRainAccum = 0;
    this.audio.playChaosEvent(spec.type);

    this.events.push({
      text: `${spec.emoji} ${spec.name}: ${spec.description}`,
      faction: 'blue',
      ttl: 4,
    });
  }

  _clearChaosEvent() {
    this.chaosEvent = null;
    this._clearHighValueBase();
  }

  _getAbilityCooldownMultiplier() {
    return this.chaosEvent?.type === 'data_storm' ? 1.5 : 1;
  }

  _stretchActiveCooldowns(multiplier) {
    for (const player of this.players) {
      player.cooldown *= multiplier;
      player.cooldown2 *= multiplier;
      player.ultCooldown *= multiplier;
    }
  }

  _clearHighValueBase() {
    if (this.highValueBase) {
      this.highValueBase.highValue = false;
      this.highValueBase.highValueMultiplier = 1;
    }
    this.highValueBase = null;
  }

  _setRandomHighValueBase() {
    this._clearHighValueBase();
    const candidates = [
      ...Object.values(this.bases),
      ...this.trilocks.filter(base => !!base.faction),
    ];
    const target = candidates[Math.floor(Math.random() * candidates.length)] ?? null;
    if (!target) return null;
    target.highValue = true;
    target.highValueMultiplier = 3;
    this.highValueBase = target;
    return target;
  }

  _formatBaseLabel(base) {
    if (!base) return 'TARGET BASE';
    if (base.isHome) return `${base.faction.toUpperCase()} HOME`;
    return base.faction ? `${base.faction.toUpperCase()} TRILOCK` : 'TRILOCK';
  }

  _registerDamage(target, attackerFaction) {
    if (!target || !attackerFaction) return;
    if (!this.damageLedger.has(target)) this.damageLedger.set(target, new Map());
    this.damageLedger.get(target).set(attackerFaction, this.elapsed);
  }

  _recordElimination(victim, killerFaction, reason = 'eliminated') {
    const killerPlayer = typeof killerFaction === 'string' ? null : killerFaction;
    const killerSide = killerPlayer?.faction ?? killerFaction;
    victim.alive = false;
    victim.respawnTimer = 5 * this._getRespawnTimeMultiplier(victim.faction);
    this.sparks.push(...Particle.burst(victim.x, victim.y, FACTIONS[victim.faction].color, 18, {
      speedMin: 35,
      speedMax: 180,
      lifeMin: 0.6,
      lifeMax: 1.35,
      sizeMin: 1.8,
      sizeMax: 3.8,
      drag: 2.1,
      gravity: -6,
    }));

    // Death penalty: drop ALL carried jewels
    victim.dropAllJewels(this);
    this.recentDeaths.push({
      x: victim.x,
      y: victim.y,
      faction: victim.faction,
      timer: DEATH_MARKER_DURATION,
    });

    this.audio.playElimination();
    if (killerPlayer?.passive?.id === 'overclock') {
      killerPlayer.passiveState.overclockStacks = Math.min(
        killerPlayer.passive.maxStacks,
        (killerPlayer.passiveState.overclockStacks ?? 0) + 1,
      );
    }
    this.stats[victim.faction].deaths++;
    if (killerSide && this.stats[killerSide]) {
      this.stats[killerSide].kills++;
      this.scores[killerSide] += KILL_SCORE;
      this.events.push({
        text: `${killerSide.toUpperCase()} ${reason} ${victim.faction.toUpperCase()} (+${KILL_SCORE})`,
        faction: killerSide,
        ttl: 3,
      });
    } else {
      this.events.push({
        text: `☠️ NEXUS GUARDIAN eliminated ${victim.faction.toUpperCase()}`,
        faction: victim.faction,
        ttl: 3,
      });
    }

    const ledger = this.damageLedger.get(victim);
    if (ledger && killerSide && this.stats[killerSide]) {
      for (const [assistFaction, hitTime] of ledger.entries()) {
        if (assistFaction === killerSide) continue;
        if ((this.elapsed - hitTime) > ASSIST_WINDOW) continue;
        this.stats[assistFaction].assists++;
        this.scores[assistFaction] += ASSIST_SCORE;
        this.events.push({
          text: `${assistFaction.toUpperCase()} assisted on ${victim.faction.toUpperCase()} (+${ASSIST_SCORE})`,
          faction: assistFaction,
          ttl: 3,
        });
      }
    }
    this.damageLedger.delete(victim);
    this._checkMatchEnd();
  }

  _checkMatchEnd() {
    if (this.matchEnded) return;
    if (this._isSandboxMode()) return;

    // Score-based match end (when winScore > 0 and a faction reaches it)
    if (this.config.winScore > 0) {
      for (const faction of ['blue', 'green', 'red']) {
        if ((this.scores[faction] ?? 0) >= this.config.winScore) {
          this.matchEnded = true;
          this.winnerFaction = faction;
          this.victoryTimer = 5;
          this.audio.playMatchEnd(this.winnerFaction);
          this.events.push({
            text: `🏆 ${this.winnerFaction.toUpperCase()} reached ${this.config.winScore} pts — VICTORY!`,
            faction: this.winnerFaction,
            ttl: 5,
          });
          return;
        }
      }
    }

    // Time-based match end — winner has the most points
    if (Number.isFinite(this.matchTimer) && this.matchTimer <= 0) {
      this.matchEnded = true;
      const ranking = ['blue', 'green', 'red']
        .map(faction => ({ faction, score: this.scores[faction] ?? 0 }))
        .sort((a, b) => b.score - a.score);
      this.winnerFaction = ranking[0].faction;
      this.victoryTimer = 5;
      this.audio.playMatchEnd(this.winnerFaction);
      this.events.push({
        text: `⏰ TIME UP! ${this.winnerFaction.toUpperCase()} wins the match`,
        faction: this.winnerFaction,
        ttl: 5,
      });
      this.replay.finalizeRecording();
    }
  }

  _restart() {
    this.replay.reset();
    // Reset scores and stats
    for (const faction of ['blue', 'green', 'red']) {
      this.scores[faction] = 0;
      this.stats[faction] = { kills: 0, deaths: 0, assists: 0, crystals: 0 };
    }

    // Reset match state
    this.matchEnded = false;
    this.winnerFaction = null;
    this.victoryTimer = 0;
    this.elapsed = 0;
    this.matchTimer = this.config.matchDuration;
    this.events = [];
    this.projectiles = [];
    this.sparks = [];
    this.damageLedger = new Map();
    this.factionBuffs = {};
    this.guardianBlessings = {};
    this._jewelRespawnAccum = 0;
    this.alliance = null;
    this.focusedEnemy = null;
    this.rallySignal = null;
    this.spectatorTarget = this.localPlayer ?? this.players[0] ?? null;
    this._focusSpectatorCamera(this.width / 2, this.height / 2, 1);
    this.minimapPins = [];
    this.recentDeaths = [];
    this.baseAttackAlerts = {
      blue: { active: false, cooldown: 0 },
      green: { active: false, cooldown: 0 },
      red: { active: false, cooldown: 0 },
    };

    // Reset chaos events
    this._clearChaosEvent();
    this.chaosEventTimer = CHAOS_EVENT_INITIAL_DELAY;
    this._crystalRainAccum = 0;
    this._resetNexusGuardian();

    // Reset feature contracts
    this.featureContracts = createFeatureContracts(this.modeRules).map(c => ({
      ...c,
      completed: false,
      visualTimer: 0,
    }));
    this.featureIndex = 0;

    // Reset players
    const playersPerFaction = this.modeRules.playersPerFaction;
    for (const player of this.players) {
      const base = this.bases[player.faction];
      const angle = (player.index / playersPerFaction) * Math.PI * 2;
      const r = this.modeRules.spawnOrbit + Math.random() * this.modeRules.spawnOrbitVariance;
      player.x = base.x + Math.cos(angle) * r;
      player.y = base.y + Math.sin(angle) * r;
      player.health = player.baseMaxHealth;
      player.maxHealth = player.baseMaxHealth;
      player.energy = 100;
      player.alive = true;
      player.respawnTimer = 0;
      player.carrying = [];
      player.cooldown = Math.random() * player.abilityMax;
      player.trailPoints = [];
      player.lastCombatTime = -Infinity;
      player.passiveState.deliveryBonusActive = false;
      player.passiveState.bioRegenActive = false;
      player.passiveState.bioRegenDelayRemaining = 0;
      player.passiveState.nearbyAllyBonus = false;
      player.passiveState.overclockStacks = 0;
      player.passiveState.speedMult = 1;
      player.passiveState.sprintActive = false;
    }

    // Reset home bases
    for (const base of Object.values(this.bases)) {
      base.crystalsStored = 0;
    }

    // Reset TriLocks to neutral
    for (const tl of this.trilocks) {
      tl.faction = null;
      tl.captureFaction = null;
      tl.captureProgress = 0;
      tl.level = 0;
      tl.crystalsStored = 0;
    }

    // Reset jewels (value-tiered)
    this.crystals = [];
    this._spawnInitialJewels();
    this.resetReplayCamera();
    this.replay.beginRecording();
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  _nearestFreeCrystal(x, y, seeker = null) {
    let best = null, bestD = Infinity;
    for (const c of this.crystals) {
      if (c.delivered || c.carrier) continue;
      if (c.pickupLockTimer > 0 && c.pickupLockOwner === seeker) continue;
      const dx = c.x - x, dy = c.y - y;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  _nearestEnemy(x, y, myFaction) {
    let best = null, bestD = Infinity;
    for (const p of this.players) {
      if (p.faction === myFaction || !p.alive) continue;
      if (this._isAlly(myFaction, p.faction)) continue;   // skip allied faction
      const dx = p.x - x, dy = p.y - y;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  /** Return the nearest alive enemy belonging to a specific faction. */
  _nearestEnemyOfFaction(x, y, targetFaction) {
    let best = null, bestD = Infinity;
    for (const p of this.players) {
      if (p.faction !== targetFaction || !p.alive) continue;
      const dx = p.x - x, dy = p.y - y;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  _nearestFreeCrystalInZone(x, y, radius = Infinity) {
    let best = null, bestD = Infinity;
    for (const c of this.crystals) {
      if (c.delivered || c.carrier) continue;
      const dx = c.x - x, dy = c.y - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > radius || d >= bestD) continue;
      best = c;
      bestD = d;
    }
    return best;
  }

  /** Return the nearest base (home or TriLock) owned by the given faction. */
  _nearestOwnedBase(x, y, faction) {
    let best = null, bestD = Infinity;
    // Home base is always available
    const home = this.bases[faction];
    if (home) {
      const d = Math.sqrt((home.x - x) ** 2 + (home.y - y) ** 2);
      best = home;
      bestD = d;
    }
    // Also consider captured TriLocks
    for (const tl of this.trilocks) {
      if (tl.faction !== faction) continue;
      const d = Math.sqrt((tl.x - x) ** 2 + (tl.y - y) ** 2);
      if (d < bestD) { bestD = d; best = tl; }
    }
    return best;
  }

  _getGuardianBlessing(faction) {
    return this.guardianBlessings[faction] ?? {
      speedMult: 1,
      crystalPickupRangeMult: 1,
      respawnTimeMult: 1,
    };
  }

  _getCrystalPickupRadius(faction) {
    return (PLAYER_RADIUS + CRYSTAL_RADIUS + 2) * this._getGuardianBlessing(faction).crystalPickupRangeMult;
  }

  _getRespawnTimeMultiplier(faction) {
    return this._getGuardianBlessing(faction).respawnTimeMult;
  }

  _updatePassiveEffects(player, dt) {
    const state = player.passiveState;
    if (!state) return;

    state.deliveryBonusActive = false;
    state.bioRegenActive = false;
    state.speedMult = 1;
    state.sprintActive = false;
    state.minimapVisionRadius = player.passive?.minimapVisionRadius ?? 240;

    if (!player.alive) {
      player.maxHealth = player.baseMaxHealth;
      state.nearbyAllyBonus = false;
      state.bioRegenDelayRemaining = 0;
      return;
    }

    if (player.passive?.id === 'data-cache') {
      const ownedBase = this._nearestOwnedBase(player.x, player.y, player.faction);
      state.deliveryBonusActive = !!ownedBase &&
        Math.hypot(player.x - ownedBase.x, player.y - ownedBase.y) <= ownedBase.radius;
      return;
    }

    if (player.passive?.id === 'bio-regen') {
      const adjacentRange = player.radius * 3.5;
      const adjacentAlly = this.players.some(other =>
        other !== player &&
        other.alive &&
        other.faction === player.faction &&
        Math.hypot(player.x - other.x, player.y - other.y) <= adjacentRange,
      );
      state.nearbyAllyBonus = adjacentAlly;
      player.maxHealth = Math.round(player.baseMaxHealth * (
        adjacentAlly ? 1 + player.passive.allyMaxHealthBonus : 1
      ));
      if (player.health > player.maxHealth) player.health = player.maxHealth;
      const elapsedSinceCombat = this.elapsed - player.lastCombatTime;
      state.bioRegenDelayRemaining = Math.max(0, player.passive.regenDelay - elapsedSinceCombat);
      state.bioRegenActive = elapsedSinceCombat >= player.passive.regenDelay &&
        player.health < player.maxHealth;
      return;
    }

    if (player.passive?.id === 'overclock') {
      state.sprintActive = Math.hypot(player.vx, player.vy) >
        player.speed * SPRINT_ACTIVATION_SPEED_RATIO;
      state.speedMult = state.sprintActive ? player.passive.sprintSpeedMult : 1;
      state.overclockStacks = Math.min(player.passive.maxStacks, state.overclockStacks ?? 0);
      return;
    }

    player.maxHealth = player.baseMaxHealth;
  }

  _applyDeliveryPassive(player, base, points) {
    if (player.passive?.id !== 'data-cache') return points;
    const inRange = Math.hypot(player.x - base.x, player.y - base.y) <= base.radius;
    if (!inRange) return points;
    player.passiveState.deliveryBonusActive = true;
    return Math.round(points * player.passive.deliveryBonusMult);
  }

  /** Return the faction currently in the lead (highest score). */
  _leadingFaction() {
    const ranking = ['blue', 'green', 'red']
      .map(f => ({ f, s: this.scores[f] ?? 0 }))
      .sort((a, b) => b.s - a.s);
    // Only return a leader if they are ahead by at least 10 points
    const second = ranking[1]?.s ?? 0;
    if (ranking[0].s > second + 10) return ranking[0].f;
    return null;
  }

  // ── Alliance helpers ──────────────────────────────────────────────────────

  /** Check whether two factions are currently allied. */
  _isAlly(factionA, factionB) {
    if (!this.alliance) return false;
    return this.alliance.members.includes(factionA) &&
           this.alliance.members.includes(factionB);
  }

  /** Re-evaluate alliance state every frame (form / dissolve / update). */
  _updateAlliance() {
    const ranking = ['blue', 'green', 'red']
      .map(f => ({ f, s: this.scores[f] ?? 0 }))
      .sort((a, b) => b.s - a.s);
    const gap = ranking[0].s - ranking[1].s;

    if (this.alliance) {
      // Dissolve if the score gap narrows below the dissolve threshold
      if (gap < ALLIANCE_DISSOLVE_THRESHOLD) {
        this.events.push({
          text: '🤝 Alliance dissolved — scores are close!',
          faction: 'blue', ttl: 4,
        });
        this.alliance = null;
      } else {
        // Keep alliance in sync with current rankings (leader may have changed)
        this.alliance.target  = ranking[0].f;
        this.alliance.members = [ranking[1].f, ranking[2].f];
      }
    } else {
      // Form alliance when top faction runs away with the score
      if (gap >= ALLIANCE_FORM_THRESHOLD) {
        this.alliance = {
          members: [ranking[1].f, ranking[2].f],
          target:  ranking[0].f,
        };
        const a = ranking[1].f.toUpperCase();
        const b = ranking[2].f.toUpperCase();
        const t = ranking[0].f.toUpperCase();
        this.events.push({
          text: `🤝 ${a} & ${b} form ALLIANCE vs ${t}!`,
          faction: 'blue', ttl: 4,
        });
      }
    }
  }

  _updateCommandState(dt) {
    if (this.rallySignal) {
      this.rallySignal.timer = Math.max(0, this.rallySignal.timer - dt);
      if (this.rallySignal.timer <= 0) this.rallySignal = null;
    }
    this.minimapPins = this.minimapPins.filter(pin => {
      pin.timer = Math.max(0, pin.timer - dt);
      return pin.timer > 0;
    });

    if (this.spectatorMode) {
      this.focusedEnemy = null;
      this.rallySignal = null;
      this._abilityLatch = false;
      this._targetLatch = this.input.target;
      this._dropLatch = this.input.drop;
      this._rallyLatch = this.input.rally;
      return;
    }

    const local = this.localPlayer;
    if (this.focusedEnemy && (!this.focusedEnemy.alive || !local ||
        this.focusedEnemy.faction === local.faction ||
        this._isAlly(local.faction, this.focusedEnemy.faction))) {
      this.focusedEnemy = null;
    }

    if (this.input.target && !this._targetLatch) {
      this._targetLatch = true;
      if (this._isTutorialMode()) this._tutorialMetrics.targetUsed = true;
      this._focusNearestEnemy();
    } else if (!this.input.target) {
      this._targetLatch = false;
    }

    if (this.input.drop && !this._dropLatch) {
      this._dropLatch = true;
      this._dropManualCrystal();
    } else if (!this.input.drop) {
      this._dropLatch = false;
    }

    if (this.input.rally && !this._rallyLatch) {
      this._rallyLatch = true;
      this._issueRallySignal();
    } else if (!this.input.rally) {
      this._rallyLatch = false;
    }
  }

  _focusNearestEnemy() {
    const player = this.localPlayer;
    if (!player?.alive) return;
    this.focusedEnemy = this._nearestEnemy(player.x, player.y, player.faction);
    if (!this.focusedEnemy) return;
    this.events.push({
      text: `🎯 Target locked on ${this.focusedEnemy.faction.toUpperCase()}`,
      faction: player.faction,
      ttl: 2,
    });
  }

  _dropManualCrystal() {
    const player = this.localPlayer;
    if (!player?.alive || player.carrying.length === 0) return;
    const jewel = player.carrying.pop();
    const speed = Math.hypot(player.vx, player.vy);
    const dirX = speed > 0 ? player.vx / speed : 0;
    const dirY = speed > 0 ? player.vy / speed : -1;
    jewel.carrier = null;
    jewel.delivered = false;
    jewel.pickupLockOwner = player;
    jewel.pickupLockTimer = 0.75;
    jewel.x = Math.max(CRYSTAL_RADIUS, Math.min(
      this.width - CRYSTAL_RADIUS,
      player.x + dirX * 20 + (Math.random() - 0.5) * 6,
    ));
    jewel.y = Math.max(CRYSTAL_RADIUS, Math.min(
      this.height - CRYSTAL_RADIUS,
      player.y + dirY * 20 + (Math.random() - 0.5) * 6,
    ));
    this.events.push({
      text: `💎 ${player.faction.toUpperCase()} dropped a jewel`,
      faction: player.faction,
      ttl: 2,
    });
  }

  _issueRallySignal() {
    const player = this.localPlayer;
    if (!player?.alive) return;
    this.rallySignal = {
      faction: player.faction,
      x: player.x,
      y: player.y,
      radius: 150,
      timer: 6,
    };
    this.events.push({
      text: `📡 ${player.faction.toUpperCase()} issued a rally signal`,
      faction: player.faction,
      ttl: 3,
    });
  }

  _focusSpectatorCamera(x, y, zoom = this.spectatorCamera.zoom || 1) {
    const safeZoom = Math.max(REPLAY_MIN_ZOOM, Math.min(REPLAY_MAX_ZOOM, zoom));
    const halfW = this.width / (2 * safeZoom);
    const halfH = this.height / (2 * safeZoom);
    this.spectatorCamera.zoom = safeZoom;
    this.spectatorCamera.x = Math.max(halfW, Math.min(this.width - halfW, x));
    this.spectatorCamera.y = Math.max(halfH, Math.min(this.height - halfH, y));
  }

  _cycleSpectatorTarget(direction = 1) {
    const alivePlayers = this.players.filter(player => player.alive);
    if (!alivePlayers.length) {
      this.spectatorTarget = this.localPlayer ?? this.players[0] ?? null;
      return;
    }
    const currentIndex = alivePlayers.indexOf(this.spectatorTarget);
    const nextIndex = direction === 0 || currentIndex < 0
      ? 0
      : (currentIndex + direction + alivePlayers.length) % alivePlayers.length;
    this.spectatorTarget = alivePlayers[nextIndex];
    if (this.spectatorCameraMode === 'follow' && this.spectatorTarget) {
      this._focusSpectatorCamera(this.spectatorTarget.x, this.spectatorTarget.y, 1.35);
    }
  }

  _cycleSpectatorCameraMode() {
    if (!this.spectatorMode) return;
    const modes = ['overhead', 'follow', 'free'];
    const index = modes.indexOf(this.spectatorCameraMode);
    this.spectatorCameraMode = modes[(index + 1 + modes.length) % modes.length];
    this.events.push({
      text: `👁️ Camera ${this.spectatorCameraMode.toUpperCase()}`,
      faction: 'blue',
      ttl: 2,
    });
    this._updateSpectatorState(0);
  }

  _updateSpectatorState(dt) {
    if (!this.spectatorMode) return;
    if (this.spectatorCameraMode === 'overhead') {
      this._focusSpectatorCamera(this.width / 2, this.height / 2, 1);
      return;
    }
    if (this.spectatorCameraMode === 'follow') {
      const target = this.spectatorTarget?.alive ? this.spectatorTarget : this.localPlayer;
      if (target) this._focusSpectatorCamera(target.x, target.y, 1.35);
      return;
    }
    const panSpeed = REPLAY_PAN_SPEED / (this.spectatorCamera.zoom || 1);
    const dx = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0);
    const dy = (this.input.down ? 1 : 0) - (this.input.up ? 1 : 0);
    const zoomDelta = ((this.input.zoomIn ? 1 : 0) - (this.input.zoomOut ? 1 : 0)) * dt * REPLAY_ZOOM_RATE;
    const nextZoom = Math.max(
      REPLAY_MIN_ZOOM,
      Math.min(REPLAY_MAX_ZOOM, this.spectatorCamera.zoom + zoomDelta),
    );
    this._focusSpectatorCamera(
      this.spectatorCamera.x + dx * panSpeed * dt,
      this.spectatorCamera.y + dy * panSpeed * dt,
      nextZoom,
    );
  }

  resetReplayCamera() {
    this.camera.x = this.width / 2;
    this.camera.y = this.height / 2;
    this.camera.zoom = REPLAY_DEFAULT_ZOOM;
  }

  _updateReplayCamera(dt) {
    const panSpeed = REPLAY_PAN_SPEED / this.camera.zoom;
    const dx = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0);
    const dy = (this.input.down ? 1 : 0) - (this.input.up ? 1 : 0);
    this.camera.x += dx * panSpeed * dt;
    this.camera.y += dy * panSpeed * dt;
    if (this.input.zoomIn) this.camera.zoom = Math.min(REPLAY_MAX_ZOOM, this.camera.zoom + dt * REPLAY_ZOOM_RATE);
    if (this.input.zoomOut) this.camera.zoom = Math.max(REPLAY_MIN_ZOOM, this.camera.zoom - dt * REPLAY_ZOOM_RATE);

    const halfW = this.width / (2 * this.camera.zoom);
    const halfH = this.height / (2 * this.camera.zoom);
    this.camera.x = Math.max(halfW, Math.min(this.width - halfW, this.camera.x));
    this.camera.y = Math.max(halfH, Math.min(this.height - halfH, this.camera.y));
  }

  _focusSpectatorCamera(x, y, zoom = 1) {
    this.spectatorCamera.x = x;
    this.spectatorCamera.y = y;
    this.spectatorCamera.zoom = zoom;
  }

  _cycleSpectatorTarget(direction = 1) {
    const alivePlayers = this.players.filter(player => player.alive);
    if (alivePlayers.length === 0) {
      this.spectatorTarget = this.localPlayer ?? null;
      return;
    }
    const currentIndex = Math.max(0, alivePlayers.indexOf(this.spectatorTarget));
    const nextIndex = ((currentIndex + direction) % alivePlayers.length + alivePlayers.length) % alivePlayers.length;
    this.spectatorTarget = alivePlayers[nextIndex] ?? alivePlayers[0];
  }

  _cycleSpectatorCameraMode() {
    if (!this.spectatorMode) return;
    const modes = ['overhead', 'follow', 'free'];
    const currentIndex = Math.max(0, modes.indexOf(this.spectatorCameraMode));
    this.spectatorCameraMode = modes[(currentIndex + 1) % modes.length];
  }

  _updateSpectatorState(dt) {
    if (!this.spectatorMode) {
      this.spectatorTarget = this.localPlayer ?? this.spectatorTarget;
      return;
    }

    if (!this.spectatorTarget?.alive) this._cycleSpectatorTarget(1);
    if (this.spectatorCameraMode === 'overhead') {
      this._focusSpectatorCamera(this.width / 2, this.height / 2, 1);
      return;
    }
    if (this.spectatorCameraMode === 'follow') {
      const target = this.spectatorTarget ?? this.localPlayer;
      if (target) this._focusSpectatorCamera(target.x, target.y, 1.2);
      return;
    }

    const zoom = this.spectatorCamera.zoom || 1;
    const panSpeed = REPLAY_PAN_SPEED / zoom;
    const dx = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0);
    const dy = (this.input.down ? 1 : 0) - (this.input.up ? 1 : 0);
    this.spectatorCamera.x += dx * panSpeed * dt;
    this.spectatorCamera.y += dy * panSpeed * dt;
    if (this.input.zoomIn) this.spectatorCamera.zoom = Math.min(REPLAY_MAX_ZOOM, zoom + dt * REPLAY_ZOOM_RATE);
    if (this.input.zoomOut) this.spectatorCamera.zoom = Math.max(REPLAY_MIN_ZOOM, zoom - dt * REPLAY_ZOOM_RATE);

    const halfW = this.width / (2 * this.spectatorCamera.zoom);
    const halfH = this.height / (2 * this.spectatorCamera.zoom);
    this.spectatorCamera.x = Math.max(halfW, Math.min(this.width - halfW, this.spectatorCamera.x || this.width / 2));
    this.spectatorCamera.y = Math.max(halfH, Math.min(this.height - halfH, this.spectatorCamera.y || this.height / 2));
  }

  _playerId(player) {
    return player ? `${player.faction}:${player.index}` : null;
  }

  _findPlayerById(id) {
    if (!id) return null;
    return this.players.find(player => `${player.faction}:${player.index}` === id) ?? null;
  }

  captureReplayFrame() {
    const round = ReplayManager.round;
    return {
      elapsed: round(this.elapsed),
      matchTimer: round(this.matchTimer),
      matchEnded: this.matchEnded,
      winnerFaction: this.winnerFaction,
      victoryTimer: round(this.victoryTimer),
      scores: { ...this.scores },
      stats: JSON.parse(JSON.stringify(this.stats)),
      alliance: this.alliance ? {
        members: [...this.alliance.members],
        target: this.alliance.target,
      } : null,
      chaosEvent: this.chaosEvent ? {
        ...this.chaosEvent,
        remaining: round(this.chaosEvent.remaining ?? 0),
        x: round(this.chaosEvent.x ?? 0),
        y: round(this.chaosEvent.y ?? 0),
        radius: round(this.chaosEvent.radius ?? 0),
      } : null,
      factionBuffs: Object.fromEntries(
        Object.entries(this.factionBuffs).map(([faction, buff]) => [faction, {
          ...buff,
          timer: round(buff.timer ?? 0),
        }]),
      ),
      featureIndex: this.featureIndex,
      featureContracts: this.featureContracts.map(contract => ({
        actor: contract.actor,
        triggerScore: contract.triggerScore,
        action: contract.action,
        bonusScore: contract.bonusScore,
        visualDuration: contract.visualDuration,
        buff: contract.buff ? { ...contract.buff } : null,
        completed: contract.completed,
        visualTimer: round(contract.visualTimer ?? 0),
      })),
      localPlayerId: this._playerId(this.localPlayer),
      focusedEnemyId: this._playerId(this.focusedEnemy),
      rallySignal: this.rallySignal ? {
        ...this.rallySignal,
        x: round(this.rallySignal.x),
        y: round(this.rallySignal.y),
        radius: round(this.rallySignal.radius),
        timer: round(this.rallySignal.timer),
      } : null,
      bases: Object.fromEntries(
        Object.entries(this.bases).map(([faction, base]) => [faction, {
          faction: base.faction,
          x: round(base.x),
          y: round(base.y),
          shieldPulse: round(base.shieldPulse),
        crystalsStored: base.crystalsStored,
        isHome: base.isHome,
        captureProgress: round(base.captureProgress ?? 0),
        captureFaction: base.captureFaction,
        level: base.level ?? 0,
        highValue: !!base.highValue,
        highValueMultiplier: base.highValueMultiplier ?? 1,
      }]),
      ),
      trilocks: this.trilocks.map(tl => ({
        faction: tl.faction,
        x: round(tl.x),
        y: round(tl.y),
        shieldPulse: round(tl.shieldPulse),
        crystalsStored: tl.crystalsStored,
        isHome: tl.isHome,
        captureProgress: round(tl.captureProgress ?? 0),
        captureFaction: tl.captureFaction,
        level: tl.level ?? 0,
        highValue: !!tl.highValue,
        highValueMultiplier: tl.highValueMultiplier ?? 1,
      })),
      players: this.players.map(player => ({
        faction: player.faction,
        index: player.index,
        x: round(player.x),
        y: round(player.y),
        vx: round(player.vx),
        vy: round(player.vy),
        alive: player.alive,
        respawnTimer: round(player.respawnTimer ?? 0),
        health: round(player.health),
        maxHealth: player.maxHealth,
        energy: round(player.energy),
        cooldown: round(player.cooldown ?? 0),
        cooldown2: round(player.cooldown2 ?? 0),
        ultCooldown: round(player.ultCooldown ?? 0),
        state: player.state,
        role: player.role,
        target: player.target ? { x: round(player.target.x), y: round(player.target.y) } : null,
        trailPoints: player.trailPoints.slice(-REPLAY_TRAIL_HISTORY_LENGTH).map(point => ({
          x: round(point.x),
          y: round(point.y),
          a: round(point.a ?? 1, 3),
        })),
        carrying: [],
      })),
      crystals: this.crystals.map(crystal => ({
        x: round(crystal.x),
        y: round(crystal.y),
        radius: crystal.radius,
        pulse: round(crystal.pulse ?? 0),
        rotAngle: round(crystal.rotAngle ?? 0),
        pickupLockTimer: round(crystal.pickupLockTimer ?? 0),
        pickupLockOwner: this._playerId(crystal.pickupLockOwner),
        tier: crystal.tier,
        value: crystal.value,
        tierColor: crystal.tierColor,
        delivered: crystal.delivered,
        carrier: this._playerId(crystal.carrier),
      })),
      projectiles: this.projectiles.map(projectile => ({
        x: round(projectile.x),
        y: round(projectile.y),
        vx: round(projectile.vx),
        vy: round(projectile.vy),
        faction: projectile.faction,
        type: projectile.type,
        damage: projectile.damage,
        radius: projectile.radius,
        life: round(projectile.life ?? 0),
        maxLife: round(projectile.maxLife ?? 0),
      })),
    };
  }

  restoreReplayFrame(frame) {
    if (!frame) return;
    this.elapsed = frame.elapsed ?? 0;
    this.matchTimer = frame.matchTimer ?? MATCH_DURATION;
    this.matchEnded = !!frame.matchEnded;
    this.winnerFaction = frame.winnerFaction ?? null;
    this.victoryTimer = frame.victoryTimer ?? 0;
    this.scores = { ...frame.scores };
    this.stats = JSON.parse(JSON.stringify(frame.stats));
    this.events = [];
    this.alliance = frame.alliance ? {
      members: [...frame.alliance.members],
      target: frame.alliance.target,
    } : null;
    this._clearHighValueBase();
    this.chaosEvent = frame.chaosEvent ? { ...frame.chaosEvent } : null;
    this.factionBuffs = Object.fromEntries(
      Object.entries(frame.factionBuffs ?? {}).map(([faction, buff]) => [faction, { ...buff }]),
    );
    this.featureIndex = frame.featureIndex ?? 0;
    this.featureContracts = (frame.featureContracts ?? []).map(contract => ({
      ...contract,
      buff: contract.buff ? { ...contract.buff } : null,
    }));

    for (const [faction, snapshot] of Object.entries(frame.bases ?? {})) {
      const base = this.bases[faction];
      if (!base) continue;
      Object.assign(base, snapshot);
    }

    frame.trilocks?.forEach((snapshot, index) => {
      const trilock = this.trilocks[index];
      if (!trilock) return;
      Object.assign(trilock, snapshot);
    });
    this.highValueBase = [
      ...Object.values(this.bases),
      ...this.trilocks,
    ].find(base => base.highValue) ?? null;

    this.players.forEach(player => {
      player.carrying = [];
    });
    frame.players?.forEach(snapshot => {
      const player = this.players.find(candidate =>
        candidate.faction === snapshot.faction && candidate.index === snapshot.index,
      );
      if (!player) return;
      player.x = snapshot.x;
      player.y = snapshot.y;
      player.vx = snapshot.vx;
      player.vy = snapshot.vy;
      player.alive = snapshot.alive;
      player.respawnTimer = snapshot.respawnTimer;
      player.health = snapshot.health;
      player.maxHealth = snapshot.maxHealth;
      player.energy = snapshot.energy;
      player.cooldown = snapshot.cooldown;
      player.cooldown2 = snapshot.cooldown2;
      player.ultCooldown = snapshot.ultCooldown;
      player.state = snapshot.state;
      player.role = snapshot.role;
      player.target = snapshot.target ? { ...snapshot.target } : null;
      player.trailPoints = (snapshot.trailPoints ?? []).map(point => ({ ...point }));
    });

    this.crystals = (frame.crystals ?? []).map(snapshot => ({
      ...snapshot,
      carrier: null,
      pickupLockOwner: null,
    }));
    this.crystals.forEach(crystal => {
      crystal.carrier = this._findPlayerById(crystal.carrier);
      crystal.pickupLockOwner = this._findPlayerById(crystal.pickupLockOwner);
      if (crystal.carrier) crystal.carrier.carrying.push(crystal);
    });

    this.projectiles = (frame.projectiles ?? []).map(projectile => ({ ...projectile }));
    this.focusedEnemy = this._findPlayerById(frame.focusedEnemyId);
    this.localPlayer = this._findPlayerById(frame.localPlayerId) ?? this.players.find(p => p.faction === 'blue') ?? null;
    this.rallySignal = frame.rallySignal ? { ...frame.rallySignal } : null;
  }

  startReplayPlayback() {
    this.replay.enterPlayback();
  }

  toggleReplayPlayback() {
    this.replay.togglePlayback();
  }

  setReplayTime(time) {
    this.replay.seek(time);
  }

  setReplaySpeed(speed) {
    this.replay.setPlaybackSpeed(speed);
  }

  exitReplayPlayback() {
    this.replay.exitPlayback();
  }

  exportReplayFile() {
    const payload = this.replay.exportReplay();
    if (!payload) return;
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.href = url;
    link.download = `cyber-trinity-replay-${stamp}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  restartLiveMatch() {
    this.exitReplayPlayback();
    this._restart();
  }

  _toggleSpectatorMode() {
    this.spectatorMode = !this.spectatorMode;
    this.focusedEnemy = null;
    this.rallySignal = null;
    this._abilityLatch = false;
    if (this.spectatorMode) {
      this.spectatorCameraMode = 'overhead';
      this._cycleSpectatorTarget(0);
      this.events.push({
        text: '👁️ Spectator mode enabled',
        faction: 'blue',
        ttl: 3,
      });
      return;
    }
    this.spectatorCameraMode = 'overhead';
    this._focusSpectatorCamera(this.width / 2, this.height / 2, 1);
    this.events.push({
      text: '▶️ Returned to direct control',
      faction: 'blue',
      ttl: 3,
    });
  }

  _issueMinimapPin(x, y) {
    const player = this.localPlayer;
    if (!player?.alive) return;
    const type = this.hud.getSelectedPinType?.() ?? 'gather';
    const spec = PIN_TYPES[type] ?? PIN_TYPES.gather;
    this.minimapPins = this.minimapPins.filter(pin => pin.faction !== player.faction);
    this.minimapPins.push({
      faction: player.faction,
      type,
      x,
      y,
      radius: spec.radius,
      timer: PIN_DURATION,
    });
    this.events.push({
      text: `${spec.emoji} ${player.faction.toUpperCase()} issued ${spec.label} pin`,
      faction: player.faction,
      ttl: 3,
    });
  }

  _getActivePinForFaction(faction) {
    return this.minimapPins.find(pin => pin.faction === faction) ?? null;
  }

  _updateMinimapAlerts(dt) {
    this.recentDeaths = this.recentDeaths.filter(marker => {
      marker.timer = Math.max(0, marker.timer - dt);
      return marker.timer > 0;
    });
    for (const alert of Object.values(this.baseAttackAlerts)) {
      alert.cooldown = Math.max(0, alert.cooldown - dt);
    }
    for (const faction of ['blue', 'green', 'red']) {
      const base = this.bases[faction];
      const alert = this.baseAttackAlerts[faction];
      const underAttack = this.players.some(player =>
        player.alive &&
        player.faction !== faction &&
        !this._isAlly(faction, player.faction) &&
        Math.hypot(player.x - base.x, player.y - base.y) <= BASE_ALERT_RANGE,
      );
      alert.active = underAttack;
      if (underAttack && alert.cooldown <= 0) {
        alert.cooldown = BASE_ALERT_COOLDOWN;
        this.events.push({
          text: `🚨 ${faction.toUpperCase()} base under attack`,
          faction,
          ttl: 2.5,
        });
      }
    }
  }

  _spawnNexusGuardian() {
    const guardian = this.nexusGuardian;
    if (!guardian) return;
    guardian.state = 'active';
    guardian.spawnCount += 1;
    guardian.maxHealth = Math.round(
      NEXUS_GUARDIAN_BASE_HEALTH * (NEXUS_GUARDIAN_HEALTH_SCALE ** (guardian.spawnCount - 1)),
    );
    guardian.health = guardian.maxHealth;
    guardian.attackTimer = NEXUS_GUARDIAN_ATTACK_INTERVAL;
    guardian.nextAttack = 'aoe';
    guardian.damageByFaction = { blue: 0, green: 0, red: 0 };
    guardian.lastDamager = null;
    this.events.push({
      text: '🛡️ NEXUS GUARDIAN has materialized at the map center',
      faction: 'blue',
      ttl: 4,
    });
    this.sparks.push(...Particle.ring(guardian.x, guardian.y, '#7de6ff', guardian.radius * 0.9, {
      life: 1.1,
      growth: 180,
      lineWidth: 5,
      gravity: 0,
    }));
  }

  _guardianWinningFaction(guardian) {
    const ranking = ['blue', 'green', 'red']
      .map(faction => ({ faction, damage: guardian.damageByFaction[faction] ?? 0 }))
      .sort((a, b) => b.damage - a.damage);
    if ((ranking[0]?.damage ?? 0) > 0) return ranking[0].faction;
    return guardian.lastDamager;
  }

  _dropGuardianCrystals(guardian) {
    const legendary = JEWEL_TIERS.find(tier => tier.tier === 'legendary') ??
      JEWEL_TIERS.reduce((best, tier) => (tier.value > best.value ? tier : best), JEWEL_TIERS[0]);
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2 - Math.PI / 2;
      const radius = guardian.radius + 22;
      this.crystals.push(new MemoryCrystal(
        guardian.x + Math.cos(angle) * radius,
        guardian.y + Math.sin(angle) * radius,
        legendary,
      ));
    }
  }

  _grantGuardianBlessing(faction) {
    if (!faction) return;
    this.guardianBlessings[faction] = {
      ...GUARDIAN_BLESSING,
      timer: GUARDIAN_BLESSING_DURATION,
    };
  }

  _defeatNexusGuardian() {
    const guardian = this.nexusGuardian;
    if (!guardian) return;
    const winnerFaction = this._guardianWinningFaction(guardian);
    guardian.state = 'respawning';
    guardian.timer = this.modeRules.guardianRespawnTime;
    guardian.health = 0;
    guardian.damageByFaction = { blue: 0, green: 0, red: 0 };
    guardian.attackTimer = NEXUS_GUARDIAN_ATTACK_INTERVAL;
    guardian.nextAttack = 'aoe';
    guardian.lastDamager = null;
    this._dropGuardianCrystals(guardian);
    this._grantGuardianBlessing(winnerFaction);
    this.events.push({
      text: `🏆 ${(winnerFaction ?? 'NEUTRAL').toUpperCase()} defeated the NEXUS GUARDIAN`,
      faction: winnerFaction ?? 'blue',
      ttl: 4,
    });
    if (winnerFaction) {
      this.events.push({
        text: `✨ ${winnerFaction.toUpperCase()} gained GUARDIAN'S BLESSING (${GUARDIAN_BLESSING_DURATION}s)`,
        faction: winnerFaction,
        ttl: 4,
      });
    }
    this.sparks.push(...Particle.burst(guardian.x, guardian.y, '#7de6ff', 24, {
      speedMin: 80,
      speedMax: 260,
      lifeMin: 0.8,
      lifeMax: 1.5,
      sizeMin: 2.2,
      sizeMax: 5.2,
      gravity: -18,
    }));
  }

  _applyGuardianDamage(player, damage) {
    player.markCombat(this.elapsed);
    player.health -= damage;
    if (player.health <= 0) this._recordElimination(player, null);
  }

  _nexusGuardianAttack(playersInArena) {
    const guardian = this.nexusGuardian;
    if (!guardian || guardian.state !== 'active') return;
    const targets = Object.values(playersInArena).flat();
    if (targets.length === 0) return;

    if (guardian.nextAttack === 'aoe') {
      guardian.nextAttack = 'target';
      for (const player of this.players) {
        if (!player.alive) continue;
        if (Math.hypot(player.x - guardian.x, player.y - guardian.y) > guardian.aoeRadius) continue;
        this._applyGuardianDamage(player, NEXUS_GUARDIAN_AOE_DAMAGE);
      }
      this.events.push({
        text: '💠 NEXUS GUARDIAN unleashed a pulse wave',
        faction: 'blue',
        ttl: 2.5,
      });
      this.sparks.push(...Particle.ring(guardian.x, guardian.y, '#9ff5ff', guardian.radius * 0.9, {
        life: 0.9,
        growth: 240,
        lineWidth: 5,
        gravity: 0,
      }));
      return;
    }

    const target = targets.sort((a, b) =>
      Math.hypot(a.x - guardian.x, a.y - guardian.y) - Math.hypot(b.x - guardian.x, b.y - guardian.y),
    )[0];
    this._applyGuardianDamage(target, NEXUS_GUARDIAN_TARGET_DAMAGE);
    this.sparks.push(...Particle.burst(target.x, target.y, '#7de6ff', 10, {
      speedMin: 60,
      speedMax: 180,
      lifeMin: 0.45,
      lifeMax: 0.95,
      sizeMin: 1.8,
      sizeMax: 4,
      gravity: -10,
    }));
    this.events.push({
      text: `🎯 NEXUS GUARDIAN focused ${target.faction.toUpperCase()}`,
      faction: target.faction,
      ttl: 2.5,
    });
    guardian.nextAttack = 'aoe';
  }

  _updateNexusGuardian(dt) {
    const guardian = this.nexusGuardian;
    if (!guardian) return;
    this._positionNexusGuardian();

    if (guardian.state !== 'active') {
      guardian.timer = Math.max(0, guardian.timer - dt);
      if (guardian.timer <= 0) this._spawnNexusGuardian();
      return;
    }

    const playersInArena = { blue: [], green: [], red: [] };
    for (const player of this.players) {
      if (!player.alive) continue;
      if (Math.hypot(player.x - guardian.x, player.y - guardian.y) <= guardian.arenaRadius) {
        playersInArena[player.faction].push(player);
      }
    }

    for (const faction of ['blue', 'green', 'red']) {
      const attackers = playersInArena[faction];
      if (attackers.length < NEXUS_GUARDIAN_REQUIRED_ATTACKERS) continue;
      const damage = attackers.length * NEXUS_GUARDIAN_DPS_PER_PLAYER * dt;
      guardian.health = Math.max(0, guardian.health - damage);
      guardian.damageByFaction[faction] += damage;
      guardian.lastDamager = faction;
      this.sparks.push(...Particle.aura(
        guardian.x + (Math.random() - 0.5) * guardian.radius,
        guardian.y + (Math.random() - 0.5) * guardian.radius,
        FACTIONS[faction].color,
        1,
      ));
    }

    guardian.attackTimer -= dt;
    if (guardian.attackTimer <= 0) {
      guardian.attackTimer = NEXUS_GUARDIAN_ATTACK_INTERVAL;
      this._nexusGuardianAttack(playersInArena);
    }

  }

  // ── TriLock capture update ───────────────────────────────────────────────

  _updateTriLocks(dt) {
    for (const tl of this.trilocks) {
      tl.update(dt);

      // Count alive players inside capture range per faction
      const counts = { blue: 0, green: 0, red: 0 };
      for (const p of this.players) {
        if (!p.alive) continue;
        const d = Math.sqrt((p.x - tl.x) ** 2 + (p.y - tl.y) ** 2);
        if (d < CAPTURE_RANGE) counts[p.faction]++;
      }

      const prevFaction = tl.faction;
      tl.tryCapture(counts, dt);

      // Emit event on faction change
      if (tl.faction && tl.faction !== prevFaction) {
        this.events.push({
          text: `🏰 ${tl.faction.toUpperCase()} captured a TRILOCK!`,
          faction: tl.faction,
          ttl: 3,
        });
        this.sparks.push(...Particle.burst(tl.x, tl.y, FACTIONS[tl.faction].color, 12));
      }
    }
  }
}
