import type { Low } from 'lowdb'
import { JSONFilePreset } from 'lowdb/node'
import process from 'node:process'
import type { AuthToken } from './auth.ts'

export interface StoredData {
  auth: {
    salt: string | null
    tokens: AuthToken[]
  }
  streamwallToken: null | {
    tokenId: string
    secret: string
  }
}

const defaultData: StoredData = {
  auth: {
    salt: null,
    tokens: [],
  },
  streamwallToken: null,
}

export type StorageDB = Low<StoredData>

export async function loadStorage() {
  const dbPath = process.env.DB_PATH || 'storage.json'
  const db = await JSONFilePreset<StoredData>(dbPath, defaultData)
  return db
}
