/* The files the site is built from.
 *
 * Imported rather than read off disk, so the build has no opinion about where
 * it was run from, and `astro dev` rewrites the pages the moment a song is
 * added or the feed is mirrored in — both are dependencies of the build, not
 * something it happens to look at.
 *
 * The albums' lists are found the same way, by the bundler: public/tracks/
 * <album>/playlist.json, for every directory there is. The index says which
 * albums exist, and lists.ts holds the two facts to each other, so an album
 * declared with no list — or a directory nobody declared — stops the build
 * rather than playing nothing.
 *
 * The parsing is in src/lib/lists.ts, which reads no files at all.
 */

import index from '../../public/tracks/albums.json' with { type: 'json' };
import feedXml from '../../public/stories/feed.rss?raw';
import {
  parseAlbums, parseEpisodes,
  type Album, type AlbumDir, type Manifest,
} from './lists.ts';
import type { Item, Show } from './item.ts';

/* Every album's list, in the one place the bundler can enumerate them: a
   directory holds one or it does not, and a glob over the audio itself would
   put a second copy of every MP3 in the build (measured: 159 MB into
   dist/_astro), so the build sees the lists and the route test, reading the
   directories off disk, sees everything a directory can hold. */
const lists = import.meta.glob<Manifest>('../../public/tracks/*/playlist.json', {
  eager: true,
  import: 'default',
});

/** The album directories the bundler can see, each with its own list. */
function albumDirs(): AlbumDir[] {
  const dirs: AlbumDir[] = [];
  for (const [path, list] of Object.entries(lists)) {
    const m = /tracks\/([^/]+)\/playlist\.json$/.exec(path);
    if (m) dirs.push({ slug: m[1], list });
  }
  return dirs;
}

/** Every song, in the order the playlist plays them: the albums in the order
    the index lists them, each album's songs in their own order. */
export function readTracks(): Item[] {
  return parseAlbums(index, albumDirs());
}

/** The albums, in the order the index declares them: what the deck offers to
    play one at a time, and where each of them answers. */
export function readAlbums(): Album[] {
  return index.albums ?? [];
}

/** The show, and every episode it has published, newest first. */
export function readEpisodes(): Show {
  return parseEpisodes(feedXml);
}
