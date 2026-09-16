# Lucide draws the icons, not the lattice

The transport, the two mode buttons, the carets and the two list glyphs were
cells on a lattice — `src/lib/icons.ts`, axis-aligned rects at one cell to one
CSS pixel — kept for the reason the icon section of DESIGN.md gives: the same
material the wordmark, the field and the meter are made of. The material held;
the reading did not. A stepped triangle at 12×10 px is a blob at button
distance, and every control that comes next is a drawing exercise.

The icons come from [Lucide](https://lucide.dev) now, through `@lucide/astro`,
which sits beside the other build dependencies in `package.json`. One package,
one source: the build renders the icons into the page, and the deck no longer
draws any icon of its own — the one it still needs at runtime, the caret on an
episode's row, is the markup the build already rendered. Readability and
visibility are the point.

Considered: enlarging the lattice (keeps the material, does not fix the
reading, and every icon is still hand-drawn); vendoring Lucide's path data
into a local table (a second copy of what the package already ships); the
package for the build and a local table for the runtime caret (two sources
drift).

Consequences: the icons are curves with round joins, so the lattice's "one
kind of icon that cannot go blurry" argument dies with the table, and the icon
section of DESIGN.md says so. The lattice stays what it is for the wordmark,
the field and the meter. `src/lib/icons.ts` retires; the stylesheet keeps the
face-flipping classes, so the two-state buttons change how they are drawn, not
how they work.
