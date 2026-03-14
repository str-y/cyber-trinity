/**
 * hud.js
 * Manages all DOM-based HUD elements.
 * Scores, match timer, health/energy bars, ability cooldowns, event feed,
 * jewel counter, TriLock status, hate indicator.
 */

import { FACTIONS } from './entities.js';

const MAX_FEED_ITEMS = 6;
const FEED_TTL       = 3500; // ms
const DEFAULT_AGENT_LABEL = 'AGENT';
const FACTION_NAMES = {
  blue: 'THE ARCHIVE',
  green: 'LIFE FORGE',
  red: 'CORE PROTOCOL',
};
const RANK_BADGES = ['🥇', '🥈', '🥉'];

export class HUD {
  constructor() {
    this._scoreEls   = {};
    this._feedItems  = [];
    this._scoreboardEl = null;
    this._replayControlsBound = false;
    this._minimapFilters = {
      agents: { blue: true, green: true, red: true },
      crystals: true,
      chaosZones: true,
    };
    this._selectedPinType = 'gather';
    this._highlightedIds = [];
    this._modeControlsBound = false;
    this._init();
  }

  // ── Build DOM ─────────────────────────────────────────────────────────────

  _init() {
    const hud = document.getElementById('hud');

    // ── Score panel ──────────────────────────────────────────────────────

    const scorePanel = document.getElementById('score-panel');
    if (!scorePanel) return;

    const factions = ['blue', 'green', 'red'];
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
        <span class="score-label ${f}">${FACTION_NAMES[f]}</span>
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
        <span class="${f}" style="opacity:0.85">${FACTION_NAMES[f]}</span>
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

    const spectatorPanel = document.getElementById('spectator-panel');
    if (spectatorPanel) {
      spectatorPanel.innerHTML = `
        <div class="panel-title blue">SPECTATOR MODE</div>
        <div class="spectator-line"><span>VIEW</span><b id="spectator-mode">OVERHEAD</b></div>
        <div class="spectator-line"><span>FOLLOW</span><b id="spectator-target">—</b></div>
        <div class="spectator-line"><span>HP</span><b id="spectator-health">—</b></div>
        <div class="spectator-line"><span>ENERGY</span><b id="spectator-energy">—</b></div>
        <div class="spectator-line"><span>ABILITY</span><b id="spectator-cooldown">—</b></div>
        <div class="spectator-line"><span>JEWELS</span><b id="spectator-carry">—</b></div>
        <div class="panel-title blue" style="margin-top:8px">BASE UPLINK</div>
        <div id="spectator-bases"></div>
        <div class="spectator-controls">V EXIT • C CAMERA • [ / ] TARGET • WASD FREE CAM</div>
      `;
      this._spectatorPanelEl = spectatorPanel;
      this._spectatorBasesEl = spectatorPanel.querySelector('#spectator-bases');
    }

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
        <div class="panel-title blue panel-subtitle-spaced">NEXUS GUARDIAN</div>
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
        <div class="panel-title" id="scoreboard-title">LIVE SCOREBOARD</div>
        <div class="scoreboard-winner" id="scoreboard-winner">—</div>
        <div class="scoreboard-header">
          <span>RANK</span><span>FACTION</span><span>K</span><span>D</span><span>A</span><span>💎</span><span>PTS</span>
        </div>
        <div id="scoreboard-factions"></div>
        <div class="scoreboard-sections">
          <div class="scoreboard-section" id="scoreboard-mvp"></div>
          <div class="scoreboard-section" id="scoreboard-session"></div>
        </div>
        <div class="replay-panel" id="replay-panel">
          <div class="panel-title blue">MATCH REPLAY</div>
          <div class="replay-actions">
            <button type="button" id="replay-toggle">PLAY REPLAY</button>
            <button type="button" id="replay-export">EXPORT JSON</button>
            <button type="button" id="replay-exit">LIVE RESULT</button>
            <button type="button" id="replay-restart">NEW MATCH</button>
          </div>
          <div class="replay-timeline-row">
            <span id="replay-current-time">0:00</span>
            <input type="range" id="replay-timeline" min="0" max="0" step="0.1" value="0" />
            <span id="replay-duration">0:00</span>
          </div>
          <div class="replay-meta">
            <label for="replay-speed">SPD</label>
            <select id="replay-speed">
              <option value="0.25">0.25×</option>
              <option value="0.5">0.5×</option>
              <option value="1" selected>1×</option>
              <option value="2">2×</option>
              <option value="4">4×</option>
            </select>
            <span id="replay-status">Replay saved automatically after the match.</span>
          </div>
          <div class="replay-hint">Replay spectator camera: WASD/Arrows pan, +/- zoom, slider to seek.</div>
        </div>
      `;
      this._scoreboardEl = scoreboard;
    }

    const modeGuide = document.createElement('div');
    modeGuide.id = 'mode-guide';
    hud.appendChild(modeGuide);
    this._modeGuideEl = modeGuide;

    const jobSwitcher = document.createElement('div');
    jobSwitcher.id = 'mode-job-switcher';
    hud.appendChild(jobSwitcher);
    this._jobSwitcherEl = jobSwitcher;

    const zoneCollapseBanner = document.createElement('div');
    zoneCollapseBanner.id = 'zone-collapse-banner';
    zoneCollapseBanner.innerHTML = `
      <div class="panel-title red">SAFE ZONE ALERT</div>
      <div class="zone-collapse-line" id="zone-collapse-state">OUTER SECTORS STABLE</div>
      <div class="zone-collapse-detail" id="zone-collapse-detail">—</div>
    `;
    hud.appendChild(zoneCollapseBanner);
    this._zoneCollapseEl = zoneCollapseBanner;
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
    this._bindReplayControls(world);
    this._bindModeControls(world);
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
      if (!Number.isFinite(world.matchTimer ?? 0)) {
        timerVal.textContent = world.config?.gameMode === 'tutorial' ? 'TUTORIAL' : 'FREEPLAY';
        timerVal.style.color = '#a0d4ff';
      } else {
        const t = Math.max(0, world.matchTimer ?? 0);
        const mins = Math.floor(t / 60);
        const secs = Math.floor(t % 60);
        timerVal.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
        // Urgent colour when <30s
        timerVal.style.color = t < 30 ? '#ff4444' : '#a0d4ff';
      }
    }

    const statusLeft = document.getElementById('status-left');
    const statusRight = document.getElementById('status-right');
    if (world.spectatorMode) {
      if (statusLeft) statusLeft.style.display = 'none';
      if (statusRight) statusRight.style.display = 'none';
    } else {
      if (statusLeft) statusLeft.style.display = 'flex';
      if (statusRight) statusRight.style.display = 'flex';
    }

    // First blue player as "local player"
    const local = world.localPlayer;
    if (local && !world.spectatorMode) {
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

    this._updateZoneCollapse(world, local);
    this._updateSpectator(world);

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
    this._updateGuide(world);
    const featureSpec = document.getElementById('feature-spec');
    if (featureSpec) featureSpec.style.display = world._isSandboxMode?.() ? 'none' : 'flex';
  }

  _bindReplayControls(world) {
    if (this._replayControlsBound) return;
    const toggle = document.getElementById('replay-toggle');
    const exportBtn = document.getElementById('replay-export');
    const restart = document.getElementById('replay-restart');
    const exit = document.getElementById('replay-exit');
    const timeline = document.getElementById('replay-timeline');
    const speed = document.getElementById('replay-speed');
    if (!toggle || !exportBtn || !restart || !exit || !timeline || !speed) return;

    toggle.addEventListener('click', () => world.toggleReplayPlayback());
    exportBtn.addEventListener('click', () => world.exportReplayFile());
    restart.addEventListener('click', () => world.restartLiveMatch());
    exit.addEventListener('click', () => world.exitReplayPlayback());
    timeline.addEventListener('input', event => {
      if (!world.replay?.isActive) world.startReplayPlayback();
      world.setReplayTime(event.target.value);
    });
    speed.addEventListener('change', event => world.setReplaySpeed(event.target.value));
    this._replayControlsBound = true;
  }

  _bindModeControls(world) {
    if (this._modeControlsBound || !this._modeGuideEl || !this._jobSwitcherEl) return;
    this._modeGuideEl.addEventListener('click', (event) => {
      const button = event.target.closest('[data-guide-action]');
      if (!(button instanceof HTMLButtonElement)) return;
      const action = button.dataset.guideAction;
      if (action === 'skip') world.skipTutorial?.();
      else if (action === 'advance') world.advanceTutorial?.();
      else if (action === 'start') world.startMainMatchFromTutorial?.();
    });
    this._jobSwitcherEl.addEventListener('click', (event) => {
      const button = event.target.closest('[data-job]');
      if (!(button instanceof HTMLButtonElement)) return;
      world.switchLocalJob?.(button.dataset.job);
    });
    this._modeControlsBound = true;
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

  _updateZoneCollapse(world, local) {
    if (!this._zoneCollapseEl) return;
    const zone = world.zoneCollapse;
    if (!zone?.active || !Number.isFinite(world.matchTimer ?? 0) || world.spectatorMode) {
      this._zoneCollapseEl.classList.remove('active', 'danger');
      this._zoneCollapseEl.style.display = 'none';
      return;
    }

    this._zoneCollapseEl.style.display = 'flex';
    this._zoneCollapseEl.classList.add('active');

    const stateEl = document.getElementById('zone-collapse-state');
    const detailEl = document.getElementById('zone-collapse-detail');
    const distance = local
      ? Math.hypot(local.x - zone.centerX, local.y - zone.centerY)
      : 0;
    const outside = !!local && distance > zone.currentRadius;
    this._zoneCollapseEl.classList.toggle('danger', outside);

    if (stateEl) {
      stateEl.textContent = outside
        ? '⚠️ RETURN TO THE SAFE ZONE'
        : `SAFE ZONE SHRINKING — ${Math.round(zone.progress * 100)}%`;
    }
    if (detailEl) {
      const edgeDistance = local
        ? Math.max(0, Math.round(Math.abs(distance - zone.currentRadius)))
        : 0;
      detailEl.textContent = outside
        ? `DMG ${Math.round(zone.damagePerSecond * 100)}% HP/s • ${edgeDistance}px TO SAFETY`
        : `MATCH ${this._formatTimer(world.matchTimer)} • GAP ${zone.scoreGap} • HOLD THE CENTER`;
    }
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
      status.textContent = `RESPAWN IN ${this._formatTimer(guardian.timer)}`;
      vitals.textContent = `HP ×${(1.5 ** guardian.spawnCount).toFixed(2)}`;
    } else {
      status.textContent = `SPAWN IN ${this._formatTimer(guardian.timer)}`;
      vitals.textContent = 'OFFLINE';
    }

    const activeBlessing = Object.entries(world.guardianBlessings ?? {})
      .find(([, buff]) => (buff?.timer ?? 0) > 0);
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
    const replayState = world.replay?.getHudState?.() ?? { available: false, active: false };
    const finalReplayFrame = world.replay?.savedReplay?.frames?.at?.(-1) ?? null;
    const summaryWorld = replayState.active && finalReplayFrame ? finalReplayFrame : world;
    const liveScoreboard = !!world.input?.target && !world.matchEnded && !world.spectatorMode && !replayState.active;
    const visible = !!world.matchEnded || replayState.active || liveScoreboard;
    this._scoreboardEl.style.display = visible ? 'flex' : 'none';
    if (!visible) return;

    const title = document.getElementById('scoreboard-title');
    const winner = document.getElementById('scoreboard-winner');
    const factionsEl = document.getElementById('scoreboard-factions');
    const mvpEl = document.getElementById('scoreboard-mvp');
    const sessionEl = document.getElementById('scoreboard-session');
    const ranking = this._getFactionRanking(summaryWorld);
    const leadFaction = ranking[0]?.faction ?? summaryWorld.winnerFaction ?? 'blue';
    if (title) {
      title.textContent = replayState.active
        ? 'REPLAY RESULT'
        : world.matchEnded
          ? 'MATCH RESULT'
          : 'LIVE SCOREBOARD';
    }
    if (winner) {
      winner.textContent = world.matchEnded || replayState.active
        ? `${(summaryWorld.winnerFaction ?? leadFaction).toUpperCase()} VICTORY`
        : `${leadFaction.toUpperCase()} LEADS`;
    }

    if (factionsEl) {
      factionsEl.innerHTML = ranking.map((entry, index) => {
        const stats = entry.stats ?? {};
        return `
          <div class="scoreboard-row">
            <span class="scoreboard-rank">${RANK_BADGES[index] ?? `${index + 1}.`}</span>
            <span class="${entry.faction}">${entry.name}</span>
            <span>${stats.kills ?? 0}</span>
            <span>${stats.deaths ?? 0}</span>
            <span>${stats.assists ?? 0}</span>
            <span>${stats.crystals ?? 0}</span>
            <span>${entry.score}</span>
          </div>
          <div class="scoreboard-detail ${entry.faction}">
            PICK ${stats.crystalsCollected ?? 0} · CAP ${stats.captures ?? 0} · CHAOS ${Math.round(stats.chaosActivity ?? 0)}s · ABL ${stats.abilitiesUsed ?? 0}
          </div>
        `;
      }).join('');
    }

    if (mvpEl) {
      const topPlayer = this._getPlayerRanking(summaryWorld)[0] ?? null;
      mvpEl.innerHTML = topPlayer
        ? `
          <div class="panel-title ${topPlayer.player.faction}">${world.matchEnded || replayState.active ? 'MATCH MVP' : 'LIVE MVP'}</div>
          <div class="mvp-card ${topPlayer.player.faction}">
            <div class="mvp-name">${FACTIONS[topPlayer.player.faction]?.emoji ?? '⭐'} ${DEFAULT_AGENT_LABEL} ${topPlayer.player.index + 1} · ${(topPlayer.player.job ?? 'agent').toUpperCase()}</div>
            <div class="mvp-badge">★ MVP HIGHLIGHT</div>
            <div class="mvp-stats">
              <span>${topPlayer.stats.kills ?? 0}K / ${topPlayer.stats.deaths ?? 0}D / ${topPlayer.stats.assists ?? 0}A</span>
              <span>PICK ${topPlayer.stats.crystalsCollected ?? 0}</span>
              <span>💎 ${topPlayer.stats.crystalsDelivered ?? 0}</span>
              <span>PTS ${Math.round(topPlayer.stats.deliveryScore ?? 0)}</span>
              <span>CAP ${topPlayer.stats.baseCaptures ?? 0}</span>
            </div>
          </div>
        `
        : '<div class="panel-title">MATCH MVP</div><div class="scoreboard-empty">No combat data yet.</div>';
    }

    if (sessionEl) {
      const localId = summaryWorld.localPlayerId ?? this._playerId(world.localPlayer);
      const matchPlayer = this._findPlayerById(summaryWorld, localId);
      const sessionStats = world.localPlayer?.sessionStats ?? null;
      sessionEl.innerHTML = sessionStats
        ? `
          <div class="panel-title ${world.localPlayer?.faction ?? 'blue'}">SESSION TOTALS</div>
          <div class="session-grid">
            <span>MATCHES</span><b>${world.sessionMatches ?? 0}</b>
            <span>MATCH KDA</span><b>${matchPlayer?.stats?.kills ?? 0}/${matchPlayer?.stats?.deaths ?? 0}/${matchPlayer?.stats?.assists ?? 0}</b>
            <span>COLLECTED</span><b>${sessionStats.crystalsCollected ?? 0}</b>
            <span>DELIVERED</span><b>${sessionStats.crystalsDelivered ?? 0}</b>
            <span>DELIVERY PTS</span><b>${Math.round(sessionStats.deliveryScore ?? 0)}</b>
            <span>CAPTURES</span><b>${sessionStats.baseCaptures ?? 0}</b>
            <span>CHAOS TIME</span><b>${Math.round(sessionStats.chaosActivity ?? 0)}s</b>
            <span>ABILITIES</span><b>${sessionStats.abilitiesUsed ?? 0}</b>
          </div>
        `
        : '<div class="panel-title">SESSION TOTALS</div><div class="scoreboard-empty">Deploy an agent to begin tracking.</div>';
    }

    const replayPanel = document.getElementById('replay-panel');
    const replayToggle = document.getElementById('replay-toggle');
    const replayExit = document.getElementById('replay-exit');
    const replayExport = document.getElementById('replay-export');
    const replayTimeline = document.getElementById('replay-timeline');
    const replaySpeed = document.getElementById('replay-speed');
    const replayCurrent = document.getElementById('replay-current-time');
    const replayDuration = document.getElementById('replay-duration');
    const replayStatus = document.getElementById('replay-status');
    if (!replayPanel || !replayToggle || !replayExit || !replayExport ||
        !replayTimeline || !replaySpeed || !replayCurrent || !replayDuration || !replayStatus) return;

    replayPanel.style.display = replayState.available ? 'flex' : 'none';
    replayToggle.disabled = !replayState.available;
    replayExport.disabled = !replayState.available;
    replayExit.disabled = !replayState.active;
    replayTimeline.disabled = !replayState.available;
    replaySpeed.disabled = !replayState.available;
    replayToggle.textContent = replayState.active
      ? (replayState.playing ? 'PAUSE REPLAY' : 'RESUME REPLAY')
      : 'PLAY REPLAY';
    replayTimeline.max = String(replayState.duration || 0);
    replayTimeline.value = String(replayState.time || 0);
    replaySpeed.value = String(replayState.speed || 1);
    replayCurrent.textContent = this._formatReplayTime(replayState.time || 0);
    replayDuration.textContent = this._formatReplayTime(replayState.duration || 0);
    replayStatus.textContent = replayState.available
      ? `${replayState.storedFrames} recorded frames ready${replayState.active ? ' — replay mode active' : ''}.`
      : 'Replay becomes available when the match ends.';
  }

  _formatReplayTime(seconds) {
    const total = Math.max(0, Number(seconds) || 0);
    const mins = Math.floor(total / 60);
    const secs = Math.floor(total % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  _playerId(player) {
    return player ? `${player.faction}:${player.index}` : null;
  }

  _findPlayerById(world, id) {
    if (!id) return null;
    return world.players?.find(player => `${player.faction}:${player.index}` === id) ?? null;
  }

  _getFactionRanking(world) {
    return ['blue', 'green', 'red']
      .map(faction => ({
        faction,
        name: FACTION_NAMES[faction],
        score: world.scores?.[faction] ?? 0,
        stats: world.stats?.[faction] ?? {},
      }))
      .sort((a, b) => (
        b.score - a.score ||
        (b.stats.kills ?? 0) - (a.stats.kills ?? 0) ||
        (b.stats.crystals ?? 0) - (a.stats.crystals ?? 0)
      ));
  }

  _getPlayerRanking(world) {
    return (world.players ?? [])
      .map(player => {
        const stats = player.stats ?? {};
        const mvpScore = (stats.kills ?? 0) * 6 +
          (stats.assists ?? 0) * 3 +
          (stats.deliveryScore ?? 0) +
          (stats.crystalsDelivered ?? 0) * 2 +
          (stats.baseCaptures ?? 0) * 12 +
          (stats.chaosActivity ?? 0) * 0.2 +
          (stats.abilitiesUsed ?? 0) -
          (stats.deaths ?? 0) * 4;
        return { player, stats, mvpScore };
      })
      .sort((a, b) => (
        b.mvpScore - a.mvpScore ||
        (b.stats.kills ?? 0) - (a.stats.kills ?? 0) ||
        (b.stats.deliveryScore ?? 0) - (a.stats.deliveryScore ?? 0)
      ));
  }

  _updateSpectator(world) {
    if (!this._spectatorPanelEl) return;
    if (!world.spectatorMode) {
      this._spectatorPanelEl.style.display = 'none';
      return;
    }

    this._spectatorPanelEl.style.display = 'flex';
    const observed = world.getObservedPlayer?.() ?? null;
    const set = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    set('spectator-mode', (world.spectatorCameraMode ?? 'overhead').toUpperCase());
    if (observed) {
      const hpPct = Math.round((observed.health / observed.maxHealth) * 100);
      const energyPct = Math.round(observed.energy);
      set(
        'spectator-target',
        `${observed.faction.toUpperCase()} · ${(observed.jobDef?.label ?? DEFAULT_AGENT_LABEL).toUpperCase()} #${observed.index + 1}`,
      );
      set('spectator-health', `${Math.round(observed.health)} / ${observed.maxHealth} (${hpPct}%)`);
      set('spectator-energy', `${energyPct} / 100`);
      set('spectator-cooldown', `${observed.abilityName.toUpperCase()} · ${observed.cooldown.toFixed(1)}s`);
      set('spectator-carry', `${observed.carrying.length} / 5`);
    } else {
      set('spectator-target', `NO LIVE ${DEFAULT_AGENT_LABEL}`);
      set('spectator-health', '—');
      set('spectator-energy', '—');
      set('spectator-cooldown', '—');
      set('spectator-carry', '—');
    }

    if (!this._spectatorBasesEl) return;
    const homeLines = ['blue', 'green', 'red'].map(faction => {
      const base = world.bases?.[faction];
      const stored = base?.crystalsStored ?? 0;
      return `<div class="spectator-base ${faction}">${faction.toUpperCase()} HOME · 💎${stored}</div>`;
    });
    const trilockLines = (world.trilocks ?? []).map((base, index) => {
      const owner = base.faction ? base.faction.toUpperCase() : 'NEUTRAL';
      const capture = base.captureFaction ? ` · CAP ${base.captureFaction.toUpperCase()} ${Math.round(base.captureProgress)}%` : '';
      return `
        <div class="spectator-base ${base.faction ?? ''}">
          T${index + 1} · ${owner} · Lv${base.level ?? 0} · 💎${base.crystalsStored ?? 0}${capture}
        </div>
      `;
    });
    this._spectatorBasesEl.innerHTML = [...homeLines, ...trilockLines].join('');
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

  _updateGuide(world) {
    if (!this._modeGuideEl || !this._jobSwitcherEl) return;
    const guide = world.getGuideState?.() ?? null;

    for (const id of this._highlightedIds) {
      document.getElementById(id)?.classList.remove('guide-highlight');
    }
    this._highlightedIds = guide?.highlightIds ?? [];
    for (const id of this._highlightedIds) {
      document.getElementById(id)?.classList.add('guide-highlight');
    }

    if (!guide?.visible) {
      this._modeGuideEl.style.display = 'none';
      this._jobSwitcherEl.style.display = 'none';
      return;
    }

    this._modeGuideEl.style.display = 'flex';
    const showAdvance = !!guide.canAdvance;
    const actionHtml = guide.mode === 'tutorial'
      ? `
        <div class="mode-guide-actions">
          ${guide.complete
            ? '<button type="button" class="mode-guide-btn primary" data-guide-action="start">START STANDARD MATCH</button>'
            : showAdvance
              ? '<button type="button" class="mode-guide-btn primary" data-guide-action="advance">NEXT STEP</button>'
              : ''}
          ${guide.complete ? '' : '<button type="button" class="mode-guide-btn" data-guide-action="skip">SKIP TUTORIAL</button>'}
        </div>
      `
      : '';
    const completeBody = guide.complete
      ? 'Tutorial complete. Start a full standard match with your current faction selection whenever you are ready.'
      : guide.body;
    const guideModeLabel = guide.mode ? guide.mode.toUpperCase() : 'GUIDE';
    this._modeGuideEl.innerHTML = `
      <div class="mode-guide-kicker">${guideModeLabel}</div>
      <div class="mode-guide-title">${guide.title}</div>
      ${guide.stepIndex ? `<div class="mode-guide-step">STEP ${guide.stepIndex} / ${guide.stepCount}</div>` : ''}
      <div class="mode-guide-body">${completeBody}</div>
      ${guide.progress ? `<div class="mode-guide-progress">${guide.progress}</div>` : ''}
      ${actionHtml}
    `;

    if (!guide.showJobSwitcher) {
      this._jobSwitcherEl.style.display = 'none';
      return;
    }

    const currentJob = world.localPlayer?.job ?? 'warrior';
    const jobLabels = {
      warrior: '⚔️ WARRIOR',
      mage: '🔮 MAGE',
      healer: '💚 HEALER',
      scout: '💨 SCOUT',
    };
    this._jobSwitcherEl.style.display = 'flex';
    this._jobSwitcherEl.innerHTML = `
      <div class="mode-job-title">JOB SWITCHER</div>
      <div class="mode-job-buttons">
        ${Object.entries(jobLabels).map(([job, label], index) => `
          <button type="button" class="mode-job-btn${currentJob === job ? ' active' : ''}" data-job="${job}">
            <span>${label}</span><span class="mode-job-shortcut">${index + 1}</span>
          </button>
        `).join('')}
      </div>
    `;
  }
}
