/**
 * game.js
 * Main game world — state management, update loop, entity spawning.
 */

import { Base, Player, MemoryCrystal, Particle, RainDrop, Projectile, FACTIONS, PLAYER_RADIUS, CRYSTAL_RADIUS, BASE_RADIUS } from './entities.js';
import { Renderer } from './renderer.js';
import { HUD } from './hud.js';

const RAIN_COUNT      = 220;
const CRYSTAL_COUNT   = 10;
const DATA_STREAM_COUNT = 30;
const AI_ABILITY_CHANCE = 0.008;       // per-agent per-frame probability (~once every 12 s)
const PROJECTILE_HIT_TOLERANCE = 4;    // extra px added to collision radii
const KILL_SCORE = 5;
const ASSIST_SCORE = 2;
const ASSIST_WINDOW = 5;
const SCORE_LIMIT = 200;

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
    this.elapsed = 0;
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
    this.localPlayer = this.players.find(p => p.faction === 'blue') ?? null;
    if (this.localPlayer) this.localPlayer.isPlayerControlled = true;

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
    if (this.matchEnded) return;
    this.elapsed += dt;

    // Bases
    for (const base of Object.values(this.bases)) base.update(dt);

    // Players
    for (const player of this.players) {
      if (player.isPlayerControlled) this._updateLocalPlayer(player, dt);
      else player.update(dt, this);
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
        player.carrying = null;
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

    if (player.carrying) {
      const base = this.bases[player.faction];
      if (Math.hypot(player.x - base.x, player.y - base.y) < BASE_RADIUS - 5) {
        base.crystalsStored++;
        this.scores[player.faction] += 10;
        this.stats[player.faction].crystals++;
        this.events.push({
          text: `${player.faction.toUpperCase()} PLAYER delivered CRYSTAL (+10)`,
          faction: player.faction,
          ttl: 3,
        });
        player.carrying.delivered = true;
        player.carrying = null;
      }
      return;
    }

    const nearest = this._nearestFreeCrystal(player.x, player.y);
    if (!nearest) return;
    const d = Math.hypot(player.x - nearest.x, player.y - nearest.y);
    if (d < PLAYER_RADIUS + CRYSTAL_RADIUS + 2) {
      nearest.carrier = player;
      player.carrying = nearest;
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

  _registerDamage(target, attackerFaction) {
    if (!target || !attackerFaction) return;
    if (!this.damageLedger.has(target)) this.damageLedger.set(target, new Map());
    this.damageLedger.get(target).set(attackerFaction, this.elapsed);
  }

  _recordElimination(victim, killerFaction, reason = 'eliminated') {
    victim.alive = false;
    victim.respawnTimer = 5;
    if (victim.carrying) { victim.carrying.carrier = null; victim.carrying = null; }

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
    const ranking = ['blue', 'green', 'red']
      .map(faction => ({ faction, score: this.scores[faction] ?? 0 }))
      .sort((a, b) => b.score - a.score);
    if ((ranking[0]?.score ?? 0) < SCORE_LIMIT) return;
    this.matchEnded = true;
    this.winnerFaction = ranking[0].faction;
    this.events.push({
      text: `${this.winnerFaction.toUpperCase()} wins the match`,
      faction: this.winnerFaction,
      ttl: 5,
    });
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
