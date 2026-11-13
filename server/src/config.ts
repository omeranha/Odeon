function optional(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

function required(name: string): string {
  const value = optional(name)
  if (!value) throw new Error(`Missing required environment variable ${name}`)
  return value
}

function withoutTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

function list(name: string): string[] {
  return (optional(name) ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

const downtifyUrl = optional('DOWNTIFY_URL')
const downtifyToken = optional('DOWNTIFY_TOKEN')
const downtifyAdminUsername = optional('DOWNTIFY_ADMIN_USERNAME')
const downtifyAdminPassword = optional('DOWNTIFY_ADMIN_PASSWORD')
const origins = list('WEBAUTHN_ORIGINS').map(withoutTrailingSlash)
const alexaSkillId = optional('ALEXA_SKILL_ID')
const alexaUsername = optional('ALEXA_USERNAME')
const slskdUrl = optional('SLSKD_URL')
const slskdApiKey = optional('SLSKD_API_KEY')
const libraryDir = optional('LIBRARY_DIR')

export const config = {
  // Plays YouTube Music songs straight from YouTube instead of waiting for Downtify to download them first.
  directStreaming: optional('DIRECT_STREAM')?.toLowerCase() !== 'false',
  port: Number(optional('PORT') ?? 3000),
  navidromeUrl: withoutTrailingSlash(required('NAVIDROME_URL')),
  staticDir: optional('STATIC_DIR'),
  dataDir: optional('DATA_DIR'),
  // Swaps a library song's YouTube audio for a verified lossless copy from Soulseek, re-encoded as 256 kbps AAC in the same file.
  quality: slskdUrl && slskdApiKey && libraryDir ? { slskdUrl: withoutTrailingSlash(slskdUrl), slskdApiKey, slskdDir: optional('SLSKD_DIR') ?? '/slskd', libraryDir, autoMinutes: Number(optional('QUALITY_AUTO_MINUTES') ?? 60) || 0, autoUser: optional('QUALITY_AUTO_USER') ?? 'admin' } : null,
  downtify:
    downtifyUrl && downtifyToken
      ? { url: withoutTrailingSlash(downtifyUrl), token: downtifyToken, adminLogin: downtifyAdminUsername && downtifyAdminPassword ? { username: downtifyAdminUsername, password: downtifyAdminPassword } : undefined }
      : null,
  // Connections from these addresses may set CF-Connecting-IP / X-Forwarded-For (e.g. the cloudflared container).
  trustedProxies: list('TRUSTED_PROXIES'),
  // Passkeys are bound to this domain; invite links use the first origin.
  webauthn: { rpId: required('WEBAUTHN_RP_ID'), rpName: optional('WEBAUTHN_RP_NAME') ?? 'Odeon', origins: origins.length > 0 ? origins : [required('WEBAUTHN_ORIGINS')] },
  // Echo devices fetch audio themselves, so stream links must be public HTTPS addresses with a trusted certificate.
  alexa: alexaSkillId && alexaUsername ? { skillId: alexaSkillId, username: alexaUsername, publicUrl: withoutTrailingSlash(optional('ALEXA_PUBLIC_URL') ?? origins[0] ?? '') } : null,
}
