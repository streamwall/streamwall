import EventEmitter from 'events'
import * as url from 'url'
import WebSocket from 'ws'
import ReconnectingWebSocket from 'reconnecting-websocket'

export default class StreamdelayClient extends EventEmitter {
  constructor({ endpoint, key }) {
    super()
    this.endpoint = endpoint
    this.key = key
    this.ws = null
    this.status = null
  }

  connect() {
    const wsURL = url.resolve(this.endpoint, `ws?key=${this.key}`)
    const ws = (this.ws = new ReconnectingWebSocket(wsURL, [], {
      WebSocket,
      maxReconnectionDelay: 5000,
      minReconnectionDelay: 1000 + Math.random() * 500,
      reconnectionDelayGrowFactor: 1.1,
    }))
    ws.addEventListener('open', () => this.emitState())
    ws.addEventListener('close', () => this.emitState())
    ws.addEventListener('message', (ev) => {
      let data
      try {
        data = JSON.parse(ev.data)
      } catch (err) {
        console.error('invalid JSON from streamdelay:', ev.data)
        return
      }
      this.status = data.status
      this.emitState()
    })
  }

  emitState() {
    const isConnected = this.ws.readyState === WebSocket.OPEN
    if (isConnected && !this.status) {
      // Wait until we've received the first status message
      return
    }
    this.emit('state', {
      isConnected,
      ...this.status,
    })
  }

  setCensored(isCensored) {
    this.ws.send(JSON.stringify({ isCensored }))
  }

  setStreamRunning(isStreamRunning) {
    this.ws.send(JSON.stringify({ isStreamRunning }))
  }
}
