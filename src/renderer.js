/**
 * renderer.js
 * Canvas-based renderer for Cyber Trinity.
 * Draws bases, network links, players, crystals, particles, rain, and UI overlays.
 */

import { FACTIONS, BASE_RADIUS, PLAYER_RADIUS, CRYSTAL_RADIUS } from './entities.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

function withAlpha(hex, a) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// ── Renderer class ────────────────────────────────────────────────────────────

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.time   = 0;
  }

  resize(w, h) {
    this.canvas.width  = w;
    this.canvas.height = h;
  }

  render(world, dt) {
    this.time += dt;
    const ctx = this.ctx;
    const { width: W, height: H } = world;

    // ── Background ─────────────────────────────────────────────────────────
    ctx.fillStyle = '#050810';
    ctx.fillRect(0, 0, W, H);

    // Subtle grid (industrial floor)
    this._drawGrid(W, H);

    // ── Rain ───────────────────────────────────────────────────────────────
    this._drawRain(world.rain);

    // ── Puddle / wet-floor reflections ─────────────────────────────────────
    this._drawReflections(world, W, H);

    // ── Network links between bases ────────────────────────────────────────
    this._drawNetworkLinks(world);

    // ── Data stream particles ──────────────────────────────────────────────
    this._drawDataStreams(world.dataStreams);

    // ── Bases ──────────────────────────────────────────────────────────────
    for (const base of Object.values(world.bases)) {
      this._drawBase(base);
    }

    // ── Memory crystals ────────────────────────────────────────────────────
    for (const crystal of world.crystals) {
      if (!crystal.delivered) this._drawCrystal(crystal);
    }

    // ── Player trails ──────────────────────────────────────────────────────
    for (const player of world.players) {
      if (player.alive) this._drawTrail(player);
    }

    // ── Players ────────────────────────────────────────────────────────────
    for (const player of world.players) {
      this._drawPlayer(player);
    }

    // ── Spark particles ────────────────────────────────────────────────────
    this._drawParticles(world.sparks);

    // ── Ability projectiles ─────────────────────────────────────────────
    this._drawProjectiles(world.projectiles);

    // ── Feature completion visual pulse ────────────────────────────────────
    this._drawFeaturePulse(world);

    // ── Vignette / atmospheric overlay ─────────────────────────────────────
    this._drawVignette(W, H);
  }

  // ── Grid ──────────────────────────────────────────────────────────────────

  _drawGrid(W, H) {
    const ctx  = this.ctx;
    const step = 40;
    ctx.save();
    ctx.strokeStyle = 'rgba(40,60,100,0.18)';
    ctx.lineWidth   = 0.5;
    for (let x = 0; x < W; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.restore();
  }

  // ── Rain ──────────────────────────────────────────────────────────────────

  _drawRain(rainDrops) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(140,180,255,0.18)';
    ctx.lineWidth   = 0.8;
    for (const drop of rainDrops) {
      ctx.globalAlpha = drop.alpha;
      ctx.beginPath();
      ctx.moveTo(drop.x, drop.y);
      ctx.lineTo(drop.x - drop.len * 0.12, drop.y + drop.len);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ── Wet-floor reflections ─────────────────────────────────────────────────

  _drawReflections(world, W, H) {
    const ctx = this.ctx;
    ctx.save();
    for (const base of Object.values(world.bases)) {
      const f   = FACTIONS[base.faction];
      const { r, g, b } = hexToRgb(f.color);
      const pulseA = 0.06 + 0.04 * Math.sin(this.time * 1.1 + base.shieldPulse);
      const grad = ctx.createRadialGradient(base.x, H, 0, base.x, H, BASE_RADIUS * 2.5);
      grad.addColorStop(0, `rgba(${r},${g},${b},${pulseA})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  // ── Network links ─────────────────────────────────────────────────────────

  _drawNetworkLinks(world) {
    const ctx   = this.ctx;
    const bases = Object.values(world.bases);
    ctx.save();
    for (let i = 0; i < bases.length; i++) {
      for (let j = i + 1; j < bases.length; j++) {
        const a  = bases[i];
        const b  = bases[j];
        const t  = (Math.sin(this.time * 0.9 + i * 1.3) + 1) / 2;
        const fa = FACTIONS[a.faction];
        const fb = FACTIONS[b.faction];
        const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        grad.addColorStop(0,   withAlpha(fa.color, 0.30));
        grad.addColorStop(0.5, `rgba(200,230,255,${0.08 + t * 0.08})`);
        grad.addColorStop(1,   withAlpha(fb.color, 0.30));
        ctx.strokeStyle = grad;
        ctx.lineWidth   = 1.2;
        ctx.setLineDash([6, 10]);
        ctx.lineDashOffset = -this.time * 24;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.restore();
  }

  // ── Data streams (node → node animated dots) ──────────────────────────────

  _drawDataStreams(streams) {
    const ctx = this.ctx;
    ctx.save();
    for (const s of streams) {
      const { r, g, b } = hexToRgb(s.color);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},${s.alpha})`;
      ctx.shadowBlur  = 8;
      ctx.shadowColor = s.color;
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // ── Base ──────────────────────────────────────────────────────────────────

  _drawBase(base) {
    const ctx = this.ctx;
    const f   = FACTIONS[base.faction];
    const { r, g, b } = hexToRgb(f.color);
    const pulse = 0.45 + 0.20 * Math.sin(this.time * 1.3 + base.shieldPulse);
    const R = BASE_RADIUS;

    ctx.save();

    // Outer glow
    const glow = ctx.createRadialGradient(base.x, base.y, R * 0.3, base.x, base.y, R * 2.2);
    glow.addColorStop(0, `rgba(${r},${g},${b},${0.18 * pulse})`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(base.x, base.y, R * 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Shield ring (animated)
    const shieldAlpha = 0.35 + 0.25 * Math.sin(this.time * 1.8 + base.shieldPulse);
    ctx.strokeStyle = `rgba(${r},${g},${b},${shieldAlpha})`;
    ctx.lineWidth   = 3;
    ctx.shadowBlur  = 18;
    ctx.shadowColor = f.color;
    ctx.beginPath();
    ctx.arc(base.x, base.y, R + 10 + 4 * Math.sin(this.time * 2), 0, Math.PI * 2);
    ctx.stroke();

    // Inner platform
    ctx.shadowBlur  = 12;
    ctx.fillStyle   = `rgba(${r},${g},${b},0.12)`;
    ctx.beginPath();
    ctx.arc(base.x, base.y, R, 0, Math.PI * 2);
    ctx.fill();

    // Core structure (faction-specific icon)
    ctx.shadowBlur  = 20;
    ctx.shadowColor = f.color;
    this._drawBaseIcon(base, f, R);

    // Label
    ctx.shadowBlur  = 0;
    ctx.fillStyle   = f.color;
    ctx.font        = 'bold 10px "Courier New", monospace';
    ctx.textAlign   = 'center';
    ctx.fillText(f.name.toUpperCase(), base.x, base.y + R + 26);
    ctx.font        = '8px "Courier New", monospace';
    ctx.fillStyle   = 'rgba(255,255,255,0.45)';
    ctx.fillText(f.tagline, base.x, base.y + R + 38);

    // Crystal stored counter
    if (base.crystalsStored > 0) {
      ctx.fillStyle = f.color;
      ctx.font      = 'bold 11px "Courier New", monospace';
      ctx.fillText(`💎 ×${base.crystalsStored}`, base.x, base.y - R - 14);
    }

    ctx.restore();
  }

  _drawBaseIcon(base, f, R) {
    const ctx = this.ctx;
    ctx.strokeStyle = f.color;
    ctx.lineWidth   = 2;
    if (base.faction === 'blue') {
      // Server rack – rectangle grid
      const cols = 4, rows = 5, pw = 10, ph = 6, gap = 3;
      const ox = base.x - (cols * (pw + gap)) / 2 + gap / 2;
      const oy = base.y - (rows * (ph + gap)) / 2 + gap / 2;
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const lit = Math.sin(this.time * 3 + c + r) > 0.4;
          ctx.fillStyle = lit ? withAlpha(f.color, 0.7) : withAlpha(f.color, 0.15);
          ctx.fillRect(ox + c * (pw + gap), oy + r * (ph + gap), pw, ph);
        }
      }
    } else if (base.faction === 'green') {
      // Bionic tree – branching lines
      ctx.save();
      ctx.translate(base.x, base.y + R * 0.4);
      ctx.strokeStyle = f.color;
      ctx.lineWidth   = 2.5;
      this._drawBranch(ctx, 0, 0, -Math.PI / 2, R * 0.55, 5);
      ctx.restore();
    } else {
      // Furnace – concentric jagged circles
      for (let i = 3; i > 0; i--) {
        const a = (0.4 + (3 - i) * 0.2) * (0.8 + 0.2 * Math.sin(this.time * 4 + i));
        ctx.strokeStyle = withAlpha(f.color, a);
        ctx.lineWidth   = i * 1.5;
        ctx.beginPath();
        const pts = 12;
        for (let p = 0; p <= pts; p++) {
          const angle = (p / pts) * Math.PI * 2;
          const rr = R * 0.35 * i / 3 * (1 + 0.12 * Math.sin(this.time * 6 + p + i));
          const px = base.x + Math.cos(angle) * rr;
          const py = base.y + Math.sin(angle) * rr;
          p === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }
  }

  _drawBranch(ctx, x, y, angle, len, depth) {
    if (depth === 0 || len < 3) return;
    const ex = x + Math.cos(angle) * len;
    const ey = y + Math.sin(angle) * len;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    const spread = 0.45 + 0.1 * Math.sin(this.time * 0.8 + depth);
    this._drawBranch(ctx, ex, ey, angle - spread, len * 0.65, depth - 1);
    this._drawBranch(ctx, ex, ey, angle + spread, len * 0.65, depth - 1);
  }

  // ── Crystal ───────────────────────────────────────────────────────────────

  _drawCrystal(crystal) {
    const ctx   = this.ctx;
    const sides = 6;
    const pulse = 0.7 + 0.3 * Math.sin(crystal.pulse);
    const R     = CRYSTAL_RADIUS * pulse;

    ctx.save();
    ctx.translate(crystal.x, crystal.y);
    ctx.rotate(crystal.rotAngle);

    // Glow
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 3);
    glow.addColorStop(0, 'rgba(200,230,255,0.35)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, R * 3, 0, Math.PI * 2);
    ctx.fill();

    // Crystal body
    ctx.shadowBlur  = 14;
    ctx.shadowColor = '#a0d0ff';
    ctx.fillStyle   = `rgba(180,220,255,0.85)`;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const angle = (i / sides) * Math.PI * 2;
      const rx = Math.cos(angle) * R * (i % 2 === 0 ? 1 : 0.65);
      const ry = Math.sin(angle) * R * (i % 2 === 0 ? 1 : 0.65);
      i === 0 ? ctx.moveTo(rx, ry) : ctx.lineTo(rx, ry);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  // ── Player trail ──────────────────────────────────────────────────────────

  _drawTrail(player) {
    const ctx  = this.ctx;
    const pts  = player.trailPoints;
    const col  = FACTIONS[player.faction].color;
    if (pts.length < 2) return;
    ctx.save();
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1], p1 = pts[i];
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.strokeStyle = withAlpha(col, p1.a * 0.55);
      ctx.lineWidth   = 2.5 * p1.a;
      ctx.shadowBlur  = 6;
      ctx.shadowColor = col;
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── Player ────────────────────────────────────────────────────────────────

  _drawPlayer(player) {
    const ctx = this.ctx;
    const f   = FACTIONS[player.faction];
    const { r, g, b } = hexToRgb(f.color);

    ctx.save();
    ctx.translate(player.x, player.y);

    if (!player.alive) {
      // Ghost (respawning)
      ctx.globalAlpha = 0.25;
      ctx.fillStyle   = f.color;
      ctx.beginPath();
      ctx.arc(0, 0, PLAYER_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    const glowA = 0.55 + 0.35 * Math.sin(player.glowPulse);
    ctx.shadowBlur  = 16;
    ctx.shadowColor = f.color;

    // Body
    ctx.fillStyle   = `rgba(${r},${g},${b},0.25)`;
    ctx.strokeStyle = `rgba(${r},${g},${b},${glowA})`;
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.arc(0, 0, PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Neon core dot
    ctx.fillStyle   = `rgba(${r},${g},${b},0.9)`;
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();

    // Faction-specific overlay
    ctx.shadowBlur  = 0;
    ctx.strokeStyle = `rgba(${r},${g},${b},0.75)`;
    ctx.lineWidth   = 1;
    if (player.faction === 'blue') {
      // Crosshair (sniper)
      ctx.beginPath();
      ctx.moveTo(-PLAYER_RADIUS, 0); ctx.lineTo(PLAYER_RADIUS, 0);
      ctx.moveTo(0, -PLAYER_RADIUS); ctx.lineTo(0, PLAYER_RADIUS);
      ctx.stroke();
    } else if (player.faction === 'green') {
      // Shield arc (guard)
      ctx.beginPath();
      ctx.arc(0, 0, PLAYER_RADIUS + 4, -Math.PI * 0.6, Math.PI * 0.6);
      ctx.stroke();
    } else {
      // Speed slash (striker)
      ctx.beginPath();
      ctx.moveTo(-PLAYER_RADIUS * 0.8, PLAYER_RADIUS * 0.5);
      ctx.lineTo(PLAYER_RADIUS * 0.8, -PLAYER_RADIUS * 0.5);
      ctx.stroke();
    }

    // Health bar
    const hpW = PLAYER_RADIUS * 2.2;
    const hpY = PLAYER_RADIUS + 5;
    ctx.fillStyle   = 'rgba(0,0,0,0.55)';
    ctx.fillRect(-hpW / 2, hpY, hpW, 3);
    ctx.fillStyle   = f.color;
    ctx.fillRect(-hpW / 2, hpY, hpW * (player.health / player.maxHealth), 3);

    ctx.restore();
  }

  // ── Spark particles ───────────────────────────────────────────────────────

  _drawParticles(particles) {
    const ctx = this.ctx;
    ctx.save();
    for (const p of particles) {
      const { r, g, b } = hexToRgb(p.color);
      ctx.globalAlpha = p.alpha;
      ctx.shadowBlur  = 6;
      ctx.shadowColor = p.color;
      ctx.fillStyle   = `rgb(${r},${g},${b})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.alpha, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur  = 0;
    ctx.restore();
  }

  _drawProjectiles(projectiles) {
    const ctx = this.ctx;
    if (!projectiles) return;
    ctx.save();
    for (const proj of projectiles) {
      const f   = FACTIONS[proj.faction];
      const { r, g, b } = hexToRgb(f.color);
      const a   = proj.alpha;

      if (proj.type === 'railshot') {
        // Bright energy bolt with glow trail
        ctx.shadowBlur  = 16;
        ctx.shadowColor = f.color;
        ctx.strokeStyle = `rgba(${r},${g},${b},${a})`;
        ctx.lineWidth   = 3;
        ctx.beginPath();
        ctx.moveTo(proj.x, proj.y);
        ctx.lineTo(proj.x - proj.vx * 0.03, proj.y - proj.vy * 0.03);
        ctx.stroke();
        ctx.fillStyle = `rgba(255,255,255,${a * 0.9})`;
        ctx.beginPath();
        ctx.arc(proj.x, proj.y, 3, 0, Math.PI * 2);
        ctx.fill();
      } else if (proj.type === 'bioshield') {
        // Expanding/pulsing heal aura circle
        const pulse = 0.5 + 0.3 * Math.sin(this.time * 6);
        ctx.strokeStyle = `rgba(${r},${g},${b},${a * pulse * 0.6})`;
        ctx.lineWidth   = 2;
        ctx.shadowBlur  = 14;
        ctx.shadowColor = f.color;
        ctx.beginPath();
        ctx.arc(proj.x, proj.y, proj.radius, 0, Math.PI * 2);
        ctx.stroke();
        // Inner glow fill
        const grad = ctx.createRadialGradient(proj.x, proj.y, 0, proj.x, proj.y, proj.radius);
        grad.addColorStop(0, `rgba(${r},${g},${b},${a * 0.12})`);
        grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = grad;
        ctx.fill();
      } else if (proj.type === 'powerdash') {
        // Blazing charge trail
        ctx.shadowBlur  = 12;
        ctx.shadowColor = f.color;
        ctx.fillStyle   = `rgba(${r},${g},${b},${a * 0.8})`;
        ctx.beginPath();
        ctx.arc(proj.x, proj.y, proj.radius * a, 0, Math.PI * 2);
        ctx.fill();
        // Motion streak
        ctx.strokeStyle = `rgba(${r},${g},${b},${a * 0.5})`;
        ctx.lineWidth   = 4;
        ctx.beginPath();
        ctx.moveTo(proj.x, proj.y);
        ctx.lineTo(proj.x - proj.vx * 0.05, proj.y - proj.vy * 0.05);
        ctx.stroke();
      }
    }
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  _drawFeaturePulse(world) {
    const timer = world.nextFeature?.visualTimer ?? 0;
    if (timer <= 0) return;
    const faction = world.nextFeature.actor;
    const base = world.bases[faction];
    if (!base) return;

    const f   = FACTIONS[faction];
    const { r, g, b } = hexToRgb(f.color);
    const ctx = this.ctx;
    const pulse = 0.35 + 0.25 * Math.sin(this.time * 7);
    ctx.save();
    ctx.strokeStyle = `rgba(${r},${g},${b},${pulse})`;
    ctx.lineWidth = 4;
    ctx.shadowBlur = 18;
    ctx.shadowColor = f.color;
    ctx.beginPath();
    ctx.arc(base.x, base.y, BASE_RADIUS + 22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Draw buff indicator rings on buffed agents
    for (const player of world.players) {
      if (!player.alive) continue;
      const buff = world.factionBuffs?.[player.faction];
      if (!buff) continue;
      const pf = FACTIONS[player.faction];
      const pr = hexToRgb(pf.color);
      const bAlpha = 0.3 + 0.3 * Math.sin(this.time * 8);
      ctx.save();
      ctx.strokeStyle = `rgba(${pr.r},${pr.g},${pr.b},${bAlpha})`;
      ctx.lineWidth   = 2;
      ctx.shadowBlur  = 10;
      ctx.shadowColor = pf.color;
      ctx.beginPath();
      ctx.arc(player.x, player.y, PLAYER_RADIUS + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── Vignette ──────────────────────────────────────────────────────────────

  _drawVignette(W, H) {
    const ctx  = this.ctx;
    const grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.85);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.62)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }
}
