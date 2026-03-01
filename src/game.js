/**
 * game.js
 * Main game world — state management, update loop, entity spawning.
 */

import { Base, Player, MemoryCrystal, Particle, RainDrop, Projectile, FACTIONS } from './entities.js';
import { Renderer } from './renderer.js';
import { HUD } from './hud.js';

const RAIN_COUNT      = 220;
const CRYSTAL_COUNT   = 10;
const DATA_STREAM_COUNT = 30;
const AI_ABILITY_CHANCE = 0.008;       // per-agent per-frame probability (~once every 12 s)
const PROJECTILE_HIT_TOLERANCE = 4;    // extra px added to collision radii

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
    this.bases       = {};   // { blue, green, red }
    this.players     = [];
    this.crystals    = [];
    this.sparks      = [];
    this.dataStreams  = [];
    this.rain        = [];
    this.scores      = { blue: 30, green: 85, red: 55 };  // pre-seeded per spec
    this.events      = [];
    this.projectiles = [];
    // Feature contract chain — current contract is featureContracts[featureIndex]
    this.featureContracts = FEATURE_CONTRACTS.map(c => ({
      ...c,
      completed: false,
      visualTimer: 0,
    }));
    this.featureIndex = 0;

    // Active faction buffs: { blue: { speedMult, regenMult, … , timer }, … }
    this.factionBuffs = {};
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
    }
  }

  // ── Spawn ─────────────────────────────────────────────────────────────────

  _spawn() {
    const W = this.width, H = this.height;

    // ── Bases (triangle layout) ───────────────────────────────────────────
    this._positionBases();

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

    // ── Memory crystals ───────────────────────────────────────────────────
    for (let i = 0; i < CRYSTAL_COUNT; i++) {
      this.crystals.push(new MemoryCrystal(
        60 + Math.random() * (W - 120),
        60 + Math.random() * (H - 120),
      ));
    }

    // ── Rain ──────────────────────────────────────────────────────────────
    for (let i = 0; i < RAIN_COUNT; i++) {
      const d   = new RainDrop(W, H);
      d.y = Math.random() * H; // pre-scatter
      this.rain.push(d);
    }

    // ── Data stream particles ─────────────────────────────────────────────
    this._initDataStreams();
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
        const base = new Base(faction, pos.x, pos.y);
        this.bases[faction] = base;
      }
    }
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
    // Bases
    for (const base of Object.values(this.bases)) base.update(dt);

    // Players
    for (const player of this.players) {
      player.update(dt, this);
      // Energy regeneration (buffed by faction overclock)
      if (player.alive && player.energy < 100) {
        const regenMult = this.factionBuffs[player.faction]?.regenMult ?? 1;
        player.energy = Math.min(100, player.energy + 8 * regenMult * dt);
      }
      // Faction heal-over-time buff (Deploy Firewall)
      const healBuff = this.factionBuffs[player.faction]?.healPerSec;
      if (player.alive && healBuff) {
        player.health = Math.min(player.maxHealth, player.health + healBuff * dt);
      }
    }

    // Ability firing (AI triggers periodically)
    for (const player of this.players) {
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

    // Re-spawn delivered crystals
    const active = this.crystals.filter(c => !c.delivered);
    if (active.length < CRYSTAL_COUNT * 0.5) {
      this.crystals = this.crystals.filter(c => !c.delivered);
      const toSpawn = CRYSTAL_COUNT - this.crystals.length;
      for (let i = 0; i < toSpawn; i++) {
        this.crystals.push(new MemoryCrystal(
          60 + Math.random() * (this.width  - 120),
          60 + Math.random() * (this.height - 120),
        ));
      }
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
        const dx = p.x - proj.x, dy = p.y - proj.y;
        if (Math.sqrt(dx * dx + dy * dy) < p.radius + proj.radius + PROJECTILE_HIT_TOLERANCE) {
          p.health -= proj.damage;
          this.sparks.push(...Particle.burst(p.x, p.y, FACTIONS[proj.faction].color, 8));
          if (p.health <= 0) {
            p.alive = false;
            p.respawnTimer = 5;
            if (p.carrying) { p.carrying.carrier = null; p.carrying = null; }
            this.events.push({
              text: `${proj.faction.toUpperCase()} ability KO on ${p.faction.toUpperCase()}`,
              faction: proj.faction,
              ttl: 3,
            });
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
      const dx = p.x - x, dy = p.y - y;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }
}
