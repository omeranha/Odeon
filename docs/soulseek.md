# Soulseek (slskd)

Soulseek gives lossless copies, but it is slow (about a minute per song) and matches by file name, so it is a poor first choice for exact versions. Odeon uses it two ways:

1. **Fallback source in Downtify.** Downloads try YouTube Music first (fast, exact matches), then YouTube, then Soulseek.
2. **Better quality upgrade.** Songs already in the library are checked against Soulseek in the background. A lossless copy is used only after an audio fingerprint shows it is the same recording and version, and then it replaces the audio of the existing file as 256 kbps AAC.

## Setup

1. Create a Soulseek account name and password (the first login creates it).
2. Copy `deploy/soulseek/docker-compose.yml` to the server, create the `.env` file described at the top of it, create the shared Docker network (`docker network create music`) and start it with `docker compose up -d`.
3. In Downtify's compose file, join the same `music` network and add the volume `<slskd downloads folder>:/slskd`. Recreate Downtify.
4. From any computer that can reach Downtify, run:

   ```sh
   DOWNTIFY_URL=http://<server>:8000 DOWNTIFY_ADMIN_USERNAME=admin DOWNTIFY_ADMIN_PASSWORD=... SLSKD_API_KEY=<the key from .env> node scripts/setup-soulseek.mjs
   ```

   The script sets the audio source order (YouTube Music, YouTube, slskd), keeps the best source audio, points Downtify at slskd, shortens the timeouts, sets the format tiers (FLAC, then MP3 at 256 kbps or more) and runs Downtify's connection test. Add `--dry-run` to preview the change or `--off` to turn Soulseek off.
6. For Settings, Better quality, give the Odeon container access to slskd and the library: join the `music` network, mount Downtify's downloads folder at `/library` (read and write) and slskd's downloads folder at `/slskd`, and set `SLSKD_URL`, `SLSKD_API_KEY` and `LIBRARY_DIR` (see `docker-compose.example.yml`). The image includes `ffmpeg` and `fpcalc` (Chromaprint).

The setup script sets "Leave slskd files in place" to off. Downtify then copies each finished file into its own downloads folder (which Navidrome scans), tags it and removes the original from slskd's folder. Keep slskd's download folder outside the folder Navidrome scans.

## Better quality

Every hour the server runs this on its own (`QUALITY_AUTO_MINUTES`, default 60, `0` for manual only). Each run takes up to 20 songs not checked in the last 30 days, searches Soulseek for each, keeps FLAC files whose length is within 2 s and whose name matches the title and artist, downloads up to three, and compares each with the current file by audio fingerprint. A copy that differs in more than one short stretch (a censored word, for example) is rejected. Verified copies replace the audio right away, and Navidrome is asked to rescan as `QUALITY_AUTO_USER` (a Navidrome administrator, default `admin`). Settings, Better quality does the same check on demand, lists the verified copies with their match percentage and waits for your confirmation.

Upgrading converts the FLAC to 256 kbps AAC and takes the tags, lyrics and cover art from the existing file. The file keeps its name and `.m4a` extension, so Navidrome keeps the song's ID, likes and playlist entries. Changing the extension would not: in a test, a song replaced by a `.flac` came back as a new song without its like or playlist entry. The previous file is kept under `upgrade-backup/` in Odeon's data folder. Songs checked without a result are not searched again for 30 days.

Devices that saved a song for offline listening compare it with Navidrome's current file size when the app opens (at most every 30 minutes) and download the song again if it changed.

The fingerprint thresholds were set from three real pairs and a synthetic test, and have not been tuned on many songs. Automatic runs apply without review, so look at the backup folder if a song sounds wrong.

## Reliability

- **Timeouts.** A transfer that is not started by the remote user within 90 seconds, or not finished within 5 minutes, is abandoned and the next source is tried.
- **Fallback.** A song Soulseek cannot find still downloads from YouTube, so a failure on the network never blocks a request.
- **Queued transfers.** Many Soulseek users limit slots and queue requests. A long queue on their side shows as "Queued, Remotely" in slskd.
- **Sharing.** Many users queue or refuse people who share nothing. slskd shares nothing by default. Sharing uploads your files to strangers, so it is off in the example. To turn it on, mount a read-only folder and set `SLSKD_SHARED_DIR`.
- **Stale sessions.** If slskd cannot sign in or stays disconnected, restart it. Check logs for a wrong username or password first.

## Behind CGNAT (no public IP)

Soulseek peers connect to your listen port (`50300`). If your provider uses CGNAT you cannot forward it, and you can only download from peers that have open ports. Downloads still work, but more transfers fail.

- **Tailscale does not fix this.** Other Soulseek users are not on your tailnet, and Tailscale Funnel only exposes HTTPS ports.
- **A VPN with port forwarding does.** Run slskd behind [Gluetun](https://github.com/qdm12/gluetun) (`network_mode: "service:gluetun"`) with a provider that supports port forwarding, and set slskd's `listen_port` to the forwarded port. Gluetun's [discussion on slskd and ProtonVPN](https://github.com/qdm12/gluetun/discussions/1966) shows how to update the port automatically. Only slskd needs to go through the VPN.
- **Ask your provider** for a public IPv4 address or a port forward.

## Storage page and deleting songs

The Storage page, duplicates list and song deletion in Odeon's settings need a Downtify admin account. Set `DOWNTIFY_ADMIN_USERNAME` and `DOWNTIFY_ADMIN_PASSWORD` on the Odeon server; it signs in as that admin, because Downtify only allows these actions from an admin session and refuses device tokens. Deleting is permanent.

## Rolling back

Run `node scripts/setup-soulseek.mjs --off` with the same `DOWNTIFY_URL`, `DOWNTIFY_ADMIN_USERNAME` and `DOWNTIFY_ADMIN_PASSWORD`. Downtify goes back to YouTube Music only. Files already downloaded stay in the library. To undo an upgrade, copy the file from `upgrade-backup/` back over the library file.
