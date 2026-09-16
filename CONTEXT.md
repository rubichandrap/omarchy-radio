# Omarchy Radio

A web radio deck for the Omarchy community. There is no live stream: the
playlist is the station, and the deck plays it in the browser, starting itself
on arrival.

## Language

**The deck**:
The player as a whole — the page, its transport, its two lists, and the audio
element it drives.
_Avoid_: player, app, site

**List**:
One of the two things the deck can play: the playlist, or the episodes.
Exactly one of them is playing; the other may still be on screen. The playlist
can be narrowed to one album without becoming a list of its own.
_Avoid_: queue, feed

**Album**:
A named group of songs inside the playlist — the community's own, or a
collection from elsewhere. A song belongs to exactly one album, and playing an
album plays all of it. An album answers at an address of its own at the site
root, beside the two lists; a song keeps its `/playlist/<song>` address
wherever it is in the playlist.
_Avoid_: collection, category, folder, library

**Playlist**:
Every song the deck can play, across every album. The show's episodes are not
a playlist.
_Avoid_: station, queue

**Episode**:
One part of the show, read from the mirrored feed and listed newest first.
Episodes are numbered from the oldest, so episode 01 stays episode 01 as the
show grows.
_Avoid_: podcast (the show is the podcast; an episode is one part of it)

**Play order**:
The sequence the deck walks when it advances by itself: the list's own order
when shuffle is off, a permutation of the list when shuffle is on. The list is
whatever is playing — one album, or the whole playlist. It is not what is on
screen, and not what a shared link names.
_Avoid_: queue (a queue is the listener's own picks, a feature of its own)

**Shuffle**:
A play order that is a permutation of the list. Every item plays once per
cycle; a new cycle reshuffles.
_Avoid_: random mode

**Cycle**:
One full pass through the play order, from its first item to its last.

**Repeat mode**:
What the deck does when an item ends. `all` starts the cycle again, `one`
plays the same item again, `off` stops at the end of the cycle. `all` is the
default, which is what the station's "on repeat" claim means.
_Avoid_: loop mode

**Transport**:
The four buttons that drive playback: previous, play/pause, stop, next.
_Avoid_: controls, player buttons

**Mode controls**:
Shuffle and repeat — the two buttons that hold a setting rather than make a
press.
_Avoid_: toggles, options
