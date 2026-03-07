/**
 * entities.js
 * Entity classes: Player (with Job system), Jewel, Base (TriLock), Particle
 *
 * ── Class Hierarchy ──────────────────────────────────────────────────────────
 *
 *  Base (TriLock)          — capturable neutral bases; owner / level / capture progress
 *    ├─ update(dt, world)  — capture tick, shield pulse
 *    └─ tryCapture(faction, dt)
 *
 *  Player (Agent)          — one of four Jobs (Warrior / Mage / Healer / Scout)
 *    ├─ update(dt, world)  — AI + movement
 *    ├─ tryAbility(world)  — job-based skill set
 *    └─ dropAllJewels(world) — death penalty
 *
 *  Jewel (MemoryCrystal)   — value-tiered pickup (Normal 5 / Rare 15 / Legendary 25)
 *    └─ update(dt)         — pulse, follow carrier
 *
 *  Projectile              — ability effects (railshot / bioshield / powerdash / icewall)
 *  Particle                — visual sparks
 *  RainDrop                — ambient rain
 */

// ── Constants ────────────────────────────────────────────────────────────────

export const FACTIONS = {
  blue: {
    id: 'blue',
    name: 'The Archive',
    tagline: 'Knowledge & Order',
    color: '#4aa8ff',
    colorDim: '#1a3a6a',
    glowColor: 'rgba(74,168,255,0.45)',
    role: 'Data Sniper',
    emoji: '🔵',
  },
  green: {
    id: 'green',
    name: 'Life Forge',
    tagline: 'Life & Harmony',
    color: '#50ff78',
    colorDim: '#1a4a2a',
    glowColor: 'rgba(80,255,120,0.45)',
    role: 'Bio Guard',
    emoji: '🟢',
  },
  red: {
    id: 'red',
    name: 'Core Protocol',
    tagline: 'Force & Chaos',
    color: '#ff4444',
    colorDim: '#6a1a1a',
    glowColor: 'rgba(255,68,68,0.45)',
    role: 'Core Striker',
    emoji: '🔴',
  },
};

/** Job definitions — each team fields all four jobs. */
export const JOBS = {
  warrior: {
    id: 'warrior',
    label: 'Warrior',
    emoji: '⚔️',
    speed: 72,
    maxHealth: 130,
    aggro: 0.80,
    skills: [
      { name: 'Power Slash', type: 'powerdash', cost: 25, cooldown: 5, damage: 30 },
      { name: 'War Cry',     type: 'warcry',    cost: 30, cooldown: 8, damage: 0 },
    ],
    ultimate: { name: 'Blade Storm', type: 'bladestorm', cost: 60, cooldown: 20, damage: 45 },
  },
  mage: {
    id: 'mage',
    label: 'Mage',
    emoji: '🔮',
    speed: 55,
    maxHealth: 80,
    aggro: 0.60,
    skills: [
      { name: 'Railshot',  type: 'railshot',  cost: 25, cooldown: 5, damage: 35 },
      { name: 'Ice Wall',  type: 'icewall',   cost: 30, cooldown: 8, damage: 0 },
    ],
    ultimate: { name: 'Meteor Strike', type: 'meteor', cost: 60, cooldown: 20, damage: 50 },
  },
  healer: {
    id: 'healer',
    label: 'Healer',
    emoji: '💚',
    speed: 60,
    maxHealth: 100,
    aggro: 0.35,
    skills: [
      { name: 'Bio Shield', type: 'bioshield', cost: 30, cooldown: 5, damage: 0 },
      { name: 'Purify',     type: 'purify',    cost: 20, cooldown: 6, damage: 0 },
    ],
    ultimate: { name: 'Sanctuary', type: 'sanctuary', cost: 60, cooldown: 20, damage: 0 },
  },
  scout: {
    id: 'scout',
    label: 'Scout',
    emoji: '💨',
    speed: 95,
    maxHealth: 85,
    aggro: 0.50,
    skills: [
      { name: 'Quick Dash', type: 'powerdash', cost: 20, cooldown: 4, damage: 20 },
      { name: 'Smoke Bomb', type: 'smokebomb', cost: 25, cooldown: 8, damage: 0 },
    ],
    ultimate: { name: 'Shadow Step', type: 'shadowstep', cost: 50, cooldown: 18, damage: 30 },
  },
};

/** Per-team job assignment for indices 0–4: 2 Warriors, 1 Mage, 1 Healer, 1 Scout */
const JOB_ASSIGNMENT = ['warrior', 'mage', 'healer', 'scout', 'warrior'];

export const PLAYER_RADIUS = 9;
export const BASE_RADIUS   = 52;
export const CRYSTAL_RADIUS = 6;
export const ABILITY_RANGE  = 160;
export const MAX_CARRY      = 5;          // max jewels a player can hold

/** Jewel value tiers — higher tiers spawn toward the centre of the map. */
export const JEWEL_TIERS = [
  { tier: 'normal',    value: 5,  color: '#a0d4ff', radius: 5, weight: 0.60 },
  { tier: 'rare',      value: 15, color: '#d4a0ff', radius: 7, weight: 0.30 },
  { tier: 'legendary', value: 25, color: '#ffd700', radius: 9, weight: 0.10 },
];

// ── TriLock capture tuning ──────────────────────────────────────────────────
export const CAPTURE_RANGE    = BASE_RADIUS + 20;   // px — how close you must stand
export const CAPTURE_SPEED    = 20;   // progress per second per player inside
export const CAPTURE_MAX      = 100;  // full capture at this value
export const TRILOCK_MAX_LEVEL = 3;

// ── TriLock level-up thresholds ──────────────────────────────────────────
const TRILOCK_LEVEL_2_THRESHOLD = 3;   // deliveries to reach Lv2
const TRILOCK_LEVEL_3_THRESHOLD = 7;   // deliveries to reach Lv3

// ── Utility ───────────────────────────────────────────────────────────────────

function lerp(a, b, t) { return a + (b - a) * t; }

function dist(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function randRange(min, max) { return min + Math.random() * (max - min); }

function normalise(dx, dy) {
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return [dx / len, dy / len];
}

// ── Base (TriLock) ────────────────────────────────────────────────────────────

/**
 * A capturable field base (TriLock).
 * Starts neutral (faction === null for field TriLocks).
 * Faction home bases are created with isHome = true and cannot be captured.
 */
export class Base {
  constructor(faction, x, y, isHome = false) {
    this.faction = faction;           // owning faction or null (neutral)
    this.x = x;
    this.y = y;
    this.radius = BASE_RADIUS;
    this.shieldPulse = Math.random() * Math.PI * 2;
    this.crystalsStored = 0;
    this.alive = true;

    // TriLock capture state
    this.isHome = isHome;             // true → faction spawn; cannot be re-captured
    this.captureProgress = faction ? CAPTURE_MAX : 0;  // 0–100
    this.captureFaction  = faction;   // which faction is accumulating progress
    this.level = faction ? 1 : 0;    // 0 = neutral, 1–3 = captured levels
  }

  update(dt) {
    this.shieldPulse += dt * 1.4;
  }

  /**
   * Called each frame for every non-home TriLock.
   * counts is { blue: N, green: N, red: N } — number of alive players in range.
   * Returns the faction that is making capture progress (or null).
   */
  tryCapture(counts, dt) {
    if (this.isHome) return null;

    // Determine which factions have presence
    const present = Object.entries(counts).filter(([, n]) => n > 0);

    // Contested (2+ factions) → no progress
    if (present.length !== 1) return null;

    const [attackFaction, count] = present[0];

    // Already fully owned by this faction → no work
    if (this.faction === attackFaction && this.captureProgress >= CAPTURE_MAX) return null;

    // Different faction currently has progress → decay first
    if (this.captureFaction && this.captureFaction !== attackFaction) {
      const levelResistance = 1 + (this.level * 0.5);   // higher-level bases resist faster
      this.captureProgress -= CAPTURE_SPEED * count * dt / levelResistance;
      if (this.captureProgress <= 0) {
        // Neutralised
        this.captureProgress = 0;
        this.faction = null;
        this.captureFaction = attackFaction;
        this.level = 0;
      }
      return attackFaction;
    }

    // Same faction building progress
    this.captureFaction = attackFaction;
    this.captureProgress += CAPTURE_SPEED * count * dt;
    if (this.captureProgress >= CAPTURE_MAX) {
      this.captureProgress = CAPTURE_MAX;
      this.faction = attackFaction;
      if (this.level < 1) this.level = 1;
    }
    return attackFaction;
  }

  /** Deliver jewels → level up the TriLock and return delivery score. */
  deliverJewel(value) {
    this.crystalsStored += 1;
    // Level-up thresholds
    if (this.crystalsStored >= TRILOCK_LEVEL_3_THRESHOLD && this.level < 3) this.level = 3;
    else if (this.crystalsStored >= TRILOCK_LEVEL_2_THRESHOLD && this.level < 2) this.level = 2;
    // Delivery bonus scales with level: Lv1 ×1, Lv2 ×1.25, Lv3 ×1.5
    const mult = 1 + (this.level - 1) * 0.25;
    return Math.round(value * mult);
  }
}

// ── Player ────────────────────────────────────────────────────────────────────

export class Player {
  constructor(faction, index, x, y) {
    this.faction   = faction;
    this.index     = index;
    this.x         = x;
    this.y         = y;
    this.vx        = 0;
    this.vy        = 0;
    this.alive     = true;
    this.respawnTimer = 0;
    this.radius    = PLAYER_RADIUS;
    this.carrying  = [];             // array of Jewels (max MAX_CARRY)
    this.trailPoints = [];
    this.glowPulse = Math.random() * Math.PI * 2;
    this.target    = null;           // {x, y} or jewel or base
    this.state     = 'roam';         // 'roam' | 'attack' | 'carry' | 'defend' | 'capture'
    this.attackTimer = 0;

    // ── Job system (replaces faction-locked abilities) ─────────────────────
    const jobId  = JOB_ASSIGNMENT[index] ?? 'warrior';
    const jobDef = JOBS[jobId];
    this.job       = jobId;
    this.jobDef    = jobDef;
    this.speed     = jobDef.speed;
    this.aggro     = jobDef.aggro;
    this.health    = jobDef.maxHealth;
    this.maxHealth = jobDef.maxHealth;
    this.energy    = 100;

    // Primary skill (slot 0) used by AI and player
    const primary   = jobDef.skills[0];
    this.abilityName = primary.name;
    this.abilityCost = primary.cost;
    this.abilityMax  = primary.cooldown;
    this.cooldown    = 0;

    // Secondary skill
    const secondary     = jobDef.skills[1];
    this.ability2Name   = secondary.name;
    this.ability2Cost   = secondary.cost;
    this.ability2Max    = secondary.cooldown;
    this.cooldown2      = 0;

    // Ultimate
    this.ultName    = jobDef.ultimate.name;
    this.ultCost    = jobDef.ultimate.cost;
    this.ultMax     = jobDef.ultimate.cooldown;
    this.ultCooldown = 0;

    // AI role based on job: healers/scouts → collector, warriors → fighter, mage index-based
    if (jobId === 'scout' || jobId === 'healer') this.role = 'collector';
    else if (index === 4) this.role = 'defender';
    else this.role = 'fighter';
  }

  update(dt, world) {
    this.glowPulse += dt * 2.2;

    if (!this.alive) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.alive = true;
        this.health = this.maxHealth;
        const base = world.bases[this.faction];
        this.x = base.x + randRange(-30, 30);
        this.y = base.y + randRange(-30, 30);
        this.carrying = [];
      }
      return;
    }

    if (this.cooldown > 0)     this.cooldown     = Math.max(0, this.cooldown - dt);
    if (this.cooldown2 > 0)    this.cooldown2    = Math.max(0, this.cooldown2 - dt);
    if (this.ultCooldown > 0)  this.ultCooldown  = Math.max(0, this.ultCooldown - dt);

    this._ai(dt, world);
    this._move(dt, world);
    this._updateTrail();
  }

  // ── Role-based behaviour AI ─────────────────────────────────────────────────

  _ai(dt, world) {
    const homeBase = world.bases[this.faction];

    // Carrying jewels → deliver to nearest owned TriLock (or home base)
    if (this.carrying.length > 0) {
      const deliveryTarget = world._nearestOwnedBase(this.x, this.y, this.faction);
      if (deliveryTarget) {
        this.state  = 'carry';
        this.target = deliveryTarget;
        if (dist(this.x, this.y, deliveryTarget.x, deliveryTarget.y) < BASE_RADIUS - 5) {
          // Deliver ALL carried jewels
          let totalScore = 0;
          for (const jewel of this.carrying) {
            const pts = deliveryTarget.deliverJewel(jewel.value);
            totalScore += pts;
            jewel.delivered = true;
          }
          world.scores[this.faction] += totalScore;
          world.stats[this.faction].crystals += this.carrying.length;
          world.events.push({
            text: `${this.faction.toUpperCase()} delivered ${this.carrying.length} JEWEL${this.carrying.length > 1 ? 'S' : ''} (+${totalScore})`,
            faction: this.faction,
            ttl: 3,
          });
          this.carrying = [];
        }
      }
      return;
    }

    this.attackTimer -= dt;

    const rallying = this._applyRallyCommand(world);

    // ── Hate control: bias toward leading team ──────────────────────────────
    // Fighters prefer to target the leading faction
    const leadFaction = world._leadingFaction?.();

    // ── Role-specific decision logic ──────────────────────────────────────
    if (!rallying) {
      switch (this.role) {
        case 'collector': this._aiCollector(world, homeBase); break;
        case 'fighter':   this._aiFighter(world, homeBase, leadFaction);   break;
        case 'defender':  this._aiDefender(world, homeBase);  break;
      }
    }

    // Pick up jewel when close
    if (this.state === 'carry' && this.target instanceof MemoryCrystal) {
      if (!this.target.delivered && !this.target.carrier && this.carrying.length < MAX_CARRY &&
          dist(this.x, this.y, this.target.x, this.target.y) < PLAYER_RADIUS + CRYSTAL_RADIUS + 2) {
        this.target.carrier = this;
        this.target.pickupLockOwner = null;
        this.target.pickupLockTimer = 0;
        this.carrying.push(this.target);
        // Look for next jewel or deliver if at capacity
        if (this.carrying.length >= MAX_CARRY) {
          this.target = null; this.state = 'roam';
        } else {
          const next = world._nearestFreeCrystal(this.x, this.y, this);
          if (next && dist(this.x, this.y, next.x, next.y) < 200) {
            this.target = next;
          } else {
            this.target = null; this.state = 'roam';
          }
        }
      }
    }

    // Attack nearby enemies
    if (this.state === 'attack' && this.attackTimer <= 0) {
      const enemy = world._nearestEnemy(this.x, this.y, this.faction);
      if (enemy && dist(this.x, this.y, enemy.x, enemy.y) < 80) {
        this.attackTimer = 0.6;
        const baseDmg = this.job === 'warrior' ? 22 : this.job === 'mage' ? 18 : this.job === 'scout' ? 15 : 10;
        const dmgMult = world.factionBuffs?.[this.faction]?.damageMult ?? 1;
        const dmg = baseDmg * dmgMult;
        world._registerDamage(enemy, this.faction);
        enemy.health -= dmg;
        world.sparks.push(...Particle.burst(
          (this.x + enemy.x) / 2,
          (this.y + enemy.y) / 2,
          FACTIONS[this.faction].color, 6));
        if (enemy.health <= 0) {
          world._recordElimination(enemy, this.faction, 'eliminated');
        }
      }
    }
  }

  // Collector: jewel collection specialist (low aggro)
  _aiCollector(world, base) {
    if (this.state === 'roam' || !this.target) {
      const crystal = world._nearestFreeCrystal(this.x, this.y, this);
      if (crystal && Math.random() < 0.90) {
        this.target = crystal;
        this.state  = 'carry';
      } else if (Math.random() < this.aggro * 0.08) {
        const alliance = world.alliance;
        const enemies = Object.values(world.bases).filter(b => {
          if (!b.faction || b.faction === this.faction) return false;
          if (alliance && alliance.members.includes(this.faction) &&
              alliance.members.includes(b.faction)) return false;
          return true;
        });
        if (enemies.length) {
          this.target = enemies[Math.floor(Math.random() * enemies.length)];
          this.state  = 'attack';
        }
      } else {
        this.state = 'roam';
        if (!this.target || dist(this.x, this.y, this.target.x, this.target.y) < 20) {
          this.target = {
            x: base.x + randRange(-120, 120),
            y: base.y + randRange(-120, 120),
          };
        }
      }
    }
  }

  _applyRallyCommand(world) {
    const signal = world.rallySignal;
    if (!signal || signal.faction !== this.faction || this.isPlayerControlled) return false;

    const enemy = world._nearestEnemy(signal.x, signal.y, this.faction);
    if (enemy && dist(enemy.x, enemy.y, signal.x, signal.y) < signal.radius) {
      this.target = enemy;
      this.state = 'attack';
      return true;
    }

    const angle = (this.index / 5) * Math.PI * 2;
    const spread = 22 + this.index * 8;
    this.target = {
      x: signal.x + Math.cos(angle) * spread,
      y: signal.y + Math.sin(angle) * spread,
    };
    this.state = 'rally';
    return true;
  }

  // Fighter: enemy elimination specialist — biased toward leading team (hate control)
  _aiFighter(world, base, leadFaction) {
    if (this.state === 'roam' || !this.target) {
      let enemy;
      const alliance = world.alliance;

      if (alliance && alliance.members.includes(this.faction)) {
        // In alliance: 90% chance to specifically target the alliance target faction
        if (Math.random() < 0.90) {
          enemy = world._nearestEnemyOfFaction(this.x, this.y, alliance.target);
        }
      } else if (leadFaction && leadFaction !== this.faction && Math.random() < 0.60) {
        // Hate control: 60% chance to specifically target leading faction if different from own
        enemy = world._nearestEnemyOfFaction(this.x, this.y, leadFaction);
      }
      if (!enemy) {
        enemy = world._nearestEnemy(this.x, this.y, this.faction);
      }

      if (enemy && Math.random() < 0.85) {
        this.target = enemy;
        this.state  = 'attack';
      } else if (Math.random() < this.aggro * 0.50) {
        // Push toward enemy base (skip allied bases)
        const enemyBases = Object.values(world.bases).filter(b => {
          if (!b.faction || b.faction === this.faction) return false;
          if (alliance && alliance.members.includes(this.faction) &&
              alliance.members.includes(b.faction)) return false;
          return true;
        });
        if (enemyBases.length) {
          this.target = enemyBases[Math.floor(Math.random() * enemyBases.length)];
          this.state  = 'attack';
        }
      } else {
        this.state = 'roam';
        if (!this.target || dist(this.x, this.y, this.target.x, this.target.y) < 20) {
          this.target = {
            x: base.x + randRange(-180, 180),
            y: base.y + randRange(-180, 180),
          };
        }
      }
    }
  }

  // Defender: base patrol (restricted to patrol radius around own base)
  _aiDefender(world, base) {
    const PATROL_RADIUS = 140;

    if (dist(this.x, this.y, base.x, base.y) > PATROL_RADIUS) {
      this.target = {
        x: base.x + randRange(-50, 50),
        y: base.y + randRange(-50, 50),
      };
      this.state = 'defend';
      return;
    }

    const enemy = world._nearestEnemy(this.x, this.y, this.faction);
    if (enemy && dist(enemy.x, enemy.y, base.x, base.y) < PATROL_RADIUS) {
      this.target = enemy;
      this.state  = 'attack';
      return;
    }

    const crystal = world._nearestFreeCrystal(this.x, this.y, this);
    if (crystal && dist(crystal.x, crystal.y, base.x, base.y) < PATROL_RADIUS) {
      this.target = crystal;
      this.state  = 'carry';
      return;
    }

    if (this.state === 'roam' || this.state === 'defend' || !this.target ||
        dist(this.x, this.y, this.target.x, this.target.y) < 20) {
      const angle = Math.random() * Math.PI * 2;
      const r = randRange(30, PATROL_RADIUS * 0.7);
      this.target = {
        x: base.x + Math.cos(angle) * r,
        y: base.y + Math.sin(angle) * r,
      };
      this.state = 'defend';
    }
  }

  _move(dt, world) {
    if (!this.target) return;
    const tx = this.target.x;
    const ty = this.target.y;
    const dx = tx - this.x, dy = ty - this.y;
    const d  = Math.sqrt(dx * dx + dy * dy);
    if (d < 2) return;
    const speedMult = world.factionBuffs?.[this.faction]?.speedMult ?? 1;
    const effSpeed  = this.speed * speedMult;
    const [nx, ny] = normalise(dx, dy);
    this.vx = lerp(this.vx, nx * effSpeed, 0.12);
    this.vy = lerp(this.vy, ny * effSpeed, 0.12);
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Clamp to canvas
    this.x = Math.max(PLAYER_RADIUS, Math.min(world.width  - PLAYER_RADIUS, this.x));
    this.y = Math.max(PLAYER_RADIUS, Math.min(world.height - PLAYER_RADIUS, this.y));
  }

  _updateTrail() {
    this.trailPoints.push({ x: this.x, y: this.y, a: 1 });
    if (this.trailPoints.length > 16) this.trailPoints.shift();
    for (const p of this.trailPoints) p.a *= 0.88;
  }

  /**
   * Death penalty — drop ALL carried jewels at current position.
   */
  dropAllJewels(world) {
    for (const jewel of this.carrying) {
      jewel.carrier = null;
      jewel.delivered = false;
      jewel.pickupLockOwner = null;
      jewel.pickupLockTimer = 0;
      // Scatter slightly around death position
      jewel.x = this.x + randRange(-15, 15);
      jewel.y = this.y + randRange(-15, 15);
    }
    this.carrying = [];
  }

  /**
   * Attempt to fire the primary skill.
   * Returns a Projectile or null if conditions aren't met.
   */
  tryAbility(world) {
    if (this.cooldown > 0 || this.energy < this.abilityCost || !this.alive) return null;

    const enemy = world._nearestEnemy(this.x, this.y, this.faction);
    if (!enemy || dist(this.x, this.y, enemy.x, enemy.y) > ABILITY_RANGE) return null;

    this.energy  -= this.abilityCost;
    this.cooldown = this.abilityMax;

    const dx = enemy.x - this.x;
    const dy = enemy.y - this.y;
    const [nx, ny] = normalise(dx, dy);

    const skill = this.jobDef.skills[0];
    let proj;
    switch (skill.type) {
      case 'railshot': {
        proj = new Projectile(this.x, this.y, nx * 420, ny * 420, this.faction, 'railshot', skill.damage);
        break;
      }
      case 'bioshield': {
        proj = new Projectile(this.x, this.y, 0, 0, this.faction, 'bioshield', 0);
        proj.owner = this;
        break;
      }
      case 'powerdash': {
        proj = new Projectile(this.x, this.y, nx * 280, ny * 280, this.faction, 'powerdash', skill.damage);
        proj.owner = this;
        break;
      }
      default: {
        proj = new Projectile(this.x, this.y, nx * 350, ny * 350, this.faction, skill.type, skill.damage);
        proj.owner = this;
        break;
      }
    }
    return proj;
  }
}

// ── MemoryCrystal (Jewel) ─────────────────────────────────────────────────────

export class MemoryCrystal {
  /**
   * @param {number} x
   * @param {number} y
   * @param {object} [tier] - one of JEWEL_TIERS (defaults to 'normal')
   */
  constructor(x, y, tier = null) {
    const t = tier ?? JEWEL_TIERS[0];
    this.x = x;
    this.y = y;
    this.radius    = t.radius;
    this.pulse     = Math.random() * Math.PI * 2;
    this.carrier   = null;
    this.delivered = false;
    this.rotAngle  = Math.random() * Math.PI * 2;
    this.pickupLockOwner = null;
    this.pickupLockTimer = 0;
    // Jewel value data
    this.tier      = t.tier;
    this.value     = t.value;
    this.tierColor = t.color;
  }

  update(dt) {
    this.pulse    += dt * 3.0;
    this.rotAngle += dt * 1.2;
    if (this.pickupLockTimer > 0) this.pickupLockTimer = Math.max(0, this.pickupLockTimer - dt);
    if (this.carrier) {
      this.x = this.carrier.x + 12;
      this.y = this.carrier.y - 6;
    }
  }
}

// ── Particle ──────────────────────────────────────────────────────────────────

export class Particle {
  constructor(x, y, vx, vy, color, life, size = 2.5) {
    this.x     = x;
    this.y     = y;
    this.vx    = vx;
    this.vy    = vy;
    this.color = color;
    this.life  = life;
    this.maxLife = life;
    this.size  = size;
    this.alpha = 1;
  }

  update(dt) {
    this.x    += this.vx * dt;
    this.y    += this.vy * dt;
    this.vy   += 40 * dt; // gravity
    this.life -= dt;
    this.alpha = Math.max(0, this.life / this.maxLife);
  }

  get dead() { return this.life <= 0; }

  static burst(x, y, color, count = 8) {
    return Array.from({ length: count }, () => {
      const angle = Math.random() * Math.PI * 2;
      const speed = randRange(40, 140);
      return new Particle(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, color, randRange(0.4, 1.2));
    });
  }
}

// ── Projectile (ability effects) ──────────────────────────────────────────────

export class Projectile {
  constructor(x, y, vx, vy, faction, type, damage) {
    this.x      = x;
    this.y      = y;
    this.vx     = vx;
    this.vy     = vy;
    this.faction = faction;
    this.type   = type;   // 'railshot' | 'bioshield' | 'powerdash'
    this.damage = damage;
    this.life   = type === 'bioshield' ? 2.5 : 0.8;
    this.maxLife = this.life;
    this.radius = type === 'bioshield' ? 50 : type === 'powerdash' ? 12 : 4;
    this.hit    = false;
    this.owner  = null;   // set by caller
  }

  update(dt) {
    this.x    += this.vx * dt;
    this.y    += this.vy * dt;
    this.life -= dt;
  }

  get dead() { return this.life <= 0 || this.hit; }

  get alpha() { return Math.max(0, this.life / this.maxLife); }
}

// ── RainDrop ──────────────────────────────────────────────────────────────────

export class RainDrop {
  constructor(width, height) {
    this.reset(width, height);
  }

  reset(width, height) {
    this.x     = Math.random() * width;
    this.y     = Math.random() * height * -1;
    this.len   = randRange(8, 20);
    this.speed = randRange(260, 480);
    this.alpha = randRange(0.08, 0.22);
    this.width = width;
    this.height = height;
  }

  update(dt) {
    this.y += this.speed * dt;
    this.x -= this.speed * 0.12 * dt; // slight wind
    if (this.y > this.height + 20) this.reset(this.width, this.height);
  }
}
