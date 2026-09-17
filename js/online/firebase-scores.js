/*
 * The only file that talks to Firebase. Loaded on demand by
 * js/online/scores.js (never blocks the game from starting).
 *
 * Uses Firestore "lite": a much smaller download than full Firestore,
 * and all the game page needs is to write a score document.
 */
export async function createScoreApi(config, sdkVersion) {
  const base = `https://www.gstatic.com/firebasejs/${sdkVersion}`;
  const { initializeApp } = await import(`${base}/firebase-app.js`);
  const { getFirestore, doc, setDoc, serverTimestamp } = await import(`${base}/firebase-firestore-lite.js`);

  const app = initializeApp(config);
  const db = getFirestore(app);

  return {
    /**
     * Save one run. Uses the entry's own id as the document id, so a
     * retry after a lost reply can't create a duplicate (the rules
     * refuse to overwrite an existing score).
     */
    submit(entry) {
      return setDoc(doc(db, 'scores', entry.id), {
        name: entry.name,
        score: entry.score,
        duration: entry.duration,
        device: entry.device,
        timestamp: serverTimestamp(),
      });
    },
  };
}
