/*
 * The only file the GAME uses to talk to Firebase. Loaded on demand by
 * js/online/scores.js (never blocks the game from starting).
 *
 * - Signs the player in anonymously (invisible, no password). The
 *   account id identifies their leaderboard entry and can't be forged.
 * - Uses Firestore "lite": a much smaller download than full Firestore.
 * See firestore.rules for how scores are checked on the server.
 */
export async function createScoreApi(config, sdkVersion) {
  const base = `https://www.gstatic.com/firebasejs/${sdkVersion}`;
  const { initializeApp, getApps, getApp } = await import(`${base}/firebase-app.js`);
  const { getAuth, signInAnonymously } = await import(`${base}/firebase-auth.js`);
  const {
    getFirestore, doc, getDoc, setDoc, collection, query, where, writeBatch, getCount, serverTimestamp,
  } = await import(`${base}/firebase-firestore-lite.js`);

  // Reuse the app if an earlier connection attempt (e.g. timed out) created it
  const app = getApps().length > 0 ? getApp() : initializeApp(config);
  const auth = getAuth(app);
  await auth.authStateReady();               // reuse this phone's existing account if any
  const user = auth.currentUser || (await signInAnonymously(auth)).user;
  const uid = user.uid;

  const db = getFirestore(app);
  const board = collection(db, 'leaderboard');

  return {
    uid,

    /** This player's all-time best from the database (0 if none yet). */
    async getBest() {
      const snap = await getDoc(doc(board, uid));
      return snap.exists() ? snap.data().score : 0;
    },

    /** Open a run: the server records when it started. */
    openRun(runId) {
      return setDoc(doc(db, 'runs', runId), { uid, startedAt: serverTimestamp(), used: false });
    },

    /**
     * Submit a run's score in one all-or-nothing batch: close the run,
     * add the history record, and raise this player's leaderboard best.
     * The server refuses it if the score isn't possible in the real time
     * the run lasted, the run was already used, or it isn't a new best.
     */
    submit(entry) {
      const data = {
        name: entry.name,
        score: entry.score,
        duration: entry.duration,
        uid,
        run: entry.runId,
        timestamp: serverTimestamp(),
      };
      const batch = writeBatch(db);
      batch.update(doc(db, 'runs', entry.runId), { used: true });
      batch.set(doc(db, 'scores', entry.runId), data);
      batch.set(doc(board, uid), data);
      return batch.commit();
    },

    /** Leaderboard position: 1 + players with a higher best. */
    async rankOf(score) {
      const [higher, total] = await Promise.all([
        getCount(query(board, where('score', '>', score))),
        getCount(board),
      ]);
      return { rank: higher.data().count + 1, total: total.data().count };
    },
  };
}
