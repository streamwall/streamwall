import baseX from 'base-x'
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto'
import EventEmitter from 'events'
import {
  type AuthTokenInfo,
  type StreamwallRole,
  type StreamwallState,
  validRolesSet,
} from 'streamwall-shared'
import { promisify } from 'util'
import type { StoredData } from './storage.ts'

export interface AuthToken extends AuthTokenInfo {
  tokenHash: string
}

export interface AuthState {
  invites: AuthTokenInfo[]
  sessions: AuthTokenInfo[]
}

interface AuthEvents {
  state: [AuthState]
}

const scrypt = promisify(scryptCb)

const base62 = baseX(
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
)

export function rand62(len: number) {
  return base62.encode(randomBytes(len))
}

export function uniqueRand62(len: number, map: Map<string, unknown>) {
  let val = rand62(len)
  while (map.has(val)) {
    // Regenerate in case of a collision
    val = rand62(len)
  }
  return val
}

async function hashToken62(token: string, salt: string) {
  const hashBuffer = await scrypt(token, salt, 24)
  return base62.encode(hashBuffer as Buffer)
}

// Wrapper for state data to facilitate role-scoped data access.
export class StateWrapper extends EventEmitter {
  _value: StreamwallState

  constructor(value: StreamwallState) {
    super()
    this._value = value
  }

  toJSON() {
    return '<state data>'
  }

  view(role: StreamwallRole) {
    const {
      config,
      auth,
      streams,
      customStreams,
      views,
      streamdelay,
      savedLayouts,
      grids,
    } = this._value

    const state: StreamwallState = {
      identity: {
        role,
      },
      config,
      streams,
      customStreams,
      views,
      streamdelay,
      savedLayouts,
      grids,
    }
    if (role === 'admin') {
      state.auth = auth
    }

    return state
  }

  update(value: Partial<StreamwallState>) {
    this._value = { ...this._value, ...value }
    this.emit('state', this)
  }

  // Unprivileged getter
  get info() {
    return this.view('monitor')
  }
}

export class Auth extends EventEmitter<AuthEvents> {
  salt: string
  tokensById: Map<string, AuthToken>

  constructor({ salt, tokens = [] }: Partial<StoredData['auth']> = {}) {
    super()
    this.salt = salt ?? rand62(24)
    this.tokensById = new Map()
    for (const token of tokens) {
      this.tokensById.set(token.tokenId, token)
    }
  }

  getStoredData() {
    return {
      salt: this.salt,
      tokens: [...this.tokensById.values()],
    }
  }

  getState() {
    const toTokenInfo = ({ tokenId, name, kind, role }: AuthTokenInfo) => ({
      tokenId,
      name,
      kind,
      role,
    })
    const tokens = Array.from(this.tokensById.values())
    return {
      invites: tokens
        .filter((t) => t.kind === 'invite')
        .map(toTokenInfo),
      sessions: tokens
        .filter((t) => t.kind === 'session')
        .map(toTokenInfo),
    }
  }

  emitState() {
    this.emit('state', this.getState())
  }

  async validateToken(
    id: string,
    secret: string,
  ): Promise<AuthTokenInfo | null> {
    const tokenHash = await hashToken62(secret, this.salt)
    const tokenData = this.tokensById.get(id)

    if (!tokenData) {
      return null
    }

    const providedTokenHashBuf = Buffer.from(tokenHash)
    const expectedTokenHashBuf = Buffer.from(tokenData.tokenHash)
    const isTokenMatch = timingSafeEqual(
      providedTokenHashBuf,
      expectedTokenHashBuf,
    )
    if (!isTokenMatch) {
      return null
    }

    return {
      tokenId: tokenData.tokenId,
      kind: tokenData.kind,
      role: tokenData.role,
      name: tokenData.name,
    }
  }

  async createToken({ kind, role, name }: Omit<AuthTokenInfo, 'tokenId'>) {
    if (!validRolesSet.has(role)) {
      throw new Error(`invalid role: ${role}`)
    }

    const tokenId = uniqueRand62(8, this.tokensById)
    const secret = rand62(24)
    const tokenHash = await hashToken62(secret, this.salt)
    const tokenData = {
      tokenId,
      tokenHash,
      kind,
      role,
      name,
    }
    this.tokensById.set(tokenId, tokenData)
    this.emitState()

    console.log(`Created ${kind} token:`, { tokenId, role, name })

    return { tokenId, secret }
  }

  deleteToken(tokenId: string) {
    const tokenData = this.tokensById.get(tokenId)
    if (!tokenData) {
      return
    }
    this.tokensById.delete(tokenData.tokenId)
    this.emitState()
  }
}
