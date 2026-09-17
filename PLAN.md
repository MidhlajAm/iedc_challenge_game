# PLAN.md

Phased build plan. Each phase has a **done condition** — do not move to the
next phase until it is met. Read CLAUDE.md first for the constraints that
apply throughout.

---

## Phase 0 — Setup

Get the skeleton standing. No gameplay yet.

- Initialise the repo, add `CLAUDE.md` and `PLAN.md` to the root.
- `index.html` loading Phaser 3 from CDN, a single `<canvas>`, no page scroll.
- A `config.js` (or a clearly-marked config block) holding every tunable game
  constant in one place: lane count, base speed, speed ramp rate, spawn
  interval, score-per-second, near-miss bonus, combo values.
- `.gitignore` covering the Firebase config file and any local env files.
- Confirm the page loads with an empty Phaser scene and no console errors.

**Done when:** a blank Phaser canvas fills the browser window cleanly on
desktop and on a phone.

---

## Phase 1 — Core loop, playable

Placeholder art only — coloured rectangles. Do not touch real assets.

- 3 or 4 lanes on a scrolling road.
- Player car, snapping between lanes with a short smooth tween (not an instant
  teleport — the movement should feel physical).
- Obstacle cars spawning at the top, moving down, despawning at the bottom.
- Collision detection between player and obstacles.
- Score incrementing with distance travelled, displayed on screen.
- Game-over state.
- Instant restart on tap / keypress.

**Done when:** you can play, crash, and restart repeatedly in a desktop
browser without reloading the page.

---

## Phase 2 — Difficulty and game feel

This is the phase that decides whether students play once or fifteen times.
Budget real time for it.

- **Speed ramp**: scroll speed and spawn rate increase continuously with score.
- **Fair spawn patterns**: generate obstacle groups from a set of known-safe
  patterns rather than pure randomness. Always verify at least one lane is
  passable given current speed and the player's reaction window.
- **Near-miss detection**: passing close to an obstacle without colliding
  awards bonus points plus a visual flash.
- **Combo multiplier**: consecutive near-misses build a multiplier; it resets
  after a safe stretch or on a crash.
- **Screen shake** on crash.
- **Speed milestones**: a sound and brief screen flash at every 500 points.
- **Personal best** displayed alongside the live score, stored in
  localStorage.

**Done when:** a run feels genuinely tense by the 30-second mark, and you
catch yourself hitting restart without deciding to.

---

## Phase 3 — Mobile and responsive

- **Touch input**: left/right tap zones covering the full screen height, or
  swipe. Test both and keep whichever feels better on a real phone.
- **Scale Manager in FIT mode**, verified on several aspect ratios including
  tall modern phones and older 16:9 devices.
- Portrait orientation handled explicitly.
- **Audio unlock on first tap** — required for iOS Safari.
- Prevent scroll, pinch-zoom, pull-to-refresh, and text selection during play.
- Check frame rate on an actual mid-range Android, not an emulator.

**Done when:** it plays correctly and smoothly on a real Android phone *and* a
real iPhone. This phase is not done until both have been tested on hardware.

---

## Phase 4 — Art and audio

Only now bring in the AI-generated assets.

- Player car, obstacle car variants, road, roadside detail, UI elements.
- Pack sprites into a texture atlas.
- Convert to WebP with PNG fallback; compress aggressively.
- Sound effects: lane change, near-miss, milestone, crash. Keep files small.
- Optional light background music, muted by default with a toggle.
- Re-verify frame rate on the mid-range Android after the art swap — this is
  where performance regressions appear.

**Done when:** it looks good, total asset payload is under 1.5MB, and frame
rate on the test Android is unchanged from phase 3.

---

## Phase 5 — Name entry and score submission

- Name entry screen shown before the first play only.
- Name stored in localStorage; restarts skip straight into the game. Do not
  break the one-second restart.
- Validation: length limits, character whitelist, basic profanity filter.
- Firebase project created, Firestore in production mode with security rules
  that allow creating score documents but not editing or deleting them.
- On game over, write `{ name, score, timestamp }` to Firestore.
- **Handle failure gracefully**: if the write fails on weak wifi, retry in the
  background and never block the restart. The game must stay fully playable
  offline once loaded.

**Done when:** scores from two different devices appear correctly in the
Firestore console, including after a deliberately dropped connection.

---

## Phase 6 — Leaderboard

- A leaderboard page reading the top 20 scores from Firestore, sorted
  descending, live-updating.
- **In-game rank display on the death screen**: "You're #7". This is the
  strongest retention mechanic in the whole build — it converts a casual
  player into a competitive one instantly.
- Optional: an organiser view showing more entries, for picking the discount
  winners.

**Done when:** two phones playing simultaneously both appear on the
leaderboard in the correct order, and the death screen shows an accurate rank.

---

## Phase 7 — Deploy and load-test

- Deploy to Netlify or Vercel.
- Generate a QR code pointing at the URL for students to scan at the camp.
- Test on as many borrowed real devices as possible — aim for at least five
  different phones across Android and iOS.
- Test on the actual campus wifi, ideally with several devices loading at once.
- Confirm the game remains playable if the network drops mid-session.

**Done when:** it works on every device you can get your hands on, on the
campus network.

---

## Anti-cheat

Scores are calculated in the browser, so a determined student could edit the
value before it is submitted. For a college camp with real discounts on the
line, pick a level of protection proportionate to the stakes:

- **Minimum (recommended)**: organisers review the top 5–10 scores before
  declaring winners. An implausible outlier is obvious against a field of
  normal runs. Cheap, and it catches the realistic cases.
- **Better**: submit periodic checkpoints during the run rather than one final
  number, and reject submissions whose score jumps implausibly relative to
  elapsed time.
- **Also worth doing**: Firestore rules that reject scores above a sane
  ceiling, and light obfuscation of the client bundle so the score variable is
  not trivially findable.

Do not build a full server-authoritative scoring system for this. The cost
is not justified by a one-day event.

---

## Schedule advice

- Phases 1–3 carry the real risk. If time gets tight, cut art polish and extra
  features, not game feel or mobile testing.
- Leave a **full day of real-device testing** before the camp. That is when
  problems surface.
- Have a fallback: if the leaderboard breaks on the day, the game alone still
  works, and scores can be recorded manually.
