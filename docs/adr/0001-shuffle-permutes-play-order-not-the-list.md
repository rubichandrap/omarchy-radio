# Shuffle permutes the play order, not the list

Shuffle had to go somewhere. The deck could have reordered the list on screen,
which is what most players do, but here the list is also the index: rows carry
the number of their position, every row is a permalink to a page the build
writes for that item, and the list's own order is what those pages are built
from. So shuffle builds a **play order** — a permutation of the list — and the
list on screen keeps its own order: numbers, permalinks and the build stay
still, and only what advances changes.

Consequences: a listener who wants to see the shuffled order does not get one;
the row marked playing moves down a list that does not. Shuffle and repeat are
state of the deck rather than parts of the address, so they are not shareable,
in keeping with the address already meaning a list or a named item and nothing
else.
