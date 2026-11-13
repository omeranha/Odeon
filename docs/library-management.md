# Getting music and managing the library

These features need Downtify (`DOWNTIFY_URL` and `DOWNTIFY_TOKEN`). Admin pages (deleting songs, explicit versions, storage, duplicates) also need `DOWNTIFY_ADMIN_USERNAME` and `DOWNTIFY_ADMIN_PASSWORD`, a Downtify admin account. Downtify only allows these actions from an admin session, so Odeon signs in as that account.

## Get music

Search shows YouTube Music results next to the library. Selecting results queues them in Downtify, which saves them into a folder inside the library Navidrome scans. Navidrome's file watcher imports new files within seconds, and the app refreshes its library views when downloads finish. To use Soulseek as a fallback and for quality upgrades, see [soulseek.md](soulseek.md).

**Exact matches.** A Spotify or Deezer track is matched to a YouTube Music recording before it is queued. The result must have the same title and version (a "Live" or "Remix" does not match the studio song), the same explicit flag, the same artist and a length within 3 seconds. The closest one, preferring the same album, is forced as Downtify's source. If no result qualifies, Downtify picks its own and the app says that some songs could not be matched exactly. YouTube Music audio is about 130 kbps, the most a free account gets.

**Fast first play.** The web app streams a YouTube Music song straight from YouTube instead of waiting for Downtify to download it. The server asks YouTube's InnerTube player API for the stream (ANDROID_VR client, VISIONOS as a fallback), checks that the stream is complete, and proxies it with range support so seeking works. The first byte arrives in about 0.5 s, against about 10 s through Downtify (yt-dlp has a fixed 3 s wait and a 2 s JavaScript challenge step). The top search results and the next queued song are resolved in advance, so they start in about 0.15 s. Chrome and Firefox get Opus (about 142 kbps), other browsers get AAC (about 130 kbps).

If the direct stream fails, the app falls back to the Downtify file. The car app and Alexa do not use the direct path. Set `DIRECT_STREAM=false` on the server to turn it off. The client definitions live in `server/src/innertube.ts`; if YouTube changes them and streaming falls back to Downtify, copy the current values from yt-dlp's `INNERTUBE_CLIENTS`.

Audio is passed on as it arrives, and a seek makes the server ask YouTube for the bytes from that position, so nothing waits for the whole file. Only the Downtify fallback has to finish a file before it plays.

**Fast downloads.** Downtify's yt-dlp needs about 18 s before the first byte (a JavaScript challenge and a 3 s wait that comes from the ad data in YouTube's web player responses), so a library download took about 22 s. `deploy/downtify-fast/` replaces that step with the same player API call the web app uses: the audio arrives in about a second and the whole download finishes in about 2 s. Tags, cover art and lyrics are still handled by Downtify. The same patch speeds up Downtify's own stream cache, so the car app, Alexa and the web app's fallback start in about 1 s instead of 10 s. Anything unexpected (an age-restricted song, a changed API) falls back to Downtify's yt-dlp with your cookies.

To install it, copy `fast_fetch.py` and `start.py` from `deploy/downtify-fast/` to a `patch` folder next to Downtify's compose file, then add this to the Downtify service and run `docker compose up -d`:

```yaml
    entrypoint: ["python", "/patch/start.py", "web", "--host", "0.0.0.0", "--log-level", "info"]
    volumes:
      - ./patch:/patch:ro
```

Remove those two lines to go back to stock Downtify. The client definitions in `fast_fetch.py` are copied from yt-dlp too and need the same update as `innertube.ts` if YouTube changes them.

## Playlist import

Pasting a Spotify, YouTube Music or Deezer playlist (or album) link offers "Import as playlist". The backend creates the playlist in Navidrome under the caller's account, adds songs already in the library, has Downtify download the rest, and adds each one as Navidrome imports it, keeping the source order. Imports run on the server, so they continue when the app is closed. They are kept in memory: restarting the backend stops unfinished imports, but songs already added stay in the playlist.

## Explicit versions

YouTube only serves explicit songs to a signed-in, age-verified account. Downtify downloads everything with one such account, from a cookies file in its own data folder. When downloads of explicit songs start failing, export a fresh `cookies.txt` for that account and replace the file.

A clean edit has the same title and length as the explicit version, so Downtify's matcher cannot tell them apart. For songs that Spotify or Deezer mark explicit, the backend picks the YouTube Music result that is marked explicit (searching again with "explicit" added when needed) and forces that video, for streaming, single downloads and playlist imports.

Songs already downloaded as clean copies can be fixed by an admin under Settings, Explicit versions. It lists library files without the explicit tag that have an explicit version on YouTube Music and has Downtify replace their audio (lossless files are skipped). Afterwards a full Navidrome scan is started.

## Storage and duplicates (admin)

Settings, Storage and duplicates shows the library size, growth, free space, downloads per source, and the split by source and format. It reads Downtify's usage report, so numbers match Downtify's own Storage page.

Duplicate songs are listed as groups of the same song, either the same file in two folders or "likely" matches with the same artist, title and length. The biggest file in each group is kept by default. Select the copies to remove and confirm. "Likely" matches compare tags, not audio, so check them first.

The folder scan lists what the download folders hold and the leftover files. It never deletes anything.

## Downloaded songs (admin)

Settings, Downloaded songs lists every file in Downtify's download folder with search and multi-select. Deleting removes the files from the server for good, takes the songs out of playlists and starts a Navidrome scan. There is no trash and no undo. Music that Navidrome reads from other folders is not listed and can only be removed on the server.

## Offline downloads

Downloads are stored per device and shared by all profiles on it. Audio goes into the Cache API (`spotydrome-audio`), covers into `spotydrome-offline-covers`, and album and playlist metadata into IndexedDB (`spotydrome-offline`). They use the profile's download quality setting. Downloaded playlists and Liked Songs stay in sync when opened online. Downloads only progress while the app is open, because iOS has no background fetch for web apps.
