import assert from 'assert'
import EventEmitter from 'events'
import ReconnectingWebSocket from 'reconnecting-websocket'
import { StreamDelayStatus } from 'streamwall-shared'
import * as url from 'url'
import WebSocket from 'ws'

export interface StreamdelayClientOptions {
  endpoint: string
  key: string
}

export default class StreamdelayClient extends EventEmitter {
  endpoint: string
  key: string
  ws: ReconnectingWebSocket | null
  status: StreamDelayStatus | null

  constructor({ endpoint, key }: StreamdelayClientOptions) {
    super()
    this.endpoint = endpoint
    this.key = key
    this.ws = null
    this.status = null
  }

  connect() {
    const wsURL = url.resolve(
      this.endpoint.replace(/^http/, 'ws'),
      `ws?key=${this.key}`,
    )
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
    const isConnected = this.ws?.readyState === WebSocket.OPEN
    if (isConnected && !this.status) {
      // Wait until we've received the first status message
      return
    }
    this.emit('state', {
      isConnected,
      ...this.status,
    })
  }

  setCensored(isCensored: boolean) {
    assert(this.ws != null, 'Must be connected')
    this.ws.send(JSON.stringify({ isCensored }))
  }

  setStreamRunning(isStreamRunning: boolean) {
    assert(this.ws != null, 'Must be connected')
    this.ws.send(JSON.stringify({ isStreamRunning }))
  }
}
