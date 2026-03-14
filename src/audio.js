/**
 * audio.js
 * Web Audio API sound engine — procedurally synthesised.
 *
 * All sounds are generated in real-time; no external audio files are required.
 * AudioContext is created (and ambient sounds started) on the first user gesture
 * (keydown / click / touchstart) to comply with browser autoplay policies.
 *
 * Public API
 * ──────────
 *  playCrystalPickup(tier)        — jewel collected  ('normal' | 'rare' | 'legendary')
 *  playAbility(faction, jobType)  — ability fired     ('blue' | 'green' | 'red')
 *  playElimination()              — agent defeated
 *  playChaosEvent(type)           — chaos event start ('emp_storm' | 'crystal_rain' | 'nexus_overload')
 *  playMatchEnd(faction)          — match over fanfare
 */

export class AudioEngine {
  constructor() {
    this._ctx        = null;
    this._masterGain = null;
    this._bgmGain    = null;
    this._sfxGain    = null;
    this._rainGain   = null;
    this._started    = false;

    // Throttle: minimum seconds between ability sound triggers (prevents audio spam)
    this._lastAbilityTs       = 0;
    this._abilitySoundCooldown = 0.22;

    // Start audio on first user gesture (browser autoplay policy)
    const start = () => this._tryStart();
    window.addEventListener('keydown',    start, { once: true });
    window.addEventListener('click',      start, { once: true });
    window.addEventListener('touchstart', start, { once: true });
  }

  // ── Initialisation ─────────────────────────────────────────────────────────

  _tryStart() {
    if (this._started) return;
    try {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this._ctx.state === 'suspended') this._ctx.resume();

      this._masterGain            = this._ctx.createGain();
      this._masterGain.gain.value = 0.75;
      this._masterGain.connect(this._ctx.destination);

      this._bgmGain            = this._ctx.createGain();
      this._bgmGain.gain.value = 0.35;
      this._bgmGain.connect(this._masterGain);

      this._sfxGain            = this._ctx.createGain();
      this._sfxGain.gain.value = 1.0;
      this._sfxGain.connect(this._masterGain);

      this._rainGain            = this._ctx.createGain();
      this._rainGain.gain.value = 0.20;
      this._rainGain.connect(this._masterGain);

      this._started = true;
      this._startAmbientDrone();
      this._startRainAmbient();
    } catch (_e) {
      // Web Audio API not supported — fail silently.
    }
  }

  // ── Ambient BGM: layered cyberpunk drone ────────────────────────────────────

  _startAmbientDrone() {
    const ctx = this._ctx;
    const layers = [
      { type: 'sawtooth', freq: 55,  gain: 0.45, lfoRate: 0.07, lfoDepth: 0.6  },
      { type: 'sine',     freq: 110, gain: 0.25, lfoRate: 0.11, lfoDepth: 1.2  },
      { type: 'sine',     freq: 165, gain: 0.12, lfoRate: 0.05, lfoDepth: 2.0  },
      { type: 'square',   freq: 55,  gain: 0.08, lfoRate: 0.13, lfoDepth: 0.4  },
    ];

    for (const layer of layers) {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      const lpf  = ctx.createBiquadFilter();
      const lfo  = ctx.createOscillator();
      const lfoG = ctx.createGain();

      osc.type            = layer.type;
      osc.frequency.value = layer.freq;

      lfo.type            = 'sine';
      lfo.frequency.value = layer.lfoRate;
      lfoG.gain.value     = layer.lfoDepth;
      lfo.connect(lfoG);
      lfoG.connect(osc.frequency);

      lpf.type            = 'lowpass';
      lpf.frequency.value = 600;
      lpf.Q.value         = 1.5;
      gain.gain.value     = layer.gain;

      osc.connect(lpf);
      lpf.connect(gain);
      gain.connect(this._bgmGain);

      osc.start();
      lfo.start();
    }
  }

  // ── Rain ambient: looping filtered white-noise buffer ──────────────────────

  _startRainAmbient() {
    const ctx    = this._ctx;
    const bufLen = ctx.sampleRate * 3;   // 3-second loop
    const buffer = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data   = buffer.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

    const source  = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop   = true;

    const bp         = ctx.createBiquadFilter();
    bp.type          = 'bandpass';
    bp.frequency.value = 3200;
    bp.Q.value       = 0.4;

    const hp         = ctx.createBiquadFilter();
    hp.type          = 'highpass';
    hp.frequency.value = 1800;

    source.connect(bp);
    bp.connect(hp);
    hp.connect(this._rainGain);
    source.start();
  }

  // ── SFX: crystal / jewel pickup ─────────────────────────────────────────────

  /**
   * @param {'normal'|'rare'|'legendary'} tier
   */
  playCrystalPickup(tier = 'normal') {
    if (!this._started) return;
    const ctx  = this._ctx;
    const now  = ctx.currentTime;

    const freqs = { normal: 880, rare: 1320, legendary: 1760 };
    const f     = freqs[tier] ?? 880;
    const dur   = tier === 'legendary' ? 0.52 : 0.30;

    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type   = 'triangle';
    osc.frequency.setValueAtTime(f * 0.70, now);
    osc.frequency.exponentialRampToValueAtTime(f, now + 0.06);
    gain.gain.setValueAtTime(0.38, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(gain);
    gain.connect(this._sfxGain);
    osc.start(now);
    osc.stop(now + dur);

    if (tier === 'legendary') {
      // Extra shimmer harmonic
      const osc2  = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type   = 'sine';
      osc2.frequency.value = f * 1.5;
      gain2.gain.setValueAtTime(0.18, now + 0.04);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.58);
      osc2.connect(gain2);
      gain2.connect(this._sfxGain);
      osc2.start(now + 0.04);
      osc2.stop(now + 0.58);
    }
  }

  // ── SFX: ability activation ─────────────────────────────────────────────────

  /**
   * @param {'blue'|'green'|'red'} faction
   * @param {string} [jobType]
   */
  playAbility(faction, jobType = '') {
    if (!this._started) return;
    const ctx = this._ctx;
    const now = ctx.currentTime;

    // Throttle to avoid audio spam when many AI agents fire simultaneously
    if (now - this._lastAbilityTs < this._abilitySoundCooldown) return;
    this._lastAbilityTs = now;

    switch (faction) {
      case 'blue':  this._sfxBlue(ctx, now, jobType);  break;
      case 'green': this._sfxGreen(ctx, now, jobType); break;
      case 'red':   this._sfxRed(ctx, now, jobType);   break;
    }
  }

  // Archive / Data Sniper — high-pitched digital zap
  _sfxBlue(ctx, now) {
    const osc  = ctx.createOscillator();
    const filt = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type   = 'square';
    osc.frequency.setValueAtTime(950, now);
    osc.frequency.exponentialRampToValueAtTime(1900, now + 0.04);
    osc.frequency.exponentialRampToValueAtTime(620,  now + 0.18);
    filt.type            = 'bandpass';
    filt.frequency.value = 1200;
    filt.Q.value         = 3;
    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.20);
    osc.connect(filt);
    filt.connect(gain);
    gain.connect(this._sfxGain);
    osc.start(now);
    osc.stop(now + 0.20);
  }

  // Life Forge — warm organic ascending chord
  _sfxGreen(ctx, now) {
    for (const [i, freq] of [440, 550, 660].entries()) {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      const t    = now + i * 0.04;
      osc.type   = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0,  t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.connect(gain);
      gain.connect(this._sfxGain);
      osc.start(t);
      osc.stop(t + 0.35);
    }
  }

  // Core Protocol — short percussive noise blast with pitch drop
  _sfxRed(ctx, now) {
    const bufSize = Math.floor(ctx.sampleRate * 0.04);
    const buf     = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const d       = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) d[i] = Math.random() * 2 - 1;

    const noise   = ctx.createBufferSource();
    noise.buffer  = buf;
    const filt    = ctx.createBiquadFilter();
    filt.type     = 'lowpass';
    filt.frequency.value = 2400;
    const nGain   = ctx.createGain();
    nGain.gain.setValueAtTime(0.45, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    const osc   = ctx.createOscillator();
    const oGain = ctx.createGain();
    osc.type    = 'sawtooth';
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.22);
    oGain.gain.setValueAtTime(0.28, now);
    oGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    noise.connect(filt);
    filt.connect(nGain);
    nGain.connect(this._sfxGain);
    osc.connect(oGain);
    oGain.connect(this._sfxGain);
    noise.start(now);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  // ── SFX: agent elimination ──────────────────────────────────────────────────

  playElimination() {
    if (!this._started) return;
    const ctx  = this._ctx;
    const now  = ctx.currentTime;

    // Descending glitch sweep
    const osc1  = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type   = 'sawtooth';
    osc1.frequency.setValueAtTime(320, now);
    osc1.frequency.exponentialRampToValueAtTime(48, now + 0.35);
    gain1.gain.setValueAtTime(0.35, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
    osc1.connect(gain1);
    gain1.connect(this._sfxGain);
    osc1.start(now);
    osc1.stop(now + 0.38);

    // Sub-bass thud
    const osc2  = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type   = 'sine';
    osc2.frequency.setValueAtTime(130, now);
    osc2.frequency.exponentialRampToValueAtTime(28, now + 0.18);
    gain2.gain.setValueAtTime(0.45, now);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.20);
    osc2.connect(gain2);
    gain2.connect(this._sfxGain);
    osc2.start(now);
    osc2.stop(now + 0.20);
  }

  // ── SFX: chaos event ────────────────────────────────────────────────────────

  /**
   * @param {'emp_storm'|'crystal_rain'|'nexus_overload'} type
   */
  playChaosEvent(type) {
    if (!this._started) return;
    const ctx = this._ctx;
    const now = ctx.currentTime;

    if (type === 'emp_storm') {
      // Three rapid electric crackles
      for (let i = 0; i < 3; i++) {
        const t    = now + i * 0.09;
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type   = 'sawtooth';
        osc.frequency.value = 620 + Math.random() * 1400;
        gain.gain.setValueAtTime(0.28, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
        osc.connect(gain);
        gain.connect(this._sfxGain);
        osc.start(t);
        osc.stop(t + 0.09);
      }
    } else if (type === 'crystal_rain') {
      // Ascending magical sweep
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type   = 'triangle';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(2200, now + 0.65);
      gain.gain.setValueAtTime(0.32, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.70);
      osc.connect(gain);
      gain.connect(this._sfxGain);
      osc.start(now);
      osc.stop(now + 0.70);
    } else if (type === 'nexus_overload') {
      // Alternating alarm tones
      for (let i = 0; i < 4; i++) {
        const t    = now + i * 0.11;
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type   = 'square';
        osc.frequency.value = i % 2 === 0 ? 880 : 660;
        gain.gain.setValueAtTime(0.22, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
        osc.connect(gain);
        gain.connect(this._sfxGain);
        osc.start(t);
        osc.stop(t + 0.09);
      }
    }
  }

  // ── SFX: match-end fanfare ──────────────────────────────────────────────────

  /**
   * @param {'blue'|'green'|'red'} faction  — winning faction
   */
  playMatchEnd(faction) {
    if (!this._started) return;
    const ctx  = this._ctx;
    const now  = ctx.currentTime;

    // Faction-specific ascending arpeggios (frequencies in Hz)
    const scales = {
      blue:  [523.25, 659.25, 783.99, 1046.50],  // C5 – E5 – G5 – C6
      green: [440.00, 554.37, 659.25,  880.00],  // A4 – C#5 – E5 – A5
      red:   [392.00, 523.25, 659.25,  783.99],  // G4 – C5 – E5 – G5
    };
    const notes = scales[faction] ?? scales.blue;

    for (const [i, freq] of notes.entries()) {
      const t    = now + i * 0.19;
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type   = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0,  t);
      gain.gain.linearRampToValueAtTime(0.38, t + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.50);
      osc.connect(gain);
      gain.connect(this._sfxGain);
      osc.start(t);
      osc.stop(t + 0.50);
    }
  }
}
