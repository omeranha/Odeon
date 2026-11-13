import { useEffect } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getAudioElement } from './audioEngine'

export const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const
export const EQ_RANGE_DB = 12

export const EQ_PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Bass boost': [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  'Treble boost': [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
  Vocal: [-2, -2, -1, 1, 3, 3, 2, 1, 0, -1],
  Rock: [5, 4, 2, -1, -2, -1, 2, 3, 4, 5],
  Electronic: [5, 4, 1, 0, -2, 2, 1, 2, 4, 5],
}

interface EqualizerState {
  enabled: boolean
  gains: number[]
  setEnabled: (enabled: boolean) => void
  setGain: (band: number, gain: number) => void
  applyPreset: (name: string) => void
}

export const useEqualizerStore = create<EqualizerState>()(
  persist(
    (set) => ({
      enabled: false,
      gains: EQ_PRESETS.Flat,
      setEnabled: (enabled) => set({ enabled }),
      setGain: (band, gain) => set((state) => ({ gains: state.gains.map((value, index) => (index === band ? Math.max(-EQ_RANGE_DB, Math.min(EQ_RANGE_DB, gain)) : value)) })),
      applyPreset: (name) => set({ gains: EQ_PRESETS[name] ?? EQ_PRESETS.Flat }),
    }),
    { name: 'spotydrome-equalizer', version: 1 },
  ),
)

export function presetNameFor(gains: number[]): string {
  return Object.entries(EQ_PRESETS).find(([, preset]) => preset.every((value, index) => value === gains[index]))?.[0] ?? 'Custom'
}

interface Graph {
  context: AudioContext
  source: MediaElementAudioSourceNode
  filters: BiquadFilterNode[]
  routed: boolean
}

let graph: Graph | null = null

// A media element can only be wrapped once, and iOS may suspend a Web Audio context in the background, so the graph is
// built the first time the equalizer is turned on and bypassed (not torn down) when it is turned off.
function ensureGraph(): Graph | null {
  if (graph) return graph
  const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextClass) return null
  const context = new AudioContextClass()
  const source = context.createMediaElementSource(getAudioElement())
  const filters = EQ_BANDS.map((frequency, index) => {
    const filter = context.createBiquadFilter()
    filter.type = index === 0 ? 'lowshelf' : index === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking'
    filter.frequency.value = frequency
    filter.Q.value = 1.1
    return filter
  })
  filters.forEach((filter, index) => {
    if (index > 0) filters[index - 1].connect(filter)
  })
  filters[filters.length - 1].connect(context.destination)
  source.connect(context.destination)
  graph = { context, source, filters, routed: false }
  return graph
}

function route(active: Graph, through: boolean) {
  if (active.routed === through) return
  active.source.disconnect()
  active.source.connect(through ? active.filters[0] : active.context.destination)
  active.routed = through
}

export function useEqualizerEngine() {
  const enabled = useEqualizerStore((state) => state.enabled)
  const gains = useEqualizerStore((state) => state.gains)

  useEffect(() => {
    if (!enabled && !graph) return
    const active = ensureGraph()
    if (!active) return
    gains.forEach((gain, index) => {
      active.filters[index].gain.value = gain
    })
    route(active, enabled)
    if (active.context.state === 'suspended') void active.context.resume().catch(() => undefined)
  }, [enabled, gains])

  useEffect(() => {
    const audio = getAudioElement()
    const resume = () => {
      if (graph?.context.state === 'suspended') void graph.context.resume().catch(() => undefined)
    }
    audio.addEventListener('play', resume)
    return () => audio.removeEventListener('play', resume)
  }, [])
}
