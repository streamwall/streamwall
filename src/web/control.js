import range from 'lodash/range'
import ReconnectingWebSocket from 'reconnecting-websocket'
import { h, render } from 'preact'
import { useEffect, useState, useCallback, useRef } from 'preact/hooks'
import styled from 'styled-components'

import '../index.css'
import SoundIcon from '../static/volume-up-solid.svg'

function App({ wsEndpoint }) {
  const wsRef = useRef()
  const [isConnected, setIsConnected] = useState(false)
  const [streamData, setStreamData] = useState()
  const [spaceIdxMap, setSpaceIdxMap] = useState(new Map())
  const [listeningIdxSet, setListeningIdxSet] = useState(new Set())

  useEffect(() => {
    const ws = new ReconnectingWebSocket(wsEndpoint, [], {
      maxReconnectionDelay: 5000,
      minReconnectionDelay: 1000 + Math.random() * 500,
      reconnectionDelayGrowFactor: 1.1,
    })
    ws.addEventListener('open', () => setIsConnected(true))
    ws.addEventListener('close', () => setIsConnected(false))
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.type === 'state') {
        const { streams, views } = msg.state
        setStreamData(streams)

        const newSpaceIdxMap = new Map()
        const newListeningIdxSet = new Set()
        for (const viewState of views) {
          const { pos, url } = viewState.context
          if (!url) {
            continue
          }
          const streamId = streams.find((d) => d.Link === url)?._id
          const isListening =
            viewState.state.displaying?.running === 'listening'
          for (const space of pos.spaces) {
            newSpaceIdxMap.set(space, streamId)
            if (isListening) {
              newListeningIdxSet.add(space)
            }
          }
        }
        setSpaceIdxMap(newSpaceIdxMap)
        setListeningIdxSet(newListeningIdxSet)
      } else {
        console.warn('unexpected ws message', msg)
      }
    })
    wsRef.current = ws
  }, [])

  const handleSetSpace = useCallback(
    (idx, id) => {
      const newSpaceIdxMap = new Map(spaceIdxMap)
      if (id !== undefined) {
        newSpaceIdxMap.set(idx, id)
      } else {
        newSpaceIdxMap.delete(idx)
      }
      setSpaceIdxMap(newSpaceIdxMap)

      const views = Array.from(newSpaceIdxMap, ([spaceIdx, streamId]) => [
        spaceIdx,
        streamData.find((d) => d._id === streamId)?.Link,
      ]).filter(([s, i]) => i)
      wsRef.current.send(JSON.stringify({ type: 'set-views', views }))
    },
    [streamData, spaceIdxMap],
  )

  const handleSetListening = useCallback((idx, listening) => {
    wsRef.current.send(
      JSON.stringify({
        type: 'set-listening-view',
        viewIdx: listening ? idx : null,
      }),
    )
  }, [])

  return (
    <div>
      <h1>Stream Wall</h1>
      <div>
        connection status: {isConnected ? 'connected' : 'connecting...'}
      </div>
      <div>
        {range(0, 3).map((y) => (
          <StyledGridLine>
            {range(0, 3).map((x) => {
              const idx = 3 * y + x
              return (
                <GridInput
                  idx={idx}
                  onChangeSpace={handleSetSpace}
                  spaceValue={spaceIdxMap.get(idx)}
                  isListening={listeningIdxSet.has(idx)}
                  onSetListening={handleSetListening}
                />
              )
            })}
          </StyledGridLine>
        ))}
      </div>
      <div>
        {streamData
          ? streamData.map((row) => <StreamLine id={row._id} row={row} />)
          : 'loading...'}
      </div>
    </div>
  )
}

function StreamLine({ id, row: { Source, Title, Link, Notes } }) {
  return (
    <StyledStreamLine>
      <StyledId>{id}</StyledId>
      <div>
        <strong>{Source}</strong> <a href={Link}>{Title || Link}</a> {Notes}
      </div>
    </StyledStreamLine>
  )
}

function GridInput({
  idx,
  onChangeSpace,
  spaceValue,
  isListening,
  onSetListening,
}) {
  const [editingValue, setEditingValue] = useState()
  const handleFocus = useCallback((ev) => {
    setEditingValue(ev.target.value)
  })
  const handleBlur = useCallback((ev) => {
    setEditingValue(undefined)
  })
  const handleChange = useCallback(
    (ev) => {
      const { name, value } = ev.target
      setEditingValue(value)
      onChangeSpace(Number(name), value)
    },
    [onChangeSpace],
  )
  const handleListeningClick = useCallback(
    () => onSetListening(idx, !isListening),
    [idx, onSetListening, isListening],
  )
  const handleClick = useCallback((ev) => {
    ev.target.select()
  })
  return (
    <StyledGridContainer>
      <ListeningButton
        isListening={isListening}
        onClick={handleListeningClick}
        tabIndex={1}
      />
      <StyledGridInput
        name={idx}
        value={editingValue || spaceValue || ''}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onClick={handleClick}
        onChange={handleChange}
      />
    </StyledGridContainer>
  )
}

function ListeningButton(props) {
  return (
    <StyledListeningButton {...props}>
      <SoundIcon />
    </StyledListeningButton>
  )
}

const StyledGridLine = styled.div`
  display: flex;
`

const StyledListeningButton = styled.button`
  display: flex;
  align-items: center;
  border: 2px solid gray;
  border-color: ${({ isListening }) => (isListening ? 'red' : 'gray')};
  background: ${({ isListening }) => (isListening ? '#c77' : '#ccc')};
  border-radius: 5px;

  &:focus {
    outline: none;
    box-shadow: 0 0 10px orange inset;
  }

  svg {
    width: 20px;
    height: 20px;
  }
`

const StyledGridContainer = styled.div`
  position: relative;

  ${StyledListeningButton} {
    position: absolute;
    bottom: 5px;
    right: 5px;
  }
`

const StyledGridInput = styled.input`
  width: 150px;
  height: 50px;
  padding: 20px;
  border: 2px solid black;
  font-size: 20px;
  text-align: center;

  &:focus {
    outline: none;
    box-shadow: 0 0 5px orange inset;
  }
`

const StyledId = styled.div`
  flex-shrink: 0;
  margin-right: 5px;
  background: #333;
  color: white;
  padding: 3px;
  border-radius: 5px;
  width: 3em;
  text-align: center;
`

const StyledStreamLine = styled.div`
  display: flex;
  align-items: center;
  margin: 0.5em 0;
`

function main() {
  const script = document.getElementById('main-script')
  render(<App wsEndpoint={script.dataset.wsEndpoint} />, document.body)
}

main()
