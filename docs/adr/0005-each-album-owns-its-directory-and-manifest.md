# Each album owns its directory and its manifest

Adding Open Lo-Fi puts 166 entries and some 390 MB of audio into a repository
whose contribution path is one file: `public/tracks/playlist.json`.

The manifest is split by album. `public/tracks/albums.json` holds the albums —
slug, name, and the order they are listed in — and nothing else; each album's
songs are listed in `public/tracks/<album>/playlist.json`, beside its audio,
where a track's `file` names the MP3 in that same directory. The build reads
the directories; the deck fetches the index and then every album in parallel,
merges them into the flat list it already holds, and caches the merged result
where it used to cache the single file.

The reason is the shape of a contribution: one file of 199 entries is where
two people's changes collide, and a directory is the unit that contains a
collection's own weight — the lofi audio is one thing to look at, move, or
decide about.

Considered: one nested manifest, every album inline (a single fetch, but every
contribution edits the same file); a flat list of tracks carrying an album
label plus a separate registry of album names (two facts that must agree, and
one typo drops a song out of its album without an error); audio left flat with
only the lists in directories (a tracks folder of 199 MP3s).

Consequences: the index and the directories are two facts that must agree, so
the route test checks both directions — every declared album has a list, and
every album directory is declared — and the parse refuses the index's own
sourness beside it: an album declared whose list names no songs, and a slug
declared twice. In the browser, losing one album's fetch
fails the whole load rather than serving half a playlist: the deck keeps the
copy from the last visit and tries again on the next one.
