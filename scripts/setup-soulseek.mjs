#!/usr/bin/env node
// Sets Downtify to download from YouTube Music first (exact matches, fast), then YouTube, then Soulseek (slskd) as a fallback,
// and to keep the best audio stream without re-encoding it.
//
//   DOWNTIFY_URL=http://<server>:8000 DOWNTIFY_ADMIN_USERNAME=admin DOWNTIFY_ADMIN_PASSWORD=... SLSKD_API_KEY=... node scripts/setup-soulseek.mjs
//
// Options: --dry-run prints the settings that would be saved; --off turns Soulseek off and goes back to YouTube Music only.
// SLSKD_URL (default http://slskd:5030) and SLSKD_SOURCE_DIR (default /slskd) are as seen from inside Downtify's container.

const dryRun = process.argv.includes('--dry-run')
const off = process.argv.includes('--off')

const downtifyUrl = (process.env.DOWNTIFY_URL ?? '').replace(/\/+$/, '')
const adminUsername = process.env.DOWNTIFY_ADMIN_USERNAME ?? ''
const adminPassword = process.env.DOWNTIFY_ADMIN_PASSWORD ?? ''
const slskdUrl = process.env.SLSKD_URL ?? 'http://slskd:5030'
const slskdKey = process.env.SLSKD_API_KEY ?? ''
const sourceDir = process.env.SLSKD_SOURCE_DIR ?? '/slskd'

if (!downtifyUrl || !adminUsername || !adminPassword || (!off && !slskdKey)) {
  console.error('Set DOWNTIFY_URL, DOWNTIFY_ADMIN_USERNAME, DOWNTIFY_ADMIN_PASSWORD and SLSKD_API_KEY (not needed with --off).')
  process.exit(1)
}

// Downtify's settings routes need an admin's browser session; a device token is refused.
let sessionCookie = ''

async function signIn() {
  const response = await fetch(`${downtifyUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: adminUsername, password: adminPassword }), signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`Downtify refused the admin sign-in (HTTP ${response.status})`)
  sessionCookie = response.headers.getSetCookie().map((value) => value.split(';')[0]).find((value) => value.startsWith('downtify_session=')) ?? ''
  if (!sessionCookie) throw new Error('Downtify did not return a session')
}

async function downtify(path, init = {}) {
  const response = await fetch(`${downtifyUrl}${path}`, { ...init, headers: { Cookie: sessionCookie, 'Content-Type': 'application/json', ...init.headers }, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`)
  return response.json()
}

async function main() {
  await signIn()
  const current = await downtify('/api/settings')

  // Seconds before a stuck Soulseek transfer is abandoned and the next source is tried.
  const update = off
    ? { audio_providers: ['youtube-music'], slskd: { ...current.slskd, enabled: false } }
    : {
        audio_providers: ['youtube-music', 'youtube', 'slskd'],
        format: 'original',
        slskd: { ...current.slskd, enabled: true, base_url: slskdUrl, api_key: slskdKey, source_dir: sourceDir, leave_in_place: false, download_timeout_seconds: 300, queued_timeout_seconds: 90, extensions: ['flac', 'mp3'], strict_format_priority: true, min_bitrate: 256, download_attempts: 3 },
      }

  if (dryRun) {
    console.log(JSON.stringify({ ...update, slskd: { ...update.slskd, api_key: update.slskd.api_key ? '***' : '' } }, null, 2))
    return
  }

  await downtify('/api/settings/update', { method: 'POST', body: JSON.stringify(update) })
  console.log(off ? 'Soulseek is off; Downtify uses YouTube Music only.' : 'Settings saved. Audio sources: YouTube Music, YouTube, slskd.')

  if (!off) {
    const result = await downtify('/api/slskd/test', { method: 'POST', body: '{}' })
    console.log(result.ok ? `Connected to ${result.server ?? 'slskd'}.` : 'The slskd test failed:')
    for (const check of result.checks ?? []) console.log(`  ${check.id}: ${check.status}${check.code ? ` (${check.code})` : ''}${check.detail ? ` ${check.detail}` : ''}`)
    if (!result.ok) process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(`Failed: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
