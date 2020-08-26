import EventEmitter from 'events'
import { randomBytes, scrypt as scryptCb } from 'crypto'
import { promisify } from 'util'

import { validRoles } from '../roles'

const scrypt = promisify(scryptCb)

const base62 = require('base-x')(
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
)

function rand62(len) {
  return base62.encode(randomBytes(len))
}

async function hashToken62(token, salt) {
  const hashBuffer = await scrypt(token, salt, 24)
  return base62.encode(hashBuffer)
}

// Wrapper for state data to facilitate role-scoped data access.
export class StateWrapper extends EventEmitter {
  constructor(value) {
    super()
    this._value = value
  }

  toJSON() {
    return '<state data>'
  }

  view(role) {
    const {
      config,
      auth,
      streams,
      customStreams,
      views,
      streamdelay,
    } = this._value

    const state = {
      config,
      streams,
      customStreams,
      views,
      streamdelay,
    }
    if (role === 'admin') {
      state.auth = auth
    }

    return state
  }

  update(value) {
    this._value = { ...this._value, ...value }
    this.emit('state', this)
  }

  // Unprivileged getter
  get info() {
    return this.view()
  }
}

export class Auth extends EventEmitter {
  constructor({ adminUsername, adminPassword, persistData, logEnabled }) {
    super()
    this.adminUsername = adminUsername
    this.adminPassword = adminPassword
    this.logEnabled = logEnabled || false
    this.salt = persistData?.salt || rand62(16)
    this.tokensById = new Map()
    this.tokensByHash = new Map()
    for (const token of persistData?.tokens ?? []) {
      this.tokensById.set(token.id, token)
      this.tokensByHash.set(token.tokenHash, token)
    }
  }

  getPersistData() {
    return {
      salt: this.salt,
      tokens: [...this.tokensById.values()],
    }
  }

  getState() {
    const toTokenInfo = ({ id, name, role }) => ({ id, name, role })
    return {
      invites: [...this.tokensById.values()]
        .filter((t) => t.kind === 'invite')
        .map(toTokenInfo),
      sessions: [...this.tokensById.values()]
        .filter((t) => t.kind === 'session')
        .map(toTokenInfo),
    }
  }

  emitState() {
    this.emit('state', this.getState())
  }

  admin() {
    return { id: 'admin', kind: 'admin', name: 'admin', role: 'admin' }
  }

  async validateToken(secret) {
    const tokenHash = await hashToken62(secret, this.salt)
    const tokenData = this.tokensByHash.get(tokenHash)
    if (!tokenData) {
      return null
    }
    return {
      id: tokenData.id,
      kind: tokenData.kind,
      role: tokenData.role,
      name: tokenData.name,
    }
  }

  async createToken({ kind, role, name }) {
    if (!validRoles.has(role)) {
      throw new Error(`invalid role: ${role}`)
    }
    let id = rand62(8)
    // Regenerate in case of an id collision
    while (this.tokensById.has(id)) {
      id = rand62(8)
    }
    const secret = rand62(24)
    const tokenHash = await hashToken62(secret, this.salt)
    const tokenData = {
      id,
      tokenHash,
      kind,
      role,
      name,
    }
    this.tokensById.set(id, tokenData)
    this.tokensByHash.set(tokenHash, tokenData)
    this.emitState()

    if (this.logEnabled) {
      console.log(`Created ${kind} token:`, { id, role, name })
    }

    return { id, secret }
  }

  deleteToken(tokenId) {
    const tokenData = this.tokensById.get(tokenId)
    if (!tokenData) {
      return
    }
    this.tokensById.delete(tokenData.id)
    this.tokensByHash.delete(tokenData.tokenHash)
    this.emitState()
  }
}
