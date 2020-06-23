import range from 'lodash/range'
import ReconnectingWebSocket from 'reconnecting-websocket'
import { h, Fragment, render } from 'preact'
import { useEffect, useState, useCallback, useRef } from 'preact/hooks'
import { State } from 'xstate'
import styled, { css } from 'styled-components'
import { useHotkeys } from 'react-hotkeys-hook'

import '../index.css'
import { GRID_COUNT } from '../constants'
import SoundIcon from '../static/volume-up-solid.svg'
import NoVideoIcon from '../static/video-slash-solid.svg'
import ReloadIcon from '../static/redo-alt-solid.svg'
import LifeRingIcon from '../static/life-ring-regular.svg'
import WindowIcon from '../static/window-maximize-regular.svg'

function App({ wsEndpoint }) {
  const wsRef = useRef()
  const [isConnected, setIsConnected] = useState(false)
  const [streams, setStreams] = useState([])
  const [customStreams, setCustomStreams] = useState([])
  const [stateIdxMap, setStateIdxMap] = useState(new Map())

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
        const newStateIdxMap = new Map()
        const allStreams = [...newStreams, ...newCustomStreams]
        for (const viewState of views) {
          const { pos, content } = viewState.context
          const stream = allStreams.find((d) => d.Link === content.url)
          const streamId = stream?._id
          const state = State.from(viewState.state)
          const isListening = state.matches(
            'displaying.running.audio.listening',
          )
          const isBlurred = state.matches('displaying.running.video.blurred')
          for (const space of pos.spaces) {
            if (!newStateIdxMap.has(space)) {
              newStateIdxMap.set(space, {})
            }
            Object.assign(newStateIdxMap.get(space), {
              streamId,
              content,
              state,
              isListening,
              isBlurred,
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
      const stream = [...streams, ...customStreams].find(
        (d) => d._id === streamId,
      )
      if (stream) {
        const content = {
          url: stream?.Link,
          kind: stream?.Kind || 'video',
        }
        newSpaceIdxMap.set(idx, {
          ...newSpaceIdxMap.get(idx),
          streamId,
          content,
        })
      } else {
        newSpaceIdxMap.delete(idx)
      }
      const views = Array.from(newSpaceIdxMap, ([space, { content }]) => [
        space,
        content,
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

  const handleSetBlurred = useCallback((idx, blurred) => {
    wsRef.current.send(
      JSON.stringify({
        type: 'set-view-blurred',
        viewIdx: idx,
        blurred: blurred,
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

  const handleDevTools = useCallback((idx) => {
    wsRef.current.send(
      JSON.stringify({
        type: 'dev-tools',
        viewIdx: idx,
      }),
    )
  }, [])

  const handleClickId = useCallback((streamId) => {
    const availableIdx = range(GRID_COUNT * GRID_COUNT).find(
      (i) => !stateIdxMap.has(i),
    )
    if (availableIdx === undefined) {
      return
    }
    handleSetView(availableIdx, streamId)
  })

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

  // Set up keyboard shortcuts.
  // Note: if GRID_COUNT > 3, there will not be keys for view indices > 9.
  for (const idx of range(GRID_COUNT * GRID_COUNT)) {
    useHotkeys(
      `alt+${idx + 1}`,
      () => {
        const isListening = stateIdxMap.get(idx)?.isListening ?? false
        handleSetListening(idx, !isListening)
      },
      [stateIdxMap],
    )
    useHotkeys(
      `alt+shift+${idx + 1}`,
      () => {
        const isBlurred = stateIdxMap.get(idx)?.isBlurred ?? false
        handleSetBlurred(idx, !isBlurred)
      },
      [stateIdxMap],
    )
  }

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
                const {
                  streamId = '',
                  isListening = false,
                  isBlurred = false,
                  content = { url: '' },
                  state,
                } = stateIdxMap.get(idx) || {}
                return (
                  <GridInput
                    idx={idx}
                    url={content.url}
                    spaceValue={streamId}
                    isError={state && state.matches('displaying.error')}
                    isDisplaying={state && state.matches('displaying')}
                    isListening={isListening}
                    isBlurred={isBlurred}
                    onChangeSpace={handleSetView}
                    onSetListening={handleSetListening}
                    onSetBlurred={handleSetBlurred}
                    onReloadView={handleReloadView}
                    onBrowse={handleBrowse}
                    onDevTools={handleDevTools}
                  />
                )
              })}
            </StyledGridLine>
          ))}
        </div>
        <div>
          {isConnected
            ? [...streams, ...customStreams.values()].map((row) => (
                <StreamLine id={row._id} row={row} onClickId={handleClickId} />
              ))
            : 'loading...'}
        </div>
        <h2>Custom Streams</h2>
        <div>
          {/*
            Include an empty object at the end to create an extra input for a new custom stream.
            We need it to be part of the array (rather than JSX below) for DOM diffing to match the key and retain focus.
           */}
          {[...customStreams, { Link: '', Label: '', Kind: 'video' }].map(
            ({ Link, Label, Kind }, idx) => (
              <CustomStreamInput
                key={idx}
                idx={idx}
                Link={Link}
                Label={Label}
                Kind={Kind}
                onChange={handleChangeCustomStream}
              />
            ),
          )}
        </div>
      </StyledDataContainer>
    </div>
  )
}

function StreamLine({
  id,
  row: { Label, Source, Title, Link, Notes },
  onClickId,
}) {
  const handleClickId = useCallback(() => {
    onClickId(id)
  })
  return (
    <StyledStreamLine>
      <StyledId onClick={handleClickId}>{id}</StyledId>
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
  isBlurred,
  onSetListening,
  onSetBlurred,
  onReloadView,
  onBrowse,
  onDevTools,
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
  const handleBlurClick = useCallback(() => onSetBlurred(idx, !isBlurred), [
    idx,
    onSetBlurred,
    isBlurred,
  ])
  const handleReloadClick = useCallback(() => onReloadView(idx), [
    idx,
    onReloadView,
  ])
  const handleBrowseClick = useCallback(() => onBrowse(url), [url, onBrowse])
  const handleDevToolsClick = useCallback(() => onDevTools(idx), [
    idx,
    onDevTools,
  ])
  const handleClick = useCallback((ev) => {
    ev.target.select()
  })
  return (
    <StyledGridContainer>
      {isDisplaying && (
        <StyledGridButtons side="left">
          <StyledSmallButton onClick={handleReloadClick} tabIndex={1}>
            <ReloadIcon />
          </StyledSmallButton>
          <StyledSmallButton onClick={handleBrowseClick} tabIndex={1}>
            <WindowIcon />
          </StyledSmallButton>
          <StyledSmallButton onClick={handleDevToolsClick} tabIndex={1}>
            <LifeRingIcon />
          </StyledSmallButton>
        </StyledGridButtons>
      )}
      <StyledGridButtons side="right">
        <StyledToggleButton
          isActive={isBlurred}
          onClick={handleBlurClick}
          tabIndex={1}
        >
          <NoVideoIcon />
        </StyledToggleButton>
        <StyledToggleButton
          isActive={isListening}
          onClick={handleListeningClick}
          tabIndex={1}
        >
          <SoundIcon />
        </StyledToggleButton>
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
  const handleChangeKind = useCallback(
    (ev) => {
      onChange(idx, { ...props, Kind: ev.target.value })
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
      <select onChange={handleChangeKind} value={props.Kind}>
        <option value="video">video</option>
        <option value="web">web</option>
      </select>
    </div>
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

const StyledSmallButton = styled(StyledButton)`
  svg {
    width: 14px;
    height: 14px;
  }
`

const StyledToggleButton = styled(StyledButton)`
  ${({ isActive }) =>
    isActive &&
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
    ${({ side }) => (side === 'left' ? 'margin-right: 0' : 'margin-left: 0')};
  }
`

const StyledGridInput = styled.input`
  width: 160px;
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
  cursor: pointer;
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
