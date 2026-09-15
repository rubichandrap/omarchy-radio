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
One of the two collections the deck can play: the playlist, or the episodes.
Exactly one of them is playing; the other may still be on screen.
_Avoid_: queue, feed

**Playlist**:
The songs list, taken from the upstream station and the community track
library. The show's episodes are not a playlist.
_Avoid_: station, queue

**Episode**:
One part of the show, read from the mirrored feed and listed newest first.
Episodes are numbered from the oldest, so episode 01 stays episode 01 as the
show grows.
_Avoid_: podcast (the show is the podcast; an episode is one part of it)

**Play order**:
The sequence the deck walks when it advances by itself: the list's own order
when shuffle is off, a permutation of the list when shuffle is on. It is not
what is on screen, and not what a shared link names.
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
