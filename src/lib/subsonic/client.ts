import type { SubsonicResponseBase } from './types'

export interface SubsonicCredentials {
  username: string
  token: string
  salt: string
}

type ParamValue = string | number | boolean | undefined
export type QueryParams = Record<string, ParamValue | ParamValue[]>

const API_VERSION = '1.16.1'
const CLIENT_NAME = 'odeon'

// Subsonic error codes: 40 wrong credentials, 41 token auth unsupported, 44 invalid API key.
const AUTH_ERROR_CODES = new Set([40, 41, 44])

export class SubsonicError extends Error {
  readonly code: number

  constructor(code: number, message: string) {
    super(message)
    this.name = 'SubsonicError'
    this.code = code
  }

  get isAuthError(): boolean {
    return AUTH_ERROR_CODES.has(this.code)
  }
}

function appendParams(target: URLSearchParams, params: QueryParams): void {
  for (const [key, value] of Object.entries(params)) {
    const values = Array.isArray(value) ? value : [value]
    for (const item of values) {
      if (item !== undefined) target.append(key, String(item))
    }
  }
}

function withAuth(credentials: SubsonicCredentials, params: QueryParams): QueryParams {
  return { u: credentials.username, t: credentials.token, s: credentials.salt, v: API_VERSION, c: CLIENT_NAME, ...params }
}

async function parseResponse<T extends object>(endpoint: string, response: Response): Promise<T> {
  if (!response.ok) throw new Error(`Subsonic request "${endpoint}" failed with HTTP ${response.status}`)
  const body = (await response.json()) as { 'subsonic-response': SubsonicResponseBase & T }
  const payload = body['subsonic-response']
  if (payload.status !== 'ok') throw new SubsonicError(payload.error?.code ?? 0, payload.error?.message ?? 'Unknown Subsonic error')
  return payload
}

export function buildSubsonicUrl(endpoint: string, credentials: SubsonicCredentials, params: QueryParams = {}): URL {
  const url = new URL(`/rest/${endpoint}`, window.location.origin)
  appendParams(url.searchParams, withAuth(credentials, params))
  return url
}

export async function subsonicRequest<T extends object>(endpoint: string, credentials: SubsonicCredentials, params: QueryParams = {}, signal?: AbortSignal): Promise<T> {
  const response = await fetch(buildSubsonicUrl(endpoint, credentials, { ...params, f: 'json' }), { signal })
  return parseResponse<T>(endpoint, response)
}

// Mutations use the OpenSubsonic formPost extension so long song lists (reordering a big playlist) don't hit URL length limits.
export async function subsonicPost<T extends object = object>(endpoint: string, credentials: SubsonicCredentials, params: QueryParams = {}): Promise<T> {
  const body = new URLSearchParams()
  appendParams(body, withAuth(credentials, { ...params, f: 'json' }))
  const response = await fetch(new URL(`/rest/${endpoint}`, window.location.origin), { method: 'POST', body })
  return parseResponse<T>(endpoint, response)
}
