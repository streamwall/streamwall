import { promisify } from 'util'
import fetch from 'node-fetch'

const sleep = promisify(setTimeout)

function filterLive(data) {
  return data.filter(({ status }) => status === 'Live' || status === 'Unknown')
}

function compareStrings(a, b) {
  if (a < b) {
    return -1
  } else if (b < a) {
    return 1
  } else {
    return 0
  }
}

export async function* pollPublicData() {
  const publicDataURL = 'https://woke.net/api/streams.json'
  const refreshInterval = 5 * 1000
  let lastData = []
  while (true) {
    let data = []
    try {
      const resp = await fetch(publicDataURL)
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

export class StreamIDGenerator {
  constructor(parent) {
    this.idMap = new Map(parent ? parent.idMap : null)
    this.idSet = new Set(this.idMap.values())
  }

  process(streams) {
    const { idMap, idSet } = this
    for (const stream of streams) {
      const { link, source, label } = stream
      if (!idMap.has(link)) {
        let counter = 0
        let newId
        const normalizedText = (source || label || link)
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
    streams.sort((a, b) => compareStrings(a._id, b._id))
    return streams
  }
}
