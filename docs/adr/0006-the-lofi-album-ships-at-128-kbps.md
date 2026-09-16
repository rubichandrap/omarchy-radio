# The lofi album ships at 128 kbps

[Open Lo-Fi](https://github.com/btahir/open-lofi) is 166 tracks of lo-fi
released under CC0-1.0, distributed as a single 554 MB zip: a median track of
3.24 MB at about 182 kbps VBR. This repository is the station, so the audio
has to live in it — where GitHub Pages recommends no more than 1 GB per source
repository, the repo already carries 159 MB of community songs, and every
contributor forks and clones the whole thing.

All 166 tracks ship, transcoded with `ffmpeg` to 128 kbps, and committed:
about 390 MB. The whole collection at source size would put the repository
past 700 MB, which every clone and every fork pays for, and it is not a cost
that can be taken back — audio in git history stays there. A second lossy pass
at 128 kbps on this material is the cheaper of the two.

Considered: committing the collection at source quality (700 MB repository,
permanent); shipping a selection instead (the album would be an excerpt, and
the rest would still be a 554 MB download for anyone who wanted it); hosting
the audio somewhere else and listing it by `url` (a second service that has to
stay up for the album to play).

Consequences: the files in this repository are derived artefacts, and nobody
can verify them against the source. The credit and a link to the original
release go in the README so the untranscoded set stays reachable, and this
record is why a 2 MB lofi track is 2 MB.
