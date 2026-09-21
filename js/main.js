/*
 * Boots Phaser. The Scale Manager in FIT mode keeps the portrait
 * design resolution fully visible on any screen shape.
 *
 * The canvas is RENDER_SCALE times the design size for sharpness;
 * GameScene zooms its camera by the same factor, so game code still
 * works in WIDTH x HEIGHT world units.
 */

// --- URL overrides for real-device testing (no code edits needed) ---
//   ?view=back     or  ?view=top
//   ?input=swipe   or  ?input=tap
//   ?fps           show the frame-rate counter
//   ?events        volcano and plane crashes start almost straight away
//   ?rivals        fake leaderboard rivals, to try the chase marker
//   ?weather       short day/night + weather stretches, to see them all
//   ?scale=1       render at 1x (check if a slow phone gets smoother)
// Combine with &, e.g.  ?view=back&fps
(function applyUrlOverrides() {
  // Steering chosen in Settings (the URL still wins, for testing)
  try {
    const saved = localStorage.getItem(GAME_CONFIG.INPUT_KEY);
    if (saved === 'tap' || saved === 'swipe') GAME_CONFIG.INPUT_MODE = saved;
  } catch (e) { /* storage blocked */ }

  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  if (view === 'top' || view === 'back') GAME_CONFIG.VIEW_MODE = view;
  const input = params.get('input');
  if (input === 'tap' || input === 'swipe') GAME_CONFIG.INPUT_MODE = input;
  if (params.has('fps')) GAME_CONFIG.SHOW_FPS = true;
  // ?events  brings the volcano and plane crashes forward, for testing
  // them without playing a full run first
  if (params.has('events')) {
    // The first of each comes early, but repeats stay as far apart as
    // they are in a real run: seeing them back to back is misleading
    // (and tiring), which is the opposite of what this is for.
    GAME_CONFIG.VOLCANO.FROM_SCORE = 300;
    GAME_CONFIG.AIRPLANE.FROM_SCORE = 700;
    GAME_CONFIG.VOLCANO.EVERY = 10000;
    GAME_CONFIG.AIRPLANE.GAP = 11000;
  }
  // ?rivals  fakes a few leaderboard players just above you, so the
  // chase marker can be tried without a Firebase connection
  if (params.has('rivals')) {
    OnlineScores.rivals = [
      { name: 'Aisha', score: 250 },
      { name: 'Vishnu', score: 600 },
      { name: 'Fathima K', score: 1200 },
      { name: 'Arjun', score: 2500 },
    ];
    OnlineScores.rank = { rank: 5, total: 12 };
  }
  // ?weather  makes the stretches short, so the whole day/night and
  // weather cycle can be seen in one quick run
  if (params.has('weather')) {
    GAME_CONFIG.WEATHER.LENGTH = 3000;
    GAME_CONFIG.WEATHER.BLEND = 700;
  }
  const scale = parseInt(params.get('scale'), 10);
  if (scale >= 1 && scale <= 3) GAME_CONFIG.RENDER_SCALE = scale;
})();

// --- Back view fills tall phone screens: stretch the visible height to
// the screen's shape (gameplay distances are unaffected). Wider screens
// such as tablets and desktops keep the standard 9:16 box. ---
if (GAME_CONFIG.VIEW_MODE === 'back') {
  const aspect = window.innerHeight / window.innerWidth;
  const fitted = Math.round(GAME_CONFIG.WIDTH * aspect);
  GAME_CONFIG.VIEW_HEIGHT = Phaser.Math.Clamp(fitted, GAME_CONFIG.HEIGHT, GAME_CONFIG.MAX_VIEW_HEIGHT);
}

// --- Letterbox bars: on very tall phones the space above and below the game
// is coloured to continue the scene (sky on top, road below) ---
if (GAME_CONFIG.VIEW_MODE === 'back') {
  const hex = (c) => '#' + c.toString(16).padStart(6, '0');
  document.body.style.background =
    `linear-gradient(to bottom, ${hex(GAME_CONFIG.COLORS.SKY_TOP)} 0 50%, ${hex(GAME_CONFIG.COLORS.ROAD)} 50% 100%)`;
}

// --- Portrait only: while a phone is held sideways the game waits ---
// (index.html shows the "rotate your phone" cover with the same query)
const landscapeQuery = window.matchMedia('(orientation: landscape) and (max-height: 540px)');
window.ORIENTATION_BLOCKED = landscapeQuery.matches;
const onOrientationChange = () => { window.ORIENTATION_BLOCKED = landscapeQuery.matches; };
if (landscapeQuery.addEventListener) landscapeQuery.addEventListener('change', onOrientationChange);
else landscapeQuery.addListener(onOrientationChange); // older iOS Safari

// --- Intro screen when the page opens (the game waits behind it) ---
// index.html?play skips it for returning players, e.g. from the leaderboard.
const skipIntro = new URLSearchParams(window.location.search).has('play') && !!PlayerName.get();
window.OVERLAY_OPEN = !skipIntro;

// --- Online scores: upload queue (works offline, retries in the background) ---
OnlineScores.init();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_CONFIG.WIDTH * GAME_CONFIG.RENDER_SCALE,
  height: GAME_CONFIG.VIEW_HEIGHT * GAME_CONFIG.RENDER_SCALE,
  backgroundColor: GAME_CONFIG.COLORS.BACKGROUND,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: {
    activePointers: 3,        // two thumbs can alternate quickly
  },
  disableContextMenu: true,
  // Phaser smooths the frame time it reports, pulling it toward the 60fps
  // target. On a phone that can only manage, say, 20fps that means the
  // game is told 16ms passed when 50ms really did: the whole game runs in
  // slow motion, the player gets more reaction time than intended, and
  // the run reports a fraction of the time it really took. That makes
  // scores from different phones incomparable, which matters when a
  // leaderboard decides a prize. Raw frame time is honest on every
  // device; GameScene.tick already clamps a lag spike so nothing
  // teleports.
  fps: {
    smoothStep: false,
  },
  render: {
    powerPreference: 'high-performance',
  },
  scene: [GameScene],
});

// Background music lives outside the scene so restarts don't cut it off
game.events.once(Phaser.Core.Events.READY, () => Music.init(game.sound));

Menu.init(game);
if (window.OVERLAY_OPEN) Menu.showIntro();
