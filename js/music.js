/*
 * Light background music, synthesised (no audio file to download).
 *
 * A 4-bar loop (Am - F - C - G): a soft bass on eighth notes plus a
 * gentle arpeggio. Notes are scheduled slightly ahead of time with a
 * small timer, the standard Web Audio way to keep rhythm steady.
 *
 * Off by default (GAME_CONFIG.MUSIC_ON_BY_DEFAULT); the player toggles
 * it on the crash screen. Lives outside the scene, so a restart does
 * not interrupt the song.
 */
const Music = {
  enabled: loadSoundSetting(GAME_CONFIG.MUSIC_KEY, GAME_CONFIG.MUSIC_ON_BY_DEFAULT),
  soundManager: null,
  timer: null,
  step: 0,          // position in the loop, in eighth notes
  nextTime: 0,      // audio-clock time of the next eighth note

  // Chord roots (bass) and arpeggio notes per bar, in Hz
  BARS: [
    { bass: 110.00, arp: [220.00, 261.63, 329.63, 261.63] }, // Am
    { bass: 87.31,  arp: [174.61, 220.00, 261.63, 220.00] }, // F
    { bass: 130.81, arp: [196.00, 261.63, 329.63, 261.63] }, // C
    { bass: 98.00,  arp: [196.00, 246.94, 293.66, 246.94] }, // G
  ],

  /** Call once with game.sound; starts playing if the saved setting is on. */
  init(soundManager) {
    Music.soundManager = soundManager;
    if (Music.enabled) Music.start();
  },

  setEnabled(on) {
    Music.enabled = on;
    saveSoundSetting(GAME_CONFIG.MUSIC_KEY, on);
    if (on) Music.start();
    else Music.stop();
  },

  start() {
    if (Music.timer) return;
    Music.nextTime = 0;
    Music.timer = setInterval(Music.schedule, 50);
  },

  stop() {
    clearInterval(Music.timer);
    Music.timer = null;
  },

  /** Queue every note that starts within the next 150ms. */
  schedule() {
    const ctx = Sfx.context(Music.soundManager);
    if (!ctx) {
      Music.nextTime = 0; // audio locked or suspended: start fresh later
      return;
    }
    const eighth = 60 / GAME_CONFIG.MUSIC_BPM / 2;
    if (Music.nextTime < ctx.currentTime) Music.nextTime = ctx.currentTime + 0.05;

    while (Music.nextTime < ctx.currentTime + 0.15) {
      const bar = Music.BARS[Math.floor(Music.step / 8) % Music.BARS.length];
      const beat = Music.step % 8;
      const vol = GAME_CONFIG.MUSIC_VOLUME;

      // Bass: every eighth, accent on the beat
      playTone(Music.soundManager, {
        freq: bar.bass, duration: eighth * 0.9, type: 'triangle',
        volume: beat % 2 === 0 ? 1 : 0.55, at: Music.nextTime,
      }, vol);

      // Arpeggio: one note per eighth, cycling the chord
      playTone(Music.soundManager, {
        freq: bar.arp[beat % bar.arp.length] * 2, duration: eighth * 0.8, type: 'sine',
        volume: 0.35, at: Music.nextTime,
      }, vol);

      Music.nextTime += eighth;
      Music.step = (Music.step + 1) % (8 * Music.BARS.length);
    }
  },
};
