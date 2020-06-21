import fs from 'fs'
import yargs from 'yargs'
import { app, shell, session, BrowserWindow } from 'electron'

import { ensureValidURL } from '../util'
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
    .option('hostname', {
      describe: 'Override hostname the control server listens on',
    })
    .option('port', {
      describe: 'Override port the control server listens on',
      number: true,
    })
    .option('cert-dir', {
      describe: 'Private directory to store SSL certificate in',
    })
    .option('cert-production', {
      describe: 'Obtain a real SSL certificate using production servers',
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

  // Reject all permission requests from web content.
  session
    .fromPartition('persist:session')
    .setPermissionRequestHandler((webContents, permission, callback) => {
      callback(false)
    })

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
      ensureValidURL(msg.url)
      if (!browseWindow || browseWindow.isDestroyed()) {
        browseWindow = new BrowserWindow({
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            partition: 'persist:session',
            sandbox: true,
          },
        })
      }
      browseWindow.loadURL(msg.url)
    }
  }

  if (argv.webserver) {
    ;({ broadcastState } = await initWebServer({
      certDir: argv.certDir,
      certProduction: argv.certProduction,
      email: argv.email,
      url: argv.webserver,
      hostname: argv.hostname,
      port: argv.port,
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
