/*
 * Intro screen and settings (plain HTML in index.html, over the game).
 *
 * - The intro shows when the page opens: Play, Leaderboard, Settings,
 *   plus the player's name, best score and rank once they've played.
 * - Restarting after a crash never comes back here, so a restart stays
 *   instant. Opening index.html?play skips the intro (the leaderboard's
 *   Play button uses this).
 * - While any screen is open, window.OVERLAY_OPEN pauses the game.
 * - The player name is set once, on the first Play, and can't be changed.
 */
const Menu = {
  el: null,

  init(game) {
    Menu.game = game;
    Menu.el = {
      intro: document.getElementById('intro'),
      settings: document.getElementById('settings'),
      play: document.getElementById('btn-play'),
      openSettings: document.getElementById('btn-settings'),
      player: document.getElementById('intro-player'),
      name: document.getElementById('intro-name'),
      best: document.getElementById('intro-best'),
      rank: document.getElementById('intro-rank'),
      howto: document.getElementById('howto'),
      sound: document.getElementById('set-sound'),
      music: document.getElementById('set-music'),
      inputButtons: document.querySelectorAll('.segmented button[data-input]'),
      done: document.getElementById('settings-done'),
    };
    const el = Menu.el;

    el.play.addEventListener('click', Menu.play);
    el.openSettings.addEventListener('click', Menu.openSettings);
    el.done.addEventListener('click', Menu.closeSettings);

    el.sound.addEventListener('click', () => {
      Sfx.setEnabled(!Sfx.enabled);
      Menu.refreshSettings();
    });
    el.music.addEventListener('click', () => {
      Music.setEnabled(!Music.enabled);
      Menu.refreshSettings();
    });
    el.inputButtons.forEach((button) => {
      button.addEventListener('click', () => {
        Menu.setInputMode(button.dataset.input);
        Menu.refreshSettings();
      });
    });

    // Desktop keyboard: Enter plays, Escape closes settings
    document.addEventListener('keydown', (event) => {
      const nameOpen = !document.getElementById('name-entry').hidden;
      if (nameOpen) return;
      if (event.key === 'Escape' && !el.settings.hidden) Menu.closeSettings();
      else if (event.key === 'Enter' && !el.intro.hidden && el.settings.hidden &&
        !(event.target.closest && event.target.closest('a, button'))) Menu.play(); // focused buttons handle Enter themselves
    });

    // Best score and rank arrive from the database after start-up
    window.addEventListener('best-loaded', () => Menu.refreshPlayer());
  },

  showIntro() {
    window.OVERLAY_OPEN = true;
    Menu.refreshPlayer();
    Menu.el.intro.hidden = false;
    Menu.el.play.focus({ preventScroll: true });
  },

  /** Play: ask for a name first on the very first visit, then start a fresh run. */
  play() {
    if (!PlayerName.get()) {
      Menu.el.intro.hidden = true;
      PlayerName.ask(() => Menu.startRun(), { onCancel: () => { Menu.el.intro.hidden = false; } });
      return;
    }
    Menu.startRun();
  },

  startRun() {
    Menu.el.intro.hidden = true;
    Menu.el.settings.hidden = true;
    window.OVERLAY_OPEN = false;
    // Restart so the run (and its server timing) begins now, with the
    // controls chosen in settings
    const scene = Menu.game.scene.getScene('GameScene');
    if (scene && scene.sys.isActive()) scene.scene.restart();
  },

  openSettings() {
    Menu.refreshSettings();
    Menu.el.settings.hidden = false;
    Menu.el.done.focus({ preventScroll: true });
  },

  closeSettings() {
    Menu.el.settings.hidden = true;
    Menu.refreshPlayer();
    Menu.el.openSettings.focus({ preventScroll: true });
  },

  refreshSettings() {
    const el = Menu.el;
    el.sound.setAttribute('aria-checked', String(Sfx.enabled));
    el.music.setAttribute('aria-checked', String(Music.enabled));
    el.inputButtons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.input === GAME_CONFIG.INPUT_MODE));
    });
  },

  /** Name, best score and rank on the intro screen. */
  refreshPlayer() {
    const el = Menu.el;
    const name = PlayerName.get();
    el.player.hidden = !name;
    el.howto.textContent = GAME_CONFIG.INPUT_MODE === 'swipe'
      ? 'Swipe left or right to change lanes'
      : 'Tap the left or right side of the screen to change lanes';
    if (!name) return;

    el.name.textContent = name;
    const best = OnlineScores.best;
    el.best.textContent = best ? best.toLocaleString('en-IN') : '-';
    el.rank.textContent = '-';
    if (best) {
      OnlineScores.rankOf(best).then((position) => {
        if (position) el.rank.textContent = '#' + position.rank;
      });
    }
  },

  /** Tap or swipe steering, remembered on this phone. */
  setInputMode(mode) {
    GAME_CONFIG.INPUT_MODE = mode;
    try {
      localStorage.setItem(GAME_CONFIG.INPUT_KEY, mode);
    } catch (e) {
      // Storage blocked: applies for this visit only
    }
  },
};
