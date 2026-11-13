# Odeon Car

A small native Odeon player for the Tablet DL 2403 (Android 4.2.2, 800x480, 512 MB RAM) used as a car dashboard
with the DLdash launcher. Java, no third-party libraries.

## Build and install

```sh
.\gradlew.bat assembleDebug
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

Set the server address before building by adding `odeon.server=https://your-server` to `android/local.properties`.

Requires JDK 17+ and the Android SDK path in `local.properties`.

## Sign-in

The tablet shows a code. On a phone signed in to Odeon, open Settings → Sign-in and security → Link a device and
enter it. The tablet then holds that user's Subsonic token, like any other signed-in device.

## How it works

- `Tls` bundles current root certificates (Let's Encrypt, Google, SSL.com) and turns on TLS 1.2, which Android 4.2
  leaves off. Without both, the public HTTPS address doesn't load.
- `StreamProxy` serves streams to `MediaPlayer` from `127.0.0.1`, because MediaPlayer makes its own HTTPS
  connections with the system's outdated roots. Streams are transcoded to MP3 by Navidrome; seeking restarts the
  stream with `timeOffset`, except for MP3 files Navidrome sends as-is, which seek with range requests.
- Songs not in the library stream from YouTube Music through Downtify; the next one is fetched into Downtify's cache
  while the current one plays.
- Downloads go to `/mnt/external_sd/Spotydrome` (or internal storage) as MP3, with an index in the app's private
  storage. Without a connection, or with "Offline only" on, the app plays and browses downloads only.
- `PlayerService` registers for media buttons, so DLdash's home controls, Bluetooth and steering-wheel buttons work. It
  ducks for navigation prompts, pauses when power is cut and resumes when it returns.
- A sticky `com.spotydrome.car.STATE` broadcast carries the current song for DLdash's home screen.
