/* The rows a page arrives with, and the line under them.
 *
 * A list page carries every row; the page behind a permalink carries the one
 * it is for, keeping the number it has in its album. The deck rebuilds
 * both a moment later out of the manifest and the feed, so what is written
 * here has to be what paintTracks() would have written.
 */

import { dateLabel, lengthLabel, plural } from './format.ts';
import { BASE, STATION } from './site.ts';
import type { Item, Show } from './item.ts';
import type { Kind } from './slug.ts';

export interface Row {
  item: Item;
  number: number;
  sub: string;
  on: boolean;
}

/* Songs are numbered by their place in their own album: the albums arrive one
   after another, so the count starts again at each one's first song, and a
   song wears the same number wherever it is shown — on the album's page, in
   the whole playlist, and on its own page.

   Episodes are numbered from the far end, because the newest is at the top
   and episode 01 is episode 01.

   A permalink page passes the whole list and is handed back one row: the
   number a row wears is its place in the album it was numbered over, not in
   what the page shows, so the numbering has to happen before the narrowing. */
export function rowsFor(list: Item[], kind: Kind, only: Item | null = null): Row[] {
  const numbers = kind === 'playlist' ? songNumbers(list) : [];
  return list
    .map((item, i) => ({
      item,
      number: kind === 'podcast' ? list.length - i : numbers[i]!,
      /* An episode has no artist to name under the title: it has a date and a
         length, which are the two things worth knowing before pressing it. */
      sub: kind === 'podcast'
        ? [dateLabel(item.ms ?? 0), lengthLabel(item.secs ?? 0)].filter(Boolean).join(' · ')
        : item.artist || '',
      on: item === only,
    }))
    .filter((row) => !only || row.on);
}

/** The number every song in this list wears: its place in its own album. The
    deck numbers its rows by this too, so a song cannot read one number on one
    page and another on the next. */
export function songNumbers(items: Item[]): number[] {
  const out: number[] = [];
  let album = '';
  let n = 0;
  for (const item of items) {
    if (item.album !== album) {
      album = item.album ?? '';
      n = 0;
    }
    out.push(++n);
  }
  return out;
}

/** The heading over the list: what kind of list, and whose. While an album is
    the one on screen, the album is whose. */
export function panelTitle(kind: Kind, show: Show, album = ''): { kind: string; name: string } {
  return kind === 'podcast'
    ? { kind: 'episodes', name: show.name.toLowerCase() }
    : { kind: 'playlist', name: album ? album.toLowerCase() : STATION.name.toLowerCase() };
}

/** The line under the list, as HTML: it carries a link on a permalink page. */
export function noteFor(kind: Kind, list: Item[], only: Item | null, show: Show): string {
  if (kind === 'podcast') return episodeNote(list, show, only);
  return songNote(list, only);
}

function songNote(tracks: Item[], only: Item | null): string {
  if (!tracks.length) return 'nothing in the playlist yet';
  const count = `${plural(tracks.length, 'track')}, on repeat`;
  if (!only) return count;
  if (tracks.length === 1) return `<a href="${BASE}/playlist">${count}</a>`;
  return `one of <a href="${BASE}/playlist">${count}</a>`;
}

/* The show is not ours, so the note says whose it is and where it lives — the
   one place on the deck that leads to the podcast itself. */
function episodeNote(eps: Item[], show: Show, only: Item | null): string {
  let count = eps.length ? plural(eps.length, 'episode') : 'reading the feed…';
  if (only && eps.length) {
    const many = eps.length > 1 ? 'one of ' : '';
    count = `${many}<a href="${BASE}/podcast">${plural(eps.length, 'episode')}</a>`;
  }
  const label = show.home.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return `${count} &middot; <a href="${escapeAttr(show.home)}" target="_blank" rel="noopener">${escapeText(label)}</a>`;
}

/* This is the one place the build writes markup by hand rather than handing it
   to Astro, because the note is one sentence with a link in the middle of it.
   The show's own title and address go through here, so they are escaped. */
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}
