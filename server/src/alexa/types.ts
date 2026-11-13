// The parts of Alexa's request and response formats this skill uses.
// https://developer.amazon.com/en-US/docs/alexa/custom-skills/request-and-response-json-reference.html

export interface AlexaRequestEnvelope {
  version: string
  session?: { new?: boolean; application?: { applicationId: string }; user?: { userId: string } }
  context?: {
    System?: { application?: { applicationId: string }; user?: { userId: string }; device?: { deviceId: string } }
    AudioPlayer?: { token?: string; offsetInMilliseconds?: number; playerActivity?: string }
  }
  request: {
    type: string
    requestId?: string
    timestamp?: string
    locale?: string
    token?: string
    offsetInMilliseconds?: number
    intent?: { name: string; slots?: Record<string, { name: string; value?: string }> }
    error?: { type?: string; message?: string }
  }
}

export interface AudioItem {
  stream: { url: string; token: string; offsetInMilliseconds: number; expectedPreviousToken?: string }
  metadata?: { title?: string; subtitle?: string; art?: { sources: { url: string }[] } }
}

export type AlexaDirective = { type: 'AudioPlayer.Play'; playBehavior: 'REPLACE_ALL' | 'ENQUEUE' | 'REPLACE_ENQUEUED'; audioItem: AudioItem } | { type: 'AudioPlayer.Stop' } | { type: 'AudioPlayer.ClearQueue'; clearBehavior: 'CLEAR_ENQUEUED' | 'CLEAR_ALL' }

export interface AlexaResponse {
  version: '1.0'
  response: {
    outputSpeech?: { type: 'PlainText'; text: string }
    reprompt?: { outputSpeech: { type: 'PlainText'; text: string } }
    directives?: AlexaDirective[]
    shouldEndSession?: boolean
  }
}
