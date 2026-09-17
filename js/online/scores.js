/*
 * Online score uploads, built for weak campus wifi.
 *
 * - On game over, the run is added to a queue saved on the phone
 *   (localStorage), then uploaded in the background. Restart is never
 *   blocked or slowed.
 * - Failed uploads stay queued and are retried every RETRY_MS, when the
 *   phone comes back online, and on the next visit.
 * - Firebase itself loads only when the first upload is needed, so the
 *   game starts just as fast, and still works fully without internet.
 *
 * Progress is reported with a window 'score-status' event:
 *   detail = { id, status: 'saving' | 'saved' | 'offline' }
 */
const OnlineScores = {
  pending: [],
  api: null,          // Firebase connection, once loaded
  connecting: null,   // promise while Firebase is loading
  flushing: false,

  init() {
    const C = GAME_CONFIG;
    OnlineScores.pending = OnlineScores.loadQueue();
    if (!OnlineScores.isConfigured()) return;
    window.addEventListener('online', () => OnlineScores.flush());
    setInterval(() => OnlineScores.flush(), C.ONLINE.RETRY_MS);
    // Upload anything left over from a previous visit, once the game is up
    setTimeout(() => OnlineScores.flush(), 3000);
  },

  isConfigured() {
    const config = window.FIREBASE_CONFIG;
    return GAME_CONFIG.ONLINE.ENABLED && !!config && !!config.projectId && config.projectId !== 'YOUR_PROJECT';
  },

  /**
   * Record a finished run. Returns the queued entry, or null if this run
   * isn't uploaded (not a new best, too small, no name, or offline mode).
   */
  submitRun({ score, durationMs, isNewBest }) {
    const C = GAME_CONFIG;
    const name = PlayerName.get();
    if (!OnlineScores.isConfigured() || !name) return null;
    if (score < C.ONLINE.MIN_SCORE) return null;
    if (C.ONLINE.SUBMIT_BEST_ONLY && !isNewBest) return null;

    const entry = {
      id: OnlineScores.makeId(),
      name,
      score: Math.floor(score),
      duration: Math.max(1, Math.round(durationMs / 1000)),
      device: OnlineScores.deviceId(),
      rejections: 0,
    };
    OnlineScores.pending.push(entry);
    OnlineScores.saveQueue();
    OnlineScores.report(entry.id, 'saving');
    OnlineScores.flush();
    return entry;
  },

  /** Try to upload everything in the queue, oldest first. */
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
        try {
          await OnlineScores.withTimeout(api.submit(entry), C.ONLINE.TIMEOUT_MS);
          OnlineScores.remove(entry);
          OnlineScores.report(entry.id, 'saved');
        } catch (error) {
          if (error && error.code === 'permission-denied') {
            // Refused by the security rules: already saved by an earlier
            // attempt, or invalid. Give it a few tries (rules might be
            // being updated), then drop it.
            entry.rejections = (entry.rejections || 0) + 1;
            if (entry.rejections >= C.ONLINE.MAX_REJECTIONS) OnlineScores.remove(entry);
            else OnlineScores.saveQueue();
            OnlineScores.report(entry.id, 'offline');
          } else {
            // Network trouble: stop for now, retry later
            OnlineScores.pending.forEach((e) => OnlineScores.report(e.id, 'offline'));
            break;
          }
        }
      }
    } finally {
      OnlineScores.flushing = false;
    }
  },

  /** Load Firebase on first use. Returns null if it can't load (offline). */
  async connect() {
    if (OnlineScores.api) return OnlineScores.api;
    if (!OnlineScores.connecting) {
      const moduleUrl = new URL('js/online/firebase-scores.js', document.baseURI).href;
      OnlineScores.connecting = import(moduleUrl)
        .then((m) => m.createScoreApi(window.FIREBASE_CONFIG, GAME_CONFIG.ONLINE.FIREBASE_SDK_VERSION))
        .then((api) => (OnlineScores.api = api))
        .catch((error) => {
          console.warn('Online scores unavailable for now:', error && error.message);
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

  remove(entry) {
    OnlineScores.pending = OnlineScores.pending.filter((e) => e.id !== entry.id);
    OnlineScores.saveQueue();
  },

  report(id, status) {
    window.dispatchEvent(new CustomEvent('score-status', { detail: { id, status } }));
  },

  loadQueue() {
    try {
      const list = JSON.parse(localStorage.getItem(GAME_CONFIG.PENDING_SCORES_KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  },

  saveQueue() {
    try {
      localStorage.setItem(GAME_CONFIG.PENDING_SCORES_KEY, JSON.stringify(OnlineScores.pending));
    } catch (e) {
      // Storage blocked: the queue still lives in memory for this visit
    }
  },

  /** Random id for this phone, kept across visits. */
  deviceId() {
    const C = GAME_CONFIG;
    try {
      let id = localStorage.getItem(C.DEVICE_KEY);
      if (!id) {
        id = OnlineScores.makeId();
        localStorage.setItem(C.DEVICE_KEY, id);
      }
      return id;
    } catch (e) {
      if (!OnlineScores.memoryDeviceId) OnlineScores.memoryDeviceId = OnlineScores.makeId();
      return OnlineScores.memoryDeviceId;
    }
  },

  /** 20 random letters/digits (also used as Firestore document ids). */
  makeId() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const bytes = new Uint8Array(20);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => chars[b % chars.length]).join('');
  },
};
