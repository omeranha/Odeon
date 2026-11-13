import clsx from 'clsx'
import { Pause, Play, Repeat, Repeat1, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Slider } from '../../components/Slider'
import { formatTime } from '../../lib/format'
import { shuffleLabel, usePlayerStore } from './playerStore'
import { ShuffleIcon } from './ShuffleIcon'
import { useTransport } from './transport'

const repeatLabels = { off: 'Enable repeat', all: 'Enable repeat one', one: 'Disable repeat' }

function ToggleButton({ active, label, onClick, disabled, children }: { active: boolean; label: string; onClick: () => void; disabled: boolean; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} aria-pressed={active} onClick={onClick} disabled={disabled} className={clsx('relative grid place-items-center transition hover:scale-105 disabled:opacity-40', active ? 'text-accent' : 'text-subdued hover:text-white')}>
      {children}
      {active && <span className="absolute -bottom-2 size-1 rounded-full bg-accent" />}
    </button>
  )
}

export function TransportControls({ large = false }: { large?: boolean }) {
  const { song, isPlaying, shuffle, smartShuffle, repeat, remoteName, togglePlay, next, previous, toggleShuffle, cycleRepeat } = useTransport()
  const disabled = !song
  const RepeatIcon = repeat === 'one' ? Repeat1 : Repeat
  const toggleIcon = large ? 'size-6' : 'size-4'
  const skipIcon = large ? 'size-8' : 'size-5'
  const skipClass = 'text-subdued transition hover:scale-105 hover:text-white disabled:opacity-40 max-md:text-white'

  return (
    <div className={clsx('flex items-center', large ? 'justify-between' : 'gap-5')}>
      <ToggleButton active={shuffle} label={shuffleLabel(shuffle, smartShuffle, remoteName === null)} onClick={toggleShuffle} disabled={disabled}>
        <ShuffleIcon smart={smartShuffle} className={toggleIcon} />
      </ToggleButton>
      <button type="button" aria-label="Previous" onClick={previous} disabled={disabled} className={skipClass}>
        <SkipBack className={skipIcon} fill="currentColor" />
      </button>
      <button type="button" aria-label={isPlaying ? 'Pause' : 'Play'} onClick={togglePlay} disabled={disabled} className={clsx('grid place-items-center rounded-full bg-white text-black transition hover:scale-105 disabled:opacity-40 disabled:hover:scale-100', large ? 'size-16' : 'size-8')}>
        {isPlaying ? <Pause className={large ? 'size-7' : 'size-4'} fill="currentColor" /> : <Play className={clsx(large ? 'size-7' : 'size-4', 'translate-x-px')} fill="currentColor" />}
      </button>
      <button type="button" aria-label="Next" onClick={next} disabled={disabled} className={skipClass}>
        <SkipForward className={skipIcon} fill="currentColor" />
      </button>
      <ToggleButton active={repeat !== 'off'} label={repeatLabels[repeat]} onClick={cycleRepeat} disabled={disabled}>
        <RepeatIcon className={toggleIcon} />
      </ToggleButton>
    </div>
  )
}

export function PlaybackProgress({ large = false }: { large?: boolean }) {
  const { song, position, duration, seek } = useTransport()
  const [preview, setPreview] = useState<number | null>(null)
  const shown = preview ?? position
  const slider = <Slider value={position} max={song ? duration : 0} label="Seek" valueText={`${formatTime(shown)} of ${formatTime(duration)}`} step={5} onPreview={setPreview} onCommit={seek} className={large ? undefined : 'flex-1'} />

  if (large) {
    return (
      <div>
        {slider}
        <div className="mt-1 flex justify-between text-xs text-white/70 tabular-nums">
          <span>{formatTime(shown)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex w-full items-center gap-2 text-xs text-subdued tabular-nums">
      <span className="w-10 text-right">{song ? formatTime(shown) : '-:--'}</span>
      {slider}
      <span className="w-10">{song ? formatTime(duration) : '-:--'}</span>
    </div>
  )
}

export function VolumeControl() {
  const volume = usePlayerStore((state) => state.volume)
  const muted = usePlayerStore((state) => state.muted)
  const { setVolume, toggleMute } = usePlayerStore.getState()
  const effective = muted ? 0 : volume
  const Icon = effective === 0 ? VolumeX : effective < 0.5 ? Volume1 : Volume2

  return (
    <div className="flex items-center gap-2">
      <button type="button" aria-label={muted ? 'Unmute' : 'Mute'} onClick={toggleMute} className="text-subdued hover:text-white">
        <Icon className="size-4" />
      </button>
      <Slider value={effective} max={1} step={0.1} label="Volume" valueText={`${Math.round(effective * 100)}%`} onPreview={(value) => value !== null && setVolume(value)} onCommit={setVolume} className="w-24" />
    </div>
  )
}
