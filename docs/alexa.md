# Alexa skill

Odeon is also a custom Alexa skill in Portuguese (Brazil), served by the backend at `/api/alexa`. Only services Amazon integrates itself can answer "Alexa, toca Eminem" without a skill name (its Music Skill API is limited to the US), so the skill is called by name.

## What you can say

- "Alexa, pede pro Odeon tocar Eminem": an artist's songs (library and YouTube Music), shuffled.
- "Alexa, pede pro Odeon tocar Lose Yourself": that song, ranked like the app's search, with the library copy preferred.
- "... tocar o álbum Recovery", "... tocar a playlist academia", "... tocar minhas curtidas". Add "aleatório" to shuffle.
- "Alexa, pergunta pro Odeon que música é essa".
- Once playing: "Alexa, pausa / continua / próxima / volta / modo aleatório / repete", and the Echo's buttons.

When the queue runs out, it continues with similar songs, like autoplay in the app. Plays are scrobbled to Navidrome. Each Echo keeps its own queue (saved in `DATA_DIR/alexa.json`).

## How it works

Amazon's cloud sends every request to `/api/alexa`. The backend checks Amazon's signature, certificate chain and timestamp, and that the request is for `ALEXA_SKILL_ID`. The Echo then downloads audio itself from `/api/alexa/stream/...` links. They are signed, valid for 12 hours and carry no credentials, so the Subsonic token stays on the server. Library songs are streamed as MP3 (320 kbps cap) and YouTube Music songs as Downtify's AAC. The next YouTube Music song is fetched into Downtify's cache ahead of time.

## Setup

1. In the [Alexa Developer Console](https://developer.amazon.com/alexa/console/ask), create a skill: name Odeon, locale Portuguese (BR), type Custom, hosting "Provision your own".
2. Under Build, Interaction Model, JSON Editor, paste `alexa/interaction-model.pt-BR.json`. Under Interfaces, turn on Audio Player. Save and build the model. The invocation name is `odeon`. If Alexa mishears it, change it there (for example to "spoti drome").
3. Under Endpoint, choose HTTPS and enter `https://<your domain>/api/alexa`, with "My development endpoint has a certificate from a trusted certificate authority".
4. Put the skill ID and the Navidrome user in the server's `.env` (`ALEXA_SKILL_ID`, `ALEXA_USERNAME`) and redeploy. The startup log shows `Alexa: skill ... plays as ...`.
5. Under Test, set testing to Development. Echos signed in to the same Amazon account can then use the skill without publishing it.

## Limits

The app cannot control an Echo (Amazon only lets a skill change playback when the Echo asks it something), so Echos do not appear in the devices list. A YouTube Music song that is not cached yet takes a few seconds to start.
