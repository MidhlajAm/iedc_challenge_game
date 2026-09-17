/*
 * Procedural textures — cars, road and scenery drawn in code at startup.
 *
 * No image files are downloaded, so art costs 0KB on slow wifi.
 * Everything is drawn at RENDER_SCALE (e.g. 2x) so it stays sharp on
 * high-density phone screens; game objects display it at 1/RENDER_SCALE.
 *
 * Output:
 *  - 'cars'  atlas, TOP VIEW vehicles: 'player', 'obstacle0', 'obstacle1',
 *            ... (one per GAME_CONFIG.OBSTACLE_CARS entry)
 *  - 'rear'  atlas, BACK VIEW vehicles seen from behind: 'rear_player',
 *            'rear_obstacle0', ... plus roadside scenery: 'tree', 'lamp',
 *            'bush'. Frames in this atlas are anchored at their bottom
 *            centre (where they touch the ground).
 *  - 'road0', 'road1', ... TOP VIEW road tile variants. Separate textures
 *            so their top and bottom edges tile without seams.
 *
 * An atlas = one texture, so sprites batch into a single GPU draw call.
 */
const Textures = {
  // Transparent padding around each top-view car frame (room for the
  // shadow and wheels; also stops neighbouring frames bleeding together)
  CAR_PAD: 8,

  // Number of top-view road tile variants (see createRoad)
  ROAD_VARIANTS: 3,

  // Back-view vehicle art height in world units (tallest vehicle, the van)
  REAR_HEIGHT: 60,

  /** Build every texture once. Safe to call on every scene restart. */
  createAll(scene) {
    if (scene.textures.exists('cars')) return;
    for (let i = 0; i < Textures.ROAD_VARIANTS; i++) Textures.createRoad(scene, i);
    Textures.createTopAtlas(scene);
    Textures.createRearAtlas(scene);
  },

  /** Every vehicle: the player first, then GAME_CONFIG.OBSTACLE_CARS. */
  vehicleList() {
    const C = GAME_CONFIG;
    return [{ name: 'player', type: 'player', color: C.COLORS.PLAYER }]
      .concat(C.OBSTACLE_CARS.map((car, i) => ({ name: 'obstacle' + i, type: car.type, color: car.color })));
  },

  // ------------------------------------------------------------
  //  Atlas builder
  // ------------------------------------------------------------
  /**
   * Draw several items into one texture and register a named frame for
   * each. Items: { name, w, h, draw(g), pivotY? } with w/h in world
   * units. `draw` paints inside (0,0)-(w,h) using texture pixels.
   * `pivotY` (0..1) sets where sprites using the frame are anchored.
   */
  buildAtlas(scene, key, items) {
    const R = GAME_CONFIG.RENDER_SCALE;
    const maxWidth = 1024;

    // Simple shelf packing: fill rows left to right
    let x = 0;
    let y = 0;
    let rowH = 0;
    let atlasW = 0;
    const placed = items.map((item) => {
      const w = Math.ceil(item.w * R);
      const h = Math.ceil(item.h * R);
      if (x > 0 && x + w > maxWidth) {
        x = 0;
        y += rowH;
        rowH = 0;
      }
      const spot = { item, x, y, w, h };
      x += w;
      rowH = Math.max(rowH, h);
      atlasW = Math.max(atlasW, x);
      return spot;
    });
    const atlasH = y + rowH;

    const g = scene.make.graphics({ add: false });
    placed.forEach((p) => {
      g.save();
      g.translateCanvas(p.x, p.y);
      p.item.draw(g);
      g.restore();
    });
    g.generateTexture(key, atlasW, atlasH);
    g.destroy();

    const texture = scene.textures.get(key);
    placed.forEach((p) => {
      const frame = texture.add(p.item.name, 0, p.x, p.y, p.w, p.h);
      if (p.item.pivotY !== undefined) {
        frame.customPivot = true;
        frame.pivotX = 0.5;
        frame.pivotY = p.item.pivotY;
      }
    });
  },

  // ------------------------------------------------------------
  //  TOP VIEW: road
  // ------------------------------------------------------------
  /**
   * One vertical tile of roadside + road. GameScene stacks copies down
   * the screen, so its height is the repeat period of the dashes. All
   * variants share the road, kerbs and grass bands (so they tile with
   * each other) and differ only in roadside decoration.
   */
  createRoad(scene, variant) {
    const C = GAME_CONFIG;
    const R = C.RENDER_SCALE;
    const s = (v) => v * R;
    const W = C.WIDTH;
    const H = C.ROAD_TILE_HEIGHT;
    const M = C.ROAD_MARGIN;
    const roadW = W - M * 2;
    const laneW = roadW / C.LANE_COUNT;
    const K = C.COLORS;
    const g = scene.make.graphics({ add: false });

    // Grass in two tones so movement is visible at the roadside
    g.fillStyle(K.GRASS);
    g.fillRect(0, 0, s(W), s(H / 2));
    g.fillStyle(K.GRASS_DARK);
    g.fillRect(0, s(H / 2), s(W), s(H / 2));

    // Roadside decoration (x within the grass strips only)
    if (variant === 0) {
      // Bushes
      g.fillStyle(K.BUSH);
      g.fillCircle(s(16), s(28), s(9));
      g.fillCircle(s(24), s(22), s(7));
      g.fillCircle(s(W - 18), s(H - 34), s(10));
      g.fillCircle(s(W - 26), s(H - 26), s(6));
    } else if (variant === 1) {
      // Street lamps on both sides, arms reaching over the kerb
      [[14, 30, 1], [W - 14, 90, -1]].forEach(([x, y, dir]) => {
        g.fillStyle(0xfff3b0, 0.18);
        g.fillCircle(s(x + dir * 22), s(y), s(14));          // light pool
        g.fillStyle(K.LAMP_POST);
        g.fillRect(s(Math.min(x, x + dir * 22)), s(y - 1.5), s(22), s(3)); // arm
        g.fillCircle(s(x), s(y), s(5));                       // post
        g.fillStyle(0xfff3b0);
        g.fillCircle(s(x + dir * 22), s(y), s(3));            // bulb
      });
    } else {
      // Flowers and rocks
      g.fillStyle(K.ROCK);
      g.fillCircle(s(20), s(80), s(6));
      g.fillCircle(s(28), s(84), s(4));
      g.fillCircle(s(W - 22), s(26), s(5));
      g.fillStyle(K.FLOWER);
      [[12, 22], [26, 36], [16, 48], [W - 16, 70], [W - 28, 86], [W - 14, 100]].forEach(([x, y]) => {
        g.fillCircle(s(x), s(y), s(2.5));
      });
    }

    // Asphalt
    g.fillStyle(K.ROAD);
    g.fillRect(s(M), 0, s(roadW), s(H));

    // Subtle asphalt speckle (fixed positions, so the tile repeats cleanly)
    g.fillStyle(K.ROAD_SPECKLE);
    const specks = [[0.12, 0.2], [0.37, 0.65], [0.58, 0.15], [0.81, 0.48], [0.24, 0.9], [0.69, 0.82], [0.93, 0.3]];
    specks.forEach(([fx, fy]) => g.fillRect(s(M + ((fx + variant * 0.29) % 1) * roadW), s(fy * H), s(2), s(2)));

    // Red/white rumble strips along both edges
    const kerbW = 8;
    const seg = H / 4;
    for (let i = 0; i < 4; i++) {
      g.fillStyle(i % 2 === 0 ? K.KERB_RED : K.KERB_WHITE);
      g.fillRect(s(M - kerbW), s(i * seg), s(kerbW), s(seg));
      g.fillRect(s(M + roadW), s(i * seg), s(kerbW), s(seg));
    }

    // Solid white edge lines
    g.fillStyle(K.ROAD_EDGE);
    g.fillRect(s(M + 4), 0, s(3), s(H));
    g.fillRect(s(M + roadW - 7), 0, s(3), s(H));

    // Dashed lane dividers
    g.fillStyle(K.LANE_DASH);
    for (let i = 1; i < C.LANE_COUNT; i++) {
      g.fillRect(s(M + i * laneW - 2), 0, s(4), s(H * 0.45));
    }

    g.generateTexture('road' + variant, s(W), s(H));
    g.destroy();
  },

  // ------------------------------------------------------------
  //  TOP VIEW: vehicles
  // ------------------------------------------------------------
  createTopAtlas(scene) {
    const C = GAME_CONFIG;
    const P = Textures.CAR_PAD;
    Textures.buildAtlas(scene, 'cars', Textures.vehicleList().map((car) => ({
      name: car.name,
      w: C.CAR_WIDTH + P * 2,
      h: C.CAR_HEIGHT + P * 2,
      draw: (g) => Textures.drawTopCar(g, car.type, car.color),
    })));
  },

  /**
   * A top-down vehicle facing up the screen, drawn inside its padded
   * frame. Shared parts first (shadow, wheels, body), then per type.
   */
  drawTopCar(g, type, color) {
    const C = GAME_CONFIG;
    const s = (v) => v * C.RENDER_SCALE;
    const w = C.CAR_WIDTH;
    const h = C.CAR_HEIGHT;
    const x = Textures.CAR_PAD;
    const y = Textures.CAR_PAD;
    const { dark, light } = Textures.shades(color);
    const glass = 0x1c2733;
    const radius = type === 'van' ? 8 : 13;

    // Soft drop shadow, offset down-right
    g.fillStyle(0x000000, 0.28);
    g.fillRoundedRect(s(x + 3), s(y + 5), s(w), s(h), s(radius));

    // Wheels peeking out from the body
    g.fillStyle(0x151515);
    [y + 14, y + h - 30].forEach((wy) => {
      g.fillRoundedRect(s(x - 3), s(wy), s(7), s(18), s(3));
      g.fillRoundedRect(s(x + w - 4), s(wy), s(7), s(18), s(3));
    });

    // Body: darker outline, main colour, highlight on the bonnet
    g.fillStyle(dark);
    g.fillRoundedRect(s(x), s(y), s(w), s(h), s(radius));
    g.fillStyle(color);
    g.fillRoundedRect(s(x + 2), s(y + 2), s(w - 4), s(h - 4), s(radius - 2));
    g.fillStyle(light, 0.6);
    g.fillRoundedRect(s(x + 8), s(y + 6), s(w - 16), s(14), s(6));

    const stripes = (fromY, toY) => {
      g.fillStyle(0xffffff, 0.9);
      g.fillRect(s(x + w / 2 - 8), s(fromY), s(5), s(toY - fromY));
      g.fillRect(s(x + w / 2 + 3), s(fromY), s(5), s(toY - fromY));
    };

    if (type === 'van') {
      // Short bonnet, tall windscreen, long flat roof with roof rails
      g.fillStyle(glass);
      g.fillRoundedRect(s(x + 6), s(y + 20), s(w - 12), s(15), s(4));
      g.fillStyle(light);
      g.fillRoundedRect(s(x + 5), s(y + 37), s(w - 10), s(h - 44), s(5));
      g.fillStyle(dark);
      g.fillRect(s(x + 11), s(y + 42), s(3), s(h - 54));
      g.fillRect(s(x + w - 14), s(y + 42), s(3), s(h - 54));
    } else if (type === 'pickup') {
      // Cab up front, open load bed behind
      g.fillStyle(glass);
      g.fillRoundedRect(s(x + 7), s(y + 22), s(w - 14), s(14), s(4));
      g.fillStyle(dark);
      g.fillRoundedRect(s(x + 8), s(y + 37), s(w - 16), s(20), s(4));
      g.fillStyle(glass);
      g.fillRect(s(x + 10), s(y + 57), s(w - 20), s(4));
      g.fillStyle(0x2a2a2a);
      g.fillRoundedRect(s(x + 6), s(y + 65), s(w - 12), s(h - 73), s(3));
      g.fillStyle(dark);
      g.fillRect(s(x + 6), s(y + 76), s(w - 12), s(2));
      g.fillRect(s(x + 6), s(y + 86), s(w - 12), s(2));
    } else {
      // Sedan-shaped: player, sedan, taxi
      if (type === 'player') stripes(y + 2, y + h - 2);
      g.fillStyle(glass);
      g.fillRoundedRect(s(x + 7), s(y + 25), s(w - 14), s(17), s(5));
      g.fillStyle(dark);
      g.fillRoundedRect(s(x + 9), s(y + 43), s(w - 18), s(28), s(5));
      if (type === 'player') stripes(y + 43, y + 71);
      g.fillStyle(glass);
      g.fillRoundedRect(s(x + 9), s(y + 72), s(w - 18), s(11), s(4));

      if (type === 'taxi') {
        // Roof sign and checker strip down both sides
        g.fillStyle(0xffffff);
        g.fillRoundedRect(s(x + w / 2 - 11), s(y + 51), s(22), s(10), s(3));
        g.fillStyle(0x222222);
        g.fillRect(s(x + w / 2 - 7), s(y + 55), s(14), s(2));
        for (let i = 0; i < 6; i++) {
          g.fillStyle(i % 2 === 0 ? 0x222222 : 0xffffff);
          g.fillRect(s(x + 2), s(y + 30 + i * 7), s(4), s(7));
          g.fillRect(s(x + w - 6), s(y + 30 + i * 7), s(4), s(7));
        }
      }
    }

    // Windscreen glare
    g.fillStyle(0xffffff, 0.18);
    g.fillRect(s(x + 11), s(y + (type === 'van' ? 23 : 28)), s(10), s(4));

    // Headlights (front = top) and tail lights (back = bottom)
    g.fillStyle(0xfff3b0);
    g.fillRoundedRect(s(x + 5), s(y + 2), s(11), s(5), s(2));
    g.fillRoundedRect(s(x + w - 16), s(y + 2), s(11), s(5), s(2));
    g.fillStyle(0xff3b30);
    g.fillRoundedRect(s(x + 5), s(y + h - 6), s(11), s(4), s(2));
    g.fillRoundedRect(s(x + w - 16), s(y + h - 6), s(11), s(4), s(2));
  },

  // ------------------------------------------------------------
  //  BACK VIEW: vehicles from behind + roadside scenery + sky
  // ------------------------------------------------------------
  createRearAtlas(scene) {
    const C = GAME_CONFIG;
    const P = Textures.CAR_PAD;
    const H = Textures.REAR_HEIGHT;
    const frameH = H + P * 2;

    const items = Textures.vehicleList().map((car) => ({
      name: 'rear_' + car.name,
      w: C.CAR_WIDTH + P * 2,
      h: frameH,
      pivotY: (P + H) / frameH, // anchor at the tyres' contact line
      draw: (g) => Textures.drawRearCar(g, car.type, car.color),
    }));

    // Scenery: pivotY = ground line / frame height
    items.push(
      { name: 'tree', w: 64, h: 104, pivotY: 100 / 104, draw: (g) => Textures.drawTree(g) },
      { name: 'palm', w: 76, h: 132, pivotY: 128 / 132, draw: (g) => Textures.drawPalm(g) },
      { name: 'lamp', w: 40, h: 124, pivotY: 120 / 124, draw: (g) => Textures.drawLamp(g) },
      { name: 'bush', w: 52, h: 34, pivotY: 30 / 34, draw: (g) => Textures.drawBush(g) },
      { name: 'billboard', w: 112, h: 98, pivotY: 94 / 98, draw: (g) => Textures.drawBillboard(g) },
      { name: 'sign', w: 32, h: 70, pivotY: 66 / 70, draw: (g) => Textures.drawSign(g) },
      { name: 'post', w: 16, h: 30, pivotY: 27 / 30, draw: (g) => Textures.drawPost(g) },
      { name: 'cloud', w: 140, h: 52, draw: (g) => Textures.drawCloud(g) },
      // Road works (appear further into a run)
      { name: 'cone', w: 18, h: 24, pivotY: 22 / 24, draw: (g) => Textures.drawCone(g) },
      { name: 'barrier', w: 56, h: 36, pivotY: 34 / 36, draw: (g) => Textures.drawBarrier(g) },
      { name: 'workSign', w: 40, h: 76, pivotY: 72 / 76, draw: (g) => Textures.drawWorkSign(g) },
      { name: 'worker', w: 32, h: 50, pivotY: 46 / 50, draw: (g) => Textures.drawWorker(g) },
      ...Textures.DIGGER_POSES.map((pose, i) => (
        { name: 'digger' + i, w: 124, h: 88, pivotY: 84 / 88, draw: (g) => Textures.drawDigger(g, i) })),
      { name: 'sandpile', w: 64, h: 26, pivotY: 24 / 26, draw: (g) => Textures.drawSandPile(g) },
      // Birds: two wing positions for flapping
      { name: 'bird0', w: 18, h: 12, draw: (g) => Textures.drawBird(g, true) },
      { name: 'bird1', w: 18, h: 12, draw: (g) => Textures.drawBird(g, false) },
    );
    Textures.buildAtlas(scene, 'rear', items);
  },

  /**
   * A vehicle seen from behind and slightly above: tyres, bumper, tail
   * lights and number plate low down; cabin and rear window above.
   * Ground contact line is at y = CAR_PAD + REAR_HEIGHT.
   */
  drawRearCar(g, type, color) {
    const C = GAME_CONFIG;
    const s = (v) => v * C.RENDER_SCALE;
    const pt = (x, y) => ({ x: s(x), y: s(y) });
    const w = C.CAR_WIDTH;
    const x = Textures.CAR_PAD;
    const cx = x + w / 2;
    const yb = Textures.CAR_PAD + Textures.REAR_HEIGHT; // ground line
    const { dark, light } = Textures.shades(color);
    const glass = 0x1c2733;
    const isPlayer = type === 'player';

    // Shadow on the road
    g.fillStyle(0x000000, 0.32);
    g.fillEllipse(s(cx), s(yb - 1), s(w + 10), s(10));

    // Tyres with a visible tread line
    [x + 1, x + w - 12].forEach((tx) => {
      g.fillStyle(0x151515);
      g.fillRoundedRect(s(tx), s(yb - 14), s(11), s(14), s(3));
      g.fillStyle(0x3a3a3a);
      g.fillRect(s(tx + 2), s(yb - 11), s(7), s(1.5));
      g.fillRect(s(tx + 2), s(yb - 6), s(7), s(1.5));
    });

    // Cabin (drawn first so the body overlaps its bottom edge)
    if (type === 'van') {
      g.fillStyle(light);
      g.fillRoundedRect(s(x + 2), s(yb - 58), s(w - 4), s(34), s(6));
      g.fillStyle(0x000000, 0.08);                            // side shading
      g.fillRect(s(x + 2), s(yb - 52), s(5), s(26));
      g.fillRect(s(x + w - 7), s(yb - 52), s(5), s(26));
      g.fillStyle(glass);
      g.fillRoundedRect(s(x + 7), s(yb - 53), s(18), s(12), s(3));
      g.fillRoundedRect(s(x + w - 25), s(yb - 53), s(18), s(12), s(3));
      g.fillStyle(0xffffff, 0.18);                            // window reflections
      g.fillTriangle(s(x + 9), s(yb - 42), s(x + 16), s(yb - 52), s(x + 20), s(yb - 52));
      g.fillTriangle(s(x + w - 23), s(yb - 42), s(x + w - 16), s(yb - 52), s(x + w - 12), s(yb - 52));
      g.fillStyle(dark);
      g.fillRect(s(cx - 1), s(yb - 56), s(2), s(30));         // rear door split
      g.fillRect(s(cx - 7), s(yb - 38), s(4), s(2));          // door handles
      g.fillRect(s(cx + 3), s(yb - 38), s(4), s(2));
      g.fillStyle(0x455a64);                                  // roof rack
      g.fillRect(s(x + 6), s(yb - 61), s(w - 12), s(2));
      g.fillRect(s(x + 10), s(yb - 60), s(2), s(3));
      g.fillRect(s(x + w - 12), s(yb - 60), s(2), s(3));
    } else {
      const narrow = type === 'pickup' ? 5 : 0;              // pickup cab sits further forward
      const top = type === 'pickup' ? yb - 46 : yb - 50;

      // Wing mirrors poking out either side of the cabin
      g.fillStyle(dark);
      g.fillRoundedRect(s(x - 3 + narrow), s(yb - 34), s(7), s(5), s(2));
      g.fillRoundedRect(s(x + w - 4 - narrow), s(yb - 34), s(7), s(5), s(2));

      g.fillPoints([pt(x + 6 + narrow, yb - 28), pt(x + w - 6 - narrow, yb - 28),
        pt(x + w - 13 - narrow, top), pt(x + 13 + narrow, top)], true);
      g.fillStyle(glass);
      g.fillPoints([pt(x + 10 + narrow, yb - 30), pt(x + w - 10 - narrow, yb - 30),
        pt(x + w - 15 - narrow, top + 3), pt(x + 15 + narrow, top + 3)], true);

      // Diagonal sky reflection across the rear window
      g.fillStyle(0xffffff, 0.14);
      g.fillPoints([pt(x + 14 + narrow, yb - 30), pt(x + 24 + narrow, yb - 30),
        pt(x + 34 - narrow, top + 3), pt(x + 26 - narrow, top + 3)], true);

      // Third brake light along the top of the window
      g.fillStyle(0xff3b30, 0.9);
      g.fillRect(s(cx - 7), s(top + 4), s(14), s(1.5));

      g.fillStyle(light);
      g.fillRoundedRect(s(x + 13 + narrow), s(top - 3), s(w - 26 - narrow * 2), s(4), s(2)); // roof edge
    }

    // Lower body with darker bottom shading
    g.fillStyle(dark);
    g.fillRoundedRect(s(x), s(yb - 31), s(w), s(24), s(7));
    g.fillStyle(color);
    g.fillRoundedRect(s(x + 1), s(yb - 30), s(w - 2), s(21), s(6));
    g.fillStyle(0x000000, 0.14);
    g.fillRect(s(x + 2), s(yb - 15), s(w - 4), s(6));
    g.fillStyle(light, 0.5);
    g.fillRect(s(x + 6), s(yb - 29), s(w - 12), s(2));       // boot lid highlight

    // Bumper and exhaust pipe(s)
    g.fillStyle(0x2a2a2a);
    g.fillRoundedRect(s(x + 2), s(yb - 11), s(w - 4), s(6), s(3));
    g.fillStyle(0x9e9e9e);
    g.fillEllipse(s(x + 14), s(yb - 5), s(6), s(3));
    if (isPlayer) g.fillEllipse(s(x + w - 14), s(yb - 5), s(6), s(3));
    g.fillStyle(0x212121);
    g.fillEllipse(s(x + 14), s(yb - 5), s(3), s(1.5));
    if (isPlayer) g.fillEllipse(s(x + w - 14), s(yb - 5), s(3), s(1.5));

    // Tail lights: red lens, bright core, amber indicator
    g.fillStyle(0xb71c1c);
    g.fillRoundedRect(s(x + 3), s(yb - 26), s(13), s(7), s(2));
    g.fillRoundedRect(s(x + w - 16), s(yb - 26), s(13), s(7), s(2));
    g.fillStyle(0xff3b30);
    g.fillRoundedRect(s(x + 4), s(yb - 25), s(9), s(5), s(2));
    g.fillRoundedRect(s(x + w - 13), s(yb - 25), s(9), s(5), s(2));
    g.fillStyle(0xffab91);
    g.fillRect(s(x + 6), s(yb - 24), s(3), s(1.5));
    g.fillRect(s(x + w - 11), s(yb - 24), s(3), s(1.5));
    g.fillStyle(0xffb300);
    g.fillRect(s(x + 13), s(yb - 25), s(3), s(5));
    g.fillRect(s(x + w - 16), s(yb - 25), s(3), s(5));

    // Number plate with "characters"
    g.fillStyle(0xf5f5f5);
    g.fillRoundedRect(s(cx - 10), s(yb - 22), s(20), s(8), s(1.5));
    g.fillStyle(0x333333);
    for (let i = 0; i < 4; i++) g.fillRect(s(cx - 8 + i * 4.3), s(yb - 20), s(2.6), s(4));

    if (isPlayer) {
      // Racing stripes over boot and roof, plus a rear spoiler
      g.fillStyle(0xffffff, 0.9);
      g.fillRect(s(cx - 8), s(yb - 30), s(5), s(8));
      g.fillRect(s(cx + 3), s(yb - 30), s(5), s(8));
      g.fillRect(s(cx - 7), s(yb - 53), s(4), s(4));
      g.fillRect(s(cx + 3), s(yb - 53), s(4), s(4));
      g.fillStyle(0x263238);
      g.fillRect(s(x + 10), s(yb - 34), s(3), s(4));
      g.fillRect(s(x + w - 13), s(yb - 34), s(3), s(4));
      g.fillRoundedRect(s(x + 3), s(yb - 37), s(w - 6), s(4), s(2));
      g.fillStyle(0xffffff, 0.25);
      g.fillRect(s(x + 5), s(yb - 37), s(w - 10), s(1));
    } else if (type === 'taxi') {
      // Roof sign and checker strip
      g.fillStyle(0xffffff);
      g.fillRoundedRect(s(cx - 11), s(yb - 59), s(22), s(8), s(3));
      g.fillStyle(0x222222);
      g.fillRect(s(cx - 7), s(yb - 56), s(14), s(2));
      for (let i = 0; i < 8; i++) {
        g.fillStyle(i % 2 === 0 ? 0x222222 : 0xffffff);
        g.fillRect(s(x + 1 + i * ((w - 2) / 8)), s(yb - 33), s((w - 2) / 8), s(3));
      }
    } else if (type === 'pickup') {
      // Tailgate panel line and handle
      g.fillStyle(dark);
      g.fillRect(s(x + 4), s(yb - 15), s(w - 8), s(1.5));
      g.fillRoundedRect(s(cx - 5), s(yb - 29), s(10), s(3), s(1));
    }
  },

  /** Roadside tree (back view). Ground line at y = 100. */
  drawTree(g) {
    const s = (v) => v * GAME_CONFIG.RENDER_SCALE;
    g.fillStyle(0x000000, 0.2);
    g.fillEllipse(s(32), s(99), s(40), s(8));
    g.fillStyle(0x5d4037);
    g.fillRect(s(28), s(60), s(8), s(40));
    g.fillStyle(0x4e342e);
    g.fillRect(s(28), s(60), s(3), s(40));
    g.fillStyle(0x2f6f2a);
    g.fillCircle(s(32), s(38), s(26));
    g.fillCircle(s(16), s(54), s(16));
    g.fillCircle(s(48), s(54), s(16));
    g.fillStyle(0x3d8436);
    g.fillCircle(s(40), s(46), s(14));
    g.fillStyle(0x4c9a3f);
    g.fillCircle(s(26), s(30), s(12));
    g.fillCircle(s(14), s(50), s(6));
    g.fillStyle(0x66bb6a, 0.6);
    g.fillCircle(s(23), s(26), s(5));
  },

  /** Coconut palm (back view). Ground line at y = 128. */
  drawPalm(g) {
    const s = (v) => v * GAME_CONFIG.RENDER_SCALE;
    const crownX = 44;
    const crownY = 38;

    g.fillStyle(0x000000, 0.2);
    g.fillEllipse(s(34), s(127), s(30), s(6));

    // Gently curving trunk built from segments, with ring marks
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      const y = 128 - t * (128 - crownY);
      const x = 32 + Math.pow(t, 2) * (crownX - 32);
      g.fillStyle(i % 2 === 0 ? 0x8d6e63 : 0x7b5e57);
      g.fillRoundedRect(s(x - 4.5 + t), s(y - 11), s(9 - t * 2), s(12), s(3));
    }

    // Fronds: thin triangles fanning out from the crown
    const leaves = [[4, 58], [10, 34], [30, 14], [58, 12], [74, 32], [72, 58], [24, 62], [58, 64]];
    g.fillStyle(0x2e7d32);
    leaves.forEach(([tx, ty]) => g.fillTriangle(s(crownX - 4), s(crownY), s(crownX + 4), s(crownY), s(tx), s(ty)));
    g.fillStyle(0x43a047);
    leaves.forEach(([tx, ty]) => g.fillTriangle(s(crownX - 1.5), s(crownY - 1), s(crownX + 1.5), s(crownY - 1),
      s((tx + crownX) / 2 + (tx - crownX) * 0.3), s((ty + crownY) / 2 + (ty - crownY) * 0.3)));

    // Coconuts
    g.fillStyle(0x6d4c41);
    g.fillCircle(s(crownX - 4), s(crownY + 4), s(3.5));
    g.fillCircle(s(crownX + 3), s(crownY + 5), s(3.5));
    g.fillCircle(s(crownX), s(crownY + 8), s(3));
  },

  /** Street lamp (back view). Ground line at y = 120. */
  drawLamp(g) {
    const s = (v) => v * GAME_CONFIG.RENDER_SCALE;
    g.fillStyle(0x000000, 0.2);
    g.fillEllipse(s(20), s(119), s(18), s(5));
    g.fillStyle(GAME_CONFIG.COLORS.LAMP_POST);
    g.fillRect(s(16), s(106), s(8), s(14));                   // base
    g.fillRect(s(18), s(12), s(4), s(108));
    g.fillRoundedRect(s(8), s(6), s(24), s(8), s(3));
    g.fillStyle(0x546e7a);
    g.fillRect(s(18), s(12), s(1.5), s(94));                  // highlight edge
    g.fillStyle(0xfff3b0);
    g.fillRect(s(11), s(13), s(18), s(3));
  },

  /** Low bush (back view). Ground line at y = 30. */
  drawBush(g) {
    const s = (v) => v * GAME_CONFIG.RENDER_SCALE;
    g.fillStyle(0x000000, 0.18);
    g.fillEllipse(s(26), s(29), s(46), s(6));
    g.fillStyle(0x2f6f2a);
    g.fillCircle(s(15), s(20), s(12));
    g.fillCircle(s(36), s(20), s(13));
    g.fillCircle(s(26), s(13), s(12));
    g.fillStyle(0x4c9a3f);
    g.fillCircle(s(22), s(11), s(6));
    g.fillStyle(0xef5350);                                     // a few flowers
    g.fillCircle(s(12), s(16), s(2));
    g.fillCircle(s(38), s(13), s(2));
    g.fillCircle(s(30), s(22), s(2));
  },

  /** Roadside billboard on two posts (back view). Ground line at y = 94. */
  drawBillboard(g) {
    const s = (v) => v * GAME_CONFIG.RENDER_SCALE;
    g.fillStyle(0x000000, 0.2);
    g.fillEllipse(s(56), s(93), s(90), s(8));
    g.fillStyle(0x455a64);
    g.fillRect(s(24), s(50), s(6), s(44));
    g.fillRect(s(82), s(50), s(6), s(44));
    g.fillRect(s(24), s(70), s(64), s(3));                    // cross brace

    // Board and frame
    g.fillStyle(0x37474f);
    g.fillRect(s(4), s(6), s(104), s(48));
    g.fillStyle(0x1565c0);
    g.fillRect(s(8), s(10), s(96), s(40));
    g.fillStyle(0x1e88e5);
    g.fillTriangle(s(8), s(50), s(104), s(10), s(104), s(50));

    // Poster artwork: logo circle and "headline" bars
    g.fillStyle(0xffd54f);
    g.fillCircle(s(26), s(30), s(11));
    g.fillStyle(0x1565c0);
    g.fillCircle(s(26), s(30), s(5));
    g.fillStyle(0xffffff);
    g.fillRect(s(44), s(18), s(52), s(7));
    g.fillRect(s(44), s(29), s(38), s(5));
    g.fillStyle(0xffd54f);
    g.fillRect(s(44), s(38), s(28), s(5));

    // Lamps on top of the board
    g.fillStyle(0x263238);
    g.fillRect(s(28), s(1), s(12), s(5));
    g.fillRect(s(72), s(1), s(12), s(5));
  },

  /** Speed-limit sign (back view). Ground line at y = 66. */
  drawSign(g) {
    const s = (v) => v * GAME_CONFIG.RENDER_SCALE;
    g.fillStyle(0x9e9e9e);
    g.fillRect(s(14), s(26), s(4), s(40));
    g.fillStyle(0xd32f2f);
    g.fillCircle(s(16), s(16), s(14));
    g.fillStyle(0xffffff);
    g.fillCircle(s(16), s(16), s(10));
    g.fillStyle(0x212121);                                     // "60"
    g.fillRect(s(9), s(10), s(2), s(12));
    g.fillRect(s(9), s(10), s(5), s(2));
    g.fillRect(s(9), s(15), s(5), s(2));
    g.fillRect(s(9), s(20), s(5), s(2));
    g.fillRect(s(12), s(15), s(2), s(7));
    g.fillRect(s(17), s(10), s(6), s(12));
    g.fillStyle(0xffffff);
    g.fillRect(s(19), s(12), s(2), s(8));
  },

  /** Short roadside marker post with a reflector (back view). Ground at y = 27. */
  drawPost(g) {
    const s = (v) => v * GAME_CONFIG.RENDER_SCALE;
    g.fillStyle(0xf5f5f5);
    g.fillRoundedRect(s(4), s(3), s(8), s(24), s(2));
    g.fillStyle(0x212121);
    g.fillRect(s(4), s(9), s(8), s(4));
    g.fillStyle(0xff9800);
    g.fillRect(s(6), s(5), s(4), s(3));
  },

  /** Soft cartoon cloud. */
  drawCloud(g) {
    const s = (v) => v * GAME_CONFIG.RENDER_SCALE;
    g.fillStyle(0xffffff, 0.9);
    g.fillEllipse(s(70), s(38), s(128), s(22));
    g.fillCircle(s(42), s(30), s(16));
    g.fillCircle(s(72), s(22), s(20));
    g.fillCircle(s(100), s(30), s(14));
    g.fillStyle(0xdcecf5, 0.8);
    g.fillEllipse(s(70), s(44), s(110), s(8));
  },

  // --- Road works (back view). Drawings stay inside their frame, since
  //     neighbouring frames in the atlas sit right next to them. ---

  /** Traffic cone. Ground line at y = 22. */
  drawCone(g) {
    const s = (v) => v * GAME_CONFIG.RENDER_SCALE;
    const band = (y1, y2) => {
      const half = (y) => 1 + (y - 2) / 18 * 6;   // cone widens toward the base
      g.fillPoints([
        { x: s(9 - half(y1)), y: s(y1) }, { x: s(9 + half(y1)), y: s(y1) },
        { x: s(9 + half(y2)), y: s(y2) }, { x: s(9 - half(y2)), y: s(y2) },
      ], true);
    };
    g.fillStyle(0x000000, 0.2);
    g.fillEllipse(s(9), s(22), s(16), s(3));
    g.fillStyle(0x333333);
    g.fillRect(s(2), s(19), s(14), s(3));
    g.fillStyle(0xff6d00);
    g.fillTriangle(s(9), s(2), s(3), s(20), s(15), s(20));
    g.fillStyle(0xffffff);
    band(8, 10.5);
    band(14, 16.5);
  },

  /** Red/white striped road barrier with a warning lamp. Ground at y = 34. */
  drawBarrier(g) {
    const s = (v) => v * GAME_CONFIG.RENDER_SCALE;
    g.fillStyle(0x000000, 0.2);
    g.fillEllipse(s(28), s(34), s(50), s(4));
    g.fillStyle(0x424242);
    g.fillRect(s(9), s(14), s(3), s(20));
    g.fillRect(s(44), s(14), s(3), s(20));
    g.fillRect(s(4), s(32), s(12), s(2));
    g.fillRect(s(40), s(32), s(12), s(2));
    g.fillStyle(0xffffff);
    g.fillRect(s(2), s(9), s(52), s(10));
    g.fillStyle(0xe53935);
    for (let i = 0; i < 5; i++) {
      const x = 2 + i * 11;
      g.fillPoints([
        { x: s(x), y: s(19) }, { x: s(x + 5), y: s(19) },
        { x: s(Math.min(x + 10, 54)), y: s(9) }, { x: s(Math.min(x + 5, 54)), y: s(9) },
      ], true);
    }
    g.fillStyle(0xffb300, 0.35);
    g.fillCircle(s(8), s(5), s(4.5));
    g.fillStyle(0xffb300);
    g.fillCircle(s(8), s(5), s(2.5));
  },

  /** Triangular "road works ahead" warning sign. Ground at y = 72. */
  drawWorkSign(g) {
    const s = (v) => v * GAME_CONFIG.RENDER_SCALE;
    g.fillStyle(0x9e9e9e);
    g.fillRect(s(18), s(34), s(4), s(38));
    g.fillStyle(0xd32f2f);
    g.fillTriangle(s(20), s(2), s(2), s(35), s(38), s(35));
    g.fillStyle(0xffffff);
    g.fillTriangle(s(20), s(9), s(8), s(31), s(32), s(31));
    // Pictogram: a worker shovelling a pile
    g.fillStyle(0x212121);
    g.fillCircle(s(16), s(17), s(2.2));
    g.fillPoints([{ x: s(14), y: s(20) }, { x: s(18), y: s(20) }, { x: s(20), y: s(29) }, { x: s(13), y: s(29) }], true);
    g.fillPoints([{ x: s(18), y: s(21) }, { x: s(24), y: s(26) }, { x: s(23), y: s(27) }, { x: s(17), y: s(23) }], true);
    g.fillTriangle(s(21), s(30), s(30), s(30), s(26), s(25));
  },

  /** Road worker in a hi-vis vest and hard hat, holding a flag. Ground at y = 46. */
  drawWorker(g) {
    const s = (v) => v * GAME_CONFIG.RENDER_SCALE;
    g.fillStyle(0x000000, 0.2);
    g.fillEllipse(s(14), s(46), s(18), s(4));
    g.fillStyle(0x283593);                        // trousers
    g.fillRect(s(9), s(31), s(4), s(15));
    g.fillRect(s(15), s(31), s(4), s(15));
    g.fillStyle(0xff6d00);                        // vest and arms
    g.fillRoundedRect(s(7), s(17), s(14), s(16), s(3));
    g.fillRect(s(3), s(18), s(4), s(12));
    g.fillRect(s(21), s(11), s(4), s(10));        // raised arm
    g.fillStyle(0xfff59d);                        // reflective stripes
    g.fillRect(s(7), s(22), s(14), s(2));
    g.fillRect(s(7), s(27), s(14), s(2));
    g.fillStyle(0xc68a63);                        // head
    g.fillCircle(s(14), s(12), s(4));
    g.fillStyle(0xfdd835);                        // hard hat
    g.fillEllipse(s(14), s(9), s(12), s(4));
    g.fillRect(s(10), s(5), s(8), s(4));
    g.fillStyle(0x757575);                        // flag
    g.fillRect(s(24), s(2), s(1.5), s(12));
    g.fillStyle(0xe53935);
    g.fillRect(s(25.5), s(2), s(6), s(5));
  },

  /**
   * Digger (JCB) animation: one atlas frame per pose, played in a loop by
   * BackView. Pre-drawn frames cost nothing per frame on the phone.
   * Each pose: [boom angle, stick angle, bucket turn, load] in degrees,
   * load 0 = empty, 1 = full of soil, 2 = pouring, 3 = last bits.
   * Every pose was checked to stay inside the 124 x 88 frame.
   */
  DIGGER_POSES: [
    [-55, -10, -20, 0],   // arm up, empty
    [-45, 15, 0, 0],      // lowering
    [-30, 45, 20, 0],
    [-15, 75, 40, 0],     // bucket bites into the heap
    [-15, 70, -30, 1],    // scooped
    [-28, 50, -45, 1],    // lifting
    [-42, 25, -50, 1],
    [-55, 0, -45, 1],     // raised, full
    [-55, -10, 50, 2],    // tipping: soil pours out
    [-55, -10, 70, 3],    // last bits fall
  ],
  // How long each pose shows (ms); the loop is about 2.2 seconds
  DIGGER_FRAME_MS: [300, 170, 170, 320, 240, 170, 170, 220, 280, 200],

  /** Yellow excavator digging a soil heap. Ground at y = 84. */
  drawDigger(g, poseIndex) {
    const s = (v) => v * GAME_CONFIG.RENDER_SCALE;
    const P = (x, y) => ({ x: s(x), y: s(y) });
    const deg = Math.PI / 180;
    const [boomAngle, stickAngle, bucketTurn, load] = Textures.DIGGER_POSES[poseIndex];
    const soil = 0x8d6e3f;

    g.fillStyle(0x000000, 0.22);
    g.fillEllipse(s(46), s(83), s(84), s(6));

    // Soil heap being dug, in front of the digger
    g.fillStyle(soil);
    g.fillPoints([P(78, 84), P(87, 77), P(98, 73), P(108, 76), P(117, 84)], true);
    g.fillStyle(0xa8865a);
    g.fillPoints([P(88, 78), P(98, 75), P(104, 77), P(96, 79)], true);

    // Tracks
    g.fillStyle(0x303030);
    g.fillRoundedRect(s(8), s(68), s(66), s(15), s(7));
    g.fillStyle(0x616161);
    [16, 30, 44, 58, 67].forEach((x) => g.fillCircle(s(x), s(75.5), s(4)));
    // Body, cab and exhaust
    g.fillStyle(0xf9a825);
    g.fillRect(s(12), s(48), s(56), s(20));
    g.fillStyle(0xfbc02d);
    g.fillRect(s(30), s(26), s(26), s(24));
    g.fillStyle(0x263238);
    g.fillRect(s(34), s(30), s(18), s(13));
    g.fillStyle(0xffffff, 0.2);
    g.fillTriangle(s(35), s(42), s(42), s(31), s(46), s(31));
    g.fillStyle(0x424242);
    g.fillRect(s(16), s(38), s(3), s(10));
    g.fillStyle(0xf57f17);
    g.fillRect(s(12), s(62), s(56), s(3));        // stripe

    // Arm joints for this pose
    const pivot = [56, 50];
    const elbow = [pivot[0] + 36 * Math.cos(boomAngle * deg), pivot[1] + 36 * Math.sin(boomAngle * deg)];
    const tip = [elbow[0] + 30 * Math.cos(stickAngle * deg), elbow[1] + 30 * Math.sin(stickAngle * deg)];

    // A thick straight segment between two points
    const beam = (a, b, width, color) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const nx = -(b[1] - a[1]) / len * width / 2;
      const ny = (b[0] - a[0]) / len * width / 2;
      g.fillStyle(color);
      g.fillPoints([P(a[0] + nx, a[1] + ny), P(b[0] + nx, b[1] + ny), P(b[0] - nx, b[1] - ny), P(a[0] - nx, a[1] - ny)], true);
    };
    beam([46, 58], [(pivot[0] + elbow[0]) / 2, (pivot[1] + elbow[1]) / 2], 2.5, 0x757575); // hydraulic ram
    beam(pivot, elbow, 7, 0xf9a825);                                                     // boom
    beam(elbow, tip, 5, 0xf2a01f);                                                       // stick
    g.fillStyle(0x616161);
    g.fillCircle(s(elbow[0]), s(elbow[1]), s(3));
    g.fillCircle(s(pivot[0]), s(pivot[1]), s(3));

    // Bucket, turned relative to the stick
    const a = (stickAngle + bucketTurn) * deg;
    const local = (u, v) => P(tip[0] + u * Math.cos(a) - v * Math.sin(a), tip[1] + u * Math.sin(a) + v * Math.cos(a));
    g.fillStyle(0x424242);
    g.fillPoints([local(-3, -6), local(7, -6), local(11, 2), local(3, 8), local(-3, 4)], true);

    if (load === 1) {
      // Heaped soil in the bucket
      g.fillStyle(soil);
      g.fillCircle(s(tip[0] + 2), s(tip[1] - 6), s(4));
      g.fillCircle(s(tip[0] + 7), s(tip[1] - 5), s(3));
    } else if (load >= 2) {
      // Soil pouring out in clumps
      g.fillStyle(soil);
      const clumps = load === 2
        ? [[3, 8, 3], [5, 14, 2.5], [2, 19, 2.5], [6, 23, 2]]
        : [[4, 18, 2], [2, 23, 1.5]];
      clumps.forEach(([dx, dy, r]) => g.fillCircle(s(tip[0] + dx), s(tip[1] + dy), s(r)));
    }
  },

  /** Heap of sand or gravel. Ground at y = 24. */
  drawSandPile(g) {
    const s = (v) => v * GAME_CONFIG.RENDER_SCALE;
    const P = (x, y) => ({ x: s(x), y: s(y) });
    g.fillStyle(0xb08850);
    g.fillPoints([P(2, 24), P(12, 15), P(24, 8), P(36, 7), P(48, 12), P(62, 24)], true);
    g.fillStyle(0xd4b07a);
    g.fillPoints([P(14, 16), P(24, 10), P(34, 9), P(30, 14), P(18, 19)], true);
    g.fillStyle(0x8d6e3f);
    g.fillRect(s(2), s(22), s(60), s(2));
  },

  /** Small bird, wings up (V) or down, for a two-frame flap. */
  drawBird(g, wingsUp) {
    const s = (v) => v * GAME_CONFIG.RENDER_SCALE;
    g.fillStyle(0x263238);
    if (wingsUp) {
      g.fillTriangle(s(9), s(7), s(1), s(1), s(6), s(8));
      g.fillTriangle(s(9), s(7), s(17), s(1), s(12), s(8));
    } else {
      g.fillTriangle(s(9), s(6), s(1), s(11), s(6), s(5));
      g.fillTriangle(s(9), s(6), s(17), s(11), s(12), s(5));
    }
    g.fillEllipse(s(9), s(7), s(7), s(3.5));
  },

  /**
   * Stable pseudo-random number (0 .. 2^32-1) for an integer, used to pick
   * scenery for a numbered stretch of road. Well mixed, so neighbouring
   * numbers get unrelated results (a plain multiply gives long runs).
   */
  hash(n) {
    let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  },

  /** Darker (outline/roof) and lighter (highlight) versions of a colour. */
  shades(color) {
    const Color = Phaser.Display.Color;
    return {
      dark: Color.ValueToColor(color).darken(25).color,
      light: Color.ValueToColor(color).lighten(18).color,
    };
  },
};
