/*
 * GameScene — the whole game loop.
 *
 * The run starts instantly (no menu). The player slides left/right
 * between lanes; obstacle rows scroll down; touching one ends the run.
 * After a crash, one tap / key press restarts the scene immediately.
 *
 * Phase 2 systems:
 *  - Difficulty: speed and row frequency rise with distance travelled.
 *  - Fair spawning: rows come from known patterns, and every row is
 *    checked to be reachable from the previous one at current speed.
 *  - Near misses: dodge late to earn bonus points and build a combo.
 *  - Milestones every N points, crash shake, saved personal best.
 *
 * All tunable numbers come from GAME_CONFIG (js/config.js).
 * Car and road graphics: js/textures.js. Sounds: js/sfx.js.
 */
class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  // ------------------------------------------------------------
  //  Setup
  // ------------------------------------------------------------
  /**
   * The MEA IEDC logo is the game's only image file (about 4KB). If it
   * fails to load, the game still starts and billboards show a plain
   * placeholder instead.
   */
  preload() {
    if (!this.textures.exists('logo')) this.load.image('logo', Textures.logoUrl());
  }

  create() {
    const C = GAME_CONFIG;

    // The canvas is RENDER_SCALE x bigger than the design size; zoom the
    // camera so everything below can use plain WIDTH x HEIGHT units.
    this.cameras.main.setZoom(C.RENDER_SCALE).centerOn(C.WIDTH / 2, C.VIEW_HEIGHT / 2);

    Textures.createAll(this);

    // Road geometry, derived from config
    this.roadLeft = C.ROAD_MARGIN;
    this.roadWidth = C.WIDTH - C.ROAD_MARGIN * 2;
    this.laneWidth = this.roadWidth / C.LANE_COUNT;

    // Run state (reset every restart, because scene.restart re-runs create)
    this.isDead = false;
    this.speed = C.BASE_SPEED;        // current scroll speed, units/s
    this.distance = 0;                // total units travelled this run
    this.score = 0;                   // distance points x combo + bonuses
    this.shownScore = -1;             // avoids re-rendering unchanged text
    this.nextMilestone = C.MILESTONE_EVERY;
    this.distanceSinceRow = -C.FIRST_ROW_DELAY_PX;
    this.deathTime = 0;
    this.runTimeMs = 0;               // time actually played (for anti-cheat checks)
    this.uploadId = null;             // this run's online upload, if any

    // Combo state
    this.combo = 0;                   // consecutive near misses
    this.comboTimer = 0;              // ms left before the combo resets

    // Fair spawning: lanes the player could be in when the last row passes
    this.reachable = new Array(C.LANE_COUNT).fill(true);

    // Personal best from the database (updates when it finishes loading)
    this.bestAtStart = this.loadBest();
    const onBestLoaded = () => this.onBestLoaded();
    window.addEventListener('best-loaded', onBestLoaded);
    this.events.once('shutdown', () => window.removeEventListener('best-loaded', onBestLoaded));

    // Tell the server this run has started, so it can check the score's
    // timing later (not while the intro or name form is open)
    this.runId = window.OVERLAY_OPEN ? null : OnlineScores.startRun();

    this.createRoad();
    this.createObstaclePool();
    this.createPlayer();

    // Back view: BackView draws the scene from behind the car. The
    // top-view car images stay invisible and just carry the game state.
    this.backView = null;
    if (C.VIEW_MODE === 'back') {
      this.player.setAlpha(0);
      this.obstacles.forEach((car) => car.setAlpha(0));
      this.backView = new BackView(this);
    }

    this.createHud();
    this.createPopup();
    this.createMilestoneFx();
    this.createHint();
    this.createGameOverOverlay();
    this.createFpsMeter();
    this.setupInput();
  }

  /** Frame-rate readout for real-device testing (?fps in the URL). */
  createFpsMeter() {
    const C = GAME_CONFIG;
    if (!C.SHOW_FPS) return;
    const text = this.add.text(12, C.VIEW_HEIGHT - 12, '', this.textStyle(16, '#00ff88', {
      fontStyle: 'bold', backgroundColor: '#000000aa', padding: { x: 6, y: 3 },
    })).setOrigin(0, 1).setDepth(30);

    // Lowest fps seen this run is the number that matters on a weak phone
    let lowest = Infinity;
    const start = this.time.now;
    this.time.addEvent({
      delay: 500,
      loop: true,
      callback: () => {
        const fps = Math.round(this.game.loop.actualFps);
        if (this.time.now - start > 2000) lowest = Math.min(lowest, fps); // skip start-up
        text.setText(`${fps} fps  (low ${lowest === Infinity ? '-' : lowest})  x${C.RENDER_SCALE}  ${C.INPUT_MODE}  ${C.VIEW_MODE}`);
      },
    });
  }

  /** Text style helper: sharp at RENDER_SCALE, consistent font. */
  textStyle(size, color, extra) {
    return Object.assign({
      fontFamily: GAME_CONFIG.FONT,
      fontSize: size + 'px',
      color: color,
      resolution: GAME_CONFIG.RENDER_SCALE,
    }, extra);
  }

  /**
   * The road + roadside is a short tile image stacked down the screen.
   * Scrolling just shifts the stack by an offset that wraps every tile.
   * (Cheaper on phones than a TileSprite, which redraws a canvas and
   * re-uploads it to the GPU every frame.)
   *
   * Tiles use different roadside variants (bushes, lamps, flowers). Each
   * stretch of road always gets the same variant, so scenery scrolls
   * past smoothly instead of flickering when the stack wraps.
   */
  createRoad() {
    const C = GAME_CONFIG;
    this.roadTiles = null;
    if (C.VIEW_MODE === 'back') return; // BackView draws its own road

    const count = Math.ceil(C.HEIGHT / C.ROAD_TILE_HEIGHT) + 1;
    this.roadOffset = 0;
    this.roadTilesPassed = 0;         // whole tiles scrolled off the bottom
    this.roadTiles = [];
    for (let i = 0; i < count; i++) {
      this.roadTiles.push(this.add.image(0, 0, 'road0').setOrigin(0).setScale(1 / C.RENDER_SCALE));
    }
    this.scrollRoad(0);
  }

  /** Move the road down by `move` world units. */
  scrollRoad(move) {
    if (!this.roadTiles) return; // back view
    const C = GAME_CONFIG;
    const tileH = C.ROAD_TILE_HEIGHT;
    this.roadOffset += move;
    let wrapped = move === 0; // first call: assign variants
    while (this.roadOffset >= tileH) {
      this.roadOffset -= tileH;
      this.roadTilesPassed++;
      wrapped = true;
    }
    // Snap to whole render pixels to avoid seams between tiles
    const offset = Math.round(this.roadOffset * C.RENDER_SCALE) / C.RENDER_SCALE;
    for (let i = 0; i < this.roadTiles.length; i++) {
      const tile = this.roadTiles[i];
      tile.y = (i - 1) * tileH + offset;
      if (wrapped) tile.setTexture('road' + this.roadVariant(this.roadTilesPassed - i));
    }
  }

  /** Scatter the variants: a fixed pseudo-random pick per stretch of road. */
  roadVariant(stretch) {
    return Textures.hash(stretch) % Textures.ROAD_VARIANTS;
  }

  /** The player car; slides between lanes with a small lean. */
  createPlayer() {
    const C = GAME_CONFIG;
    this.playerLane = C.PLAYER_START_LANE;
    this.player = this.add.image(this.laneCenterX(this.playerLane), C.PLAYER_Y, 'cars', 'player')
      .setScale(1 / C.RENDER_SCALE)
      .setDepth(5);
    this.laneTween = null;
    this.tiltTween = null;
  }

  /** Pre-create every obstacle once and reuse them (no allocation mid-run). */
  createObstaclePool() {
    const C = GAME_CONFIG;
    this.obstacles = [];
    for (let i = 0; i < C.OBSTACLE_POOL_SIZE; i++) {
      const car = this.add.image(0, 0, 'cars', 'obstacle0').setScale(1 / C.RENDER_SCALE);
      car.setActive(false).setVisible(false);
      car.lane = 0;          // which lane it drives in
      car.dodged = false;    // true = player dodged it late; award when it passes
      this.obstacles.push(car);
    }
  }

  /**
   * Top panel: score (left), combo (centre), personal best (right).
   * All of it sits in one container, so it can be hidden while a menu
   * screen is open (the intro shows its own player card instead).
   */
  createHud() {
    const C = GAME_CONFIG;
    const panel = this.add.graphics();
    panel.fillStyle(C.COLORS.HUD_PANEL, 0.55);
    panel.fillRoundedRect(12, 12, C.WIDTH - 24, 64, 16);

    const scoreLabel = this.add.text(30, 20, 'SCORE', this.textStyle(13, '#9fb3c8', { fontStyle: 'bold' }));
    this.scoreText = this.add.text(30, 34, '0', this.textStyle(32, '#ffffff', { fontStyle: 'bold' }));

    const bestLabel = this.add.text(C.WIDTH - 30, 20, 'BEST', this.textStyle(13, '#9fb3c8', { fontStyle: 'bold' }))
      .setOrigin(1, 0);
    this.bestText = this.add.text(C.WIDTH - 30, 34, this.bestAtStart, this.textStyle(32, '#ffd54f', { fontStyle: 'bold' }))
      .setOrigin(1, 0);

    // Combo: multiplier text plus a bar that drains until the combo resets
    const cx = C.WIDTH / 2;
    this.comboText = this.add.text(cx, 40, 'x1', this.textStyle(28, '#ffd54f', { fontStyle: 'bold' })).setOrigin(0.5);
    const barBg = this.add.rectangle(cx - 40, 62, 80, 5, 0xffffff, 0.2).setOrigin(0, 0.5);
    this.comboBar = this.add.rectangle(cx - 40, 62, 80, 5, C.COLORS.ACCENT).setOrigin(0, 0.5);
    this.comboHud = this.add.container(0, 0, [this.comboText, barBg, this.comboBar]).setVisible(false);

    this.hud = this.add.container(0, 0, [panel, scoreLabel, this.scoreText, bestLabel, this.bestText, this.comboHud])
      .setDepth(10)
      .setVisible(!window.OVERLAY_OPEN);
  }

  /** One reusable floating text for "CLOSE! +25" near-miss popups. */
  createPopup() {
    this.popup = this.add.text(0, 0, '', this.textStyle(26, '#ffd54f', {
      fontStyle: 'bold', stroke: '#000000', strokeThickness: 5, align: 'center',
    })).setOrigin(0.5).setDepth(12).setVisible(false);
  }

  /** Screen flash + big number for score milestones. */
  createMilestoneFx() {
    const C = GAME_CONFIG;
    this.flash = this.add.rectangle(0, 0, C.WIDTH, C.VIEW_HEIGHT, 0xffffff, 1)
      .setOrigin(0).setDepth(15).setAlpha(0);
    this.milestoneText = this.add.text(C.WIDTH / 2, 230, '', this.textStyle(72, '#ffd54f', {
      fontStyle: 'bold', stroke: '#000000', strokeThickness: 8,
    })).setOrigin(0.5).setDepth(16).setVisible(false);
  }

  /** "Tap left / right" hint, shown only on the first run of a session. */
  createHint() {
    const C = GAME_CONFIG;
    this.hint = null;
    // Wait until the intro / name form closes (the scene restarts then)
    if (window.OVERLAY_OPEN || this.registry.get('hintShown')) return;
    this.registry.set('hintShown', true);

    const y = C.VIEW_HEIGHT * 0.52;
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.35);
    g.fillRoundedRect(24, y - 34, 150, 68, 16);
    g.fillRoundedRect(C.WIDTH - 174, y - 34, 150, 68, 16);
    g.fillStyle(0xffffff, 0.95);
    g.fillTriangle(48, y, 70, y - 16, 70, y + 16);                                  // left arrow
    g.fillTriangle(C.WIDTH - 48, y, C.WIDTH - 70, y - 16, C.WIDTH - 70, y + 16);    // right arrow

    const word = C.INPUT_MODE === 'swipe' ? 'SWIPE' : 'TAP';
    const left = this.add.text(120, y, word, this.textStyle(24, '#ffffff', { fontStyle: 'bold' })).setOrigin(0.5);
    const right = this.add.text(C.WIDTH - 120, y, word, this.textStyle(24, '#ffffff', { fontStyle: 'bold' })).setOrigin(0.5);

    this.hint = this.add.container(0, 0, [g, left, right]).setDepth(12);
    this.time.delayedCall(C.HINT_DURATION_MS, () => this.hideHint());
  }

  hideHint() {
    if (!this.hint) return;
    const hint = this.hint;
    this.hint = null;
    this.tweens.add({ targets: hint, alpha: 0, duration: 250, onComplete: () => hint.destroy() });
  }

  /** Crash card — hidden until the player crashes. */
  createGameOverOverlay() {
    const C = GAME_CONFIG;
    const cx = C.WIDTH / 2;
    const cy = C.VIEW_HEIGHT / 2;

    this.shade = this.add.rectangle(0, 0, C.WIDTH, C.VIEW_HEIGHT, 0x000000, 0.5)
      .setOrigin(0).setDepth(20).setVisible(false);

    // Card contents are positioned relative to the card centre
    const cardW = 340;
    const cardH = 470;
    const card = this.add.graphics();
    card.fillStyle(0x161b22, 0.96);
    card.fillRoundedRect(-cardW / 2, -cardH / 2, cardW, cardH, 24);
    card.lineStyle(2, 0xffffff, 0.12);
    card.strokeRoundedRect(-cardW / 2, -cardH / 2, cardW, cardH, 24);
    card.lineStyle(1, 0xffffff, 0.1);
    card.lineBetween(-cardW / 2 + 24, 88, cardW / 2 - 24, 88);

    const title = this.add.text(0, -190, 'CRASHED!', this.textStyle(42, '#ff5a5f', { fontStyle: 'bold' })).setOrigin(0.5);
    const label = this.add.text(0, -127, 'SCORE', this.textStyle(15, '#9fb3c8', { fontStyle: 'bold' })).setOrigin(0.5);
    this.finalScoreText = this.add.text(0, -87, '0', this.textStyle(58, '#ffffff', { fontStyle: 'bold' })).setOrigin(0.5);
    this.finalBestText = this.add.text(0, -35, '', this.textStyle(20, '#ffd54f', { fontStyle: 'bold' })).setOrigin(0.5);

    // "NEW BEST!" ribbon, only shown when the record is beaten
    this.newBestBadge = this.add.container(0, -235);
    const badgeBg = this.add.graphics();
    badgeBg.fillStyle(C.COLORS.ACCENT);
    badgeBg.fillRoundedRect(-70, -16, 140, 32, 16);
    this.newBestBadge.add([badgeBg, this.add.text(0, 0, 'NEW BEST!', this.textStyle(18, '#1a1a1a', { fontStyle: 'bold' })).setOrigin(0.5)]);

    // Play-again pill
    const pill = this.add.graphics();
    pill.fillStyle(0x2ea043);
    pill.fillRoundedRect(-130, 5, 260, 56, 28);
    this.restartText = this.add.text(0, 33, 'TAP TO PLAY AGAIN', this.textStyle(21, '#ffffff', { fontStyle: 'bold' })).setOrigin(0.5);

    // Buttons (crash screen only): sound / music switches and the leaderboard.
    // setupInput checks these so tapping a button doesn't also restart.
    this.soundToggles = [
      this.createToggle(-80, 128, 'SOUND', () => Sfx.enabled, (on) => Sfx.setEnabled(on)),
      this.createToggle(80, 128, 'MUSIC', () => Music.enabled, (on) => Music.setEnabled(on)),
    ];
    const leaderboardButton = this.createCardButton(0, 188, 300, 'LEADERBOARD', () => {
      window.location.href = 'leaderboard.html';
    });
    this.cardButtons = this.soundToggles.map((t) => t.zone).concat(leaderboardButton.zone);

    // Who is playing, and where the score stands on the online leaderboard
    this.playerNameText = this.add.text(0, -157, '', this.textStyle(15, '#9fb3c8', { fontStyle: 'bold' })).setOrigin(0.5);
    this.uploadText = this.add.text(0, -10, '', this.textStyle(15, '#9fb3c8', { fontStyle: 'bold' })).setOrigin(0.5);
    const onScoreStatus = (event) => this.showUploadStatus(event.detail);
    window.addEventListener('score-status', onScoreStatus);
    this.events.once('shutdown', () => window.removeEventListener('score-status', onScoreStatus));

    const parts = [card, title, label, this.finalScoreText, this.finalBestText, this.playerNameText, this.uploadText,
      pill, this.restartText, this.newBestBadge, leaderboardButton.container];
    this.soundToggles.forEach((t) => parts.push(t.container));
    this.card = this.add.container(cx, cy, parts).setDepth(21).setVisible(false);
  }

  /**
   * An ON/OFF pill button inside the crash card. `zone` is what receives
   * the tap; setupInput checks for it so tapping a switch doesn't restart.
   */
  createToggle(x, y, name, isOn, setOn) {
    const w = 140;
    const h = 44;
    const bg = this.add.graphics();
    const text = this.add.text(0, 0, '', this.textStyle(17, '#ffffff', { fontStyle: 'bold' })).setOrigin(0.5);
    const zone = this.add.zone(0, 0, w, h).setInteractive({ useHandCursor: true });
    const container = this.add.container(x, y, [bg, text, zone]);

    const redraw = () => {
      const on = isOn();
      bg.clear();
      bg.fillStyle(on ? 0x2f81f7 : 0x30363d);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
      text.setText(name + (on ? '  ON' : '  OFF'));
      text.setColor(on ? '#ffffff' : '#8b949e');
    };
    redraw();

    zone.on('pointerdown', () => {
      if (!this.isDead || !this.card.visible) return; // only on the crash screen
      Sfx.unlock(this);
      setOn(!isOn());
      redraw();
      Sfx.laneChange(this); // audible confirmation when sound is on
    });

    return { container, zone, redraw };
  }

  /** A plain pill button inside the crash card. */
  createCardButton(x, y, w, label, onTap) {
    const h = 44;
    const bg = this.add.graphics();
    bg.fillStyle(GAME_CONFIG.COLORS.ACCENT);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    const text = this.add.text(0, 0, label, this.textStyle(18, '#1a1a1a', { fontStyle: 'bold' })).setOrigin(0.5);
    const zone = this.add.zone(0, 0, w, h).setInteractive({ useHandCursor: true });
    zone.on('pointerdown', () => {
      if (!this.isDead || !this.card.visible) return; // only on the crash screen
      onTap();
    });
    return { container: this.add.container(x, y, [bg, text, zone]), zone };
  }

  /**
   * One input: left or right.
   *  - Touch/click, INPUT_MODE 'tap': left half of the screen = left,
   *    right half = right. Acts on touch-down, so there is no delay.
   *  - Touch/click, INPUT_MODE 'swipe': drag sideways; every
   *    SWIPE_MIN_PX of drag moves one lane, so one long drag can
   *    cross several lanes.
   *  - Keyboard (desktop convenience): arrows or A/D.
   * Any press restarts the game after a crash.
   *
   * Presses in the letterbox bars outside the canvas count too
   * ("...outside" events), so tall phones have no dead zones.
   * Scene input listeners are cleared automatically on scene.restart().
   */
  setupInput() {
    const C = GAME_CONFIG;
    this.swipe = null; // { id, x } of the finger currently dragging

    const onDown = (pointer, currentlyOver) => {
      Sfx.unlock(this);
      if (this.isWaiting()) return;
      if (this.isDead) {
        // Tapping a crash-card button shouldn't also restart
        const onButton = currentlyOver && this.cardButtons.some((zone) => currentlyOver.includes(zone));
        if (!onButton) this.tryRestart();
        return;
      }

      if (C.INPUT_MODE === 'swipe') {
        this.swipe = { id: pointer.id, x: pointer.x };
      } else {
        // pointer.x is in canvas pixels; compare with the canvas middle
        this.moveLane(pointer.x < this.scale.width / 2 ? -1 : 1);
      }
    };
    this.input.on('pointerdown', onDown);
    this.input.on('pointerdownoutside', onDown);

    if (C.INPUT_MODE === 'swipe') {
      this.input.on('pointermove', (pointer) => {
        const s = this.swipe;
        if (!s || s.id !== pointer.id || this.isDead || this.isWaiting()) return;
        const dx = (pointer.x - s.x) / C.RENDER_SCALE; // canvas px -> world units
        if (Math.abs(dx) >= C.SWIPE_MIN_PX) {
          this.moveLane(Math.sign(dx));
          s.x = pointer.x; // keep dragging to move another lane
        }
      });
      const onUp = (pointer) => {
        if (this.swipe && this.swipe.id === pointer.id) this.swipe = null;
      };
      this.input.on('pointerup', onUp);
      this.input.on('pointerupoutside', onUp);
    }

    this.input.keyboard.on('keydown', (event) => {
      if (event.repeat || this.isWaiting()) return;
      const key = event.code;
      const isLeft = key === 'ArrowLeft' || key === 'KeyA';
      const isRight = key === 'ArrowRight' || key === 'KeyD';

      if (this.isDead) {
        if (isLeft || isRight || key === 'Space' || key === 'Enter') this.tryRestart();
        return;
      }
      if (isLeft) this.moveLane(-1);
      else if (isRight) this.moveLane(1);
    });
  }

  /** True while play must wait: phone held sideways, or a menu screen is open. */
  isWaiting() {
    return window.ORIENTATION_BLOCKED || window.OVERLAY_OPEN;
  }

  // ------------------------------------------------------------
  //  Main loop
  // ------------------------------------------------------------
  update(time, delta) {
    // The score panel steps aside while the intro or settings are open
    if (this.hud.visible === window.OVERLAY_OPEN) this.hud.setVisible(!window.OVERLAY_OPEN);

    // Freeze while dead, while a phone is held sideways, or during name entry
    if (!this.isDead && !this.isWaiting()) this.tick(delta);

    // Back view redraws every frame (also while dead, for the crash spin)
    if (this.backView) this.backView.render();
  }

  /** Advance the game by one frame. */
  tick(delta) {
    const C = GAME_CONFIG;
    const dt = Math.min(delta, 50) / 1000; // clamp so a lag spike can't teleport cars
    const move = this.speed * dt;
    const reachY = this.hitReachY();

    // Difficulty follows distance travelled
    this.speed = this.speedFor(this.progress());

    // Scroll the road downward at the same speed as the traffic
    this.scrollRoad(move);

    // Move obstacles; award near misses; recycle cars that left the screen
    for (const car of this.obstacles) {
      if (!car.active) continue;
      car.y += move;
      if (car.dodged && car.y - this.player.y > reachY) {
        car.dodged = false;
        this.awardNearMiss();
      }
      if (car.y - C.CAR_HEIGHT / 2 > C.HEIGHT) {
        car.setActive(false).setVisible(false);
      }
    }

    // Spawn a new row every "gap" of road travelled
    this.distanceSinceRow += move;
    const gap = this.gapFor(this.speed);
    if (this.distanceSinceRow >= gap) {
      this.distanceSinceRow -= gap;
      this.spawnRow(gap);
    }

    // Combo drains over time
    if (this.combo > 0) {
      this.comboTimer -= delta;
      if (this.comboTimer <= 0) this.resetCombo();
      else this.comboBar.scaleX = this.comboTimer / C.COMBO_TIMEOUT_MS;
    }

    // Score: distance points (near-miss bonuses are added separately)
    this.distance += move;
    this.runTimeMs += delta;
    this.score += move / C.PIXELS_PER_POINT;
    this.refreshScore();

    if (this.checkCollision()) this.gameOver();
  }

  // ------------------------------------------------------------
  //  Difficulty
  // ------------------------------------------------------------
  /** Distance points only — drives difficulty (bonuses don't count). */
  progress() {
    return this.distance / GAME_CONFIG.PIXELS_PER_POINT;
  }

  /** Speed eases from BASE_SPEED up toward MAX_SPEED. */
  speedFor(progress) {
    const C = GAME_CONFIG;
    const t = 1 - Math.exp(-progress / C.SPEED_RAMP_POINTS);
    return C.BASE_SPEED + (C.MAX_SPEED - C.BASE_SPEED) * t;
  }

  /** Rows get closer together as speed rises. */
  gapFor(speed) {
    const C = GAME_CONFIG;
    const t = (speed - C.BASE_SPEED) / (C.MAX_SPEED - C.BASE_SPEED);
    return Phaser.Math.Linear(C.SPAWN_GAP_START, C.SPAWN_GAP_END, t);
  }

  // ------------------------------------------------------------
  //  Movement
  // ------------------------------------------------------------
  laneCenterX(lane) {
    return this.roadLeft + this.laneWidth * (lane + 0.5);
  }

  /** Slide one lane left (-1) or right (+1) with a short tween and lean. */
  moveLane(dir) {
    const C = GAME_CONFIG;
    const target = Phaser.Math.Clamp(this.playerLane + dir, 0, C.LANE_COUNT - 1);
    this.hideHint();
    if (target === this.playerLane) return;

    this.markDodges(this.playerLane);
    this.playerLane = target;
    Sfx.laneChange(this);

    // Cancel a slide in progress so rapid taps stay responsive
    if (this.laneTween) this.laneTween.stop();
    if (this.tiltTween) this.tiltTween.stop();

    this.laneTween = this.tweens.add({
      targets: this.player,
      x: this.laneCenterX(target),
      duration: C.LANE_TWEEN_MS,
      ease: 'Sine.easeOut',
    });
    this.player.angle = 0;
    this.tiltTween = this.tweens.add({
      targets: this.player,
      angle: dir * C.LANE_TILT_DEG,
      duration: C.LANE_TWEEN_MS / 2,
      yoyo: true,
      ease: 'Sine.easeOut',
    });
  }

  // ------------------------------------------------------------
  //  Obstacles & fair spawning
  // ------------------------------------------------------------
  /**
   * Spawn one row just above the screen, chosen from the unlocked
   * patterns. A pattern is only allowed if it is fair: from EVERY lane
   * the player might be in after the previous row, an open lane of the
   * new row must be reachable in time. (Checking "every" rather than
   * "some" matters — the player picks a lane before seeing what's next.)
   */
  spawnRow(gap) {
    const C = GAME_CONFIG;
    const maxShift = this.maxLaneShift(gap);

    const candidates = Phaser.Utils.Array.Shuffle(this.unlockedPatterns().slice());
    let chosen = candidates.find((p) => this.isFair(p, maxShift));

    // Fallback: a single car is fair whenever the player can shift one lane
    if (!chosen) {
      chosen = Phaser.Utils.Array.Shuffle(this.singleCarPatterns()).find((p) => this.isFair(p, maxShift));
    }
    // Nothing fair at this speed (config too tight): leave this row empty
    if (!chosen) return;

    this.reachable = this.reachableAfter(chosen, maxShift);

    for (let lane = 0; lane < C.LANE_COUNT; lane++) {
      if (chosen[lane] !== 'X') continue;
      const car = this.obstacles.find((o) => !o.active);
      if (!car) return; // pool exhausted — skip rather than allocate
      car.setFrame('obstacle' + Phaser.Math.Between(0, C.OBSTACLE_CARS.length - 1));
      car.setPosition(this.laneCenterX(lane), this.spawnY());
      car.lane = lane;
      car.dodged = false;
      car.setActive(true).setVisible(true);
    }
  }

  /** New rows start just above the top of the screen. */
  spawnY() {
    return -GAME_CONFIG.CAR_HEIGHT / 2 - 10;
  }

  /** Patterns allowed at the current progress (ignores malformed ones). */
  unlockedPatterns() {
    const C = GAME_CONFIG;
    const progress = this.progress();
    const rows = [];
    for (const tier of C.PATTERNS) {
      if (progress < tier.from) continue;
      for (const row of tier.rows) {
        if (row.length === C.LANE_COUNT && row.includes('.')) rows.push(row);
      }
    }
    // If LANE_COUNT was changed without updating PATTERNS, use single cars
    return rows.length > 0 ? rows : this.singleCarPatterns();
  }

  /** 'X...', '.X..', ... for the current lane count. */
  singleCarPatterns() {
    const n = GAME_CONFIG.LANE_COUNT;
    const rows = [];
    for (let i = 0; i < n; i++) {
      rows.push(Array.from({ length: n }, (_, j) => (i === j ? 'X' : '.')).join(''));
    }
    return rows;
  }

  /** True if every lane the player might be in has an escape in `pattern`. */
  isFair(pattern, maxShift) {
    const C = GAME_CONFIG;
    for (let from = 0; from < C.LANE_COUNT; from++) {
      if (!this.reachable[from]) continue;
      let escape = false;
      for (let lane = Math.max(0, from - maxShift); lane <= Math.min(C.LANE_COUNT - 1, from + maxShift); lane++) {
        if (pattern[lane] !== 'X') { escape = true; break; }
      }
      if (!escape) return false;
    }
    return true;
  }

  /**
   * How many lanes the player can cross between two rows.
   * Clear road = gap minus the length where either row still overlaps
   * the player. Speed gets a 10% safety margin because it keeps rising
   * while the row travels down the screen.
   */
  maxLaneShift(gap) {
    const C = GAME_CONFIG;
    const clearRoad = gap - 2 * this.hitReachY();
    const clearMs = Math.max(0, clearRoad / (this.speed * 1.1)) * 1000;
    return Math.floor(clearMs / C.LANE_STEP_MS);
  }

  /** Which open lanes of `pattern` the player could end up in. */
  reachableAfter(pattern, maxShift) {
    const C = GAME_CONFIG;
    const result = new Array(C.LANE_COUNT).fill(false);
    for (let lane = 0; lane < C.LANE_COUNT; lane++) {
      if (pattern[lane] === 'X') continue;
      for (let from = 0; from < C.LANE_COUNT; from++) {
        if (this.reachable[from] && Math.abs(lane - from) <= maxShift) {
          result[lane] = true;
          break;
        }
      }
    }
    return result;
  }

  /** Vertical distance (centre to centre) at which two cars' hitboxes touch. */
  hitReachY() {
    return GAME_CONFIG.CAR_HEIGHT * (1 - GAME_CONFIG.HITBOX_SHRINK);
  }

  /** Axis-aligned box test with slightly shrunk (forgiving) hitboxes. */
  checkCollision() {
    const C = GAME_CONFIG;
    const reachX = C.CAR_WIDTH * (1 - C.HITBOX_SHRINK); // two half-widths
    const reachY = this.hitReachY();

    for (const car of this.obstacles) {
      if (!car.active) continue;
      if (Math.abs(car.x - this.player.x) < reachX &&
          Math.abs(car.y - this.player.y) < reachY) {
        return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------
  //  Near misses & combo
  // ------------------------------------------------------------
  /**
   * Called as the player leaves `lane`. Any car in that lane that would
   * have hit within NEAR_MISS_MS counts as a late dodge. The bonus is
   * paid once the car has fully passed (see update).
   */
  markDodges(lane) {
    const C = GAME_CONFIG;
    const reachY = this.hitReachY();
    for (const car of this.obstacles) {
      if (!car.active || car.lane !== lane) continue;
      const roadLeft = (this.player.y - car.y) - reachY; // distance before contact
      if (roadLeft >= 0 && (roadLeft / this.speed) * 1000 < C.NEAR_MISS_MS) {
        car.dodged = true;
      }
    }
  }

  comboMultiplier() {
    const C = GAME_CONFIG;
    return Math.min(C.COMBO_MAX, 1 + C.COMBO_STEP * this.combo);
  }

  awardNearMiss() {
    const C = GAME_CONFIG;
    this.combo++;
    this.comboTimer = C.COMBO_TIMEOUT_MS;
    const mult = this.comboMultiplier();
    const bonus = Math.round(C.NEAR_MISS_BONUS * mult);
    this.score += bonus;

    // Combo HUD
    this.comboText.setText('x' + mult);
    this.comboBar.scaleX = 1;
    this.comboHud.setVisible(true);
    this.tweens.killTweensOf(this.comboText);
    this.comboText.setScale(1.4);
    this.tweens.add({ targets: this.comboText, scale: 1, duration: 180, ease: 'Back.easeOut' });

    // Popup above the player, plus a quick white flash on the car
    const label = (this.combo > 1 ? 'CLOSE! x' + mult : 'CLOSE!') + '\n+' + bonus;
    const pos = this.backView ? this.backView.popupPosition() : { x: this.player.x, y: this.player.y - 80 };
    this.showPopup(label, pos.x, pos.y);
    this.player.setTintFill(0xffffff);
    this.time.delayedCall(70, () => { if (!this.isDead) this.player.clearTint(); });

    Sfx.nearMiss(this, this.combo);
  }

  resetCombo() {
    this.combo = 0;
    this.comboTimer = 0;
    this.comboHud.setVisible(false);
  }

  /**
   * Floating text that rises and fades. A new near miss replaces the
   * previous popup instead of stacking on top of it.
   */
  showPopup(text, x, y) {
    const t = this.popup;
    this.tweens.killTweensOf(t);
    t.setText(text).setPosition(x, y).setAlpha(1).setScale(0.7).setVisible(true);
    this.tweens.add({ targets: t, scale: 1, duration: 120, ease: 'Back.easeOut' });
    this.tweens.add({
      targets: t, y: y - 60, alpha: 0, delay: 250, duration: 500,
      onComplete: () => t.setVisible(false),
    });
  }

  // ------------------------------------------------------------
  //  Score, milestones, personal best
  // ------------------------------------------------------------
  currentScore() {
    return Math.floor(this.score);
  }

  /** Update HUD text only when the number changes; fire milestones. */
  refreshScore() {
    const score = this.currentScore();
    if (score === this.shownScore) return;
    this.shownScore = score;
    this.scoreText.setText(score);
    // Best follows the live score once you beat it
    if (score > this.bestAtStart) this.bestText.setText(score);

    if (score >= this.nextMilestone) {
      const reached = Math.floor(score / GAME_CONFIG.MILESTONE_EVERY) * GAME_CONFIG.MILESTONE_EVERY;
      this.nextMilestone = reached + GAME_CONFIG.MILESTONE_EVERY;
      this.showMilestone(reached);
    }
  }

  showMilestone(value) {
    this.tweens.killTweensOf([this.flash, this.milestoneText]);
    this.flash.setAlpha(0.28);
    this.tweens.add({ targets: this.flash, alpha: 0, duration: 300 });

    this.milestoneText.setText(value).setVisible(true).setAlpha(1).setScale(0.5);
    this.tweens.add({ targets: this.milestoneText, scale: 1, duration: 220, ease: 'Back.easeOut' });
    this.tweens.add({
      targets: this.milestoneText, alpha: 0, delay: 500, duration: 300,
      onComplete: () => this.milestoneText.setVisible(false),
    });

    Sfx.milestone(this);
  }

  /**
   * Personal best. Never stored on the phone: it comes from the database
   * (OnlineScores.best), plus the best of this visit kept in memory for
   * when the database can't be reached.
   */
  loadBest() {
    return Math.max(OnlineScores.best || 0, this.registry.get('visitBest') || 0);
  }

  saveBest(score) {
    this.registry.set('visitBest', score);
  }

  /** The database best arrived (it loads in the background after start). */
  onBestLoaded() {
    const best = this.loadBest();
    if (best <= this.bestAtStart) return;
    this.bestAtStart = best;
    if (!this.isDead) this.bestText.setText(Math.max(best, this.currentScore()));
  }

  // ------------------------------------------------------------
  //  Game over / restart
  // ------------------------------------------------------------
  gameOver() {
    const C = GAME_CONFIG;
    this.isDead = true;
    this.deathTime = this.time.now;
    this.hideHint();
    this.resetCombo();

    // Crash feel: shake, buzz, red tint and a small spin
    this.cameras.main.shake(C.CRASH_SHAKE_MS, C.CRASH_SHAKE_INTENSITY);
    Sfx.crash(this);
    if (this.laneTween) this.laneTween.stop();
    if (this.tiltTween) this.tiltTween.stop();
    this.player.setTint(C.COLORS.CRASH_TINT);
    this.tweens.add({
      targets: this.player,
      angle: Phaser.Math.Between(0, 1) ? 18 : -18,
      duration: 220,
      ease: 'Quad.easeOut',
    });

    // Record best
    const score = this.currentScore();
    const isNewBest = score > this.bestAtStart;
    if (isNewBest) this.saveBest(score);
    this.scoreText.setText(score);
    this.bestText.setText(Math.max(score, this.bestAtStart));

    // Fill the crash card, then pop it in once the crash has registered
    this.finalScoreText.setText(score);
    this.finalBestText.setText('BEST  ' + Math.max(score, this.bestAtStart));
    this.newBestBadge.setVisible(isNewBest);
    this.playerNameText.setText(PlayerName.get() ? PlayerName.get().toUpperCase() : '');

    // Submit the run for the online leaderboard if it beats the player's
    // all-time best. Uploads in the background, so restarting is never
    // delayed, even on weak wifi.
    const upload = OnlineScores.finishRun({ runId: this.runId, score, durationMs: this.runTimeMs });
    if (upload) {
      // New best: show progress, then the rank once it's saved
      this.uploadId = upload.id;
      this.showUploadStatus({ id: upload.id, status: 'saving' });
    } else {
      // Not a new best: show where this player's best stands
      this.uploadId = 'best-' + this.deathTime;
      this.showUploadStatus(null);
      const token = this.uploadId;
      OnlineScores.rankOf(Math.max(OnlineScores.best || 0, this.bestAtStart)).then((position) => {
        if (position && this.sys.isActive()) {
          this.showUploadStatus(Object.assign({ id: token, status: 'ranked', isBest: false }, position));
        }
      });
    }

    this.time.delayedCall(C.CRASH_CARD_DELAY_MS, () => {
      this.shade.setVisible(true).setAlpha(0);
      this.card.setVisible(true).setAlpha(0).setScale(0.85);
      this.tweens.add({ targets: this.shade, alpha: 1, duration: 150 });
      this.tweens.add({ targets: this.card, alpha: 1, scale: 1, duration: 200, ease: 'Back.easeOut' });
    });

    // Gentle pulse on the play-again text once input is accepted
    this.time.delayedCall(C.RESTART_LOCKOUT_MS, () => {
      this.tweens.add({ targets: this.restartText, alpha: 0.55, duration: 550, yoyo: true, repeat: -1 });
    });
  }

  /**
   * Crash-card line: upload progress, then the leaderboard rank
   * ("You're #7 of 132!"). Ignores news about an older run.
   */
  showUploadStatus(detail) {
    if (!this.sys.isActive()) return;
    if (!detail) {
      this.uploadText.setText('');
      return;
    }
    if (detail.id !== this.uploadId) return;

    let text = '';
    let color = '#9fb3c8';
    if (detail.status === 'saving') {
      text = 'Saving score online...';
    } else if (detail.status === 'saved') {
      text = 'Score saved to leaderboard';
      color = '#56d364';
    } else if (detail.status === 'offline') {
      text = 'No connection - will upload later';
      color = '#e3b341';
    } else if (detail.status === 'rejected') {
      text = 'Score could not be verified';
      color = '#ff7b72';
    } else if (detail.status === 'ranked') {
      text = detail.isBest === false
        ? `Your best is #${detail.rank} of ${detail.total}`
        : `You're #${detail.rank} of ${detail.total}!`;
      color = detail.isBest === false ? '#9fb3c8' : '#ffd54f';
    }
    this.uploadText.setText(text).setColor(color);
  }

  /** Restart instantly, but ignore the panicked tap that caused the crash. */
  tryRestart() {
    if (this.time.now - this.deathTime < GAME_CONFIG.RESTART_LOCKOUT_MS) return;
    this.scene.restart();
  }
}
