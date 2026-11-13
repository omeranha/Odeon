import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const INTERNAL_TOKEN_PATH = join(process.env.DATA_DIR?.trim() || tmpdir(), 'internal-token')
