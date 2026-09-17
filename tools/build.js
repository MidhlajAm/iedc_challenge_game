/*
 * Build step for Netlify (and `npm run build` locally).
 *
 * Copies the site into dist/ and minifies the JavaScript on the way:
 * published code has no comments and short local variable names, while
 * the source in this repo stays readable and commented for whoever
 * maintains it after the camp.
 *
 * It also writes js/firebase-config.js from the Netlify environment
 * variables, since that file is gitignored.
 *
 * Nothing here is downloaded by players: terser runs only at build time.
 */
const fs = require('fs');
const path = require('path');
const { minify } = require('terser');
const { firebaseConfigFile } = require('./write-firebase-config');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

// Files and folders that make up the site
const COPY = ['assets', 'index.html', 'leaderboard.html'];
const SCRIPT_DIRS = ['js'];
// These are ES modules (import/export); the rest are plain scripts whose
// top-level names are shared between files and must keep their names.
const MODULES = ['js/online/firebase-scores.js', 'js/leaderboard/leaderboard.js'];

async function build() {
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });

  for (const item of COPY) copy(path.join(root, item), path.join(dist, item));
  for (const dir of SCRIPT_DIRS) await minifyScripts(path.join(root, dir));

  // Firebase settings from the environment (or null, which turns the
  // online leaderboard off but leaves the game playable)
  fs.mkdirSync(path.join(dist, 'js'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'js', 'firebase-config.js'), firebaseConfigFile());

  console.log('Built site in dist/');
}

/** Copy a file or folder, stripping comments from .html files. */
function copy(from, to) {
  const stat = fs.statSync(from);
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) copy(path.join(from, name), path.join(to, name));
    return;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (from.endsWith('.html')) fs.writeFileSync(to, stripHtmlComments(fs.readFileSync(from, 'utf8')));
  else fs.copyFileSync(from, to);
}

/** Remove HTML and CSS comments (keeps everything else as written). */
function stripHtmlComments(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\n{3,}/g, '\n\n');
}

/** Minify every .js file under a folder into dist/. */
async function minifyScripts(dir) {
  for (const name of fs.readdirSync(dir)) {
    const from = path.join(dir, name);
    if (fs.statSync(from).isDirectory()) {
      await minifyScripts(from);
      continue;
    }
    if (!name.endsWith('.js')) continue;

    const relative = path.relative(root, from).split(path.sep).join('/');
    // The local Firebase settings never go into a build
    if (relative === 'js/firebase-config.js' || relative === 'js/firebase-config.example.js') continue;

    const result = await minify(fs.readFileSync(from, 'utf8'), {
      ecma: 2020,
      module: MODULES.includes(relative),
      // Plain scripts share their top-level names (GAME_CONFIG, Sfx, ...)
      // across files, so only rename variables inside functions.
      compress: { passes: 2 },
      mangle: { toplevel: MODULES.includes(relative) },
      format: { comments: false },
    });
    const to = path.join(dist, relative);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, result.code);
  }
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
