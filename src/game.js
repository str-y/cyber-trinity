/**
 * game.js
 * Main game world — state management, update loop, entity spawning.
 *
 * Battle Trinity edition: 3-team time-limited jewel-control action game
 * with capturable TriLock bases, value-tiered jewels, job system and hate control.
 */

import { Base, Player, MemoryCrystal, Particle, RainDrop, Projectile, FACTIONS,
         PLAYER_RADIUS, CRYSTAL_RADIUS, BASE_RADIUS, JEWEL_TIERS,
         CAPTURE_RANGE, MAX_CARRY } from './entities.js';
import { Renderer } from './renderer.js';
import { HUD } from './hud.js';

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
const BONUS_LEGENDARY_CHANCE = 0.3;    // probability of legendary (vs rare) for bonus spawns

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

export class Game {
  constructor(canvas) {
    this.canvas   = canvas;
    this.renderer = new Renderer(canvas);
    this.hud      = new HUD();
    this.running  = false;
    this._lastTs  = 0;

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
    this.matchTimer = MATCH_DURATION;   // countdown (seconds)
    // Feature contract chain — current contract is featureContracts[featureIndex]
    this.featureContracts = FEATURE_CONTRACTS.map(c => ({
      ...c,
      completed: false,
      visualTimer: 0,
    }));
    this.featureIndex = 0;

    // Active faction buffs: { blue: { speedMult, regenMult, … , timer }, … }
    this.factionBuffs = {};
    this.localPlayer = null;
    this.input = { up: false, down: false, left: false, right: false, ability: false };
    this._abilityLatch = false;
    this._bindInput();

    // ── Alliance (temporary 2-vs-1 pact) ─────────────────────────────────
    // When active: { members: [faction, faction], target: faction }
    this.alliance = null;

    // ── Chaos Events ───────────────────────────────────────────────────────
    this.chaosEvent = null;          // active event object or null
    this.chaosEventTimer = CHAOS_EVENT_INITIAL_DELAY;  // countdown to next event
    this._crystalRainAccum = 0;      // accumulator for crystal rain spawns

    // ── Jewel respawn timer ─────────────────────────────────────────────────
    this._jewelRespawnAccum = 0;
  }

  // ── Feature contract accessor (used by HUD and renderer) ─────────────────
  get nextFeature() {
    return this.featureContracts[this.featureIndex] ?? null;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  start() {
    this._resize();
    window.addEventListener('resize', () => this._resize());
    this._spawn();
    this.running = true;
    requestAnimationFrame(ts => this._loop(ts));
  }

  _resize() {
    this.width  = window.innerWidth;
    this.height = window.innerHeight;
    this.renderer.resize(this.width, this.height);

    // Reposition bases on resize
    if (Object.keys(this.bases).length > 0) {
      this._positionBases();
      if (this.trilocks.length > 0) this._positionTriLocks();
    }
  }

  // ── Spawn ─────────────────────────────────────────────────────────────────

  _spawn() {
    const W = this.width, H = this.height;

    // ── Home bases (triangle layout, un-capturable) ─────────────────────
    this._positionBases();

    // ── TriLock neutral bases ───────────────────────────────────────────
    this._spawnTriLocks();

    // ── Players (5 per faction) ───────────────────────────────────────────
    for (const faction of ['blue', 'green', 'red']) {
      const base = this.bases[faction];
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2;
        const r     = 40 + Math.random() * 20;
        const p = new Player(
          faction, i,
          base.x + Math.cos(angle) * r,
          base.y + Math.sin(angle) * r,
        );
        // Stagger cooldowns
        p.cooldown = Math.random() * p.abilityMax;
        this.players.push(p);
      }
    }
    this.localPlayer = this.players.find(p => p.faction === 'blue') ?? null;
    if (this.localPlayer) this.localPlayer.isPlayerControlled = true;

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
  }

  _bindInput() {
    const setKey = (code, down) => {
      if (code === 'KeyW' || code === 'ArrowUp') this.input.up = down;
      if (code === 'KeyS' || code === 'ArrowDown') this.input.down = down;
      if (code === 'KeyA' || code === 'ArrowLeft') this.input.left = down;
      if (code === 'KeyD' || code === 'ArrowRight') this.input.right = down;
      if (code === 'Space') this.input.ability = down;
    };
    window.addEventListener('keydown', e => setKey(e.code, true));
    window.addEventListener('keyup',   e => setKey(e.code, false));
  }

  _positionBases() {
    const W = this.width, H = this.height;
    const cx = W / 2, cy = H / 2;
    const margin = Math.min(W, H) * 0.32;

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
    const ringR = Math.min(W, H) * 0.18;
    for (let i = 0; i < TRILOCK_COUNT; i++) {
      const angle = (i / TRILOCK_COUNT) * Math.PI * 2 - Math.PI / 2;
      const tx = cx + Math.cos(angle) * ringR;
      const ty = cy + Math.sin(angle) * ringR;
      this.trilocks.push(new Base(null, tx, ty, false));
    }
  }

  _positionTriLocks() {
    const W = this.width, H = this.height;
    const cx = W / 2, cy = H / 2;
    const ringR = Math.min(W, H) * 0.18;
    for (let i = 0; i < this.trilocks.length; i++) {
      const angle = (i / this.trilocks.length) * Math.PI * 2 - Math.PI / 2;
      this.trilocks[i].x = cx + Math.cos(angle) * ringR;
      this.trilocks[i].y = cy + Math.sin(angle) * ringR;
    }
  }

  /**
   * Spawn jewels with value tiers. Higher-value jewels spawn closer to the centre.
   * Uses the JEWEL_TIERS weight distribution and distance-from-centre bias.
   */
  _spawnInitialJewels() {
    const W = this.width, H = this.height;
    const cx = W / 2, cy = H / 2;
    for (let i = 0; i < CRYSTAL_COUNT; i++) {
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
    let x, y;
    if (tier.tier === 'legendary') {
      // Centre zone (inner 30%)
      const spread = Math.min(W, H) * 0.15;
      x = cx + (Math.random() - 0.5) * spread * 2;
      y = cy + (Math.random() - 0.5) * spread * 2;
    } else if (tier.tier === 'rare') {
      // Mid zone (inner 50%)
      const spread = Math.min(W, H) * 0.25;
      x = cx + (Math.random() - 0.5) * spread * 2;
      y = cy + (Math.random() - 0.5) * spread * 2;
    } else {
      // Full field
      x = 60 + Math.random() * (W - 120);
      y = 60 + Math.random() * (H - 120);
    }
    x = Math.max(60, Math.min(W - 60, x));
    y = Math.max(60, Math.min(H - 60, y));
    return new MemoryCrystal(x, y, tier);
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
    const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
    this._lastTs = ts;

    this._update(dt);
    this.renderer.render(this, dt);
    this.hud.update(this);

    requestAnimationFrame(t => this._loop(t));
  }

  // ── Update ────────────────────────────────────────────────────────────────

  _update(dt) {
    if (this.matchEnded) {
      this.victoryTimer -= dt;
      if (this.victoryTimer <= 0) this._restart();
      return;
    }
    this.elapsed += dt;
    this.matchTimer -= dt;

    // Home bases
    for (const base of Object.values(this.bases)) base.update(dt);

    // TriLock capture logic
    this._updateTriLocks(dt);

    // Alliance evaluation (before AI so targeting reflects current pact)
    this._updateAlliance();

    // Players
    for (const player of this.players) {
      if (player.isPlayerControlled) this._updateLocalPlayer(player, dt);
      else player.update(dt, this);
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
      // Faction heal-over-time buff (Deploy Firewall)
      const healBuff = this.factionBuffs[player.faction]?.healPerSec;
      if (player.alive && healBuff) {
        player.health = Math.min(player.maxHealth, player.health + healBuff * dt);
      }
    }

    // Ability firing (AI triggers periodically)
    for (const player of this.players) {
      if (player.isPlayerControlled) {
        if (this.input.ability && !this._abilityLatch) {
          this._abilityLatch = true;
          const proj = player.tryAbility(this);
          if (proj) {
            this.projectiles.push(proj);
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
      if (player.alive && Math.random() < AI_ABILITY_CHANCE) {
        const proj = player.tryAbility(this);
        if (proj) {
          this.projectiles.push(proj);
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
    this._updateNextFeature(dt);

    // Chaos events (EMP Storm, Crystal Rain, Nexus Overload)
    this._updateChaosEvents(dt);

    // Re-spawn delivered jewels (value-tiered, centre-weighted)
    const active = this.crystals.filter(c => !c.delivered);
    if (active.length < CRYSTAL_COUNT * 0.5) {
      this.crystals = this.crystals.filter(c => !c.delivered);
      const cx = this.width / 2, cy = this.height / 2;
      const toSpawn = CRYSTAL_COUNT - this.crystals.length;
      for (let i = 0; i < toSpawn; i++) {
        this.crystals.push(this._createJewel(cx, cy, this.width, this.height));
      }
    }

    // Time-based high-value jewel injection (every 20 s a bonus rare/legendary spawns at centre)
    this._jewelRespawnAccum += dt;
    if (this._jewelRespawnAccum >= 20) {
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

    this._checkMatchEnd();
  }

  _updateLocalPlayer(player, dt) {
    player.glowPulse += dt * 2.2;
    if (!player.alive) {
      player.respawnTimer -= dt;
      if (player.respawnTimer <= 0) {
        player.alive = true;
        player.health = player.maxHealth;
        const base = this.bases[player.faction];
        player.x = base.x + (Math.random() - 0.5) * 60;
        player.y = base.y + (Math.random() - 0.5) * 60;
        player.carrying = [];
      }
      return;
    }

    if (player.cooldown > 0) player.cooldown = Math.max(0, player.cooldown - dt);

    const dx = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0);
    const dy = (this.input.down ? 1 : 0) - (this.input.up ? 1 : 0);
    const speedMult = this.factionBuffs?.[player.faction]?.speedMult ?? 1;
    const effSpeed = player.speed * speedMult;
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
    player._updateTrail();

    // Deliver jewels to any owned base (home or captured TriLock)
    if (player.carrying.length > 0) {
      const deliveryBase = this._nearestOwnedBase(player.x, player.y, player.faction);
      if (deliveryBase && Math.hypot(player.x - deliveryBase.x, player.y - deliveryBase.y) < BASE_RADIUS - 5) {
        let totalScore = 0;
        for (const jewel of player.carrying) {
          const pts = deliveryBase.deliverJewel(jewel.value);
          totalScore += pts;
          jewel.delivered = true;
        }
        this.scores[player.faction] += totalScore;
        this.stats[player.faction].crystals += player.carrying.length;
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
      const nearest = this._nearestFreeCrystal(player.x, player.y);
      if (nearest) {
        const d = Math.hypot(player.x - nearest.x, player.y - nearest.y);
        if (d < PLAYER_RADIUS + CRYSTAL_RADIUS + 2) {
          nearest.carrier = player;
          player.carrying.push(nearest);
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
          p.health -= proj.damage;
          this.sparks.push(...Particle.burst(p.x, p.y, FACTIONS[proj.faction].color, 8));
          if (p.health <= 0) {
            this._recordElimination(p, proj.faction, 'ability KO');
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

  // ── Chaos Events ─────────────────────────────────────────────────────────

  _updateChaosEvents(dt) {
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
        this.chaosEvent = null;
        this.chaosEventTimer = CHAOS_EVENT_INTERVAL;
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
    };

    // EMP Storm: pick a random zone on the map
    if (spec.type === 'emp_storm') {
      const m = CHAOS_ZONE_MARGIN;
      event.x = m + Math.random() * (this.width - m * 2);
      event.y = m + Math.random() * (this.height - m * 2);
      event.radius = 120 + Math.random() * 60;  // 120-180 px radius
    }

    this.chaosEvent = event;
    this._crystalRainAccum = 0;

    this.events.push({
      text: `${spec.emoji} ${spec.name}: ${spec.description}`,
      faction: 'blue',
      ttl: 4,
    });
  }

  _registerDamage(target, attackerFaction) {
    if (!target || !attackerFaction) return;
    if (!this.damageLedger.has(target)) this.damageLedger.set(target, new Map());
    this.damageLedger.get(target).set(attackerFaction, this.elapsed);
  }

  _recordElimination(victim, killerFaction, reason = 'eliminated') {
    victim.alive = false;
    victim.respawnTimer = 5;

    // Death penalty: drop ALL carried jewels
    victim.dropAllJewels(this);

    this.stats[killerFaction].kills++;
    this.stats[victim.faction].deaths++;
    this.scores[killerFaction] += KILL_SCORE;
    this.events.push({
      text: `${killerFaction.toUpperCase()} ${reason} ${victim.faction.toUpperCase()} (+${KILL_SCORE})`,
      faction: killerFaction,
      ttl: 3,
    });

    const ledger = this.damageLedger.get(victim);
    if (ledger) {
      for (const [assistFaction, hitTime] of ledger.entries()) {
        if (assistFaction === killerFaction) continue;
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
    // Time-based match end (5 minutes) — winner has the most points
    if (this.matchTimer <= 0) {
      this.matchEnded = true;
      const ranking = ['blue', 'green', 'red']
        .map(faction => ({ faction, score: this.scores[faction] ?? 0 }))
        .sort((a, b) => b.score - a.score);
      this.winnerFaction = ranking[0].faction;
      this.victoryTimer = 5;
      this.events.push({
        text: `⏰ TIME UP! ${this.winnerFaction.toUpperCase()} wins the match`,
        faction: this.winnerFaction,
        ttl: 5,
      });
    }
  }

  _restart() {
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
    this.matchTimer = MATCH_DURATION;
    this.events = [];
    this.projectiles = [];
    this.sparks = [];
    this.damageLedger = new Map();
    this.factionBuffs = {};
    this._jewelRespawnAccum = 0;
    this.alliance = null;

    // Reset chaos events
    this.chaosEvent = null;
    this.chaosEventTimer = CHAOS_EVENT_INITIAL_DELAY;
    this._crystalRainAccum = 0;

    // Reset feature contracts
    this.featureContracts = FEATURE_CONTRACTS.map(c => ({
      ...c,
      completed: false,
      visualTimer: 0,
    }));
    this.featureIndex = 0;

    // Reset players
    for (const player of this.players) {
      const base = this.bases[player.faction];
      const angle = (player.index / 5) * Math.PI * 2;
      const r = 40 + Math.random() * 20;
      player.x = base.x + Math.cos(angle) * r;
      player.y = base.y + Math.sin(angle) * r;
      player.health = player.maxHealth;
      player.energy = 100;
      player.alive = true;
      player.respawnTimer = 0;
      player.carrying = [];
      player.cooldown = Math.random() * player.abilityMax;
      player.trailPoints = [];
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
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  _nearestFreeCrystal(x, y) {
    let best = null, bestD = Infinity;
    for (const c of this.crystals) {
      if (c.delivered || c.carrier) continue;
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
