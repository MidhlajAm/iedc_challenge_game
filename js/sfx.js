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

  // Decoded recorded clips, by their name in SFX_CLIPS
  buffers: {},

  /**
   * Fetch and decode the recorded clips (see SFX_CLIPS) in the
   * background. Called from create(), not preload(), so a slow campus
   * connection never delays the first run, and deliberately not through
   * Phaser's loader: a browser that cannot decode one of these files
   * would leave that loader stuck mid-load forever. Anything that goes
   * wrong here is ignored — the synthesised version plays instead.
   */
  loadClips(scene) {
    const ctx = scene.sound && scene.sound.context;
    if (!ctx || Sfx.clipsRequested) return;
    Sfx.clipsRequested = true;

    // Older Safari only has the callback form of decodeAudioData
    const decode = (data) => new Promise((resolve, reject) => {
      const maybe = ctx.decodeAudioData(data, resolve, reject);
      if (maybe && maybe.then) maybe.then(resolve, reject);
    });

    Object.entries(GAME_CONFIG.SFX_CLIPS).forEach(([name, clip]) => {
      fetch(clip.file)
        .then((res) => res.arrayBuffer())
        .then(decode)
        .then((buffer) => { Sfx.buffers[name] = buffer; })
        .catch(() => {});
    });
  },

  /**
   * Play one recorded clip by its name in SFX_CLIPS. Returns false if
   * it hasn't arrived yet (or audio isn't unlocked), so callers can fall
   * back to the synthesised version.
   */
  clip(scene, name) {
    if (!Sfx.enabled) return false;
    const buffer = Sfx.buffers[name];
    if (!buffer) return false;
    const ctx = Sfx.context(scene.sound);
    if (!ctx) return false;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = GAME_CONFIG.SFX_CLIPS[name].volume;
    src.connect(gain);
    gain.connect(scene.sound.destination || ctx.destination);
    src.start();
    return true;
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

  /**
   * Filtered noise: the building block for wind, rumble and explosions.
   * filter 'lowpass' keeps the body and cuts the hiss (thunder, blasts);
   * 'bandpass' picks out a narrow band (swishes, air rush).
   * `attack` is how long it takes to swell in — long for a distant
   * rumble, near-instant for an explosion.
   */
  noise(scene, {
    duration = 0.1, filterFreq = 2000, endFilterFreq = filterFreq, volume = 1,
    filter: filterType = 'bandpass', q = 1, attack = 0.01, delay = 0,
  }) {
    if (!Sfx.enabled) return;
    const ctx = Sfx.context(scene.sound);
    if (!ctx) return;

    // Two seconds of white noise, created once per audio context
    if (!Sfx.noiseBuffer || Sfx.noiseBuffer.sampleRate !== ctx.sampleRate) {
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      Sfx.noiseBuffer = buffer;
    }

    const start = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = Sfx.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(filterFreq, start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, endFilterFreq), start + duration);
    const gain = ctx.createGain();
    const peak = GAME_CONFIG.SFX_VOLUME * volume;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + Math.min(attack, duration * 0.8));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(scene.sound.destination || ctx.destination);
    src.start(start, Math.random() * 1.5);
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

  /**
   * A failing jet passing overhead: turbine tone sliding down as it
   * falls away, over the rush of air. Two slightly detuned tones make it
   * sound like an engine rather than a single beep.
   */
  planeFalling(scene) {
    Sfx.tone(scene, { freq: 430, endFreq: 150, duration: 2.0, type: 'triangle', volume: 0.16 });
    Sfx.tone(scene, { freq: 437, endFreq: 152, duration: 2.0, type: 'sine', volume: 0.14 });
    Sfx.tone(scene, { freq: 860, endFreq: 300, duration: 2.0, type: 'sine', volume: 0.07 });
    Sfx.noise(scene, { duration: 2.0, filterFreq: 900, endFilterFreq: 260, volume: 0.3, filter: 'bandpass', q: 0.8, attack: 0.5 });
  },

  /**
   * The crash: a sharp low blast, a sub-bass thump you feel more than
   * hear, then a longer tail of debris and fire.
   */
  planeImpact(scene) {
    if (Sfx.clip(scene, 'impact')) return;   // recorded impact, if it has loaded
    Sfx.noise(scene, { duration: 1.0, filterFreq: 1400, endFilterFreq: 90, volume: 1.1, filter: 'lowpass', q: 0.7, attack: 0.004 });
    Sfx.tone(scene, { freq: 78, endFreq: 30, duration: 0.8, type: 'sine', volume: 0.9 });
    Sfx.noise(scene, { duration: 1.9, filterFreq: 500, endFilterFreq: 110, volume: 0.35, filter: 'lowpass', q: 0.6, attack: 0.25, delay: 0.12 });
  },

  /**
   * Distant eruption: a long, deep rumble that swells and fades, like
   * thunder rolling in, with a sub-bass layer underneath.
   */
  rumble(scene) {
    if (Sfx.clip(scene, 'volcano')) return;  // recorded eruption, if it has loaded
    Sfx.noise(scene, { duration: 3.2, filterFreq: 130, endFilterFreq: 45, volume: 0.95, filter: 'lowpass', q: 0.6, attack: 0.9 });
    Sfx.noise(scene, { duration: 2.6, filterFreq: 420, endFilterFreq: 150, volume: 0.3, filter: 'lowpass', q: 0.5, attack: 1.1 });
    Sfx.tone(scene, { freq: 44, endFreq: 28, duration: 3.0, type: 'sine', volume: 0.55 });
  },

  /** Bright rising sting for passing someone on the leaderboard. */
  overtake(scene) {
    [660, 880, 1320].forEach((freq, i) => {
      Sfx.tone(scene, { freq, duration: 0.13, type: 'triangle', volume: 0.38, delay: i * 0.08 });
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
function playTone(soundManager, { freq, endFreq = freq, duration = 0.1, type = 'sine', volume = 1, delay = 0, at = null, attack = 0.01 }, masterVolume) {
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
  gain.gain.exponentialRampToValueAtTime(peak, start + Math.min(attack, duration * 0.8));
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
