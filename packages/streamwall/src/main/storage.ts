import type { Low } from 'lowdb'
import { JSONFilePreset } from 'lowdb/node'

export interface StreamwallStoredData {
  stateDoc: string
}

const defaultData: StreamwallStoredData = {
  stateDoc: '',
}

export type StorageDB = Low<StreamwallStoredData>

export async function loadStorage(dbPath: string) {
  const db = await JSONFilePreset<StreamwallStoredData>(dbPath, defaultData)
  return db
}
