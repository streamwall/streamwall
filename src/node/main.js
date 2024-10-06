import fs from 'fs'
import path from 'path'
import yargs from 'yargs'
import TOML from '@iarna/toml'
import * as Y from 'yjs'
import * as Sentry from '@sentry/electron/main'
import { app, shell, session, BrowserWindow } from 'electron'

import { ensureValidURL } from '../util'
import {
  pollDataURL,
  watchDataFile,
  LocalStreamData,
  StreamIDGenerator,
  markDataSource,
  combineDataSources,
} from './data'
import * as persistence from './persistence'
import { Auth, StateWrapper } from './auth'
import StreamWindow from './StreamWindow'
import TwitchBot from './TwitchBot'
import StreamdelayClient from './StreamdelayClient'
import initWebServer from './server'

const SENTRY_DSN =
  'https://e630a21dcf854d1a9eb2a7a8584cbd0b@o459879.ingest.sentry.io/5459505'

function parseArgs() {
  return yargs
    .config('config', (configPath) => {
      return TOML.parse(fs.readFileSync(configPath, 'utf-8'))
    })
    .group(['grid.count'], 'Grid dimensions')
    .option('grid.count', {
      number: true,
      default: 3,
    })
    .group(
      [
        'window.width',
        'window.height',
        'window.x',
        'window.y',
        'window.frameless',
        'window.background-color',
        'window.active-color',
      ],
      'Window settings',
    )
    .option('window.x', {
      number: true,
    })
    .option('window.y', {
      number: true,
    })
    .option('window.width', {
      number: true,
      default: 1920,
    })
    .option('window.height', {
      number: true,
      default: 1080,
    })
    .option('window.frameless', {
      boolean: true,
      default: false,
    })
    .option('window.background-color', {
      describe: 'Background color of wall (useful for chroma-keying)',
      default: '#000',
    })
    .option('window.active-color', {
      describe: 'Active (highlight) color of wall',
      default: '#fff',
    })
    .group(['data.interval', 'data.json-url', 'data.toml-file'], 'Datasources')
    .option('data.interval', {
      describe: 'Interval (in seconds) for refreshing polled data sources',
      number: true,
      default: 30,
    })
    .option('data.json-url', {
      describe: 'Fetch streams from the specified URL(s)',
      array: true,
      default: [],
    })
    .option('data.toml-file', {
      describe: 'Fetch streams from the specified file(s)',
      normalize: true,
      array: true,
      default: [],
    })
    .group(
      [
        'twitch.channel',
        'twitch.username',
        'twitch.password',
        'twitch.color',
        'twitch.announce.template',
        'twitch.announce.interval',
        'twitch.vote.template',
        'twitch.vote.interval',
      ],
      'Twitch Chat',
    )
    .option('twitch.channel', {
      describe: 'Name of Twitch channel',
      default: null,
    })
    .option('twitch.username', {
      describe: 'Username of Twitch bot account',
      default: null,
    })
    .option('twitch.password', {
      describe: 'Password of Twitch bot account',
      default: null,
    })
    .option('twitch.color', {
      describe: 'Color of Twitch bot username',
      default: '#ff0000',
    })
    .option('twitch.announce.template', {
      describe: 'Message template for stream announcements',
      default:
        'SingsMic <%- stream.source %> <%- stream.city && stream.state ? `(${stream.city} ${stream.state})` : `` %> <%- stream.link %>',
    })
    .option('twitch.announce.interval', {
      describe:
        'Minimum time interval (in seconds) between re-announcing the same stream',
      number: true,
      default: 60,
    })
    .option('twitch.announce.delay', {
      describe: 'Time to dwell on a stream before its details are announced',
      number: true,
      default: 30,
    })
    .option('twitch.vote.template', {
      describe: 'Message template for vote result announcements',
      default: 'Switching to #<%- selectedIdx %> (with <%- voteCount %> votes)',
    })
    .option('twitch.vote.interval', {
      describe: 'Time interval (in seconds) between votes (0 to disable)',
      number: true,
      default: 0,
    })
    .group(
      [
        'control.username',
        'control.password',
        'control.address',
        'control.hostname',
        'control.port',
        'control.open',
      ],
      'Control Webserver',
    )
    .option('control.username', {
      describe: 'Web control server username',
    })
    .option('control.password', {
      describe: 'Web control server password',
    })
    .option('control.open', {
      describe: 'After launching, open the control website in a browser',
      boolean: true,
      default: true,
    })
    .option('control.address', {
      describe: 'Enable control webserver and specify the URL',
      implies: ['control.username', 'control.password'],
    })
    .option('control.hostname', {
      describe: 'Override hostname the control server listens on',
    })
    .option('control.port', {
      describe: 'Override port the control server listens on',
      number: true,
    })
    .group(
      ['cert.dir', 'cert.production', 'cert.email'],
      'Automatic SSL Certificate',
    )
    .option('cert.dir', {
      describe: 'Private directory to store SSL certificate in',
      implies: ['email'],
      default: null,
    })
    .option('cert.production', {
      describe: 'Obtain a real SSL certificate using production servers',
    })
    .option('cert.email', {
      describe: 'Email for owner of SSL certificate',
    })
    .group(['streamdelay.endpoint', 'streamdelay.key'], 'Streamdelay')
    .option('streamdelay.endpoint', {
      describe: 'URL of Streamdelay endpoint',
      default: 'http://localhost:8404',
    })
    .option('streamdelay.key', {
      describe: 'Streamdelay API key',
      default: null,
    })
    .group(['telemetry.sentry'], 'Telemetry')
    .option('telemetry.sentry', {
      describe: 'Enable error reporting to Sentry',
      boolean: true,
      default: true,
    })
    .help().argv
}

async function main(argv) {
  // Reject all permission requests from web content.
  session
    .fromPartition('persist:session')
    .setPermissionRequestHandler((webContents, permission, callback) => {
      callback(false)
    })

  console.debug('Loading persistence data...')
  const persistData = await persistence.load()

  console.debug('Creating StreamWindow...')
  const idGen = new StreamIDGenerator()
  const localStreamData = new LocalStreamData()
  const overlayStreamData = new LocalStreamData()

  const streamWindow = new StreamWindow({
    gridCount: argv.grid.count,
    width: argv.window.width,
    height: argv.window.height,
    x: argv.window.x,
    y: argv.window.y,
    frameless: argv.window.frameless,
    backgroundColor: argv.window['background-color'],
  })
  streamWindow.init()

  console.debug('Creating Auth...')
  const auth = new Auth({
    adminUsername: argv.control.username,
    adminPassword: argv.control.password,
    persistData: persistData.auth,
    logEnabled: true,
  })

  let browseWindow = null
  let twitchBot = null
  let streamdelayClient = null

  console.debug('Creating initial state...')
  let clientState = new StateWrapper({
    config: {
      width: argv.window.width,
      height: argv.window.height,
      gridCount: argv.grid.count,
      activeColor: argv.window['active-color'],
    },
    auth: auth.getState(),
    streams: [],
    views: [],
    streamdelay: null,
  })

  const stateDoc = new Y.Doc()
  const viewsState = stateDoc.getMap('views')
  stateDoc.transact(() => {
    for (let i = 0; i < argv.grid.count ** 2; i++) {
      const data = new Y.Map()
      data.set('streamId', '')
      viewsState.set(i, data)
    }
  })
  viewsState.observeDeep(() => {
    try {
      const viewContentMap = new Map()
      for (const [key, viewData] of viewsState) {
        const stream = clientState.info.streams.find(
          (s) => s._id === viewData.get('streamId'),
        )
        if (!stream) {
          continue
        }
        viewContentMap.set(key, {
          url: stream.link,
          kind: stream.kind || 'video',
        })
      }
      streamWindow.setViews(viewContentMap, clientState.info.streams)
    } catch (err) {
      console.error('Error updating views', err)
    }
  })

  const onMessage = async (msg, respond) => {
    console.debug('Received message:', msg)
    if (msg.type === 'set-listening-view') {
      console.debug('Setting listening view:', msg.viewIdx)
      streamWindow.setListeningView(msg.viewIdx)
    } else if (msg.type === 'set-view-background-listening') {
      console.debug('Setting view background listening:', msg.viewIdx, msg.listening)
      streamWindow.setViewBackgroundListening(msg.viewIdx, msg.listening)
    } else if (msg.type === 'set-view-blurred') {
      console.debug('Setting view blurred:', msg.viewIdx, msg.blurred)
      streamWindow.setViewBlurred(msg.viewIdx, msg.blurred)
    } else if (msg.type === 'rotate-stream') {
      console.debug('Rotating stream:', msg.url, msg.rotation)
      overlayStreamData.update(msg.url, {
        rotation: msg.rotation,
      })
    } else if (msg.type === 'update-custom-stream') {
      console.debug('Updating custom stream:', msg.url)
      localStreamData.update(msg.url, msg.data)
    } else if (msg.type === 'delete-custom-stream') {
      console.debug('Deleting custom stream:', msg.url)
      localStreamData.delete(msg.url)
    } else if (msg.type === 'reload-view') {
      console.debug('Reloading view:', msg.viewIdx)
      streamWindow.reloadView(msg.viewIdx)
    } else if (msg.type === 'browse' || msg.type === 'dev-tools') {
      if (
        msg.type === 'dev-tools' &&
        browseWindow &&
        !browseWindow.isDestroyed()
      ) {
        // DevTools needs a fresh webContents to work. Close any existing window.
        browseWindow.destroy()
        browseWindow = null
      }
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
      if (msg.type === 'browse') {
        console.debug('Attempting to browse URL:', msg.url)
        try {
          ensureValidURL(msg.url)
          browseWindow.loadURL(msg.url)
        } catch (error) {
          console.error('Invalid URL:', msg.url)
          console.error('Error:', error)
        }
    } else if (msg.type === 'dev-tools') {
        console.debug('Opening DevTools for view:', msg.viewIdx)
        streamWindow.openDevTools(msg.viewIdx, browseWindow.webContents)
      }
    } else if (msg.type === 'set-stream-censored' && streamdelayClient) {
      console.debug('Setting stream censored:', msg.isCensored)
      streamdelayClient.setCensored(msg.isCensored)
    } else if (msg.type === 'set-stream-running' && streamdelayClient) {
      console.debug('Setting stream running:', msg.isStreamRunning)
      streamdelayClient.setStreamRunning(msg.isStreamRunning)
    } else if (msg.type === 'create-invite') {
      console.debug('Creating invite for role:', msg.role)
      const { secret } = await auth.createToken({
        kind: 'invite',
        role: msg.role,
        name: msg.name,
      })
      respond({ name: msg.name, secret })
    } else if (msg.type === 'delete-token') {
      console.debug('Deleting token:', msg.tokenId)
      auth.deleteToken(msg.tokenId)
    }
  }

  function updateState(newState) {
    clientState.update(newState)
    streamWindow.onState(clientState.info)
    if (twitchBot) {
      twitchBot.onState(clientState.info)
    }
  }

  if (argv.control.address) {
    console.debug('Initializing web server...')
    const webDistPath = path.join(app.getAppPath(), './.webpack/main/web')
    console.debug('Web dist path:', webDistPath)
    await initWebServer({
      certDir: argv.cert.dir,
      certProduction: argv.cert.production,
      email: argv.cert.email,
      url: argv.control.address,
      hostname: argv.control.hostname,
      port: argv.control.port,
      logEnabled: true,
      webDistPath,
      auth,
      clientState,
      onMessage,
      stateDoc,
    })
    if (argv.control.open) {
      shell.openExternal(argv.control.address)
    }
  }

  if (argv.streamdelay.key) {
    console.debug('Setting up Streamdelay client...')
    streamdelayClient = new StreamdelayClient({
      endpoint: argv.streamdelay.endpoint,
      key: argv.streamdelay.key,
    })
    streamdelayClient.on('state', (state) => {
      updateState({ streamdelay: state })
    })
    streamdelayClient.connect()
  }

  if (argv.twitch.token) {
    console.debug('Setting up Twitch bot...')
    twitchBot = new TwitchBot(argv.twitch)
    twitchBot.on('setListeningView', (idx) => {
      streamWindow.setListeningView(idx)
    })
    twitchBot.connect()
  }

  streamWindow.on('state', (viewStates) => {
    updateState({ views: viewStates })
  })

  streamWindow.on('close', () => {
    process.exit(0)
  })

  auth.on('state', (authState) => {
    updateState({ auth: authState })
    persistence.save({ auth: auth.getPersistData() })
  })

  const dataSources = [
    ...argv.data['json-url'].map((url) => {
      console.debug('Setting data source from json-url:', url)
      return markDataSource(pollDataURL(url, argv.data.interval), 'json-url')
    }),
    ...argv.data['toml-file'].map((path) => {
      console.debug('Setting data source from toml-file:', path)
      return markDataSource(watchDataFile(path), 'toml-file')
    }),
    markDataSource(localStreamData.gen(), 'custom'),
    overlayStreamData.gen(),
  ]

  for await (const rawStreams of combineDataSources(dataSources)) {
    console.debug('Processing streams:', rawStreams)
    const streams = idGen.process(rawStreams)
    updateState({ streams })
  }
}

function init() {
  console.debug('Parsing command line arguments...')
  const argv = parseArgs()
  if (argv.help) {
    return
  }

  console.debug('Initializing Sentry...')
  if (argv.telemetry.sentry) {
    Sentry.init({ dsn: SENTRY_DSN })
  }

  console.debug('Setting up Electron...')
  app.commandLine.appendSwitch('high-dpi-support', 1)
  app.commandLine.appendSwitch('force-device-scale-factor', 1)

  console.debug('Enabling Electron sandbox...')
  app.enableSandbox()
  app
    .whenReady()
    .then(() => main(argv))
    .catch((err) => {
      console.trace(err.toString())
      process.exit(1)
    })
}

if (require.main === module) {
  console.debug('Starting Streamwall...')
  init()
}
