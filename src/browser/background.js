import { ipcRenderer } from 'electron'
import { h, render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import styled from 'styled-components'

import '../index.css'

function Background({ streams }) {
  const backgrounds = streams.filter((s) => s.kind === 'background')
  return (
    <div>
      {backgrounds.map((s) => (
        <BackgroundIFrame
          key={s._id}
          src={s.link}
          sandbox="allow-scripts allow-same-origin"
          allow="autoplay"
        />
      ))}
    </div>
  )
}

function App() {
  const [state, setState] = useState({
    streams: [],
  })

  useEffect(() => {
    ipcRenderer.on('state', (ev, state) => {
      setState(state)
    })
  }, [])

  const { streams } = state
  return <Background streams={streams} />
}

const BackgroundIFrame = styled.iframe`
  position: fixed;
  left: 0;
  top: 0;
  width: 100vw;
  height: 100vh;
  border: none;
`

render(<App />, document.body)
