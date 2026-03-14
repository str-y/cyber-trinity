const REPLAY_SAMPLE_INTERVAL = 0.1;
const REPLAY_STORAGE_KEY = 'cyber-trinity:last-replay';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export class ReplayManager {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.frames = [];
    this.savedReplay = null;
    this.recordingFinished = false;
    this._recordAccumulator = 0;
    this.playbackTime = 0;
    this.playbackSpeed = 1;
    this.isPlaying = false;
    this.isActive = false;
    this.activeFrameIndex = 0;
  }

  beginRecording() {
    this.reset();
    this.recordFrame(true);
  }

  recordFrame(force = false) {
    if (this.recordingFinished) return;
    if (!force) {
      this._recordAccumulator += this.game._lastDt ?? 0;
      if (this._recordAccumulator < REPLAY_SAMPLE_INTERVAL) return;
    }
    this._recordAccumulator = 0;
    this.frames.push(this.game.captureReplayFrame());
  }

  finalizeRecording() {
    if (this.recordingFinished) return this.savedReplay;
    this.recordFrame(true);
    const duration = round(this.frames.at(-1)?.elapsed ?? 0, 2);
    this.savedReplay = {
      version: 1,
      createdAt: new Date().toISOString(),
      duration,
      frameRate: Math.round(1 / REPLAY_SAMPLE_INTERVAL),
      winnerFaction: this.game.winnerFaction,
      frames: this.frames,
    };
    this.recordingFinished = true;
    try {
      localStorage.setItem(REPLAY_STORAGE_KEY, JSON.stringify(this.savedReplay));
    } catch {
      // Ignore quota/storage failures and keep the in-memory replay available.
    }
    return this.savedReplay;
  }

  get hasReplay() {
    return !!this.savedReplay && this.savedReplay.frames.length > 0;
  }

  get duration() {
    return this.savedReplay?.duration ?? 0;
  }

  enterPlayback() {
    if (!this.hasReplay) return false;
    this.isActive = true;
    this.isPlaying = false;
    this.playbackTime = 0;
    this.activeFrameIndex = 0;
    this.game.resetReplayCamera();
    this.game.restoreReplayFrame(this.savedReplay.frames[0]);
    return true;
  }

  exitPlayback() {
    if (!this.hasReplay) return;
    this.isActive = false;
    this.isPlaying = false;
    const finalFrame = this.savedReplay.frames.at(-1);
    if (finalFrame) this.game.restoreReplayFrame(finalFrame);
  }

  togglePlayback() {
    if (!this.isActive && !this.enterPlayback()) return false;
    this.isPlaying = !this.isPlaying;
    return this.isPlaying;
  }

  setPlaybackSpeed(speed) {
    this.playbackSpeed = clamp(Number(speed) || 1, 0.25, 4);
  }

  seek(time) {
    if (!this.hasReplay) return;
    const clamped = clamp(Number(time) || 0, 0, this.duration);
    this.playbackTime = clamped;
    const frames = this.savedReplay.frames;
    let low = 0;
    let high = frames.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if ((frames[mid]?.elapsed ?? 0) <= clamped) low = mid;
      else high = mid - 1;
    }
    this.activeFrameIndex = low;
    this.game.restoreReplayFrame(frames[low]);
  }

  update(dt) {
    if (!this.isActive || !this.isPlaying || !this.hasReplay) return;
    const nextTime = this.playbackTime + dt * this.playbackSpeed;
    if (nextTime >= this.duration) {
      this.seek(this.duration);
      this.isPlaying = false;
      return;
    }
    this.seek(nextTime);
  }

  exportReplay() {
    if (!this.hasReplay) return null;
    return JSON.stringify(this.savedReplay, null, 2);
  }

  getHudState() {
    return {
      available: this.hasReplay,
      active: this.isActive,
      playing: this.isPlaying,
      speed: this.playbackSpeed,
      duration: this.duration,
      time: this.isActive ? this.playbackTime : this.duration,
      storedFrames: this.savedReplay?.frames.length ?? 0,
    };
  }

  static round = round;
}
