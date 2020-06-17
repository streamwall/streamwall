import zip from 'lodash/zip'
import { promisify } from 'util'
import fetch from 'node-fetch'
import csv from 'csvtojson'
import { GoogleSpreadsheet } from 'google-spreadsheet'

const sleep = promisify(setTimeout)

function filterLive(data) {
  return data.filter((d) => d.Link && d.Status === 'Live')
}

export async function* pollPublicData() {
  const publicDataURL = 'https://woke.net/csv'
  const refreshInterval = 5 * 60 * 1000
  while (true) {
    const resp = await fetch(publicDataURL)
    const text = await resp.text()
    const data = await csv().fromString(text)
    yield filterLive(data)
    await sleep(refreshInterval)
  }
}

export async function* pollSpreadsheetData(creds, sheetId, tabName) {
  const refreshInterval = 10 * 1000

  const doc = new GoogleSpreadsheet(sheetId)
  await doc.useServiceAccountAuth(creds)
  await doc.loadInfo()
  const sheet = Object.values(doc.sheetsById).find((s) => s.title === tabName)
  await sheet.loadHeaderRow()

  while (true) {
    let rows
    try {
      rows = await sheet.getRows()
      const data = rows.map((row) =>
        Object.fromEntries(zip(row._sheet.headerValues, row._rawData)),
      )
      yield filterLive(data)
    } catch (err) {
      console.warn('error fetching rows', err)
    }
    await sleep(refreshInterval)
  }
}

export async function* processData(dataGen) {
  // Give each stream a unique and recognizable short id.
  const idMap = new Map()
  for await (const data of dataGen) {
    for (const stream of data) {
      const { Link, Source } = stream
      if (!idMap.has(Link)) {
        let counter = 0
        let newId
        const normalizedSource = Source.toLowerCase()
          .replace(/[^\w]/g, '')
          .replace(/^the|^https?(www)?/, '')
        do {
          const sourcePart = normalizedSource.substr(0, 3).toLowerCase()
          const counterPart = counter === 0 ? '' : counter
          newId = `${sourcePart}${counterPart}`
          counter++
        } while (idMap.has(newId))
        idMap.set(Link, newId)
      }
      stream._id = idMap.get(Link)
    }
    yield data
  }
}
