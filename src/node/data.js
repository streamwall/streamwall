import { once } from 'events'
import { promises as fsPromises } from 'fs'
import { promisify } from 'util'
import { Repeater } from '@repeaterjs/repeater'
import TOML from '@iarna/toml'
import fetch from 'node-fetch'
import chokidar from 'chokidar'

const sleep = promisify(setTimeout)

function filterLive(data) {
  return data.filter(
    ({ kind, status }) =>
      kind !== 'video' || status === 'Live' || status === 'Unknown',
  )
}

export async function* pollDataURL(url, intervalSecs) {
  const refreshInterval = intervalSecs * 1000
  let lastData = []
  while (true) {
    let data = []
    try {
      const resp = await fetch(url)
      data = await resp.json()
    } catch (err) {
      console.warn('error loading stream data', err)
    }

    // If the endpoint errors or returns an empty dataset, keep the cached data.
    if (!data.length && lastData.length) {
      console.warn('using cached stream data')
    } else {
      yield filterLive(data)
      lastData = data
    }

    await sleep(refreshInterval)
  }
}

export async function* watchDataFile(path) {
  const watcher = chokidar.watch(path)
  while (true) {
    let data
    try {
      const text = await fsPromises.readFile(path)
      data = TOML.parse(text)
    } catch (err) {
      console.warn('error reading data file', err)
    }
    if (data) {
      yield data.streams || []
    }
    await once(watcher, 'change')
  }
}

export async function* markDataSource(dataSource, name) {
  for await (const streamList of dataSource) {
    for (const s of streamList) {
      s._dataSource = name
    }
    yield streamList
  }
}

export async function* combineDataSources(dataSources) {
  for await (const streamLists of Repeater.latest(dataSources)) {
    yield [].concat(...streamLists)
  }
}

export class StreamIDGenerator {
  constructor() {
    this.idMap = new Map()
    this.idSet = new Set()
  }

  process(streams) {
    const { idMap, idSet } = this
    const localIdMap = new Map(idMap)
    const localIdSet = new Set(idSet)

    for (const stream of streams) {
      const { link, source, label, _dataSource } = stream
      if (!localIdMap.has(link)) {
        let counter = 0
        let newId
        const idBase = source || label || link
        if (!idBase) {
          console.warn('skipping empty stream', stream)
          continue
        }
        const normalizedText = idBase
          .toLowerCase()
          .replace(/[^\w]/g, '')
          .replace(/^the|^https?(www)?/, '')
        do {
          const textPart = normalizedText.substr(0, 3).toLowerCase()
          const counterPart = counter === 0 && textPart ? '' : counter
          newId = `${textPart}${counterPart}`
          counter++
        } while (localIdSet.has(newId))

        localIdMap.set(link, newId)
        localIdSet.add(newId)

        // Custom stream ids are not persisted so that editing them doesn't create a bunch of unused ids.
        const persistId = _dataSource !== 'custom'
        if (persistId) {
          idMap.set(link, newId)
          idSet.add(newId)
        }
      }

      stream._id = localIdMap.get(link)
    }
    return streams
  }
}
