# Search and recommendations

Search shows library and YouTube Music songs in one list, in every tab, ordered by how well each title and artist matches the query. A song found in both is listed once and plays from the library.

YouTube Music returns every version of a song, so the results are sorted before they are shown. Songs in your library are never set aside. Of the YouTube Music results:

- Remixes, live versions, karaoke, covers and other versions the query did not ask for go behind a **Show N other versions** button. A bracket or dash suffix such as `(Afro House)` or `- Live at ...` marks a version; `(feat. X)`, `(Remastered)` and similar do not. Adding the word to the query (`blinding lights remix`) brings them back.
- If the query names an artist, results by other artists go behind the same button.
- The same recording listed under several albums (same title, artist and length within 3 s) shows once.
- If nothing but other versions matches, they are shown directly.

Every song shows its quality next to the artist name: the codec and bitrate for library songs (`AAC 256`, `MP3 320`, `FLAC 16/44.1`), and `~130 kbps` for YouTube Music songs. Playback and offline downloads always use the original file, with no quality setting. Pasting a Spotify, YouTube Music, Deezer or SoundCloud link opens it directly.

## Similar songs

Similar songs come from two places, taken in turns so neither is favored:

- Navidrome's Instant Mix (`getSimilarSongs2`), which needs its Last.fm or Deezer agent.
- YouTube Music's radio mix through Downtify (`/api/downtify/similar`).

Both lean on where the listener is: from a server in Brazil, a radio for American rap mixes in Brazilian trap. Before suggestions are used, the backend checks them against the songs they are meant to follow (`/api/recommendations/fit`):

- **Language**, from the lyrics. Navidrome's copy is used for library songs (Downtify embeds lyrics in every file), then [LRCLIB](https://lrclib.net), then accents in the title, then the language most of the artist's songs are in. A suggestion in a language under 15% of the seeds is dropped. A mixed playlist keeps both. Answers are cached in `DATA_DIR/song-languages.json`.
- **Year.** A song outside the seeds' range (10th to 90th percentile) moves back, about one place per year.
- **Genre.** A song whose genre none of the seeds have moves back four places.

With too few seeds of known language or year, that rule is skipped rather than guessed. LRCLIB allows about 4 requests a second, so the first check of unfamiliar songs takes a few seconds.

## Where suggestions are used

- **Similar to** rows under the top results in search.
- **Autoplay** (Settings, Playback): when the last song in the queue starts, up to 20 similar songs are added after it.
- **Smart shuffle**: the shuffle button cycles off, shuffle, smart shuffle. Smart shuffle adds a song after every 3 upcoming songs, picked from songs similar to several of the playlist's own. Added songs show a sparkle in the queue and are removed when smart shuffle is turned off.
- **Shuffle** keeps the 300 most recently played songs and, of 8 random orders, uses the one that plays them latest.

## Lyrics

The lyrics panel (microphone button in the player) shows synced lyrics that follow the song, and plain lyrics when a song has no timing. It reads the library's own lyrics from Navidrome (embedded in the file or a `.lrc` beside it) and falls back to LRCLIB through the backend, which also covers YouTube Music songs that are not in the library. Tapping a line seeks to it.

## Playback details

A YouTube Music song that is not in the library streams directly from YouTube through the server (see "Fast first play" in `library-management.md`). If that fails, Downtify downloads the whole song first, so it waits a few seconds. While a song plays, the next one in the queue is resolved in advance (`/api/downtify/prefetch`), so moving on starts right away.

Playback position survives a reload and moves with the queue to other devices. Navidrome ignores `timeOffset` for files it sends without transcoding (an MP3 already under the bitrate limit), so those are seeked with range requests instead.

## Equalizer

Settings, Playback has a 10-band equalizer with presets. It runs in the browser with the Web Audio API, per device, and is off by default. On some iPhones a Web Audio graph can stop playback when the screen locks. If that happens, turn the equalizer off.
