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
//   ?scale=1       render at 1x (check if a slow phone gets smoother)
// Combine with &, e.g.  ?view=back&fps
(function applyUrlOverrides() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  if (view === 'top' || view === 'back') GAME_CONFIG.VIEW_MODE = view;
  const input = params.get('input');
  if (input === 'tap' || input === 'swipe') GAME_CONFIG.INPUT_MODE = input;
  if (params.has('fps')) GAME_CONFIG.SHOW_FPS = true;
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
  render: {
    powerPreference: 'high-performance',
  },
  scene: [GameScene],
});

// Background music lives outside the scene so restarts don't cut it off
game.events.once(Phaser.Core.Events.READY, () => Music.init(game.sound));
