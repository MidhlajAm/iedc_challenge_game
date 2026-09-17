/*
 * Tiny synthesised sound effects (Web Audio, no files).
 *
 * Phaser unlocks the audio context on the first tap/key press, which
 * is what iOS Safari requires. Until then every call here is a silent
 * no-op. The player can switch effects off on the crash screen; the
 * choice is saved in localStorage.
 */
const Sfx = {
  enabled: loadSoundSetting(GAME_CONFIG.SOUND_KEY, GAME_CONFIG.SOUND_ON_BY_DEFAULT),

  setEnabled(on) {
    Sfx.enabled = on;
    saveSoundSetting(GAME_CONFIG.SOUND_KEY, on);
  },

  /**
   * Call from every tap. Phaser unlocks audio on the first gesture, but
   * mobile browsers can suspend it again (app switch, phone call, lock
   * screen); resuming inside a user gesture is always allowed.
   */
  unlock(scene) {
    const ctx = scene.sound && scene.sound.context;
    if (ctx && ctx.state !== 'running' && ctx.resume) {
      ctx.resume().catch(() => {});
    }
  },

  /** Returns the Web Audio context, or null if audio isn't usable yet. */
  context(soundManager) {
    if (!soundManager || !soundManager.context || soundManager.locked) return null;
    if (soundManager.context.state !== 'running') return null;
    return soundManager.context;
  },

  /**
   * Play one tone. freq slides to endFreq over `duration` seconds.
   * `delay` (seconds) lets short melodies be scheduled in one call.
   */
  tone(scene, opts) {
    if (!Sfx.enabled) return;
    playTone(scene.sound, opts, GAME_CONFIG.SFX_VOLUME);
  },

  /** Short filtered noise burst (swish / crunch). */
  noise(scene, { duration = 0.1, filterFreq = 2000, endFilterFreq = filterFreq, volume = 1 }) {
    if (!Sfx.enabled) return;
    const ctx = Sfx.context(scene.sound);
    if (!ctx) return;

    // One second of white noise, created once per audio context
    if (!Sfx.noiseBuffer || Sfx.noiseBuffer.sampleRate !== ctx.sampleRate) {
      const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      Sfx.noiseBuffer = buffer;
    }

    const start = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = Sfx.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(filterFreq, start);
    filter.frequency.exponentialRampToValueAtTime(endFilterFreq, start + duration);
    const gain = ctx.createGain();
    const peak = GAME_CONFIG.SFX_VOLUME * volume;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(scene.sound.destination || ctx.destination);
    src.start(start, Math.random() * 0.5);
    src.stop(start + duration + 0.02);
  },

  /** Quick soft swish when changing lanes. */
  laneChange(scene) {
    Sfx.noise(scene, { duration: 0.09, filterFreq: 1200, endFilterFreq: 3200, volume: 0.35 });
  },

  /** Short rising blip; pitch climbs with the combo count. */
  nearMiss(scene, combo) {
    const base = 660 * Math.pow(1.06, Math.min(combo, 12));
    Sfx.tone(scene, { freq: base, endFreq: base * 1.5, duration: 0.09, type: 'triangle', volume: 0.7 });
  },

  /** Three-note rising chime. */
  milestone(scene) {
    [523, 659, 784].forEach((f, i) => {
      Sfx.tone(scene, { freq: f, duration: 0.14, type: 'square', volume: 0.35, delay: i * 0.08 });
    });
  },

  /** Crunch plus a low descending thud. */
  crash(scene) {
    Sfx.noise(scene, { duration: 0.4, filterFreq: 900, endFilterFreq: 120, volume: 1.2 });
    Sfx.tone(scene, { freq: 180, endFreq: 40, duration: 0.35, type: 'sawtooth', volume: 0.6 });
  },
};

// ------------------------------------------------------------
//  Shared helpers (also used by js/music.js)
// ------------------------------------------------------------
/** Oscillator with a click-free envelope, routed through Phaser's master. */
function playTone(soundManager, { freq, endFreq = freq, duration = 0.1, type = 'sine', volume = 1, delay = 0, at = null }, masterVolume) {
  const ctx = Sfx.context(soundManager);
  if (!ctx) return;

  const start = at !== null ? at : ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (endFreq !== freq) osc.frequency.exponentialRampToValueAtTime(endFreq, start + duration);

  const peak = masterVolume * volume;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.connect(gain);
  gain.connect(soundManager.destination || ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

function loadSoundSetting(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === '1';
  } catch (e) {
    return fallback;
  }
}

function saveSoundSetting(key, on) {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch (e) {
    // Storage blocked — the setting just won't be remembered
  }
}
