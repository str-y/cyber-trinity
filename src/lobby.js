/**
 * lobby.js
 * Pre-match lobby UI — game settings, preset management, mini-map preview,
 * and 3-second countdown before deployment.
 *
 * Public API:
 *   initLobby(elements, onLaunch)
 *     elements  — { lobbyScreen, factionScreen, countdownOverlay, countdownNumber }
 *     onLaunch  — callback(config) fired after the countdown finishes
 */

// ── Default lobby config ──────────────────────────────────────────────────────

export const DEFAULT_CONFIG = {
  matchDuration:      300,      // seconds  (180 / 300 / 600)
  winScore:           150,      // standard mode target; 2v2v2 mode forces 80
  chaosEnabled:       true,
  chaosInterval:      30,       // seconds  (30 / 60 / 90)
  gameMode:           'standard',  // 'standard' (5v5v5) | 'quick' (2v2v2)
  startingCrystals:   'normal', // 'low' | 'normal' | 'high'
  aiDifficulty: {
    blue:  'normal',
    green: 'normal',
    red:   'normal',
  },
};

const MODE_PRESETS = {
  standard: {
    matchDuration: 300,
    winScore: 150,
    playersPerFaction: 5,
    trilockCount: 5,
    baseMarginRatio: 0.30,
    trilockRingRatio: 0.18,
    label: '5v5v5  STANDARD · 5 MIN / 150 PTS',
  },
  quick: {
    matchDuration: 180,
    winScore: 80,
    playersPerFaction: 2,
    trilockCount: 3,
    baseMarginRatio: 0.22,
    trilockRingRatio: 0.11,
    label: '2v2v2  QUICK · 3 MIN / 80 PTS',
  },
};

function getModePreset(mode = 'standard') {
  return MODE_PRESETS[mode] ?? MODE_PRESETS.standard;
}

// ── Preset helpers ────────────────────────────────────────────────────────────

const PRESET_KEY = 'cyberTrinityPresets';
const PRESET_COUNT = 3;

function loadPresets() {
  try {
    const raw = localStorage.getItem(PRESET_KEY);
    const data = raw ? JSON.parse(raw) : [];
    const result = [];
    for (let i = 0; i < PRESET_COUNT; i++) {
      result.push(data[i] ?? null);
    }
    return result;
  } catch {
    return Array(PRESET_COUNT).fill(null);
  }
}

function savePreset(index, config, name) {
  const presets = loadPresets();
  presets[index] = { name: name || `Preset ${index + 1}`, config: { ...config, aiDifficulty: { ...config.aiDifficulty } } };
  try {
    localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
  } catch { /* quota exceeded — silently skip */ }
  return presets;
}

function deletePreset(index) {
  const presets = loadPresets();
  presets[index] = null;
  try {
    localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
  } catch { /* ignore */ }
  return presets;
}

// ── Mini-map preview ──────────────────────────────────────────────────────────

function drawPreview(canvas, config) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const cx = W / 2;
  const cy = H / 2;
  const preset = getModePreset(config.gameMode);

  // Background
  ctx.fillStyle = 'rgba(0, 10, 30, 0.95)';
  ctx.fillRect(0, 0, W, H);

  // Grid lines
  ctx.strokeStyle = 'rgba(74,168,255,0.07)';
  ctx.lineWidth = 1;
  for (let gx = 0; gx < W; gx += 24) {
    ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
  }
  for (let gy = 0; gy < H; gy += 24) {
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
  }

  const margin = Math.min(W, H) * preset.baseMarginRatio;
  const FACTION_COLORS = { blue: '#4aa8ff', green: '#50ff78', red: '#ff4444' };
  const bases = {
    blue:  { x: cx,                y: cy - margin },
    green: { x: cx - margin * 0.88, y: cy + margin * 0.58 },
    red:   { x: cx + margin * 0.88, y: cy + margin * 0.58 },
  };

  if (config.gameMode === 'quick') {
    ctx.strokeStyle = 'rgba(80,255,120,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - W * 0.22, cy - H * 0.22, W * 0.44, H * 0.44);
  }

  // TriLock ring (mode-dependent neutral bases)
  const ringR = Math.min(W, H) * preset.trilockRingRatio;
  ctx.strokeStyle = 'rgba(160,212,255,0.30)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 5]);
  ctx.beginPath();
  ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  for (let i = 0; i < preset.trilockCount; i++) {
    const angle = (i / preset.trilockCount) * Math.PI * 2 - Math.PI / 2;
    const tx = cx + Math.cos(angle) * ringR;
    const ty = cy + Math.sin(angle) * ringR;
    ctx.beginPath();
    ctx.arc(tx, ty, 5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(160,212,255,0.50)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(160,212,255,0.70)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Home bases + player dots
  const playersPerFaction = preset.playersPerFaction;
  for (const [faction, pos] of Object.entries(bases)) {
    const color = FACTION_COLORS[faction];

    // Glow
    const grd = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, 22);
    grd.addColorStop(0, color + '55');
    grd.addColorStop(1, 'transparent');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 22, 0, Math.PI * 2);
    ctx.fill();

    // Base circle
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 14, 0, Math.PI * 2);
    ctx.fillStyle = color + '22';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Player dots
    for (let i = 0; i < playersPerFaction; i++) {
      const angle = (i / playersPerFaction) * Math.PI * 2;
      const r = 22;
      const px = pos.x + Math.cos(angle) * r;
      const py = pos.y + Math.sin(angle) * r;
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
  }

  // Label
  const modeLabel = preset.label;
  ctx.fillStyle = 'rgba(160,212,255,0.65)';
  ctx.font = '9px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(modeLabel, cx, H - 8);
}

// ── Lobby HTML builder ────────────────────────────────────────────────────────

function buildLobbyInner() {
  return `
    <div class="select-kicker">PRE-MATCH LOBBY</div>
    <h1>CYBER TRINITY</h1>
    <div id="lobby-body">

      <!-- Settings column -->
      <div id="lobby-settings">

        <div class="setting-group">
          <div class="setting-label">MATCH TIME <span class="setting-sub">(mode preset)</span></div>
          <div class="setting-options" data-setting="matchDuration">
            <button class="opt-btn" data-value="180">3 MIN</button>
            <button class="opt-btn selected" data-value="300">5 MIN</button>
            <button class="opt-btn" data-value="600">10 MIN</button>
          </div>
        </div>

        <div class="setting-group">
          <div class="setting-label">WIN SCORE <span class="setting-sub">(mode preset)</span></div>
          <div class="setting-options" data-setting="winScore">
            <button class="opt-btn" data-value="0">OFF</button>
            <button class="opt-btn" data-value="80">80</button>
            <button class="opt-btn selected" data-value="150">150</button>
            <button class="opt-btn" data-value="300">300</button>
          </div>
        </div>

        <div class="setting-group">
          <div class="setting-label">GAME MODE</div>
          <div class="setting-options" data-setting="gameMode">
            <button class="opt-btn selected" data-value="standard">STANDARD 5v5v5</button>
            <button class="opt-btn" data-value="quick">QUICK 2v2v2</button>
          </div>
        </div>

        <div class="setting-group">
          <div class="setting-label">START CRYSTALS</div>
          <div class="setting-options" data-setting="startingCrystals">
            <button class="opt-btn" data-value="low">LOW</button>
            <button class="opt-btn selected" data-value="normal">NORMAL</button>
            <button class="opt-btn" data-value="high">HIGH</button>
          </div>
        </div>

        <div class="setting-group">
          <div class="setting-label">CHAOS EVENTS</div>
          <div class="setting-options" data-setting="chaosEnabled">
            <button class="opt-btn selected" data-value="true">ENABLED</button>
            <button class="opt-btn" data-value="false">DISABLED</button>
          </div>
          <div class="setting-sub-row" id="chaos-freq-row">
            <span class="setting-sub">FREQUENCY</span>
            <div class="setting-options" data-setting="chaosInterval">
              <button class="opt-btn selected" data-value="30">30s</button>
              <button class="opt-btn" data-value="60">60s</button>
              <button class="opt-btn" data-value="90">90s</button>
            </div>
          </div>
        </div>

        <div class="setting-group">
          <div class="setting-label">AI DIFFICULTY</div>
          <div id="ai-difficulty-rows">
            <div class="ai-faction-row">
              <span class="ai-faction-label blue">🔵 ARCHIVE</span>
              <div class="setting-options mini" data-setting="aiDifficulty" data-faction="blue">
                <button class="opt-btn" data-value="easy">EASY</button>
                <button class="opt-btn selected" data-value="normal">NORMAL</button>
                <button class="opt-btn" data-value="hard">HARD</button>
                <button class="opt-btn" data-value="expert">EXPERT</button>
              </div>
            </div>
            <div class="ai-faction-row">
              <span class="ai-faction-label green">🟢 LIFE FORGE</span>
              <div class="setting-options mini" data-setting="aiDifficulty" data-faction="green">
                <button class="opt-btn" data-value="easy">EASY</button>
                <button class="opt-btn selected" data-value="normal">NORMAL</button>
                <button class="opt-btn" data-value="hard">HARD</button>
                <button class="opt-btn" data-value="expert">EXPERT</button>
              </div>
            </div>
            <div class="ai-faction-row">
              <span class="ai-faction-label red">🔴 CORE PROTOCOL</span>
              <div class="setting-options mini" data-setting="aiDifficulty" data-faction="red">
                <button class="opt-btn" data-value="easy">EASY</button>
                <button class="opt-btn selected" data-value="normal">NORMAL</button>
                <button class="opt-btn" data-value="hard">HARD</button>
                <button class="opt-btn" data-value="expert">EXPERT</button>
              </div>
            </div>
          </div>
        </div>

      </div><!-- /lobby-settings -->

      <!-- Right column: mini-map preview + presets -->
      <div id="lobby-side">
        <div class="side-section-label">MAP PREVIEW</div>
        <canvas id="lobby-preview-canvas" width="200" height="180"></canvas>

        <div class="side-section-label" style="margin-top:14px;">PRESETS</div>
        <div id="preset-bar"></div>
      </div>

    </div><!-- /lobby-body -->

    <div id="lobby-actions">
      <button id="lobby-start-btn" type="button">CONFIGURE FACTION →</button>
    </div>
  `;
}

// ── Main init function ────────────────────────────────────────────────────────

/**
 * Initialise the lobby.
 * @param {object} els  — { lobbyScreen, factionScreen, countdownOverlay, countdownNumber, deployButton }
 * @param {function} onLaunch — called with final config after countdown
 */
export function initLobby(els, onLaunch) {
  const { lobbyScreen, factionScreen, countdownOverlay, countdownNumber } = els;

  // ── Build lobby HTML ─────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.id = 'lobby-panel';
  panel.innerHTML = buildLobbyInner();
  lobbyScreen.appendChild(panel);

  // ── State ────────────────────────────────────────────────────────────────
  const config = {
    ...DEFAULT_CONFIG,
    aiDifficulty: { ...DEFAULT_CONFIG.aiDifficulty },
  };
  let presets = loadPresets();

  // ── Helpers ──────────────────────────────────────────────────────────────

  const previewCanvas = panel.querySelector('#lobby-preview-canvas');
  const chaosFreqRow  = panel.querySelector('#chaos-freq-row');

  function applyModePreset(mode) {
    const preset = getModePreset(mode);
    config.matchDuration = preset.matchDuration;
    config.winScore = preset.winScore;
  }

  function refreshPreview() {
    drawPreview(previewCanvas, config);
  }

  function syncChaosFreqVisibility() {
    chaosFreqRow.style.display = config.chaosEnabled ? 'flex' : 'none';
  }

  function syncModeLockedSettings() {
    const preset = getModePreset(config.gameMode);
    for (const setting of ['matchDuration', 'winScore']) {
      const group = panel.querySelector(`.setting-options[data-setting="${setting}"]`);
      if (!group) continue;
      for (const btn of group.querySelectorAll('.opt-btn')) {
        const locked = btn.dataset.value !== String(preset[setting]);
        btn.disabled = locked;
        btn.title = locked ? `Locked to ${config.gameMode.toUpperCase()} mode preset` : '';
      }
    }
  }

  function refreshPresetBar() {
    const bar = panel.querySelector('#preset-bar');
    bar.innerHTML = '';
    for (let i = 0; i < PRESET_COUNT; i++) {
      const preset = presets[i];
      const slot = document.createElement('div');
      slot.className = 'preset-slot' + (preset ? ' filled' : ' empty');
      slot.innerHTML = preset
        ? `<span class="preset-name">${escapeHtml(preset.name)}</span>
           <span class="preset-hint">click to load</span>
           <button class="preset-del" data-index="${i}" title="Delete">×</button>`
        : `<span class="preset-name">— empty —</span>
           <span class="preset-hint">click to save</span>`;
      slot.addEventListener('click', (e) => {
        if (e.target.classList.contains('preset-del')) return;
        if (preset) {
          applyConfig(preset.config);
        } else {
          const name = prompt('Preset name:', `Preset ${i + 1}`);
          if (name === null) return;
          presets = savePreset(i, config, name.trim() || `Preset ${i + 1}`);
          refreshPresetBar();
        }
      });
      slot.addEventListener('click', (e) => {
        if (!e.target.classList.contains('preset-del')) return;
        e.stopPropagation();
        if (!confirm(`Delete "${presets[i]?.name}"?`)) return;
        presets = deletePreset(i);
        refreshPresetBar();
      });
      bar.appendChild(slot);
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function applyConfig(src) {
    if (src.gameMode         !== undefined) config.gameMode         = src.gameMode;
    applyModePreset(config.gameMode);
    if (src.startingCrystals !== undefined) config.startingCrystals = src.startingCrystals;
    if (src.chaosEnabled     !== undefined) config.chaosEnabled     = src.chaosEnabled;
    if (src.chaosInterval    !== undefined) config.chaosInterval    = src.chaosInterval;
    if (src.aiDifficulty) {
      if (src.aiDifficulty.blue  !== undefined) config.aiDifficulty.blue  = src.aiDifficulty.blue;
      if (src.aiDifficulty.green !== undefined) config.aiDifficulty.green = src.aiDifficulty.green;
      if (src.aiDifficulty.red   !== undefined) config.aiDifficulty.red   = src.aiDifficulty.red;
    }
    syncAllOptionButtons();
    syncModeLockedSettings();
    syncChaosFreqVisibility();
    refreshPreview();
  }

  // Sync all opt-btn selected states from config
  function syncAllOptionButtons() {
    // Standard settings
    for (const group of panel.querySelectorAll('.setting-options[data-setting]')) {
      const setting = group.dataset.setting;
      if (setting === 'aiDifficulty') continue;
      const val = String(config[setting]);
      for (const btn of group.querySelectorAll('.opt-btn')) {
        btn.classList.toggle('selected', btn.dataset.value === val);
      }
    }
    // AI difficulty per faction
    for (const group of panel.querySelectorAll('.setting-options[data-setting="aiDifficulty"]')) {
      const faction = group.dataset.faction;
      const val = config.aiDifficulty[faction];
      for (const btn of group.querySelectorAll('.opt-btn')) {
        btn.classList.toggle('selected', btn.dataset.value === val);
      }
    }
  }

  // ── Option button click handler ───────────────────────────────────────────
  panel.addEventListener('click', (e) => {
    const btn = e.target.closest('.opt-btn');
    if (!btn) return;
    const group = btn.closest('.setting-options[data-setting]');
    if (!group) return;

    const setting = group.dataset.setting;
    const rawValue = btn.dataset.value;

    if (setting === 'aiDifficulty') {
      const faction = group.dataset.faction;
      config.aiDifficulty[faction] = rawValue;
      for (const b of group.querySelectorAll('.opt-btn')) {
        b.classList.toggle('selected', b === btn);
      }
      return;
    }

    // Coerce value type
    let value;
    if (rawValue === 'true')  value = true;
    else if (rawValue === 'false') value = false;
    else if (!isNaN(Number(rawValue))) value = Number(rawValue);
    else value = rawValue;

    if (setting === 'gameMode') {
      config.gameMode = value;
      applyModePreset(value);
      syncAllOptionButtons();
      syncModeLockedSettings();
      refreshPreview();
      return;
    }

    config[setting] = value;
    for (const b of group.querySelectorAll('.opt-btn')) {
      b.classList.toggle('selected', b === btn);
    }

    if (setting === 'chaosEnabled') syncChaosFreqVisibility();
  });

  // ── "Configure Faction" button ────────────────────────────────────────────
  panel.querySelector('#lobby-start-btn').addEventListener('click', () => {
    lobbyScreen.style.display = 'none';
    factionScreen.style.display = '';
  });

  // ── Countdown + launch ────────────────────────────────────────────────────
  /** Called from index.html when the deploy button is clicked. */
  function startCountdown(faction) {
    config.playerFaction = faction;
    factionScreen.style.display = 'none';
    countdownOverlay.style.display = 'flex';

    let count = 3;
    countdownNumber.textContent = count;

    const tick = setInterval(() => {
      count--;
      if (count > 0) {
        // Retrigger CSS animation by removing and re-adding the element's animation
        countdownNumber.style.animation = 'none';
        countdownNumber.offsetHeight;   // force reflow
        countdownNumber.style.animation = '';
        countdownNumber.textContent = count;
      } else {
        clearInterval(tick);
        countdownOverlay.style.display = 'none';
        onLaunch({ ...config, aiDifficulty: { ...config.aiDifficulty } });
      }
    }, 1000);
  }

  // ── Initial render ────────────────────────────────────────────────────────
  applyModePreset(config.gameMode);
  syncAllOptionButtons();
  syncModeLockedSettings();
  syncChaosFreqVisibility();
  refreshPreview();
  refreshPresetBar();

  return { startCountdown };
}
