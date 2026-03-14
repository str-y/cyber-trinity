/**
 * renderer.js
 * Canvas-based renderer for Cyber Trinity.
 * Draws bases, network links, players, crystals, particles, rain, and UI overlays.
 */

import { FACTIONS, BASE_RADIUS, PLAYER_RADIUS, CRYSTAL_RADIUS, CAPTURE_RANGE, ABILITY_RANGE } from './entities.js';
import { resolveArmorColor, resolveEffectColor } from './customization.js';

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

const RING_PARTICLE_ALPHA = 0.95;
const CAMERA_ZOOM_THRESHOLD = 1.001;

// ── Renderer class ────────────────────────────────────────────────────────────

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.time   = 0;
    this.lowQuality = false;
    this.minimapBounds = null;
  }

  resize(w, h) {
    this.canvas.width  = w;
    this.canvas.height = h;
  }

  render(world, dt) {
    this.time += dt;
    this.lowQuality = world.settings?.effectQuality === 'low';
    const ctx = this.ctx;
    const { width: W, height: H } = world;
    const camera = world.getCameraState?.() ?? {
      x: W / 2,
      y: H / 2,
      zoom: 1,
      mode: 'overhead',
      active: false,
    };

    // ── Background ─────────────────────────────────────────────────────────
    ctx.fillStyle = '#050810';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    this._applyCamera(camera, W, H);

    // Subtle grid (industrial floor)
    this._drawGrid(W, H);

    // ── Rain ───────────────────────────────────────────────────────────────
    this._drawRain(world.rain);

    ctx.save();
    this._applyReplayCamera(world, W, H);

    // ── Puddle / wet-floor reflections ─────────────────────────────────────
    if (!this.lowQuality) this._drawReflections(world, W, H);

    // ── Network links between bases ────────────────────────────────────────
    this._drawNetworkLinks(world);

    // ── Data stream particles ──────────────────────────────────────────────
    this._drawDataStreams(world.dataStreams);

    // ── Home bases ─────────────────────────────────────────────────────────
    for (const base of Object.values(world.bases)) {
      this._drawBase(base, world);
    }

    // ── TriLock neutral/captured bases ──────────────────────────────────────
    if (world.trilocks) {
      for (const tl of world.trilocks) {
        this._drawTriLock(tl, world);
      }
    }

    if (world.nexusGuardian?.state === 'active') {
      this._drawNexusGuardian(world.nexusGuardian);
    }

    // ── Jewels (value-tiered) ──────────────────────────────────────────────
    for (const crystal of world.crystals) {
      if (!crystal.delivered) this._drawCrystal(crystal);
    }

    // ── Player trails ──────────────────────────────────────────────────────
    for (const player of world.players) {
      if (player.alive) this._drawTrail(player);
    }

    if (world._isSandboxMode?.()) this._drawPracticeRange(world);

    // ── Players ────────────────────────────────────────────────────────────
    for (const player of world.players) {
      this._drawPlayer(player);
    }

    // ── Spark particles ────────────────────────────────────────────────────
    this._drawParticles(world.sparks);

    // ── Ability projectiles ─────────────────────────────────────────────
    this._drawProjectiles(world.projectiles);

    // ── Targeting and rally indicators ───────────────────────────────────
    this._drawCommandIndicators(world);

    // ── Chaos event effects ────────────────────────────────────────────
    this._drawChaosEvent(world);
    this._drawZoneCollapse(world);

    // ── Feature completion visual pulse ────────────────────────────────────
    this._drawFeaturePulse(world);
    this._drawDamageNumbers(world.damageNumbers);
    ctx.restore();

    // ── Match timer overlay ────────────────────────────────────────────────
    this._drawMatchTimer(world, W, H);

    // ── Victory overlay ────────────────────────────────────────────────────
    if (world.matchEnded && !world.replay?.isActive) this._drawVictoryOverlay(world);

    // ── Vignette / atmospheric overlay ─────────────────────────────────────
    this._drawVignette(W, H);

    // ── Minimap ────────────────────────────────────────────────────────────
    this._drawMinimap(world, W, H);
  }

  _applyReplayCamera(world, W, H) {
    if (!world.replay?.isActive) return;
    const zoom = world.camera?.zoom ?? 1;
    const cx = world.camera?.x ?? W / 2;
    const cy = world.camera?.y ?? H / 2;
    this.ctx.translate(W / 2, H / 2);
    this.ctx.scale(zoom, zoom);
    this.ctx.translate(-cx, -cy);
  }

  _applyCamera(camera, W, H) {
    const zoom = camera?.zoom ?? 1;
    if (zoom <= CAMERA_ZOOM_THRESHOLD) return;
    const x = camera?.x ?? W / 2;
    const y = camera?.y ?? H / 2;
    this.ctx.setTransform(zoom, 0, 0, zoom, W / 2 - x * zoom, H / 2 - y * zoom);
  }

  screenToMinimapWorld(clientX, clientY, world) {
    if (!this.minimapBounds || !world?.width || !world?.height) return null;
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;
    const bounds = this.minimapBounds;
    if (x < bounds.x || x > bounds.x + bounds.width ||
        y < bounds.y || y > bounds.y + bounds.height) {
      return null;
    }
    return {
      x: ((x - bounds.x) / bounds.width) * world.width,
      y: ((y - bounds.y) / bounds.height) * world.height,
    };
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
    for (let i = 0; i < rainDrops.length; i += this.lowQuality ? 2 : 1) {
      const drop = rainDrops[i];
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
    for (let i = 0; i < streams.length; i += this.lowQuality ? 2 : 1) {
      const s = streams[i];
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

  _drawBase(base, world) {
    const ctx = this.ctx;
    const f   = FACTIONS[base.faction];
    const { r, g, b } = hexToRgb(f.color);
    const pulse = 0.45 + 0.20 * Math.sin(this.time * 1.3 + base.shieldPulse);
    const R = BASE_RADIUS;
    const shieldsDown = world?.chaosEvent?.type === 'nexus_overload';
    const highValue = (base.highValueMultiplier ?? 1) > 1;

    ctx.save();

    // Outer glow
    const glow = ctx.createRadialGradient(base.x, base.y, R * 0.3, base.x, base.y, R * 2.2);
    glow.addColorStop(0, `rgba(${r},${g},${b},${0.18 * pulse})`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(base.x, base.y, R * 2.2, 0, Math.PI * 2);
    ctx.fill();

    if (highValue) {
      const dataPulse = 0.55 + 0.35 * Math.sin(this.time * 6 + base.shieldPulse);
      ctx.strokeStyle = `rgba(125,242,255,${0.45 + dataPulse * 0.3})`;
      ctx.lineWidth = 4;
      ctx.shadowBlur = 22;
      ctx.shadowColor = '#7df2ff';
      ctx.setLineDash([10, 6]);
      ctx.lineDashOffset = -this.time * 48;
      ctx.beginPath();
      ctx.arc(base.x, base.y, R + 18 + 3 * Math.sin(this.time * 4), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Shield ring (animated) — suppressed during Nexus Overload
    if (!shieldsDown) {
      const shieldAlpha = 0.35 + 0.25 * Math.sin(this.time * 1.8 + base.shieldPulse);
      ctx.strokeStyle = `rgba(${r},${g},${b},${shieldAlpha})`;
      ctx.lineWidth   = 3;
      ctx.shadowBlur  = 18;
      ctx.shadowColor = f.color;
      ctx.beginPath();
      ctx.arc(base.x, base.y, R + 10 + 4 * Math.sin(this.time * 2), 0, Math.PI * 2);
      ctx.stroke();
    }

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

    if (highValue) {
      ctx.fillStyle = '#7df2ff';
      ctx.font = 'bold 9px "Courier New", monospace';
      ctx.fillText(`HIGH VALUE ×${base.highValueMultiplier ?? 1}`, base.x, base.y - R - 28);
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

  // ── Crystal (Jewel — value-tiered) ──────────────────────────────────────

  _drawCrystal(crystal) {
    const ctx   = this.ctx;
    const sides = 6;
    const pulse = 0.7 + 0.3 * Math.sin(crystal.pulse);
    const R     = (crystal.radius ?? CRYSTAL_RADIUS) * pulse;
    const tierColor = crystal.tierColor ?? '#a0d4ff';

    ctx.save();
    ctx.translate(crystal.x, crystal.y);
    ctx.rotate(crystal.rotAngle);

    // Glow (tier-coloured)
    const rgb = hexToRgb(tierColor);
    const r = rgb?.r ?? 160, g = rgb?.g ?? 212, b = rgb?.b ?? 255;
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 3);
    glow.addColorStop(0, `rgba(${r},${g},${b},0.40)`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, R * 3, 0, Math.PI * 2);
    ctx.fill();

    // Crystal body
    ctx.shadowBlur  = 14;
    ctx.shadowColor = tierColor;
    ctx.fillStyle   = `rgba(${r},${g},${b},0.85)`;
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

    // Value label for rare/legendary
    if (crystal.tier && crystal.tier !== 'normal') {
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 7px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(crystal.value ?? ''), 0, 0);
    }

    ctx.restore();
  }

  // ── Player trail ──────────────────────────────────────────────────────────

  _drawTrail(player) {
    const ctx  = this.ctx;
    const pts  = player.trailPoints;
    const col  = player.appearance
      ? resolveEffectColor(player.appearance.effectColor)
      : FACTIONS[player.faction].color;
    const trailEffect = player.appearance?.trailEffect ?? 'sparks';
    if (pts.length < 2) return;
    ctx.save();
    if (trailEffect === 'data') {
      ctx.fillStyle = withAlpha(col, 0.85);
      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1], p1 = pts[i];
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.strokeStyle = withAlpha(col, p1.a * 0.35);
        ctx.lineWidth = 1.2 * p1.a;
        ctx.setLineDash([3, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillRect(p1.x - 1.5, p1.y - 1.5, 3 * p1.a, 3 * p1.a);
      }
    } else if (trailEffect === 'hologram') {
      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1], p1 = pts[i];
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y - 2);
        ctx.lineTo(p1.x, p1.y - 2);
        ctx.strokeStyle = withAlpha(col, p1.a * 0.28);
        ctx.lineWidth = 4 * p1.a;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y + 1);
        ctx.lineTo(p1.x, p1.y + 1);
        ctx.strokeStyle = withAlpha(col, p1.a * 0.7);
        ctx.lineWidth = 1.6 * p1.a;
        ctx.stroke();
      }
    } else {
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
    }
    ctx.restore();
  }

  // ── Player ────────────────────────────────────────────────────────────────

  _drawPlayer(player) {
    const ctx = this.ctx;
    const f   = FACTIONS[player.faction];
    const armorColor = player.appearance
      ? resolveArmorColor(f.color, player.appearance.armorColor)
      : f.color;
    const effectColor = player.appearance
      ? resolveEffectColor(player.appearance.effectColor)
      : f.color;
    const { r, g, b } = hexToRgb(armorColor);
    const effectRgb = hexToRgb(effectColor);
    const factionRgb = hexToRgb(f.color);

    ctx.save();
    ctx.translate(player.x, player.y);

    if (!player.alive) {
      // Ghost (respawning)
      ctx.globalAlpha = 0.25;
      ctx.fillStyle   = armorColor;
      ctx.beginPath();
      ctx.arc(0, 0, PLAYER_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    const glowA = 0.55 + 0.35 * Math.sin(player.glowPulse);
    ctx.shadowBlur  = 16;
    ctx.shadowColor = armorColor;

    // Body
    ctx.fillStyle   = `rgba(${r},${g},${b},0.25)`;
    ctx.strokeStyle = `rgba(${factionRgb.r},${factionRgb.g},${factionRgb.b},${glowA})`;
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.arc(0, 0, PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Neon core dot
    ctx.fillStyle   = `rgba(${effectRgb.r},${effectRgb.g},${effectRgb.b},0.9)`;
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();

    // Faction-specific overlay
    ctx.shadowBlur  = 0;
    ctx.strokeStyle = `rgba(${factionRgb.r},${factionRgb.g},${factionRgb.b},0.75)`;
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

    // Local operator marker + equipped item
    if (player.isPlayerControlled) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, PLAYER_RADIUS + 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = 'bold 9px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('YOU', 0, -PLAYER_RADIUS - 8);
    }

    const jobEmoji = { warrior: '⚔️', mage: '🔮', healer: '💚', scout: '💨' };
    const itemLabel = jobEmoji[player.job] ?? '⚔️';
    ctx.fillStyle = `rgba(${effectRgb.r},${effectRgb.g},${effectRgb.b},0.85)`;
    ctx.font = 'bold 8px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(itemLabel, 0, PLAYER_RADIUS + 16);
    if (player.isDummy) {
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.font = 'bold 7px "Courier New", monospace';
      ctx.fillText('DUMMY', 0, -PLAYER_RADIUS - 8);
    }

    // Jewel carry indicator
    if (player.carrying && player.carrying.length > 0) {
      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold 7px "Courier New", monospace';
      ctx.fillText(`💎×${player.carrying.length}`, 0, -PLAYER_RADIUS - 18);
    }

    ctx.restore();
  }

  // ── Spark particles ───────────────────────────────────────────────────────

  _drawParticles(particles) {
    const ctx = this.ctx;
    ctx.save();
    for (let i = 0; i < particles.length; i += this.lowQuality ? 2 : 1) {
      const p = particles[i];
      const { r, g, b } = hexToRgb(p.color);
      ctx.globalAlpha = p.alpha;
      ctx.shadowBlur  = this.lowQuality ? 0 : 6;
      ctx.shadowColor = p.color;
      if (p.shape === 'ring') {
        ctx.lineWidth = Math.max(1, p.lineWidth * p.alpha);
        ctx.strokeStyle = `rgba(${r},${g},${b},${Math.min(1, p.alpha * RING_PARTICLE_ALPHA)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle   = `rgb(${r},${g},${b})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.alpha, 0, Math.PI * 2);
        ctx.fill();
      }
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
      const color = proj.effectColor ?? f.color;
      const { r, g, b } = hexToRgb(color);
      const a   = proj.alpha;

      if (proj.type === 'railshot') {
        // Bright energy bolt with glow trail
        ctx.shadowBlur  = this.lowQuality ? 8 : 16;
        ctx.shadowColor = color;
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
        ctx.shadowBlur  = this.lowQuality ? 6 : 14;
        ctx.shadowColor = color;
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
        ctx.shadowBlur  = this.lowQuality ? 6 : 12;
        ctx.shadowColor = color;
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

  _drawPracticeRange(world) {
    const local = world.localPlayer;
    if (!local?.alive) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(160,212,255,0.28)';
    ctx.fillStyle = 'rgba(160,212,255,0.06)';
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(local.x, local.y, ABILITY_RANGE, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(216,236,255,0.8)';
    ctx.font = 'bold 9px "Courier New", monospace';
    ctx.textAlign = 'center';
    const abilityLabel = local.abilityName ? local.abilityName.toUpperCase() : 'ABILITY';
    ctx.fillText(`${abilityLabel} RANGE`, local.x, local.y - ABILITY_RANGE - 10);
    ctx.restore();
  }

  _drawDamageNumbers(numbers) {
    if (!numbers?.length) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 14px "Courier New", monospace';
    for (const number of numbers) {
      const alpha = Math.max(0, Math.min(1, number.ttl / 0.9));
      ctx.fillStyle = withAlpha(number.color ?? '#ffd966', 0.25 + alpha * 0.75);
      ctx.shadowBlur = 12;
      ctx.shadowColor = number.color ?? '#ffd966';
      ctx.fillText(String(number.value), number.x, number.y);
    }
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  _drawCommandIndicators(world) {
    const ctx = this.ctx;
    const local = world.localPlayer;
    const target = world.focusedEnemy;

    if (world.rallySignal) {
      const signal = world.rallySignal;
      const pulse = 0.55 + 0.25 * Math.sin(this.time * 8);
      ctx.save();
      ctx.strokeStyle = `rgba(74,168,255,${pulse})`;
      ctx.fillStyle = `rgba(74,168,255,${0.14 + pulse * 0.12})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 8]);
      ctx.beginPath();
      ctx.arc(signal.x, signal.y, signal.radius * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(180,220,255,0.85)';
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('RALLY', signal.x, signal.y - signal.radius * 0.4 - 10);
      ctx.restore();
    }

    if (world.minimapPins) {
      for (const pin of world.minimapPins) {
        const style = this._pinStyle(pin.type);
        const pulse = 0.45 + 0.3 * Math.sin(this.time * 7 + pin.x * 0.01);
        ctx.save();
        ctx.strokeStyle = withAlpha(style.color, 0.45 + pulse * 0.35);
        ctx.fillStyle = withAlpha(style.color, 0.10 + pulse * 0.10);
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 10]);
        ctx.beginPath();
        ctx.arc(pin.x, pin.y, pin.radius * 0.38, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = withAlpha(style.color, 0.95);
        ctx.font = 'bold 11px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(style.glyph, pin.x, pin.y + 4);
        ctx.font = 'bold 9px "Courier New", monospace';
        ctx.fillText(style.label, pin.x, pin.y - pin.radius * 0.38 - 10);
        ctx.restore();
      }
    }

    if (local?.alive && target?.alive) {
      const dx = target.x - local.x;
      const dy = target.y - local.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = dx / len;
      const ny = dy / len;
      const arrowX = local.x + nx * Math.min(54, len * 0.45);
      const arrowY = local.y + ny * Math.min(54, len * 0.45);
      const targetColor = FACTIONS[target.faction].color;
      const pulse = 0.55 + 0.35 * Math.sin(this.time * 7);

      ctx.save();
      ctx.strokeStyle = withAlpha(targetColor, 0.35 + pulse * 0.25);
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 10]);
      ctx.beginPath();
      ctx.moveTo(local.x, local.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.translate(arrowX, arrowY);
      ctx.rotate(Math.atan2(dy, dx));
      ctx.fillStyle = withAlpha(targetColor, 0.9);
      ctx.shadowBlur = 14;
      ctx.shadowColor = targetColor;
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(-6, -8);
      ctx.lineTo(-2, 0);
      ctx.lineTo(-6, 8);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = withAlpha(targetColor, 0.5 + pulse * 0.35);
      ctx.lineWidth = 2;
      ctx.shadowBlur = 16;
      ctx.shadowColor = targetColor;
      ctx.beginPath();
      ctx.arc(target.x, target.y, PLAYER_RADIUS + 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = withAlpha(targetColor, 0.95);
      ctx.font = 'bold 9px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('TARGET', target.x, target.y - PLAYER_RADIUS - 18);
      ctx.restore();
    }

    const spectated = world.spectatorTarget;
    if (!world.spectatorMode || !spectated?.alive) return;

    const f = FACTIONS[spectated.faction];
    const pulse = 0.45 + 0.3 * Math.sin(this.time * 6);
    ctx.save();
    ctx.strokeStyle = withAlpha(f.color, 0.45 + pulse * 0.4);
    ctx.lineWidth = 2.5;
    ctx.shadowBlur = 18;
    ctx.shadowColor = f.color;
    ctx.beginPath();
    ctx.arc(spectated.x, spectated.y, PLAYER_RADIUS + 13, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = withAlpha(f.color, 0.95);
    ctx.font = 'bold 9px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(
      world.getCameraState?.().mode === 'follow' ? 'FOLLOW CAM' : 'SPECTATE',
      spectated.x,
      spectated.y - PLAYER_RADIUS - 20,
    );
    ctx.restore();
  }

  // ── Chaos event visual effects ──────────────────────────────────────────

  _drawChaosEvent(world) {
    const event = world.chaosEvent;
    if (!event) return;

    const ctx = this.ctx;
    const t = this.time;

    if (event.type === 'emp_storm') {
      // Pulsing yellow/white EMP zone circle
      const pulse = 0.4 + 0.3 * Math.sin(t * 5);
      ctx.save();

      // Outer warning ring
      ctx.strokeStyle = `rgba(255,204,0,${pulse * 0.6})`;
      ctx.lineWidth = 3;
      ctx.shadowBlur = 20;
      ctx.shadowColor = '#ffcc00';
      ctx.setLineDash([8, 6]);
      ctx.lineDashOffset = -t * 40;
      ctx.beginPath();
      ctx.arc(event.x, event.y, event.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Inner EMP field fill
      const grad = ctx.createRadialGradient(event.x, event.y, 0, event.x, event.y, event.radius);
      grad.addColorStop(0, `rgba(255,204,0,${0.08 + pulse * 0.05})`);
      grad.addColorStop(0.7, `rgba(255,204,0,${0.04 + pulse * 0.03})`);
      grad.addColorStop(1, 'rgba(255,204,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(event.x, event.y, event.radius, 0, Math.PI * 2);
      ctx.fill();

      // Static-noise crackles inside zone
      ctx.globalAlpha = pulse * 0.4;
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2 + t * 3;
        const r = event.radius * (0.3 + 0.5 * Math.random());
        const cx = event.x + Math.cos(angle) * r;
        const cy = event.y + Math.sin(angle) * r;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx - 4, cy);
        ctx.lineTo(cx + 4, cy + (Math.random() - 0.5) * 8);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Label
      ctx.shadowBlur = 0;
      ctx.fillStyle = `rgba(255,204,0,${0.6 + pulse * 0.3})`;
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('⚡ EMP STORM', event.x, event.y - event.radius - 8);

      ctx.restore();

    } else if (event.type === 'crystal_rain') {
      if (this.lowQuality) return;
      // Shimmer overlay across the whole screen
      const W = world.width, H = world.height;
      const pulse = 0.3 + 0.2 * Math.sin(t * 3);
      ctx.save();

      // Faint full-screen blue shimmer
      ctx.fillStyle = `rgba(160,212,255,${0.03 + pulse * 0.02})`;
      ctx.fillRect(0, 0, W, H);

      // Falling sparkles (decorative, not actual crystals)
      ctx.globalAlpha = 0.7;
      for (let i = 0; i < 20; i++) {
        const sx = ((i * 73.7 + t * 30) % W);
        const sy = ((i * 137.3 + t * 80 + i * 20) % (H + 40)) - 20;
        const sparkPulse = 0.5 + 0.5 * Math.sin(t * 6 + i);
        const size = 2 + sparkPulse * 2;
        ctx.shadowBlur = 8;
        ctx.shadowColor = '#a0d4ff';
        ctx.fillStyle = `rgba(180,220,255,${sparkPulse * 0.7})`;
        ctx.beginPath();
        // Small diamond shape
        ctx.moveTo(sx, sy - size);
        ctx.lineTo(sx + size * 0.6, sy);
        ctx.lineTo(sx, sy + size);
        ctx.lineTo(sx - size * 0.6, sy);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      ctx.restore();

    } else if (event.type === 'nexus_overload') {
      // Red/magenta warning flicker on all bases — shields down
      const pulse = 0.3 + 0.4 * Math.sin(t * 8);
      ctx.save();
      for (const base of Object.values(world.bases)) {
        // Broken shield ring (dashed, red/magenta)
        ctx.strokeStyle = `rgba(255,102,255,${pulse * 0.5})`;
        ctx.lineWidth = 2;
        ctx.shadowBlur = 14;
        ctx.shadowColor = '#ff66ff';
        ctx.setLineDash([4, 8]);
        ctx.lineDashOffset = -t * 50;
        ctx.beginPath();
        ctx.arc(base.x, base.y, BASE_RADIUS + 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // "SHIELD DOWN" label
        ctx.shadowBlur = 0;
        ctx.fillStyle = `rgba(255,102,255,${0.5 + pulse * 0.4})`;
        ctx.font = 'bold 8px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('SHIELD DOWN', base.x, base.y - BASE_RADIUS - 18);
      }
      ctx.restore();
    } else if (event.type === 'data_storm') {
      const W = world.width;
      const H = world.height;
      const pulse = 0.35 + 0.25 * Math.sin(t * 9);
      ctx.save();
      ctx.fillStyle = `rgba(10,28,40,${0.08 + pulse * 0.05})`;
      ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 42; i++) {
        const y = (i * 31 + t * 80) % H;
        const offset = Math.sin(t * 14 + i) * 18;
        ctx.fillStyle = i % 5 === 0
          ? `rgba(255,92,138,${0.05 + pulse * 0.04})`
          : `rgba(125,242,255,${0.04 + pulse * 0.04})`;
        ctx.fillRect(offset, y, W - Math.abs(offset) * 0.5, 3);
      }
      for (let i = 0; i < 24; i++) {
        const blockW = 40 + (i % 4) * 24;
        const blockH = 6 + (i % 3) * 3;
        const x = (i * 97 + t * 120) % (W + blockW) - blockW;
        const y = (i * 53 + t * 65) % H;
        ctx.fillStyle = i % 2 === 0
          ? `rgba(125,242,255,${0.10 + pulse * 0.05})`
          : `rgba(255,255,255,${0.06 + pulse * 0.04})`;
        ctx.fillRect(x, y, blockW, blockH);
      }
      ctx.fillStyle = `rgba(255,255,255,${0.04 + pulse * 0.03})`;
      for (let y = 0; y < H; y += 5) {
        ctx.fillRect(0, y, W, 1);
      }
      ctx.restore();
    }
  }

  _drawZoneCollapse(world) {
    const zone = world.zoneCollapse;
    if (!zone?.active) return;

    const ctx = this.ctx;
    const t = this.time;
    const pulse = 0.45 + 0.3 * Math.sin(t * 6);
    const radius = zone.currentRadius;
    const cx = zone.centerX;
    const cy = zone.centerY;

    ctx.save();
    ctx.fillStyle = `rgba(255,68,68,${0.08 + pulse * 0.06})`;
    ctx.beginPath();
    ctx.rect(0, 0, world.width, world.height);
    ctx.arc(cx, cy, radius, 0, Math.PI * 2, true);
    ctx.fill('evenodd');

    ctx.strokeStyle = `rgba(255,120,120,${0.55 + pulse * 0.25})`;
    ctx.lineWidth = 4;
    ctx.shadowBlur = 20;
    ctx.shadowColor = '#ff6a6a';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 1.4;
    ctx.shadowBlur = 0;
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2 + t * 0.7;
      const arcX = cx + Math.cos(angle) * radius;
      const arcY = cy + Math.sin(angle) * radius;
      const tangentAngle = angle + Math.PI / 2;
      const length = 12 + 4 * Math.sin(t * 10 + i);
      ctx.strokeStyle = i % 2 === 0
        ? `rgba(255,220,220,${0.42 + pulse * 0.2})`
        : `rgba(120,220,255,${0.28 + pulse * 0.16})`;
      ctx.beginPath();
      ctx.moveTo(
        arcX - Math.cos(tangentAngle) * length,
        arcY - Math.sin(tangentAngle) * length,
      );
      ctx.lineTo(
        arcX + Math.cos(tangentAngle) * length,
        arcY + Math.sin(tangentAngle) * length,
      );
      ctx.stroke();
    }

    if (!this.lowQuality) {
      ctx.globalAlpha = 0.3 + pulse * 0.18;
      for (let i = 0; i < 28; i++) {
        const angle = (i * 0.61) + t * 0.9;
        const noiseRadius = radius + 16 + (i % 5) * 18;
        const px = cx + Math.cos(angle) * noiseRadius;
        const py = cy + Math.sin(angle) * noiseRadius;
        ctx.fillStyle = i % 3 === 0 ? '#ffd3d3' : '#ff7a7a';
        ctx.fillRect(px, py, 3 + (i % 2), 1.5 + (i % 3));
      }
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = `rgba(255,210,210,${0.72 + pulse * 0.2})`;
    ctx.font = 'bold 10px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('ZONE COLLAPSE', cx, cy - radius - 12);
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

  // ── Victory overlay ────────────────────────────────────────────────────────

  _drawVictoryOverlay(world) {
    const ctx = this.ctx;
    const W = world.width;
    const H = world.height;
    const faction = world.winnerFaction;
    if (!faction) return;

    const f = FACTIONS[faction];
    const { r, g, b } = hexToRgb(f.color);

    // Time remaining in victory (5s total), used to drive flash intensity
    const t = world.victoryTimer;  // 5 → 0
    // Flash is bright at the start, fading over the first 2 seconds
    const flashAlpha = Math.max(0, Math.min(0.45, (t - 3) * 0.225));

    ctx.save();

    // Full-screen faction-coloured flash
    if (flashAlpha > 0) {
      ctx.fillStyle = `rgba(${r},${g},${b},${flashAlpha})`;
      ctx.fillRect(0, 0, W, H);
    }

    // Persistent tinted overlay
    ctx.fillStyle = `rgba(${r},${g},${b},0.12)`;
    ctx.fillRect(0, 0, W, H);

    // "VICTORY" text with glow
    const pulse = 0.85 + 0.15 * Math.sin(this.time * 4);
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowBlur   = 40;
    ctx.shadowColor  = f.color;
    ctx.fillStyle    = `rgba(${r},${g},${b},${pulse})`;
    ctx.font         = `bold ${Math.min(W * 0.12, 120)}px "Courier New", monospace`;
    ctx.fillText('VICTORY', W / 2, H / 2 - 30);

    // Winner faction name
    ctx.shadowBlur  = 20;
    ctx.font        = `bold ${Math.min(W * 0.04, 36)}px "Courier New", monospace`;
    ctx.fillStyle   = `rgba(255,255,255,0.85)`;
    ctx.fillText(f.name.toUpperCase(), W / 2, H / 2 + 30);

    // Post-match status
    ctx.shadowBlur  = 0;
    ctx.font        = `${Math.min(W * 0.025, 20)}px "Courier New", monospace`;
    ctx.fillStyle   = 'rgba(255,255,255,0.55)';
    const statusText = world.replay?.hasReplay
      ? 'Replay ready — use the timeline controls below'
      : `Restarting in ${Math.ceil(Math.max(0, t))}s`;
    ctx.fillText(statusText, W / 2, H / 2 + 70);

    ctx.restore();
  }

  // ── TriLock (capturable base) ───────────────────────────────────────────

  _drawTriLock(tl, world) {
    const ctx = this.ctx;
    const R = BASE_RADIUS * 0.8;  // slightly smaller than home bases
    const owned = tl.faction !== null;
    const f = owned ? FACTIONS[tl.faction] : null;
    const color = owned ? f.color : '#888888';
    const { r, g, b } = hexToRgb(color);
    const shieldsDown = world?.chaosEvent?.type === 'nexus_overload';
    const highValue = (tl.highValueMultiplier ?? 1) > 1;

    ctx.save();

    // Outer glow
    const glow = ctx.createRadialGradient(tl.x, tl.y, R * 0.3, tl.x, tl.y, R * 2);
    glow.addColorStop(0, `rgba(${r},${g},${b},0.12)`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(tl.x, tl.y, R * 2, 0, Math.PI * 2);
    ctx.fill();

    // Platform (hexagonal for TriLock)
    const sides = 6;
    ctx.fillStyle = `rgba(${r},${g},${b},0.10)`;
    ctx.strokeStyle = `rgba(${r},${g},${b},0.40)`;
    ctx.lineWidth = 2;
    if (!shieldsDown && owned) {
      ctx.shadowBlur = 12;
      ctx.shadowColor = color;
    }
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
      const px = tl.x + Math.cos(angle) * R;
      const py = tl.y + Math.sin(angle) * R;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    if (highValue) {
      const dataPulse = 0.55 + 0.35 * Math.sin(this.time * 6 + tl.shieldPulse);
      ctx.strokeStyle = `rgba(125,242,255,${0.45 + dataPulse * 0.3})`;
      ctx.lineWidth = 3;
      ctx.shadowBlur = 18;
      ctx.shadowColor = '#7df2ff';
      ctx.setLineDash([8, 5]);
      ctx.lineDashOffset = -this.time * 42;
      ctx.beginPath();
      ctx.arc(tl.x, tl.y, R + 14 + 2 * Math.sin(this.time * 5), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Capture progress ring
    const progress = (tl.captureProgress ?? 0) / 100;
    if (progress > 0 && progress < 1) {
      const capColor = tl.captureFaction ? FACTIONS[tl.captureFaction]?.color ?? '#fff' : '#fff';
      const cr = hexToRgb(capColor);
      ctx.strokeStyle = `rgba(${cr.r},${cr.g},${cr.b},0.7)`;
      ctx.lineWidth = 4;
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(tl.x, tl.y, R + 6, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.stroke();
    }

    // Level indicator
    ctx.shadowBlur = 0;
    ctx.fillStyle = color;
    ctx.font = 'bold 10px "Courier New", monospace';
    ctx.textAlign = 'center';
    const trilockLabel = tl.level > 0 ? `TRILOCK Lv${tl.level}` : 'TRILOCK';
    ctx.fillText(trilockLabel, tl.x, tl.y + R + 18);

    // Faction name (if captured)
    if (owned) {
      ctx.font = '8px "Courier New", monospace';
      ctx.fillStyle = `rgba(${r},${g},${b},0.6)`;
      ctx.fillText(f.name.toUpperCase(), tl.x, tl.y + R + 30);
    } else {
      ctx.font = '8px "Courier New", monospace';
      ctx.fillStyle = 'rgba(136,136,136,0.5)';
      ctx.fillText('NEUTRAL', tl.x, tl.y + R + 30);
    }

    // Jewel stored counter
    if (tl.crystalsStored > 0) {
      ctx.fillStyle = color;
      ctx.font = 'bold 11px "Courier New", monospace';
      ctx.fillText(`💎 ×${tl.crystalsStored}`, tl.x, tl.y - R - 10);
    }

    if (highValue) {
      ctx.fillStyle = '#7df2ff';
      ctx.font = 'bold 8px "Courier New", monospace';
      ctx.fillText(`HIGH VALUE ×${tl.highValueMultiplier ?? 1}`, tl.x, tl.y - R - 22);
    }

    ctx.restore();
  }

  _drawNexusGuardian(guardian) {
    const ctx = this.ctx;
    const pulse = 0.5 + 0.25 * Math.sin(this.time * 2.8);
    const R = guardian.radius;

    ctx.save();

    const glow = ctx.createRadialGradient(guardian.x, guardian.y, R * 0.2, guardian.x, guardian.y, R * 2.7);
    glow.addColorStop(0, `rgba(125,230,255,${0.28 + pulse * 0.18})`);
    glow.addColorStop(0.5, 'rgba(110,190,255,0.14)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(guardian.x, guardian.y, R * 2.7, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `rgba(125,230,255,${0.35 + pulse * 0.25})`;
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = -this.time * 30;
    ctx.beginPath();
    ctx.arc(guardian.x, guardian.y, guardian.arenaRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(110,180,220,0.18)';
    ctx.strokeStyle = 'rgba(160,245,255,0.75)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(guardian.x, guardian.y - R);
    ctx.lineTo(guardian.x + R * 0.7, guardian.y - R * 0.15);
    ctx.lineTo(guardian.x + R * 0.55, guardian.y + R * 0.75);
    ctx.lineTo(guardian.x - R * 0.55, guardian.y + R * 0.75);
    ctx.lineTo(guardian.x - R * 0.7, guardian.y - R * 0.15);
    ctx.closePath();
    ctx.shadowBlur = 24;
    ctx.shadowColor = '#7de6ff';
    ctx.fill();
    ctx.stroke();

    const core = ctx.createRadialGradient(guardian.x, guardian.y, R * 0.05, guardian.x, guardian.y, R * 0.55);
    core.addColorStop(0, 'rgba(255,255,255,0.95)');
    core.addColorStop(0.4, `rgba(160,250,255,${0.85 + pulse * 0.1})`);
    core.addColorStop(1, 'rgba(20,80,120,0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(guardian.x, guardian.y, R * 0.55, 0, Math.PI * 2);
    ctx.fill();

    const hpPct = Math.max(0, guardian.health / Math.max(1, guardian.maxHealth));
    const barW = 150;
    const barH = 9;
    const barX = guardian.x - barW / 2;
    const barY = guardian.y - guardian.arenaRadius - 24;
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(0,8,18,0.8)';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.strokeStyle = 'rgba(125,230,255,0.55)';
    ctx.strokeRect(barX, barY, barW, barH);
    ctx.fillStyle = 'rgba(125,230,255,0.9)';
    ctx.fillRect(barX + 1, barY + 1, (barW - 2) * hpPct, barH - 2);

    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#c6f8ff';
    ctx.fillText('NEXUS GUARDIAN', guardian.x, barY - 8);

    ctx.restore();
  }

  // ── Match timer (centre top, rendered on canvas for visibility) ────────

  _drawMatchTimer(world, W, H) {
    const finiteTimer = Number.isFinite(world.matchTimer ?? 0);
    const safeTimer = finiteTimer ? Math.max(0, world.matchTimer ?? 0) : 999;
    const mins = Math.floor(safeTimer / 60);
    const secs = Math.floor(safeTimer % 60);
    const text = finiteTimer
      ? `${mins}:${secs.toString().padStart(2, '0')}`
      : (world.config?.gameMode === 'tutorial' ? 'TUTORIAL' : 'FREEPLAY');
    const t = safeTimer;

    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const urgent = t < 30;
    ctx.fillStyle = urgent ? 'rgba(255,68,68,0.8)' : 'rgba(200,220,255,0.35)';
    ctx.font = `bold ${urgent ? 18 : 14}px "Courier New", monospace`;
    if (urgent) {
      ctx.shadowBlur = 10;
      ctx.shadowColor = '#ff4444';
    }
    ctx.fillText(text, W / 2, 6);
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  _drawVignette(W, H) {
    const ctx  = this.ctx;
    const grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.85);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, this.lowQuality ? 'rgba(0,0,0,0.48)' : 'rgba(0,0,0,0.62)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  // ── Minimap ───────────────────────────────────────────────────────────────

  _drawMinimap(world, W, H) {
    const ctx    = this.ctx;
    const mapW   = 160;
    const mapH   = 110;
    const margin = 12;
    // Bottom-right HUD ability panel is ~104 px tall + 18 px CSS bottom offset
    const ABILITY_PANEL_CLEARANCE = 140;
    const x0     = W - mapW - margin;
    const y0     = H - mapH - ABILITY_PANEL_CLEARANCE;
    const wW     = world.width;
    const wH     = world.height;
    const local  = world.localPlayer;
    const visionRadius = local?.passiveState?.minimapVisionRadius ?? 240;
    const filters = world.hud?.getMinimapFilters?.() ?? {
      agents: { blue: true, green: true, red: true },
      crystals: true,
      chaosZones: true,
    };
    const agentFilters = filters.agents ?? { blue: true, green: true, red: true };
    const localBaseAlert = local?.faction ? world.baseAttackAlerts?.[local.faction] : null;
    const alertPulse = 0.35 + 0.3 * Math.sin(this.time * 10);
    this.minimapBounds = { x: x0, y: y0, width: mapW, height: mapH };

    // Map world coordinates → minimap pixel coordinates
    const mx = (wx) => x0 + (wx / wW) * mapW;
    const my = (wy) => y0 + (wy / wH) * mapH;
    const isVisible = (wx, wy, faction = null) => {
      if (!local?.alive) return true;
      if (faction === local.faction) return true;
      return Math.hypot(wx - local.x, wy - local.y) <= visionRadius;
    };

    ctx.save();

    // ── Background panel ─────────────────────────────────────────────────
    ctx.fillStyle   = localBaseAlert?.active
      ? `rgba(40,6,12,${0.72 + alertPulse * 0.08})`
      : 'rgba(2,8,20,0.72)';
    ctx.strokeStyle = localBaseAlert?.active
      ? `rgba(255,68,68,${0.45 + alertPulse * 0.45})`
      : 'rgba(80,140,255,0.30)';
    ctx.lineWidth   = 1;
    ctx.fillRect(x0, y0, mapW, mapH);
    ctx.strokeRect(x0, y0, mapW, mapH);

    // Clip subsequent drawing to the minimap rectangle
    ctx.beginPath();
    ctx.rect(x0, y0, mapW, mapH);
    ctx.clip();

    const minimapJammed = world.chaosEvent?.type === 'data_storm';

    if (minimapJammed) {
      const pulse = 0.35 + 0.25 * Math.sin(this.time * 10);
      ctx.save();
      ctx.fillStyle = `rgba(10,26,38,${0.82 + pulse * 0.08})`;
      ctx.fillRect(x0, y0, mapW, mapH);
      for (let i = 0; i < 22; i++) {
        const lineY = y0 + ((i * 19 + this.time * 46) % mapH);
        const glitchX = x0 + ((i * 31) % 18);
        ctx.fillStyle = i % 3 === 0
          ? `rgba(125,242,255,${0.10 + pulse * 0.08})`
          : `rgba(255,255,255,${0.05 + pulse * 0.06})`;
        ctx.fillRect(glitchX, lineY, mapW - ((i * 17) % 24), 2);
      }
      for (let i = 0; i < 28; i++) {
        const px = x0 + ((i * 47 + this.time * 70) % mapW);
        const py = y0 + ((i * 29 + this.time * 95) % mapH);
        const size = 1 + (i % 3);
        ctx.fillStyle = i % 4 === 0
          ? 'rgba(255,92,138,0.22)'
          : 'rgba(125,242,255,0.18)';
        ctx.fillRect(px, py, size * 2, size);
      }
      ctx.restore();
    } else if (filters.chaosZones && (world.chaosEvent || world.zoneCollapse?.active)) {
      const event = world.chaosEvent;
      const pulse = 0.15 + 0.18 * Math.sin(this.time * 8);
      ctx.save();
      if (world.zoneCollapse?.active) {
        const zone = world.zoneCollapse;
        ctx.strokeStyle = withAlpha('#ff6666', 0.45 + pulse);
        ctx.fillStyle = withAlpha('#ff6666', 0.08 + pulse * 0.16);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(mx(zone.centerX), my(zone.centerY), (zone.currentRadius / wW) * mapW, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (event.type === 'emp_storm') {
        ctx.strokeStyle = withAlpha(event.color, 0.5 + pulse);
        ctx.fillStyle = withAlpha(event.color, pulse * 0.45);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(mx(event.x), my(event.y), (event.radius / wW) * mapW, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.strokeStyle = withAlpha(event.color, 0.45 + pulse);
        ctx.fillStyle = withAlpha(event.color, 0.08 + pulse * 0.18);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x0 + 3, y0 + 3, mapW - 6, mapH - 6);
        ctx.fillRect(x0 + 3, y0 + 3, mapW - 6, mapH - 6);
      }
      ctx.restore();
    }

    if (!minimapJammed) {
      // ── Home bases (large dots) ────────────────────────────────────────
      for (const base of Object.values(world.bases)) {
        const f = FACTIONS[base.faction];
        const { r, g, b } = hexToRgb(f.color);
        ctx.fillStyle   = `rgba(${r},${g},${b},0.95)`;
        ctx.shadowBlur  = 8;
        ctx.shadowColor = f.color;
        ctx.beginPath();
        ctx.arc(mx(base.x), my(base.y), 5, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── TriLock bases (medium dots) ────────────────────────────────────
      if (world.trilocks) {
        for (const tl of world.trilocks) {
          if (!isVisible(tl.x, tl.y, tl.faction)) continue;
          const color = tl.faction ? FACTIONS[tl.faction].color : '#666677';
          const { r, g, b } = hexToRgb(color);
          ctx.fillStyle  = `rgba(${r},${g},${b},0.75)`;
          ctx.shadowBlur = 4;
          ctx.shadowColor = color;
          ctx.beginPath();
          ctx.arc(mx(tl.x), my(tl.y), 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (world.nexusGuardian?.state === 'active') {
        const guardian = world.nexusGuardian;
        const px = mx(guardian.x);
        const py = my(guardian.y);
        const pulse = 0.45 + 0.35 * Math.sin(this.time * 8);
        ctx.strokeStyle = `rgba(160,250,255,${0.55 + pulse * 0.3})`;
        ctx.fillStyle = 'rgba(160,250,255,0.95)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(px, py - 5);
        ctx.lineTo(px + 5, py);
        ctx.lineTo(px, py + 5);
        ctx.lineTo(px - 5, py);
        ctx.closePath();
        ctx.stroke();
        ctx.fill();
      }

      // ── Crystals (white, blinking) ──────────────────────────────────────
      if (filters.crystals) {
        const blinkAlpha = 0.55 + 0.45 * Math.sin(this.time * 5);
        for (const crystal of world.crystals) {
          if (crystal.delivered) continue;
          if (!isVisible(crystal.x, crystal.y)) continue;
          const tColor = crystal.tierColor ?? '#a0d4ff';
          const { r, g, b } = hexToRgb(tColor);
          ctx.fillStyle  = `rgba(255,255,255,${blinkAlpha})`;
          ctx.shadowBlur = 4;
          ctx.shadowColor = `rgba(${r},${g},${b},0.8)`;
          ctx.beginPath();
          ctx.arc(mx(crystal.x), my(crystal.y), 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ── Agents (small faction-coloured dots) ────────────────────────────
      for (const player of world.players) {
        if (!player.alive) continue;
        if (!isVisible(player.x, player.y, player.faction)) continue;
        if (!agentFilters[player.faction]) continue;
        const f = FACTIONS[player.faction];
        const { r, g, b } = hexToRgb(f.color);
        ctx.fillStyle  = `rgba(${r},${g},${b},0.95)`;
        ctx.shadowBlur = 3;
        ctx.shadowColor = f.color;
        ctx.beginPath();
        ctx.arc(mx(player.x), my(player.y), 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      if (world.recentDeaths) {
        for (const marker of world.recentDeaths) {
          if (!isVisible(marker.x, marker.y, marker.faction)) continue;
          const alpha = Math.min(1, marker.timer / 1.5);
          ctx.strokeStyle = `rgba(255,90,90,${alpha})`;
          ctx.lineWidth = 1.2;
          const px = mx(marker.x);
          const py = my(marker.y);
          ctx.beginPath();
          ctx.moveTo(px - 3, py - 3);
          ctx.lineTo(px + 3, py + 3);
          ctx.moveTo(px + 3, py - 3);
          ctx.lineTo(px - 3, py + 3);
          ctx.stroke();
        }
      }

      if (world.minimapPins) {
        for (const pin of world.minimapPins) {
          const style = this._pinStyle(pin.type);
          const pulse = 0.45 + 0.35 * Math.sin(this.time * 8 + pin.y * 0.01);
          const px = mx(pin.x);
          const py = my(pin.y);
          ctx.strokeStyle = withAlpha(style.color, 0.45 + pulse * 0.35);
          ctx.fillStyle = withAlpha(style.color, 0.9);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(px, py, 4.5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.font = 'bold 7px "Courier New", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(style.glyph, px, py + 2.5);
        }
      }
    }

    ctx.shadowBlur = 0;
    ctx.restore();

    // ── "MAP" label (outside clip region) ────────────────────────────────
    ctx.save();
    ctx.fillStyle    = 'rgba(80,140,255,0.50)';
    ctx.font         = 'bold 7px "Courier New", monospace';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(minimapJammed ? 'MAP JAMMED' : (localBaseAlert?.active ? 'MAP ALERT' : 'MAP'), x0 + 4, y0 + 3);
    if (minimapJammed) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(125,242,255,0.75)';
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.fillText('SIGNAL LOST', x0 + mapW / 2, y0 + mapH / 2);
    } else if (local?.alive) {
      const revealRadius = (visionRadius / wW) * mapW;
      ctx.strokeStyle = withAlpha(FACTIONS[local.faction].color, 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(mx(local.x), my(local.y), Math.max(10, revealRadius), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  getSelectedPinType() {
    return this._selectedPinType;
  }

  _pinStyle(type) {
    return {
      gather: { color: '#4aa8ff', glyph: '⌁', label: 'GROUP' },
      danger: { color: '#ff4444', glyph: '!', label: 'DANGER' },
      crystal: { color: '#ffd700', glyph: '◆', label: 'CRYSTAL' },
    }[type] ?? { color: '#4aa8ff', glyph: '⌁', label: 'GROUP' };
  }
}
