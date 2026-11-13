import type { DowntifyClient } from '../downtify.ts'
import { navidrome, type SubsonicAuth } from '../navidrome.ts'
import type { AlexaMusic } from './music.ts'
import type { AlexaPlayer, DeviceQueue } from './player.ts'
import type { AlexaDirective, AlexaRequestEnvelope, AlexaResponse } from './types.ts'

const RESTART_THRESHOLD_MS = 3_000
const HELP = 'Você pode dizer: tocar Eminem, tocar a música Lose Yourself, tocar o álbum Recovery, tocar a playlist academia, ou tocar minhas curtidas. O que você quer ouvir?'

const empty: AlexaResponse = { version: '1.0', response: {} }

function say(text: string, options: { end?: boolean; directives?: AlexaDirective[] } = {}): AlexaResponse {
  return { version: '1.0', response: { outputSpeech: { type: 'PlainText', text }, ...(options.directives ? { directives: options.directives } : {}), shouldEndSession: options.end ?? true } }
}

function ask(text: string, reprompt = 'O que você quer ouvir?'): AlexaResponse {
  return { version: '1.0', response: { outputSpeech: { type: 'PlainText', text }, reprompt: { outputSpeech: { type: 'PlainText', text: reprompt } }, shouldEndSession: false } }
}

// Answers to AudioPlayer and PlaybackController requests may only carry AudioPlayer directives, no speech.
function silently(directives: AlexaDirective[]): AlexaResponse {
  return { version: '1.0', response: { directives } }
}

export function createAlexaSkill(options: { music: AlexaMusic; player: AlexaPlayer; downtify: DowntifyClient | null; auth: () => Promise<SubsonicAuth> }) {
  const { music, player, downtify, auth } = options

  const play = (queue: DeviceQueue, index: number, startMs: number): AlexaDirective => ({ type: 'AudioPlayer.Play', playBehavior: 'REPLACE_ALL', audioItem: player.audioItem(queue, index, startMs) })

  // Autoplay: past the last song, the queue continues with songs similar to the last two.
  async function nextIndex(device: string, queue: DeviceQueue): Promise<number | undefined> {
    if (queue.index + 1 < queue.tracks.length) return queue.index + 1
    if (queue.loop && queue.tracks.length > 0) return 0
    const more = await music.similar(queue.tracks.slice(-2).reverse(), queue.tracks).catch(() => [])
    if (more.length === 0) return undefined
    player.append(device, queue.generation, more)
    return queue.index + 1 < (player.queueOf(device)?.tracks.length ?? 0) ? queue.index + 1 : undefined
  }

  function positionMs(device: string, envelope: AlexaRequestEnvelope): number {
    const audio = envelope.context?.AudioPlayer
    const at = player.readToken(device, audio?.token)
    return at ? at.startMs + (audio?.offsetInMilliseconds ?? 0) : 0
  }

  // Downtify downloads a song completely before serving it; fetching the next one now means it starts without a wait.
  function prefetchAfter(queue: DeviceQueue, index: number) {
    const next = queue.tracks[index + 1]
    if (downtify && next?.kind === 'catalog' && next.video) void downtify.prefetch(next.video).catch(() => undefined)
  }

  function scrobble(queue: DeviceQueue, index: number, submission: boolean) {
    const track = queue.tracks[index]
    if (track?.kind !== 'library') return
    void auth()
      .then((credentials) => navidrome.scrobble(credentials, track.id, submission))
      .catch(() => undefined)
  }

  async function pause(device: string, envelope: AlexaRequestEnvelope, fromController: boolean): Promise<AlexaResponse> {
    const offsetMs = positionMs(device, envelope)
    if (player.readToken(device, envelope.context?.AudioPlayer?.token)) player.save(device, (queue) => (queue.offsetMs = offsetMs))
    const stop: AlexaDirective[] = [{ type: 'AudioPlayer.Stop' }]
    return fromController ? silently(stop) : { version: '1.0', response: { directives: stop, shouldEndSession: true } }
  }

  async function resume(device: string, fromController: boolean): Promise<AlexaResponse> {
    const queue = player.queueOf(device)
    if (!queue?.tracks[queue.index]) return fromController ? empty : say('Não há nada para continuar. Diga tocar e o que você quer ouvir.')
    return fromController ? silently([play(queue, queue.index, queue.offsetMs)]) : { version: '1.0', response: { directives: [play(queue, queue.index, queue.offsetMs)], shouldEndSession: true } }
  }

  async function skipTo(device: string, index: number | undefined, fromController: boolean): Promise<AlexaResponse> {
    const queue = player.queueOf(device)
    if (!queue || index === undefined || !queue.tracks[index]) return fromController ? empty : say('Essa era a última música.')
    player.save(device, (current) => {
      current.index = index
      current.offsetMs = 0
    })
    const directives = [play(queue, index, 0)]
    return fromController ? silently(directives) : { version: '1.0', response: { directives, shouldEndSession: true } }
  }

  async function previous(device: string, envelope: AlexaRequestEnvelope, fromController: boolean): Promise<AlexaResponse> {
    const queue = player.queueOf(device)
    if (!queue) return fromController ? empty : say('Não há nada tocando.')
    if (positionMs(device, envelope) > RESTART_THRESHOLD_MS || (queue.index === 0 && !queue.loop)) return skipTo(device, queue.index, fromController)
    return skipTo(device, queue.index === 0 ? queue.tracks.length - 1 : queue.index - 1, fromController)
  }

  async function next(device: string, fromController: boolean): Promise<AlexaResponse> {
    const queue = player.queueOf(device)
    if (!queue) return fromController ? empty : say('Não há nada tocando.')
    return skipTo(device, await nextIndex(device, queue), fromController)
  }

  async function intent(device: string, envelope: AlexaRequestEnvelope): Promise<AlexaResponse> {
    const name = envelope.request.intent?.name
    switch (name) {
      case 'PlayIntent': {
        const spoken = envelope.request.intent?.slots?.query?.value?.trim()
        if (!spoken) return ask('O que você quer ouvir?')
        const selection = await music.select(spoken)
        if (!selection) return say(`Não encontrei ${spoken}.`)
        const queue = player.start(device, selection.tracks)
        prefetchAfter(queue, 0)
        return say(selection.speech, { directives: [play(queue, 0, 0)] })
      }
      case 'NowPlayingIntent': {
        const queue = player.queueOf(device)
        const track = queue?.tracks[queue.index]
        return say(track ? `Está tocando ${track.title}${track.artist ? `, de ${track.artist}` : ''}.` : 'Nada está tocando agora.')
      }
      case 'AMAZON.PauseIntent':
      case 'AMAZON.StopIntent':
      case 'AMAZON.CancelIntent':
        return pause(device, envelope, false)
      case 'AMAZON.ResumeIntent':
        return resume(device, false)
      case 'AMAZON.NextIntent':
        return next(device, false)
      case 'AMAZON.PreviousIntent':
        return previous(device, envelope, false)
      case 'AMAZON.StartOverIntent':
      case 'AMAZON.RepeatIntent': {
        const queue = player.queueOf(device)
        return queue ? skipTo(device, queue.index, false) : say('Não há nada tocando.')
      }
      case 'AMAZON.ShuffleOnIntent':
      case 'AMAZON.ShuffleOffIntent': {
        const on = name === 'AMAZON.ShuffleOnIntent'
        player.shuffleUpcoming(device, on)
        const queue = player.queueOf(device)
        // A song may already be queued on the Echo; it's swapped for the new next one.
        const directives: AlexaDirective[] = queue?.tracks[queue.index + 1] ? [{ type: 'AudioPlayer.Play', playBehavior: 'REPLACE_ENQUEUED', audioItem: player.audioItem(queue, queue.index + 1, 0) }] : []
        return say(on ? 'Modo aleatório ligado.' : 'Modo aleatório desligado.', { directives })
      }
      case 'AMAZON.LoopOnIntent':
      case 'AMAZON.LoopOffIntent': {
        const on = name === 'AMAZON.LoopOnIntent'
        player.save(device, (queue) => (queue.loop = on))
        return say(on ? 'Vou repetir a fila.' : 'Repetição desligada.')
      }
      case 'AMAZON.HelpIntent':
        return ask(HELP)
      case 'AMAZON.NavigateHomeIntent':
        return { version: '1.0', response: { shouldEndSession: true } }
      default:
        return ask('Não entendi. Diga tocar e o nome de um artista, música, álbum ou playlist.')
    }
  }

  async function audioEvent(device: string, envelope: AlexaRequestEnvelope): Promise<AlexaResponse> {
    const { request } = envelope
    const at = player.readToken(device, request.token)
    const queue = player.queueOf(device)
    if (!queue) return empty

    switch (request.type) {
      case 'AudioPlayer.PlaybackStarted':
        if (!at) return empty
        player.save(device, (current) => {
          current.index = at.index
          current.offsetMs = 0
          current.failures = 0
        })
        scrobble(queue, at.index, false)
        prefetchAfter(queue, at.index)
        return empty
      case 'AudioPlayer.PlaybackFinished':
        if (at) scrobble(queue, at.index, true)
        return empty
      case 'AudioPlayer.PlaybackStopped':
        if (at) player.save(device, (current) => (current.offsetMs = at.startMs + (request.offsetInMilliseconds ?? 0)))
        return empty
      case 'AudioPlayer.PlaybackNearlyFinished': {
        if (!at) return empty
        player.save(device, (current) => (current.index = at.index))
        const following = await nextIndex(device, queue)
        if (following === undefined) return empty
        const audioItem = player.audioItem(queue, following, 0)
        return silently([{ type: 'AudioPlayer.Play', playBehavior: 'ENQUEUE', audioItem: { ...audioItem, stream: { ...audioItem.stream, expectedPreviousToken: request.token } } }])
      }
      case 'AudioPlayer.PlaybackFailed': {
        console.warn(`Alexa playback failed: ${request.error?.type ?? ''} ${request.error?.message ?? ''}`.trim())
        const index = at?.index ?? queue.index
        // One retry with a fresh link covers links issued before a server restart; after that the song is skipped.
        if (queue.failures < player.maxFailures) {
          player.save(device, (current) => current.failures++)
          return silently([play(queue, index, at ? at.startMs + (request.offsetInMilliseconds ?? 0) : 0)])
        }
        player.save(device, (current) => {
          current.index = index
          current.failures = 0
        })
        const following = await nextIndex(device, { ...queue, index })
        if (following === undefined) return empty
        player.save(device, (current) => (current.index = following))
        return silently([play(queue, following, 0)])
      }
      default:
        return empty
    }
  }

  return {
    async handle(envelope: AlexaRequestEnvelope): Promise<AlexaResponse> {
      const device = envelope.context?.System?.device?.deviceId ?? 'unknown'
      const { type } = envelope.request
      if (type === 'LaunchRequest') return ask('O que você quer ouvir?', 'Diga, por exemplo, tocar Eminem.')
      if (type === 'IntentRequest') return intent(device, envelope)
      if (type.startsWith('AudioPlayer.')) return audioEvent(device, envelope)
      if (type === 'PlaybackController.PlayCommandIssued') return resume(device, true)
      if (type === 'PlaybackController.PauseCommandIssued') return pause(device, envelope, true)
      if (type === 'PlaybackController.NextCommandIssued') return next(device, true)
      if (type === 'PlaybackController.PreviousCommandIssued') return previous(device, envelope, true)
      if (type === 'System.ExceptionEncountered') console.warn(`Alexa reported an error: ${envelope.request.error?.type ?? ''} ${envelope.request.error?.message ?? ''}`.trim())
      return empty
    },
  }
}

export type AlexaSkill = ReturnType<typeof createAlexaSkill>
