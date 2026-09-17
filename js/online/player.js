/*
 * Player name: asked once, before the very first run, then remembered
 * on the phone. Restarts never ask again.
 *
 * The name form is plain HTML (in index.html) rather than drawn in
 * Phaser, so phones show their normal keyboard.
 */
const PlayerName = {
  /** The saved name, or '' if none yet. */
  get() {
    try {
      return localStorage.getItem(GAME_CONFIG.NAME_KEY) || '';
    } catch (e) {
      return PlayerName.memoryName || '';
    }
  },

  save(name) {
    PlayerName.memoryName = name; // fallback if storage is blocked (private mode)
    try {
      localStorage.setItem(GAME_CONFIG.NAME_KEY, name);
    } catch (e) {
      // Name lasts for this visit only
    }
  },

  /**
   * Check a typed name. Returns { ok: true, name } with the tidied name,
   * or { ok: false, error } with a message to show the player.
   */
  validate(raw) {
    const C = GAME_CONFIG;
    const name = String(raw || '').replace(/\s+/g, ' ').trim();

    if (name.length < C.NAME_MIN_LENGTH) {
      return { ok: false, error: `Name must be at least ${C.NAME_MIN_LENGTH} characters.` };
    }
    if (name.length > C.NAME_MAX_LENGTH) {
      return { ok: false, error: `Name can be at most ${C.NAME_MAX_LENGTH} characters.` };
    }
    // Same character whitelist as firestore.rules
    if (!/^[A-Za-z0-9 ._-]+$/.test(name)) {
      return { ok: false, error: 'Only English letters, numbers, spaces and . _ -' };
    }
    if (!/[A-Za-z]/.test(name)) {
      return { ok: false, error: 'Name must include at least one letter.' };
    }
    if (PlayerName.isOffensive(name)) {
      return { ok: false, error: 'Please choose a different name.' };
    }
    return { ok: true, name };
  },

  /**
   * Basic profanity filter. Short words must match a whole word, so
   * ordinary names that merely contain them (Hassan, Ashith) are fine;
   * longer words are caught anywhere, even with l33t spelling or spacing.
   * This is deliberately simple — organisers still review the top scores.
   */
  BLOCKED_WORDS: [
    'ass', 'arse', 'boob', 'boobs', 'cock', 'cum', 'dick', 'fag', 'fck', 'fuk', 'porn', 'sex',
    'shit', 'slut', 'tit', 'tits', 'whore', 'nazi', 'rape', 'penis', 'vagina',
    'myr', 'myre', 'mayir', 'kunna', 'pooru', 'poori', 'chut', 'lund', 'gandu', 'bsdk',
  ],
  BLOCKED_ANYWHERE: [
    'fuck', 'bitch', 'bastard', 'asshole', 'motherf', 'thayoli', 'pundachi', 'poorimon',
    'poorimol', 'myran', 'myrr', 'madarchod', 'bhenchod', 'chutiya',
  ],

  isOffensive(name) {
    const unleet = (s) => s.toLowerCase()
      .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a')
      .replace(/5/g, 's').replace(/7/g, 't').replace(/8/g, 'b');
    const words = unleet(name).split(/[^a-z]+/).filter(Boolean);
    if (words.some((w) => PlayerName.BLOCKED_WORDS.includes(w))) return true;
    const squashed = words.join('');
    return PlayerName.BLOCKED_ANYWHERE.some((w) => squashed.includes(w));
  },

  /**
   * Show the name form (index.html #name-entry) and call onDone(name)
   * once a valid name is entered.
   */
  ask(onDone) {
    const overlay = document.getElementById('name-entry');
    const form = document.getElementById('name-form');
    const input = document.getElementById('name-input');
    const error = document.getElementById('name-error');
    input.maxLength = GAME_CONFIG.NAME_MAX_LENGTH;
    overlay.hidden = false;
    // Desktop: ready to type. (Phones only open the keyboard on a tap.)
    if (!('ontouchstart' in window)) input.focus();
    input.addEventListener('input', () => { error.textContent = ''; });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const result = PlayerName.validate(input.value);
      if (!result.ok) {
        error.textContent = result.error;
        return;
      }
      PlayerName.save(result.name);
      input.blur();              // close the phone keyboard
      overlay.hidden = true;
      onDone(result.name);
    });
  },
};
