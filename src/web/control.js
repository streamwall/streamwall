import range from 'lodash/range'
import sortBy from 'lodash/sortBy'
import truncate from 'lodash/truncate'
import ReconnectingWebSocket from 'reconnecting-websocket'
import * as Y from 'yjs'
import { patch as patchJSON } from 'jsondiffpatch'
import { h, Fragment, render } from 'preact'
import {
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
  useRef,
} from 'preact/hooks'
import { State } from 'xstate'
import styled, { createGlobalStyle } from 'styled-components'
import { useHotkeys } from 'react-hotkeys-hook'
import Color from 'color'

import '../index.css'
import { idxInBox } from '../geometry'
import { roleCan } from '../roles'
import SoundIcon from '../static/volume-up-solid.svg'
import NoVideoIcon from '../static/video-slash-solid.svg'
import ReloadIcon from '../static/redo-alt-solid.svg'
import SwapIcon from '../static/exchange-alt-solid.svg'
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

const GlobalStyle = createGlobalStyle`
  html {
    height: 100%;
  }

  html, body {
    display: flex;
    flex: 1;
  }
`

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
  const [authState, setAuthState] = useState()

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
      if (msg.response) {
        const { responseMap } = wsRef.current
        const responseCb = responseMap.get(msg.id)
        if (responseCb) {
          responseMap.delete(msg.id)
          responseCb(msg)
        }
      } else if (msg.type === 'state' || msg.type === 'state-delta') {
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
          auth,
        } = state
        const newStateIdxMap = new Map()
        for (const viewState of views) {
          const { pos } = viewState.context
          const state = State.from(viewState.state)
          const isListening = state.matches(
            'displaying.running.audio.listening',
          )
          const isBackgroundListening = state.matches(
            'displaying.running.audio.background',
          )
          const isBlurred = state.matches('displaying.running.video.blurred')
          for (const space of pos.spaces) {
            if (!newStateIdxMap.has(space)) {
              newStateIdxMap.set(space, {})
            }
            Object.assign(newStateIdxMap.get(space), {
              state,
              isListening,
              isBackgroundListening,
              isBlurred,
              spaces: pos.spaces,
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
        setAuthState(auth)
      } else {
        console.warn('unexpected ws message', msg)
      }
    })
    wsRef.current = { ws, msgId: 0, responseMap: new Map() }
  }, [])

  const send = useCallback((msg, cb) => {
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
  }, [])

  useEffect(() => {
    function sendUpdate(update, origin) {
      if (origin === 'server') {
        return
      }
      wsRef.current.ws.send(update)
    }
    function receiveUpdate(ev) {
      if (!(ev.data instanceof ArrayBuffer)) {
        return
      }
      Y.applyUpdate(stateDoc, new Uint8Array(ev.data), 'server')
    }
    stateDoc.on('update', sendUpdate)
    wsRef.current.ws.addEventListener('message', receiveUpdate)
    return () => {
      stateDoc.off('update', sendUpdate)
      wsRef.current.ws.removeEventListener('message', receiveUpdate)
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
    authState,
  }
}

function App({ wsEndpoint, role }) {
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
    authState,
  } = useStreamwallConnection(wsEndpoint)
  const { gridCount } = config

  const [showDebug, setShowDebug] = useState(false)
  const handleChangeShowDebug = useCallback((ev) => {
    setShowDebug(ev.target.checked)
  })

  const [swapStartIdx, setSwapStartIdx] = useState()
  const handleSwapView = useCallback(
    (idx) => {
      if (!stateIdxMap.has(idx)) {
        return
      }
      // Deselect the input so the contents aren't persisted by GridInput's `editingValue`
      document.activeElement.blur()
      setSwapStartIdx(idx)
    },
    [stateIdxMap],
  )
  const handleSwap = useCallback(
    (toIdx) => {
      if (swapStartIdx === undefined) {
        return
      }
      stateDoc.transact(() => {
        const viewsState = stateDoc.getMap('views')
        const startStreamId = viewsState
          .get(String(swapStartIdx))
          .get('streamId')
        const toStreamId = viewsState.get(String(toIdx)).get('streamId')
        const startSpaces = stateIdxMap.get(swapStartIdx).spaces
        const toSpaces = stateIdxMap.get(toIdx).spaces
        for (const startSpaceIdx of startSpaces) {
          viewsState.get(String(startSpaceIdx)).set('streamId', toStreamId)
        }
        for (const toSpaceIdx of toSpaces) {
          viewsState.get(String(toSpaceIdx)).set('streamId', startStreamId)
        }
      })
      setSwapStartIdx()
    },
    [stateDoc, stateIdxMap, swapStartIdx],
  )

  const [dragStart, setDragStart] = useState()
  const handleDragStart = useCallback(
    (idx, ev) => {
      ev.preventDefault()
      if (swapStartIdx !== undefined) {
        handleSwap(idx)
      } else {
        setDragStart(idx)
        ev.target.select()
      }
    },
    [handleSwap],
  )
  const [dragEnd, setDragEnd] = useState()
  useLayoutEffect(() => {
    function endDrag() {
      if (dragStart === undefined) {
        return
      }
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
    window.addEventListener('mouseup', endDrag)
    return () => window.removeEventListener('mouseup', endDrag)
  }, [stateDoc, dragStart, dragEnd])

  const [focusedInputIdx, setFocusedInputIdx] = useState()
  const handleFocusInput = useCallback(setFocusedInputIdx, [])
  const handleBlurInput = useCallback(() => setFocusedInputIdx(), [])

  const handleSetView = useCallback(
    (idx, streamId) => {
      const stream = streams.find((d) => d._id === streamId)
      stateDoc
        .getMap('views')
        .get(String(idx))
        .set('streamId', stream ? streamId : '')
    },
    [stateDoc, streams],
  )

  const handleSetListening = useCallback((idx, listening) => {
    send({
      type: 'set-listening-view',
      viewIdx: listening ? idx : null,
    })
  }, [])

  const handleSetBackgroundListening = useCallback((viewIdx, listening) => {
    send({
      type: 'set-view-background-listening',
      viewIdx,
      listening,
    })
  }, [])

  const handleSetBlurred = useCallback((idx, blurred) => {
    send({
      type: 'set-view-blurred',
      viewIdx: idx,
      blurred: blurred,
    })
  }, [])

  const handleReloadView = useCallback((idx) => {
    send({
      type: 'reload-view',
      viewIdx: idx,
    })
  }, [])

  const handleBrowse = useCallback(
    (streamId) => {
      const stream = streams.find((d) => d._id === streamId)
      if (!stream) {
        return
      }
      send({
        type: 'browse',
        url: stream.link,
      })
    },
    [streams],
  )

  const handleDevTools = useCallback((idx) => {
    send({
      type: 'dev-tools',
      viewIdx: idx,
    })
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

  const handleChangeCustomStream = useCallback((idx, customStream) => {
    let newCustomStreams = [...customStreams]
    newCustomStreams[idx] = customStream
    newCustomStreams = newCustomStreams.filter((s) => s.label || s.link)
    send({
      type: 'set-custom-streams',
      streams: newCustomStreams,
    })
  })

  const setStreamCensored = useCallback((isCensored) => {
    send({
      type: 'set-stream-censored',
      isCensored,
    })
  }, [])

  const setStreamRunning = useCallback((isStreamRunning) => {
    send({
      type: 'set-stream-running',
      isStreamRunning,
    })
  }, [])

  const [newInvite, setNewInvite] = useState()

  const handleCreateInvite = useCallback(({ name, role }) => {
    send(
      {
        type: 'create-invite',
        name,
        role,
      },
      ({ name, secret }) => {
        setNewInvite({ name, secret })
      },
    )
  }, [])

  const handleDeleteToken = useCallback((tokenId) => {
    send({
      type: 'delete-token',
      tokenId,
    })
  }, [])

  const preventLinkClick = useCallback((ev) => {
    ev.preventDefault()
  })

  // Set up keyboard shortcuts.
  useHotkeys(
    hotkeyTriggers.map((k) => `alt+${k}`).join(','),
    (ev, { key }) => {
      ev.preventDefault()
      const idx = hotkeyTriggers.indexOf(key[key.length - 1])
      const isListening = stateIdxMap.get(idx)?.isListening ?? false
      handleSetListening(idx, !isListening)
    },
    // This enables hotkeys when input elements are focused, and affects all hotkeys, not just this one.
    { filter: () => true },
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
  useHotkeys(
    `alt+s`,
    () => {
      handleSwapView(focusedInputIdx)
    },
    [handleSwapView, focusedInputIdx],
  )

  const normalStreams = streams.filter(
    (s) =>
      !s.kind || s.kind === 'video' || s.kind === 'audio' || s.kind === 'web',
  )

  return (
    <Stack flex="1">
      <Stack>
        <StyledHeader>
          <h1>Streamwall ({location.host})</h1>
          <div>
            connection status: {isConnected ? 'connected' : 'connecting...'}
          </div>
          <div>role: {role}</div>
        </StyledHeader>
        {delayState && (
          <StreamDelayBox
            role={role}
            delayState={delayState}
            setStreamCensored={setStreamCensored}
            setStreamRunning={setStreamRunning}
          />
        )}
        <StyledDataContainer isConnected={isConnected}>
          <div>
            {range(0, gridCount).map((y) => (
              <StyledGridLine>
                {range(0, gridCount).map((x) => {
                  const idx = gridCount * y + x
                  const {
                    isListening = false,
                    isBackgroundListening = false,
                    isBlurred = false,
                    state,
                  } = stateIdxMap.get(idx) || {}
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
                      isBackgroundListening={isBackgroundListening}
                      isBlurred={isBlurred}
                      isHighlighted={isDragHighlighted}
                      isSwapping={idx === swapStartIdx}
                      showDebug={showDebug}
                      role={role}
                      onMouseDown={handleDragStart}
                      onMouseEnter={setDragEnd}
                      onFocus={handleFocusInput}
                      onBlur={handleBlurInput}
                      onChangeSpace={handleSetView}
                      onSetListening={handleSetListening}
                      onSetBackgroundListening={handleSetBackgroundListening}
                      onSetBlurred={handleSetBlurred}
                      onReloadView={handleReloadView}
                      onSwapView={handleSwapView}
                      onBrowse={handleBrowse}
                      onDevTools={handleDevTools}
                    />
                  )
                })}
              </StyledGridLine>
            ))}
          </div>
          {(roleCan(role, 'dev-tools') || roleCan(role, 'browse')) && (
            <label>
              <input
                type="checkbox"
                value={showDebug}
                onChange={handleChangeShowDebug}
              />
              Show stream debug tools
            </label>
          )}
          <Facts />
        </StyledDataContainer>
      </Stack>
      <Stack flex="1" scroll={true} minHeight={200}>
        <StyledDataContainer isConnected={isConnected}>
          <div>
            {isConnected
              ? normalStreams.map((row) => (
                  <StreamLine
                    id={row._id}
                    row={row}
                    disabled={!roleCan(role, 'mutate-state-doc')}
                    onClickId={handleClickId}
                  />
                ))
              : 'loading...'}
          </div>
          {roleCan(role, 'set-custom-streams') && (
            <>
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
            </>
          )}
          {roleCan(role, 'edit-tokens') && authState && (
            <>
              <h2>Access</h2>
              <div>
                <CreateInviteInput onCreateInvite={handleCreateInvite} />
                <h3>Invites</h3>
                {newInvite && (
                  <StyledNewInviteBox>
                    Invite link created:{' '}
                    <a
                      href={`/invite/${newInvite.secret}`}
                      onClick={preventLinkClick}
                    >
                      "{newInvite.name}"
                    </a>
                  </StyledNewInviteBox>
                )}
                {authState.invites.map(({ id, name, role }) => (
                  <AuthTokenLine
                    id={id}
                    name={name}
                    role={role}
                    onDelete={handleDeleteToken}
                  />
                ))}
                <h3>Sessions</h3>
                {authState.sessions.map(({ id, name, role }) => (
                  <AuthTokenLine
                    id={id}
                    name={name}
                    role={role}
                    onDelete={handleDeleteToken}
                  />
                ))}
              </div>
            </>
          )}
        </StyledDataContainer>
      </Stack>
    </Stack>
  )
}

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  flex: ${({ flex }) => flex};
  ${({ scroll }) => scroll && `overflow-y: auto`};
  ${({ minHeight }) => minHeight && `min-height: ${minHeight}px`};
`

function StreamDelayBox({
  role,
  delayState,
  setStreamCensored,
  setStreamRunning,
}) {
  const handleToggleStreamCensored = useCallback(() => {
    setStreamCensored(!delayState.isCensored)
  }, [delayState.isCensored, setStreamCensored])
  const handleToggleStreamRunning = useCallback(() => {
    if (!delayState.isStreamRunning || confirm('End stream?')) {
      setStreamRunning(!delayState.isStreamRunning)
    }
  }, [delayState.isStreamRunning, setStreamRunning])
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
        {!delayState.isConnected && <span>connecting...</span>}
        {!delayState.isStreamRunning && <span>stream stopped</span>}
        {delayState.isConnected && (
          <>
            <span>delay: {delayState.delaySeconds}s</span>
            {delayState.isStreamRunning && (
              <StyledButton
                isActive={delayState.isCensored}
                onClick={handleToggleStreamCensored}
                tabIndex={1}
              >
                {buttonText}
              </StyledButton>
            )}
            {roleCan(role, 'set-stream-running') && (
              <StyledButton onClick={handleToggleStreamRunning} tabIndex={1}>
                {delayState.isStreamRunning ? 'End stream' : 'Start stream'}
              </StyledButton>
            )}
          </>
        )}
      </StyledStreamDelayBox>
    </div>
  )
}

function StreamLine({
  id,
  row: { label, source, title, link, notes, state, city },
  disabled,
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
      <StyledId
        disabled={disabled}
        onMouseDown={disabled ? null : handleMouseDownId}
        color={idColor(id)}
      >
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
  isBackgroundListening,
  isBlurred,
  isHighlighted,
  isSwapping,
  showDebug,
  role,
  onMouseDown,
  onMouseEnter,
  onFocus,
  onBlur,
  onSetListening,
  onSetBackgroundListening,
  onSetBlurred,
  onReloadView,
  onSwapView,
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
    (ev) =>
      ev.shiftKey || isBackgroundListening
        ? onSetBackgroundListening(idx, !isBackgroundListening)
        : onSetListening(idx, !isListening),
    [
      idx,
      onSetListening,
      onSetBackgroundListening,
      isListening,
      isBackgroundListening,
    ],
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
  const handleSwapClick = useCallback(() => onSwapView(idx), [idx, onSwapView])
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
      onMouseDown(idx, ev)
    },
    [onMouseDown],
  )
  const handleMouseEnter = useCallback(() => onMouseEnter(idx), [onMouseEnter])
  return (
    <StyledGridContainer>
      {isDisplaying && (
        <StyledGridButtons side="left">
          {showDebug ? (
            <>
              {roleCan(role, 'browse') && (
                <StyledSmallButton onClick={handleBrowseClick} tabIndex={1}>
                  <WindowIcon />
                </StyledSmallButton>
              )}
              {roleCan(role, 'dev-tools') && (
                <StyledSmallButton onClick={handleDevToolsClick} tabIndex={1}>
                  <LifeRingIcon />
                </StyledSmallButton>
              )}
            </>
          ) : (
            <>
              {roleCan(role, 'reload-view') && (
                <StyledSmallButton onClick={handleReloadClick} tabIndex={1}>
                  <ReloadIcon />
                </StyledSmallButton>
              )}
              {roleCan(role, 'mutate-state-doc') && (
                <StyledSmallButton
                  isActive={isSwapping}
                  onClick={handleSwapClick}
                  tabIndex={1}
                >
                  <SwapIcon />
                </StyledSmallButton>
              )}
            </>
          )}
        </StyledGridButtons>
      )}
      <StyledGridButtons side="right">
        {roleCan(role, 'set-view-blurred') && (
          <StyledButton
            isActive={isBlurred}
            onClick={handleBlurClick}
            tabIndex={1}
          >
            <NoVideoIcon />
          </StyledButton>
        )}
        {roleCan(role, 'set-listening-view') && (
          <StyledButton
            isActive={isListening || isBackgroundListening}
            activeColor={isListening ? 'red' : Color('red').desaturate(0.5)}
            onClick={handleListeningClick}
            tabIndex={1}
          >
            <SoundIcon />
          </StyledButton>
        )}
      </StyledGridButtons>
      <StyledGridInput
        value={editingValue || spaceValue || ''}
        color={idColor(spaceValue)}
        isError={isError}
        isHighlighted={isHighlighted}
        disabled={!roleCan(role, 'mutate-state-doc')}
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
        <option value="audio">audio</option>
        <option value="web">web</option>
        <option value="overlay">overlay</option>
        <option value="background">background</option>
      </select>
    </div>
  )
}

const StyledHeader = styled.header`
  display: flex;
  flex-direction: row;
  align-items: center;

  h1 {
    margin-top: 0;
    margin-bottom: 0;
  }

  * {
    margin-right: 2rem;
  }
`

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

  ${({ isActive, activeColor = 'red' }) =>
    isActive &&
    `
      border-color: ${activeColor};
      background: ${Color(activeColor).desaturate(0.5).lighten(0.5)};
    `};

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
  cursor: ${({ disabled }) => (disabled ? 'normal' : 'pointer')};
`

const StyledStreamLine = styled.div`
  display: flex;
  align-items: center;
  margin: 0.5em 0;
`

function CreateInviteInput({ onCreateInvite }) {
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState('operator')
  const handleChangeName = useCallback(
    (ev) => {
      setInviteName(ev.target.value)
    },
    [setInviteName],
  )
  const handleChangeRole = useCallback(
    (ev) => {
      setInviteRole(ev.target.value)
    },
    [setInviteRole],
  )
  const handleSubmit = useCallback(
    (ev) => {
      ev.preventDefault()
      setInviteName('')
      setInviteRole('operator')
      onCreateInvite({ name: inviteName, role: inviteRole })
    },
    [onCreateInvite, inviteName, inviteRole],
  )
  return (
    <div>
      <form onSubmit={handleSubmit}>
        <input
          onChange={handleChangeName}
          placeholder="Name"
          value={inviteName}
        />
        <select onChange={handleChangeRole} value={inviteRole}>
          <option value="operator">operator</option>
          <option value="monitor">monitor</option>
        </select>
        <button type="submit">create invite</button>
      </form>
    </div>
  )
}

const StyledNewInviteBox = styled.div`
  display: inline-block;
  padding: 10px;
  background: #dfd;
`

function AuthTokenLine({ id, role, name, onDelete }) {
  const handleDeleteClick = useCallback(() => {
    onDelete(id)
  }, [id])
  return (
    <div>
      <strong>{name}</strong>: {role}{' '}
      <button onClick={handleDeleteClick}>revoke</button>
    </div>
  )
}

function Facts() {
  return (
    <StyledFacts>
      <BLM>Black Lives Matter.</BLM>
      <TRM>
        Trans rights are <em>human rights.</em>
      </TRM>
      <TIN>Technology is not neutral.</TIN>
    </StyledFacts>
  )
}

const StyledFacts = styled.div`
  display: flex;
  margin: 4px 0;

  & > * {
    line-height: 26px;
    margin-right: 0.5em;
    padding: 0 6px;
    flex-shrink: 0;
  }
`

const BLM = styled.div`
  background: black;
  color: white;
`

const TRM = styled.div`
  background: linear-gradient(
    to bottom,
    #55cdfc 12%,
    #f7a8b8 12%,
    #f7a8b8 88%,
    #55cdfc 88%
  );
  color: white;
  text-shadow: 0 0 2px rgba(0, 0, 0, 0.5);
`

const TIN = styled.div`
  background: gray;
  font-family: monospace;
`

function main() {
  const script = document.getElementById('main-script')
  render(
    <>
      <GlobalStyle />
      <App wsEndpoint={script.dataset.wsEndpoint} role={script.dataset.role} />
    </>,
    document.body,
  )
}

main()
