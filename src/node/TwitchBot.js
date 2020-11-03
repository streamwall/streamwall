import EventEmitter from 'events'
import Color from 'color'
import ejs from 'ejs'
import { State } from 'xstate'
import { ChatClient, SlowModeRateLimiter, LoginError } from 'dank-twitch-irc'

const VOTE_RE = /^!(\d+)$/

export default class TwitchBot extends EventEmitter {
  constructor(config) {
    super()
    const { username, token, vote } = config
    this.config = config
    this.announceTemplate = ejs.compile(config.announce.template)
    const client = new ChatClient({
      username,
      password: `oauth:${token}`,
      rateLimits: 'default',
    })
    client.use(new SlowModeRateLimiter(client, 0))
    this.client = client

    this.streams = null
    this.listeningURL = null
    this.dwellTimeout = null
    this.announceTimeouts = new Map()

    if (vote.interval) {
      this.voteTemplate = ejs.compile(config.vote.template)
      this.votes = new Map()
      setInterval(this.tallyVotes.bind(this), vote.interval * 1000)
    }

    client.on('ready', () => {
      this.onReady()
    })
    client.on('error', (err) => {
      console.error('Twitch connection error:', err)
      if (err instanceof LoginError) {
        client.close()
      }
    })
    client.on('close', (err) => {
      console.log('Twitch bot disconnected.')
      if (err != null) {
        console.error('Twitch bot disconnected due to error:', err)
      }
    })
    client.on('PRIVMSG', (msg) => {
      this.onMsg(msg)
    })
  }

  connect() {
    const { client } = this
    client.connect()
  }

  async onReady() {
    const { client } = this
    const { channel, color } = this.config
    await client.setColor(Color(color).object())
    await client.join(channel)
    this.emit('connected')
  }

  onState({ views, streams }) {
    this.streams = streams

    const listeningView = views.find(({ state, context }) =>
      State.from(state, context).matches('displaying.running.audio.listening'),
    )
    if (!listeningView) {
      return
    }

    const listeningURL = listeningView.context.content.url
    if (listeningURL === this.listeningURL) {
      return
    }
    this.listeningURL = listeningURL
    this.onListeningURLChange(listeningURL)
  }

  onListeningURLChange(listeningURL) {
    const { announce } = this.config
    clearTimeout(this.dwellTimeout)
    this.dwellTimeout = setTimeout(() => {
      if (!this.announceTimeouts.has(listeningURL)) {
        this.announce()
      }
    }, announce.delay * 1000)
  }

  async announce() {
    const { client, listeningURL, streams } = this
    const { channel, announce } = this.config

    if (!client.ready) {
      return
    }

    const stream = streams.find((s) => s.link === listeningURL)
    if (!stream) {
      return
    }

    const msg = this.announceTemplate({ stream })
    await client.say(channel, msg)

    const timeout = setTimeout(() => {
      this.announceTimeouts.delete(listeningURL)
      if (this.listeningURL === listeningURL) {
        this.announce()
      }
    }, announce.interval * 1000)
    this.announceTimeouts.set(listeningURL, timeout)
  }

  async tallyVotes() {
    const { client } = this
    const { channel } = this.config
    if (this.votes.size === 0) {
      return
    }

    let voteCount = 0
    let selectedIdx = null
    for (const [idx, value] of this.votes) {
      if (value > voteCount) {
        voteCount = value
        selectedIdx = idx
      }
    }

    const msg = this.voteTemplate({ selectedIdx, voteCount })
    await client.say(channel, msg)

    // Index spaces starting with 1
    this.emit('setListeningView', selectedIdx - 1)

    this.votes = new Map()
  }

  onMsg(msg) {
    const { grid, vote } = this.config
    if (!vote.interval) {
      return
    }

    const match = msg.messageText.match(VOTE_RE)
    if (!match) {
      return
    }

    let idx
    try {
      idx = Number(match[1])
    } catch (err) {
      return
    }

    this.votes.set(idx, (this.votes.get(idx) || 0) + 1)
  }
}
