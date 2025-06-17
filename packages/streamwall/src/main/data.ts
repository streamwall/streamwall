import TOML from '@iarna/toml'
import { Repeater } from '@repeaterjs/repeater'
import { watch } from 'chokidar'
import { EventEmitter, once } from 'events'
import { promises as fsPromises } from 'fs'
import { isArray } from 'lodash-es'
import fetch from 'node-fetch'
import { promisify } from 'util'
import {
  StreamData,
  StreamDataContent,
  StreamList,
} from '../../../streamwall-shared/src/types'

const sleep = promisify(setTimeout)

type DataSource = AsyncGenerator<StreamDataContent[]>

export async function* pollDataURL(url: string, intervalSecs: number) {
  const refreshInterval = intervalSecs * 1000
  let lastData = []
  while (true) {
    let data: StreamDataContent[] = []
    try {
      const resp = await fetch(url)
      data = (await resp.json()) as StreamDataContent[]
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

export async function* watchDataFile(path: string): DataSource {
  const watcher = watch(path)
  while (true) {
    let data
    try {
      const text = await fsPromises.readFile(path)
      data = TOML.parse(text.toString())
    } catch (err) {
      console.warn('error reading data file', err)
    }
    if (data && isArray(data.streams)) {
      // TODO: type validate with Zod
      yield data.streams as unknown as StreamList
    } else {
      yield []
    }
    await once(watcher, 'change')
  }
}

export async function* markDataSource(dataSource: DataSource, name: string) {
  for await (const streamList of dataSource) {
    for (const s of streamList) {
      s._dataSource = name
    }
    yield streamList
  }
}

export async function* combineDataSources(
  dataSources: DataSource[],
  idGen: StreamIDGenerator,
) {
  for await (const streamLists of Repeater.latest(dataSources)) {
    const dataByURL = new Map<string, StreamData>()
    for (const list of streamLists) {
      for (const data of list) {
        const existing = dataByURL.get(data.link)
        dataByURL.set(data.link, { ...existing, ...data } as StreamData)
      }
    }

    const streams = idGen.process([...dataByURL.values()]) as StreamList

    // Retain the index to speed up local lookups
    streams.byURL = dataByURL
    yield streams
  }
}

interface LocalStreamDataEvents {
  update: [StreamDataContent[]]
}

export class LocalStreamData extends EventEmitter<LocalStreamDataEvents> {
  dataByURL: Map<string, StreamDataContent>

  constructor(entries: StreamDataContent[] = []) {
    super()
    this.dataByURL = new Map()
    for (const entry of entries) {
      if (!entry.link) {
        continue
      }
      this.dataByURL.set(entry.link, entry)
    }
  }

  update(url: string, data: Partial<StreamDataContent>) {
    const existing = this.dataByURL.get(url)
    const kind = data.kind ?? existing?.kind ?? 'video'
    const updated: StreamDataContent = { ...existing, ...data, kind, link: url }
    this.dataByURL.set(data.link ?? url, updated)
    if (data.link != null && url !== data.link) {
      this.dataByURL.delete(url)
    }
    this._emitUpdate()
  }

  delete(url: string) {
    this.dataByURL.delete(url)
    this._emitUpdate()
  }

  _emitUpdate() {
    this.emit('update', [...this.dataByURL.values()])
  }

  gen(): AsyncGenerator<StreamDataContent[]> {
    return new Repeater(async (push, stop) => {
      await push([...this.dataByURL.values()])
      this.on('update', push)
      await stop
      this.off('update', push)
    })
  }
}

export class StreamIDGenerator {
  idMap: Map<string, string>
  idSet: Set<string>

  constructor() {
    this.idMap = new Map()
    this.idSet = new Set()
  }

  process(streams: StreamDataContent[]) {
    const { idMap, idSet } = this

    for (const stream of streams) {
      const { link, source, label } = stream
      let streamId = idMap.get(link)
      if (streamId == null) {
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

        streamId = newId
        idMap.set(link, streamId)
        idSet.add(streamId)
      }

      stream._id = streamId
    }
    return streams
  }
}
