import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

// A small JSON file saved after changes (debounced, atomic rename). Without a path it only lives in memory.
export function createJsonStore<T>(path: string | undefined, initial: T) {
  let data = initial
  let timer: ReturnType<typeof setTimeout> | undefined

  const ready = (async () => {
    if (!path) return
    try {
      data = JSON.parse(await readFile(path, 'utf8')) as T
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`Could not read ${path}:`, error)
    }
  })()

  function save() {
    if (!path || timer) return
    timer = setTimeout(() => {
      timer = undefined
      const temporary = `${path}.tmp`
      void mkdir(dirname(path), { recursive: true })
        .then(() => writeFile(temporary, JSON.stringify(data), { mode: 0o600 }))
        .then(() => rename(temporary, path))
        .catch((error: unknown) => console.error(`Could not save ${path}:`, error))
    }, 500)
  }

  return {
    ready,
    get: () => data,
    update(change: (current: T) => void) {
      change(data)
      save()
    },
  }
}
