import '@fontsource/noto-sans'
import './index.css'

import { render } from 'preact'
import { useCallback, useEffect, useState } from 'preact/hooks'
import { useHotkeys } from 'react-hotkeys-hook'
import {
  CollabData,
  ControlUI,
  GlobalStyle,
  StreamwallConnection,
  useStreamwallState,
  useYDoc,
} from 'streamwall-control-ui'
import { ControlCommand, StreamwallState } from 'streamwall-shared'
import * as Y from 'yjs'
import { StreamwallControlGlobal } from '../preload/controlPreload'

declare global {
  interface Window {
    streamwallControl: StreamwallControlGlobal
  }
}

function useStreamwallIPCConnection(): StreamwallConnection {
  const { docValue: sharedState, doc: stateDoc } = useYDoc<CollabData>([
    'views',
  ])

  const [streamwallState, setStreamwallState] = useState<StreamwallState>()
  const appState = useStreamwallState(streamwallState)

  useEffect(() => {
    // TODO: improve typing (Zod?)
    function handleState(state: StreamwallState) {
      setStreamwallState(state)
    }
    return window.streamwallControl.onState(handleState)
  }, [])

  const send = useCallback(
    async (msg: ControlCommand, cb?: (msg: unknown) => void) => {
      const resp = await window.streamwallControl.invokeCommand(msg)
      cb?.(resp)
    },
    [],
  )

  useEffect(() => {
    function sendUpdate(update: Uint8Array, origin: string) {
      if (origin === 'app') {
        return
      }
      window.streamwallControl.updateYDoc(update)
    }

    function handleUpdate(update: Uint8Array) {
      Y.applyUpdate(stateDoc, update, 'app')
    }

    stateDoc.on('update', sendUpdate)
    const unsubscribeUpdate = window.streamwallControl.onYDoc(handleUpdate)
    return () => {
      stateDoc.off('update', sendUpdate)
      unsubscribeUpdate()
    }
  }, [stateDoc])

  useEffect(() => {
    window.streamwallControl.load()
  }, [])

  return {
    ...appState,
    isConnected: true,
    role: 'local',
    send,
    sharedState,
    stateDoc,
  }
}

function App() {
  const connection = useStreamwallIPCConnection()

  useHotkeys('ctrl+shift+i', () => {
    window.streamwallControl.openDevTools()
  })

  return (
    <>
      <GlobalStyle />
      <ControlUI connection={connection} />
    </>
  )
}

render(<App />, document.body)
