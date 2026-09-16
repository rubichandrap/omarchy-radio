# Tracks

The playlist for Omarchy Radio, and the whole of what the deck plays. It is
kept as albums: each album is a directory here holding its own list of songs,
`playlist.json`, beside its own audio. Every track is served straight from the
repo, so adding one is a pull request.

`albums.json` declares the albums, in the order they are listed. An album's
`playlist.json` is the order its songs play in, from the top, round again at
the end.

## Add a track

1. Drop your MP3 in the album's directory, named `artist-title.mp3` — or
   `title.mp3` for a song with no artist. Lower case, words joined by hyphens,
   nothing in it but `a-z`, `0-9` and `-`.
2. Add an entry to that album's `playlist.json`.
3. Open a pull request.

```json
{
  "title": "Play the Machine",
  "artist": "Dan T.",
  "file": "dan-t-play-the-machine.mp3"
}
```

That is the whole entry. There is no id to invent and no count to bump. The
song's own page — `radio.omarchy.org/playlist/<title>` — is written for you
when the pull request lands, along with its card and its sitemap entry.

## Albums

The community's songs are the `omarchy` album. The `lofi` album is the
[Open Lo-Fi](../../README.md) release — songs from somewhere else, none of them
with an artist. The folders look like this:

```
tracks/
  albums.json         the albums, in the order they are listed
  omarchy/
    playlist.json     the community's songs, in the order they play
    dan-t-play-the-machine.mp3
  lofi/
    playlist.json     the album's tracks, in the order they play
    2-am-debug-loop.mp3
```

An album is a directory and a line. To add one, make the directory, write its
`playlist.json`, and add `{ "slug": "...", "name": "..." }` to `albums.json`
where you want it in the list — `slug` is the directory's name and `name` is
the album's. Nothing else declares it; its `playlist.json` also joins the
shell's precache list in `public/sw.js` (one line, and its `VERSION` moves with
it), or a cold offline visit has no rows for it, and the route suite holds the
two together. The index and the directories are held to each other: a directory
holding songs or a list that no line declares, a line with no `playlist.json`
behind it, a line with no directory at all, a list that names no songs, or a
slug declared twice, each is refused rather than playing nothing.

The slug is also where the album answers: `radio.omarchy.org/<slug>`, beside
`/playlist`, with the album's rows and its own selector link. So it is lower
case, words joined by hyphens, and it cannot be a word the site root already
owns — `playlist`, `podcast`, `tracks`, `index` and the rest; the build
refuses either and names what it clashed with.

## Fields

| field | required | notes |
| --- | --- | --- |
| `title` | yes | shown in the playlist and the marquee |
| `artist` | no | shown under the title; leave it out and the row is the title alone |
| `file` | yes | filename in the album's directory, exactly as on disk |
| `url` | no | full URL for a track hosted elsewhere, used instead of `file` |
| `explicit` | no | `true` shows an EXPLICIT badge beside the title |
| `lyrics` | no | filename of the sheet in `lyrics/`, or `false` for none |

If the lyrics are explicit, set `explicit` and put `[EXPLICIT]` in the pull
request title. The badge comes from the field, not from the filename.

## Why the filename is a slug

`file` is a filename and also an address: the deck serves it from
`radio.omarchy.org/tracks/<album>/<file>`. A name with a space, an accent or an
apostrophe in it works — the player encodes it, and it did for a long time —
but it arrives as
`/tracks/omarchy/Aur%C3%A9lien%20-%20Omarchee%2C%20c'est%20la%20vie.mp3`, which
is not a thing anybody can read, type, or paste into `mpv` without care.

So the file gets the same treatment an address gets. `artist-title.mp3`,
through the same rule in [`src/lib/slug.ts`](../../src/lib/slug.ts) that turns
a title into `/playlist/<song>`: accents stripped, apostrophes dropped,
anything else that is not a letter or a digit becoming a hyphen.

The title and the artist in `playlist.json` are what anybody actually reads,
and those keep their punctuation, their accents and their capitals. The
filename is plumbing.

## Lyrics

Optional, and only you can send them: they are your words, so nobody else
gets to put them on the site for you.

Drop a file in `lyrics/` named after the MP3 — `artist-title.lrc` for
`artist-title.mp3` — and the player finds it on its own. No manifest change
is needed unless the sheet is named something else, in which case name it in
the `lyrics` field.

Plain text is fine, one line per line:

```
Woke up to a merge conflict
Coffee going cold on the desk
```

Add timestamps and the player follows along, lighting each line as it comes.
The format is `[mm:ss.cc]`, and a line can carry more than one stamp if it
comes round again:

```
[00:12.40]Woke up to a merge conflict
[00:16.10]Coffee going cold on the desk
[01:04.00][02:18.00]This is the chorus, twice
```

A `lyrics` button appears on the playlist panel whenever a track is playing.
Without a sheet it says so and points here.

## What to send

- MP3, 320 kbps or lower. Keep it under 10 MB.
- Your own creation, and set in the Omarchy universe. The [README](../../README.md)
  covers what that means.
- Order in that album's `playlist.json` is the order in the player. New tracks
  go wherever fits, the list is roughly alphabetical by artist.

## Check it before you push

Serve the repo root and open the player:

```bash
python3 -m http.server 8000
```

Your track should appear in the playlist panel and play when clicked. If it
does not, the usual cause is `file` not matching the filename on disk.

To see the page behind its permalink, write the pages first and serve them the
way the host does:

```bash
npm run build                     # write the page for every song
npm test                          # build, then check every address answers with its page
```

Neither is required of a pull request: a workflow runs them when it lands.
