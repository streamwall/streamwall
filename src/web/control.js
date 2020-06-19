import range from 'lodash/range'
import ReconnectingWebSocket from 'reconnecting-websocket'
import { h, render } from 'preact'
import { useEffect, useState, useCallback, useRef } from 'preact/hooks'
import { State } from 'xstate'
import styled, { css } from 'styled-components'

import '../index.css'
import { GRID_COUNT } from '../constants'
import SoundIcon from '../static/volume-up-solid.svg'
import ReloadIcon from '../static/redo-alt-solid.svg'

function emptyStateIdxMap() {
  return new Map(
    range(GRID_COUNT * GRID_COUNT).map((idx) => [
      idx,
      {
        streamId: null,
        url: null,
        state: State.from({}),
        isListening: false,
      },
    ]),
  )
}

function App({ wsEndpoint }) {
  const wsRef = useRef()
  const [isConnected, setIsConnected] = useState(false)
  const [streamData, setStreamData] = useState()
  const [stateIdxMap, setStateIdxMap] = useState(emptyStateIdxMap())

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
        const newStateIdxMap = emptyStateIdxMap()
        for (const viewState of views) {
          const { pos, url } = viewState.context
          if (!url) {
            continue
          }
          const streamId = streams.find((d) => d.Link === url)?._id
          const state = State.from(viewState.state)
          const isListening = state.matches('displaying.running.listening')
          for (const space of pos.spaces) {
            Object.assign(newStateIdxMap.get(space), {
              streamId,
              url,
              state,
              isListening,
            })
          }
        }
        setStateIdxMap(newStateIdxMap)
        setStreamData(streams)
      } else {
        console.warn('unexpected ws message', msg)
      }
    })
    wsRef.current = ws
  }, [])

  const handleSetView = useCallback(
    (idx, streamId) => {
      const newSpaceIdxMap = new Map(stateIdxMap)
      const url = streamData.find((d) => d._id === streamId)?.Link
      if (url) {
        newSpaceIdxMap.set(idx, {
          ...newSpaceIdxMap.get(idx),
          streamId,
          url,
        })
      } else {
        newSpaceIdxMap.set(idx, {
          ...newSpaceIdxMap.get(idx),
          streamId: null,
          url: null,
        })
      }
      const views = Array.from(newSpaceIdxMap, ([space, { url }]) => [
        space,
        url,
      ])
      wsRef.current.send(JSON.stringify({ type: 'set-views', views }))
    },
    [streamData, stateIdxMap],
  )

  const handleSetListening = useCallback((idx, listening) => {
    wsRef.current.send(
      JSON.stringify({
        type: 'set-listening-view',
        viewIdx: listening ? idx : null,
      }),
    )
  }, [])

  const handleReloadView = useCallback((idx) => {
    wsRef.current.send(
      JSON.stringify({
        type: 'reload-view',
        viewIdx: idx,
      }),
    )
  }, [])

  return (
    <div>
      <h1>Stream Wall</h1>
      <div>
        connection status: {isConnected ? 'connected' : 'connecting...'}
      </div>
      <StyledDataContainer isConnected={isConnected}>
        <div>
          {range(0, 3).map((y) => (
            <StyledGridLine>
              {range(0, 3).map((x) => {
                const idx = 3 * y + x
                const { streamId, isListening, state } = stateIdxMap.get(idx)
                return (
                  <GridInput
                    idx={idx}
                    onChangeSpace={handleSetView}
                    spaceValue={streamId}
                    isError={state.matches('error')}
                    isDisplaying={state.matches('displaying')}
                    isListening={isListening}
                    onSetListening={handleSetListening}
                    onReloadView={handleReloadView}
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
      </StyledDataContainer>
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
  isDisplaying,
  isError,
  isListening,
  onSetListening,
  onReloadView,
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
  const handleReloadClick = useCallback(() => onReloadView(idx), [
    idx,
    onReloadView,
  ])
  const handleClick = useCallback((ev) => {
    ev.target.select()
  })
  return (
    <StyledGridContainer>
      {isDisplaying && (
        <StyledGridButtons side="left">
          <StyledButton onClick={handleReloadClick}>
            <ReloadIcon />
          </StyledButton>
        </StyledGridButtons>
      )}
      <StyledGridButtons side="right">
        <ListeningButton
          isListening={isListening}
          onClick={handleListeningClick}
          tabIndex={1}
        />
      </StyledGridButtons>
      <StyledGridInput
        name={idx}
        value={editingValue || spaceValue || ''}
        isError={isError}
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

const StyledDataContainer = styled.div`
  opacity: ${({ isConnected }) => (isConnected ? 1 : 0.5)};
`

const StyledGridLine = styled.div`
  display: flex;
`

const StyledButton = styled.button`
  display: flex;
  align-items: center;
  border: 2px solid gray;
  border-color: gray;
  background: #ccc;
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

const StyledListeningButton = styled(StyledButton)`
  ${({ isListening }) =>
    isListening &&
    `
      border-color: red;
      background: #c77;
    `};
`

const StyledGridContainer = styled.div`
  position: relative;
`

const StyledGridButtons = styled.div`
  display: flex;
  position: absolute;
  bottom: 0;
  ${({ side }) => (side === 'left' ? 'left: 0' : 'right: 0')};

  ${StyledButton} {
    margin: 5px;
  }
`

const StyledGridInput = styled.input`
  width: 150px;
  height: 50px;
  padding: 20px;
  border: 2px solid ${({ isError }) => (isError ? 'red' : 'black')};
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
