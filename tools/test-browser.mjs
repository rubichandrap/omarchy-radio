/* Drives a real browser over the routes, because the thing worth testing
   about a permalink is not that the file exists — tools/test-routes.mjs has
   that — but what happens in the four seconds after somebody opens one.

       node tools/test-browser.mjs

   It serves dist/ through tools/test-routes.mjs --serve, which resolves paths
   the way GitHub Pages does, and drives chromium through the DevTools
   protocol. No dependencies: node's own WebSocket, and chromium. Run
   `npm run build` first, or `npm test`, which builds.

   Point it at what is deployed to check a deploy:

       SITE=https://radio.omarchy.org node tools/test-browser.mjs

   What it checks, in the two states a browser can be in about autoplay:

     - opening /playlist/<song> plays that song, and nothing else
     - opening /podcast/<episode> loads that episode
     - when an audible autoplay is refused, it plays muted anyway and the
       next press turns the sound on where the track has got to
     - pressing a row routes: the address follows, the page does not reload,
       and the audio swaps without going back to the network for a document
     - back and forward walk the songs that were pressed
     - the tabs are links, and /playlist and /podcast are pages
     - the links from before the paths still work, and rewrite themselves
     - a page that names nothing plays the playlist, from the top, without
       taking the address over
     - a slug that names nothing falls back to the playlist
     - the last track runs into the first one
     - the repeat modes: `one` plays a finished item again from the top, `off`
       stops at the end of the play order and the next play starts from its head
     - the repeat button's faces: one per mode, flipped with the mode, and the
       mode's own face after a reload
     - the shuffle order: a permutation of the list walked one row at a time,
       a new cycle opened on a different row, and the deck it survives
     - the panel head on a phone: the heading and the switch share one row at
       390px, the heading giving way with an ellipsis rather than wrapping
     - an album is a place: every album answers at its own address at the site
       root with its rows, its title and its note, the selector over the songs
       marks the album the address names, the selector's links draw a smaller
       box than the switch's, and the numbers count within it
     - an album is what plays: a play seats the list the deck walks, a pick —
       an album link, `all`, home — is a look that moves the rows and leaves
       the sound alone, and the readout names the album the playing song came
       out of
     - the icons: Lucide drawings inline in the page, one size on the six
       buttons and one on the inline set, no lattice left under any of them
     - the two strips the buttons make: the transport, then shuffle and repeat
       8px off, sharing one row on a narrow screen, and a setting that is on
       painted the way the play button is painted
*/

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 8902;
// Point it at the deployed site to check a deploy: SITE=https://radio.omarchy.org
const SITE = process.env.SITE || '';
const BASE = SITE.replace(/\/+$/, '') || `http://127.0.0.1:${PORT}`;
const CDP_PORT = 9333;
const ROOT = new URL('..', import.meta.url).pathname;

const BROWSERS = ['chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome'];

let passed = 0;
let mark = 0;
let started = false;
const failures = [];

function section(name) {
  if (started) console.log(`  ${passed - mark} checks`);
  started = true;
  mark = passed;
  console.log(`\n${name}`);
}

function ok(cond, what) {
  if (cond) { passed++; return true; }
  failures.push(what);
  console.log(`  FAIL  ${what}`);
  return false;
}

function is(actual, expected, what) {
  return ok(actual === expected, `${what}: got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* The needle, dropped near the end of whatever the deck is playing: the
   suite's only way of reaching an `ended` without waiting out a song. False
   while the element is not seekable yet. */
const seekToEnd = (tab) => tab.eval(`(function () {
  var live = window.__probe.media.filter(function (m) { return !m.paused; })[0];
  if (!live || !isFinite(live.duration) || !live.duration) return false;
  live.currentTime = live.duration - 0.3;
  return true;
})()`);

async function until(what, fn, ms = 6000, step = 100) {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) { ok(false, `timed out waiting for ${what}`); return null; }
    await sleep(step);
  }
}

/* ── the probe ────────────────────────────────────────────────────────
   Installed before any of the page's own scripts, because the deck plays on
   its first tick and this has to be watching by then. The audio elements are
   never in the document, so the prototype is where they can be seen. */
const PROBE = `
window.__probe = { plays: [], refused: [], media: [], copied: [], statuses: [] };
/* Every value the status line has held, not just the one it holds now. Some
   of what the deck does is only visible as a state it passed through — a
   reconnect that was scheduled and then satisfied leaves nothing behind. */
document.addEventListener('DOMContentLoaded', function () {
  var node = document.getElementById('status');
  if (!node) return;
  var seen = function () {
    var t = (node.textContent || '').trim();
    if (t && window.__probe.statuses[window.__probe.statuses.length - 1] !== t) {
      window.__probe.statuses.push(t);
    }
  };
  seen();
  new MutationObserver(seen).observe(node, { childList: true, characterData: true, subtree: true });
});
try {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: function (t) { window.__probe.copied.push(t); return Promise.resolve(); } }
  });
} catch (e) { /* left as it is */ }
(function () {
  var play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (window.__probe.media.indexOf(this) < 0) window.__probe.media.push(this);
    var el = this;
    window.__probe.plays.push(el.src || el.currentSrc || '');
    var p;
    try { p = play.apply(this, arguments); } catch (e) {
      window.__probe.refused.push(String(e && e.name || e));
      throw e;
    }
    if (p && p.catch) p.catch(function (err) {
      window.__probe.refused.push(String((err && err.name) || err));
    });
    return p;
  };
})();
window.__state = function () {
  var on = document.querySelector('.track.is-on');
  var live = window.__probe.media.filter(function (m) { return !m.paused; });
  return {
    path: location.pathname,
    hash: location.hash,
    title: document.title,
    canonical: (document.querySelector('link[rel=canonical]') || {}).href || '',
    status: (document.getElementById('status') || {}).textContent || '',
    marquee: (document.querySelector('.marq-txt') || {}).textContent || '',
    row: on ? (on.querySelector('.tr-title') || {}).textContent : '',
    rowHref: on ? on.getAttribute('href') : '',
    state: on ? (on.querySelector('.tr-st') || {}).textContent : '',
    rows: document.querySelectorAll('a.track').length,
    // The numbers on screen, which are the items' places in the list rather
    // than their places among whatever the find box left showing.
    nums: Array.prototype.map.call(document.querySelectorAll('#tracks .tr-n'),
      function (n) { return n.textContent; }),
    titles: Array.prototype.map.call(document.querySelectorAll('#tracks .tr-title'),
      function (n) { return n.textContent; }),
    query: (document.getElementById('find') || {}).value || '',
    scroll: (function () {
      var box = document.getElementById('tracks');
      var row = document.querySelector('#tracks li.is-on');
      if (!box) return null;
      var out = { top: box.scrollTop, height: box.clientHeight,
                  scrollable: box.scrollHeight > box.clientHeight + 1, inView: null };
      if (row) {
        out.rowTop = row.offsetTop;
        out.rowHeight = row.offsetHeight;
        out.inView = row.offsetTop >= box.scrollTop &&
          row.offsetTop + row.offsetHeight <= box.scrollTop + box.clientHeight;
      }
      return out;
    })(),
    hint: (document.getElementById('findHint') || {}).textContent || '',
    skin: (document.getElementById('skinName') || {}).textContent || '',
    skins: Array.prototype.map.call(document.querySelectorAll('#themeMenu li'),
      function (li) { return li.dataset.skin; }),
    tab: (document.querySelector('.seg-b.is-on') || {}).id || '',
    note: (document.getElementById('playlistNote') || {}).textContent || '',
    /* What the panel says it is showing, and the number the lit row wears. */
    panel: (document.getElementById('playlistName') || {}).textContent || '',
    rowNum: on ? ((on.querySelector('.tr-n') || {}).textContent || '') : '',
    /* What the readout calls what is playing: the album while one of its
       songs is, and the song's number in it. */
    label: (document.getElementById('srcLabel') || {}).textContent || '',
    /* The album selector: whether it is over the list on screen at all, what
       it offers, and which of those it marks as the page being read. */
    albums: (function () {
      var box = document.getElementById('albs');
      if (!box) return null;
      var links = function (sel) {
        return Array.prototype.map.call(box.querySelectorAll(sel),
          function (a) { return a.textContent; });
      };
      return {
        hidden: !!box.hidden,
        labels: links('a'),
        current: links('a[aria-current="page"]')
      };
    })(),
    repeat: (function () {
      var b = document.getElementById('repeat');
      return {
        label: b ? b.getAttribute('aria-label') || '' : 'no repeat button',
        pressed: b ? b.getAttribute('aria-pressed') || '' : '',
        one: !!(b && b.classList.contains('is-one'))
      };
    })(),
    shuffle: (function () {
      var b = document.getElementById('shuffle');
      return {
        label: b ? b.getAttribute('aria-label') || '' : 'no shuffle button',
        pressed: b ? b.getAttribute('aria-pressed') || '' : ''
      };
    })(),
    plays: window.__probe.plays.slice(),
    statuses: window.__probe.statuses.slice(),
    copied: window.__probe.copied.slice(),
    refused: window.__probe.refused.slice(),
    playing: live.length > 0,
    muted: live.length ? live[0].muted : null,
    src: live.length ? live[0].src : '',
    at: live.length ? live[0].currentTime : 0,
    error: window.__probe.media.map(function (m) { return m.error ? m.error.code : 0; }),
    sentinel: window.__sentinel || 0,
    entries: history.length
  };
};
`;

/* ── a very small DevTools client ─────────────────────────────────────── */
class Browser {
  static async launch(policy) {
    const bin = await which();
    const profile = await mkdtemp(join(tmpdir(), 'omarchy-radio-test-'));
    const args = [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profile}`,
      `--autoplay-policy=${policy}`,
      '--mute-audio',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-gpu',
      '--window-size=1400,1000',
      '--hide-scrollbars',
      'about:blank',
    ];
    const proc = spawn(bin, args, { stdio: 'ignore' });
    let ws = '';
    for (let i = 0; i < 100 && !ws; i++) {
      await sleep(100);
      try {
        const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
        ws = (await r.json()).webSocketDebuggerUrl;
      } catch { /* not up yet */ }
    }
    if (!ws) { proc.kill('SIGKILL'); throw new Error('chromium never opened a debugging port'); }
    return new Browser(proc, profile, await open(ws));
  }

  constructor(proc, profile, sock) {
    this.proc = proc;
    this.profile = profile;
    this.sock = sock;
    this.id = 0;
    this.waiting = new Map();
    this.events = [];
    sock.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.waiting.has(msg.id)) {
        const { resolve, reject } = this.waiting.get(msg.id);
        this.waiting.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.sock.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.waiting.delete(id)) reject(new Error(`${method} never answered`));
      }, 20000);
    });
  }

  async tab() {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    const tab = new Tab(this, sessionId, targetId);
    await tab.send('Page.enable');
    await tab.send('Runtime.enable');
    await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
    return tab;
  }

  async close() {
    try { this.sock.close(); } catch { /* already gone */ }
    this.proc.kill('SIGTERM');
    await sleep(300);
    this.proc.kill('SIGKILL');
    await rm(this.profile, { recursive: true, force: true });
  }
}

class Tab {
  constructor(browser, sessionId, targetId) {
    this.browser = browser;
    this.sessionId = sessionId;
    this.targetId = targetId;
  }

  send(method, params) { return this.browser.send(method, params, this.sessionId); }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(`page threw: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    }
    return r.result.value;
  }

  async go(path) {
    await this.send('Page.navigate', { url: BASE + path });
    // The deck boots on DOMContentLoaded; the fonts and the audio can take
    // their time, so this waits for the deck rather than for the load event.
    await until(`${path} to boot`, () => this.eval('!!(window.__state && document.getElementById("status"))'));
    await this.eval('window.__sentinel = 1');
  }

  state() { return this.eval('window.__state()'); }

  async click(selector) {
    const box = await this.eval(`(function () {
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      var r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!box) { ok(false, `nothing to click at ${selector}`); return false; }
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', {
        type, x: Math.round(box.x), y: Math.round(box.y),
        button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0,
      });
    }
    return true;
  }

  close() { return this.browser.send('Target.closeTarget', { targetId: this.targetId }); }
}

async function which() {
  for (const name of BROWSERS) {
    const found = await new Promise((resolve) => {
      const p = spawn('sh', ['-c', `command -v ${name}`], { stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      p.stdout.on('data', (d) => { out += d; });
      p.on('close', () => resolve(out.trim()));
    });
    if (found) return found;
  }
  throw new Error(`no chromium found (tried ${BROWSERS.join(', ')})`);
}

function open(url) {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(url);
    sock.addEventListener('open', () => resolve(sock), { once: true });
    sock.addEventListener('error', reject, { once: true });
  });
}

/* ── the site under test ─────────────────────────────────────────────── */
function serve() {
  if (SITE) return { kill() {} }; // testing what is deployed, not what is here
  return spawn('node', [join(ROOT, 'tools/test-routes.mjs'), '--serve'], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore',
  });
}

async function routes() {
  const sitemap = await (await fetch(`${BASE}/sitemap.xml`)).text();
  const paths = [...sitemap.matchAll(/<loc>[^<]*?(\/(?:playlist|podcast)\/[^<]+)<\/loc>/g)]
    .map((m) => m[1]);
  const items = [];
  for (const path of paths) {
    const body = await (await fetch(BASE + path)).text();
    const m = body.match(/window\.__ITEM__ = (\{[\s\S]*?\});/);
    if (!m) throw new Error(`${path} has no item baked into it`);
    items.push({ path, ...JSON.parse(m[1].replace(/\\u003c/g, '<')) });
  }
  /* The albums, and the address each answers at. The addresses come out of
     the sitemap rather than being spelled here, so a suite run under another
     base asks for the pages that base serves. */
  const index = JSON.parse(await (await fetch(`${BASE}/tracks/albums.json`)).text());
  const albums = (index.albums ?? []).map((a) => {
    const m = sitemap.match(new RegExp(`<loc>([^<]*/${a.slug})</loc>`));
    return { slug: a.slug, name: a.name, path: m ? new URL(m[1]).pathname : `/${a.slug}` };
  });
  return {
    songs: items.filter((i) => i.kind === 'playlist'),
    eps: items.filter((i) => i.kind === 'podcast'),
    albums,
  };
}

/* ── the checks ──────────────────────────────────────────────────────── */

/* Typing into the find box, which is the one thing the deck does to what is
   on screen that deliberately does not touch the address. */
async function find({ songs }) {
  section('finding a song');
  const browser = await Browser.launch('no-user-gesture-required');
  const tab = await browser.tab();
  try {
    await tab.go('/playlist');
    /* Every page arrives with the rows already in it, so a row on screen is
       not evidence the deck is running — and typing into a box whose listener
       is not attached yet does nothing at all. Playing is the signal that the
       deck has booted, read the manifest and taken the list over. */
    const all = await until('the deck to own the playlist', async () => {
      const s = await tab.state();
      return s.playing && s.rows >= songs.length ? s : null;
    });
    if (!all) return;

    const type = async (q) => {
      await tab.eval(`(function () {
        var b = document.getElementById('find');
        b.value = ${JSON.stringify(q)};
        b.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      return tab.state();
    };

    // A word from a title and a word from an artist, which no single field has.
    let s = await type('koontz fix');
    is(s.rows, 1, 'both words have to appear, across the title and the artist');
    ok(/Fix Everything/.test(s.titles[0] || ''), `and it is the right song (${s.titles[0]})`);
    // The number is the song's place in its album, not its place here.
    const found = songs.find((q) => q.title === s.titles[0]);
    const at = songs.filter((q) => q.album === found.album).findIndex((q) => q.title === found.title);
    is(s.nums[0], String(at + 1).padStart(2, '0'),
       'a filtered row keeps the number it has in its album');
    ok(/\b1 of \d+ tracks\b/.test(s.note), `the note counts the matches (${s.note})`);
    is(s.hint, 'esc', 'and the key hint says how to get out of it');

    // An accent nobody is going to type.
    s = await type('aurelien');
    is(s.rows, 1, 'accents are folded on both sides');

    s = await type('zzz-nothing-is-called-this');
    is(s.rows, 0, 'a query that matches nothing shows nothing');
    ok(/nothing matched/.test(s.note), `and says so (${s.note})`);

    // Nothing about any of it is an address.
    is(s.path, '/playlist', 'a query does not touch the address');

    s = await type('');
    is(s.rows, songs.length, 'emptying it brings the playlist back');
    is(s.hint, '/', 'and the hint goes back to the key that focuses it');

    // The query was typed at the songs; the episodes are a different list.
    await type('quattro');
    await tab.eval("document.getElementById('tabPodcast').click()");
    s = await until('the podcast tab', async () => {
      const st = await tab.state();
      return st.tab === 'tabPodcast' ? st : null;
    });
    if (s) is(s.query, '', 'switching lists clears the query rather than filtering the other one');
  } finally {
    await tab.close();
    await browser.close();
  }
}

/* The panel head on a phone.
 *
 * The heading over the list and the switch beside it share one row at every
 * width. The heading takes what room is left and ends in an ellipsis when its
 * words do not fit; the switch never leaves the row, and never leaves the
 * panel. The podcast's own heading is the long one. */
async function panelHeadOnAPhone() {
  section('the panel head on a phone');
  const browser = await Browser.launch('no-user-gesture-required');
  const tab = await browser.tab();
  try {
    await tab.go('/podcast');
    const s = await until('the panel to say what it is showing', async () => {
      const st = await tab.state();
      return st.panel ? st : null;
    });
    if (!ok(s, 'the panel names the show')) return;

    const drawn = async (width) => {
      const back = await tab.eval('window.innerWidth');
      await tab.send('Emulation.setDeviceMetricsOverride',
                     { width, height: 900, deviceScaleFactor: 1, mobile: false });
      // The override lands a beat after the call; the layout read is the one
      // for this width, not for the one before it.
      await until(`the ${width}px viewport`, async () =>
        (await tab.eval('window.innerWidth')) === width ? true : null);
      const out = await tab.eval(`(function () {
        var head = document.querySelector('.panel-head');
        var title = head.querySelector('.panel-title');
        var btns = head.querySelector('.head-btns');
        var panel = document.querySelector('.playlist');
        var box = function (el) {
          var r = el.getBoundingClientRect();
          return { l: r.left, r: r.right, t: r.top, b: r.bottom };
        };
        return title && btns
          ? { title: box(title), btns: box(btns), panel: box(panel),
              truncated: title.scrollWidth > title.clientWidth + 1 }
          : null;
      })()`);
      await tab.send('Emulation.clearDeviceMetricsOverride');
      // And the viewport is back before anything else is read in it.
      await until('the viewport to come back', async () =>
        (await tab.eval('window.innerWidth')) === back ? true : null);
      return out;
    };

    const phone = await drawn(390);
    if (ok(phone, 'the head is drawn at 390px')) {
      /* One row: the two boxes share vertical space rather than stacking. */
      const shared = Math.min(phone.title.b, phone.btns.b) -
                     Math.max(phone.title.t, phone.btns.t);
      ok(shared > 0,
         `the switch shares the heading's row (${Math.round(shared)}px of the two boxes overlap)`);
      ok(phone.btns.r <= phone.panel.r + 0.5,
         `and stays inside the panel (${Math.round(phone.btns.r)} against ${Math.round(phone.panel.r)})`);
      ok(phone.truncated,
         'the heading, given less room than its words need, ends in an ellipsis');
    }

    const wide = await drawn(1200);
    if (ok(wide, 'the head is drawn at 1200px too')) {
      ok(!wide.truncated, 'and on a wide one the whole heading is drawn');
    }
  } finally {
    await tab.close();
    await browser.close();
  }
}

/* An album is a place.
 *
 * Every declared album answers at an address of its own at the site root,
 * beside the two lists, and the page that answers is the album's: its rows,
 * the panel title naming it, a note counting it, and the selector over the
 * songs marking the album the address names. The numbers count within the
 * album on screen — a row's number is the song's place in its album — so a
 * song's own page wears the number the deck gave it, not the one it happens
 * to have in the whole playlist.
 *
 * Picking one is a look: the rows, the address, the numbering and the
 * selector move, and the sound does not — that is the next section's
 * business. This one is about the place itself: the address, the rows, the
 * numbering, and the selector that marks it — drawn smaller than the switch
 * over the lists, because the switch chooses one and the selector only
 * narrows it. */
async function albumsAtTheirAddresses({ songs, albums }) {
  section('an album is a place');
  const browser = await Browser.launch('no-user-gesture-required');
  const tab = await browser.tab();
  try {
    const album = albums[albums.length - 1];
    if (!ok(album, 'the index declares an album to be sent to')) return;
    const mine = songs.filter((s) => s.album === album.slug);
    if (!ok(mine.length, `the ${album.slug} album has songs in the playlist`)) return;
    const pad = (n) => String(n).padStart(2, '0');

    const type = async (q) => {
      await tab.eval(`(function () {
        var b = document.getElementById('find');
        b.value = ${JSON.stringify(q)};
        b.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      return tab.state();
    };

    /* The front page is the whole playlist, and the selector is over it: all
       of them, in the order the index declares them, with `all` the one being
       read — the address names no album. */
    await tab.go('/');
    let s = await until('the deck to own the playlist', async () => {
      const st = await tab.state();
      return st.playing && st.rows >= songs.length ? st : null;
    });
    if (!s) return;
    if (!ok(s.albums, 'the panel carries the album selector')) return;

    is(s.albums.hidden, false, 'the selector is over the songs');
    is(s.albums.labels.join(','),
       ['all'].concat(albums.map((a) => a.name.toLowerCase())).join(','),
       'it lists all and every album, in the order the index declares them');
    is(s.albums.current.join(','), 'all', 'and on the unscoped list the one it marks is all');

    /* The selector is smaller than the switch, in the same seg: the switch
       chooses the list and this row only narrows it, and the box says so
       before a press does. The claim is measured against the switch's own
       links — the thinner padding, the same type size, a shorter box. */
    const drawn = async (width) => {
      const back = await tab.eval('window.innerWidth');
      await tab.send('Emulation.setDeviceMetricsOverride',
                     { width, height: 900, deviceScaleFactor: 1, mobile: false });
      // The override lands a beat after the call; the layout read is the one
      // for this width, not for the one before it.
      await until(`the ${width}px viewport`, async () =>
        (await tab.eval('window.innerWidth')) === width ? true : null);
      const out = await tab.eval(`(function () {
        var shot = function (el) {
          var cs = getComputedStyle(el);
          return {
            pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' '),
            fs: cs.fontSize,
            w: parseFloat(cs.width), h: parseFloat(cs.height)
          };
        };
        var links = Array.prototype.map.call(document.querySelectorAll('#albs a.seg-b'), shot);
        var swap = document.getElementById('tabSongs');
        var row = document.getElementById('albs');
        var panel = document.querySelector('.playlist');
        var box = function (el) {
          var r = el.getBoundingClientRect();
          return { l: r.left, w: r.width };
        };
        return links.length && swap && row && panel
          ? { album: links, swap: shot(swap), row: row.clientWidth,
              rowBox: box(row), panelBox: box(panel) }
          : null;
      })()`);
      await tab.send('Emulation.clearDeviceMetricsOverride');
      // And the viewport is back before anything else is pressed in it: a
      // click read against a half-restored layout lands where the link is not.
      await until('the viewport to come back', async () =>
        (await tab.eval('window.innerWidth')) === back ? true : null);
      return out;
    };

    const wide = await drawn(1200);
    if (ok(wide, 'the album links and the switch are both drawn')) {
      ok(wide.album.every((l) => l.pad === '3px 8px 3px 8px'),
         `the album links draw the thinner box (${wide.album.map((l) => l.pad).join(' / ')})`);
      ok(wide.album.every((l) => l.fs === '10px'), 'keeping the type size they had');
      ok(wide.album.every((l) => l.fs === wide.swap.fs), 'which is the switch’s own');
      ok(wide.album.every((l) => l.h < wide.swap.h),
         `and every one stands shorter than the switch ` +
         `(${wide.album.map((l) => l.h).join('/')} against ${wide.swap.h})`);
    }

    /* The narrow layout carries the same distinction: the album links keep
       the thin box the desktop draws — sized to their words, starting at the
       panel's left edge — while the switch's links keep the 44px target. The
       two rows never read as twins. */
    for (const width of [900, 800]) {
      const slim = await drawn(width);
      if (!ok(slim, `the album row is drawn at ${width}px too`)) continue;
      ok(slim.album.every((l) => l.h < slim.swap.h),
         `at ${width}px every album link stands shorter than the switch ` +
         `(${slim.album.map((l) => l.h).join('/')} against ${slim.swap.h})`);
      ok(slim.album.every((l) => l.pad === '3px 8px 3px 8px' && l.fs === slim.swap.fs),
         `on the thinner box and the switch’s own type ` +
         `(${slim.album.map((l) => l.pad).join(' / ')})`);
      /* Sized to their words, the links stop sharing the row evenly: `all`
         is a word, an album's name is longer. */
      const widths = slim.album.map((l) => l.w);
      ok(Math.max(...widths) - Math.min(...widths) > 20,
         `whose links size to their words, no longer an even share (${widths.join('/')})`);
      ok(Math.abs(slim.rowBox.l - (slim.panelBox.l + 16)) <= 1,
         `and the row starts at the panel's left edge ` +
         `(${Math.round(slim.rowBox.l)} against ${Math.round(slim.panelBox.l + 16)})`);
      ok(slim.swap.h === 44, 'while the switch keeps its 44px target');
    }

    // Picking an album is a press on a link: a place, and no reload.
    await tab.click(`#albs a[data-album="${album.slug}"]`);
    s = await until('the album to answer', async () => {
      const st = await tab.state();
      return st.path === album.path && st.rows === mine.length ? st : null;
    });
    if (!s) return;
    is(s.sentinel, 1, 'the album link is the deck’s, not a fresh document');
    is(s.path, album.path, 'the album answers at its own address');
    is(s.panel, album.name.toLowerCase(), 'the panel title names the album');
    ok(new RegExp(`^${mine.length} tracks`).test(s.note.trim()),
       `the note counts the album's songs (${s.note.trim()})`);
    is(s.albums.current.join(','), album.name.toLowerCase(),
       'and the selector marks the album the address names');
    is(s.nums[0], '01', 'the rows count within the album: the first one is 01');
    is(s.nums[s.nums.length - 1], pad(mine.length), 'and the last one is its last track');

    // Find filters the album on screen, and counts what it looked through.
    const foreign = songs.filter((q) => q.album !== album.slug && q.artist)
      .sort((a, b) => b.artist.length - a.artist.length)[0];
    if (foreign) {
      s = await type(foreign.artist);
      is(s.rows, 0, `a song from ${foreign.album} is not in the album on screen`);
      ok(s.note.includes(String(mine.length)) && /nothing matched/.test(s.note),
         `and the note counts the album it looked through (${s.note.trim()})`);
    }
    const some = mine[mine.length - 1];
    s = await type(some.title);
    if (is(s.rows, 1, "the album's own song is found in it")) {
      is(s.nums[0], pad(mine.length), 'keeping the number it has in the album');
    }
    await type('');

    /* A press on a row inside the album plays the song that row names, not
       the one sitting at that index in the whole playlist, and the address it
       writes is that song's own — a song keeps /playlist/<song> wherever in
       the playlist it sits. */
    const third = mine[2];
    await tab.click(`#tracks a.track[href="${third.path}"]`);
    s = await until('the pressed row to play', async () => {
      const st = await tab.state();
      return st.path === third.path && st.rowHref === third.path ? st : null;
    });
    if (!s) return;
    is(s.row, third.title, "the album's third row plays the third song of the album");
    is(s.albums.current.join(','), album.name.toLowerCase(),
       'and the album it is in stays the one in view, because that is where the row was pressed');

    /* Which is one step, and back takes it. */
    await tab.eval('history.back()');
    s = await until('the way back to the album', async () => {
      const st = await tab.state();
      return st.path === album.path && st.rows === mine.length ? st : null;
    });
    if (s) is(s.albums.current.join(','), album.name.toLowerCase(), 'and the album is marked again');

    /* A song's own page — the document itself, not the press — is numbered by
       its place in its album, and the list behind it is the whole playlist,
       because its address names an album and no song. */
    await tab.go(third.path);
    s = await until('the song to play, out of the whole playlist', async () => {
      const st = await tab.state();
      return st.playing && st.rowHref === third.path && st.rows >= songs.length ? st : null;
    });
    if (!s) return;
    is(s.path, third.path, 'a song keeps the /playlist address it always had');
    is(s.rowNum, pad(3), "and its own page is numbered by its place in its album");

    /* Picking an album now, with a song the listener named still playing: the
       address becomes the album's and the deck stops calling the page the
       song's, so the address and the selector go on agreeing. */
    await tab.click(`#albs a[data-album="${album.slug}"]`);
    s = await until('the album to take the address back', async () => {
      const st = await tab.state();
      return st.path === album.path ? st : null;
    });
    if (!s) return;
    is(s.path, album.path, 'the album takes the address even after a song was named');
    is(s.canonical, 'https://radio.omarchy.org' + album.path, 'and the canonical says the same');
    is(s.albums.current.join(','), album.name.toLowerCase(),
       'with the album marked: the panel and the address agree');

    // Every album, by address: the marking is the address's, not one page's.
    const other = albums[0];
    await tab.go(other.path);
    s = await until('the other album', async () => {
      const st = await tab.state();
      return st.path === other.path && st.rows ? st : null;
    });
    if (s) is(s.albums.current.join(','), other.name.toLowerCase(), 'another album marks itself');

    // And over the episodes the selector is not there at all.
    await tab.go('/podcast');
    s = await until('the episodes', async () => {
      const st = await tab.state();
      return st.tab === 'tabPodcast' ? st : null;
    });
    if (s) is(s.albums.hidden, true, 'and the selector is not over the episodes');
  } finally {
    await tab.close();
    await browser.close();
  }
}

/* An album is what plays, and a pick is a look.
 *
 * A play seats the list the deck walks: a row pressed inside an album plays
 * out of that album, a row pressed on `all` plays out of the whole playlist,
 * and arriving at an album's address starts that album. So the transport,
 * shuffle and repeat are checked against the list that plays — walking it,
 * wrapping at its ends, and coming round again at its end — while a pick, an
 * album link, `all` or home, moves the rows, the address and the numbering
 * and nothing about the sound: the deck goes on playing, and goes on walking
 * the list its playback was seated into. The readout names the album the
 * playing song came out of while the panel may be showing another, and no
 * row is lit while the playing item is outside the album on screen.
 *
 * The last checks are the gesture claim, and they want a deck which was
 * refused the sound: a press on an album link is a real pointer gesture, and
 * it has to buy the sound without starting anything. */
async function albumsPlay({ songs, albums }) {
  section('an album is what plays');
  if (!ok(albums.length >= 2, 'the index declares two albums or more')) return;
  const first = albums[0];
  const last = albums[albums.length - 1];
  const mine = songs.filter((s) => s.album === last.slug);
  const other = songs.filter((s) => s.album === first.slug);
  if (!ok(mine.length && other.length, 'both albums have songs')) return;

  /* Which song a state is playing. The album's directory is part of the
     address, so a file name alone would not say where it came from. */
  const playingNow = (s) => songs.find((q) =>
    decodeURIComponent(s.src).endsWith(`/tracks/${q.album}/${q.file}`));
  /* What the readout should say while that song plays: the album it came
     out of, and the number its row wears in it. */
  const labelOf = (song, album) =>
    album.name.toLowerCase() + ' · track ' +
    (songs.filter((q) => q.album === album.slug).indexOf(song) + 1);

  const browser = await Browser.launch('no-user-gesture-required');
  const tab = await browser.tab();
  try {
    // ── arriving at an album's address starts that album ──
    await tab.go(last.path);
    let s = await until('the album to start by itself', async () => {
      const st = await tab.state();
      const p = playingNow(st);
      return st.playing && st.at > 0 && st.rows === mine.length && p && p.album === last.slug
        ? st : null;
    });
    if (!s) return;
    is(s.path, last.path, "an album's address stays its own page");
    is(playingNow(s).path, mine[0].path, 'the album starts itself, from its first track');
    is(s.albums.current.join(','), last.name.toLowerCase(), 'with the album the one marked as read');
    is(s.label, labelOf(mine[0], last), 'and the readout names the album it is playing');

    // ── a pick is a look: the rows move, the sound does not ──
    const was = s;
    await tab.click(`#albs a[data-album="${first.slug}"]`);
    s = await until('the other album to answer', async () => {
      const st = await tab.state();
      return st.path === first.path && st.rows === other.length ? st : null;
    });
    if (!s) return;
    is(s.sentinel, 1, 'the press is the deck’s, not a fresh document');
    is(s.path, first.path, 'the album is the address the press names');
    is(s.albums.current.join(','), first.name.toLowerCase(), 'and the selector marks it');
    is(s.src, was.src, 'the pick leaves the sound alone: the same source');
    is(s.at >= was.at, true, 'and the track goes on from where it was');
    is(s.playing, true, 'nothing was started and nothing stopped');
    is(playingNow(s).album, last.slug, 'the album that was playing is still the one playing');
    is(s.label, labelOf(mine[0], last), 'the readout goes on naming it');
    is(s.row, '', 'and no row is lit while it is out of the album on screen');

    /* `next` walks the list that plays — the album the deck was seated into
       — not the one the look put on screen. */
    await tab.click('#next');
    s = await until('the album that plays to walk on', async () => {
      const st = await tab.state();
      const p = playingNow(st);
      return p && p.path === mine[1].path ? st : null;
    });
    if (!s) return;
    is(s.path, first.path, 'next is the deck walking, not the address moving');
    is(s.rows, other.length, 'and the rows on screen are still the other album’s');

    /* Home is a look like the rest: the whole playlist on screen, the album
       still the list that plays. */
    const walking = s;
    await tab.click('a.mark');
    s = await until('the front of the deck', async () => {
      const st = await tab.state();
      return st.path === '/' && st.rows === songs.length ? st : null;
    });
    if (!s) return;
    is(s.src, walking.src, 'pressing home leaves the sound alone');
    is(playingNow(s).album, last.slug, 'and the album it was playing goes on playing');
    const on = playingNow(s);
    const nextMine = mine[(mine.indexOf(on) + 1) % mine.length];
    await tab.click('#next');
    s = await until('the album to walk on', async () => {
      const st = await tab.state();
      const p = playingNow(st);
      return p && p.path === nextMine.path ? st : null;
    });
    if (!s) return;
    is(s.path, '/', "and next keeps walking the album, off the page it is read on");

    // Back to the album for the checks that need it on screen.
    await tab.click(`#albs a[data-album="${first.slug}"]`);
    if (!await until('the album again', async () => {
      const st = await tab.state();
      return st.path === first.path && st.rows === other.length ? st : null;
    })) return;

    // ── a row pressed in the album on screen seats it ──
    await tab.click(`#tracks a.track[href="${other[0].path}"]`);
    s = await until("the album's first row to play", async () => {
      const st = await tab.state();
      const p = playingNow(st);
      return p && p.path === other[0].path ? st : null;
    });
    if (!s) return;
    is(s.path, other[0].path, 'the row pressed names the song in the address');
    is(s.albums.current.join(','), first.name.toLowerCase(),
       'and the album it is in stays the one in view');
    is(s.label, labelOf(other[0], first), 'the readout names the album the song came out of');
    is(s.row, other[0].title, 'the row pressed is the one lit');

    // ── the transport walks the album that plays, and wraps at its ends ──
    await tab.click('#next');
    s = await until("the album's second track", async () => {
      const st = await tab.state();
      const p = playingNow(st);
      return p && p.path === other[1].path ? st : null;
    });
    if (!s) return;
    is(s.path, other[1].path, 'next is the album walking, not the address moving');

    await tab.click('#prev');
    if (!await until('back on the first one', async () => {
      const st = await tab.state();
      const p = playingNow(st);
      return p && p.path === other[0].path ? st : null;
    })) return;

    /* Back off the head and the album's own tail is where the deck lands.
       The playlist's tail belongs to another album, so this wrap is the
       album's and not the list's. */
    await tab.click('#prev');
    s = await until("the album's own tail", async () => {
      const st = await tab.state();
      const p = playingNow(st);
      return p && p.path === other[other.length - 1].path ? st : null;
    });
    if (!s) return;
    ok(other[other.length - 1].path !== songs[songs.length - 1].path,
       "the album's tail is not the playlist's tail, so that wrap was the album's");

    // ── repeat all brings the album round again, from its own head ──
    is(s.repeat.label, 'Repeat mode: all', 'the deck is repeating the cycle');
    const before = s.plays.length;
    if (ok(await until('the album\'s last track to be runnable to its end',
                       () => seekToEnd(tab), 15000, 200),
           "the album's last track can be run to its end")) {
      s = await until('the album to come round', async () => {
        const st = await tab.state();
        return st.plays.length > before ? st : null;
      }, 15000);
      if (s) is(playingNow(s).path, other[0].path,
                "repeat all starts the album again: its own first track, not the playlist's next");
    }

    // ── shuffle permutes the album that plays ──
    await tab.click('#shuffle');
    s = await until('shuffle on', async () => {
      const st = await tab.state();
      return st.shuffle.pressed === 'true' ? st : null;
    });
    if (!s) return;
    ok(s.note.trim().startsWith(`${other.length} tracks`) && /shuffled/.test(s.note),
       `the note counts the album and says the order is shuffled (${s.note.trim()})`);

    const walked = [];
    for (let i = 0; i < 4; i++) {
      const wasOn = walked.length ? walked[walked.length - 1] : s.rowHref;
      await tab.click('#next');
      const st = await until('another row of the album', async () => {
        const now = await tab.state();
        return now.rowHref && now.rowHref !== wasOn ? now : null;
      });
      if (!st) return;
      walked.push(st.rowHref);
    }
    const inAlbum = new Set(other.map((q) => q.path));
    ok(walked.every((p) => inAlbum.has(p)),
       `the cycle is that album's songs, not the playlist's (walked ${walked.join(', ')})`);
    is(new Set(walked).size, walked.length, 'and it walks them without repeating one');

    /* A pick while the cycle is walking is a look too: nothing starts, and
       the cycle goes on being the album the deck was seated into. */
    const heard = (await tab.state()).plays.length;
    await tab.click(`#albs a[data-album="${last.slug}"]`);
    s = await until('the other album to answer', async () => {
      const st = await tab.state();
      return st.path === last.path && st.rows === mine.length ? st : null;
    });
    if (!s) return;
    is(s.plays.length, heard, 'a pick with shuffle on starts nothing either');
    is(playingNow(s).album, first.slug, 'the cycle it walks is still the album it was playing');
    is(s.row, '', 'and no row is lit while it walks an album that is not on screen');

    /* With shuffle on, arriving at an album's address starts the album
       somewhere inside it: the head of a fresh cycle, drawn over it. */
    await tab.go(last.path);
    s = await until('the shuffled album to start by itself', async () => {
      const st = await tab.state();
      const p = playingNow(st);
      return st.playing && st.at > 0 && st.rows === mine.length && p && p.album === last.slug
        ? st : null;
    });
    if (!s) return;
    is(s.shuffle.pressed, 'true', 'the shuffle setting outlives the document');
    is(s.path, last.path, "and the album's address is still its own page");
    ok(mine.some((q) => q.path === playingNow(s).path),
       `it starts somewhere inside the album (${playingNow(s).title})`);
    is(s.label, labelOf(playingNow(s), last), 'with the readout naming the album and its number');

    await tab.click('#shuffle');
    if (!await until('shuffle off', async () => {
      const st = await tab.state();
      return st.shuffle.pressed === 'false' ? st : null;
    })) return;
    s = await tab.state();
    ok(s.note.trim().startsWith(`${mine.length} tracks`) && !/shuffled/.test(s.note),
       `the note counts the album and drops the shuffle phrase (${s.note.trim()})`);

    // ── all is a look, and a row pressed while it is up seats the playlist ──
    const seated = await tab.state();
    await tab.click('#albs a[data-album=""]');
    s = await until('the whole playlist', async () => {
      const st = await tab.state();
      return st.rows === songs.length && st.albums.current.join(',') === 'all' ? st : null;
    });
    if (!s) return;
    is(s.src, seated.src, 'pressing all does not touch the sound');
    is(s.playing, true, 'and the song playing goes on playing');

    /* The row after the last song of the first album is the first song of
       the second: the declared order, walked. */
    const tail = other[other.length - 1];
    const after = songs[songs.indexOf(tail) + 1];
    if (!ok(after && after.album === last.slug,
            'the album declared after the first one is the second')) return;
    await tab.click(`#tracks a.track[href="${tail.path}"]`);
    if (!await until("the first album's last row", async () => {
      const st = await tab.state();
      const p = playingNow(st);
      return p && p.path === tail.path ? st : null;
    })) return;
    const from = (await tab.state()).plays.length;
    await tab.click('#next');
    s = await until('the second album to follow', async () => {
      const st = await tab.state();
      return st.plays.length > from ? st : null;
    });
    if (s) is(playingNow(s).path, after.path,
              'the first album runs into the second, in the order they are declared');

    // ── the readout names the album with the other list on screen ──
    await tab.click('#tabPodcast');
    s = await until('the episodes', async () => {
      const st = await tab.state();
      return st.tab === 'tabPodcast' ? st : null;
    });
    if (s) {
      is(s.label, labelOf(after, last), 'the readout goes on naming the album while the episodes are shown');
      is(s.marquee, after.title, 'and the marquee is the song that is playing');
    }
    await tab.click('#tabSongs');
    if (!await until('the songs', async () => {
      const st = await tab.state();
      return st.tab === 'tabSongs' ? st : null;
    })) return;

    // ── a pick while paused starts nothing, and moves nothing ──
    await tab.click('#toggle');
    s = await until('the deck to pause', async () => {
      const st = await tab.state();
      return st.playing === false ? st : null;
    });
    if (!s) return;
    const quiet = s.plays.length;
    const halted = s.label;
    await tab.click(`#albs a[data-album="${first.slug}"]`);
    s = await until('the other album, silently', async () => {
      const st = await tab.state();
      return st.path === first.path && st.rows === other.length ? st : null;
    });
    if (!s) return;
    is(s.plays.length, quiet, 'picking an album with the deck paused starts nothing');
    is(s.playing, false, 'and nothing is playing');
    is(s.label, halted, 'the readout keeps naming the item the deck stood on');
    is(s.row, '', 'and no row is lit: the item it stood on is in the other album');

    await tab.click('#toggle');
    s = await until('the item it stood on to resume', async () => {
      const st = await tab.state();
      const p = playingNow(st);
      return st.playing && p && p.path === after.path ? st : null;
    });
    if (s) is(playingNow(s).path, after.path,
              'pressing play resumes the item it stood on, not the album on screen');

    /* And the same stopped: a stop is not a re-seat either, and the next play
       picks the item the deck was standing on up again. */
    await tab.click('#stop');
    s = await until('the deck to stop', async () => {
      const st = await tab.state();
      return st.playing === false ? st : null;
    });
    if (!s) return;
    const still = s.plays.length;
    await tab.click(`#albs a[data-album="${last.slug}"]`);
    s = await until('the album, silently', async () => {
      const st = await tab.state();
      return st.path === last.path && st.rows === mine.length ? st : null;
    });
    if (!s) return;
    is(s.plays.length, still, 'picking an album with the deck stopped starts nothing');
    await tab.click('#toggle');
    s = await until('the stopped song to resume', async () => {
      const st = await tab.state();
      const p = playingNow(st);
      return st.playing && p && p.path === after.path ? st : null;
    });
    if (s) is(playingNow(s).path, after.path, 'and play picks up the item it stood on');

    /* ── off at the end names the album that ended, not the one on screen ──
       A row pressed in the album on screen seats it; the panel then moves to
       the other album, and the end of the order is the one it walked. The
       repeat button walks all, then one, then off: two presses from here. */
    await tab.click('#repeat');
    await tab.click('#repeat');
    s = await until('the mode to change', async () => {
      const st = await tab.state();
      return st.repeat.label === 'Repeat mode: off' ? st : null;
    });
    if (!s) return;
    await tab.click(`#tracks a.track[href="${mine[mine.length - 1].path}"]`);
    if (!await until("the album's last row", async () => {
      const st = await tab.state();
      const p = playingNow(st);
      return p && p.path === mine[mine.length - 1].path ? st : null;
    })) return;
    await tab.click(`#albs a[data-album="${first.slug}"]`);
    if (!await until('the other album on screen', async () => {
      const st = await tab.state();
      return st.path === first.path && st.rows === other.length ? st : null;
    })) return;
    if (ok(await until("the album's last track to be runnable to its end",
                       () => seekToEnd(tab), 15000, 200),
           "the album's last track can be run to its end")) {
      s = await until('the album to end', async () => {
        const st = await tab.state();
        return !st.playing && /has ended/.test(st.status) ? st : null;
      }, 15000);
      if (s) {
        is(s.status.trim(), 'the album has ended',
           'the status names the album that ended, not the one on screen');
        is(s.row, '', 'and no row is lit: it stands at the head of the album off screen');
      }
    }
  } finally {
    await tab.close();
    await browser.close();
  }

  /* ── the gesture claim: the press on an album link is audible ──
     A deck the browser refused the sound is playing muted. The press is the
     gesture that buys the sound, and the pick being a look, it starts
     nothing: the song goes on playing where it is, audibly. A fresh document
     per press, because the autoplay policy is per document. It is also a
     browser of its own: the suite's CDP port is one, so this one runs after
     the one above is closed rather than beside it. */
  const refused = await Browser.launch('user-gesture-required');
  const quietTab = await refused.tab();
  try {
    await quietTab.go('/');
    let q = await until('the deck to arrive playing muted', async () => {
      const st = await quietTab.state();
      return st.playing && st.at > 0 ? st : null;
    });
    if (!q) return;
    is(q.muted, true, 'the arrival was refused the sound, so the deck plays muted');
    const muted = q;
    const song = playingNow(muted);
    /* What makes the no-row-lit check below meaningful is the album on screen
       being another one: the front page starts in the album declared first. */
    if (!ok(song && song.album === first.slug,
            'the front page starts in the album the index declares first')) return;

    /* An album that is not the playing song's: the press is a look, and it
       is the gesture the arrival could not be. */
    await quietTab.click(`#albs a[data-album="${last.slug}"]`);
    q = await until('the sound to come on', async () => {
      const st = await quietTab.state();
      const p = playingNow(st);
      return st.playing && st.muted === false && p && p.path === song.path ? st : null;
    }, 10000);
    if (q) {
      is(playingNow(q).path, song.path, 'the album pressed leaves the song playing');
      is(q.at >= muted.at, true, 'and buys the sound without starting it again');
      is(q.row, '', 'with no row lit while the album on screen is not the one playing');
    }

    /* And the album the playing song is already in: the same press, the same
       sound. A fresh document, because this one has had its press already. */
    await quietTab.go('/');
    const back = await until('the deck to arrive playing muted again', async () => {
      const st = await quietTab.state();
      return st.playing && st.at > 0 && st.muted ? st : null;
    });
    if (!back) return;
    const same = playingNow(back);
    await quietTab.click(`#albs a[data-album="${first.slug}"]`);
    const loud = await until('the sound to come on', async () => {
      const st = await quietTab.state();
      const p = playingNow(st);
      return st.playing && st.muted === false && p && p.path === same.path ? st : null;
    }, 10000);
    if (loud) {
      is(loud.src, back.src, 'pressing the album the song is already in keeps the song');
      is(loud.at >= back.at, true, 'and buys the sound without starting it again');
    }
  } finally {
    await quietTab.close();
    await refused.close();
  }
}

/* A visitor coming back after the files were renamed.
   Slugs come from titles, so a song whose file changed is the same song at the
   same address — but the copy of the playlist kept in localStorage names the
   old file, and the deck starts playing it before the real manifest lands.
   The manifest is the authority on where a song lives. */
async function stalePlaylist({ songs }) {
  section('coming back to a playlist whose files have moved');
  const browser = await Browser.launch('no-user-gesture-required');
  const tab = await browser.tab();
  /* A permalink, not the front page. tuneIn() only reaches for the kept copy
     when the address names something out of a list — the front page has
     nothing to look up, so it waits for the manifest and the stale copy never
     gets a chance to be wrong. */
  const song = songs[3];
  try {
    // Arrive once so the deck keeps a copy, then spoil the copy the way a
    // rename would have: same titles, files that are no longer there.
    await tab.go('/');
    await until('the deck to keep a copy', () =>
      tab.eval("!!localStorage.getItem('omarchy-radio-playlist')"));

    const spoiled = await tab.eval(`(function () {
      var kept = JSON.parse(localStorage.getItem('omarchy-radio-playlist'));
      kept.tracks.forEach(function (t) { t.file = 'gone-' + t.file; });
      localStorage.setItem('omarchy-radio-playlist', JSON.stringify(kept));
      return kept.tracks[0].file;
    })()`);
    ok(/^gone-/.test(spoiled), `the kept copy now names files that are not there (${spoiled})`);

    await tab.go(song.path);
    const s = await until('the deck to play the file the manifest names', async () => {
      const st = await tab.state();
      return st.playing && st.at > 0 ? st : null;
    }, 20000);
    if (!s) return;
    ok(!/gone-/.test(decodeURIComponent(s.src)),
       `it is not playing the file that moved (${decodeURIComponent(s.src).split('/').pop()})`);
    ok(decodeURIComponent(s.src).includes(song.file),
       'it is playing the one the manifest names');
    is(s.rows, songs.length, 'and the list is the real one');

    /* And it got there directly. The reconnect budget would have corrected
       this on its own a second later — the address it retries is read back
       from the list — so the end state is not what distinguishes a deck that
       takes the manifest's word from one that waits to be told by a 404.
       What distinguishes them is whether anybody had to watch it reconnect. */
    const stalled = s.statuses.filter((t) => /reconnect|would not play/i.test(t));
    ok(stalled.length === 0,
       `it did not have to reconnect to find out (saw: ${stalled.join(' / ') || 'nothing'})`);
  } finally {
    await tab.close();
    await browser.close();
  }
}

/* Following a link to a song a long way down the list.
   A permalink arrives with one row in the page and the whole playlist a
   moment later, so the row it named ends up wherever it sits — which for the
   last song is well below the fold of a list that scrolls. */
async function reveal({ songs }) {
  section('being sent to a song down the list');
  const browser = await Browser.launch('no-user-gesture-required');
  const tab = await browser.tab();
  try {
    const last = songs[songs.length - 1];
    await tab.go(last.path);
    const s = await until('the song, out of the whole playlist', async () => {
      const st = await tab.state();
      return st.playing && st.rows >= songs.length ? st : null;
    });
    if (!s) return;

    is(s.rowHref, last.path, 'the row the address named is the one playing');
    if (!ok(s.scroll && s.scroll.scrollable, 'the list is long enough to scroll')) return;
    ok(s.scroll.inView, `and the row is in view (list at ${s.scroll.top}, row at ${s.scroll.rowTop})`);
    ok(s.scroll.top > 0, 'which it could not be at the top of the list');

    // The first song is above the fold already, so nothing should move.
    const first = songs[0];
    await tab.go(first.path);
    const f = await until('the first song', async () => {
      const st = await tab.state();
      return st.playing && st.rowHref === first.path ? st : null;
    });
    if (f) {
      is(f.scroll.top, 0, 'a row already in view does not move the list');
      ok(f.scroll.inView, 'and is in view');
    }

    /* Pressing a row is a press on something already on screen, and a track
       ending into the next one must not move the list out from under whoever
       is reading further down it. */
    await tab.eval("document.getElementById('tracks').scrollTop = 0");
    await tab.eval("document.getElementById('next').click()");
    const stepped = await until('the transport to step on', async () => {
      const st = await tab.state();
      return st.rowHref && st.rowHref !== first.path ? st : null;
    });
    if (stepped) is(stepped.scroll.top, 0, 'stepping with the transport leaves the list alone');
  } finally {
    await tab.close();
    await browser.close();
  }
}

/* A song with no artist, which is what the lo-fi album is made of: the
   row is the title alone and the marquee joins the two only when there are
   two. Joined against a missing artist, both leave the separator hanging off
   the end — the row an empty line, the readout a dash and nothing. */
async function artistless({ songs }) {
  section('a song with no artist');
  const browser = await Browser.launch('no-user-gesture-required');
  const tab = await browser.tab();
  try {
    const song = songs.find((s) => !s.artist);
    if (!ok(song, 'the playlist has a song with no artist in it')) return;

    await tab.go(song.path);
    const s = await until('the song, out of the whole playlist', async () => {
      const st = await tab.state();
      return st.playing && st.rowHref === song.path ? st : null;
    });
    if (!s) return;

    is(s.row, song.title, 'the row names the song');
    is(s.marquee, song.title, 'the readout is the title alone, with no separator hanging off it');
    is(s.title, `${song.title} · Omarchy Radio`, 'and the tab names it the same way');

    const sub = await tab.eval(`(function () {
      var on = document.querySelector('#tracks li.is-on .tr-artist');
      return on ? on.textContent : null;
    })()`);
    is(sub, '', 'with nothing under the title');
  } finally {
    await tab.close();
    await browser.close();
  }
}

/* The repeat modes, which are what an item running out means. `all` is the
   default every section above leans on; this one pins the other two. Both are
   checked the way the rotation is — by dropping the needle near the end of the
   live element rather than by watching a clock — and reading what the deck did
   next off the page. */
async function repeatModes({ songs }) {
  section('the repeat modes');
  const browser = await Browser.launch('no-user-gesture-required');
  const tab = await browser.tab();
  try {
    const song = songs[1];
    await tab.go(song.path);
    let s = await until('the song to start', async () => {
      const st = await tab.state();
      return st.playing && st.at > 0 ? st : null;
    });
    if (!s) return;

    is(s.repeat.label, 'Repeat mode: all', 'the deck arrives repeating the cycle');
    is(s.repeat.pressed, 'true', 'and the button says the mode is on');
    ok(/, on repeat$/.test(s.note.trim()), `the note under the list says so (${s.note.trim()})`);

    // The needle, dropped near the end of whatever is playing.
    const toEnd = () => seekToEnd(tab);

    // ── one: a finished item plays again, from the top ──
    await tab.click('#repeat');
    s = await until('the mode to change', async () => {
      const st = await tab.state();
      return st.repeat && st.repeat.label === 'Repeat mode: one' ? st : null;
    });
    if (s) {
      is(s.status.trim(), 'repeat one', 'the change is written on the status line');
      ok(s.repeat.one, 'the button wears the repeat-one face');
      is(s.repeat.pressed, 'true', 'and says the mode is on');
      ok(/, repeating one$/.test(s.note.trim()), `and the note names the mode (${s.note.trim()})`);
      is(await tab.eval("localStorage.getItem('omarchy-radio-repeat')"), 'one',
         'the mode is kept for the next visit');

      const before = s.plays.length;
      if (ok(await until('the track to be runnable to its end', toEnd, 15000, 200),
             'the track can be run to its end')) {
        s = await until('the same file to start again', async () => {
          const st = await tab.state();
          return st.playing && st.at > 0 && st.at < 10 && st.plays.length > before ? st : null;
        }, 15000);
        if (s) {
          is(s.plays.length, before + 1, 'repeat one starts it over, once');
          ok(decodeURIComponent(s.src).includes(song.file), 'the same file, not the next one');
          ok(s.at < 10, `from the top of it, not from where it finished (${s.at.toFixed(2)}s in)`);
          is(s.row, song.title, 'and the deck goes on standing where it stood');
        }
      }
    }

    // ── off: the end of the order stops the deck, and the head is next ──
    await tab.click('#repeat');
    s = await until('the mode to change again', async () => {
      const st = await tab.state();
      return st.repeat && st.repeat.label === 'Repeat mode: off' ? st : null;
    });
    if (!s) return;
    is(s.status.trim(), 'repeat off', 'the status says which mode is on');
    is(s.repeat.pressed, 'false', 'and the button says the mode is off');
    ok(!/repeat/.test(s.note), `the note stops claiming one (${s.note.trim()})`);
    is(await tab.eval("localStorage.getItem('omarchy-radio-repeat')"), 'off', 'and the mode is kept');

    /* A reload is where the kept mode is read, and the last song is where the
       end of the order is. */
    const last = songs[songs.length - 1];
    await tab.go(last.path);
    s = await until('the last song, with the mode read back', async () => {
      const st = await tab.state();
      return st.playing && st.at > 0 && st.repeat.label === 'Repeat mode: off' ? st : null;
    });
    if (!s) return;
    is(s.repeat.label, 'Repeat mode: off', 'the kept mode is the one read at boot');

    const before = s.plays.length;
    if (ok(await until('the last track to be runnable to its end', toEnd, 15000, 200),
           'the last track can be run to its end')) {
      s = await until('the deck to stop at the end of the order', async () => {
        const st = await tab.state();
        return !st.playing && /has ended/.test(st.status) ? st : null;
      }, 15000);
      if (s) {
        is(s.status.trim(), 'the playlist has ended', 'the status line says the playlist has ended');
        is(s.plays.length, before, 'nothing else was played');
        is(s.row, songs[0].title, 'the deck stands at the head of the order');
        is(s.path, songs[0].path, 'and the address says where it stands');

        // Which is where the next play starts from.
        await tab.click('#toggle');
        s = await until('the first song to start', async () => {
          const st = await tab.state();
          return st.playing && st.plays.length > before ? st : null;
        }, 15000);
        if (s) ok(decodeURIComponent(s.src).includes(songs[0].file),
                  'the next play starts from the head of the order');
      }
    }

    // ── R does what the button does, and leaves a text field alone ──
    const pressR = (where) => tab.eval(`(function () {
      var t = ${where};
      t.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', code: 'KeyR', bubbles: true, cancelable: true }));
      return true;
    })()`);

    await tab.eval("document.getElementById('find').focus()");
    await pressR("document.getElementById('find')");
    is((await tab.state()).repeat.label, 'Repeat mode: off',
       'R does nothing while the find box has the cursor');
    await tab.eval("document.getElementById('find').blur()");
    await pressR('document.body');
    s = await until('R to cycle the mode', async () => {
      const st = await tab.state();
      return st.repeat.label === 'Repeat mode: all' ? st : null;
    });
    if (s) {
      is(s.status.trim(), 'repeat all', 'R cycles the mode from anywhere on the deck');
      ok(/, on repeat$/.test(s.note.trim()), 'and the note follows the mode');
    }
  } finally {
    await tab.close();
    await browser.close();
  }
}

/* The repeat button's faces, one per mode. `all` is the face the page lands
   in and the one the button wears until the deck says otherwise; `off` and
   `one` are the modes the deck flips a class for. So what is checked is which
   of the three faces the browser is showing, and that the pressing state and
   the accessible name belong to the same mode the face does. The icon probe
   is the icons section's, further down. */
async function repeatFaces() {
  section('the repeat button\'s three faces');
  const browser = await Browser.launch('no-user-gesture-required');
  const tab = await browser.tab();
  try {
    // The probe goes with the document it was installed in.
    const go = async (path) => { await tab.go(path); await tab.eval(ICON_PROBE); };
    const face = async () => (await tab.eval('window.__icon("#repeat")') || [])
      .filter((i) => i.shown);
    const wears = async (name) => {
      const f = await face();
      return f.length === 1 && has(f[0], name);
    };

    await go('/playlist');
    let s = await until('the deck to own the playlist', async () => {
      const st = await tab.state();
      return st.playing && st.at > 0 ? st : null;
    });
    if (!s) return;

    const faces = await tab.eval('window.__icon("#repeat")');
    is(faces.length, 3, 'the button carries a face for each of its three modes');
    ok(await wears('lucide-repeat'), 'the deck arrives in all, wearing the repeat face');

    // ── one: the face is the mode, not a colour ──
    await tab.click('#repeat');
    s = await until('the mode to become one', async () => {
      const st = await tab.state();
      return st.repeat.label === 'Repeat mode: one' ? st : null;
    });
    if (s) {
      ok(await wears('lucide-repeat-1'), 'one wears the repeat-1 face');
      is(s.repeat.pressed, 'true', 'and the button says the mode is on');
    }

    // ── off: the face says the cycle will not come round again ──
    await tab.click('#repeat');
    s = await until('the mode to become off', async () => {
      const st = await tab.state();
      return st.repeat.label === 'Repeat mode: off' ? st : null;
    });
    if (s) {
      ok(await wears('lucide-repeat-off'), 'off wears the repeat-off face');
      is(s.repeat.pressed, 'false', 'and the button says the mode is off');
    }

    /* A reload is where the kept mode is read: the face has to be the one the
       mode the deck comes up in belongs to, not the one the last press left
       behind. */
    await go('/playlist');
    s = await until('the kept mode to come back', async () => {
      const st = await tab.state();
      return st.repeat.label === 'Repeat mode: off' ? st : null;
    });
    if (s) ok(await wears('lucide-repeat-off'), 'a reload comes up on the off face');

    // ── R walks the ring the button walks, and the face follows it ──
    await tab.eval(`document.body.dispatchEvent(new KeyboardEvent('keydown',
      { key: 'r', code: 'KeyR', bubbles: true, cancelable: true }))`);
    s = await until('R to cycle the mode', async () => {
      const st = await tab.state();
      return st.repeat.label === 'Repeat mode: all' ? st : null;
    });
    if (s) ok(await wears('lucide-repeat'), 'R cycles to all, and the repeat face is back');
  } finally {
    await tab.close();
    await browser.close();
  }
}

/* The six controls read as two groups, and the two that hold a setting read
   as settings: shuffle and repeat in a strip of their own, 8px off the
   transport's, and "on" a fill — the accent ground and the accent's own ink —
   rather than a glyph that changed colour.

   Neither is in the markup, so this reads what the browser decided: the boxes,
   because a gap is only where two of them are, and the computed style,
   because a fill is what came out for a button that says it is pressed. Hover
   is driven through the pointer, the only thing that makes it true. The play
   button was filled before any of this, so it is checked for not having
   moved. */
const CONTROL_PROBE = `window.__css = function (name) {
  var d = document.createElement('div');
  d.style.color = 'var(' + name + ')';
  document.body.appendChild(d);
  var v = getComputedStyle(d).color;
  d.parentNode.removeChild(d);
  return v;
};
window.__box = function (sel) {
  var el = document.querySelector(sel);
  if (!el) return null;
  var r = el.getBoundingClientRect();
  var cs = getComputedStyle(el);
  return {
    left: r.left, right: r.right, top: r.top, bottom: r.bottom,
    w: r.width, h: r.height,
    /* The width the stylesheet asked for: a rect on this canvas comes back
       multiplied by the fit, a computed width does not. */
    cw: parseFloat(cs.width),
    bl: parseFloat(cs.borderLeftWidth), br: parseFloat(cs.borderRightWidth),
    bg: cs.backgroundColor, fg: cs.color, edge: cs.borderTopColor
  };
};`;

async function controlGroups() {
  section('the mode controls, in a strip of their own');
  const browser = await Browser.launch('no-user-gesture-required');
  const tab = await browser.tab();
  try {
    await tab.go('/playlist');
    const booted = await until('the deck to own the playlist', async () => {
      const st = await tab.state();
      return st.playing && st.at > 0 ? st : null;
    });
    if (!booted) return;
    await tab.eval(CONTROL_PROBE);

    /* Transport first, then the two that hold a setting: read in this order,
       the gaps between neighbours are the whole of the grouping. */
    const BUTTONS = ['#prev', '#toggle', '#stop', '#next', '#shuffle', '#repeat'];
    const box = (sel) => tab.eval(`window.__box(${JSON.stringify(sel)})`);
    const row = async () => {
      const out = {};
      for (const sel of BUTTONS) out[sel] = await box(sel);
      return out;
    };
    const vars = await tab.eval(`['--ac', '--acHi', '--acFg', '--bd']
      .reduce(function (o, n) { o[n] = window.__css(n); return o; }, {})`);
    // What an unfilled button's ground computes to.
    const CLEAR = 'rgba(0, 0, 0, 0)';
    const gap = (before, after, r) => Math.round(r[after].left - r[before].right);

    let b = await row();
    if (ok(BUTTONS.every((sel) => b[sel]), 'every button has a box')) {
      is(gap('#prev', '#toggle', b), -1, 'the transport buttons share their borders');
      is(gap('#toggle', '#stop', b), -1, 'stop stays with the transport');
      is(gap('#stop', '#next', b), -1, 'and the four are one strip');
      is(gap('#shuffle', '#repeat', b), -1, 'shuffle and repeat share a strip of their own');
      is(gap('#next', '#shuffle', b), 8, 'which stands 8px off the transport');
      is(b['#prev'].bl, 1, 'the transport is closed by its own border');
      is(b['#repeat'].br, 1, 'and the mode strip by its');
      ok(BUTTONS.every((sel) => Math.round(b[sel].top) === Math.round(b['#prev'].top)),
         'and all six buttons sit on one row');
      is(Math.round(b['#shuffle'].w), Math.round(b['#prev'].w),
         'a mode control is the width of a transport button');
      ok(BUTTONS.every((sel) => Math.round(b[sel].w) === Math.round(b['#prev'].w)),
         'and the six buttons are one width, the play button included');
    }

    /* The pointer, put on a control and taken off it again. What a hovered
       button paints is computed a frame after the move, so a check waits for
       the paint rather than reading it in the same tick. */
    const hover = (sel, on) => tab.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', button: 'none',
      x: Math.round(on ? (b[sel].left + b[sel].right) / 2 : 4),
      y: Math.round(on ? (b[sel].top + b[sel].bottom) / 2 : 4),
    });
    const settle = (sel, prop, want) => until(`${sel} to paint ${prop} ${want}`,
      async () => {
        const st = await box(sel);
        return st && st[prop] === want ? st : null;
      }, 2500);
    /* A press leaves the pointer on the button, and a button under the
       pointer paints its hover, so the pointer is taken off again before
       what the press left behind is read. */
    const press = async (sel) => { await tab.click(sel); await hover(sel, false); };

    /* ── off is the plain outline, and the pointer keeps the accent border ── */
    is(b['#shuffle'].bg, CLEAR, 'shuffle arrives as the plain outline');
    is(b['#shuffle'].edge, vars['--bd'], "with the deck's line for a border");
    await hover('#shuffle', true);
    is(((await settle('#shuffle', 'edge', vars['--ac'])) || {}).edge, vars['--ac'],
       'an outline control takes the accent border under the pointer');
    is((await box('#shuffle')).bg, CLEAR, 'and stays unfilled while it is off');
    await hover('#shuffle', false);

    /* ── on is a fill, which is how the play button already says it ── */
    await press('#shuffle');
    if (await until('shuffle to come on', async () =>
        (await tab.state()).shuffle.pressed === 'true' ? true : null)) {
      b = await row();
      is(b['#shuffle'].bg, vars['--ac'], 'shuffle on computes the accent ground, as play does');
      is(b['#shuffle'].fg, vars['--acFg'], "and its icon takes the accent's own ink");
      await hover('#shuffle', true);
      is(((await settle('#shuffle', 'bg', vars['--acHi'])) || {}).bg, vars['--acHi'],
         'a filled control takes the bright accent under the pointer');
      await hover('#shuffle', false);
      await press('#shuffle');
      if (await until('shuffle to go off', async () =>
          (await tab.state()).shuffle.pressed === 'false' ? true : null)) {
        is((await box('#shuffle')).bg, CLEAR, 'and off goes back to the plain outline');
      }
    }

    /* ── repeat lands in `all`: a mode that is on, so a button that is filled ── */
    b = await row();
    is(b['#repeat'].bg, vars['--ac'], 'repeat all is filled');
    is(b['#repeat'].fg, vars['--acFg'], 'with the accent ink on its face');
    await press('#repeat');
    if (await until('the mode to become one', async () =>
        (await tab.state()).repeat.label === 'Repeat mode: one' ? true : null)) {
      is((await box('#repeat')).bg, vars['--ac'], 'repeat one is on, so it is filled too');
      await hover('#repeat', true);
      is(((await settle('#repeat', 'bg', vars['--acHi'])) || {}).bg, vars['--acHi'],
         'and it takes the bright accent under the pointer, as shuffle does');
      await hover('#repeat', false);
    }
    await press('#repeat');
    if (await until('the mode to become off', async () =>
        (await tab.state()).repeat.label === 'Repeat mode: off' ? true : null)) {
      is((await box('#repeat')).bg, CLEAR, 'repeat off is the plain outline');
      await hover('#repeat', true);
      is(((await settle('#repeat', 'edge', vars['--ac'])) || {}).edge, vars['--ac'],
         'and under the pointer it keeps the accent border, not a fill');
      is((await box('#repeat')).bg, CLEAR, 'with nothing filled behind it');
      await hover('#repeat', false);
    }

    /* The play button is the one that was already filled, so what is checked
       is that the fill it has is still the fill it had — playing or paused. */
    b = await row();
    is(b['#toggle'].bg, vars['--ac'], 'the play button is filled while it plays');
    is(b['#toggle'].fg, vars['--acFg'], 'in the accent ink');
    await hover('#toggle', true);
    is(((await settle('#toggle', 'bg', vars['--acHi'])) || {}).bg, vars['--acHi'],
       'the play button takes the bright accent under the pointer, as it did');
    await hover('#toggle', false);
    await press('#toggle');
    if (await until('the deck to pause', async () =>
        (await tab.state()).playing === false ? true : null)) {
      is((await box('#toggle')).bg, vars['--ac'], 'and it looks the same paused as playing');
      is((await box('#toggle')).fg, vars['--acFg'], 'the ink is the accent ink in both of its states');
    }

    /* ── and on a narrow screen the two strips share the row ── */
    const wide = b;
    await tab.send('Emulation.setDeviceMetricsOverride',
                   { width: 800, height: 900, deviceScaleFactor: 1, mobile: false });
    const narrow = await until('the controls to lay out for a narrow screen', async () => {
      const st = await box('#prev');
      return st && Math.round(st.w) !== Math.round(wide['#prev'].w) ? st : null;
    });
    if (narrow) {
      const n = await row();
      ok(BUTTONS.every((sel) => Math.round(n[sel].top) === Math.round(n['#prev'].top)),
         'the two strips stay on one row');
      ok(BUTTONS.every((sel) => Math.round(n[sel].w) === Math.round(n['#prev'].w)),
         'and one width each, the play button included');
      is(gap('#next', '#shuffle', n), 8, 'and keep their 8px between them');
      const strip = await box('.tbtns');
      ok(Math.round(n['#prev'].left) === Math.round(strip.left) &&
         Math.round(n['#repeat'].right) === Math.round(strip.right),
         'the buttons fill the width, both strips of them');

      /* At 900px the rule still takes the pixel with it — `max-width: 900px` —
         so what is asserted here is the narrow layout at its own last pixel,
         which is why the wait below sees the buttons stretched and not the
         desktop 44px. One pixel up, the rule lets go, and that is the check
         that the edge is the rule's and not just a wider viewport. */
      await tab.send('Emulation.setDeviceMetricsOverride',
                     { width: 900, height: 900, deviceScaleFactor: 1, mobile: false });
      const edge = await until('the controls to lay out at 900px', async () => {
        const st = await box('#prev');
        return st && Math.round(st.w) > Math.round(narrow.w) ? st : null;
      });
      if (edge) {
        const e = await row();
        ok(BUTTONS.every((sel) => Math.round(e[sel].top) === Math.round(e['#prev'].top)),
           'at 900px, the narrow rule\'s own last pixel, the two strips are one row still');
        is(gap('#next', '#shuffle', e), 8, 'with the 8px seam held there too');
        ok(Math.round(e['#prev'].w) !== 44, 'and the strip still stretched, not the desktop width');
      }

      await tab.send('Emulation.setDeviceMetricsOverride',
                     { width: 901, height: 900, deviceScaleFactor: 1, mobile: false });
      const over = await until('the controls to lay out at 901px', async () => {
        const st = await box('#prev');
        return st && Math.round(st.cw) === 44 ? st : null;
      });
      if (over) {
        const o = await row();
        /* A rect on the scaled canvas comes back multiplied by the fit, the
           computed width does not; the ratio is what puts the seam back in
           the units the stylesheet drew it in. */
        const scale = over.w / over.cw;
        ok(BUTTONS.every((sel) => Math.round(o[sel].cw) === 44),
           'at 901px the rule lets go: every button is back to the desktop 44px');
        is(Math.round(gap('#next', '#shuffle', o) / scale), 8, 'and the two strips keep their 8px');
        ok(BUTTONS.every((sel) => Math.round(o[sel].top) === Math.round(o['#prev'].top)),
           'on one row');
      }
    }
    await tab.send('Emulation.clearDeviceMetricsOverride');
  } finally {
    await tab.close();
    await browser.close();
  }
}

/* Shuffle is the order the deck walks, and an order is only visible by
   walking it: the section turns it on mid-list, then reads the lit row off
   the page for every step of the rest of the cycle. What it checks is the
   property a permutation has — every row once before any row twice, the
   rows already passed left behind, a new cycle opening somewhere other than
   where the last one ended — and that the setting is the kind that survives
   a reload while a permalink still beats it. */
async function shuffleOrder({ songs }) {
  section('shuffling the play order');
  const browser = await Browser.launch('no-user-gesture-required');
  const tab = await browser.tab();
  try {
    const song = songs[1];
    await tab.go(song.path);
    let s = await until('the song to start, out of the whole playlist', async () => {
      const st = await tab.state();
      return st.playing && st.at > 0 && st.rows >= songs.length ? st : null;
    });
    if (!s) return;

    is(s.shuffle.pressed, 'false', 'the deck arrives walking the list\'s own order');
    ok(!/shuffled/.test(s.note), `and the note does not claim otherwise (${s.note.trim()})`);

    // The list's own order, which is what turning it on departs from.
    await tab.click('#next');
    s = await until('the list\'s own next row', async () => {
      const st = await tab.state();
      return st.rowHref !== song.path ? st : null;
    });
    if (!s) return;
    is(s.rowHref, songs[2].path, 'shuffle off, next is the row after this one');
    await tab.click('#prev');
    if (!await until('the row it was on', async () => {
      const st = await tab.state();
      return st.rowHref === song.path ? st : null;
    })) return;

    // ── on: the order is drawn again, and the item playing keeps playing ──
    await tab.click('#shuffle');
    s = await until('shuffle on', async () => {
      const st = await tab.state();
      return st.shuffle && st.shuffle.pressed === 'true' ? st : null;
    });
    if (!s) return;
    /* Through the history rather than the line itself: a press here follows
       a load, and `buffering…` can land on top of the change a moment after
       it is written. */
    ok(s.statuses.includes('shuffle on'), 'the change is written on the status line');
    ok(/, shuffled/.test(s.note.trim()), `the note says the order is shuffled (${s.note.trim()})`);
    is(await tab.eval("localStorage.getItem('omarchy-radio-shuffle')"), 'on', 'the setting is kept for the next visit');
    is(s.rowHref, song.path, 'and the item playing keeps playing');
    is(s.path, song.path, 'turning it on is not an address');

    /* The walk. The cycle already had the rows behind the deck, so what is
       left is every row but those two — and pressing next once per row is
       the only way to see an order from the page. */
    const visited = [];
    for (let i = 0; i < songs.length - 2; i++) {
      const was = visited.length ? visited[visited.length - 1] : song.path;
      await tab.click('#next');
      const st = await until('a row the cycle had left', async () => {
        const now = await tab.state();
        return now.rowHref && now.rowHref !== was ? now : null;
      });
      if (!st) return;
      visited.push(st.rowHref);
    }
    const uniq = new Set(visited);
    is(uniq.size, visited.length, `the cycle walks its ${visited.length} rows without repeating one`);
    ok(songs.slice(2).every((r) => uniq.has(r.path)), 'and it is every row the cycle had left, each once');
    ok(!uniq.has(song.path) && !uniq.has(songs[0].path),
       'neither the item playing nor the rows already passed come back before the cycle is out');

    // Back means back: prev retreats along the order, not the list.
    await tab.click('#prev');
    s = await until('prev along the order', async () => {
      const st = await tab.state();
      return st.rowHref !== visited[visited.length - 1] ? st : null;
    });
    if (s) is(s.rowHref, visited[visited.length - 2], 'prev retreats along the shuffled order');

    // ── off the end of the cycle: a new one, opened on another row ──
    const last = visited[visited.length - 1];
    await tab.click('#next'); // back onto the row the cycle ended on
    if (!await until('the last row again', async () => {
      const st = await tab.state();
      return st.rowHref === last ? st : null;
    })) return;
    await tab.click('#next');
    const head = await until('a new cycle, opened on another row', async () => {
      const st = await tab.state();
      return st.rowHref && st.rowHref !== last ? st.rowHref : null;
    });
    if (head) ok(true, `the cycle after it opens elsewhere (${head}, after ${last})`);

    /* ── a row pressed out of turn: it becomes where the deck stands ──
       The address is what this one is read off, and the walk above has just
       spent a couple of hundred address writes in a few seconds: a browser
       stops honouring same-document history updates in a burst like that
       (measured: about 200, then dropped until the page settles), which
       would leave the press with nothing to move. So the deck is given a
       page the walk has not spent — the row it is standing on, with shuffle
       still on from the store — and the press below lands on a fresh
       document's own budget. */
    const standing = await tab.state();
    await tab.go(standing.rowHref);
    await until('the deck on the row it was standing on', async () => {
      const st = await tab.state();
      return st.playing && st.rowHref === standing.rowHref ? st : null;
    });

    const pick = songs[10].path === standing.rowHref ? songs[11] : songs[10];
    await tab.click(`a.track[href="${pick.path}"]`);
    s = await until('the pressed row', async () => {
      const st = await tab.state();
      return st.rowHref === pick.path ? st : null;
    });
    if (!s) return;
    is(s.path, pick.path, 'a row pressed while shuffled becomes the current position');
    await tab.click('#next');
    ok(await until('the row after the pressed one', async () => {
      const st = await tab.state();
      return st.rowHref && st.rowHref !== pick.path ? st : null;
    }), 'next walks the rebuilt order on from the pressed row');
    await tab.click('#prev');
    ok(await until('the pressed row again', async () => {
      const st = await tab.state();
      return st.rowHref === pick.path ? st : null;
    }), 'and prev steps back onto it, not the list\'s own previous row');

    // ── off: the list's own order again, taken up where the deck stands ──
    await tab.click('#shuffle');
    s = await until('shuffle off', async () => {
      const st = await tab.state();
      return st.shuffle && st.shuffle.pressed === 'false' ? st : null;
    });
    if (!s) return;
    ok(s.statuses.includes('shuffle off'), 'the status says which way it is');
    ok(!/shuffled/.test(s.note), `and the note stops claiming it (${s.note.trim()})`);
    is(await tab.eval("localStorage.getItem('omarchy-radio-shuffle')"), 'off', 'and the setting is kept');
    is(s.rowHref, pick.path, 'the item playing still keeps playing');
    await tab.click('#next');
    s = await until('the list\'s own next again', async () => {
      const st = await tab.state();
      return st.rowHref !== pick.path ? st : null;
    });
    if (s) is(s.rowHref, songs[11].path, 'shuffle off, next is the list\'s own next row again');

    // ── on again, and a permalink followed while shuffled ──
    await tab.click('#shuffle');
    if (!await until('shuffle on again', async () => {
      const st = await tab.state();
      return st.shuffle && st.shuffle.pressed === 'true' ? st : null;
    })) return;
    const named = songs[4];
    await tab.go(named.path);
    s = await until('the permalink to play what it names', async () => {
      const st = await tab.state();
      return st.playing && st.at > 0 ? st : null;
    });
    if (!s) return;
    is(s.row, named.title, 'a permalink followed with shuffle on plays the item it names');
    ok(decodeURIComponent(s.src).includes(named.file), 'and it is that file playing');
    is(s.shuffle.pressed, 'true', 'while the setting comes back with the page');
    ok(/, shuffled/.test(s.note.trim()), `and the note says so (${s.note.trim()})`);

    await tab.send('Page.reload');
    s = await until('the deck after the reload', async () => {
      const st = await tab.state();
      return st.playing && st.at > 0 ? st : null;
    });
    if (s) {
      is(s.row, named.title, 'a reload keeps playing the item the address names');
      is(s.shuffle.pressed, 'true', 'and keeps the order shuffled');
      is(await tab.eval("localStorage.getItem('omarchy-radio-shuffle')"), 'on',
         'which is the state read back at boot');
    }

    // ── S does what the button does, and leaves a text field alone ──
    const pressS = (where) => tab.eval(`(function () {
      var t = ${where};
      t.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', bubbles: true, cancelable: true }));
      return true;
    })()`);

    await tab.eval("document.getElementById('find').focus()");
    await pressS("document.getElementById('find')");
    is((await tab.state()).shuffle.pressed, 'true',
       'S does nothing while the find box has the cursor');
    await tab.eval("document.getElementById('find').blur()");
    await pressS('document.body');
    s = await until('S to turn it off', async () => {
      const st = await tab.state();
      return st.shuffle && st.shuffle.pressed === 'false' ? st : null;
    });
    if (s) {
      ok(s.statuses.includes('shuffle off'), 'S toggles the order from anywhere on the deck');
      ok(!/shuffled/.test(s.note.trim()), 'and the note follows it');
    }
  } finally {
    await tab.close();
    await browser.close();
  }
}

/* The desktop's own theme, as omarchy-theme-sync publishes it: the palette
   goes onto <html> as --omarchy-* properties, which is the extension's whole
   contract with a page. This writes them the way it would. */
const ETHEREAL = { background: '#060b1e', bright_foreground: '#ffcead', accent: '#7d82d9', selection: '#252e56' };
const GRUVBOX = { background: '#282828', bright_foreground: '#d4be98', accent: '#7daea3', selection: '#504945' };

async function desktopTheme() {
  section('wearing the desktop theme');
  const browser = await Browser.launch('no-user-gesture-required');
  const tab = await browser.tab();
  try {
    await tab.go('/');
    // The menu is the deck's, so waiting for it is waiting for the deck. Rows
    // are in the page before that and say nothing about whether it has run.
    let s = await until('the deck to build the theme menu', async () => {
      const st = await tab.state();
      return st.skins.length ? st : null;
    });
    if (!s) return;

    // Without the extension there is no such theme, and the list is the list.
    is(s.skins.length, 24, 'no extension, no desktop theme');
    is(s.skins[0], 'green', 'and the list is the list');

    const publish = async (palette, name) => {
      await tab.eval(`(function () {
        var r = document.documentElement;
        ${Object.entries(palette).map(([k, v]) =>
          `r.style.setProperty('--omarchy-${k.replace(/_/g, '-')}', '${v}');`).join('\n        ')}
        r.dataset.omarchyTheme = ${JSON.stringify(name)};
        document.dispatchEvent(new Event('omarchythemechange'));
      })()`);
      return tab.eval(`(function () {
        var r = getComputedStyle(document.documentElement);
        return { bg: r.getPropertyValue('--bg').trim(), fg: r.getPropertyValue('--fg').trim(),
                 ac: r.getPropertyValue('--ac').trim(), bd: r.getPropertyValue('--bd').trim(),
                 skin: (document.getElementById('skinName') || {}).textContent,
                 first: (document.querySelector('#themeMenu li') || {}).dataset.skin,
                 count: document.querySelectorAll('#themeMenu li').length,
                 meta: (document.querySelector('meta[name=theme-color]') || {}).content };
      })()`);
    };

    let d = await publish(ETHEREAL, 'ethereal');
    is(d.count, 25, 'the palette lands and the deck gains a theme');
    is(d.first, 'desktop', 'first in the list, because it is the one you are wearing');
    is(d.skin, 'desktop · ethereal', 'and the picker names the theme the desktop is on');
    is(d.bg, ETHEREAL.background, 'the ground is the desktop background');
    is(d.fg, ETHEREAL.bright_foreground, 'the ink is its bright foreground');
    is(d.ac, ETHEREAL.accent, 'the accent is its accent');
    is(d.bd, ETHEREAL.selection, 'the line is its selection');
    is(d.meta, ETHEREAL.background, 'and the browser chrome follows the ground');

    // Switching the desktop theme repaints without a reload, which is the point.
    d = await publish(GRUVBOX, 'gruvbox');
    is(d.skin, 'desktop · gruvbox', 'a desktop theme change is followed');
    is(d.bg, GRUVBOX.background, 'and repaints without a reload');
    is(d.ac, GRUVBOX.accent, 'accent too');

    // Picking one of the twenty-four pins it against the desktop.
    await tab.eval(`Array.prototype.find.call(
      document.querySelectorAll('#themeMenu li'),
      function (li) { return li.dataset.skin === 'nord'; }).querySelector('button').click()`);
    d = await publish(ETHEREAL, 'ethereal');
    is(d.skin, 'nord', 'a theme picked by hand is not overruled by the desktop');
    ok(d.bg !== ETHEREAL.background, 'and keeps its own ground');

    // ...and survives a reload, still against a palette that is right there.
    await tab.go('/');
    await until('the deck again', async () => (await tab.state()).rows || null);
    d = await publish(ETHEREAL, 'ethereal');
    is(d.skin, 'nord', 'and is still pinned on the next visit');

    /* The deck writes the theme it painted on every paint, so a returning
       listener always has one stored whether they ever picked it or not.
       That is not a choice, and the desktop's own theme outranks it. */
    await tab.eval(`(function () {
      localStorage.removeItem('omarchy-radio-skin-pinned');
      localStorage.setItem('omarchy-radio-skin', 'nord');
    })()`);
    await tab.go('/');
    await until('the deck once more', async () => (await tab.state()).skins.length || null);
    d = await publish(ETHEREAL, 'ethereal');
    is(d.skin, 'desktop · ethereal',
       'a theme the deck merely stored is not a choice, and the desktop wins');
    is(d.bg, ETHEREAL.background, 'and the ground is the desktop ground');

    // Picking "desktop" is how you go back to following the machine.
    await tab.eval(`(function () {
      localStorage.setItem('omarchy-radio-skin-pinned', 'nord');
    })()`);
    await tab.go('/');
    await until('the deck a last time', async () => (await tab.state()).skins.length || null);
    d = await publish(ETHEREAL, 'ethereal');
    is(d.skin, 'nord', 'pinned again');
    await tab.eval(`Array.prototype.find.call(
      document.querySelectorAll('#themeMenu li'),
      function (li) { return li.dataset.skin === 'desktop'; }).querySelector('button').click()`);
    d = await publish(GRUVBOX, 'gruvbox');
    is(d.skin, 'desktop · gruvbox', 'and picking desktop follows the machine again');
  } finally {
    await tab.close();
    await browser.close();
  }
}

async function autoplayAllowed({ songs, eps }) {
  section('with autoplay allowed, the way a browser treats a site somebody uses');
  const browser = await Browser.launch('no-user-gesture-required');
  const tab = await browser.tab();
  try {
    // ── a song's own page plays that song, and only that song ──
    const wanted = songs[1];
    const song = wanted.path;
    await tab.go(song);
    /* Playing *and* holding the whole playlist. Two things that arrive on
       their own schedules — the seeded row plays on the first tick, the
       manifest lands a moment later — and this section asserts about both,
       so it has to wait for both. Against a local server the second is
       instant and the race is never lost; over the wire the list turns up
       around 140ms in and the poll is every 100, which is close enough to
       lose it about half the time. That is the fourth time this file has
       waited for one thing and asserted about another. */
    let s = await until('the song to start, out of the whole playlist', async () => {
      const st = await tab.state();
      return st.playing && st.at > 0 && st.rows >= songs.length ? st : null;
    });
    if (s) {
      is(s.path, song, 'the address stays put');
      is(s.plays.length, 1, 'one play call, for the one song asked for');
      ok(s.src.endsWith('.mp3'), `the source is a track: ${s.src}`);
      ok(decodeURIComponent(s.src).includes(wanted.file), `it is the right file: ${decodeURIComponent(s.src)}`);
      ok(s.at > 0, `the audio is actually moving (${s.at.toFixed(2)}s in)`);
      is(s.refused.length, 0, 'nothing was refused');
      is(s.row, wanted.title, 'the row for it is the one lit');
      /* The row's cell is painted by the deck's own `playing` event, a moment
         after the element starts: waiting for the element is not waiting for
         the paint, so this waits for the row. */
      const lit = await until('the row to say playing', async () => {
        const st = await tab.state();
        return st.state === 'playing' ? st : null;
      });
      ok(lit, `the row says playing (it said "${s.state}")`);
      ok(s.title.includes(wanted.title), `the tab is named after it: ${s.title}`);
      ok(s.marquee.includes(wanted.title), `the deck reads it out: ${s.marquee}`);
      is(s.canonical, `https://radio.omarchy.org${song}`, 'the canonical link');
      is(s.tab, 'tabSongs', 'the songs tab is the current one');
      ok(s.rows >= songs.length, `the whole playlist arrived (${s.rows} rows)`);
    }

    // ── pressing a row routes without reloading ──
    const other = songs[5];
    const otherPath = other.path;
    await tab.click(`a.track[href="${otherPath}"]`);
    s = await until('the second song', async () => {
      const st = await tab.state();
      return st.path === otherPath && st.playing ? st : null;
    });
    if (s) {
      is(s.path, otherPath, 'the address follows the press');
      is(s.sentinel, 1, 'the page did not reload');
      is(s.plays.length, 2, 'the second song is the second play call');
      ok(decodeURIComponent(s.src).includes(other.file), 'the audio swapped to it');
      is(s.row, other.title, 'and the lit row moved with it');
    }

    // ── back walks the two of them ──
    await tab.eval('history.back()');
    s = await until('the first song again', async () => {
      const st = await tab.state();
      return st.path === song ? st : null;
    });
    if (s) {
      is(s.path, song, 'back returns to the song it came from');
      is(s.sentinel, 1, 'back did not reload the page either');
      is(s.row, wanted.title, 'and it is the one playing');
    }
    await tab.eval('history.forward()');
    s = await until('the second song again', async () => {
      const st = await tab.state();
      return st.path === otherPath ? st : null;
    });
    if (s) is(s.row, other.title, 'forward goes back to the other one');

    // ── the tabs are links to the two lists ──
    await tab.click('#tabPodcast');
    s = await until('the podcast list', async () => {
      const st = await tab.state();
      return st.path === '/podcast' ? st : null;
    });
    if (s) {
      is(s.path, '/podcast', 'the podcast tab is a link to /podcast');
      is(s.tab, 'tabPodcast', 'and it is the current one');
      is(s.sentinel, 1, 'without a reload');
      ok(s.note.includes('episode'), `the note counts episodes: ${s.note.trim()}`);
    }
    await tab.click('#tabSongs');
    s = await until('the songs list', async () => {
      const st = await tab.state();
      return st.tab === 'tabSongs' ? st : null;
    });
    if (s) {
      is(s.tab, 'tabSongs', 'and back to the songs');
      // The song never stopped, and with its list on screen again the
      // address is its own page rather than the list it sits in.
      is(s.path, otherPath, 'the address names the song still playing');
      is(s.sentinel, 1, 'still no reload');
    }

    // ── the front page plays the playlist without taking the address ──
    await tab.go('/');
    s = await until('the playlist to start by itself', async () => {
      const st = await tab.state();
      return st.playing && st.at > 0 ? st : null;
    });
    if (s) {
      is(s.path, '/', 'the front page stays the front page');
      is(s.canonical, 'https://radio.omarchy.org/', 'and goes on saying so');
      ok(decodeURIComponent(s.src).includes(songs[0].file),
         'the playlist starts itself, from the top');
      is(s.row, songs[0].title, 'and the row it is on is lit');
      is(s.title, 'Omarchy Radio', 'the tab stays the front page, not a song nobody picked');
      ok(!/live|stream/i.test(s.status), `nothing about a stream: "${s.status.trim()}"`);
    }

    // ── the end of the last one is the start of the first ──
    const last = songs[songs.length - 1];
    await tab.go(last.path);
    await until('the last song', async () => (await tab.state()).playing);

    // Pressing next on the last one is the wrap on its own terms.
    await tab.click('#next');
    s = await until('the first song, from the transport', async () => {
      const st = await tab.state();
      return st.row === songs[0].title ? st : null;
    });
    if (s) is(s.row, songs[0].title, 'next on the last track wraps to the first');

    // And so is running off the end of it, which is what a rotation is.
    // The server answers byte ranges, so the needle can just be dropped.
    await tab.go(last.path);
    await until('the last song again', async () => (await tab.state()).playing);
    const seeked = await until('the last song to be seekable', () => seekToEnd(tab), 15000, 200);
    if (ok(seeked, 'the last track can be run to its end')) {
      s = await until('the first song to come round', async () => {
        const st = await tab.state();
        return st.row === songs[0].title ? st : null;
      }, 15000);
      if (s) {
        is(s.row, songs[0].title, 'the end of the last track is the start of the first');
        ok(decodeURIComponent(s.src).includes(songs[0].file), 'and it is that file playing');
        is(s.path, songs[0].path, 'the address follows, this one having been named');
      }
    }

    // ── an episode's own page loads that episode ──
    if (eps.length) {
      await tab.go(eps[0].path);
      s = await until('the episode to be asked for', async () => {
        const st = await tab.state();
        return st.plays.length ? st : null;
      });
      if (s) {
        is(s.path, eps[0].path, 'the address stays put');
        const asked = s.plays[s.plays.length - 1];
        ok(/^https?:/.test(asked) && !/\/tracks\//.test(asked),
           `the audio asked for is the show's host, not a track: ${asked.slice(0, 60)}…`);
        is(s.tab, 'tabPodcast', 'the podcast tab is the current one');
        ok(s.row.length > 0, `the episode row is lit: ${s.row}`);
      }
    }

    // ── the links from before the paths ──
    await tab.go('/#still-licensed');
    s = await until('the old link to resolve', async () => {
      const st = await tab.state();
      return st.path === '/playlist/still-licensed' ? st : null;
    });
    if (s) {
      is(s.path, '/playlist/still-licensed', 'a bare fragment is now a path');
      is(s.hash, '', 'and the fragment is gone');
      is(s.row, 'Still Licensed', 'playing the song it named');
    }

    if (eps.length) {
      const epSlug = eps[0].slug;
      await tab.go('/#stories/' + epSlug);
      s = await until('the old episode link to resolve', async () => {
        const st = await tab.state();
        return st.path === '/podcast/' + epSlug ? st : null;
      });
      if (s) is(s.path, '/podcast/' + epSlug, '#stories/<episode> is now /podcast/<episode>');
    }

    // ── the spellings a link gets typed in, and what a reload does ──
    await tab.go(song + '/');
    s = await until('the trailing slash to be tidied', async () => {
      const st = await tab.state();
      return st.path === song ? st : null;
    });
    if (s) {
      is(s.path, song, 'a trailing slash resolves to the address without one');
      ok(s.playing || s.plays.length > 0, 'and the song still plays');
    }

    await tab.go(song);
    await until('the song before the reload', async () => (await tab.state()).playing);
    await tab.send('Page.reload');
    s = await until('the song after the reload', async () => {
      const st = await tab.state();
      return st.playing && st.at > 0 ? st : null;
    });
    if (s) {
      is(s.path, song, 'a reload of a permalink stays on it');
      is(s.plays.length, 1, 'and starts the one song, once');
      is(s.sentinel, 0, 'the reload really was one');
    }

    // ── a slug that names nothing ──
    await tab.go('/playlist/no-such-song-at-all');
    s = await until('the fallback to the playlist', async () => {
      const st = await tab.state();
      return st.path === '/' && st.playing ? st : null;
    });
    if (s) {
      is(s.path, '/', 'a slug that names nothing lands on the front');
      ok(decodeURIComponent(s.src).includes(songs[0].file),
         'and the playlist starts from the top');
    }

    // ── the transport does not build a history to climb out of ──
    await tab.go(song);
    await until('the song again', async () => (await tab.state()).playing);
    const before = (await tab.state()).entries;
    await tab.click('#next');
    s = await until('the next song', async () => {
      const st = await tab.state();
      return st.path !== song ? st : null;
    });
    if (s) {
      ok(s.path.startsWith('/playlist/'), `next moves the address too: ${s.path}`);
      is(s.entries, before, 'without adding a history entry');
    }

    // ── the # beside a row is the link, and pressing it copies ──
    const at = (await tab.state()).path;
    await tab.click(`a.tr-link[href="${song}"]`);
    s = await until('the copy', async () => {
      const st = await tab.state();
      return st.copied.length ? st : null;
    });
    if (s) {
      is(s.copied[0], BASE + song, 'the # puts the whole address on the clipboard');
      is(s.path, at, 'and pressing it does not navigate anywhere');
      /* The status line is the media element's to write as well, so what is
         checked is that the deck said so, not that it is still saying it a
         moment later. */
      ok(s.statuses.includes('link copied'),
         `the deck says so (said: ${s.statuses.join(' / ')})`);
    }

    // ── /playlist and /podcast are pages of their own ──
    for (const [path, tabId] of [['/playlist', 'tabSongs'], ['/podcast', 'tabPodcast']]) {
      await tab.go(path);
      s = await until(`${path} to settle`, async () => {
        const st = await tab.state();
        return st.plays.length ? st : null;
      });
      if (s) {
        is(s.path, path, `${path} stays as it was opened`);
        is(s.tab, tabId, `${path} opens on the right list`);
        ok(decodeURIComponent(s.plays[0]).includes(songs[0].file),
           `${path} plays the playlist from the top while you read it`);
        is(s.canonical, 'https://radio.omarchy.org' + path, `${path} says what it is`);
      }
    }
  } finally {
    await tab.close();
    await browser.close();
  }
}

async function autoplayRefused({ songs }) {
  section('with autoplay refused, the way a browser treats a first visit');
  const browser = await Browser.launch('user-gesture-required');
  const tab = await browser.tab();
  try {
    const wanted = songs[1];
    await tab.go(wanted.path);

    /* No browser grants an audible autoplay here, and every one of them
       allows a muted one. So the deck plays: no press, no asking. */
    let s = await until('the deck to play without being pressed', async () => {
      const st = await tab.state();
      return st.playing && st.at > 0 ? st : null;
    });
    if (!s) return;

    is(s.muted, true, 'it is playing, and it is muted, having been refused the sound');
    ok(s.refused.includes('NotAllowedError'), 'the refusal is the one it acted on');
    /* The deck writes which kind of playing in its own `playing` event, a
       moment after the element starts, so this waits for the word rather
       than reading a status the element may still be writing. */
    const quiet = await until('the deck to say it is playing muted', async () => {
      const st = await tab.state();
      return st.statuses.some((t) => /muted/.test(t)) ? st : null;
    });
    ok(quiet, `and the status says which kind of playing (said: ${(quiet || s).statuses.join(' / ')})`);
    ok(decodeURIComponent(s.src).includes(wanted.file), 'it is the song the link named');
    is(s.path, wanted.path, 'the address still names it');
    is(s.row, wanted.title, 'and its row is the one lit');

    // A press anywhere that is not itself a control: this is what buys sound.
    const wasAt = s.at;
    await tab.click('.lcd');
    s = await until('the sound to come on', async () => {
      const st = await tab.state();
      return st.playing && st.muted === false ? st : null;
    });
    if (s) {
      is(s.muted, false, 'a press anywhere turns the sound on');
      /* Same again: the element is still writing the status as the sound
         comes on, so the claim is that the deck stopped qualifying it. */
      ok(s.statuses.includes('playing'), 'and the status stops qualifying it');
      ok(s.at >= wasAt, `it carries on from where it was, not from the top (${wasAt} -> ${s.at})`);
      ok(decodeURIComponent(s.src).includes(wanted.file), 'still the same song');
      is(s.path, wanted.path, 'and the address is unchanged');
    }
  } finally {
    await tab.close();
    await browser.close();
  }
}

/* The service worker stands in front of every navigation, so a broken one
   is a broken site. It is installed here the way a second visit installs it,
   and then the network is taken away: a page never opened before has to come
   back as the shell, and the shell has to route to the same place. */
async function offline({ songs }) {
  section('with the service worker in front, and then with no network at all');
  const browser = await Browser.launch('no-user-gesture-required');
  const tab = await browser.tab();
  try {
    await tab.go('/');
    /* The worker's own file is named from the site's base, so a build made
       under another base 404s it here and no registration is ever installed —
       and `navigator.serviceWorker.ready` never settles without one, so
       awaiting it is what used to take the whole run down with it instead of
       failing this one check. The reload is what a second visit does. */
    const ready = await until('the service worker to take over', async () => {
      return tab.eval('!!navigator.serviceWorker.controller || (location.reload(), false)');
    }, 15000, 500);
    if (!ok(ready, 'the service worker is registered and controlling the page')) return;

    // A song page, through the worker.
    const first = songs[2];
    await tab.go(first.path);
    let s = await until('the song, served through the worker', async () => {
      const st = await tab.state();
      return st.playing && st.at > 0 ? st : null;
    });
    if (s) {
      is(s.path, first.path, 'the worker does not get in the way of a permalink');
      ok(decodeURIComponent(s.src).includes(first.file), 'and the right song plays');
    }

    // Now take the network away and ask for a page never opened.
    await tab.send('Network.enable');
    await tab.send('Network.emulateNetworkConditions', {
      offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
    });
    const unseen = songs[songs.length - 1];
    await tab.send('Page.navigate', { url: BASE + unseen.path });
    s = await until('the deck to open offline', async () => {
      const st = await tab.eval('window.__state ? window.__state() : null');
      return st && st.rows ? st : null;
    }, 15000);
    if (s) {
      is(s.path, unseen.path, 'the address survives being answered by the shell');
      is(s.row, unseen.title, 'and the deck routes to the song that was asked for');
      /* A row on screen is not yet evidence that the deck read a list: every
         page arrives with rows already in it — the shell with all of them, a
         permalink with the one it is for — and which of the two the worker
         answers with depends on what it had cached. The list is what is under
         test here, and it comes out of the cache a moment after the paint, so
         this waits for it rather than reading the prerendered row and calling
         it a miss. */
      const full = await until('the playlist to arrive from the cache', async () => {
        const st = await tab.eval('window.__state ? window.__state() : null');
        return st && st.rows > 1 ? st : null;
      }, 10000);
      if (full) ok(full.rows > 1, `the playlist came out of the cache (${full.rows} rows)`);
    }
    await tab.send('Network.emulateNetworkConditions', {
      offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    });
  } finally {
    await tab.close();
    await browser.close();
  }
}

/* The icons, in the page and from Lucide.
 *
 * What this replaces drew cells: axis-aligned rects at one to one CSS pixel,
 * with shape-rendering="crispEdges" to hold the steps on the grid. So the
 * question is not whether there is an svg — there always was — but that every
 * icon is a stroked Lucide drawing at the size its context calls for, that no
 * lattice is left under any of them, and that the caret on an episode's row
 * is markup the build rendered rather than something the deck drew.
 */
const ICON_PROBE = `window.__icon = function (sel) {
  var el = document.querySelector(sel);
  if (!el) return null;
  return Array.prototype.map.call(el.querySelectorAll('svg'), function (s) {
    var box = s.getBoundingClientRect();
    var rect = s.querySelector('rect');
    return {
      cls: s.getAttribute('class') || '',
      w: Math.round(box.width),
      h: Math.round(box.height),
      shown: box.width > 0 && box.height > 0,
      fill: s.getAttribute('fill') || '',
      stroke: s.getAttribute('stroke') || '',
      crisp: s.hasAttribute('shape-rendering'),
      drawn: s.querySelectorAll('path, circle, ellipse, line, polyline, polygon, rect').length,
      rounded: !!(rect && (rect.getAttribute('rx') || rect.getAttribute('ry'))),
      uses: s.querySelectorAll('use').length
    };
  });
};
window.__icons = function () {
  return Array.prototype.map.call(document.querySelectorAll('svg.i'), function (s) {
    return {
      cls: s.getAttribute('class') || '',
      crisp: s.hasAttribute('shape-rendering'),
      uses: s.querySelectorAll('use').length
    };
  });
};`;

const has = (icon, name) => icon.cls.split(' ').includes(name);

async function icons({ songs, eps }) {
  section('the icons, from Lucide');
  const browser = await Browser.launch('no-user-gesture-required');
  const tab = await browser.tab();
  try {
    // The probe goes with the document it was installed in, so every
    // navigation in this section has to put it back.
    const go = async (path) => { await tab.go(path); await tab.eval(ICON_PROBE); };
    await go('/playlist');

    // One control's faces: the two-state buttons carry both in the page, so
    // every check here is about the one the browser is showing.
    const face = async (sel) => (await tab.eval(`window.__icon(${JSON.stringify(sel)})`) || [])
      .filter((i) => i.shown);
    const size = (i) => `${i.w}x${i.h}`;

    /* The deck plays on arrival, and paints the button it does that with in
       the same pass as the row state — so this waits for the deck, not for
       the browser's audio, which starts a paint earlier. */
    const s = await until('the deck to own the playlist', async () => {
      const st = await tab.state();
      if (!(st.playing && st.rows >= songs.length)) return null;
      const t = await face('#toggle');
      return t.length === 1 && has(t[0], 'lucide-pause') ? st : null;
    });
    if (!s) return;

    /* The six buttons. One size across them, so no button weighs more than
       another; the play button is filled and shows its pause face, because
       the deck has been playing since it booted. */
    for (const [sel, name] of [['#prev', 'lucide-rewind'], ['#toggle', 'lucide-pause'],
                               ['#stop', 'lucide-square'], ['#next', 'lucide-fast-forward'],
                               ['#shuffle', 'lucide-shuffle'], ['#repeat', 'lucide-repeat']]) {
      const shown = await face(sel);
      if (!ok(shown.length === 1, `${sel} shows one icon, not ${shown.length}`)) continue;
      const i = shown[0];
      ok(has(i, name), `${sel} is ${name}, not ${i.cls.split(' ').join(' ')}`);
      is(size(i), '14x14', `${sel}'s icon is 14px on the button`);
      ok(i.fill === 'none' && i.stroke === 'currentColor',
         `${sel}'s icon is a stroke in the button's colour (fill ${i.fill}, stroke ${i.stroke})`);
      ok(!i.crisp && i.drawn > 0, `${sel}'s icon is drawn, not a lattice cell`);
      is(i.uses, 0, `${sel}'s icon is inline, not a reference to a sprite`);
    }

    /* And the inline set: the two list glyphs, the caret on the theme menu,
       the arrow that says a link leaves the site. */
    for (const [sel, name] of [['#tabSongs', 'lucide-music-2'], ['#tabPodcast', 'lucide-mic'],
                               ['#themeCaret', 'lucide-chevron-down'], ['.home', 'lucide-arrow-up-right']]) {
      const shown = await face(sel);
      if (!ok(shown.length === 1, `${sel} shows one icon, not ${shown.length}`)) continue;
      const i = shown[0];
      ok(has(i, name), `${sel} is ${name}, not ${i.cls.split(' ').join(' ')}`);
      is(size(i), '12x12', `${sel}'s icon is the inline size`);
    }

    /* Stop is Lucide's square, and its corner is round: the one shape that
       would still pass for a lattice cell if the answer were "rects". */
    const stop = (await face('#stop'))[0];
    if (stop) ok(stop.drawn === 1 && stop.rounded,
                 'stop is one rounded rect, which is a Lucide drawing and not a cell');

    /* The one icon the deck used to draw for itself: an episode's row caret.
       It is markup the build rendered (#rowCaret), copied into the row, and
       the row's class says which of its two faces shows. A page for an
       episode opens that episode's panel, so the first press closes it. */
    await go(eps[0].path);
    const ep = await until('the episode to open', async () => {
      const st = await tab.state();
      if (st.row !== eps[0].title) return null;
      const f = await face('.tr-c');
      return f.length === 1 && has(f[0], 'lucide-chevron-down') ? st : null;
    });
    ok(ep, 'an open episode row points down, at the panel it opened');
    if (ep) {
      const faces = await tab.eval('window.__icon(".tr-c")');
      is(faces.length, 2, 'both caret faces are in the row, and the row picks one');
      is(size((await face('.tr-c'))[0]), '12x12', 'the row caret is the inline size');
      await tab.click('#tracks li.is-on a.track');
      const closed = await until('the row to close', async () => {
        const f = await face('.tr-c');
        return f.length === 1 && has(f[0], 'lucide-chevron-right') ? f : null;
      });
      ok(closed, 'pressing the row flips the caret to the face that points sideways');
    }

    // The same icons on a page that names nothing: there is one deck.
    await go('/');
    const front = await until('the front page to play', async () => {
      const f = await face('#toggle');
      return f.length === 1 && has(f[0], 'lucide-pause') ? f : null;
    });
    ok(front, 'the front page ships the same transport');
    const all = await tab.eval('window.__icons()');
    ok(all.length > 0 && all.every((i) => has(i, 'lucide') && !i.crisp && !i.uses),
       `every icon on the page is a Lucide drawing (${all.length} of them)`);
  } finally {
    await tab.close();
    await browser.close();
  }
}

/* ── go ──────────────────────────────────────────────────────────────── */
const server = serve();
let code = 1;
try {
  await until('the server', async () => {
    try { return (await fetch(BASE + '/')).ok; } catch { return false; }
  }, 15000);
  const site = await routes();
  console.log(`${site.songs.length} songs, ${site.eps.length} episodes`);
  await autoplayAllowed(site);
  await repeatModes(site);
  await repeatFaces();
  await controlGroups();
  await shuffleOrder(site);
  await autoplayRefused(site);
  await find(site);
  await panelHeadOnAPhone();
  await albumsAtTheirAddresses(site);
  await albumsPlay(site);
  await reveal(site);
  await artistless(site);
  await stalePlaylist(site);
  await desktopTheme();
  await icons(site);
  await offline(site);
  console.log(`  ${passed - mark} checks`);
  console.log(`\n${passed} checks passed`);
  if (failures.length) {
    console.log(`${failures.length} FAILED:`);
    for (const f of failures) console.log(`  - ${f}`);
  } else {
    code = 0;
    console.log('all passed');
  }
} catch (e) {
  console.log(`\nthe run itself broke: ${e.stack || e.message}`);
} finally {
  server.kill('SIGKILL');
}
process.exit(code);
