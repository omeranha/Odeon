import { useEffect, useState } from 'react'

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

// Returns an "r g b" triplet so callers can add alpha: `rgb(${color} / 0.4)`.
export function useDominantColor(imageUrl: string | undefined): string | undefined {
  const [result, setResult] = useState<{ url: string; color: string }>()

  useEffect(() => {
    if (!imageUrl) return
    let cancelled = false
    const image = new Image()
    image.onload = () => {
      const color = extractColor(image)
      if (!cancelled && color) setResult({ url: imageUrl, color })
    }
    image.src = imageUrl
    return () => {
      cancelled = true
    }
  }, [imageUrl])

  return result && result.url === imageUrl ? result.color : undefined
}

function extractColor(image: HTMLImageElement): string | undefined {
  const size = 16
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return undefined

  let data: Uint8ClampedArray
  try {
    context.drawImage(image, 0, 0, size, size)
    data = context.getImageData(0, 0, size, size).data
  } catch {
    return undefined
  }

  let red = 0
  let green = 0
  let blue = 0
  let total = 0
  for (let index = 0; index < data.length; index += 4) {
    const [r, g, b] = [data[index], data[index + 1], data[index + 2]]
    const weight = (Math.max(r, g, b) - Math.min(r, g, b)) / 255 + 0.05
    red += r * weight
    green += g * weight
    blue += b * weight
    total += weight
  }

  // Caps brightness so white text stays readable on top of the color.
  const brightest = Math.max(red, green, blue) / total
  const scale = Math.min(1, 150 / Math.max(brightest, 1))
  return [red, green, blue].map((channel) => Math.round((channel / total) * scale)).join(' ')
}
