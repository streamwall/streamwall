import { promisify } from 'util'
import fetch from 'node-fetch'
import csv from 'csvtojson'

const sleep = promisify(setTimeout)

const PUBLIC_DATA_URL = 'https://woke.net/csv'
const PUBLIC_DATA_REFRESH_INTERVAL = 5 * 60 * 1000

export async function* pollPublicData() {
  while (true) {
    const resp = await fetch(PUBLIC_DATA_URL)
    const text = await resp.text()
    const data = await csv().fromString(text)
    yield data.filter((d) => d.Link && d.Status === 'Live')
    sleep(PUBLIC_DATA_REFRESH_INTERVAL)
  }
}
