# Odeon

*A roofed hall in ancient Greece built for music.*

A Spotify-style music player for [Navidrome](https://www.navidrome.org/). It is a progressive web app built with React, TypeScript, Vite and Tailwind CSS, and runs on iOS, Android and desktop browsers. It can be installed to the home screen.

Odeon can also add music to your library through [Downtify](https://github.com/henriquesebastiao/downtify) (YouTube Music, Soulseek) and mixes your library with YouTube Music in search and recommendations, like Spotify does.

## Features

- Browse, search, Liked Songs, editable playlists, queue with shuffle and repeat, lock-screen controls.
- Synced lyrics, a 10-band equalizer and offline downloads.
- Per-user history: songs played, recent searches and listening time per month. Songs from YouTube Music can be liked without adding them to the library.
- Search that shows your library and YouTube Music in one list, with remixes, covers and karaoke set aside behind one button. Paste a Spotify, YouTube Music, Deezer or SoundCloud link to open it.
- Always the original audio, with the codec and bitrate shown next to each artist name.
- Similar songs, autoplay when the queue ends, and smart shuffle. Suggestions are filtered by language, year and genre.
- Get music: download songs through Downtify, import Spotify, YouTube Music and Deezer playlists. Spotify tracks are matched to the exact YouTube Music recording (same version and explicit flag, length within 3 s).
- Admin tools: storage statistics, duplicate finder, downloaded-song cleanup, user invites, and a quality upgrade that swaps YouTube audio for a verified lossless copy from Soulseek.
- Passkey sign-in with invite links, several profiles per device, and remote control between devices.
- A custom Alexa skill in Portuguese (Brazil).
- A native Android 4.2 player for old car tablets (`android/`).

## Architecture

- `src/`: the PWA. It only talks to its own origin: `/rest` (Navidrome) and `/api` (backend).
- `server/`: a small Node server (Hono). In production it serves the built PWA, proxies `/rest` to Navidrome, handles sign-in (invites, passkeys, device codes), forwards "Get music" requests to Downtify and runs the Alexa skill. The Downtify token never leaves this server. Every request must carry a Subsonic token that Navidrome accepts, and downloads are requested by song id so clients cannot make Downtify fetch arbitrary data.
- `android/`: Odeon Car. See [android/README.md](android/README.md).
- `deploy/soulseek/`: an example slskd setup for Soulseek downloads.
- `deploy/downtify-fast/`: an optional patch that makes Downtify fetch YouTube Music audio about ten times faster. See [docs/library-management.md](docs/library-management.md).

Navidrome is the music library. Downtify is optional and only needed for Get music, playlist import and the admin library tools.

## Requirements

- Node.js 22.18 or newer.
- A Navidrome server. Sign-in needs Navidrome to trust the backend for the `Remote-User` header (`ND_EXTAUTH_TRUSTEDSOURCES`).
- Optional: Downtify, for adding music.

## Development

```sh
npm install
npm --prefix server install
cp .env.example .env.local          # set NAVIDROME_URL
cp server/.env.example server/.env  # set NAVIDROME_URL and, optionally, the Downtify values
npm run dev          # PWA on http://localhost:5173
npm run dev:server   # backend on http://localhost:3000 (needed for sign-in)
```

The Vite dev server proxies `/rest` to `NAVIDROME_URL` and `/api` to the backend. Develop against a test Navidrome that trusts your backend's address. The service worker only runs in production builds (`npm run build`, then `npm run preview`, or the backend with `STATIC_DIR=../dist`).

```sh
npm run lint
npm run build
npm --prefix server run typecheck
```

## Deployment

Odeon ships as one Docker image that contains the backend and the built PWA. See `docker-compose.example.yml`. The container listens on port 3000. Put a reverse proxy, Cloudflare Tunnel or Tailscale in front of it. Service workers and installation require HTTPS, except on `localhost`.

Mount Downtify's `/downloads` on a folder inside the library Navidrome scans.

`scripts/deploy.bat` is the author's helper for a Linux server over SSH. It packs the project, copies it over and rebuilds the container, and never overwrites the server's own `.env`, `docker-compose.yml` or `data/`. Edit `SERVER` in the script before using it.

### Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `NAVIDROME_URL` | yes | Navidrome as seen from the container, e.g. `http://navidrome:4533` |
| `WEBAUTHN_RP_ID` | yes | The domain passkeys are bound to, e.g. `music.example.com` |
| `WEBAUTHN_ORIGINS` | yes | Comma-separated origins the app is served from. Invite links use the first one |
| `WEBAUTHN_RP_NAME` | no | Name shown in passkey prompts (default `Odeon`) |
| `DOWNTIFY_URL` | no | Downtify as seen from the container, e.g. `http://downtify:8000`. Without it, Get music and YouTube Music results are hidden |
| `DOWNTIFY_TOKEN` | with `DOWNTIFY_URL` | A Downtify device token (`POST /api/auth/token`) for a non-admin Downtify account |
| `DOWNTIFY_ADMIN_USERNAME`, `DOWNTIFY_ADMIN_PASSWORD` | no | A Downtify admin account. Needed for explicit-version replacement, song deletion and storage statistics. Downtify only allows these from an admin session, so the server signs in as this account |
| `SLSKD_URL`, `SLSKD_API_KEY` | no | slskd as seen from the container, e.g. `http://slskd:5030`, and its API key. With `LIBRARY_DIR` and `SLSKD_DIR`, turns on Settings, Better quality |
| `LIBRARY_DIR` | with `SLSKD_URL` | Downtify's downloads folder as mounted in this container (read and write), e.g. `/library` |
| `SLSKD_DIR` | no | slskd's download folder as mounted in this container (default `/slskd`) |
| `QUALITY_AUTO_MINUTES` | no | How often the server upgrades library songs from Soulseek by itself (default `60`, `0` for Settings only) |
| `QUALITY_AUTO_USER` | no | The Navidrome administrator used to ask for a rescan after an automatic upgrade (default `admin`) |
| `DIRECT_STREAM` | no | Set to `false` to stop streaming YouTube Music songs straight from YouTube |
| `ALEXA_SKILL_ID` | no | The Alexa skill's ID. With `ALEXA_USERNAME`, turns on the Alexa skill |
| `ALEXA_USERNAME` | with `ALEXA_SKILL_ID` | The Navidrome user whose library, playlists and likes the Echo plays |
| `ALEXA_PUBLIC_URL` | no | Public HTTPS address for the links the Echo streams from (default: the first `WEBAUTHN_ORIGINS`) |
| `TRUSTED_PROXIES` | no | Addresses allowed to set `CF-Connecting-IP` and `X-Forwarded-For`, e.g. the cloudflared network `172.18.0.0/16` |
| `DATA_DIR` | no | Where accounts, invites, playlist imports, play and search history, liked YouTube Music songs and caches are saved |
| `STATIC_DIR` | no | The built PWA to serve (the Docker image sets it) |
| `PORT` | no | Listening port (default `3000`) |

## Documentation

- [Authentication](docs/authentication.md): invites, passkeys, device codes, remote control.
- [Getting music and managing the library](docs/library-management.md): Get music, playlist import, explicit versions, storage, duplicates, offline downloads.
- [Soulseek (slskd)](docs/soulseek.md): fallback source, quality upgrades, reliability, CGNAT.
- [Search and recommendations](docs/recommendations.md): similar songs, autoplay, smart shuffle, lyrics, equalizer.
- [Alexa skill](docs/alexa.md)
- [Android car app](android/README.md)

## Notes

- Odeon does not host or provide music. Downloading from YouTube, Soulseek or other services may break their terms or your local law. You are responsible for what you download.
- Downtify, Navidrome and slskd are separate projects with their own licenses.
