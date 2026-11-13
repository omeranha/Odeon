import { execFile } from 'node:child_process'

// Chromaprint produces one 32-bit value for about every 0.12 s of audio.
const WINDOW_FRAMES = 40
const MAX_SHIFT = 6

export interface FingerprintComparison {
  windows: number
  weakWindows: number
  similarity: number
  // Short stretches (about half a second) where the two recordings clearly differ, like a censored word.
  badSegments: number
}

const FRAME_WINDOW = 4
const BAD_BELOW = 0.72

export function fingerprintOf(path: string, seconds = 600): Promise<number[]> {
  return new Promise((resolve, reject) => {
    execFile('fpcalc', ['-raw', '-length', String(seconds), path], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) return reject(new Error(`fpcalc failed: ${error.message}`))
      const line = stdout.split('\n').find((row) => row.startsWith('FINGERPRINT='))
      const values = line ? line.slice('FINGERPRINT='.length).split(',').map((value) => Number(value) >>> 0) : []
      if (values.length === 0) return reject(new Error('fpcalc returned no fingerprint'))
      resolve(values)
    })
  })
}

function bitsDifferent(a: number, b: number): number {
  let x = (a ^ b) >>> 0
  x -= (x >>> 1) & 0x55555555
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333)
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

function windowSimilarity(a: number[], b: number[], offset: number, start: number, end: number): number {
  let different = 0
  let compared = 0
  for (let index = start; index < end; index++) {
    const other = index + offset
    if (index >= a.length || other < 0 || other >= b.length) continue
    different += bitsDifferent(a[index], b[other])
    compared += 32
  }
  return compared === 0 ? 0 : 1 - different / compared
}

// Compares two recordings window by window after aligning them. A clean edit or a different mix matches almost everywhere
// but not in the parts that differ, so the number of weak windows matters more than the average.
export function compareFingerprints(a: number[], b: number[], weakBelow = 0.78): FingerprintComparison {
  const length = Math.min(a.length, b.length)
  let bestOffset = 0
  let bestScore = -1
  for (let offset = -MAX_SHIFT; offset <= MAX_SHIFT; offset++) {
    const score = windowSimilarity(a, b, offset, 0, Math.min(length, 400))
    if (score > bestScore) {
      bestScore = score
      bestOffset = offset
    }
  }
  let windows = 0
  let weakWindows = 0
  let total = 0
  for (let start = 0; start + WINDOW_FRAMES <= length; start += WINDOW_FRAMES) {
    const similarity = windowSimilarity(a, b, bestOffset, start, start + WINDOW_FRAMES)
    windows++
    total += similarity
    if (similarity < weakBelow) weakWindows++
  }
  return { windows, weakWindows, similarity: windows === 0 ? 0 : total / windows, badSegments: countBadSegments(a, b, bestOffset, length) }
}

function countBadSegments(a: number[], b: number[], offset: number, length: number): number {
  const similarities: number[] = []
  for (let index = 0; index < length; index++) {
    const other = index + offset
    similarities.push(other >= 0 && other < b.length ? 1 - bitsDifferent(a[index], b[other]) / 32 : 1)
  }
  let segments = 0
  let inside = false
  for (let start = 0; start + FRAME_WINDOW <= similarities.length; start++) {
    let sum = 0
    for (let step = 0; step < FRAME_WINDOW; step++) sum += similarities[start + step]
    const bad = sum / FRAME_WINDOW < BAD_BELOW
    if (bad && !inside) segments++
    inside = bad
  }
  return segments
}
