import { app } from 'electron'
import { promises as fsPromises, stat } from 'fs'
import path from 'path'
import throttle from 'lodash/throttle'

const stateFilePath = path.join(app.getPath('userData'), 'streamwall.json')

let lastState = {}

async function _save(partialState) {
  const state = { ...lastState, ...partialState }
  lastState = state
  const data = JSON.stringify(state)
  await fsPromises.writeFile(stateFilePath, data)
}

export const save = throttle(_save, 501)

export async function load() {
  try {
    const data = await fsPromises.readFile(stateFilePath)
    return JSON.parse(data)
  } catch (err) {
    if (err.code === 'ENOENT') {
      // Ignore missing file.
    } else {
      console.warn('error reading persisted state:', err)
    }
    return {}
  }
}
