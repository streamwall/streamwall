import fs from 'fs'
import yargs from 'yargs'
import { app, shell, BrowserWindow } from 'electron'

import { pollPublicData, pollSpreadsheetData, StreamIDGenerator } from './data'
import StreamWindow from './StreamWindow'
import initWebServer from './server'

async function main() {
  const argv = yargs
    .config('config', (configPath) => {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    })
    .group(['gs-creds', 'gs-id', 'gs-tab'], 'Spreadsheet Configuration')
    .option('gs-creds', {
      describe: 'credentials file for Google Spreadsheet access',
      implies: ['gs-id', 'gs-tab'],
    })
    .option('gs-id', {
      describe: 'Google Spreadsheet id',
    })
    .option('gs-tab', {
      describe: 'Google Spreadsheet tab name',
    })
    .group(
      ['webserver', 'cert-dir', 'cert-email', 'hostname', 'port'],
      'Web Server Configuration',
    )
    .option('webserver', {
      describe: 'Enable control webserver and specify the URL',
      implies: ['cert-dir', 'email', 'username', 'password'],
    })
    .option('cert-dir', {
      describe: 'Private directory to store SSL certificate in',
    })
    .option('email', {
      describe: 'Email for owner of SSL certificate',
    })
    .option('username', {
      describe: 'Web control server username',
    })
    .option('password', {
      describe: 'Web control server password',
    })
    .option('open', {
      describe: 'After launching, open the control website in a browser',
      boolean: true,
      default: true,
    })
    .help().argv

  const idGen = new StreamIDGenerator()

  const streamWindow = new StreamWindow()
  streamWindow.init()

  let browseWindow = null

  const clientState = { streams: [], customStreams: [], views: [] }
  const getInitialState = () => clientState
  let broadcastState = () => {}
  const onMessage = (msg) => {
    if (msg.type === 'set-views') {
      streamWindow.setViews(new Map(msg.views))
    } else if (msg.type === 'set-listening-view') {
      streamWindow.setListeningView(msg.viewIdx)
    } else if (msg.type === 'set-custom-streams') {
      const customIDGen = new StreamIDGenerator(idGen)
      clientState.customStreams = customIDGen.process(msg.streams)
      streamWindow.send('state', clientState)
      broadcastState(clientState)
    } else if (msg.type === 'reload-view') {
      streamWindow.reloadView(msg.viewIdx)
    } else if (msg.type === 'browse') {
      if (!browseWindow || browseWindow.isDestroyed()) {
        browseWindow = new BrowserWindow({
          webPreferences: { partition: 'persist:session', sandbox: true },
        })
      }
      browseWindow.loadURL(msg.url)
    }
  }

  if (argv.webserver) {
    ;({ broadcastState } = await initWebServer({
      certDir: argv.certDir,
      email: argv.email,
      url: argv.webserver,
      username: argv.username,
      password: argv.password,
      getInitialState,
      onMessage,
    }))
    if (argv.open) {
      shell.openExternal(argv.webserver)
    }
  }

  streamWindow.on('state', (viewStates) => {
    clientState.views = viewStates
    streamWindow.send('state', clientState)
    broadcastState(clientState)
  })

  let dataGen
  if (argv.gsCreds) {
    dataGen = pollSpreadsheetData(argv.gsCreds, argv.gsId, argv.gsTab)
  } else {
    dataGen = pollPublicData()
  }

  for await (const rawStreams of dataGen) {
    const streams = idGen.process(rawStreams)
    clientState.streams = streams
    streamWindow.send('state', clientState)
    broadcastState(clientState)
  }
}

if (require.main === module) {
  app
    .whenReady()
    .then(main)
    .catch((err) => {
      console.trace(err.toString())
      process.exit(1)
    })
}
