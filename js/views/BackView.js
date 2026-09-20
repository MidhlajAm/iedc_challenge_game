/*
 * BackView — draws the game from behind the player's car (chase camera).
 *
 * Only the DRAWING changes. GameScene still runs the exact same game in
 * top-view world coordinates (lanes, obstacle y positions, hitboxes,
 * fair spawning). Every frame this class reads that state and draws it
 * in perspective, while the top-view car images stay invisible and act
 * purely as game data.
 *
 * Still plain 2D: this is the classic arcade "pseudo-3D" trick of
 * scaling sprites by distance. No 3D library or 3D rendering.
 *
 * Coordinates:
 *   z = distance ahead of the player's front bumper (world units).
 *       z = 0 is where a car ahead would touch the player.
 *   Projection: screenY = horizon + D * K / (K + z)
 *               scale   ∝ K / (K + z)
 *   Tunables live in GAME_CONFIG.BACK_VIEW.
 */
class BackView {
  constructor(scene) {
    const C = GAME_CONFIG;
    const B = C.BACK_VIEW;
    this.scene = scene;
    this.R = C.RENDER_SCALE;
    this.cx = C.WIDTH / 2;
    this.K = B.PERSPECTIVE_K;

    // Layout scales with the visible height (tall phones get more road)
    const viewH = C.VIEW_HEIGHT;
    this.horizon = Math.round(viewH * B.HORIZON_FRACTION);
    const playerGroundY = Math.round(viewH * B.PLAYER_GROUND_FRACTION);

    // How big the player's car is drawn (road width at the player)
    this.playerScale = B.ROAD_WIDTH_AT_PLAYER / (C.WIDTH - C.ROAD_MARGIN * 2);
    this.playerArtTop = Textures.REAR_HEIGHT - 8; // roof height in the rear-view art

    // Where the player's rear is drawn, solved so that at the moment of a
    // crash the car ahead just overlaps the player's roof on screen
    // (otherwise crashes can look like they happened at a distance).
    const crashZ = -C.CAR_HEIGHT * C.HITBOX_SHRINK;
    const band = playerGroundY - this.horizon;
    const length = this.K - (this.K + crashZ) *
      (band - this.playerArtTop * this.playerScale + B.CRASH_OVERLAP_PX) / band;
    this.zPlayer = -Phaser.Math.Clamp(length, 10, this.K - 40);
    this.D = band / this.factor(this.zPlayer);

    // Nearest depth still on screen (for road drawing) and for scenery
    // (a bit further back so objects leave the screen before vanishing)
    this.zNear = this.zForY(viewH + 20);
    this.zCull = this.zForY(viewH + 100);

    // Traffic is kept on screen until it can no longer hit the player,
    // even when that means drawing it partly below the screen. A car you
    // can still crash into must never be invisible: otherwise pulling
    // back into a lane just after passing looks like a crash out of
    // nowhere. (Collision ends once a car is CAR_HEIGHT + hitbox reach
    // behind the player.)
    const collisionEnds = -(C.CAR_HEIGHT + C.CAR_HEIGHT * (1 - C.HITBOX_SHRINK)) - 10;
    this.zTrafficCull = Math.max(collisionEnds, -(this.K - 40)); // stay in front of the camera

    // Depth where obstacles appear (they fade in from there)
    this.zSpawn = this.obstacleZ(scene.spawnY());

    this.createStaticLayers();
    this.createWeatherLayers();
    this.createSprites();
  }

  // ------------------------------------------------------------
  //  Projection helpers
  // ------------------------------------------------------------
  factor(z) {
    return this.K / (this.K + z);
  }

  yOf(z) {
    return this.horizon + this.D * this.factor(z);
  }

  /** On-screen size multiplier for something at depth z. */
  scaleOf(z) {
    return this.playerScale * this.factor(z) / this.factor(this.zPlayer);
  }

  /** Screen x of a top-view world x at depth z. */
  xOf(worldX, z) {
    return this.cx + (worldX - this.cx) * this.scaleOf(z);
  }

  /** Inverse of yOf: the depth that appears at screen y. */
  zForY(y) {
    return this.K * this.D / (y - this.horizon) - this.K;
  }

  /** Depth of an obstacle's rear bumper, from its top-view y. */
  obstacleZ(carY) {
    const C = GAME_CONFIG;
    return (C.PLAYER_Y - C.CAR_HEIGHT / 2) - (carY + C.CAR_HEIGHT / 2);
  }

  /**
   * A height in the visible sky: t = 0 just under the score panel,
   * t = 1 just above the horizon. Keeps sun, clouds and birds clear of
   * the HUD whatever the screen height.
   */
  skyY(t) {
    const top = 92;                   // score panel ends at 76
    const bottom = this.horizon - 24;
    return top + t * Math.max(0, bottom - top);
  }

  /** Nearer things draw on top. All stay below the HUD (depth 10+). */
  depthOf(z) {
    return 5 - z / 1000;
  }

  // ------------------------------------------------------------
  //  Static background: sky, skyline, hills, grass, road surface
  // ------------------------------------------------------------
  createStaticLayers() {
    const C = GAME_CONFIG;
    const K = C.COLORS;
    const W = C.WIDTH;
    const H = this.horizon;
    const M = C.ROAD_MARGIN;
    const yNear = this.yOf(this.zNear);
    const scene = this.scene;

    // Sky gradient
    const sky = scene.add.graphics().setDepth(0);
    sky.fillGradientStyle(K.SKY_TOP, K.SKY_TOP, K.SKY_HORIZON, K.SKY_HORIZON, 1);
    sky.fillRect(0, 0, W, H);

    // Sun with a soft glow. It gets its own layer so the weather can
    // dim it, and the moon behind it takes over at night (drawWeather).
    // Depth 0.016 keeps the sun in front of the sunset sky (0.015) but
    // still behind the mountains (0.02).
    const sunY = this.skyY(0.4);
    this.sun = scene.add.graphics().setDepth(0.016);
    [[46, 0.12], [32, 0.25], [22, 1]].forEach(([r, a]) => {
      this.sun.fillStyle(0xfff4c2, a);
      this.sun.fillCircle(350, sunY, r);
    });

    // Above the colour wash (depth 5.5): the moon is a light source, so
    // the night should not dim it the way it dims everything else.
    this.moon = scene.add.graphics().setDepth(5.52).setAlpha(0);
    this.moon.fillStyle(0xe8eef7, 0.16);
    this.moon.fillCircle(330, sunY, 34);
    this.moon.fillStyle(0xeef3fb, 1);
    this.moon.fillCircle(330, sunY, 19);
    this.moon.fillStyle(0xd3dce8, 0.7);                  // craters
    [[-6, -6, 4], [7, 4, 5], [-3, 9, 3]].forEach(([dx, dy, r]) => {
      this.moon.fillCircle(330 + dx, sunY + dy, r);
    });

    // A few clouds that drift slowly (see drawClouds)
    // [x, height in the sky 0..1, size, speed]
    this.clouds = [[60, 0.15, 0.9, 6], [250, 0, 0.7, 4], [400, 0.6, 0.6, 3], [150, 0.95, 0.5, 2]]
      .map(([x, t, scale, speed]) => {
        const cloud = scene.add.image(x, this.skyY(t), 'rear', 'cloud').setScale(scale / this.R).setDepth(0.01);
        cloud.driftSpeed = speed; // px per second
        return cloud;
      });

    // Distant mountains, city skyline, then nearer green hills
    const far = scene.add.graphics().setDepth(0.02);
    far.fillStyle(K.MOUNTAINS);
    [[-20, 80, 58], [60, 170, 44], [300, 100, 52], [380, 500, 38]].forEach(([x1, x2, h]) => {
      far.fillTriangle(x1, H, x2, H, (x1 + x2) / 2, H - h);
    });
    far.fillStyle(K.SKYLINE);
    const buildings = [[128, 14, 22], [143, 10, 34], [154, 16, 26], [171, 8, 46], [180, 14, 30],
      [195, 12, 38], [208, 18, 24], [227, 10, 40], [238, 14, 28], [253, 12, 20]];
    buildings.forEach(([x, w, h]) => far.fillRect(x, H - h, w, h));
    far.fillStyle(K.SKYLINE_WINDOWS);
    buildings.forEach(([x, w, h], i) => {
      for (let wy = H - h + 4; wy < H - 6; wy += 6) {
        if ((wy + i * 3) % 12 < 6) far.fillRect(x + 2, wy, 2, 2);
        if (w > 10 && (wy + i) % 18 < 6) far.fillRect(x + w - 4, wy, 2, 2);
      }
    });
    far.fillStyle(K.HILLS);
    [[40, 70, 26], [140, 60, 16], [300, 80, 22], [420, 110, 30]].forEach(([x, w, h]) => {
      far.fillEllipse(x, H, w * 2, h * 2);
    });
    far.fillStyle(K.GRASS);
    far.fillRect(0, H, W, C.VIEW_HEIGHT - H);

    // Moving grass bands draw between the grass and the road
    this.bands = scene.add.graphics().setDepth(0.1);

    // Road surface layers: triangles/strips running to the vanishing point
    const road = scene.add.graphics().setDepth(0.2);
    const toHorizon = (xa, xb, color, alpha = 1) => {
      road.fillStyle(color, alpha);
      road.fillPoints([
        { x: this.xOf(xa, this.zNear), y: yNear },
        { x: this.xOf(xb, this.zNear), y: yNear },
        { x: this.cx, y: H },
      ], true);
    };
    toHorizon(M - 22, W - M + 22, K.SHOULDER);            // gravel shoulder
    toHorizon(M - 8, W - M + 8, K.KERB_WHITE);
    toHorizon(M, W - M, K.ROAD);

    // Darker tyre-worn tracks in each lane
    const laneW = (W - M * 2) / C.LANE_COUNT;
    for (let i = 0; i < C.LANE_COUNT; i++) {
      const center = M + laneW * (i + 0.5);
      toHorizon(center - 24, center - 14, 0x000000, 0.07);
      toHorizon(center + 14, center + 24, 0x000000, 0.07);
    }
    toHorizon(M + 4, M + 7, K.ROAD_EDGE);
    toHorizon(W - M - 7, W - M - 4, K.ROAD_EDGE);

    // Moving road markings draw on top of the surface
    this.marks = scene.add.graphics().setDepth(0.3);

    // Haze where land meets sky: softens the horizon and distant traffic
    const haze = scene.add.graphics().setDepth(0.35);
    haze.fillGradientStyle(K.SKY_HORIZON, K.SKY_HORIZON, K.SKY_HORIZON, K.SKY_HORIZON, 0, 0, 0.55, 0.55);
    haze.fillRect(0, H - 24, W, 24);
    haze.fillGradientStyle(K.SKY_HORIZON, K.SKY_HORIZON, K.SKY_HORIZON, K.SKY_HORIZON, 0.55, 0.55, 0, 0);
    haze.fillRect(0, H, W, 40);
  }

  /**
   * Time-of-day and weather layers. Each one is built once here and
   * then only has its alpha changed, so a stretch of night, rain or fog
   * costs next to nothing per frame.
   */
  createWeatherLayers() {
    const C = GAME_CONFIG;
    const scene = this.scene;
    const W = C.WIDTH;
    const H = C.VIEW_HEIGHT;

    // Warm sunset sky. It covers the sky gradient and the clouds but
    // sits behind the mountains, so only the sky above the land changes.
    this.skyWash = scene.add.graphics().setDepth(0.015).setAlpha(0);
    this.skyWash.fillGradientStyle(0xe2603a, 0xe2603a, 0xffc98a, 0xffc98a, 1);
    this.skyWash.fillRect(0, 0, W, this.horizon);

    // Stars, drawn once high in the sky and faded in at night
    const stars = scene.add.graphics().setDepth(5.51).setAlpha(0);   // above the night wash, like the moon
    stars.fillStyle(0xffffff, 1);
    for (let i = 0; i < 36; i++) {
      const h = Textures.hash(i);
      const x = ((h % 1000) / 1000) * W;
      const y = (((h >>> 10) % 1000) / 1000) * (this.horizon - 30);
      stars.fillCircle(x, y, ((h >>> 20) % 3) * 0.4 + 0.6);
    }
    this.stars = stars;

    // Fog sits between the far traffic and the near traffic (a car's
    // depth is 5 - z/1000), so distant cars sink into it while the ones
    // the player still has to react to stay clear.
    const fog = scene.add.graphics().setDepth(4.55).setAlpha(0);
    const grey = 0xdfe9ee;
    const top = this.horizon - 70;
    fog.fillGradientStyle(grey, grey, grey, grey, 0, 0, 1, 1);
    fog.fillRect(0, top, W, this.horizon - top);
    fog.fillStyle(grey, 1);
    fog.fillRect(0, this.horizon, W, 70);
    fog.fillGradientStyle(grey, grey, grey, grey, 1, 1, 0, 0);
    fog.fillRect(0, this.horizon + 70, W, 170);
    this.fog = fog;

    // Rain: one scrolling tile over the whole screen
    this.rain = scene.add.tileSprite(0, 0, W, H, 'rainTile')
      .setOrigin(0).setDepth(5.4).setAlpha(0).setTileScale(1 / this.R);

    // Colour wash. Two layers, so one stretch fades into the next
    // without a colour having to be recomputed every frame.
    this.tints = [0, 1].map(() => scene.add.rectangle(0, 0, W, H, 0x000000, 0)
      .setOrigin(0).setDepth(5.5));
  }

  /**
   * Blend the stretch the player is on into the next one. GameScene
   * decides which those are (scene.weather); this only draws them.
   */
  drawWeather(delta) {
    const state = this.scene.weather;
    if (!state) return;
    const styles = GAME_CONFIG.WEATHER.STYLES;
    const from = styles[state.from];
    const to = styles[state.to];
    const blend = state.blend;
    const mix = (key) => from[key] * (1 - blend) + to[key] * blend;

    const night = mix('stars');       // 'stars' doubles as how dark the stretch is
    const fog = mix('fog');
    const rain = mix('rain');
    const sky = mix('sky');

    // A layer that isn't showing is hidden rather than drawn at alpha 0,
    // so a clear stretch costs nothing extra on a weak phone.
    const show = (layer, alpha) => layer.setVisible(alpha > 0.004).setAlpha(alpha);
    show(this.tints[0], from.alpha * (1 - blend)).setFillStyle(from.tint, 1);
    show(this.tints[1], to.alpha * blend).setFillStyle(to.tint, 1);
    show(this.stars, night);
    show(this.skyWash, sky);
    show(this.fog, fog);
    show(this.rain, rain * 0.85);
    show(this.moon, night);

    // The sun fades out as the weather closes in; the moon replaces it
    show(this.sun, 1 - Math.min(1, night + rain + fog * 0.8));
    if (rain > 0.01) {
      this.rain.tilePositionY += delta * 2.4;     // falls fast
      this.rain.tilePositionX -= delta * 0.3;     // slight slant, as if windy
    }
  }

  createSprites() {
    const C = GAME_CONFIG;
    const scene = this.scene;

    this.playerSprite = scene.add.image(0, 0, 'rear', 'rear_player');

    // MEA IEDC start-line arch over the road at the beginning of each run
    this.startArch = scene.add.image(0, 0, 'rear', 'startArch').setVisible(false);

    // Volcano on the horizon during an eruption, and the ground shadows
    // that show where falling rocks will land
    this.volcano = scene.add.image(0, 0, 'rear', 'volcano').setDepth(0.06).setVisible(false);
    this.volcanoAlpha = 0;

    // A plane going down, with a smoke trail behind it
    this.plane = scene.add.image(0, 0, 'rear', 'plane').setDepth(4.9).setVisible(false);
    this.planeSmoke = [0, 1, 2, 3, 4].map(() => scene.add.image(0, 0, 'rear', 'smoke').setDepth(4.8).setVisible(false));
    this.rockShadows = scene.obstacles.map(() => scene.add.image(0, 0, 'rear', 'shadow').setVisible(false));

    // One back-view sprite per obstacle in the game's pool
    this.carSprites = scene.obstacles.map(() => scene.add.image(0, 0, 'rear', 'rear_obstacle0').setVisible(false));

    // Roadside scenery: a small fixed pool (one sprite per side per spot)
    // reused as the road scrolls
    const spots = Math.ceil(C.BACK_VIEW.DRAW_DISTANCE / C.BACK_VIEW.SCENERY_SPACING) + 2;
    this.scenery = [];
    for (let i = 0; i < spots * 2; i++) {
      this.scenery.push(scene.add.image(0, 0, 'rear', 'tree').setVisible(false));
    }

    // What can stand beside the road: how often (weight) and where
    // (world x on the left side, right side). The road runs from
    // ROAD_MARGIN to WIDTH - ROAD_MARGIN; negative x is further out.
    const W = C.WIDTH;
    this.normalScenery = this.weightedList([
      { frame: 'palm',      weight: 4, x: [-14, W + 14] },
      { frame: 'tree',      weight: 3, x: [-34, W + 34] },
      { frame: 'bush',      weight: 3, x: [6, W - 6] },
      { frame: 'lamp',      weight: 2, x: [20, W - 20] },
      { frame: 'post',      weight: 3, x: [28, W - 28] },
      { frame: 'sign',      weight: 1, x: [24, W - 24] },
    ]);
    // MEA IEDC billboards are placed on a fixed rhythm (see sceneryFor),
    // not by chance, so they never bunch up
    this.logoBillboard = { frame: 'billboardLogo', x: [-80, W + 80] };
    // Inside a road-works zone (see roadworksAt)
    this.roadworksScenery = this.weightedList([
      { frame: 'cone',      weight: 5, x: [30, W - 30] },
      { frame: 'barrier',   weight: 3, x: [14, W - 14] },
      { frame: 'worker',    weight: 2, x: [0, W] },
      { frame: 'sandpile',  weight: 2, x: [-26, W + 26] },
      // Animated; mirrored on the right so the arm always digs toward the road
      { frame: 'digger0',   weight: 1, x: [-64, W + 64], animation: 'digger', mirrorOnRight: true },
    ]);

    // Digger animation timing: end time of each pose within one loop
    this.diggerLoopMs = 0;
    this.diggerPoseEnds = Textures.DIGGER_FRAME_MS.map((ms) => (this.diggerLoopMs += ms));
    this.warningSign = { frame: 'workSign', x: [22, W - 22] };

    this.createBirds();
  }

  /** Attach the total weight to a list of scenery kinds. */
  weightedList(kinds) {
    kinds.totalWeight = kinds.reduce((sum, k) => sum + k.weight, 0);
    return kinds;
  }

  /** A small pool of birds that fly across the sky as one flock. */
  createBirds() {
    const B = GAME_CONFIG.BACK_VIEW;
    this.birds = [];
    for (let i = 0; i < B.BIRD_FLOCK_SIZE; i++) {
      this.birds.push(this.scene.add.image(0, 0, 'rear', 'bird0').setDepth(0.05).setVisible(false));
    }
    this.flock = null;
    this.nextFlockIn = 0; // ms; the first flock comes as soon as birds unlock
  }

  // ------------------------------------------------------------
  //  Per frame
  // ------------------------------------------------------------
  /** Draw the current game state. Called every frame, alive or dead. */
  render(delta) {
    const distance = this.scene.distance;
    this.drawClouds();
    this.drawBirds();
    this.drawRoad(distance);
    this.drawScenery(distance);
    this.drawVolcano();
    this.drawPlane();
    this.drawStartArch(distance);
    this.drawPlayer();
    this.drawTraffic();
    this.drawWeather(delta);
  }

  /** Grass bands, kerb stripes and lane dashes, moving toward the camera. */
  drawRoad(distance) {
    const C = GAME_CONFIG;
    const B = C.BACK_VIEW;
    const K = C.COLORS;
    const M = C.ROAD_MARGIN;
    const W = C.WIDTH;
    const laneW = (W - M * 2) / C.LANE_COUNT;

    // Alternating light/dark stretches of grass (and a faint road shade)
    const bands = this.bands;
    const marks = this.marks;
    bands.clear();
    marks.clear();

    const bandLen = B.BAND_LENGTH;
    this.forEachSegment(distance, bandLen * 2, bandLen, B.DRAW_DISTANCE, (z1, z2) => {
      const y1 = this.yOf(z1);
      const y2 = this.yOf(z2);
      bands.fillStyle(K.GRASS_DARK);
      bands.fillRect(0, y2, W, y1 - y2);
      marks.fillStyle(0x000000, 0.06);
      this.quad(marks, M, W - M, z1, z2);
    });

    // Red kerb stripes (the white base is part of the static layer)
    marks.fillStyle(K.KERB_RED);
    this.forEachSegment(distance, 40, 20, B.MARKINGS_DISTANCE, (z1, z2) => {
      this.quad(marks, M - 8, M, z1, z2);
      this.quad(marks, W - M, W - M + 8, z1, z2);
    });

    // Dashed lane dividers
    const dashPeriod = C.ROAD_TILE_HEIGHT;
    const dashLen = dashPeriod * 0.45;
    marks.fillStyle(K.LANE_DASH);
    this.forEachSegment(distance, dashPeriod, dashLen, B.MARKINGS_DISTANCE, (z1, z2) => {
      for (let i = 1; i < C.LANE_COUNT; i++) {
        const x = M + i * laneW;
        this.quad(marks, x - 2, x + 2, z1, z2);
      }
    });

    // Reflective cat's eyes in the gaps between dashes (nearby only)
    marks.fillStyle(K.CATS_EYE);
    this.forEachSegment(distance, dashPeriod, 5, B.CATS_EYE_DISTANCE, (z1, z2) => {
      for (let i = 1; i < C.LANE_COUNT; i++) {
        const x = M + i * laneW;
        this.quad(marks, x - 3, x + 3, z1, z2);
      }
    }, (dashLen + dashPeriod) / 2);
  }

  /** Clouds drift slowly sideways and wrap around. */
  drawClouds() {
    const dt = this.scene.game.loop.delta / 1000;
    const W = GAME_CONFIG.WIDTH;
    for (const cloud of this.clouds) {
      cloud.x += cloud.driftSpeed * dt;
      if (cloud.x - cloud.displayWidth / 2 > W) cloud.x = -cloud.displayWidth / 2;
    }
  }

  /**
   * Call fn(zNear, zFar) for every painted segment of a repeating
   * pattern (`length` painted, then gap, every `period`, starting
   * `phase` into the period) that is fixed to the road and therefore
   * slides toward the camera as we drive.
   */
  forEachSegment(distance, period, length, maxZ, fn, phase = 0) {
    let z = phase - (distance % period) - period;
    for (; z < maxZ; z += period) {
      const z1 = Math.max(z, this.zNear);
      const z2 = Math.min(z + length, maxZ);
      if (z2 > z1) fn(z1, z2);
    }
  }

  /** Fill the road strip between world x xa..xb and depths z1..z2. */
  quad(g, xa, xb, z1, z2) {
    const y1 = this.yOf(z1);
    const y2 = this.yOf(z2);
    const s1 = this.scaleOf(z1);
    const s2 = this.scaleOf(z2);
    const cx = this.cx;
    g.beginPath();
    g.moveTo(cx + (xa - cx) * s1, y1);
    g.lineTo(cx + (xb - cx) * s1, y1);
    g.lineTo(cx + (xb - cx) * s2, y2);
    g.lineTo(cx + (xa - cx) * s2, y2);
    g.closePath();
    g.fillPath();
  }

  /**
   * Roadside objects at fixed spots along both sides of the road. Each
   * spot/side always gets the same object, so scenery stays put as it
   * scrolls past; the choice is a fixed pseudo-random pick by weight.
   * Further into a run, some stretches become road-works zones.
   */
  drawScenery(distance) {
    const C = GAME_CONFIG;
    const spacing = C.BACK_VIEW.SCENERY_SPACING;
    const first = Math.floor(distance / spacing);

    for (let i = 0; i < this.scenery.length; i++) {
      const sprite = this.scenery[i];
      const index = first + Math.floor(i / 2);   // this spot's fixed number along the road
      const side = i % 2;                         // 0 = left, 1 = right
      // Stagger the two sides by half a spot so they don't line up
      const roadPos = (index + side * 0.5) * spacing;
      const z = roadPos - distance;
      if (z <= this.zCull || z > C.BACK_VIEW.DRAW_DISTANCE) {
        sprite.setVisible(false);
        continue;
      }
      const spotNumber = index * 2 + side;
      const kind = this.sceneryFor(roadPos, spotNumber, side);
      const frame = kind.animation ? this.diggerFrame(spotNumber) : kind.frame;
      if (sprite.frame.name !== frame) sprite.setFrame(frame);
      sprite.setFlipX(Boolean(kind.mirrorOnRight) && side === 1);
      sprite.setVisible(true)
        .setPosition(this.xOf(kind.x[side], z), this.yOf(z))
        .setScale(this.scaleOf(z) / this.R)
        .setDepth(this.depthOf(z));
    }
  }

  /**
   * Current digger pose frame. Just picks one of the pre-drawn frames by
   * time, so animating costs almost nothing. Each digger starts at a
   * different point in the loop so neighbours don't move in sync.
   */
  diggerFrame(spotNumber) {
    const t = (this.scene.time.now + Textures.hash(spotNumber)) % this.diggerLoopMs;
    let pose = 0;
    while (t >= this.diggerPoseEnds[pose]) pose++;
    return 'digger' + pose;
  }

  /** What stands at a roadside spot, given how far along the road it is. */
  sceneryFor(roadPos, spotNumber, side) {
    const zone = this.roadworksAt(roadPos);
    if (zone === 'warning' && side === 1) return this.warningSign;

    // One logo billboard every BILLBOARD_EVERY spots, alternating sides
    const index = Math.floor(spotNumber / 2);
    const every = GAME_CONFIG.BACK_VIEW.BILLBOARD_EVERY;
    if (zone === 'none' && index % every === 0 && side === (index / every) % 2) return this.logoBillboard;

    const kinds = zone === 'zone' ? this.roadworksScenery : this.normalScenery;
    let roll = Textures.hash(spotNumber) % kinds.totalWeight;
    for (const kind of kinds) {
      if (roll < kind.weight) return kind;
      roll -= kind.weight;
    }
    return kinds[0];
  }

  /**
   * Road works: from ROADWORKS_FROM_POINTS into a run, a zone of
   * ROADWORKS_LENGTH starts every ROADWORKS_EVERY units of road, with a
   * warning sign just before each. Returns 'zone', 'warning' or 'none'.
   */
  roadworksAt(roadPos) {
    const B = GAME_CONFIG.BACK_VIEW;
    const rel = roadPos - B.ROADWORKS_FROM_POINTS * GAME_CONFIG.PIXELS_PER_POINT;
    const cycle = Math.floor(rel / B.ROADWORKS_EVERY);
    const intoCycle = rel - cycle * B.ROADWORKS_EVERY;
    if (cycle >= 0 && intoCycle < B.ROADWORKS_LENGTH) return 'zone';
    if (B.ROADWORKS_EVERY - intoCycle <= B.ROADWORKS_WARNING && cycle + 1 >= 0) return 'warning';
    return 'none';
  }

  /**
   * Birds: once the player has gone BIRDS_FROM_POINTS, a flock crosses
   * the sky in a V formation every so often, flapping as it goes.
   */
  drawBirds() {
    const B = GAME_CONFIG.BACK_VIEW;
    const W = GAME_CONFIG.WIDTH;
    const dtMs = this.scene.game.loop.delta;

    if (!this.flock) {
      if (this.scene.progress() < B.BIRDS_FROM_POINTS) return;
      this.nextFlockIn -= dtMs;
      if (this.nextFlockIn > 0) return;
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.flock = {
        dir,
        x: dir > 0 ? -40 : W + 40,
        y: this.skyY(Phaser.Math.FloatBetween(0.05, 0.9)),
        speed: B.BIRD_SPEED * Phaser.Math.FloatBetween(0.8, 1.3),
        size: Phaser.Math.FloatBetween(0.8, 1.25),
        time: 0,
      };
    }

    const f = this.flock;
    f.time += dtMs;
    f.x += f.dir * f.speed * dtMs / 1000;

    this.birds.forEach((bird, i) => {
      const row = Math.ceil(i / 2);                  // 0 = leader, then pairs behind
      const wing = i % 2 === 0 ? 1 : -1;             // above / below the leader's line
      const x = f.x - f.dir * row * 15 * f.size;
      const y = f.y + wing * row * 7 * f.size + Math.sin(f.time / 300 + i) * 1.5;
      const frame = (f.time + i * 110) % 320 < 160 ? 'bird0' : 'bird1';
      if (bird.frame.name !== frame) bird.setFrame(frame);
      bird.setVisible(true).setPosition(x, y).setScale(f.size * (1 - row * 0.06) / this.R).setFlipX(f.dir < 0);
    });

    const trailing = f.x - f.dir * 3 * 15 * f.size;  // last bird in the V
    if ((f.dir > 0 && trailing > W + 30) || (f.dir < 0 && trailing < -30)) {
      this.birds.forEach((bird) => bird.setVisible(false));
      this.flock = null;
      this.nextFlockIn = Phaser.Math.Between(B.BIRD_GAP_MIN_MS, B.BIRD_GAP_MAX_MS);
    }
  }

  /**
   * The start arch stands START_ARCH_AT along the road, so each run begins
   * by driving under it. It is passed before the first traffic appears,
   * so it never hides cars. It fades out just before reaching the camera
   * (a tall overhead banner can't be drawn correctly that close).
   */
  drawStartArch(distance) {
    const B = GAME_CONFIG.BACK_VIEW;
    const arch = this.startArch;
    const z = B.START_ARCH_AT - distance;
    if (z < 10 || z > B.DRAW_DISTANCE) {
      arch.setVisible(false);
      return;
    }
    arch.setVisible(true)
      .setPosition(this.xOf(this.cx, z), this.yOf(z))
      .setScale(this.scaleOf(z) / this.R)
      .setDepth(this.depthOf(z))
      .setAlpha(Phaser.Math.Clamp((z - 10) / 110, 0, 1));
  }

  /**
   * The volcano sits on the horizon, fading in just before an eruption
   * and out again afterwards. It stays a fixed size: it is far away, not
   * something the player drives past.
   */
  drawVolcano() {
    const state = this.scene.volcanoAt(this.scene.distance);
    const target = state === 'none' ? 0 : 1;
    const dt = Math.min(this.scene.game.loop.delta, 50) / 1000;
    this.volcanoAlpha = Phaser.Math.Linear(this.volcanoAlpha, target, Math.min(1, dt * 2.2));
    if (this.volcanoAlpha < 0.02) {
      this.volcano.setVisible(false);
      return;
    }
    const height = this.horizon * 0.8;           // fills most of the sky band
    this.volcano.setVisible(true)
      .setPosition(GAME_CONFIG.WIDTH * 0.2, this.horizon + 6)
      .setScale(height / 200 / this.R)
      .setAlpha(this.volcanoAlpha);
  }

  /**
   * The falling plane: it comes in from one side, drops toward the road
   * ahead and shrinks as it goes, trailing smoke. GameScene decides when
   * it flies and what happens when it lands.
   */
  drawPlane() {
    const flight = this.scene.plane;
    if (!flight) {
      this.plane.setVisible(false);
      this.planeSmoke.forEach((puff) => puff.setVisible(false));
      return;
    }
    const W = GAME_CONFIG.WIDTH;
    const p = Phaser.Math.Clamp(flight.t / GAME_CONFIG.AIRPLANE.FLIGHT_MS, 0, 1);

    // From high at one side down to the road, near the horizon
    const at = (t) => {
      const ease = t * t;                                  // falls faster as it goes
      return {
        x: Phaser.Math.Linear(this.cx + flight.side * (W * 0.58), this.cx + flight.side * 24, t),
        y: Phaser.Math.Linear(this.skyY(0.05), this.horizon + 26, ease),
        scale: Phaser.Math.Linear(1, 0.42, t),
      };
    };

    const now = at(p);
    this.plane.setVisible(true)
      .setPosition(now.x, now.y)
      .setScale(now.scale / this.R)
      .setFlipX(flight.side < 0)
      .setAngle(flight.side * (12 + 26 * p))               // nose dropping
      .setAlpha(p > 0.94 ? (1 - p) / 0.06 : 1);            // gone at the moment of impact

    // Smoke puffs left behind along the path
    this.planeSmoke.forEach((puff, i) => {
      const trail = p - (i + 1) * 0.06;
      if (trail <= 0) {
        puff.setVisible(false);
        return;
      }
      const spot = at(trail);
      puff.setVisible(true)
        .setPosition(spot.x, spot.y)
        .setScale(spot.scale * (0.5 + i * 0.16) / this.R)
        .setAlpha(0.6 * (1 - i / (this.planeSmoke.length + 1)));
    });
  }

  drawPlayer() {
    const p = this.scene.player;
    const sprite = this.playerSprite;
    sprite.setPosition(this.xOf(p.x, this.zPlayer), this.yOf(this.zPlayer))
      .setScale(this.playerScale / this.R)
      .setAngle(p.angle * 0.5)
      .setDepth(this.depthOf(this.zPlayer));

    // Mirror the near-miss flash and crash tint from the game's player
    if (!p.isTinted) sprite.clearTint();
    else if (p.tintFill) sprite.setTintFill(p.tintTopLeft);
    else sprite.setTint(p.tintTopLeft);
  }

  drawTraffic() {
    const B = GAME_CONFIG.BACK_VIEW;
    const obstacles = this.scene.obstacles;
    for (let i = 0; i < obstacles.length; i++) {
      const car = obstacles[i];
      const sprite = this.carSprites[i];
      const z = this.obstacleZ(car.y);
      if (!car.active || z <= this.zTrafficCull || z > B.DRAW_DISTANCE) {
        sprite.setVisible(false);
        if (this.rockShadows[i]) this.rockShadows[i].setVisible(false);
        continue;
      }
      const frame = 'rear_' + car.frame.name;
      if (sprite.frame.name !== frame) sprite.setFrame(frame);
      const scale = this.scaleOf(z);
      const groundY = this.yOf(z);
      sprite.setVisible(true)
        .setPosition(this.xOf(car.x, z), groundY)
        .setScale(scale / this.R)
        .setDepth(this.depthOf(z))
        .setAngle(0)
        // Fade in from the distance instead of popping into view
        .setAlpha(Phaser.Math.Clamp((this.zSpawn - z) / B.FADE_IN_DISTANCE, 0, 1));

      // A lava rock drops out of the sky onto its lane, with a shadow
      // marking where it lands, so the player can read it early.
      const shadow = this.rockShadows[i];
      const fall = car.isRock
        ? Phaser.Math.Clamp((car.y - car.spawnedY) / GAME_CONFIG.VOLCANO.FALL_DISTANCE, 0, 1)
        : 1;
      if (car.isRock && fall < 1) {
        sprite.y = groundY - (1 - fall) * (1 - fall) * 420 * scale;
        sprite.setAngle((1 - fall) * 70);
        shadow.setVisible(true)
          .setPosition(this.xOf(car.x, z), groundY)
          .setScale(scale / this.R)
          .setAlpha(0.25 + 0.75 * fall)
          .setDepth(this.depthOf(z) - 0.01);
      } else {
        shadow.setVisible(false);
      }
    }
  }

  /** Where the near-miss popup should appear (above the player's car). */
  popupPosition() {
    const p = this.scene.player;
    const top = this.yOf(this.zPlayer) - this.playerArtTop * this.playerScale;
    return { x: this.xOf(p.x, this.zPlayer), y: top - 30 };
  }
}
