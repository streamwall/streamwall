import { EventEmitter, once } from 'events'
import { promises as fsPromises } from 'fs'
import { promisify } from 'util'
import { Repeater } from '@repeaterjs/repeater'
import TOML from '@iarna/toml'
import request from 'undici'
import chokidar from 'chokidar'

const sleep = promisify(setTimeout)

export async function* pollDataURL(url, intervalSecs) {
  const refreshInterval = intervalSecs * 1000
  let lastData = []
  while (true) {
    let data = []
    try {
      const resp = await request(url)
      data = await resp.json()
    } catch (err) {
      console.warn('error loading stream data', err)
    }

    // If the endpoint errors or returns an empty dataset, keep the cached data.
    if (!data.length && lastData.length) {
      console.warn('using cached stream data')
    } else {
      yield data
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
    const dataByURL = new Map()
    for (const list of streamLists) {
      for (const data of list) {
        const existing = dataByURL.get(data.link)
        dataByURL.set(data.link, { ...existing, ...data })
      }
    }
    const streams = [...dataByURL.values()]
    // Retain the index to speed up local lookups
    streams.byURL = dataByURL
    yield streams
  }
}

export class LocalStreamData extends EventEmitter {
  constructor() {
    super()
    this.dataByURL = new Map()
  }

  update(url, data) {
    if (!data.link) {
      data.link = url
    }
    const existing = this.dataByURL.get(url)
    this.dataByURL.set(data.link, { ...existing, ...data })
    if (url !== data.link) {
      this.dataByURL.delete(url)
    }
    this._emitUpdate()
  }

  delete(url) {
    this.dataByURL.delete(url)
    this._emitUpdate()
  }

  _emitUpdate() {
    this.emit('update', [...this.dataByURL.values()])
  }

  gen() {
    return new Repeater(async (push, stop) => {
      await push([])
      this.on('update', push)
      await stop
      this.off('update', push)
    })
  }
}

export class StreamIDGenerator {
  constructor() {
    this.idMap = new Map()
    this.idSet = new Set()
  }

  process(streams) {
    const { idMap, idSet } = this

    for (const stream of streams) {
      const { link, source, label } = stream
      if (!idMap.has(link)) {
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
        } while (idSet.has(newId))

        idMap.set(link, newId)
        idSet.add(newId)
      }

      stream._id = idMap.get(link)
    }
    return streams
  }
}
