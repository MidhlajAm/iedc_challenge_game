/*
 * Leaderboard page: every player's ALL-TIME best score, ranked. It is
 * not just who is playing now: entries stay, and rise when a player
 * beats their best. New scores appear without reloading.
 *
 * - Top 3 on a podium, every player in the standings list (podium
 *   included), plus a name search.
 * - The viewer's own row is highlighted, shows the points needed to pass
 *   the next player up, and is pinned in the bottom dock whenever it is
 *   scrolled out of view ("Show me" scrolls back to it).
 * - Players who climb flash and show how many places they gained.
 * - Organiser view: add ?organiser to the URL for run length, points per
 *   second (outliers flagged for review) and last update time.
 *
 * Uses full Firestore (live updates). Only changed entries are re-sent
 * after the first load, which keeps reads low on the free plan.
 */
const C = GAME_CONFIG; // from js/config.js (a global `const`, so not on window)
const organiser = new URLSearchParams(window.location.search).has('organiser');
const CLIMB_BADGE_MS = 6000;

const el = {
  count: document.getElementById('count'),
  podium: document.getElementById('podium'),
  search: document.getElementById('search'),
  list: document.getElementById('list'),
  state: document.getElementById('state'),
  me: document.getElementById('me'),
  hero: document.getElementById('hero'),
};

let players = [];            // sorted, with .rank
let myUid = null;            // this viewer's player id, if they've played on this phone
let firstLoad = true;
const lastRank = new Map();  // uid -> previous rank (to spot climbs)
const climbs = new Map();    // uid -> { places, until }
let mineObserver = null;
const mineVisible = new Set(); // which of "your" elements (hero plate, list row) are on screen

el.search.addEventListener('input', render);
el.me.addEventListener('click', scrollToMe);
start();

async function start() {
  const config = window.FIREBASE_CONFIG;
  if (!config || !config.projectId) {
    showState('The leaderboard isn\'t connected yet.');
    return;
  }
  showState('Loading the board...');

  try {
    const base = `https://www.gstatic.com/firebasejs/${C.ONLINE.FIREBASE_SDK_VERSION}`;
    const { initializeApp } = await import(`${base}/firebase-app.js`);
    const { getAuth } = await import(`${base}/firebase-auth.js`);
    const { getFirestore, collection, query, orderBy, limit, onSnapshot } = await import(`${base}/firebase-firestore.js`);

    const app = initializeApp(config);
    const db = getFirestore(app);

    // Recognise the viewer if the game already signed them in (never signs in here)
    const auth = getAuth(app);
    auth.authStateReady().then(() => {
      myUid = auth.currentUser ? auth.currentUser.uid : null;
      render();
    });

    const board = query(collection(db, 'leaderboard'), orderBy('score', 'desc'), limit(C.LEADERBOARD.MAX_PLAYERS));
    onSnapshot(board, (snapshot) => {
      players = rankPlayers(snapshot.docs.map((d) => Object.assign({ id: d.id }, d.data())));
      trackClimbs();
      render();
      firstLoad = false;
    }, (error) => {
      console.warn('Leaderboard error:', error);
      if (players.length === 0) showState('Can\'t reach the leaderboard. Check your connection and reload.');
    });
  } catch (error) {
    console.warn('Leaderboard unavailable:', error);
    showState('Can\'t reach the leaderboard. Check your connection and reload.');
  }
}

/** Sort by score and give equal scores the same rank (1, 2, 2, 4). */
function rankPlayers(list) {
  list.sort((a, b) => b.score - a.score);
  list.forEach((p, i) => {
    p.rank = i > 0 && p.score === list[i - 1].score ? list[i - 1].rank : i + 1;
  });
  return list;
}

/** Remember who moved up since the last update (not on first load). */
function trackClimbs() {
  const now = Date.now();
  players.forEach((p) => {
    const before = lastRank.get(p.uid);
    if (!firstLoad && before !== undefined && p.rank < before) {
      climbs.set(p.uid, { places: before - p.rank, until: now + CLIMB_BADGE_MS, fresh: true });
    } else if (!firstLoad && before === undefined) {
      climbs.set(p.uid, { places: 0, until: now + CLIMB_BADGE_MS, fresh: true }); // new on the board
    }
    lastRank.set(p.uid, p.rank);
  });
  // Clear badges once they expire
  setTimeout(render, CLIMB_BADGE_MS + 50);
}

function render() {
  const total = players.length;
  el.count.textContent = total === 0
    ? 'All-time best scores'
    : `All-time best scores of ${total} ${total === 1 ? 'player' : 'players'}`;

  if (total === 0) {
    renderHero(null);
    el.podium.hidden = true;
    el.search.hidden = true;
    el.list.innerHTML = '';
    el.me.hidden = true;
    if (el.state.textContent === '' || !firstLoad) showState('No scores yet. Play a run and take first place.');
    return;
  }
  showState('');

  const me = myUid ? players.find((p) => p.uid === myUid) : null;
  renderHero(me);
  renderPodium(me);

  el.search.hidden = false;
  const term = el.search.value.trim().toLowerCase();
  const shown = term ? players.filter((p) => p.name.toLowerCase().includes(term)) : players;
  if (shown.length === 0) showState(`No player named "${term}".`);

  if (organiser) renderOrganiserTable(shown);
  else renderRows(shown);

  renderDock(me);
}

function renderPodium(me) {
  const top = players.slice(0, C.LEADERBOARD.PODIUM);
  const order = ['second', 'first', 'third'];
  const byPlace = { first: top[0], second: top[1], third: top[2] };
  el.podium.hidden = false;
  el.podium.innerHTML = order.map((place) => {
    const p = byPlace[place];
    if (!p) return '<div class="step"></div>';
    const you = me && p.uid === me.uid ? ' you' : '';
    return `
      <div class="step ${place}${you}">
        <div class="who">
          ${place === 'first' ? '<div class="crown" aria-hidden="true"></div>' : ''}
          <div class="name">${escapeHtml(p.name)}</div>
          <div class="pts">${formatScore(p.score)}</div>
        </div>
        <div class="block" aria-label="Position ${p.rank}">${p.rank}</div>
      </div>`;
  }).join('');
}

function renderRows(shown) {
  const now = Date.now();
  el.list.innerHTML = shown.map((p) => {
    const mine = !!myUid && p.uid === myUid;
    const climb = climbs.get(p.uid);
    const climbing = climb && climb.until > now;
    const classes = ['row'];
    if (p.rank <= 10) classes.push('top10');
    if (mine) classes.push('you');
    if (climbing) classes.push('climbed');
    if (climb && climb.fresh) classes.push('flash');
    const climbText = climbing ? (climb.places > 0 ? `▲ ${climb.places}` : 'New') : '';
    const gap = mine ? gapText(p) : '';
    return `
      <li class="${classes.join(' ')}" data-uid="${escapeHtml(p.uid)}" data-climb="${climbText}">
        <span class="pos">${p.rank}</span>
        <span class="name">${escapeHtml(p.name)}${mine ? '<span class="you-chip">You</span>' : ''}${gap ? `<span class="gap">${gap}</span>` : ''}</span>
        <span class="pts">${formatScore(p.score)}</span>
      </li>`;
  }).join('');
  climbs.forEach((c) => { c.fresh = false; });
  watchMine();
}

/** Points needed to pass the next player up, e.g. "150 to pass Arjun". */
function gapText(p) {
  if (p.rank === 1) return 'You hold first place';
  const above = players.filter((q) => q.score > p.score).pop();
  if (!above) return '';
  return `${formatScore(above.score - p.score + 1)} to pass ${escapeHtml(above.name)}`;
}

/** Bottom dock: your position, shown while your row is out of view. */
function renderDock(me) {
  if (!me) {
    el.me.hidden = !myUid;
    if (myUid) {
      el.me.innerHTML = `<span class="pos">-</span><span class="text"><span class="line1">You're not on the board yet</span>` +
        `<span class="line2">Score ${C.ONLINE.MIN_SCORE} or more to get a place</span></span>`;
      el.me.disabled = true;
    }
    return;
  }
  el.me.disabled = false;
  el.me.innerHTML = `<span class="pos">${me.rank}</span><span class="text">` +
    `<span class="line1">${escapeHtml(me.name)} <span class="dock-score">${formatScore(me.score)}</span></span>` +
    `<span class="line2">${gapText(me)}</span></span>`;
}

/**
 * Show the dock summary only when neither the hero plate (if it shows
 * the viewer) nor the viewer's list row is on screen.
 */
function watchMine() {
  if (mineObserver) mineObserver.disconnect();
  mineVisible.clear();
  const targets = [];
  if (el.hero.classList.contains('mine')) targets.push(el.hero);
  const row = myUid ? el.list.querySelector('.row.you') : null;
  if (row) targets.push(row);

  if (targets.length === 0 || !('IntersectionObserver' in window)) {
    // Not on the board yet (or hidden by a search): keep the dock visible
    el.me.hidden = !myUid;
    return;
  }
  mineObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) mineVisible.add(entry.target);
      else mineVisible.delete(entry.target);
    });
    el.me.hidden = mineVisible.size > 0;
  }, { rootMargin: '0px 0px -90px 0px' });
  targets.forEach((target) => mineObserver.observe(target));
}

/**
 * Plate in the middle of the scene: the viewer's position and next
 * target, or the race leader (with the score to beat) otherwise.
 */
function renderHero(me) {
  const leader = players[0];
  el.hero.classList.toggle('mine', !!me);
  if (me) {
    el.hero.innerHTML = plate(me.rank, 'Your position', me.name, me.score, gapText(me));
  } else if (leader) {
    const target = myUid
      ? `Beat ${formatScore(leader.score)} to take first place`
      : 'Play a run to get on the board';
    el.hero.innerHTML = plate(1, 'Leading the race', leader.name, leader.score, target);
  } else {
    el.hero.innerHTML = plate('-', 'No scores yet', 'The track is open', null, 'Play a run and take first place');
  }
  el.hero.hidden = false;
}

function plate(position, label, name, score, line) {
  return `<span class="pos">${position}</span>
    <span class="info">
      <span class="label">${escapeHtml(label)}</span>
      <span class="who"><span class="name">${escapeHtml(name)}</span>${score === null ? '' : `<span class="pts">${formatScore(score)}</span>`}</span>
      <span class="gap">${line}</span>
    </span>`;
}

function scrollToMe() {
  const row = el.list.querySelector('.row.you');
  if (!row) return;
  if (el.search.value) {
    el.search.value = '';
    render();
    return scrollToMe();
  }
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  row.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  row.classList.remove('flash');
  void row.offsetWidth; // restart the flash animation
  row.classList.add('flash');
}

function renderOrganiserTable(shown) {
  const rows = shown.map((p) => {
    const rate = p.duration > 0 ? p.score / p.duration : 0;
    const suspicious = rate > C.LEADERBOARD.SUSPICIOUS_POINTS_PER_SECOND;
    return `<tr>
      <td class="num">${p.rank}</td>
      <td>${escapeHtml(p.name)}</td>
      <td class="num">${formatScore(p.score)}</td>
      <td class="num">${formatDuration(p.duration)}</td>
      <td class="num${suspicious ? ' flag' : ''}">${rate.toFixed(0)}${suspicious ? ' check' : ''}</td>
      <td>${formatTime(p.timestamp)}</td>
      <td>${escapeHtml(String(p.uid || '').slice(0, 6))}</td>
    </tr>`;
  }).join('');
  el.list.innerHTML = `<li class="org-scroll"><table class="org">
    <thead><tr><th class="num">#</th><th>Name</th><th class="num">Score</th><th class="num">Run</th>
    <th class="num">Points/s</th><th>Updated</th><th>Player id</th></tr></thead>
    <tbody>${rows}</tbody></table></li>`;
}

function showState(message) {
  el.state.textContent = message;
  el.state.hidden = !message;
}

function formatScore(n) {
  return Number(n || 0).toLocaleString('en-IN');
}

function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function formatTime(timestamp) {
  if (!timestamp || !timestamp.toDate) return '';
  return timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
