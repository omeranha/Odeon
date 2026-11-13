import type { SubsonicSong } from './subsonic/types'

export interface SongQuality {
  label: string
  title: string
}

const LOSSLESS = new Set(['flac', 'alac', 'wav', 'aiff', 'aif', 'ape', 'wv', 'dsf', 'dff'])
const CODEC_NAMES: Record<string, string> = { mp3: 'MP3', m4a: 'AAC', aac: 'AAC', opus: 'Opus', ogg: 'Vorbis', oga: 'Vorbis', wma: 'WMA', flac: 'FLAC', alac: 'ALAC', wav: 'WAV', aiff: 'AIFF', aif: 'AIFF', ape: 'APE', wv: 'WavPack' }
// What YouTube Music serves a free account: AAC at about this bitrate, or Opus a little above it.
const YOUTUBE_MUSIC_KBPS = 130

const kilohertz = (hertz: number) => String(Number((hertz / 1000).toFixed(1)))

export function songQuality(song: SubsonicSong): SongQuality | undefined {
  if (song.external) return { label: `~${YOUTUBE_MUSIC_KBPS} kbps`, title: `From YouTube Music, about ${YOUTUBE_MUSIC_KBPS} kbps. Downloading it to the library keeps that quality.` }
  const suffix = song.suffix?.toLowerCase()
  if (!suffix) return undefined
  // An .m4a file is AAC unless its bitrate is far beyond anything lossy, which means Apple Lossless.
  const lossless = LOSSLESS.has(suffix) || (suffix === 'm4a' && (song.bitRate ?? 0) > 700)
  const codec = lossless && suffix === 'm4a' ? 'ALAC' : (CODEC_NAMES[suffix] ?? suffix.toUpperCase())
  if (lossless) {
    const detail = song.bitDepth && song.samplingRate ? `${song.bitDepth}-bit / ${kilohertz(song.samplingRate)} kHz` : undefined
    return {
      label: song.bitDepth && song.samplingRate ? `${codec} ${song.bitDepth}/${kilohertz(song.samplingRate)}` : codec,
      title: `${codec}, lossless${detail ? `, ${detail}` : ''}${song.bitRate ? `, ${song.bitRate} kbps` : ''}`,
    }
  }
  return { label: song.bitRate ? `${codec} ${song.bitRate}` : codec, title: `${codec}${song.bitRate ? `, ${song.bitRate} kbps` : ''}` }
}
