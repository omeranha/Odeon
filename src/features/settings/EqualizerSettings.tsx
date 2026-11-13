import clsx from 'clsx'
import { EQ_BANDS, EQ_PRESETS, EQ_RANGE_DB, presetNameFor, useEqualizerStore } from '../player/equalizer'

const bandLabel = (frequency: number) => (frequency >= 1000 ? `${frequency / 1000}k` : String(frequency))

export function EqualizerSettings() {
  const enabled = useEqualizerStore((state) => state.enabled)
  const gains = useEqualizerStore((state) => state.gains)
  const { setEnabled, setGain, applyPreset } = useEqualizerStore.getState()
  const preset = presetNameFor(gains)

  return (
    <div className="py-3">
      <div className="flex items-center justify-between gap-6">
        <div>
          <p className="text-sm">Equalizer</p>
          <p className="text-sm text-subdued">Shape the sound on this device. If playback stops when the screen locks on an iPhone, turn it off.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-label="Equalizer"
          aria-checked={enabled}
          onClick={() => setEnabled(!enabled)}
          className={clsx('relative h-6 w-11 shrink-0 rounded-full transition-colors', enabled ? 'bg-accent' : 'bg-white/30')}
        >
          <span className={clsx('absolute top-1 left-1 size-4 rounded-full bg-white shadow transition-transform', enabled && 'translate-x-5')} />
        </button>
      </div>

      {enabled && (
        <div className="mt-4">
          <div className="mb-4 flex flex-wrap gap-2">
            {Object.keys(EQ_PRESETS).map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={preset === name}
                onClick={() => applyPreset(name)}
                className={clsx('rounded-full px-3 py-1 text-xs font-bold transition', preset === name ? 'bg-white text-black' : 'bg-white/10 hover:bg-white/20')}
              >
                {name}
              </button>
            ))}
            {preset === 'Custom' && <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold">Custom</span>}
          </div>
          <div className="grid grid-cols-5 gap-x-4 gap-y-5 sm:grid-cols-10">
            {EQ_BANDS.map((frequency, band) => (
              <label key={frequency} className="flex flex-col items-center gap-2 text-xs text-subdued">
                <input
                  type="range"
                  min={-EQ_RANGE_DB}
                  max={EQ_RANGE_DB}
                  step={1}
                  value={gains[band]}
                  aria-label={`${bandLabel(frequency)} Hz`}
                  aria-valuetext={`${gains[band]} dB`}
                  onChange={(event) => setGain(band, Number(event.target.value))}
                  className="h-24 w-6 accent-accent [writing-mode:vertical-lr] [direction:rtl]"
                />
                <span>{bandLabel(frequency)}</span>
                <span className="tabular-nums">{gains[band] > 0 ? `+${gains[band]}` : gains[band]}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
