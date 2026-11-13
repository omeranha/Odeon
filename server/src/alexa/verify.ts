import { X509Certificate, verify as verifySignature } from 'node:crypto'
import { rootCertificates } from 'node:tls'
import type { AlexaRequestEnvelope } from './types.ts'

// Amazon's rules for custom skills on their own HTTPS endpoint:
// https://developer.amazon.com/en-US/docs/alexa/custom-skills/host-a-custom-skill-as-a-web-service.html
const MAX_REQUEST_AGE_MS = 150_000
const PEM_PATTERN = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g

export class AlexaVerificationError extends Error {}

export interface AlexaRequestHeaders {
  certUrl?: string
  signature?: string
}

export type AlexaVerifier = (headers: AlexaRequestHeaders, body: string) => Promise<AlexaRequestEnvelope>

// The chain must come from Amazon's S3 bucket for Alexa, nowhere else.
function checkCertUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new AlexaVerificationError('Invalid certificate URL')
  }
  // URL parsing resolves "../" segments, so the path check can't be sidestepped with them.
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 's3.amazonaws.com' || !url.pathname.startsWith('/echo.api/') || (url.port !== '' && url.port !== '443')) {
    throw new AlexaVerificationError("Certificate URL is not Amazon's")
  }
  return url.href
}

function validNow(certificate: X509Certificate, now: number): boolean {
  return Date.parse(certificate.validFrom) <= now && now <= Date.parse(certificate.validTo)
}

export function createAlexaVerifier(options: { skillId: string; roots?: X509Certificate[]; now?: () => number; fetchChain?: (url: string) => Promise<string> }): AlexaVerifier {
  const roots = options.roots ?? rootCertificates.map((pem) => new X509Certificate(pem))
  const now = options.now ?? Date.now
  const fetchChain = options.fetchChain ?? (async (url: string) => (await fetch(url, { signal: AbortSignal.timeout(10_000) })).text())
  const signingCertificates = new Map<string, { certificate: X509Certificate; expires: number }>()

  async function signingCertificate(url: string): Promise<X509Certificate> {
    const cached = signingCertificates.get(url)
    if (cached && cached.expires > now()) return cached.certificate
    const chain = ((await fetchChain(url)).match(PEM_PATTERN) ?? []).map((pem) => new X509Certificate(pem))
    const leaf = chain[0]
    if (!leaf) throw new AlexaVerificationError('Empty certificate chain')
    if (!chain.every((certificate) => validNow(certificate, now()))) throw new AlexaVerificationError('Certificate expired or not yet valid')
    if (!(leaf.subjectAltName ?? '').split(/,\s*/).includes('DNS:echo-api.amazon.com')) throw new AlexaVerificationError('Certificate is not for echo-api.amazon.com')
    for (let index = 0; index < chain.length - 1; index++) {
      if (!chain[index].checkIssued(chain[index + 1]) || !chain[index].verify(chain[index + 1].publicKey)) throw new AlexaVerificationError('Broken certificate chain')
    }
    const top = chain[chain.length - 1]
    const anchored = roots.some((root) => root.fingerprint256 === top.fingerprint256 || (Boolean(top.checkIssued(root)) && top.verify(root.publicKey)))
    if (!anchored) throw new AlexaVerificationError('Certificate chain is not trusted')
    if (signingCertificates.size > 20) signingCertificates.clear()
    signingCertificates.set(url, { certificate: leaf, expires: Math.min(...chain.map((certificate) => Date.parse(certificate.validTo))) })
    return leaf
  }

  return async (headers, body) => {
    if (!headers.certUrl || !headers.signature) throw new AlexaVerificationError('Missing signature headers')
    const certificate = await signingCertificate(checkCertUrl(headers.certUrl))
    if (!verifySignature('sha256', Buffer.from(body, 'utf8'), certificate.publicKey, Buffer.from(headers.signature, 'base64'))) throw new AlexaVerificationError('Bad signature')
    let envelope: AlexaRequestEnvelope
    try {
      envelope = JSON.parse(body) as AlexaRequestEnvelope
    } catch {
      throw new AlexaVerificationError('Body is not JSON')
    }
    const timestamp = Date.parse(envelope.request?.timestamp ?? '')
    if (!(Math.abs(now() - timestamp) <= MAX_REQUEST_AGE_MS)) throw new AlexaVerificationError('Request is too old')
    const skillId = envelope.context?.System?.application?.applicationId ?? envelope.session?.application?.applicationId
    if (skillId !== options.skillId) throw new AlexaVerificationError('Request is for another skill')
    return envelope
  }
}
