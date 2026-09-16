# An album narrows the songs list; it is not a third list

The deck has two lists — the songs and the show's episodes — swapped by the
seg over the panel. A second collection of songs arriving raised the question
of where it lives: a third tab, or something else.

It is a scope over the songs list. The panel gains an album picker over the
songs — a row of its own under the panel head, because it grows with the index
while the head already holds the seg — and the seg goes on answering which of
the two lists is showing. Playing an album replaces the play order with that
album's songs; `all` is the whole playlist, which is what the unscoped list
always was.

The reason is that a song from Open Lo-Fi and a song from the community are
the same kind of thing — an MP3, an entry in a manifest, the same row, the
same permalink — while an episode is not: it comes from a feed, it has a date
and a length, and it has no artist. A third list would have duplicated the
manifest, the routes and the tab machinery to produce rows the deck already
knows how to draw.

Considered: a third tab beside songs and podcast (duplicates the machines, and
makes "play all" a list that exists only to be everything); a per-track album
label with a separate registry of album names (two facts that must agree, and
a typo drops a song out of its album silently).

Consequences: the playlist is now the union of its albums, so the play order
and the numbering run over whichever list is playing rather than over every
song; the find box filters the album on screen; and a new collection is a
directory and a line in the index, not a new kind of list.
