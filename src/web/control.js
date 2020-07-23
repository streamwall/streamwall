import debounce from 'lodash/debounce'
import range from 'lodash/range'
import sortBy from 'lodash/sortBy'
import truncate from 'lodash/truncate'
import ReconnectingWebSocket from 'reconnecting-websocket'
import * as Y from 'yjs'
import { patch as patchJSON } from 'jsondiffpatch'
import { h, Fragment, render } from 'preact'
import { useEffect, useState, useCallback, useRef } from 'preact/hooks'
import { State } from 'xstate'
import styled, { css } from 'styled-components'
import { useHotkeys } from 'react-hotkeys-hook'

import '../index.css'
import { idxInBox } from '../geometry'
import SoundIcon from '../static/volume-up-solid.svg'
import NoVideoIcon from '../static/video-slash-solid.svg'
import ReloadIcon from '../static/redo-alt-solid.svg'
import LifeRingIcon from '../static/life-ring-regular.svg'
import WindowIcon from '../static/window-maximize-regular.svg'
import { idColor } from './colors'

const hotkeyTriggers = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '0',
  'q',
  'w',
  'e',
  'r',
  't',
  'y',
  'u',
  'i',
  'o',
  'p',
]

function useYDoc(keys) {
  const [doc, setDoc] = useState(new Y.Doc())
  const [docValue, setDocValue] = useState()
  useEffect(() => {
    function updateDocValue() {
      const valueCopy = Object.fromEntries(
        keys.map((k) => [k, doc.getMap(k).toJSON()]),
      )
      setDocValue(valueCopy)
    }
    updateDocValue()
    doc.on('update', updateDocValue)
    return () => {
      doc.off('update', updateDocValue)
    }
  }, [doc])
  return [docValue, doc, setDoc]
}

function useStreamwallConnection(wsEndpoint) {
  const wsRef = useRef()
  const [isConnected, setIsConnected] = useState(false)
  const [sharedState, stateDoc, setStateDoc] = useYDoc(['views'])
  const [config, setConfig] = useState({})
  const [streams, setStreams] = useState([])
  const [customStreams, setCustomStreams] = useState([])
  const [stateIdxMap, setStateIdxMap] = useState(new Map())
  const [delayState, setDelayState] = useState()

  useEffect(() => {
    let lastStateData
    const ws = new ReconnectingWebSocket(wsEndpoint, [], {
      maxReconnectionDelay: 5000,
      minReconnectionDelay: 1000 + Math.random() * 500,
      reconnectionDelayGrowFactor: 1.1,
    })
    ws.binaryType = 'arraybuffer'
    ws.addEventListener('open', () => setIsConnected(true))
    ws.addEventListener('close', () => {
      setStateDoc(new Y.Doc())
      setIsConnected(false)
    })
    ws.addEventListener('message', (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        return
      }
      const msg = JSON.parse(ev.data)
      if (msg.type === 'state' || msg.type === 'state-delta') {
        let state
        if (msg.type === 'state') {
          state = msg.state
        } else {
          state = patchJSON(lastStateData, msg.delta)
        }
        lastStateData = state

        const {
          config: newConfig,
          streams: newStreams,
          views,
          streamdelay,
        } = state
        const newStateIdxMap = new Map()
        for (const viewState of views) {
          const { pos } = viewState.context
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
              state,
              isListening,
              isBlurred,
            })
          }
        }
        setConfig(newConfig)
        setStateIdxMap(newStateIdxMap)
        setStreams(sortBy(newStreams, ['_id']))
        setCustomStreams(newStreams.filter((s) => s._dataSource === 'custom'))
        setDelayState(
          streamdelay && {
            ...streamdelay,
            state: State.from(streamdelay.state),
          },
        )
      } else {
        console.warn('unexpected ws message', msg)
      }
    })
    wsRef.current = ws
  }, [])

  const send = useCallback((...args) => {
    wsRef.current.send(...args)
  }, [])

  useEffect(() => {
    function sendUpdate(update, origin) {
      if (origin === 'server') {
        return
      }
      wsRef.current.send(update)
    }
    function receiveUpdate(ev) {
      if (!(ev.data instanceof ArrayBuffer)) {
        return
      }
      Y.applyUpdate(stateDoc, new Uint8Array(ev.data), 'server')
    }
    stateDoc.on('update', sendUpdate)
    wsRef.current.addEventListener('message', receiveUpdate)
    return () => {
      stateDoc.off('update', sendUpdate)
      wsRef.current.removeEventListener('message', receiveUpdate)
    }
  }, [stateDoc])

  return {
    isConnected,
    send,
    sharedState,
    stateDoc,
    config,
    streams,
    customStreams,
    stateIdxMap,
    delayState,
  }
}

function App({ wsEndpoint }) {
  const {
    isConnected,
    send,
    sharedState,
    stateDoc,
    config,
    streams,
    customStreams,
    stateIdxMap,
    delayState,
  } = useStreamwallConnection(wsEndpoint)
  const { gridCount } = config

  const [dragStart, setDragStart] = useState()
  const handleDragStart = useCallback((idx, ev) => {
    setDragStart(idx)
    ev.preventDefault()
  }, [])
  const [dragEnd, setDragEnd] = useState()
  useEffect(() => {
    function endDrag() {
      if (dragStart !== undefined) {
        stateDoc.transact(() => {
          const viewsState = stateDoc.getMap('views')
          const streamId = viewsState.get(String(dragStart)).get('streamId')
          for (let idx = 0; idx < gridCount ** 2; idx++) {
            if (idxInBox(gridCount, dragStart, dragEnd, idx)) {
              viewsState.get(String(idx)).set('streamId', streamId)
            }
          }
        })
        setDragStart()
      }
    }
    window.addEventListener('mouseup', endDrag)
    return () => window.removeEventListener('mouseup', endDrag)
  }, [stateDoc, dragStart, dragEnd])

  const [focusedInputIdx, setFocusedInputIdx] = useState()
  const handleFocusInput = useCallback(setFocusedInputIdx, [])
  const handleBlurInput = useCallback(() => setFocusedInputIdx(), [])

  const handleSetView = useCallback(
    debounce((idx, streamId) => {
      const stream = streams.find((d) => d._id === streamId)
      stateDoc
        .getMap('views')
        .get(String(idx))
        .set('streamId', stream ? streamId : '')
    }, 500),
    [stateDoc, streams],
  )

  const handleSetListening = useCallback((idx, listening) => {
    send(
      JSON.stringify({
        type: 'set-listening-view',
        viewIdx: listening ? idx : null,
      }),
    )
  }, [])

  const handleSetBlurred = useCallback((idx, blurred) => {
    send(
      JSON.stringify({
        type: 'set-view-blurred',
        viewIdx: idx,
        blurred: blurred,
      }),
    )
  }, [])

  const handleReloadView = useCallback((idx) => {
    send(
      JSON.stringify({
        type: 'reload-view',
        viewIdx: idx,
      }),
    )
  }, [])

  const handleBrowse = useCallback(
    (streamId) => {
      const stream = streams.find((d) => d._id === streamId)
      if (!stream) {
        return
      }
      send(
        JSON.stringify({
          type: 'browse',
          url: stream.link,
        }),
      )
    },
    [streams],
  )

  const handleDevTools = useCallback((idx) => {
    send(
      JSON.stringify({
        type: 'dev-tools',
        viewIdx: idx,
      }),
    )
  }, [])

  const handleClickId = useCallback(
    (streamId) => {
      try {
        navigator.clipboard.writeText(streamId)
      } catch (err) {
        console.warn('Unable to copy stream id to clipboard:', err)
      }

      if (focusedInputIdx !== undefined) {
        handleSetView(focusedInputIdx, streamId)
        return
      }

      const availableIdx = range(gridCount * gridCount).find(
        (i) => !sharedState.views[i].streamId,
      )
      if (availableIdx === undefined) {
        return
      }
      handleSetView(availableIdx, streamId)
    },
    [gridCount, sharedState, focusedInputIdx],
  )

  const handleChangeCustomStream = useCallback(
    debounce((idx, customStream) => {
      let newCustomStreams = [...customStreams]
      newCustomStreams[idx] = customStream
      newCustomStreams = newCustomStreams.filter((s) => s.label || s.link)
      send(
        JSON.stringify({
          type: 'set-custom-streams',
          streams: newCustomStreams,
        }),
      )
    }, 500),
  )

  const setStreamCensored = useCallback((isCensored) => {
    send(
      JSON.stringify({
        type: 'set-stream-censored',
        isCensored,
      }),
    )
  }, [])

  // Set up keyboard shortcuts.
  useHotkeys(
    hotkeyTriggers.map((k) => `alt+${k}`).join(','),
    (ev, { key }) => {
      ev.preventDefault()
      const idx = hotkeyTriggers.indexOf(key[key.length - 1])
      const isListening = stateIdxMap.get(idx)?.isListening ?? false
      handleSetListening(idx, !isListening)
    },
    [stateIdxMap],
  )
  useHotkeys(
    hotkeyTriggers.map((k) => `alt+shift+${k}`).join(','),
    (ev, { key }) => {
      ev.preventDefault()
      const idx = hotkeyTriggers.indexOf(key[key.length - 1])
      const isBlurred = stateIdxMap.get(idx)?.isBlurred ?? false
      handleSetBlurred(idx, !isBlurred)
    },
    [stateIdxMap],
  )
  useHotkeys(
    `alt+c`,
    () => {
      setStreamCensored(true)
    },
    [setStreamCensored],
  )
  useHotkeys(
    `alt+shift+c`,
    () => {
      setStreamCensored(false)
    },
    [setStreamCensored],
  )

  return (
    <div>
      <h1>Streamwall ({location.host})</h1>
      <div>
        connection status: {isConnected ? 'connected' : 'connecting...'}
      </div>
      {delayState && (
        <StreamDelayBox
          delayState={delayState}
          setStreamCensored={setStreamCensored}
        />
      )}
      <StyledDataContainer isConnected={isConnected}>
        <div>
          {range(0, gridCount).map((y) => (
            <StyledGridLine>
              {range(0, gridCount).map((x) => {
                const idx = gridCount * y + x
                const { isListening = false, isBlurred = false, state } =
                  stateIdxMap.get(idx) || {}
                const { streamId } = sharedState.views?.[idx] || ''
                const isDragHighlighted =
                  dragStart !== undefined &&
                  idxInBox(gridCount, dragStart, dragEnd, idx)
                return (
                  <GridInput
                    idx={idx}
                    spaceValue={streamId}
                    isError={state && state.matches('displaying.error')}
                    isDisplaying={state && state.matches('displaying')}
                    isListening={isListening}
                    isBlurred={isBlurred}
                    isHighlighted={isDragHighlighted}
                    onMouseDown={handleDragStart}
                    onMouseEnter={setDragEnd}
                    onFocus={handleFocusInput}
                    onBlur={handleBlurInput}
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
            ? streams.map((row) => (
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
          {[...customStreams, { link: '', label: '', kind: 'video' }].map(
            ({ link, label, kind }, idx) => (
              <CustomStreamInput
                key={idx}
                idx={idx}
                link={link}
                label={label}
                kind={kind}
                onChange={handleChangeCustomStream}
              />
            ),
          )}
        </div>
      </StyledDataContainer>
    </div>
  )
}

function StreamDelayBox({ delayState, setStreamCensored }) {
  const handleToggleStreamCensored = useCallback(() => {
    setStreamCensored(!delayState.isCensored)
  }, [delayState.isCensored, setStreamCensored])
  let buttonText
  if (delayState.isConnected) {
    if (delayState.state.matches('censorship.censored.deactivating')) {
      buttonText = 'Deactivating...'
    } else if (delayState.isCensored) {
      buttonText = 'Uncensor stream'
    } else {
      buttonText = 'Censor stream'
    }
  }
  return (
    <div>
      <StyledStreamDelayBox>
        <strong>Streamdelay</strong>
        <span>{delayState.isConnected ? 'connected' : 'connecting...'}</span>
        {delayState.isConnected && (
          <>
            <span>delay: {delayState.delaySeconds}s</span>
            <StyledToggleButton
              isActive={delayState.isCensored}
              onClick={handleToggleStreamCensored}
              tabIndex={1}
            >
              {buttonText}
            </StyledToggleButton>
          </>
        )}
      </StyledStreamDelayBox>
    </div>
  )
}

function StreamLine({
  id,
  row: { label, source, title, link, notes, state, city },
  onClickId,
}) {
  // Use mousedown instead of click event so a potential destination grid input stays focused.
  const handleMouseDownId = useCallback(() => {
    onClickId(id)
  }, [onClickId, id])
  let location
  if (state && city) {
    location = ` (${city} ${state}) `
  }
  return (
    <StyledStreamLine>
      <StyledId onMouseDown={handleMouseDownId} color={idColor(id)}>
        {id}
      </StyledId>
      <div>
        {label ? (
          label
        ) : (
          <>
            <strong>{source}</strong>
            {location}
            <a href={link} target="_blank">
              {truncate(title || link, { length: 55 })}
            </a>{' '}
            {notes}
          </>
        )}
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
  isBlurred,
  isHighlighted,
  onMouseDown,
  onMouseEnter,
  onFocus,
  onBlur,
  onSetListening,
  onSetBlurred,
  onReloadView,
  onBrowse,
  onDevTools,
}) {
  const [editingValue, setEditingValue] = useState()
  const handleFocus = useCallback(
    (ev) => {
      setEditingValue(ev.target.value)
      onFocus(idx)
    },
    [onFocus, idx],
  )
  const handleBlur = useCallback(
    (ev) => {
      setEditingValue(undefined)
      onBlur(idx)
    },
    [onBlur, idx],
  )
  const handleChange = useCallback(
    (ev) => {
      const { value } = ev.target
      setEditingValue(value)
      onChangeSpace(idx, value)
    },
    [idx, onChangeSpace],
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
  const handleBrowseClick = useCallback(() => onBrowse(spaceValue), [
    spaceValue,
    onBrowse,
  ])
  const handleDevToolsClick = useCallback(() => onDevTools(idx), [
    idx,
    onDevTools,
  ])
  const handleMouseDown = useCallback(
    (ev) => {
      ev.target.select()
      onMouseDown(idx, ev)
    },
    [onMouseDown],
  )
  const handleMouseEnter = useCallback(() => onMouseEnter(idx), [onMouseEnter])
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
        value={editingValue || spaceValue || ''}
        color={idColor(spaceValue)}
        isError={isError}
        isHighlighted={isHighlighted}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onMouseDown={handleMouseDown}
        onMouseEnter={handleMouseEnter}
        onChange={handleChange}
      />
    </StyledGridContainer>
  )
}

function CustomStreamInput({ idx, onChange, ...props }) {
  const handleChangeLink = useCallback(
    (ev) => {
      onChange(idx, { ...props, link: ev.target.value })
    },
    [onChange],
  )
  const handleChangeLabel = useCallback(
    (ev) => {
      onChange(idx, { ...props, label: ev.target.value })
    },
    [onChange],
  )
  const handleChangeKind = useCallback(
    (ev) => {
      onChange(idx, { ...props, kind: ev.target.value })
    },
    [onChange],
  )
  return (
    <div>
      <input
        onChange={handleChangeLink}
        placeholder="https://..."
        value={props.link}
      />
      <input
        onChange={handleChangeLabel}
        placeholder="Label (optional)"
        value={props.label}
      />
      <select onChange={handleChangeKind} value={props.kind}>
        <option value="video">video</option>
        <option value="web">web</option>
      </select>
    </div>
  )
}

const StyledStreamDelayBox = styled.div`
  display: inline-flex;
  margin: 5px 0;
  padding: 10px;
  background: #fdd;

  & > * {
    margin-right: 1em;
  }
`

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
  background: ${({ color, isHighlighted }) =>
    isHighlighted ? color.lightness(90) : color.lightness(75)};
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
  background: ${({ color }) => color.lightness(50) || '#333'};
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
