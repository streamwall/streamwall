import fs from 'fs'
import yargs from 'yargs'
import TOML from '@iarna/toml'
import { Repeater } from '@repeaterjs/repeater'
import { app, shell, session, BrowserWindow } from 'electron'

import { ensureValidURL } from '../util'
import {
  pollDataURL,
  watchDataFile,
  StreamIDGenerator,
  markDataSource,
  combineDataSources,
} from './data'
import StreamWindow from './StreamWindow'
import TwitchBot from './TwitchBot'
import StreamdelayClient from './StreamdelayClient'
import initWebServer from './server'

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
    .group(['data.json-url', 'data.toml-file'], 'Datasources')
    .option('data.json-url', {
      describe: 'Fetch streams from the specified URL(s)',
      array: true,
      default: ['https://woke.net/api/streams.json'],
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
        'twitch.announce.interval-seconds',
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
    .help().argv
}

async function main() {
  const argv = parseArgs()
  if (argv.help) {
    return
  }

  // Reject all permission requests from web content.
  session
    .fromPartition('persist:session')
    .setPermissionRequestHandler((webContents, permission, callback) => {
      callback(false)
    })

  const idGen = new StreamIDGenerator()
  let updateCustomStreams
  const customStreamData = new Repeater(async (push) => {
    await push([])
    updateCustomStreams = push
  })

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

  let browseWindow = null
  let twitchBot = null
  let streamdelayClient = null

  const clientState = {
    config: {
      width: argv.window.width,
      height: argv.window.height,
      gridCount: argv.grid.count,
    },
    streams: [],
    customStreams: [],
    views: [],
    streamdelay: null,
  }
  const getInitialState = () => clientState
  let broadcastState = () => {}
  const onMessage = (msg) => {
    if (msg.type === 'set-views') {
      streamWindow.setViews(new Map(msg.views))
    } else if (msg.type === 'set-listening-view') {
      streamWindow.setListeningView(msg.viewIdx)
    } else if (msg.type === 'set-view-blurred') {
      streamWindow.setViewBlurred(msg.viewIdx, msg.blurred)
    } else if (msg.type === 'set-custom-streams') {
      updateCustomStreams(msg.streams)
    } else if (msg.type === 'reload-view') {
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
        ensureValidURL(msg.url)
        browseWindow.loadURL(msg.url)
      } else if (msg.type === 'dev-tools') {
        streamWindow.openDevTools(msg.viewIdx, browseWindow.webContents)
      }
    } else if (msg.type === 'set-stream-censored' && streamdelayClient) {
      streamdelayClient.setCensored(msg.isCensored)
    }
  }

  if (argv.control.address) {
    ;({ broadcastState } = await initWebServer({
      certDir: argv.cert.dir,
      certProduction: argv.cert.production,
      email: argv.cert.email,
      url: argv.control.address,
      hostname: argv.control.hostname,
      port: argv.control.port,
      username: argv.control.username,
      password: argv.control.password,
      getInitialState,
      onMessage,
    }))
    if (argv.control.open) {
      shell.openExternal(argv.control.address)
    }
  }

  if (argv.streamdelay.key) {
    streamdelayClient = new StreamdelayClient({
      endpoint: argv.streamdelay.endpoint,
      key: argv.streamdelay.key,
    })
    streamdelayClient.on('state', (state) => {
      clientState.streamdelay = state
      broadcastState(clientState)
    })
    streamdelayClient.connect()
  }

  if (argv.twitch.token) {
    twitchBot = new TwitchBot(argv.twitch)
    twitchBot.connect()
  }

  streamWindow.on('state', (viewStates) => {
    clientState.views = viewStates
    streamWindow.send('state', clientState)
    broadcastState(clientState)
    if (twitchBot) {
      twitchBot.onState(clientState)
    }
  })

  const dataSources = [
    ...argv.data['json-url'].map((url) =>
      markDataSource(pollDataURL(url), 'json-url'),
    ),
    ...argv.data['toml-file'].map((path) =>
      markDataSource(watchDataFile(path), 'toml-file'),
    ),
    markDataSource(customStreamData, 'custom'),
  ]

  for await (const rawStreams of combineDataSources(dataSources)) {
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
