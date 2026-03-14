/**
 * hud.js
 * Manages all DOM-based HUD elements.
 * Scores, match timer, health/energy bars, ability cooldowns, event feed,
 * jewel counter, TriLock status, hate indicator.
 */

import { FACTIONS } from './entities.js';

const MAX_FEED_ITEMS = 6;
const FEED_TTL       = 3500; // ms

export class HUD {
  constructor() {
    this._scoreEls   = {};
    this._feedItems  = [];
    this._scoreboardEl = null;
    this._minimapFilters = {
      agents: { blue: true, green: true, red: true },
      crystals: true,
      chaosZones: true,
    };
    this._selectedPinType = 'gather';
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

    // ── Match timer (injected after score panel) ─────────────────────────
    const timerEl = document.createElement('div');
    timerEl.id = 'match-timer';
    timerEl.innerHTML = `<span id="timer-value">5:00</span>`;
    scorePanel.parentElement.insertBefore(timerEl, scorePanel.nextSibling);

    // ── Faction legend ────────────────────────────────────────────────────

    const legend = document.getElementById('faction-legend');
    if (!legend) return;
    const jobSummary = '⚔️War ·🔮Mag ·💚Heal ·💨Scout';
    factions.forEach((f, i) => {
      const row = document.createElement('div');
      row.className = 'legend-row';
      row.innerHTML = `
        <div class="legend-dot ${f}"></div>
        <span class="${f}" style="opacity:0.85">${names[i]}</span>
        <span style="opacity:0.45;font-size:9px">&nbsp;— ${jobSummary}</span>
      `;
      legend.appendChild(row);
    });

    const minimapControls = document.getElementById('minimap-controls');
    if (minimapControls) {
      minimapControls.innerHTML = `
        <div class="panel-title blue">MINIMAP TACTICS</div>
        <div class="minimap-section-label">FILTERS</div>
        <label class="minimap-toggle">
          <input type="checkbox" data-filter-group="agents" data-filter-key="blue" checked />
          <span class="blue">BLUE AGENTS</span>
        </label>
        <label class="minimap-toggle">
          <input type="checkbox" data-filter-group="agents" data-filter-key="green" checked />
          <span class="green">GREEN AGENTS</span>
        </label>
        <label class="minimap-toggle">
          <input type="checkbox" data-filter-group="agents" data-filter-key="red" checked />
          <span class="red">RED AGENTS</span>
        </label>
        <label class="minimap-toggle">
          <input type="checkbox" data-filter-group="root" data-filter-key="crystals" checked />
          <span>CRYSTAL SPAWNS</span>
        </label>
        <label class="minimap-toggle">
          <input type="checkbox" data-filter-group="root" data-filter-key="chaosZones" checked />
          <span>CHAOS ZONES</span>
        </label>
        <div class="minimap-section-label">PIN TYPE</div>
        <div class="pin-type-row">
          <button type="button" class="pin-type-button active" data-pin-type="gather">集合</button>
          <button type="button" class="pin-type-button" data-pin-type="danger">危険</button>
          <button type="button" class="pin-type-button" data-pin-type="crystal">クリスタル</button>
        </div>
        <div class="minimap-hint">CLICK THE MINIMAP TO ISSUE A TEAM PIN</div>
        <div class="minimap-alert-state" id="minimap-alert-state">STATUS — STANDBY</div>
      `;
      minimapControls.addEventListener('change', (event) => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement)) return;
        const group = input.dataset.filterGroup;
        const key = input.dataset.filterKey;
        if (!group || !key) return;
        if (group === 'agents') {
          this._minimapFilters.agents[key] = input.checked;
        } else {
          this._minimapFilters[key] = input.checked;
        }
      });
      minimapControls.addEventListener('click', (event) => {
        const button = event.target.closest('[data-pin-type]');
        if (!(button instanceof HTMLButtonElement)) return;
        this._selectedPinType = button.dataset.pinType ?? 'gather';
        for (const node of minimapControls.querySelectorAll('[data-pin-type]')) {
          node.classList.toggle('active', node === button);
        }
      });
      this._minimapControlsEl = minimapControls;
      this._minimapAlertEl = minimapControls.querySelector('#minimap-alert-state');
    }

    // ── Left status (local blue agent) ────────────────────────────────────

    const statusLeft = document.getElementById('status-left');
    statusLeft.innerHTML = `
      <div class="panel-title blue" id="status-title">AGENT STATUS — <span id="job-label">WARRIOR</span></div>
      ${this._barRow('❤️', 'HEALTH', 'health',  '130 / 130', 100, 'health')}
      ${this._barRow('⚡', 'ENERGY', 'energy',  '100 / 100', 100, 'energy')}
      <div class="stat-row" style="margin-top:2px">
        <div class="stat-icon">💎</div>
        <div class="stat-label">JEWELS</div>
        <div class="stat-num" id="carry-count" style="width:auto;font-size:11px;color:#ffd700">0 / 5</div>
      </div>
      <div class="panel-title blue" id="passive-title">PASSIVE — DATA CACHE</div>
      <div id="passive-state"></div>
    `;

    // ── Right status (ability / cooldown) ─────────────────────────────────

    const statusRight = document.getElementById('status-right');
    statusRight.innerHTML = `
      <div class="panel-title blue" id="ability-title">ABILITY — <span id="ability-label">POWER SLASH</span></div>
      ${this._barRow('🎯', 'CHARGE', 'ability', '100%', 100, 'ability')}
      ${this._barRow('⏱', 'COOLDOWN', 'cooldown', '0.0s', 0, 'cooldown')}
    `;

    // ── Crystal counter ───────────────────────────────────────────────────

    const counter = document.getElementById('crystal-counter');
    counter.innerHTML = `
      <span class="gem">💎</span>
      <span style="opacity:0.55;font-size:9px;letter-spacing:2px">JEWELS ON FIELD:</span>
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
        <div class="panel-title blue" style="margin-top:6px">NEXUS GUARDIAN</div>
        <div class="feature-line"><span>STATE</span><b id="guardian-status">SPAWN IN 2:00</b></div>
        <div class="feature-line"><span>VITALS</span><b id="guardian-vitals">OFFLINE</b></div>
        <div class="feature-line"><span>BLESSING</span><b id="guardian-blessing">—</b></div>
      `;
    }

    // ── Chaos event banner ─────────────────────────────────────────────
    const chaosBanner = document.getElementById('chaos-event-banner');
    if (chaosBanner) {
      chaosBanner.innerHTML = '';  // built dynamically in update
      this._chaosBannerEl = chaosBanner;
    }

    // ── Alliance indicator ────────────────────────────────────────────────
    const allianceEl = document.getElementById('alliance-indicator');
    if (allianceEl) {
      allianceEl.innerHTML = '';
      this._allianceEl = allianceEl;
    }

    // ── Match-end scoreboard ───────────────────────────────────────────────
    const scoreboard = document.getElementById('match-scoreboard');
    if (scoreboard) {
      scoreboard.innerHTML = `
        <div class="panel-title">MATCH RESULT</div>
        <div class="scoreboard-winner" id="scoreboard-winner">—</div>
        <div class="scoreboard-header">
          <span>FACTION</span><span>K</span><span>D</span><span>A</span><span>💎</span><span>PTS</span>
        </div>
        <div class="scoreboard-row"><span class="blue">THE ARCHIVE</span><span id="sb-blue-kills">0</span><span id="sb-blue-deaths">0</span><span id="sb-blue-assists">0</span><span id="sb-blue-crystals">0</span><span id="sb-blue-score">0</span></div>
        <div class="scoreboard-row"><span class="green">LIFE FORGE</span><span id="sb-green-kills">0</span><span id="sb-green-deaths">0</span><span id="sb-green-assists">0</span><span id="sb-green-crystals">0</span><span id="sb-green-score">0</span></div>
        <div class="scoreboard-row"><span class="red">CORE PROTOCOL</span><span id="sb-red-kills">0</span><span id="sb-red-deaths">0</span><span id="sb-red-assists">0</span><span id="sb-red-crystals">0</span><span id="sb-red-score">0</span></div>
      `;
      this._scoreboardEl = scoreboard;
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
    // Scores — highlight leading faction
    const leadFaction = world._leadingFaction?.();
    for (const [f, el] of Object.entries(this._scoreEls)) {
      const s = world.scores[f] ?? 0;
      if (el.textContent !== String(s)) el.textContent = s;
      // Hate indicator: pulsing glow on leading team score
      if (f === leadFaction) {
        el.style.textShadow = '0 0 14px currentColor, 0 0 28px currentColor, 0 0 42px currentColor';
        el.parentElement.classList.add('leading');
      } else {
        el.style.textShadow = '';
        el.parentElement.classList.remove('leading');
      }
    }

    // Match timer
    const timerVal = document.getElementById('timer-value');
    if (timerVal) {
      const t = Math.max(0, world.matchTimer ?? 0);
      const mins = Math.floor(t / 60);
      const secs = Math.floor(t % 60);
      timerVal.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
      // Urgent colour when <30s
      timerVal.style.color = t < 30 ? '#ff4444' : '#a0d4ff';
    }

    // First blue player as "local player"
    const local = world.localPlayer;
    if (local) {
      const statusTitle = document.getElementById('status-title');
      if (statusTitle) statusTitle.className = `panel-title ${local.faction}`;
      const abilityTitle = document.getElementById('ability-title');
      if (abilityTitle) abilityTitle.className = `panel-title ${local.faction}`;
      const passiveTitle = document.getElementById('passive-title');
      if (passiveTitle) {
        passiveTitle.className = `panel-title ${local.faction}`;
        passiveTitle.textContent = `PASSIVE — ${(local.passive?.name ?? 'NONE').toUpperCase()}`;
      }
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

      // Jewel carry count
      const carryEl = document.getElementById('carry-count');
      if (carryEl) carryEl.textContent = `${local.carrying.length} / 5`;

      // Job label
      const jobLabel = document.getElementById('job-label');
      if (jobLabel) jobLabel.textContent = (local.jobDef?.label ?? 'WARRIOR').toUpperCase();

      // Ability label
      const abilityLabel = document.getElementById('ability-label');
      if (abilityLabel) abilityLabel.textContent = (local.abilityName ?? 'SKILL').toUpperCase();

      this._updatePassive(local);
    }

    // Jewel counter
    const alive = world.crystals.filter(c => !c.delivered && !c.carrier).length;
    const countEl = document.getElementById('crystal-count');
    if (countEl) countEl.textContent = alive;

    // Feature contract
    this._updateFeature(world);
    this._updateGuardian(world);

    // Alliance indicator
    this._updateAlliance(world);

    // Event feed
    this._updateFeed(world);
    this._updateChaosEvent(world);
    this._updateScoreboard(world);
    this._updateMinimapStatus(world);
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
    const who = document.getElementById('feature-who');
    const when = document.getElementById('feature-when');
    const what = document.getElementById('feature-what');
    const status = document.getElementById('feature-status');

    if (!feature) {
      // All contracts fulfilled
      if (who) who.textContent = '—';
      if (when) when.textContent = '—';
      if (what) what.textContent = 'ALL CONTRACTS FULFILLED';
      if (status) { status.textContent = 'DONE'; status.className = 'feature-status-completed'; }
      return;
    }

    if (who) who.textContent = feature.actor.toUpperCase();
    if (when) when.textContent = `SCORE ≥ ${feature.triggerScore}`;
    if (what) what.textContent = feature.action.toUpperCase();
    if (status) {
      const buff = world.factionBuffs?.[feature.actor];
      if (feature.completed && buff) {
        status.textContent = `ACTIVE (${Math.ceil(buff.timer)}s)`;
      } else {
        status.textContent = feature.completed ? 'COMPLETED' : 'PENDING';
      }
      status.className = feature.completed
        ? 'feature-status-completed'
        : 'feature-status-pending';
    }
  }

  _updatePassive(local) {
    const passiveEl = document.getElementById('passive-state');
    if (!passiveEl) return;

    const def = FACTIONS[local.faction];
    const state = local.passiveState ?? {};
    let rows = [];

    if (local.passive?.id === 'data-cache') {
      const deliveryPct = Math.round(((local.passive.deliveryBonusMult ?? 1) - 1) * 100);
      rows = [
        this._passiveRow('📦', 'BASE BONUS', state.deliveryBonusActive ? `ACTIVE +${deliveryPct}%` : 'STANDBY'),
        this._passiveRow('🛰', 'SCAN', `${Math.round(state.minimapVisionRadius ?? 0)} PX`),
      ];
    } else if (local.passive?.id === 'bio-regen') {
      const regenPct = Math.round((local.passive.regenPctPerSec ?? 0) * 100);
      const healthBonusPct = Math.round((local.passive.allyMaxHealthBonus ?? 0) * 100);
      rows = [
        this._passiveRow('🧬', 'REGEN', state.bioRegenActive
          ? `ACTIVE ${regenPct}%/S`
          : `READY IN ${Math.ceil(state.bioRegenDelayRemaining ?? 0)}S`),
        this._passiveRow('🤝', 'ALLY LINK', state.nearbyAllyBonus ? `+${healthBonusPct}% HP` : 'NO BONUS'),
      ];
    } else if (local.passive?.id === 'overclock') {
      const sprintPct = Math.round(((local.passive.sprintSpeedMult ?? 1) - 1) * 100);
      rows = [
        this._passiveRow('⚙️', 'STACKS', `${state.overclockStacks ?? 0} / ${local.passive.maxStacks}`),
        this._passiveRow('🏃', 'SPRINT', state.sprintActive ? `+${sprintPct}% ACTIVE` : 'IDLE'),
      ];
    }

    passiveEl.innerHTML = `
      <div class="passive-summary ${def.id}">${def.emoji} ${local.passive?.name ?? 'Passive'}</div>
      ${rows.join('')}
    `;
  }

  _formatTimer(seconds) {
    const total = Math.max(0, Math.ceil(seconds ?? 0));
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  _updateGuardian(world) {
    const status = document.getElementById('guardian-status');
    const vitals = document.getElementById('guardian-vitals');
    const blessing = document.getElementById('guardian-blessing');
    const guardian = world.nexusGuardian;
    if (!status || !vitals || !blessing || !guardian) return;

    if (guardian.state === 'active') {
      status.textContent = 'ACTIVE';
      vitals.textContent = `${Math.ceil(guardian.health)} / ${guardian.maxHealth}`;
    } else if (guardian.state === 'respawning') {
      status.textContent = `RESPAWN ${this._formatTimer(guardian.timer)}`;
      vitals.textContent = `HP ×${(1.5 ** guardian.spawnCount).toFixed(2)}`;
    } else {
      status.textContent = `SPAWN ${this._formatTimer(guardian.timer)}`;
      vitals.textContent = 'OFFLINE';
    }

    const activeBlessing = Object.entries(world.guardianBlessings ?? {})
      .sort((a, b) => (b[1]?.timer ?? 0) - (a[1]?.timer ?? 0))[0];
    blessing.textContent = activeBlessing
      ? `${activeBlessing[0].toUpperCase()} ${Math.ceil(activeBlessing[1].timer)}s`
      : '—';
  }

  _passiveRow(icon, label, value) {
    return `
      <div class="passive-row">
        <span class="passive-icon">${icon}</span>
        <span class="passive-label">${label}</span>
        <span class="passive-value">${value}</span>
      </div>
    `;
  }

  _updateAlliance(world) {
    if (!this._allianceEl) return;
    const alliance = world.alliance;
    if (!alliance) {
      this._allianceEl.style.display = 'none';
      return;
    }
    this._allianceEl.style.display = 'flex';
    const [a, b] = alliance.members;
    const t = alliance.target;
    this._allianceEl.innerHTML = `
      <span class="alliance-emoji">🤝</span>
      <div class="alliance-info">
        <span class="alliance-title">TEMPORARY ALLIANCE</span>
        <span class="alliance-desc">
          <span class="${a}">${a.toUpperCase()}</span> &amp;
          <span class="${b}">${b.toUpperCase()}</span> vs
          <span class="${t}">${t.toUpperCase()}</span>
        </span>
      </div>
    `;
  }

  _updateChaosEvent(world) {
    if (!this._chaosBannerEl) return;
    const event = world.chaosEvent;
    if (!event) {
      this._chaosBannerEl.style.display = 'none';
      return;
    }
    this._chaosBannerEl.style.display = 'flex';
    this._chaosBannerEl.style.borderColor = event.color;
    this._chaosBannerEl.innerHTML = `
      <span class="chaos-emoji">${event.emoji}</span>
      <div class="chaos-info">
        <span class="chaos-name" style="color:${event.color}">${event.name}</span>
        <span class="chaos-desc">${event.description}</span>
      </div>
      <span class="chaos-timer" style="color:${event.color}">${Math.ceil(event.remaining)}s</span>
    `;
  }

  _updateScoreboard(world) {
    if (!this._scoreboardEl) return;
    const visible = !!world.matchEnded;
    this._scoreboardEl.style.display = visible ? 'flex' : 'none';
    if (!visible) return;

    const winner = document.getElementById('scoreboard-winner');
    if (winner) {
      const winnerFaction = world.winnerFaction ? world.winnerFaction.toUpperCase() : 'UNKNOWN';
      winner.textContent = `${winnerFaction} VICTORY`;
    }

    for (const faction of ['blue', 'green', 'red']) {
      const stats = world.stats[faction] ?? { kills: 0, deaths: 0, assists: 0, crystals: 0 };
      const score = world.scores[faction] ?? 0;
      const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(val);
      };
      set(`sb-${faction}-kills`, stats.kills);
      set(`sb-${faction}-deaths`, stats.deaths);
      set(`sb-${faction}-assists`, stats.assists);
      set(`sb-${faction}-crystals`, stats.crystals);
      set(`sb-${faction}-score`, score);
    }
  }

  _updateMinimapStatus(world) {
    if (!this._minimapAlertEl) return;
    const localFaction = world.localPlayer?.faction ?? 'blue';
    const baseAlert = world.baseAttackAlerts?.[localFaction];
    const pin = world._getActivePinForFaction?.(localFaction);
    let text = 'STATUS — STANDBY';
    let tone = '';
    if (baseAlert?.active) {
      text = 'ALERT — BASE UNDER ATTACK';
      tone = 'alert';
    } else if (world.nexusGuardian?.state === 'active') {
      text = '🛡️ NEXUS GUARDIAN ACTIVE';
      tone = 'chaos';
    } else if (world.chaosEvent) {
      text = `${world.chaosEvent.emoji} ${world.chaosEvent.name} ACTIVE`;
      tone = 'chaos';
    } else if (pin) {
      const labels = { gather: '集合', danger: '危険', crystal: 'クリスタル' };
      text = `PIN — ${labels[pin.type] ?? pin.type.toUpperCase()}`;
      tone = pin.type;
    }
    this._minimapAlertEl.textContent = text;
    this._minimapAlertEl.dataset.tone = tone;
    if (this._minimapControlsEl) {
      this._minimapControlsEl.classList.toggle('alerting', !!baseAlert?.active);
    }
  }

  getMinimapFilters() {
    return this._minimapFilters;
  }

  getSelectedPinType() {
    return this._selectedPinType;
  }
}
