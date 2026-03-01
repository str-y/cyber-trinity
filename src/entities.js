/**
 * entities.js
 * Entity classes: Player, MemoryCrystal, Base, Particle
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

export const PLAYER_RADIUS = 9;
export const BASE_RADIUS   = 52;
export const CRYSTAL_RADIUS = 6;
export const ABILITY_RANGE  = 160;

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

// ── Base ──────────────────────────────────────────────────────────────────────

export class Base {
  constructor(faction, x, y) {
    this.faction = faction;
    this.x = x;
    this.y = y;
    this.radius = BASE_RADIUS;
    this.shieldPulse = Math.random() * Math.PI * 2;
    this.crystalsStored = 0;
    this.alive = true;
  }

  update(dt) {
    this.shieldPulse += dt * 1.4;
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
    this.health    = 100;
    this.maxHealth = 100;
    this.energy    = 100;
    this.alive     = true;
    this.respawnTimer = 0;
    this.radius    = PLAYER_RADIUS;
    this.carrying  = null;       // MemoryCrystal or null
    this.trailPoints = [];
    this.glowPulse = Math.random() * Math.PI * 2;
    this.cooldown  = 0;          // seconds until ability ready
    this.abilityMax = 6;         // seconds
    this.target    = null;       // {x, y} or crystal or base
    this.state     = 'roam';     // 'roam' | 'attack' | 'carry' | 'defend'
    this.attackTimer = 0;

    // Per-faction speed / aggro
    switch (faction) {
      case 'red':  this.speed = 85; this.aggro = 0.85; this.abilityName = 'Power Dash'; this.abilityCost = 30; break;
      case 'blue': this.speed = 55; this.aggro = 0.55; this.abilityName = 'Railshot';   this.abilityCost = 25; break;
      case 'green':this.speed = 62; this.aggro = 0.45; this.abilityName = 'Bio Shield'; this.abilityCost = 35; break;
    }
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
        this.carrying = null;
      }
      return;
    }

    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);

    this._ai(dt, world);
    this._move(dt, world);
    this._updateTrail();
  }

  // ── Simple behaviour AI ────────────────────────────────────────────────────

  _ai(dt, world) {
    const base = world.bases[this.faction];

    // Carrying a crystal → deliver to base
    if (this.carrying) {
      this.state  = 'carry';
      this.target = base;
      if (dist(this.x, this.y, base.x, base.y) < BASE_RADIUS - 5) {
        base.crystalsStored++;
        world.scores[this.faction] += 10;
        world.events.push({
          text: `${this.faction.toUpperCase()} AGENT delivered CRYSTAL (+10)`,
          faction: this.faction,
          ttl: 3,
        });
        this.carrying.delivered = true;
        this.carrying = null;
      }
      return;
    }

    this.attackTimer -= dt;

    // Wander/roam toward a crystal or enemy base
    if (this.state === 'roam' || !this.target) {
      // Prefer nearest free crystal
      const crystal = world._nearestFreeCrystal(this.x, this.y);
      if (crystal && Math.random() < 0.60) {
        this.target = crystal;
        this.state  = 'carry'; // will pick up when close
      } else if (Math.random() < this.aggro * 0.25) {
        // Attack a random enemy base
        const enemies = Object.values(world.bases).filter(b => b.faction !== this.faction);
        if (enemies.length) {
          this.target = enemies[Math.floor(Math.random() * enemies.length)];
          this.state  = 'attack';
        }
      } else {
        this.state  = 'roam';
        if (!this.target || dist(this.x, this.y, this.target.x, this.target.y) < 20) {
          this.target = {
            x: base.x + randRange(-120, 120),
            y: base.y + randRange(-120, 120),
          };
        }
      }
    }

    // Pick up crystal when close
    if (this.state === 'carry' && this.target instanceof MemoryCrystal) {
      if (!this.target.delivered && !this.target.carrier &&
          dist(this.x, this.y, this.target.x, this.target.y) < PLAYER_RADIUS + CRYSTAL_RADIUS + 2) {
        this.target.carrier = this;
        this.carrying = this.target;
      }
    }

    // Attack nearby enemies
    if (this.state === 'attack' && this.attackTimer <= 0) {
      const enemy = world._nearestEnemy(this.x, this.y, this.faction);
      if (enemy && dist(this.x, this.y, enemy.x, enemy.y) < 80) {
        this.attackTimer = 0.6;
        const baseDmg = this.faction === 'red' ? 18 : this.faction === 'blue' ? 22 : 12;
        const dmgMult = world.factionBuffs?.[this.faction]?.damageMult ?? 1;
        const dmg = baseDmg * dmgMult;
        enemy.health -= dmg;
        world.sparks.push(...Particle.burst(
          (this.x + enemy.x) / 2,
          (this.y + enemy.y) / 2,
          FACTIONS[this.faction].color, 6));
        if (enemy.health <= 0) {
          enemy.alive = false;
          enemy.respawnTimer = 5;
          if (enemy.carrying) { enemy.carrying.carrier = null; enemy.carrying = null; }
          world.events.push({
            text: `${this.faction.toUpperCase()} eliminated ${enemy.faction.toUpperCase()} agent`,
            faction: this.faction,
            ttl: 3,
          });
        }
      }
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
   * Attempt to fire the faction ability.
   * Returns a Projectile or null if conditions aren't met.
   */
  tryAbility(world) {
    if (this.cooldown > 0 || this.energy < this.abilityCost || !this.alive) return null;

    const enemy = world._nearestEnemy(this.x, this.y, this.faction);
    if (!enemy || dist(this.x, this.y, enemy.x, enemy.y) > ABILITY_RANGE) return null;

    // Consume energy & start cooldown
    this.energy  -= this.abilityCost;
    this.cooldown = this.abilityMax;

    const dx = enemy.x - this.x;
    const dy = enemy.y - this.y;
    const [nx, ny] = normalise(dx, dy);

    let proj;
    switch (this.faction) {
      case 'blue': {
        // Railshot — fast long-range bolt
        proj = new Projectile(this.x, this.y, nx * 420, ny * 420, 'blue', 'railshot', 35);
        break;
      }
      case 'green': {
        // Bio Shield — stationary heal aura centred on self
        proj = new Projectile(this.x, this.y, 0, 0, 'green', 'bioshield', 0);
        proj.owner = this;
        break;
      }
      case 'red': {
        // Power Dash — charge toward enemy
        proj = new Projectile(this.x, this.y, nx * 280, ny * 280, 'red', 'powerdash', 25);
        proj.owner = this;
        break;
      }
    }
    return proj;
  }
}

// ── MemoryCrystal ─────────────────────────────────────────────────────────────

export class MemoryCrystal {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius    = CRYSTAL_RADIUS;
    this.pulse     = Math.random() * Math.PI * 2;
    this.carrier   = null;
    this.delivered = false;
    this.rotAngle  = Math.random() * Math.PI * 2;
  }

  update(dt) {
    this.pulse    += dt * 3.0;
    this.rotAngle += dt * 1.2;
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
