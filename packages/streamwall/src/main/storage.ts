import { Low, Memory } from 'lowdb'
import { JSONFilePreset } from 'lowdb/node'
import { StreamDataContent } from 'streamwall-shared'

export interface StreamwallStoredData {
  stateDoc: string
  localStreamData: StreamDataContent[]
}

const defaultData: StreamwallStoredData = {
  stateDoc: '',
  localStreamData: [],
}

export type StorageDB = Low<StreamwallStoredData>

export async function loadStorage(dbPath: string) {
  let db: StorageDB | undefined = undefined

  try {
    db = await JSONFilePreset<StreamwallStoredData>(dbPath, defaultData)
  } catch (err) {
    console.warn(
      'Failed to load storage at',
      dbPath,
      ' -- changes will not be persisted',
    )
    db = new Low<StreamwallStoredData>(new Memory(), defaultData)
  }

  return db
}
