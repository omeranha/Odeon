import { randomUUID } from 'node:crypto'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

export interface SlskdConfig {
  url: string
  apiKey: string
  // Where slskd's download folder is mounted for this server.
  downloadsDir: string
}

export interface SlskdFile {
  filename: string
  size: number
  length?: number
  bitRate?: number
  bitDepth?: number
  sampleRate?: number
}

export interface SlskdPeer {
  username: string
  hasFreeUploadSlot: boolean
  queueLength: number
  uploadSpeed: number
  files: SlskdFile[]
}

interface RawTransfer {
  id: string
  filename: string
  state: string
  bytesTransferred?: number
  size?: number
}

const SEARCH_POLL_MS = 1500
const TRANSFER_POLL_MS = 3000
const MAX_FOLDER_DEPTH = 4

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function findFile(root: string, basename: string, size: number, depth = 0): Promise<string | undefined> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isFile() && entry.name === basename) {
      const info = await stat(path).catch(() => undefined)
      if (info && info.size === size) return path
    } else if (entry.isDirectory() && depth < MAX_FOLDER_DEPTH) {
      const found = await findFile(path, basename, size, depth + 1)
      if (found) return found
    }
  }
  return undefined
}

export function createSlskdClient(config: SlskdConfig) {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${config.url}/api/v0${path}`, {
      method,
      headers: { 'X-API-Key': config.apiKey, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`slskd ${method} ${path} returned HTTP ${response.status}`)
    const text = await response.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  return {
    async search(text: string, timeoutMs = 12_000): Promise<SlskdPeer[]> {
      const id = randomUUID()
      await request('POST', '/searches', { id, searchText: text, searchTimeout: timeoutMs, filterResponses: true, minimumResponseFileCount: 1, responseLimit: 150 })
      const deadline = Date.now() + timeoutMs + 8_000
      try {
        for (;;) {
          await sleep(SEARCH_POLL_MS)
          const state = await request<{ state?: string }>('GET', `/searches/${id}`)
          if (String(state.state).startsWith('Completed') || Date.now() > deadline) break
        }
        const result = await request<{ responses?: SlskdPeer[] }>('GET', `/searches/${id}?includeResponses=true`)
        return result.responses ?? []
      } finally {
        void request('DELETE', `/searches/${id}`).catch(() => undefined)
      }
    },

    // Resolves with the file's local path once the transfer succeeds. A transfer still queued on the peer after
    // `queuedTimeoutMs` is dropped, so a busy user doesn't hold up the rest.
    async download(peer: string, file: SlskdFile, options: { timeoutMs: number; queuedTimeoutMs: number }): Promise<string> {
      const user = encodeURIComponent(peer)
      await request('POST', `/transfers/downloads/${user}`, [{ filename: file.filename, size: file.size }])
      const started = Date.now()
      let transfer: RawTransfer | undefined
      try {
        for (;;) {
          await sleep(TRANSFER_POLL_MS)
          const data = await request<{ directories?: { files?: RawTransfer[] }[] }>('GET', `/transfers/downloads/${user}`)
          transfer = data.directories?.flatMap((directory) => directory.files ?? []).find((item) => item.filename === file.filename)
          const state = transfer?.state ?? ''
          if (state.startsWith('Completed')) {
            if (!state.includes('Succeeded')) throw new Error(`The transfer ended as "${state}"`)
            break
          }
          const waited = Date.now() - started
          if (waited > options.timeoutMs) throw new Error('The transfer took too long')
          if (waited > options.queuedTimeoutMs && state.includes('Queued')) throw new Error('The user kept it queued')
        }
        const basename = file.filename.split(/[\\/]/).pop() ?? file.filename
        const path = await findFile(config.downloadsDir, basename, file.size)
        if (!path) throw new Error("The downloaded file wasn't found in slskd's folder")
        return path
      } catch (error) {
        if (transfer) void request('DELETE', `/transfers/downloads/${user}/${transfer.id}`).catch(() => undefined)
        throw error
      }
    },

    async forget(peer: string, filename: string): Promise<void> {
      const user = encodeURIComponent(peer)
      const data = await request<{ directories?: { files?: RawTransfer[] }[] }>('GET', `/transfers/downloads/${user}`).catch(() => undefined)
      const transfer = data?.directories?.flatMap((directory) => directory.files ?? []).find((item) => item.filename === filename)
      if (transfer) await request('DELETE', `/transfers/downloads/${user}/${transfer.id}`).catch(() => undefined)
    },
  }
}

export type SlskdClient = ReturnType<typeof createSlskdClient>
