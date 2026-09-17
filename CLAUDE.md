# CLAUDE.md

Project guardrails. These apply to every session and every phase. Do not
deviate without the user explicitly saying so.

## What this is

A browser-based 2D endless car-dodging game for a college technical camp
(IEDC). Students enter their name, play, and their score goes to a shared
leaderboard. The highest scorers win a discount at the event.

The design reference is the Chrome offline dinosaur game: one input, instant
restart, a score that always climbs, difficulty that ramps until you die.

## Non-negotiable constraints

### Platform
- **2D only.** No 3D, no WebGL-heavy effects, no 3D libraries.
- Must run in a **mobile browser** with no install: Chrome/Firefox on Android,
  Safari on iOS, plus desktop browsers.
- Target **60fps on a mid-range Android phone**, not just on a laptop.
- Assume a weak, congested campus wifi connection on event day.

### Tech stack — do not add to this
- **Phaser 3** for the game engine.
- **Firebase Firestore** (free Spark tier) for score storage.
- **Netlify or Vercel** for static hosting.
- Plain HTML/CSS/JS. **No React, no build-tool complexity, no bundler** unless
  a phase explicitly calls for it.
- No additional npm packages beyond Phaser and the Firebase SDK without asking.

### Performance budget
- No single asset over **200KB**.
- Total asset payload under **1.5MB**.
- Sprites packed into a **texture atlas**, not loaded as dozens of files.
- Images as **WebP with PNG fallback**.
- Cap simultaneous on-screen sprites. No particle storms, no large parallax
  layers, no effects that scale with playtime.

### Mobile requirements
- **Touch-first.** Tap zones or swipe for lane changes. Keyboard is a
  secondary convenience for desktop, never the primary design.
- **One input only.** Left / right. Nothing else. No jump, no brake, no boost
  button.
- Phaser **Scale Manager in FIT mode**, handling arbitrary aspect ratios.
  Never assume a fixed screen size.
- **Audio must unlock on the first user tap.** iOS Safari blocks audio until a
  user gesture. Do not autoplay anything.
- Prevent page scroll, pinch-zoom, and pull-to-refresh during play.
- Handle portrait explicitly (lock to it, or lay out correctly for it).

### Game feel rules
- **Zero friction to start.** No menu screen. No loading spinner if avoidable.
- **Restart in under one second.** Death, one tap, playing again. Never
  re-prompt for the name on restart — store it locally after the first entry.
- Runs should last roughly **30–90 seconds**.
- Score and personal best are **always visible** during play.
- Obstacle patterns must always leave a survivable path. **Never spawn an
  unavoidable wall.** Difficulty comes from speed and tight timing, not from
  unfair spawns.

### Code quality
- Keep the game logic readable and commented — a student may need to maintain
  this after the camp.
- Game constants (speeds, spawn rates, lane count, scoring values) live in one
  clearly-marked config object at the top, so tuning does not require hunting
  through the codebase.
- No secrets committed to the repo. Firebase config goes in environment
  variables or a gitignored file.

## Order of work

Phases 1 through 3 must be complete before phase 4 begins. Do not swap in
final art or wire up the database until the game is genuinely fun with
placeholder rectangles. A technically-complete game that is not fun cannot be
fixed by adding a leaderboard to it.

See PLAN.md for the phase breakdown and the done-condition for each.

## Testing

- **Real devices, not emulators.** DevTools mobile emulation does not catch
  touch quirks, iOS audio unlock failures, or actual frame rate.
- Minimum test set before the event: one mid-range Android, one iPhone, one
  desktop browser.
- Test two devices playing at once to confirm the leaderboard ranks correctly.
