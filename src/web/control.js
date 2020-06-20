import range from 'lodash/range'
import ReconnectingWebSocket from 'reconnecting-websocket'
import { h, Fragment, render } from 'preact'
import { useEffect, useState, useCallback, useRef } from 'preact/hooks'
import { State } from 'xstate'
import styled, { css } from 'styled-components'

import '../index.css'
import { GRID_COUNT } from '../constants'
import SoundIcon from '../static/volume-up-solid.svg'
import ReloadIcon from '../static/redo-alt-solid.svg'
import LifeRingIcon from '../static/life-ring-regular.svg'

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
  const [streams, setStreams] = useState([])
  const [customStreams, setCustomStreams] = useState([])
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
        const {
          streams: newStreams,
          views,
          customStreams: newCustomStreams,
        } = msg.state
        const newStateIdxMap = emptyStateIdxMap()
        const allStreams = [...newStreams, ...newCustomStreams]
        for (const viewState of views) {
          const { pos, url } = viewState.context
          if (!url) {
            continue
          }
          const streamId = allStreams.find((d) => d.Link === url)?._id
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
        setStreams(newStreams)
        setCustomStreams(newCustomStreams)
      } else {
        console.warn('unexpected ws message', msg)
      }
    })
    wsRef.current = ws
  }, [])

  const handleSetView = useCallback(
    (idx, streamId) => {
      const newSpaceIdxMap = new Map(stateIdxMap)
      const url = [...streams, ...customStreams].find((d) => d._id === streamId)
        ?.Link
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
    [streams, customStreams, stateIdxMap],
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

  const handleBrowse = useCallback((url) => {
    wsRef.current.send(
      JSON.stringify({
        type: 'browse',
        url,
      }),
    )
  }, [])

  const handleChangeCustomStream = useCallback((idx, customStream) => {
    let newCustomStreams = [...customStreams]
    newCustomStreams[idx] = customStream
    newCustomStreams = newCustomStreams.filter((s) => s.Link)
    wsRef.current.send(
      JSON.stringify({
        type: 'set-custom-streams',
        streams: newCustomStreams,
      }),
    )
  })

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
                const { streamId, isListening, url, state } = stateIdxMap.get(
                  idx,
                )
                return (
                  <GridInput
                    idx={idx}
                    url={url}
                    onChangeSpace={handleSetView}
                    spaceValue={streamId}
                    isError={state.matches('displaying.error')}
                    isDisplaying={state.matches('displaying')}
                    isListening={isListening}
                    onSetListening={handleSetListening}
                    onReloadView={handleReloadView}
                    onBrowse={handleBrowse}
                  />
                )
              })}
            </StyledGridLine>
          ))}
        </div>
        <div>
          {isConnected
            ? [...streams, ...customStreams.values()].map((row) => (
                <StreamLine id={row._id} row={row} />
              ))
            : 'loading...'}
        </div>
        <h2>Custom Streams</h2>
        <div>
          {/*
            Include an empty object at the end to create an extra input for a new custom stream.
            We need it to be part of the array (rather than JSX below) for DOM diffing to match the key and retain focus.
           */}
          {[...customStreams, { Link: '', Label: '' }].map(
            ({ Link, Label }, idx) => (
              <CustomStreamInput
                key={idx}
                idx={idx}
                Link={Link}
                Label={Label}
                onChange={handleChangeCustomStream}
              />
            ),
          )}
        </div>
      </StyledDataContainer>
    </div>
  )
}

function StreamLine({ id, row: { Label, Source, Title, Link, Notes } }) {
  return (
    <StyledStreamLine>
      <StyledId>{id}</StyledId>
      <div>
        {Label ? (
          Label
        ) : (
          <>
            <strong>{Source}</strong>{' '}
            <a href={Link} target="_blank">
              {Title || Link}
            </a>{' '}
            {Notes}
          </>
        )}
      </div>
    </StyledStreamLine>
  )
}

function GridInput({
  idx,
  url,
  onChangeSpace,
  spaceValue,
  isDisplaying,
  isError,
  isListening,
  onSetListening,
  onReloadView,
  onBrowse,
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
  const handleBrowseClick = useCallback(() => onBrowse(url), [url, onBrowse])
  const handleClick = useCallback((ev) => {
    ev.target.select()
  })
  return (
    <StyledGridContainer>
      <StyledGridButtons side="left">
        {isDisplaying && (
          <StyledButton onClick={handleReloadClick}>
            <ReloadIcon />
          </StyledButton>
        )}
        {isError && (
          <StyledButton onClick={handleBrowseClick}>
            <LifeRingIcon />
          </StyledButton>
        )}
      </StyledGridButtons>
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

function CustomStreamInput({ idx, onChange, ...props }) {
  const handleChangeLink = useCallback(
    (ev) => {
      onChange(idx, { ...props, Link: ev.target.value })
    },
    [onChange],
  )
  const handleChangeLabel = useCallback(
    (ev) => {
      onChange(idx, { ...props, Label: ev.target.value })
    },
    [onChange],
  )
  return (
    <div>
      <input
        onChange={handleChangeLink}
        placeholder="https://..."
        value={props.Link}
      />
      <input
        onChange={handleChangeLabel}
        placeholder="Label (optional)"
        value={props.Label}
      />
    </div>
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
