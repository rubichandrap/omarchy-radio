/* The two lists, out of the files behind them.
 *
 * A song is three lines of an album's own list, public/tracks/<album>/
 * playlist.json, and a file beside it. An episode is an item in the show's
 * feed, mirrored into public/stories/feed.rss. Both come out of here as an
 * Item, which is the shape the deck holds them in too.
 *
 * Text in, items out, and nothing here reads a file: src/lib/sources.ts is
 * the half that does, and tools/test-routes.mjs reads the same files off
 * disk. That is what lets the same rule — the index and the directories
 * agree, in both directions — run in the build and in the route test.
 */

import { XMLParser } from 'fast-xml-parser';
import { assignSlugs, type Kind } from './slug.ts';
import type { Item, Show } from './item.ts';
import { hms } from './format.ts';
import { SHOW, SHOW_HOME, TRACKS_DIR } from './site.ts';

/** One album's list, public/tracks/<album>/playlist.json, as a contributor
    writes it. Its `file` names the MP3 in that same directory. */
export interface Manifest {
  tracks?: Partial<Item>[];
}

/** One album, as public/tracks/albums.json declares it. */
export interface Album {
  slug: string;
  name: string;
}

/** The index: every album, in the order they are listed. */
export interface AlbumIndex {
  albums?: Album[];
}

/** One album's directory, as the build or the route test found it: the slug it
    is named by, and its own list if there is one in it. A directory holding
    songs and no list arrives here too, which is how that gets refused. */
export interface AlbumDir {
  slug: string;
  list?: Manifest;
}

/** A song before it has been given an address; assignSlugs() adds kind, slug
    and key once the whole playlist is known. */
export type TrackEntry = Omit<Item, 'kind' | 'slug' | 'key'>;

export function parseTracks(data: Manifest, album: string): TrackEntry[] {
  return (data.tracks ?? [])
    .filter((t): t is Partial<Item> & { title: string } => Boolean(t.title))
    .map((t) => ({
      ...t,
      artist: t.artist ?? '',
      /* Which album the song is in: its directory, and the segment its audio
         address carries. */
      album,
      /* Contributors name the file and nothing else, the way the deck's own
         resolveTrack() takes it. Encoded here so nobody has to hand-escape a
         space or an accent in the manifest, and so the same address survives
         being written into an attribute and asked for over HTTP. */
      url: t.url || TRACKS_DIR + album + '/' + encodeURIComponent(t.file ?? ''),
    }));
}

/** Every song, out of the index and the albums' own directories.
 *
 * The directories arrive as they were found — the build finds them through
 * the bundler, the route test off disk — and the two facts have to agree: an
 * album the index declares with no list is one that plays nothing,
 * a directory holding songs or a list that nobody declared is one that never
 * plays at all. Either one is an error rather than a playlist quietly
 * missing an album.
 *
 * One flat list, the albums in index order and each album's songs in its own
 * order, with the slugs assigned once over the lot — so a song's key and its
 * permalink do not depend on which album it is in.
 */
export function parseAlbums(index: AlbumIndex, dirs: AlbumDir[]): Item[] {
  const albums = index.albums ?? [];
  checkAlbumSlugs(albums);
  const flat: TrackEntry[] = [];

  for (const album of albums) {
    const dir = dirs.find((d) => d.slug === album.slug);
    if (!dir) {
      throw new Error(
        `public/tracks/albums.json declares the album "${album.slug}", but ` +
        `public/tracks/${album.slug}/ is not there.`,
      );
    }
    if (!dir.list) {
      throw new Error(
        `public/tracks/albums.json declares the album "${album.slug}", but ` +
        `public/tracks/${album.slug}/playlist.json is not there.`,
      );
    }
    flat.push(...parseTracks(dir.list, album.slug));
  }

  for (const { slug } of dirs) {
    if (!albums.some((a) => a.slug === slug)) {
      throw new Error(
        `public/tracks/${slug}/ holds songs or a list, and ` +
        'public/tracks/albums.json does not declare it. Add it to the index, ' +
        'or take the directory out.',
      );
    }
  }

  return assignSlugs(flat, 'playlist');
}

/* Nothing but what a page needs: the deck reads the same feed a moment after
   it loads and fills in the chapters and the notes itself. */
export function parseEpisodes(xml: string): Show {
  if (!xml) return { name: SHOW, home: SHOW_HOME, episodes: [] };

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    // A title of "2024" is a title, not a number, and a slug built from a
    // number that lost its zeroes is a different address.
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
  });

  /* The shape of a parsed feed is the feed's business, not ours: it is
     whatever the show's host chose to write, and a tag can arrive as a
     string, a number, an object or not at all. Every read below goes through
     text(), which is where that is coped with — so this is deliberately
     untyped rather than a type that would be a guess. */
  let channel: Loose | undefined;
  try {
    channel = (parser.parse(xml) as Loose | undefined)?.rss?.channel;
  } catch {
    return { name: SHOW, home: SHOW_HOME, episodes: [] };
  }
  if (!channel) return { name: SHOW, home: SHOW_HOME, episodes: [] };

  const name = text(channel.title) || SHOW;
  const home = text(channel.link) || SHOW_HOME;

  /* One <item> parses to an object rather than a list of one. */
  const items: Loose[] = Array.isArray(channel.item)
    ? channel.item
    : channel.item
      ? [channel.item]
      : [];

  const episodes = items
    .map((item) => {
      const url = item.enclosure?.['@url'] ?? '';
      const title = text(item.title) || text(item['itunes:title']);
      if (!title || !url) return null;
      const ms = Date.parse(text(item.pubDate)) || 0;
      return {
        title,
        // The show stands where the artist does, in the deck and here.
        artist: name,
        url,
        ms,
        date: ms ? new Date(ms).toISOString().slice(0, 10) : '',
        secs: hms(text(item['itunes:duration'])),
        explicit: /^(yes|true)$/i.test(text(item['itunes:explicit'])),
        summary: plainText(text(item.description) || text(item['itunes:summary'])),
        provisional: true,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    // Newest first, the way a show is read.
    .sort((a, b) => b.ms - a.ms);

  return { name, home, episodes: assignSlugs(episodes, 'podcast') };
}

type Loose = Record<string, any>;

/** fast-xml-parser hands back a string, a number, or {} for an empty tag. */
function text(node: unknown): string {
  if (typeof node === 'string') return node.trim();
  if (typeof node === 'number') return String(node);
  if (node && typeof node === 'object' && '#text' in node) {
    return String((node as Record<string, unknown>)['#text'] ?? '').trim();
  }
  return '';
}

/** The show writes its notes as markup. This is the sentence out of them. */
export function plainText(markup: string): string {
  if (!markup) return '';
  let s = markup
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])[^>]*>/gi, ' \n')
    .replace(/<[^>]+>/g, ' ');
  s = unescapeEntities(s);
  const lines: string[] = [];
  for (const raw of s.split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim();
    // A timestamp is a chapter, not a description of the episode.
    if (!line || /^(?:\d+:)?\d{1,2}:\d{2}\s/.test(line)) continue;
    if (/^(chapters|timestamps|chapter markers)[:.]?$/i.test(line)) continue;
    lines.push(line);
  }
  // Lifting the markup out leaves a gap where a tag sat mid-sentence, and
  // "Omarchy Stories , I'm joined by" is not a sentence anybody wrote.
  return lines.join(' ').trim().replace(/\s+([,.;:!?])/g, '$1');
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
};

function unescapeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return isFinite(code) && code > 0 ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[body.toLowerCase()] ?? all;
  });
}

/** Trimmed to fit a card, on a word. */
export function clip(text: string, limit = 190): string {
  const s = (text ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= limit) return s;
  return s.slice(0, limit).replace(/\s+\S*$/, '').replace(/[ ,;:.—-]+$/, '') + '…';
}

/** The item, as the deck wants it: enough to play and to draw a row.
 *
 * Baked into the page ahead of the deck, so a link that names a song can
 * start it on the first tick — before the manifest, before the feed, while
 * the press that opened the link still counts as engagement. */
export function seedOf(item: Item): Record<string, unknown> {
  const keep = ['title', 'artist', 'file', 'album', 'url', 'explicit',
                'lyrics', 'ms', 'secs', 'provisional'] as const;
  const seed: Record<string, unknown> = {};
  for (const k of keep) {
    if (item[k] !== undefined && item[k] !== null) seed[k] = item[k];
  }
  seed.kind = item.kind;
  seed.slug = item.slug;
  // The deck's resolveTrack() builds the url from the file, the way it does
  // for every other track, so the two cannot drift apart.
  if (item.kind === 'playlist') delete seed.url;
  return seed;
}

/* /playlist/index and /podcast/index are the addresses of the lists
   themselves — written twice, as <kind>.html and <kind>/index.html — so a
   song that slugged to "index" would have its page quietly overwrite one of
   them. The pages that generate the items check this and fail the build. */
export function isReservedSlug(key: string): boolean {
  return KINDS.some((k) => key === `${k}/index`);
}

const KINDS: Kind[] = ['playlist', 'podcast'];

/* What already answers at the site root, and what an album's slug may not be.
 *
 * An album lives at its own address at the root, beside the two lists, so a
 * slug that is already a page there would take a page that belongs to
 * something else: an album called `playlist` would answer /playlist with the
 * community's album, and one called `index` would be written over the front
 * page. `all` is the one word in this list that is not an address at all —
 * it is what the selector offers for every song, and an album by that name
 * would be a second `all` in the same row of links.
 *
 * The check runs inside parseAlbums(), so both the build and the route test
 * refuse the same slugs, and the message says which one it is. */
const ROOT_OWNS: Record<string, string> = {
  playlist: 'the list of every song answers there',
  podcast: 'the list of episodes answers there',
  all: 'the selector offers it for every song',
  index: 'the front page is written there',
  '404': 'the page for everything that is not there is written there',
  assets: 'the fonts and the images the pages are drawn with are served from there',
  stories: 'the mirrored feed is served from there',
  tracks: 'the songs themselves are served from there',
  _astro: 'the built deck and its stylesheet are served from there',
  'sitemap.xml': 'the addresses for the crawlers are listed there',
  'robots.txt': 'what the crawlers are told is served there',
  'sw.js': 'the service worker is served there',
  'site.webmanifest': 'what the site tells a browser it is is served there',
  'favicon.ico': 'the icon in the tab is served there',
};

export function checkAlbumSlugs(albums: Album[]): void {
  for (const album of albums) {
    /* The slug is the address, and the address is a path the build writes a
       page at: anything but the shape an address is (lower case, words joined
       by hyphens) is a file somewhere nobody asked for. */
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(album.slug)) {
      throw new Error(
        `public/tracks/albums.json declares the album "${album.slug}", which is not ` +
        'the shape an address is: lower case, words joined by hyphens, nothing but ' +
        'a-z, 0-9 and -. The slug is where the album answers, so it has to be one.',
      );
    }
    const clash = ROOT_OWNS[album.slug];
    if (!clash) continue;
    throw new Error(
      `public/tracks/albums.json declares the album "${album.slug}", but /${album.slug} ` +
      `at the site root is not the album's to take: ${clash}. An album answers at its ` +
      'own address there, so its slug has to be a word nothing else at the root is ' +
      'named by. Rename the album, or take its page out of the root.',
    );
  }
}
