/**
 * hud.js
 * Manages all DOM-based HUD elements.
 * Scores, health/energy bars, ability cooldowns, event feed, crystal counter.
 */

const MAX_FEED_ITEMS = 6;
const FEED_TTL       = 3500; // ms

export class HUD {
  constructor() {
    this._scoreEls   = {};
    this._feedItems  = [];
    this._init();
  }

  // ── Build DOM ─────────────────────────────────────────────────────────────

  _init() {
    const hud = document.getElementById('hud');

    // ── Score panel ──────────────────────────────────────────────────────

    const scorePanel = document.getElementById('score-panel');
    if (!scorePanel) return;

    const factions = ['blue', 'green', 'red'];
    const names    = ['THE ARCHIVE', 'LIFE FORGE', 'CORE PROTOCOL'];
    factions.forEach((f, i) => {
      if (i > 0) {
        const div = document.createElement('span');
        div.className = 'score-divider';
        div.textContent = '|';
        scorePanel.appendChild(div);
      }
      const block = document.createElement('div');
      block.className = 'score-block';
      block.innerHTML = `
        <span class="score-label ${f}">${names[i]}</span>
        <span class="score-value ${f}" id="score-${f}">0</span>
      `;
      scorePanel.appendChild(block);
      this._scoreEls[f] = block.querySelector(`#score-${f}`);
    });

    // ── Faction legend ────────────────────────────────────────────────────

    const legend = document.getElementById('faction-legend');
    if (!legend) return;
    const roles  = ['Data Sniper ×5', 'Bio Guard ×5', 'Core Striker ×5'];
    factions.forEach((f, i) => {
      const row = document.createElement('div');
      row.className = 'legend-row';
      row.innerHTML = `
        <div class="legend-dot ${f}"></div>
        <span class="${f}" style="opacity:0.85">${names[i]}</span>
        <span style="opacity:0.45;font-size:9px">&nbsp;— ${roles[i]}</span>
      `;
      legend.appendChild(row);
    });

    // ── Left status (local blue agent) ────────────────────────────────────

    const statusLeft = document.getElementById('status-left');
    statusLeft.innerHTML = `
      <div class="panel-title blue">AGENT STATUS — DATA SNIPER</div>
      ${this._barRow('❤️', 'HEALTH', 'health',  '100 / 100', 100, 'health')}
      ${this._barRow('⚡', 'ENERGY', 'energy',  '100 / 100', 100, 'energy')}
    `;

    // ── Right status (ability / cooldown) ─────────────────────────────────

    const statusRight = document.getElementById('status-right');
    statusRight.innerHTML = `
      <div class="panel-title blue">ABILITY — RAILSHOT</div>
      ${this._barRow('🎯', 'CHARGE', 'ability', '100%', 100, 'ability')}
      ${this._barRow('⏱', 'COOLDOWN', 'cooldown', '0.0s', 0, 'cooldown')}
    `;

    // ── Crystal counter ───────────────────────────────────────────────────

    const counter = document.getElementById('crystal-counter');
    counter.innerHTML = `
      <span class="gem">💎</span>
      <span style="opacity:0.55;font-size:9px;letter-spacing:2px">CRYSTALS ON FIELD:</span>
      <span id="crystal-count" style="color:#a0d4ff;font-weight:bold">—</span>
    `;

    // ── Next feature contract ──────────────────────────────────────────────

    const featureSpec = document.getElementById('feature-spec');
    if (featureSpec) {
      featureSpec.innerHTML = `
        <div class="panel-title blue">NEXT FEATURE CONTRACT</div>
        <div class="feature-line"><span>WHO</span><b id="feature-who">—</b></div>
        <div class="feature-line"><span>WHEN</span><b id="feature-when">—</b></div>
        <div class="feature-line"><span>WHAT</span><b id="feature-what">—</b></div>
        <div class="feature-line"><span>STATUS</span><b id="feature-status">PENDING</b></div>
      `;
    }
  }

  _barRow(icon, label, id, numText, pct, type) {
    return `
      <div class="stat-row">
        <div class="stat-icon">${icon}</div>
        <div class="stat-label">${label}</div>
        <div class="bar-track">
          <div class="bar-fill ${type}" id="bar-${id}" style="width:${pct}%"></div>
        </div>
        <div class="stat-num" id="num-${id}">${numText}</div>
      </div>
    `;
  }

  // ── Per-frame update ─────────────────────────────────────────────────────

  update(world) {
    // Scores
    for (const [f, el] of Object.entries(this._scoreEls)) {
      const s = world.scores[f] ?? 0;
      if (el.textContent !== String(s)) el.textContent = s;
    }

    // First blue player as "local player"
    const local = world.players.find(p => p.faction === 'blue');
    if (local) {
      this._setBar('health', local.health, local.maxHealth,
        `${Math.round(local.health)} / ${local.maxHealth}`);
      this._setBar('energy', local.energy, 100,
        `${Math.round(local.energy)} / 100`);

      const cdPct = local.cooldown > 0
        ? (local.cooldown / local.abilityMax) * 100
        : 0;
      const chargesPct = 100 - cdPct;
      this._setBar('ability', chargesPct, 100, `${Math.round(chargesPct)}%`);
      this._setBar('cooldown', cdPct, 100, `${local.cooldown.toFixed(1)}s`);
    }

    // Crystal counter
    const alive = world.crystals.filter(c => !c.delivered && !c.carrier).length;
    const countEl = document.getElementById('crystal-count');
    if (countEl) countEl.textContent = alive;

    // Feature contract
    this._updateFeature(world);

    // Event feed
    this._updateFeed(world);
  }

  _setBar(id, value, max, numText) {
    const bar = document.getElementById(`bar-${id}`);
    const num = document.getElementById(`num-${id}`);
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, (value / max) * 100))}%`;
    if (num) num.textContent = numText;
  }

  // ── Event feed ────────────────────────────────────────────────────────────

  _updateFeed(world) {
    const feedDiv = document.getElementById('event-feed');
    if (!feedDiv) return;

    // Consume new events from world
    while (world.events.length > 0) {
      const ev = world.events.shift();
      const el = document.createElement('div');
      el.className = `feed-item ${ev.faction}`;
      el.textContent = ev.text;
      feedDiv.prepend(el);
      this._feedItems.unshift({ el, born: Date.now() });

      // Trim
      while (this._feedItems.length > MAX_FEED_ITEMS) {
        const old = this._feedItems.pop();
        old.el.remove();
      }
    }

    // Fade out expired items
    const now = Date.now();
    this._feedItems = this._feedItems.filter(item => {
      const age = now - item.born;
      if (age > FEED_TTL) {
        item.el.remove();
        return false;
      }
      item.el.style.opacity = String(1 - (age / FEED_TTL) * 0.7);
      return true;
    });
  }

  _updateFeature(world) {
    const feature = world.nextFeature;
    if (!feature) return;
    const who = document.getElementById('feature-who');
    const when = document.getElementById('feature-when');
    const what = document.getElementById('feature-what');
    const status = document.getElementById('feature-status');

    if (who) who.textContent = feature.actor.toUpperCase();
    if (when) when.textContent = `SCORE ≥ ${feature.triggerScore}`;
    if (what) what.textContent = feature.action.toUpperCase();
    if (status) {
      status.textContent = feature.completed ? 'COMPLETED' : 'PENDING';
      status.className = feature.completed ? 'green' : 'blue';
    }
  }
}
