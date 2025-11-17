import { render } from 'preact'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import ReconnectingWebSocket from 'reconnecting-websocket'
import {
  type CollabData,
  ControlUI,
  GlobalStyle,
  type StreamwallConnection,
  useStreamwallState,
  useYDoc,
} from 'streamwall-control-ui'
import {
  type ControlCommand,
  stateDiff,
  type StreamwallState,
} from 'streamwall-shared'
import * as Y from 'yjs'

function useStreamwallWebsocketConnection(
  wsEndpoint: string,
): StreamwallConnection {
  const wsRef = useRef<{
    ws: ReconnectingWebSocket
    msgId: number
    responseMap: Map<number, (msg: object) => void>
  }>()
  const [isConnected, setIsConnected] = useState(false)
  const {
    docValue: sharedState,
    doc: stateDoc,
    setDoc: setStateDoc,
  } = useYDoc<CollabData>(['views', 'uiState'])
  const [streamwallState, setStreamwallState] = useState<StreamwallState>()
  const appState = useStreamwallState(streamwallState)

  // Set up Yjs send handler
  const handleSendUpdate = useCallback((update: Uint8Array, origin: string) => {
    if (origin === 'server') {
      return
    }
    console.log('Sending Yjs update to server, size:', update.length)
    wsRef.current?.ws.send(update)
  }, [])

  useEffect(() => {
    stateDoc.on('update', handleSendUpdate)
    return () => {
      stateDoc.off('update', handleSendUpdate)
    }
  }, [stateDoc, handleSendUpdate])

  useEffect(() => {
    let lastStateData: StreamwallState | undefined
    const ws = new ReconnectingWebSocket(wsEndpoint, [], {
      maxReconnectionDelay: 5000,
      minReconnectionDelay: 1000 + Math.random() * 500,
      reconnectionDelayGrowFactor: 1.1,
    })
    ws.binaryType = 'arraybuffer'
    ws.addEventListener('close', () => {
      setStreamwallState(undefined)
      lastStateData = undefined
      setStateDoc(new Y.Doc())
      setIsConnected(false)
    })
    ws.addEventListener('message', (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        // Handle Yjs binary updates
        console.log('Received Yjs update from server, size:', ev.data.byteLength)
        Y.applyUpdate(stateDoc, new Uint8Array(ev.data), 'server')
        return
      }
      const msg = JSON.parse(ev.data)
      if (msg.response && wsRef.current != null) {
        const { responseMap } = wsRef.current
        const responseCb = responseMap.get(msg.id)
        if (responseCb) {
          responseMap.delete(msg.id)
          responseCb(msg)
        }
      } else if (msg.type === 'state' || msg.type === 'state-delta') {
        let state: StreamwallState
        if (msg.type === 'state') {
          state = msg.state
          setIsConnected(true)
        } else {
          // Clone so updated object triggers React renders
          state = stateDiff.clone(
            stateDiff.patch(lastStateData, msg.delta),
          ) as StreamwallState
        }
        lastStateData = state
        setStreamwallState(state)
      } else {
        console.warn('unexpected ws message', msg)
      }
    })
    wsRef.current = { ws, msgId: 0, responseMap: new Map() }
  }, [stateDoc])

  const send = useCallback(
    (msg: ControlCommand, cb?: (msg: unknown) => void) => {
      if (!wsRef.current) {
        throw new Error('Websocket not initialized')
      }
      const { ws, msgId, responseMap } = wsRef.current
      ws.send(
        JSON.stringify({
          ...msg,
          id: msgId,
        }),
      )
      if (cb) {
        responseMap.set(msgId, cb)
      }
      wsRef.current.msgId++
    },
    [],
  )

  useEffect(() => {
    if (!wsRef.current) {
      return
    }
    // Connection establishment and teardown is handled by ReconnectingWebSocket
    return () => {
      // Cleanup if needed
    }
  }, [])

  return {
    ...appState,
    isConnected,
    send,
    sharedState,
    stateDoc,
  }
}

function App() {
  const { BASE_URL } = import.meta.env

  const connection = useStreamwallWebsocketConnection(
    (BASE_URL === '/' ? `ws://${location.host}` : BASE_URL) + '/client/ws',
  )

  return (
    <>
      <GlobalStyle />
      <ControlUI connection={connection} />
    </>
  )
}

render(<App />, document.body)
