# Every list that can be played has an address at the root

A picked album is a place a listener can be sent to, and this deck puts every
place it names into the path. So the album needs an address, and the question
was which one.

Each album gets a root address of its own — `/omarchy`, `/lofi` — beside
`/podcast`, with `/playlist` left meaning every song. Album slugs are reserved
against the root words that already exist (`playlist`, `podcast`, `all`,
`index`, `404`, `assets`, `stories`, `tracks`, `_astro`, `sitemap.xml`,
`robots.txt`, `sw.js`, `site.webmanifest`, `favicon.ico`) and the build
refuses a clash.

The alternative was `/playlist/lofi`, which reuses a shape the router already
has. It was rejected because `/playlist/<slug>` is also every song's
permalink: an album there shares its address space with the songs, so a
song titled "Lofi" would have to fail the build. The contribution path in
this repo is an MP3 and three lines of JSON, and a rule that fails a
contribution over a name is the wrong place to put a cost. A root album
address cannot be shadowed by anything, and the check it needs runs over a
short list the maintainer keeps.

Considered: `/playlist/lofi` (collides with the song namespace); `/playlist`
plus `/playlist/all` and `/playlist/lofi` (uniform, but two addresses for the
unscoped list and the same collision).

Consequences: every song stays at `/playlist/<slug>`, so no permalink changes
and a song's address never names its album; the root namespace is now
populated by content, so a future page cannot be named after an album; and the
deck's router learns one new shape — a first segment that names an album
rather than a list.
