import '@fontsource/noto-sans'
import Color from 'color'
import { range, sortBy, truncate } from 'lodash-es'
import { DateTime } from 'luxon'
import { JSX } from 'preact'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'preact/hooks'
import { useHotkeys } from 'react-hotkeys-hook'
import {
  FaExchangeAlt,
  FaRedoAlt,
  FaRegLifeRing,
  FaRegWindowMaximize,
  FaSyncAlt,
  FaVideoSlash,
  FaVolumeUp,
} from 'react-icons/fa'
import {
  ContentKind,
  ControlCommand,
  idColor,
  idxInBox,
  inviteLink,
  LocalStreamData,
  roleCan,
  StreamData,
  StreamDelayStatus,
  StreamwallRole,
  StreamwallState,
  StreamWindowConfig,
  ViewState,
} from 'streamwall-shared'
import { createGlobalStyle, styled } from 'styled-components'
import { matchesState } from 'xstate'
import * as Y from 'yjs'
import './index.css'

export interface ViewInfo {
  state: ViewState
  isListening: boolean
  isBackgroundListening: boolean
  isBlurred: boolean
  spaces: number[]
}

interface Invite {
  tokenId: string
  name: string
  secret: string
}

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

export const GlobalStyle = createGlobalStyle`
  html {
    height: 100%;
  }

  html, body {
    display: flex;
    flex: 1;
  }
`

const normalStreamKinds = new Set(['video', 'audio', 'web'])
function filterStreams(
  streams: StreamData[],
  wallStreamIds: Set<string>,
  filter: string,
) {
  const wallStreams = []
  const liveStreams = []
  const otherStreams = []
  for (const stream of streams) {
    const { _id, kind, status, label, source, state, city } = stream
    if (kind && !normalStreamKinds.has(kind)) {
      continue
    }
    if (
      filter !== '' &&
      !`${label}${source}${state}${city}`
        .toLowerCase()
        .includes(filter.toLowerCase())
    ) {
      continue
    }
    if (wallStreamIds.has(_id)) {
      wallStreams.push(stream)
    } else if ((kind && kind !== 'video') || status === 'Live') {
      liveStreams.push(stream)
    } else {
      otherStreams.push(stream)
    }
  }
  return [wallStreams, liveStreams, otherStreams]
}

export function useYDoc<T>(keys: string[]): {
  docValue: T | undefined
  doc: Y.Doc
  setDoc: (doc: Y.Doc) => void
} {
  const [doc, setDoc] = useState(new Y.Doc())
  const [docValue, setDocValue] = useState<T>()
  useEffect(() => {
    function updateDocValue() {
      const valueCopy = Object.fromEntries(
        keys.map((k) => [k, doc.getMap(k).toJSON()]),
      )
      // TODO: validate using zod
      setDocValue(valueCopy as T)
    }
    updateDocValue()
    doc.on('update', updateDocValue)
    return () => {
      doc.off('update', updateDocValue)
    }
  }, [doc])
  return { docValue, doc, setDoc }
}

export interface CollabData {
  views: { [viewIdx: string]: { streamId: string | undefined } }
}

export interface StreamwallConnection {
  isConnected: boolean
  role: StreamwallRole | null
  send: (msg: ControlCommand, cb?: (msg: unknown) => void) => void
  sharedState: CollabData | undefined
  stateDoc: Y.Doc
  config: StreamWindowConfig | undefined
  streams: StreamData[]
  customStreams: StreamData[]
  views: ViewInfo[]
  stateIdxMap: Map<number, ViewInfo>
  delayState: StreamDelayStatus | null | undefined
  authState?: StreamwallState['auth']
}

export function useStreamwallState(state: StreamwallState | undefined) {
  return useMemo(() => {
    if (state === undefined) {
      return {
        role: null,
        config: undefined,
        streams: [],
        customStreams: [],
        views: [],
        stateIdxMap: new Map(),
        delayState: undefined,
        authState: undefined,
      }
    }

    const {
      identity: { role },
      auth,
      config,
      streams: stateStreams,
      views: stateViews,
      streamdelay,
    } = state
    const stateIdxMap = new Map()
    const views = []
    for (const viewState of stateViews) {
      const { pos } = viewState.context
      const isListening = matchesState(
        'displaying.running.audio.listening',
        viewState.state,
      )
      const isBackgroundListening = matchesState(
        'displaying.running.audio.background',
        viewState.state,
      )
      const isBlurred = matchesState(
        'displaying.running.video.blurred',
        viewState.state,
      )
      const spaces = pos?.spaces ?? []
      const viewInfo = {
        state: viewState,
        isListening,
        isBackgroundListening,
        isBlurred,
        spaces,
      }
      views.push(viewInfo)
      for (const space of spaces) {
        if (!stateIdxMap.has(space)) {
          stateIdxMap.set(space, {})
        }
        Object.assign(stateIdxMap.get(space), viewInfo)
      }
    }

    const streams = sortBy(stateStreams, ['_id'])
    const customStreams = stateStreams.filter((s) => s._dataSource === 'custom')

    return {
      role,
      authState: auth,
      delayState: streamdelay,
      views,
      config,
      streams,
      customStreams,
      stateIdxMap,
    }
  }, [state])
}

export function ControlUI({
  connection,
}: {
  connection: StreamwallConnection
}) {
  const {
    isConnected,
    send,
    sharedState,
    stateDoc,
    config,
    streams,
    customStreams,
    views,
    stateIdxMap,
    delayState,
    authState,
    role,
  } = connection
  const {
    cols,
    rows,
    width: windowWidth,
    height: windowHeight,
  } = config ?? { cols: null, rows: null, width: null, height: null }

  const [showDebug, setShowDebug] = useState(false)
  const handleChangeShowDebug = useCallback<
    JSX.InputEventHandler<HTMLInputElement>
  >((ev) => {
    setShowDebug(ev.currentTarget.checked)
  }, [])

  const [swapStartIdx, setSwapStartIdx] = useState<number | undefined>()
  const handleSwapView = useCallback(
    (idx: number) => {
      if (!stateIdxMap.has(idx)) {
        return
      }
      // Deselect the input so the contents aren't persisted by GridInput's `editingValue`
      const { activeElement } = document
      if (activeElement && activeElement instanceof HTMLElement) {
        activeElement.blur()
      }
      setSwapStartIdx(idx)
    },
    [stateIdxMap],
  )
  const handleSwap = useCallback(
    (toIdx: number) => {
      if (swapStartIdx === undefined) {
        return
      }
      stateDoc.transact(() => {
        const viewsState = stateDoc.getMap<Y.Map<string | undefined>>('views')
        const startStreamId = viewsState
          ?.get(String(swapStartIdx))
          ?.get('streamId')
        const toStreamId = viewsState.get(String(toIdx))?.get('streamId')
        const startSpaces = stateIdxMap.get(swapStartIdx)?.spaces ?? []
        const toSpaces = stateIdxMap.get(toIdx)?.spaces ?? []
        for (const startSpaceIdx of startSpaces) {
          viewsState.get(String(startSpaceIdx))?.set('streamId', toStreamId)
        }
        for (const toSpaceIdx of toSpaces) {
          viewsState.get(String(toSpaceIdx))?.set('streamId', startStreamId)
        }
      })
      setSwapStartIdx(undefined)
    },
    [stateDoc, stateIdxMap, swapStartIdx],
  )

  const [hoveringIdx, setHoveringIdx] = useState<number>()
  const updateHoveringIdx = useCallback(
    (ev: MouseEvent) => {
      if (
        cols == null ||
        rows == null ||
        !(ev.currentTarget instanceof HTMLElement)
      ) {
        return
      }
      const { width, height, left, top } =
        ev.currentTarget.getBoundingClientRect()
      const x = Math.floor(ev.clientX - left)
      const y = Math.floor(ev.clientY - top)
      const spaceWidth = width / cols
      const spaceHeight = height / rows
      const idx =
        Math.floor(y / spaceHeight) * cols + Math.floor(x / spaceWidth)
      setHoveringIdx(idx)
    },
    [setHoveringIdx, cols, rows],
  )
  const [dragStart, setDragStart] = useState<number | undefined>()
  const handleDragStart = useCallback(
    (ev: MouseEvent) => {
      if (hoveringIdx == null) {
        return
      }
      ev.preventDefault()
      if (swapStartIdx !== undefined) {
        handleSwap(hoveringIdx)
      } else {
        setDragStart(hoveringIdx)
        // Select the text (if it is an input element)
        if (ev.target instanceof HTMLInputElement) {
          ev.target.select()
        }
      }
    },
    [handleSwap, swapStartIdx, hoveringIdx],
  )
  useLayoutEffect(() => {
    function endDrag() {
      if (
        dragStart == null ||
        cols == null ||
        rows == null ||
        hoveringIdx == null
      ) {
        return
      }
      stateDoc.transact(() => {
        const viewsState = stateDoc.getMap<Y.Map<string | undefined>>('views')
        const streamId = viewsState.get(String(dragStart))?.get('streamId')
        for (let idx = 0; idx < cols * rows; idx++) {
          if (idxInBox(cols, dragStart, hoveringIdx, idx)) {
            viewsState.get(String(idx))?.set('streamId', streamId)
          }
        }
      })
      setDragStart(undefined)
    }
    window.addEventListener('mouseup', endDrag)
    return () => window.removeEventListener('mouseup', endDrag)
  }, [stateDoc, dragStart, hoveringIdx])

  const [focusedInputIdx, setFocusedInputIdx] = useState<number | undefined>()
  const handleBlurInput = useCallback(() => setFocusedInputIdx(undefined), [])

  const handleSetView = useCallback(
    (idx: number, streamId: string) => {
      const stream = streams.find((d) => d._id === streamId)
      stateDoc
        .getMap<Y.Map<string | undefined>>('views')
        .get(String(idx))
        ?.set('streamId', stream ? streamId : '')
    },
    [stateDoc, streams],
  )

  const handleSetListening = useCallback(
    (idx: number, listening: boolean) => {
      send({
        type: 'set-listening-view',
        viewIdx: listening ? idx : null,
      })
    },
    [send],
  )

  const handleSetBackgroundListening = useCallback(
    (viewIdx: number, listening: boolean) => {
      send({
        type: 'set-view-background-listening',
        viewIdx,
        listening,
      })
    },
    [send],
  )

  const handleSetBlurred = useCallback(
    (viewIdx: number, blurred: boolean) => {
      send({
        type: 'set-view-blurred',
        viewIdx,
        blurred,
      })
    },
    [send],
  )

  const handleReloadView = useCallback(
    (viewIdx: number) => {
      send({
        type: 'reload-view',
        viewIdx,
      })
    },
    [send],
  )

  const handleRotateStream = useCallback(
    (streamId: string) => {
      const stream = streams.find((d) => d._id === streamId)
      if (!stream) {
        return
      }
      send({
        type: 'rotate-stream',
        url: stream.link,
        rotation: ((stream.rotation || 0) + 90) % 360,
      })
    },
    [streams],
  )

  const handleBrowse = useCallback(
    (streamId: string) => {
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

  const handleDevTools = useCallback(
    (viewIdx: number) => {
      send({
        type: 'dev-tools',
        viewIdx,
      })
    },
    [send],
  )

  const handleClickId = useCallback(
    (streamId: string) => {
      if (cols == null || rows == null || sharedState == null) {
        return
      }

      try {
        navigator.clipboard.writeText(streamId)
      } catch (err) {
        console.warn('Unable to copy stream id to clipboard:', err)
      }

      if (focusedInputIdx !== undefined) {
        handleSetView(focusedInputIdx, streamId)
        return
      }

      const availableIdx = range(cols * rows).find(
        (i) => !sharedState.views[i].streamId,
      )
      if (availableIdx === undefined) {
        return
      }
      handleSetView(availableIdx, streamId)
    },
    [cols, rows, sharedState, focusedInputIdx],
  )

  const handleChangeCustomStream = useCallback(
    (url: string, customStream: LocalStreamData) => {
      send({
        type: 'update-custom-stream',
        url,
        data: customStream,
      })
    },
    [send],
  )

  const handleDeleteCustomStream = useCallback(
    (url: string) => {
      send({
        type: 'delete-custom-stream',
        url,
      })
      return
    },
    [send],
  )

  const setStreamCensored = useCallback(
    (isCensored: boolean) => {
      send({
        type: 'set-stream-censored',
        isCensored,
      })
    },
    [send],
  )

  const setStreamRunning = useCallback(
    (isStreamRunning: boolean) => {
      send({
        type: 'set-stream-running',
        isStreamRunning,
      })
    },
    [send],
  )

  const [newInvite, setNewInvite] = useState<Invite>()

  const handleCreateInvite = useCallback(
    ({ name, role }: { name: string; role: StreamwallRole }) => {
      send(
        {
          type: 'create-invite',
          name,
          role,
        },
        (msg) => {
          setNewInvite(msg as Invite) // TODO: validate w/ Zod
        },
      )
    },
    [],
  )

  const handleDeleteToken = useCallback((tokenId: string) => {
    send({
      type: 'delete-token',
      tokenId,
    })
  }, [])

  const preventLinkClick = useCallback((ev: Event) => {
    ev.preventDefault()
  }, [])

  const [streamFilter, setStreamFilter] = useState('')
  const handleStreamFilterChange = useCallback<
    JSX.InputEventHandler<HTMLInputElement>
  >((ev) => {
    setStreamFilter(ev.currentTarget?.value)
  }, [])

  // Set up keyboard shortcuts.
  useHotkeys(
    hotkeyTriggers.map((k) => `alt+${k}`).join(','),
    (ev, { hotkey }) => {
      ev.preventDefault()
      const idx = hotkeyTriggers.indexOf(hotkey[hotkey.length - 1])
      const isListening = stateIdxMap.get(idx)?.isListening ?? false
      handleSetListening(idx, !isListening)
    },
    // This enables hotkeys when input elements are focused, and affects all hotkeys, not just this one.
    { filter: () => true },
    [stateIdxMap],
  )
  useHotkeys(
    hotkeyTriggers.map((k) => `alt+shift+${k}`).join(','),
    (ev, { hotkey }) => {
      ev.preventDefault()
      const idx = hotkeyTriggers.indexOf(hotkey[hotkey.length - 1])
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
      if (focusedInputIdx != null) {
        handleSwapView(focusedInputIdx)
      }
    },
    [handleSwapView, focusedInputIdx],
  )

  const wallStreamIds = useMemo(
    () =>
      new Set(
        Object.values(sharedState?.views ?? {})
          .map(({ streamId }) => streamId)
          .filter((x) => x !== undefined),
      ),
    [sharedState],
  )
  const [wallStreams, liveStreams, otherStreams] = useMemo(
    () => filterStreams(streams, wallStreamIds, streamFilter),
    [streams, wallStreamIds, streamFilter],
  )
  function StreamList({ rows }: { rows: StreamData[] }) {
    return rows.map((row) => (
      <StreamLine
        id={row._id}
        row={row}
        disabled={!roleCan(role, 'mutate-state-doc')}
        onClickId={handleClickId}
      />
    ))
  }

  return (
    <Stack flex="1" direction="row" gap={16}>
      <Stack className="grid-container">
        <StyledHeader>
          {role !== 'local' && (
            <>
              <h1>Streamwall ({location.host})</h1>
              <div>
                connection status: {isConnected ? 'connected' : 'connecting...'}
              </div>
              <div>role: {role}</div>
            </>
          )}
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
          {cols != null && rows != null && (
            <StyledGridContainer
              className="grid"
              onMouseMove={updateHoveringIdx}
              windowWidth={windowWidth}
              windowHeight={windowHeight}
            >
              <StyledGridInputs>
                {range(0, rows).map((y) =>
                  range(0, cols).map((x) => {
                    const idx = cols * y + x
                    const { streamId } = sharedState?.views?.[idx] ?? {}
                    const isDragHighlighted =
                      dragStart != null &&
                      hoveringIdx != null &&
                      idxInBox(cols, dragStart, hoveringIdx, idx)
                    return (
                      <GridInput
                        style={{
                          width: `${100 / cols}%`,
                          height: `${100 / rows}%`,
                          left: `${(100 * x) / cols}%`,
                          top: `${(100 * y) / rows}%`,
                        }}
                        idx={idx}
                        spaceValue={streamId ?? ''}
                        onChangeSpace={handleSetView}
                        isHighlighted={isDragHighlighted}
                        role={role}
                        onMouseDown={handleDragStart}
                        onFocus={setFocusedInputIdx}
                        onBlur={handleBlurInput}
                      />
                    )
                  }),
                )}
              </StyledGridInputs>
              <StyledGridPreview>
                {views.map(({ state, isListening }) => {
                  const { pos } = state.context
                  if (pos == null) {
                    return null
                  }

                  const { streamId } = sharedState?.views[pos.spaces[0]] ?? {}
                  const data = streams.find((d) => d._id === streamId)
                  if (streamId == null || !data == null) {
                    return null
                  }

                  return (
                    <StyledGridPreviewBox
                      color={idColor(streamId)}
                      style={{
                        left: `${(100 * pos.x) / windowWidth}%`,
                        top: `${(100 * pos.y) / windowHeight}%`,
                        width: `${(100 * pos.width) / windowWidth}%`,
                        height: `${(100 * pos.height) / windowHeight}%`,
                      }}
                      pos={pos}
                      windowWidth={windowWidth}
                      windowHeight={windowHeight}
                      isListening={isListening}
                      isError={matchesState('displaying.error', state.state)}
                    >
                      <StyledGridInfo>
                        <StyledGridLabel>{streamId}</StyledGridLabel>
                        <div>{data?.source}</div>
                      </StyledGridInfo>
                    </StyledGridPreviewBox>
                  )
                })}
              </StyledGridPreview>
              {views.map(
                ({ state, isListening, isBackgroundListening, isBlurred }) => {
                  const { pos } = state.context
                  if (!pos) {
                    return null
                  }
                  const { streamId } = sharedState?.views[pos.spaces[0]] ?? {}
                  if (!streamId) {
                    return null
                  }
                  return (
                    <GridControls
                      idx={pos.spaces[0]}
                      streamId={streamId}
                      style={{
                        left: `${(100 * pos.x) / windowWidth}%`,
                        top: `${(100 * pos.y) / windowHeight}%`,
                        width: `${(100 * pos.width) / windowWidth}%`,
                        height: `${(100 * pos.height) / windowHeight}%`,
                      }}
                      isDisplaying={matchesState('displaying', state.state)}
                      isListening={isListening}
                      isBackgroundListening={isBackgroundListening}
                      isBlurred={isBlurred}
                      isSwapping={
                        swapStartIdx != null &&
                        pos.spaces.includes(swapStartIdx)
                      }
                      showDebug={showDebug}
                      role={role}
                      onSetListening={handleSetListening}
                      onSetBackgroundListening={handleSetBackgroundListening}
                      onSetBlurred={handleSetBlurred}
                      onReloadView={handleReloadView}
                      onSwapView={handleSwapView}
                      onRotateView={handleRotateStream}
                      onBrowse={handleBrowse}
                      onDevTools={handleDevTools}
                      onMouseDown={handleDragStart}
                    />
                  )
                },
              )}
            </StyledGridContainer>
          )}
          {(roleCan(role, 'dev-tools') || roleCan(role, 'browse')) && (
            <label>
              <input
                type="checkbox"
                checked={showDebug}
                onChange={handleChangeShowDebug}
              />
              Show stream debug tools
            </label>
          )}
          <Facts />
        </StyledDataContainer>
      </Stack>
      <Stack className="stream-list" flex="1" scroll={true} minHeight={200}>
        <StyledDataContainer isConnected={isConnected}>
          {isConnected ? (
            <div>
              <input
                onChange={handleStreamFilterChange}
                value={streamFilter}
                placeholder="filter"
              />
              <h3>Viewing</h3>
              <StreamList rows={wallStreams} />
              <h3>Live</h3>
              <StreamList rows={liveStreams} />
              <h3>Offline / Unknown</h3>
              <StreamList rows={otherStreams} />
            </div>
          ) : (
            <div>loading...</div>
          )}
          {roleCan(role, 'update-custom-stream') &&
            roleCan(role, 'delete-custom-stream') && (
              <>
                <h2>Custom Streams</h2>
                <div>
                  {/*
                    Include an empty object at the end to create an extra input for a new custom stream.
                    We need it to be part of the array (rather than JSX below) for DOM diffing to match the key and retain focus.
                  */}
                  {customStreams.map(({ link, label, kind }, idx) => (
                    <CustomStreamInput
                      key={idx}
                      link={link}
                      label={label}
                      kind={kind}
                      onChange={handleChangeCustomStream}
                      onDelete={handleDeleteCustomStream}
                    />
                  ))}
                  <CreateCustomStreamInput
                    onCreate={handleChangeCustomStream}
                  />
                </div>
              </>
            )}
          {(roleCan(role, 'create-invite') || roleCan(role, 'delete-token')) &&
            authState && (
              <>
                <h2>Access</h2>
                <div>
                  <CreateInviteInput onCreateInvite={handleCreateInvite} />
                  <h3>Invites</h3>
                  {newInvite && (
                    <StyledNewInviteBox>
                      Invite link created:{' '}
                      <a
                        href={inviteLink({
                          tokenId: newInvite.tokenId,
                          secret: newInvite.secret,
                        })}
                        onClick={preventLinkClick}
                      >
                        "{newInvite.name}"
                      </a>
                    </StyledNewInviteBox>
                  )}
                  {authState.invites.map(({ tokenId, name, role }) => (
                    <AuthTokenLine
                      id={tokenId}
                      name={name}
                      role={role}
                      onDelete={handleDeleteToken}
                    />
                  ))}
                  <h3>Sessions</h3>
                  {authState.sessions.map(({ tokenId, name, role }) => (
                    <AuthTokenLine
                      id={tokenId}
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
  flex-direction: ${({ direction }) => direction ?? 'column'};
  flex: ${({ flex }) => flex};
  ${({ gap }) => gap && `gap: ${gap}px`};
  ${({ scroll }) => scroll && `overflow-y: auto`};
  ${({ minHeight }) => minHeight && `min-height: ${minHeight}px`};
`

function StreamDurationClock({ startTime }: { startTime: number }) {
  const [now, setNow] = useState(() => DateTime.now())
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(DateTime.now())
    }, 500)
    return () => {
      clearInterval(interval)
    }
  }, [startTime])
  return (
    <span>{now.diff(DateTime.fromMillis(startTime)).toFormat('hh:mm:ss')}</span>
  )
}

function StreamDelayBox({
  role,
  delayState,
  setStreamCensored,
  setStreamRunning,
}: {
  role: StreamwallRole | null
  delayState: StreamDelayStatus
  setStreamCensored: (isCensored: boolean) => void
  setStreamRunning: (isStreamRunning: boolean) => void
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
    if (matchesState('censorship.censored.deactivating', delayState.state)) {
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
            {delayState.startTime !== null && (
              <StreamDurationClock startTime={delayState.startTime} />
            )}
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
  row: { label, source, link, notes, city, state },
  disabled,
  onClickId,
}: {
  id: string
  row: StreamData
  disabled: boolean
  onClickId: (id: string) => void
}) {
  // Use mousedown instead of click event so a potential destination grid input stays focused.
  const handleMouseDownId = useCallback(() => {
    onClickId(id)
  }, [onClickId, id])
  return (
    <StyledStreamLine>
      <StyledId
        $disabled={disabled}
        onMouseDown={disabled ? null : handleMouseDownId}
        $color={idColor(id)}
      >
        {id}
      </StyledId>
      <div>
        {label ? (
          label
        ) : (
          <>
            <strong>{source}</strong> {city ? `(${city} ${state}) ` : ''}
            <a href={link} target="_blank">
              {truncate(link, { length: 55 })}
            </a>{' '}
            {notes}
          </>
        )}
      </div>
    </StyledStreamLine>
  )
}

// An input that maintains local edits and fires onChange after blur (like a non-React input does), or optionally on every edit if isEager is set.
function LazyChangeInput({
  value = '',
  onChange,
  isEager = false,
  ...props
}: {
  value: string
  isEager?: boolean
  onChange: (value: string) => void
} & Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'onChange'>) {
  const [editingValue, setEditingValue] = useState<string>()
  const handleFocus = useCallback<JSX.FocusEventHandler<HTMLInputElement>>(
    (ev) => {
      if (ev.target instanceof HTMLInputElement) {
        setEditingValue(ev.target.value)
      }
    },
    [],
  )

  const handleBlur = useCallback(() => {
    if (!isEager && editingValue !== undefined) {
      onChange(editingValue)
    }
    setEditingValue(undefined)
  }, [editingValue])

  const handleKeyDown = useCallback<JSX.KeyboardEventHandler<HTMLInputElement>>(
    (ev) => {
      if (ev.key === 'Enter') {
        handleBlur()
      }
    },
    [],
  )

  const handleChange = useCallback<JSX.InputEventHandler<HTMLInputElement>>(
    (ev) => {
      const { value } = ev.currentTarget
      setEditingValue(value)
      if (isEager) {
        onChange(value)
      }
    },
    [onChange, isEager],
  )

  return (
    <input
      value={editingValue !== undefined ? editingValue : value}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onChange={handleChange}
      {...props}
    />
  )
}

function GridInput({
  style,
  idx,
  onChangeSpace,
  spaceValue,
  isHighlighted,
  role,
  onMouseDown,
  onFocus,
  onBlur,
}: {
  style: JSX.HTMLAttributes['style']
  onMouseDown: JSX.MouseEventHandler<HTMLInputElement>
  idx: number
  onChangeSpace: (idx: number, value: string) => void
  spaceValue: string
  isHighlighted: boolean
  role: StreamwallRole | null
  onFocus: (idx: number) => void
  onBlur: (idx: number) => void
}) {
  const handleFocus = useCallback(() => {
    onFocus(idx)
  }, [onFocus, idx])
  const handleBlur = useCallback(() => {
    onBlur(idx)
  }, [onBlur, idx])
  const handleChange = useCallback(
    (value: string) => {
      onChangeSpace(idx, value)
    },
    [idx, onChangeSpace],
  )
  return (
    <StyledGridInputContainer style={style}>
      <StyledGridInput
        value={spaceValue}
        color={idColor(spaceValue)}
        isHighlighted={isHighlighted}
        disabled={!roleCan(role, 'mutate-state-doc')}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onMouseDown={onMouseDown}
        onChange={handleChange}
        isEager
      />
    </StyledGridInputContainer>
  )
}

function GridControls({
  idx,
  streamId,
  style,
  isDisplaying,
  isListening,
  isBackgroundListening,
  isBlurred,
  isSwapping,
  showDebug,
  role,
  onSetListening,
  onSetBackgroundListening,
  onSetBlurred,
  onReloadView,
  onSwapView,
  onRotateView,
  onBrowse,
  onDevTools,
  onMouseDown,
}: {
  idx: number
  streamId: string
  style: JSX.HTMLAttributes['style']
  isDisplaying: boolean
  isListening: boolean
  isBackgroundListening: boolean
  isBlurred: boolean
  isSwapping: boolean
  showDebug: boolean
  role: StreamwallRole | null
  onSetListening: (idx: number, isListening: boolean) => void
  onSetBackgroundListening: (
    idx: number,
    isBackgroundListening: boolean,
  ) => void
  onSetBlurred: (idx: number, isBlurred: boolean) => void
  onReloadView: (idx: number) => void
  onSwapView: (idx: number) => void
  onRotateView: (streamId: string) => void
  onBrowse: (streamId: string) => void
  onDevTools: (idx: number) => void
  onMouseDown: JSX.MouseEventHandler<HTMLDivElement>
}) {
  // TODO: Refactor callbacks to use streamID instead of idx.
  // We should probably also switch the view-state-changing RPCs to use a view id instead of idx like they do currently.
  const handleListeningClick = useCallback<
    JSX.MouseEventHandler<HTMLButtonElement>
  >(
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
  const handleBlurClick = useCallback(
    () => onSetBlurred(idx, !isBlurred),
    [idx, onSetBlurred, isBlurred],
  )
  const handleReloadClick = useCallback(
    () => onReloadView(idx),
    [idx, onReloadView],
  )
  const handleSwapClick = useCallback(() => onSwapView(idx), [idx, onSwapView])
  const handleRotateClick = useCallback(
    () => onRotateView(streamId),
    [streamId, onRotateView],
  )
  const handleBrowseClick = useCallback(
    () => onBrowse(streamId),
    [streamId, onBrowse],
  )
  const handleDevToolsClick = useCallback(
    () => onDevTools(idx),
    [idx, onDevTools],
  )
  return (
    <StyledGridControlsContainer style={style} onMouseDown={onMouseDown}>
      {isDisplaying && (
        <StyledGridButtons side="left">
          {showDebug ? (
            <>
              {roleCan(role, 'reload-view') && (
                <StyledSmallButton onClick={handleReloadClick} tabIndex={1}>
                  <FaSyncAlt />
                </StyledSmallButton>
              )}
              {roleCan(role, 'browse') && (
                <StyledSmallButton onClick={handleBrowseClick} tabIndex={1}>
                  <FaRegWindowMaximize />
                </StyledSmallButton>
              )}
              {roleCan(role, 'dev-tools') && (
                <StyledSmallButton onClick={handleDevToolsClick} tabIndex={1}>
                  <FaRegLifeRing />
                </StyledSmallButton>
              )}
            </>
          ) : (
            <>
              {roleCan(role, 'reload-view') && (
                <StyledSmallButton onClick={handleReloadClick} tabIndex={1}>
                  <FaSyncAlt />
                </StyledSmallButton>
              )}
              {roleCan(role, 'mutate-state-doc') && (
                <StyledSmallButton
                  isActive={isSwapping}
                  onClick={handleSwapClick}
                  tabIndex={1}
                >
                  <FaExchangeAlt />
                </StyledSmallButton>
              )}
              {roleCan(role, 'rotate-stream') && (
                <StyledSmallButton onClick={handleRotateClick} tabIndex={1}>
                  <FaRedoAlt />
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
            <FaVideoSlash />
          </StyledButton>
        )}
        {roleCan(role, 'set-listening-view') && (
          <StyledButton
            isActive={isListening || isBackgroundListening}
            activeColor={
              isListening ? 'red' : Color('red').desaturate(0.5).hsl().string()
            }
            onClick={handleListeningClick}
            tabIndex={1}
          >
            <FaVolumeUp />
          </StyledButton>
        )}
      </StyledGridButtons>
    </StyledGridControlsContainer>
  )
}

function CustomStreamInput({
  onChange,
  onDelete,
  ...props
}: {
  onChange: (link: string, data: LocalStreamData) => void
  onDelete: (link: string) => void
} & LocalStreamData) {
  const handleChangeLabel = useCallback(
    (value: string) => {
      onChange(props.link, { ...props, label: value })
    },
    [onChange, props],
  )

  const handleDeleteClick = useCallback(() => {
    onDelete(props.link)
  }, [onDelete, props.link])

  return (
    <div>
      <LazyChangeInput
        value={props.label ?? ''}
        onChange={handleChangeLabel}
        placeholder="Label (optional)"
      />{' '}
      <a href={props.link}>{props.link}</a> <span>({props.kind})</span>{' '}
      <button onClick={handleDeleteClick}>x</button>
    </div>
  )
}

function CreateCustomStreamInput({
  onCreate,
}: {
  onCreate: (link: string, data: LocalStreamData) => void
}) {
  const [link, setLink] = useState('')
  const [kind, setKind] = useState<ContentKind>('video')
  const [label, setLabel] = useState('')
  const handleSubmit = useCallback<JSX.SubmitEventHandler<HTMLFormElement>>(
    (ev) => {
      ev.preventDefault()
      onCreate(link, { link, kind, label })
      setLink('')
      setKind('video')
      setLabel('')
    },
    [onCreate, link, kind, label],
  )
  return (
    <form onSubmit={handleSubmit}>
      <input
        value={link}
        onChange={(ev) => setLink(ev.currentTarget.value)}
        placeholder="https://..."
      />
      <select
        onChange={(ev) => setKind(ev.currentTarget.value as ContentKind)}
        value={kind}
      >
        <option value="video">video</option>
        <option value="audio">audio</option>
        <option value="web">web</option>
        <option value="overlay">overlay</option>
        <option value="background">background</option>
      </select>
      <input
        value={label}
        onChange={(ev) => setLabel(ev.currentTarget.value)}
        placeholder="Label (optional)"
      />
      <button type="submit">add stream</button>
    </form>
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
      border-color: ${Color(activeColor).hsl().string()};
      background: ${Color(activeColor).desaturate(0.5).lighten(0.5).hsl().string()};
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

const StyledGridPreview = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
`

const StyledGridPreviewBox = styled.div.attrs(() => ({
  borderWidth: 2,
}))`
  display: flex;
  align-items: center;
  justify-content: center;
  position: absolute;
  background: ${({ color }) =>
    Color(color).lightness(50).hsl().string() || '#333'};
  border: 0 solid
    ${({ isError }) =>
      isError ? Color('red').hsl().string() : Color('black').hsl().string()};
  border-left-width: ${({ pos, borderWidth }) =>
    pos.x === 0 ? 0 : borderWidth}px;
  border-right-width: ${({ pos, borderWidth, windowWidth }) =>
    pos.x + pos.width === windowWidth ? 0 : borderWidth}px;
  border-top-width: ${({ pos, borderWidth }) =>
    pos.y === 0 ? 0 : borderWidth}px;
  border-bottom-width: ${({ pos, borderWidth, windowHeight }) =>
    pos.y + pos.height === windowHeight ? 0 : borderWidth}px;
  box-shadow: ${({ isListening }) =>
    isListening ? `0 0 0 4px red inset` : 'none'};
  box-sizing: border-box;
  overflow: hidden;
  user-select: none;
`

const StyledGridInfo = styled.div`
  text-align: center;
`

const StyledGridLabel = styled.div`
  font-size: 30px;
`

const StyledGridInputs = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  transition: opacity 100ms ease-out;
  overflow: hidden;
  z-index: 100;
`

const StyledGridInputContainer = styled.div`
  position: absolute;
`

const StyledGridButtons = styled.div`
  display: flex;
  position: absolute;
  ${({ side }) =>
    side === 'left' ? 'top: 0; left: 0' : 'bottom: 0; right: 0'};

  ${StyledButton} {
    margin: 5px;
    ${({ side }) => (side === 'left' ? 'margin-right: 0' : 'margin-left: 0')};
  }
`

const StyledGridInput = styled(LazyChangeInput)`
  width: 100%;
  height: 100%;
  outline: 1px solid black;
  border: none;
  padding: 0;
  background: ${({ color, isHighlighted }) =>
    isHighlighted
      ? Color(color).lightness(90).hsl().string()
      : Color(color).lightness(75).hsl().string()};
  font-size: 20px;
  text-align: center;

  &:focus {
    outline: 1px solid black;
    box-shadow: 0 0 5px black inset;
    z-index: 100;
  }
`

const StyledGridControlsContainer = styled.div`
  position: absolute;
  user-select: none;

  & > * {
    z-index: 200;
  }
`

const StyledGridContainer = styled.div.attrs(() => ({
  scale: 0.75,
}))`
  position: relative;
  width: ${({ windowWidth, scale }) => windowWidth * scale}px;
  height: ${({ windowHeight, scale }) => windowHeight * scale}px;
  border: 2px solid black;
  background: black;

  &:hover ${StyledGridInputs} {
    opacity: 0.35;
  }
`

const StyledId = styled.div`
  flex-shrink: 0;
  margin-right: 5px;
  background: ${({ $color }) =>
    Color($color).lightness(50).hsl().string() || '#333'};
  color: white;
  padding: 3px;
  border-radius: 5px;
  width: 3em;
  text-align: center;
  cursor: ${({ $disabled }) => ($disabled ? 'normal' : 'pointer')};
`

const StyledStreamLine = styled.div`
  display: flex;
  align-items: center;
  margin: 0.5em 0;
`

function CreateInviteInput({
  onCreateInvite,
}: {
  onCreateInvite: (invite: { name: string; role: StreamwallRole }) => void
}) {
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState('operator')
  const handleChangeName = useCallback<JSX.InputEventHandler<HTMLInputElement>>(
    (ev) => {
      setInviteName(ev.currentTarget.value)
    },
    [setInviteName],
  )
  const handleChangeRole = useCallback<
    JSX.InputEventHandler<HTMLSelectElement>
  >(
    (ev) => {
      setInviteRole(ev.currentTarget.value)
    },
    [setInviteRole],
  )
  const handleSubmit = useCallback<JSX.SubmitEventHandler<HTMLFormElement>>(
    (ev) => {
      ev.preventDefault()
      setInviteName('')
      setInviteRole('operator')
      onCreateInvite({ name: inviteName, role: inviteRole as StreamwallRole }) // TODO: validate
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
          <option value="admin">admin</option>
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

function AuthTokenLine({
  id,
  role,
  name,
  onDelete,
}: {
  id: string
  role: StreamwallRole
  name: string
  onDelete: (id: string) => void
}) {
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

// TODO: reuse for server
/*
export function main() {
  const script = document.getElementById('main-script')
  const wsEndpoint =
    typeof script?.dataset?.wsEndpoint === 'string'
      ? script.dataset.wsEndpoint
      : 'defaultWsEndpoint'
  const role =
    typeof script?.dataset?.role === 'string'
      ? (script.dataset.role as StreamwallRole)
      : null

  render(
    <>
      <GlobalStyle />
      <App wsEndpoint={wsEndpoint} role={role} />
    </>,
    document.body,
  )
}
*/
