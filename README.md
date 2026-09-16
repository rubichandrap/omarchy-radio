# Omarchy Radio

Full-featured web radio deck for the [Omarchy](https://omarchy.org) community.

- **Live Station:** [https://rubichandrap.github.io/omarchy-radio/](https://rubichandrap.github.io/omarchy-radio/)
- **Upstream Project:** [omacom/radio.omarchy.org](https://github.com/omacom/radio.omarchy.org) ([radio.omarchy.org](https://radio.omarchy.org))
- **Author / Maintainer:** [@rubichandrap](https://github.com/rubichandrap)

---

## Why This Repository Exists

The original upstream station at [omacom/radio.omarchy.org](https://github.com/omacom/radio.omarchy.org) follows a strict minimalist philosophy: *"a playlist that lives in this repo and plays itself"*. It is designed as an autonomous broadcast tape—it plays top to bottom, loops infinitely, and intentionally omits interactive playback controls.

Because upstream's minimalist design precludes heavy client-side player controls, submitting these capabilities as an upstream pull request would not align with their architectural goals and would likely be rejected.

This repository exists as an independent, standalone project rather than an unmerged fork. It evolves the player into a **full-featured audio deck** with interactive transport controls, state management, and terminal integration, while maintaining full compatibility with the upstream community track library.

### Upstream Credit & Attribution

Full credit belongs to [omacom/radio.omarchy.org](https://github.com/omacom/radio.omarchy.org) and the Omarchy community. This project builds upon their foundational work:
- Core audio playback engine and headless `<video>` autoplay workaround.
- 24 base color themes derived from 4 seeds.
- Bayer-ordered dither canvas background and audio spectrum analyser.
- Community song submissions and podcast feed integration with [Omarchy Stories](https://omarchystories.org).

---

## Features & Roadmap

| Feature | Status | Description |
|---|---|---|
| **Shuffle Mode** | Active | Walk a shuffled play order: every track once per cycle, a fresh draw each time |
| **Repeat Modes** | Active | Cycle between Repeat Off, Repeat One (loop track), and Repeat All (loop playlist) |
| **Playback Queue** | In Progress | "Play Next" and "Add to Queue" actions without interrupting the current track |
| **Custom Playlists** | In Progress | Create, manage, and switch between curated subsets of tracks |
| **Terminal Theme Sync** | Active | Dynamic integration with desktop terminal colors (`colors.toml` via `omarchy-theme-sync`) |
| **24 Built-in Themes** | Active | Derived dynamically from four seeds (`ground`, `ink`, `accent`, `line`) |
| **Tape Marquee Readout** | Active | Canvas UI VHS shader with tape wave, chroma bleed, and head-switching distortion |
| **Spectrum Analyser** | Active | 56-band audio analyser mirrored about the center over an 8×8 Bayer dither field |
| **Instant Search (`/`)** | Active | Real-time fuzzy filter over titles and artists with diacritic folding |
| **Podcast Feed** | Active | Mirrored feed from Omarchy Stories with chapter jumping and permalinks |
| **Headless Autoplay** | Active | Zero-audio-restriction playback using a headless `<video>` element |
| **Persistent State** | In Progress | Retain the theme and the shuffle/repeat settings across reloads; queue and volume still to come |

---

## Hosting & Deployment

This project is hosted on GitHub Pages:

- **Station URL:** [https://rubichandrap.github.io/omarchy-radio/](https://rubichandrap.github.io/omarchy-radio/)
- **Deployment Workflow:** Automated via GitHub Actions on push to `main` ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)).
- **Static Output:** Astro builds individual static HTML files for every track (`/playlist/<slug>`) and podcast episode (`/podcast/<slug>`), serving clean extensionless URLs directly from GitHub Pages.

---

## Quick Start

```bash
# Install dependencies
npm install

# Start development server (localhost:4321)
npm run dev

# Build production static output into dist/
npm run build

# Run integrity tests (route resolution, icons, slug matching)
npm test

# Run type checks
npm run check

# Run browser tests (requires Chromium)
npm run test:browser
```

---

## Architecture & Codebase Map

| Path | Purpose |
|---|---|
| `src/scripts/deck.ts` | The deck: audio lifecycle, routing, the two lists, the play order and the transport |
| `src/scripts/theme.ts` | 24 themes, 4-seed derivations (`bg`, `fg`, `ac`, `bd`), CSS custom property injection |
| `src/scripts/omarchy-theme.ts` | Live synchronization with desktop terminal themes |
| `src/scripts/field.ts` | 8×8 Bayer dither background canvas and audio spectrum analyser |
| `src/scripts/lcd-vhs.ts` | Canvas UI VHS shader harness for the LCD marquee |
| `src/components/Icon.astro` | The deck's icons: one map from a deck name to the Lucide drawing it is |
| `src/lib/lists.ts` | Track and podcast feed ingestion and schema definitions |
| `src/lib/slug.ts` | URL slug derivation rule shared between build-time and runtime router |
| `src/pages/` | Astro route definitions for permalink static pages |
| `public/tracks/` | `albums.json` and the albums: an audio-and-`playlist.json` directory each |
| `public/stories/` | Mirrored podcast RSS feed (`feed.rss`) |

For comprehensive technical specifications on design tokens and the dither lattice, see [`DESIGN.md`](DESIGN.md).

---

## Submissions & Community Tracks

Tracks in this repository follow the Omarchy community guidelines:
- **Created with AI:** Suno, Udio, local models, or custom pipelines. Prompting is writing—submissions must be original work within the Omarchy universe (Arch, Hyprland, dotfiles, Quattro, the terminal).
- **Submission format:** Add an MP3 to `public/tracks/<album>/<artist-slug>-<title-slug>.mp3` and register the entry in that album's `public/tracks/<album>/playlist.json`. The albums themselves are declared in `public/tracks/albums.json`. Explicit tracks should be tagged accordingly.
- Detailed submission rules: [`public/tracks/README.md`](public/tracks/README.md).
- Podcast feed mirroring rules: [`public/stories/README.md`](public/stories/README.md).
