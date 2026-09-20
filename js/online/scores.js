/*
 * Online scores, built for weak campus wifi and basic anti-cheat.
 *
 * - Nothing score-related is stored on the phone: the player's best is
 *   read from the database, and unsent scores wait in memory only.
 * - Each game "opens a run" on the server when it starts; the score is
 *   submitted against that run when the game ends, and the server checks
 *   it against the real time that passed (see firestore.rules).
 * - Uploads happen in the background and retry on weak wifi, so restart
 *   is never blocked. Firebase loads only after the game has started.
 *
 * Events on window:
 *   'score-status' detail = { id, status, rank?, total? }
 *       status: 'saving' | 'saved' | 'ranked' | 'offline' | 'rejected'
 *   'best-loaded'  detail = { best }   (player's best from the database)
 *   'rivals-loaded' detail = { rivals, position }  (the ladder above you)
 */
const OnlineScores = {
  api: null,          // Firebase connection once ready
  connecting: null,   // promise while connecting
  best: null,         // all-time best from the database (null = not known yet)
  rivals: [],         // players just above this one, lowest first
  rank: null,         // this player's position: { rank, total }
  runs: {},           // runId -> promise that resolves once the run is open on the server
  pending: [],        // finished runs waiting to upload (memory only)
  flushing: false,

  init() {
    const C = GAME_CONFIG;
    // Scores used to be kept on the phone; clear any old copies
    ['iedcRush.best', 'iedcRush.pendingScores', 'iedcRush.device'].forEach((key) => {
      try { localStorage.removeItem(key); } catch (e) { /* storage blocked */ }
    });
    if (!OnlineScores.isConfigured()) return;

    window.addEventListener('online', () => {
      OnlineScores.loadBest();
      OnlineScores.flush();
    });
    setInterval(() => OnlineScores.flush(), C.ONLINE.RETRY_MS);
    // Connect in the background shortly after the game starts
    setTimeout(() => OnlineScores.loadBest(), 1500);
  },

  isConfigured() {
    const config = window.FIREBASE_CONFIG;
    return GAME_CONFIG.ONLINE.ENABLED && !!config && !!config.projectId && config.projectId !== 'YOUR_PROJECT';
  },

  /**
   * Fetch the player's leaderboard entry. Its best score is the one that
   * counts, and its name replaces the phone's copy (names are permanent).
   */
  async loadBest() {
    const api = await OnlineScores.connect();
    if (!api) return;
    try {
      const entry = await OnlineScores.withTimeout(api.getEntry(), GAME_CONFIG.ONLINE.TIMEOUT_MS);
      if (entry.name && entry.name !== PlayerName.get()) PlayerName.save(entry.name);
      OnlineScores.best = Math.max(entry.score, OnlineScores.best || 0);
      window.dispatchEvent(new CustomEvent('best-loaded', { detail: { best: OnlineScores.best } }));
      OnlineScores.loadRivals();
    } catch (error) {
      // Offline: try again when the connection returns
    }
  },

  /**
   * The players immediately above this one, plus this player's own
   * position. The game turns them into targets to chase, so a run is
   * never just about a number. Failure is silent: no rivals, no marker.
   */
  async loadRivals() {
    const C = GAME_CONFIG;
    const api = await OnlineScores.connect();
    if (!api) return;
    const best = OnlineScores.best || 0;
    try {
      const [rivals, position] = await Promise.all([
        OnlineScores.withTimeout(api.rivalsAbove(best, C.RIVALS.COUNT), C.ONLINE.TIMEOUT_MS),
        OnlineScores.withTimeout(api.rankOf(best), C.ONLINE.TIMEOUT_MS),
      ]);
      OnlineScores.rivals = rivals;
      OnlineScores.rank = position;
      window.dispatchEvent(new CustomEvent('rivals-loaded', { detail: { rivals, position } }));
    } catch (error) {
      // Offline: this run simply has no target marker
    }
  },

  /**
   * Called when a game starts. Opens a run on the server in the
   * background and returns its id (or null when online scores are off).
   */
  startRun() {
    if (!OnlineScores.isConfigured()) return null;
    const runId = OnlineScores.makeId();
    OnlineScores.runs[runId] = OnlineScores.openRunWithRetry(runId);
    return runId;
  },

  /** Keep trying to open the run for a while; resolves true once it exists. */
  async openRunWithRetry(runId) {
    const C = GAME_CONFIG;
    for (let attempt = 0; attempt < C.ONLINE.OPEN_RUN_ATTEMPTS; attempt++) {
      const api = await OnlineScores.connect();
      if (api) {
        try {
          await OnlineScores.withTimeout(api.openRun(runId), C.ONLINE.TIMEOUT_MS);
          return true;
        } catch (error) {
          // A refused retry usually means an earlier attempt already
          // created the run but its reply was lost
          if (error && error.code === 'permission-denied') return true;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    return false;
  },

  /**
   * Called on game over. Queues the run for upload if it beats the
   * player's best. Returns the queued entry, or null if not uploaded.
   */
  finishRun({ runId, score, durationMs }) {
    const C = GAME_CONFIG;
    const name = PlayerName.get();
    if (!runId || !name || !OnlineScores.runs[runId]) return null;
    if (score < C.ONLINE.MIN_SCORE) return OnlineScores.dropRun(runId);
    // Only a new all-time best can raise the leaderboard entry
    if (OnlineScores.best !== null && score <= OnlineScores.best) return OnlineScores.dropRun(runId);

    const entry = {
      id: runId,
      runId,
      name,
      score: Math.floor(score),
      duration: Math.max(1, Math.round(durationMs / 1000)),
    };
    OnlineScores.pending.push(entry);
    OnlineScores.report(entry.id, 'saving');
    OnlineScores.flush();
    return entry;
  },

  dropRun(runId) {
    delete OnlineScores.runs[runId];
    return null;
  },

  /** Upload waiting scores, oldest first. */
  async flush() {
    const C = GAME_CONFIG;
    if (OnlineScores.flushing || OnlineScores.pending.length === 0) return;
    OnlineScores.flushing = true;
    try {
      const api = await OnlineScores.connect();
      if (!api) {
        OnlineScores.pending.forEach((e) => OnlineScores.report(e.id, 'offline'));
        return;
      }
      for (const entry of OnlineScores.pending.slice()) {
        // The run must exist on the server before its score can count
        const opened = await OnlineScores.runs[entry.runId];
        if (!opened) {
          OnlineScores.finish(entry, 'rejected');
          continue;
        }
        // Another run may already have set a higher best
        if (OnlineScores.best !== null && entry.score <= OnlineScores.best) {
          OnlineScores.finish(entry, null);
          continue;
        }
        try {
          await OnlineScores.withTimeout(api.submit(entry), C.ONLINE.TIMEOUT_MS);
          OnlineScores.best = Math.max(entry.score, OnlineScores.best || 0);
          OnlineScores.finish(entry, 'saved');
          OnlineScores.loadRivals();      // the ladder above you just got shorter
          OnlineScores.rankOf(entry.score).then((position) => {
            if (position) OnlineScores.report(entry.id, 'ranked', position);
          });
        } catch (error) {
          if (error && error.code === 'permission-denied') {
            // The server refused it: not possible in the time played,
            // already submitted, or not a new best. Don't retry.
            OnlineScores.finish(entry, 'rejected');
            OnlineScores.loadBest();
          } else {
            // Network trouble: keep it and retry later
            OnlineScores.pending.forEach((e) => OnlineScores.report(e.id, 'offline'));
            break;
          }
        }
      }
    } finally {
      OnlineScores.flushing = false;
    }
  },

  /** Remove an entry from the queue and report its outcome. */
  finish(entry, status) {
    OnlineScores.pending = OnlineScores.pending.filter((e) => e.id !== entry.id);
    delete OnlineScores.runs[entry.runId];
    if (status) OnlineScores.report(entry.id, status);
  },

  /** Leaderboard position for a score: { rank, total }, or null. Never throws. */
  async rankOf(score) {
    if (!OnlineScores.isConfigured() || !score || score < GAME_CONFIG.ONLINE.MIN_SCORE) return null;
    try {
      const api = await OnlineScores.connect();
      if (!api) return null;
      return await OnlineScores.withTimeout(api.rankOf(score), GAME_CONFIG.ONLINE.TIMEOUT_MS);
    } catch (error) {
      return null;
    }
  },

  /** Load Firebase and sign in on first use. Returns null if it can't (offline). */
  async connect() {
    if (OnlineScores.api) return OnlineScores.api;
    if (!OnlineScores.connecting) {
      const moduleUrl = new URL('js/online/firebase-scores.js', document.baseURI).href;
      OnlineScores.connecting = import(moduleUrl)
        .then((m) => OnlineScores.withTimeout(
          m.createScoreApi(window.FIREBASE_CONFIG, GAME_CONFIG.ONLINE.FIREBASE_SDK_VERSION),
          GAME_CONFIG.ONLINE.TIMEOUT_MS))
        .then((api) => (OnlineScores.api = api))
        .catch((error) => {
          const hint = error && error.code === 'auth/operation-not-allowed'
            ? ' (enable Anonymous sign-in in Firebase console → Authentication)' : '';
          console.warn('Online scores unavailable for now:', (error && (error.code || error.message)) + hint);
          return null;
        })
        .finally(() => { OnlineScores.connecting = null; });
    }
    return OnlineScores.connecting;
  },

  withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), ms);
      promise.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error) => { clearTimeout(timer); reject(error); },
      );
    });
  },

  report(id, status, extra) {
    window.dispatchEvent(new CustomEvent('score-status', { detail: Object.assign({ id, status }, extra) }));
  },

  /** 20 random letters/digits (used as run / document ids). */
  makeId() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const bytes = new Uint8Array(20);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => chars[b % chars.length]).join('');
  },
};
