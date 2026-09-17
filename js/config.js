/*
 * ============================================================
 *  GAME CONFIG — every tunable number lives here.
 *  Tweak values in this file; you should not need to hunt
 *  through the game code to change how the game feels.
 * ============================================================
 */
const GAME_CONFIG = {
  // --- Screen (design resolution, portrait). The Scale Manager
  //     fits this box into any real screen size. All positions and
  //     sizes below are in these "world" units. ---
  WIDTH: 450,
  HEIGHT: 800,

  // Internal render resolution multiplier. 2 = draw at 900x1600 so
  // cars and text stay sharp on phone screens. Drop to 1 if a weak
  // phone struggles to hold 60fps.
  RENDER_SCALE: 2,

  // --- Road / lanes ---
  LANE_COUNT: 4,
  ROAD_MARGIN: 45,            // grass + kerb on each side of the road
  ROAD_TILE_HEIGHT: 120,      // repeat length of the lane dashes

  // --- Cars (player and obstacles share one size) ---
  CAR_WIDTH: 56,
  CAR_HEIGHT: 100,

  // --- Player car ---
  PLAYER_Y: 670,              // vertical centre of the player car
  PLAYER_START_LANE: 1,       // 0 = leftmost lane
  LANE_TWEEN_MS: 110,         // how long a lane change slide takes
  LANE_TILT_DEG: 8,           // car leans into a lane change

  // --- Obstacle cars ---
  OBSTACLE_POOL_SIZE: 20,     // max obstacles that can exist at once

  // --- Difficulty ---
  // "Progress" = distance points (score without bonuses), so near-miss
  // bonuses don't make the game speed up faster.
  // Speed eases from BASE_SPEED toward MAX_SPEED:
  //   speed = BASE + (MAX - BASE) * (1 - e^(-progress / SPEED_RAMP_POINTS))
  // With these values: ~465 at 10s, ~555 at 30s, ~690 at 60s, ~800 at 90s.
  BASE_SPEED: 420,            // world units per second at the start
  MAX_SPEED: 1050,            // never faster than this
  SPEED_RAMP_POINTS: 6000,    // bigger = slower ramp

  // Distance between obstacle rows shrinks as speed rises (more rows/sec)
  SPAWN_GAP_START: 400,
  SPAWN_GAP_END: 365,         // keep >= ~365 so a 1-lane dodge fits at MAX_SPEED
  FIRST_ROW_DELAY_PX: 500,    // extra empty road at the start of a run

  // --- Fair spawning ---
  // Rows are picked from these known patterns. 'X' = car, '.' = open lane.
  // Each pattern must have LANE_COUNT characters and at least one '.'.
  // `from` = progress points before the pattern can appear.
  PATTERNS: [
    { from: 0,    rows: ['X...', '.X..', '..X.', '...X', 'XX..', '..XX', 'X..X'] },
    { from: 400,  rows: ['.XX.', 'X.X.', '.X.X'] },
    { from: 1500, rows: ['XXX.', '.XXX', 'XX.X', 'X.XX'] },
  ],
  // Every new row must be reachable from the previous row's open lanes.
  // The player gets one lane of sideways movement per LANE_STEP_MS of
  // clear road between rows. Raise this to make spawns more forgiving.
  LANE_STEP_MS: 150,

  // --- Collision ---
  HITBOX_SHRINK: 0.15,        // shrink hitboxes by this fraction (forgiving)

  // --- Scoring ---
  PIXELS_PER_POINT: 10,       // 1 distance point per this many units
  MILESTONE_EVERY: 500,       // flash + sound every N points

  // --- Near miss & combo ---
  // A near miss = leaving a car's lane when it was about to hit you
  // (less than NEAR_MISS_MS from impact), then letting it pass.
  NEAR_MISS_MS: 250,
  NEAR_MISS_BONUS: 25,        // points, multiplied by the combo
  COMBO_STEP: 0.5,            // multiplier added per consecutive near miss
  COMBO_MAX: 3,               // multiplier cap
  COMBO_TIMEOUT_MS: 3000,     // combo resets after this long without one

  // --- Game over ---
  RESTART_LOCKOUT_MS: 300,    // ignore input briefly after a crash
  CRASH_SHAKE_MS: 280,
  CRASH_SHAKE_INTENSITY: 0.015,
  CRASH_CARD_DELAY_MS: 220,   // let the crash register before the card

  // --- Storage ---
  BEST_SCORE_KEY: 'iedcRush.best',

  // --- Sound effects (synthesised, no files) ---
  SFX_VOLUME: 0.25,

  // --- Input ---
  // 'tap'   = tap the left / right half of the screen (moves instantly)
  // 'swipe' = drag left / right; keep dragging to cross more lanes
  // Try both on a real phone: add ?input=swipe to the URL to test swipe.
  INPUT_MODE: 'tap',
  SWIPE_MIN_PX: 28,           // drag distance (world units) per lane

  // --- Camera view ---
  // 'top'  = looking straight down at the road (original)
  // 'back' = chase camera behind the player's car, road to the horizon
  // Gameplay is identical in both; only the drawing changes.
  // Switch for one visit with ?view=top or ?view=back in the URL.
  VIEW_MODE: 'back',

  // Visible height in world units. Gameplay always uses HEIGHT (800);
  // in the back view main.js stretches VIEW_HEIGHT to match a tall
  // phone screen (up to MAX_VIEW_HEIGHT) so there are no empty bands.
  VIEW_HEIGHT: 800,
  MAX_VIEW_HEIGHT: 1000,

  // Back view tuning (world units unless noted)
  BACK_VIEW: {
    HORIZON_FRACTION: 0.24,     // horizon position, as a fraction of screen height
    PLAYER_GROUND_FRACTION: 0.9,// where the player's tyres sit (leaves room above the gesture bar)
    ROAD_WIDTH_AT_PLAYER: 480,  // road width at the player; wider = camera closer, bigger cars
                                // (above ~490 the outer lanes start to leave the screen)
    PERSPECTIVE_K: 360,         // smaller = stronger perspective (far cars smaller)
    CRASH_OVERLAP_PX: 6,        // at a crash, the car ahead visibly overlaps the player's roof by this much
    DRAW_DISTANCE: 1600,        // how far ahead road bands / scenery are drawn
    MARKINGS_DISTANCE: 1200,    // how far ahead dashes and kerb stripes are drawn
    CATS_EYE_DISTANCE: 700,     // how far ahead road reflectors are drawn
    BAND_LENGTH: 80,            // length of each light/dark grass stretch
    FADE_IN_DISTANCE: 120,      // new cars fade in over this distance
    SCENERY_SPACING: 150,       // distance between roadside trees/lamps

    // The further you drive, the more happens around you.
    // Road works: roadside cones, barriers, workers and diggers
    // (decoration only — never in the lanes, so gameplay is unchanged)
    ROADWORKS_FROM_POINTS: 800, // first zone starts this far into a run (~17s)
    ROADWORKS_EVERY: 5000,      // a new zone every this much road
    ROADWORKS_LENGTH: 1500,     // how long each zone lasts
    ROADWORKS_WARNING: 300,     // "road works ahead" sign this far before a zone
    // Birds flying across the sky
    BIRDS_FROM_POINTS: 300,     // birds start appearing this far into a run (~7s)
    BIRD_FLOCK_SIZE: 5,
    BIRD_SPEED: 55,             // screen px per second
    BIRD_GAP_MIN_MS: 5000,      // wait between flocks
    BIRD_GAP_MAX_MS: 11000,
  },

  // --- Testing aids (can also be turned on from the URL) ---
  SHOW_FPS: false,            // ?fps   shows a frame-rate counter

  // --- UI ---
  FONT: '"Trebuchet MS", "Segoe UI", Roboto, Arial, sans-serif',
  HINT_DURATION_MS: 2500,     // "tap left / right" hint on first run

  // --- Colours ---
  COLORS: {
    BACKGROUND: 0x0d1117,
    GRASS: 0x4c9a3f,
    GRASS_DARK: 0x458d39,
    BUSH: 0x2f6f2a,
    ROAD: 0x3a3d44,
    ROAD_SPECKLE: 0x4a4e57,
    ROAD_EDGE: 0xf2f2f2,
    LANE_DASH: 0xe8e8e8,
    KERB_RED: 0xd83a3a,
    KERB_WHITE: 0xf5f5f5,
    SKY_TOP: 0x5aa9e6,
    SKY_HORIZON: 0xcdeaf7,
    HILLS: 0x7fb77e,
    MOUNTAINS: 0xa9c2d3,
    SKYLINE: 0xb8cad8,
    SKYLINE_WINDOWS: 0xe3edf4,
    SHOULDER: 0xb9a57c,
    CATS_EYE: 0xffe082,
    FLOWER: 0xffe082,
    ROCK: 0x8d8f94,
    LAMP_POST: 0x2b2f36,
    PLAYER: 0x1e88e5,
    CRASH_TINT: 0xff8080,
    HUD_PANEL: 0x0d1117,
    ACCENT: 0xffd54f,
  },

  // --- Traffic ---
  // Every obstacle vehicle that can appear. Types: 'sedan', 'taxi',
  // 'van', 'pickup'. All share CAR_WIDTH x CAR_HEIGHT, so the hitbox
  // is the same whatever is drawn. Add or remove entries freely.
  // (Avoid the player's blue so your own car is always easy to spot.)
  OBSTACLE_CARS: [
    { type: 'sedan',  color: 0xe53935 },
    { type: 'sedan',  color: 0x8e24aa },
    { type: 'sedan',  color: 0x43a047 },
    { type: 'sedan',  color: 0xeceff1 },
    { type: 'taxi',   color: 0xfdd835 },
    { type: 'van',    color: 0xf5f5f5 },
    { type: 'van',    color: 0x607d8b },
    { type: 'pickup', color: 0xfb8c00 },
    { type: 'pickup', color: 0x6d4c41 },
  ],

  // --- Sound ---
  // Players can switch these on the crash screen; their choice is saved.
  SOUND_ON_BY_DEFAULT: true,
  MUSIC_ON_BY_DEFAULT: false,
  MUSIC_VOLUME: 0.12,
  MUSIC_BPM: 112,
  SOUND_KEY: 'iedcRush.sound',
  MUSIC_KEY: 'iedcRush.music',
};
