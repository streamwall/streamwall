import '@fontsource/noto-sans'
import 'leaflet/dist/leaflet.css'
import Color from 'color'
import { range, sortBy, truncate } from 'lodash-es'
import { DateTime } from 'luxon'
import { JSX } from 'preact'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks'
import { useHotkeys } from 'react-hotkeys-hook'
import {
  FaExchangeAlt,
  FaFolder,
  FaCog,
  FaRedoAlt,
  FaRegLifeRing,
  FaRegWindowMaximize,
  FaSearch,
  FaSyncAlt,
  FaTimes,
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

// Leaflet types for global window
declare global {
  interface Window {
    L: any
  }
}

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

// Soft palette for grids; index-based lookup
const GRID_PALETTE = ['#4c7df0', '#f27f7f', '#4dbd82', '#f2c14f', '#a76de2']

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
  highwayFilters: Set<string>,
  cityFilters: Set<string>,
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
      // Apply static filter logic for offline streams
      if ((highwayFilters.size > 0 || cityFilters.size > 0) && label) {
        let matchesFilters = true
        
        // If highway filters are selected, check if stream contains any of them
        if (highwayFilters.size > 0) {
          const matchesHighway = Array.from(highwayFilters).some(highway => 
            label.includes(highway)
          )
          if (!matchesHighway) matchesFilters = false
        }
        
        // If city filters are selected, check if stream starts with any of them
        if (cityFilters.size > 0) {
          const matchesCity = Array.from(cityFilters).some(city => {
            // Check for exact matches like "CR -", "IC -", etc.
            if (label.startsWith(city + ' -')) return true
            
            // Check for variations with digits like "6DT -", "6DW -", etc.
            const cityPattern = new RegExp(`^\\d*${city}\\w* -`, 'i')
            return cityPattern.test(label)
          })
          if (!matchesCity) matchesFilters = false
        }
        
        if (!matchesFilters) continue
      }
      otherStreams.push(stream)
    }
  }
  
  // Sort all stream lists alphabetically by label
  wallStreams.sort((a, b) => (a.label || '').localeCompare(b.label || ''))
  liveStreams.sort((a, b) => (a.label || '').localeCompare(b.label || ''))
  otherStreams.sort((a, b) => (a.label || '').localeCompare(b.label || ''))
  
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
  uiState?: { loopRefreshErrored?: boolean }
}

export interface StreamwallConnection {
  isConnected: boolean
  role: StreamwallRole | null
  send: (msg: ControlCommand, cb?: (msg: unknown) => void) => void
  openConfigFolder?: () => void
  sharedState: CollabData | undefined
  stateDoc: Y.Doc
  config: StreamWindowConfig | undefined
  streams: StreamData[]
  customStreams: StreamData[]
  views: ViewInfo[]
  stateIdxMap: Map<number, ViewInfo>
  delayState: StreamDelayStatus | null | undefined
  authState?: StreamwallState['auth']
  savedLayouts?: StreamwallState['savedLayouts']
  grids?: Array<{
    id: string
    config: StreamWindowConfig
    views: ViewInfo[]
    stateIdxMap: Map<number, ViewInfo>
    cellOffset: number
  }>
  defaultGridId?: string | null
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
        savedLayouts: undefined,
        grids: [],
        defaultGridId: null,
      }
    }

    const {
      identity: { role },
      auth,
      config,
      streams: stateStreams,
      customStreams: stateCustomStreams,
      views: stateViews,
      streamdelay,
      savedLayouts,
      grids,
    } = state

    const buildViewInfo = (viewStates: ViewState[]) => {
      const stateIdxMap = new Map<number, ViewInfo>()
      const viewInfos: ViewInfo[] = []
      for (const viewState of viewStates) {
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
        const info: ViewInfo = {
          state: viewState,
          isListening,
          isBackgroundListening,
          isBlurred,
          spaces,
        }
        viewInfos.push(info)
        for (const space of spaces) {
          stateIdxMap.set(space, info)
        }
      }
      return { viewInfos, stateIdxMap }
    }

    const gridStatesSource = grids?.length
      ? grids
      : [{ id: 'grid-1', config, views: stateViews, cellOffset: 0 }]

    const enhancedGrids = gridStatesSource.map((grid) => {
      const { viewInfos, stateIdxMap } = buildViewInfo(grid.views)
      return { ...grid, views: viewInfos, stateIdxMap }
    })

    const primaryGrid = enhancedGrids[0]

    return {
      role,
      config: primaryGrid?.config,
      streams: stateStreams,
      customStreams: stateCustomStreams ?? [],
      views: primaryGrid?.views ?? [],
      stateIdxMap: primaryGrid?.stateIdxMap ?? new Map(),
      delayState: streamdelay,
      authState: auth,
      savedLayouts,
      grids: enhancedGrids,
      defaultGridId: state.grids?.[0]?.id ?? enhancedGrids[0]?.id ?? null,
    }
  }, [state])
}

import 'leaflet/dist/leaflet.css'

// ...existing code...

// Leaflet.js map component - works reliably in web browser environment
function StreamLocationMap({ streams, wallStreams, onStreamPreview }: { 
  streams: StreamData[], 
  wallStreams: StreamData[],
  onStreamPreview: (streamId: string) => void
}) {
  const mapRef = useRef<HTMLDivElement>(null)
  const leafletMapRef = useRef<any>(null)
  const markersRef = useRef<Map<string, any>>(new Map())
  const hasInitialFitRef = useRef(false)
  const markersInitializedRef = useRef(false)
  const [mapReady, setMapReady] = useState(false)
  
  console.log('StreamLocationMap mounted with', streams.length, 'total streams')
  if (streams.length > 0) {
    console.log('First stream:', streams[0])
  }
  
  // Filter streams that have location data
  const streamWithLocation = useMemo(() => {
    const filtered = streams.filter(stream => 
      stream.latitude != null && 
      stream.longitude != null
    )
    console.log('Filtered to', filtered.length, 'streams with location data')
    if (filtered.length === 0 && streams.length > 0) {
      console.log('First stream lat/lon:', streams[0].latitude, streams[0].longitude)
      console.log('Stream keys:', Object.keys(streams[0]))
    }
    return filtered
  }, [streams])

  // Initialize map on mount
  useEffect(() => {
    const initializeMap = async () => {
      console.log('Initializing map, mapRef.current:', !!mapRef.current, 'leafletMapRef.current:', !!leafletMapRef.current)
      if (!mapRef.current || leafletMapRef.current) return

      try {
        // Dynamically import Leaflet
        const L = (await import('leaflet')).default
        console.log('Leaflet imported successfully')

        // Create map instance
        leafletMapRef.current = L.map(mapRef.current, {
          center: [41.85571672210071, -91.86152308331968], // Centered on specified location
          zoom: 10,
          zoomControl: true,
          scrollWheelZoom: true
        })
        console.log('Map instance created')

        // Add OpenStreetMap tiles using protocol-relative URL
        L.tileLayer('//{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors',
          maxZoom: 18,
          subdomains: ['a', 'b', 'c'],
          crossOrigin: true
        }).addTo(leafletMapRef.current)
        console.log('Tile layer added')

        // Force map to recalculate size with a small delay
        setTimeout(() => {
          if (leafletMapRef.current) {
            leafletMapRef.current.invalidateSize()
            console.log('Map size invalidated')
          }
        }, 100)

        setMapReady(true)
        console.log('Map ready flag set')
      } catch (error) {
        console.error('Failed to initialize map:', error)
      }
    }

    initializeMap()

    return () => {
      if (leafletMapRef.current) {
        leafletMapRef.current.remove()
        leafletMapRef.current = null
      }
    }
  }, [])

  // Update markers when streams or map readiness changes
  useEffect(() => {
    if (!leafletMapRef.current || !mapReady) {
      console.log('Skipping marker update: map not ready', { hasMap: !!leafletMapRef.current, mapReady })
      return
    }
    
    // Only initialize markers once on first load, but wait until we have streams with location data
    if (markersInitializedRef.current) {
      console.log('Skipping marker update: already initialized')
      return
    }
    if (streamWithLocation.length === 0) {
      console.log('Skipping marker update: no streams with location data yet')
      return
    }
    
    const updateMarkers = async () => {
      const L = (await import('leaflet')).default

      console.log('Updating markers for', streamWithLocation.length, 'streams with location')

      // Clear existing markers
      markersRef.current.forEach((marker: any) => marker.remove())
      markersRef.current.clear()

      // Add markers for each camera
      streamWithLocation.forEach(stream => {
        console.log('Adding marker for', stream._id, 'at', stream.latitude, stream.longitude)
        // Check if stream is in the viewing list
        const isViewing = wallStreams.some(s => s._id === stream._id)
        
        const marker = L.circleMarker([stream.latitude!, stream.longitude!], {
          radius: 6,
          fillColor: isViewing ? '#4CAF50' : '#1976D2',
          color: '#ffffff',
          weight: 2,
          opacity: 0.8,
          fillOpacity: 0.8
        })

        // Create popup with stream information
        const popupContent = `
          <div style="font-size: 12px; line-height: 1.5; min-width: 180px;">
            <strong>${stream.label || stream._id}</strong><br>
            <small style="color: #666;">Lat: ${stream.latitude!.toFixed(4)}</small><br>
            <small style="color: #666;">Lon: ${stream.longitude!.toFixed(4)}</small>
          </div>
        `
        
        const popup = L.popup().setContent(popupContent)
        marker.bindPopup(popup)
        
        // Highlight in list when popup opens
        marker.on('popupopen', () => {
          onStreamPreview(stream._id)
        })

        // Handle click to highlight in list
        marker.on('click', () => {
          onStreamPreview(stream._id)
        })

        marker.addTo(leafletMapRef.current)
        markersRef.current.set(stream._id, marker)
      })

      // Mark that markers have been loaded (fitBounds will be called via home button instead)
      if (streamWithLocation.length > 0 && !hasInitialFitRef.current) {
        hasInitialFitRef.current = true
        console.log('Markers loaded, initial zoom level will be preserved')
      }
      
      // Mark markers as initialized so we don't redraw them
      markersInitializedRef.current = true
      console.log('Markers initialized successfully, added', markersRef.current.size, 'markers to map')
    }

    updateMarkers()
  }, [streamWithLocation, wallStreams, onStreamPreview, mapReady])

  // Update marker colors when wallStreams changes (without redrawing all markers)
  useEffect(() => {
    if (!markersInitializedRef.current || markersRef.current.size === 0) return

    const wallStreamIds = new Set(wallStreams.map(s => s._id))
    
    markersRef.current.forEach((marker, streamId) => {
      const isViewing = wallStreamIds.has(streamId)
      const newColor = isViewing ? '#4CAF50' : '#1976D2'
      marker.setStyle({ fillColor: newColor })
    })
    
    console.log('Updated marker colors based on', wallStreams.length, 'wall streams')
  }, [wallStreams])

  const handleHomeClick = useCallback(() => {
    if (leafletMapRef.current) {
      // Return to initial view location and zoom
      leafletMapRef.current.setView([41.85571672210071, -91.86152308331968], 10, { animate: true })
    }
  }, [])

  const handleIowaClick = useCallback(() => {
    if (leafletMapRef.current) {
      // Center on Iowa and zoom to show entire state with all cameras
      leafletMapRef.current.setView([42.0115, -93.2105], 7, { animate: true })
    }
  }, [])

  // Force map resize when component mounts
  useEffect(() => {
    const timer = setTimeout(() => {
      if (leafletMapRef.current) {
        leafletMapRef.current.invalidateSize(true)
        console.log('Map invalidateSize on mount')
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div style={{ marginTop: '0' }}>
      <h3 style={{ marginBottom: '4px', marginTop: '0' }}>Stream Locations Map</h3>
      <div 
        ref={mapRef}
        style={{
          width: '100%',
          height: '400px',
          border: '1px solid #ccc',
          borderRadius: '4px',
          backgroundColor: '#f0f0f0',
          position: 'relative'
        }}
      >
        {!mapReady && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            backgroundColor: 'rgba(255, 255, 255, 0.9)',
            padding: '20px',
            borderRadius: '4px',
            textAlign: 'center',
            zIndex: 1000
          }}>
            Loading map...
          </div>
        )}
        <button
          onClick={handleHomeClick}
          style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            zIndex: 500,
            padding: '8px 12px',
            backgroundColor: 'white',
            border: '2px solid #ccc',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '16px',
            fontWeight: 'bold',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            transition: 'all 0.2s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '36px',
            height: '36px'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#f0f0f0'
            e.currentTarget.style.borderColor = '#999'
            e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'white'
            e.currentTarget.style.borderColor = '#ccc'
            e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)'
          }}
          title="Fit all markers in view"
        >
          🏠
        </button>
        <button
          onClick={handleIowaClick}
          style={{
            position: 'absolute',
            top: '54px',
            right: '12px',
            zIndex: 500,
            padding: '8px 12px',
            backgroundColor: 'white',
            border: '2px solid #ccc',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '16px',
            fontWeight: 'bold',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            transition: 'all 0.2s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '36px',
            height: '36px'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#f0f0f0'
            e.currentTarget.style.borderColor = '#999'
            e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'white'
            e.currentTarget.style.borderColor = '#ccc'
            e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)'
          }}
          title="Zoom to show all of Iowa"
        >
          🗺️
        </button>
      </div>
      <div style={{
        marginTop: '8px',
        fontSize: '11px',
        color: '#666'
      }}>
        {streamWithLocation.length} cameras with location data • Click markers to highlight in stream list
      </div>
    </div>
  )
}

export function ControlUI({
  connection,
}: {
  connection: StreamwallConnection
}) {
  const {
    isConnected,
    send,
    openConfigFolder,
    sharedState,
    stateDoc,
    config: primaryConfig,
    streams,
    customStreams,
    views: primaryViews,
    stateIdxMap: primaryStateIdxMap,
    delayState,
    authState,
    savedLayouts,
    role,
    grids,
    defaultGridId,
  } = connection
  const [activeGridId, setActiveGridId] = useState<string | null>(
    defaultGridId ?? (grids && grids[0]?.id) ?? null,
  )

  useEffect(() => {
    if (!grids || grids.length === 0) {
      return
    }
    setActiveGridId((prev) => {
      if (prev && grids.some((g) => g.id === prev)) {
        return prev
      }
      return grids[0]?.id ?? null
    })
  }, [grids])

  const activeGrid =
    grids?.find((g) => g.id === activeGridId) ?? grids?.[0] ?? undefined

  const activeGridColor = useMemo(() => {
    if (!grids || grids.length === 0) return undefined
    const idx = grids.findIndex((g) => g.id === (activeGridId ?? grids[0]?.id))
    if (idx < 0) return undefined
    return GRID_PALETTE[idx % GRID_PALETTE.length]
  }, [grids, activeGridId])

  const shadedBackground = useMemo(() => {
    if (!activeGridColor) return undefined
    return Color(activeGridColor).saturate(0.55).lighten(0.25).alpha(0.22).string()
  }, [activeGridColor])

  const config = activeGrid?.config ?? primaryConfig
  const views = activeGrid?.views ?? primaryViews
  const stateIdxMap = activeGrid?.stateIdxMap ?? primaryStateIdxMap
  const cellOffset = activeGrid?.cellOffset ?? 0

  const {
    cols,
    rows,
    width: windowWidth,
    height: windowHeight,
  } = config ?? { cols: null, rows: null, width: null, height: null }

  const [showDebug, setShowDebug] = useState(false)
  const handleChangeShowDebug = useCallback(() => {
    setShowDebug((prev) => !prev)
  }, [])

  const [spotlightedStreamId, setSpotlightedStreamId] = useState<string | undefined>()

  const handleRefreshAllViews = useCallback(() => {
    send({ type: 'refresh-all-views', gridId: activeGridId ?? undefined })
  }, [send, activeGridId])

  const handleRefreshErroredViews = useCallback(() => {
    send({ type: 'refresh-errored-views', gridId: activeGridId ?? undefined })
  }, [send, activeGridId])

  const loopRefreshErrored = sharedState?.uiState?.loopRefreshErrored ?? false
  const toggleLoopRefreshErrored = useCallback(() => {
    stateDoc.transact(() => {
      const uiStateMap = stateDoc.getMap<any>('uiState')
      uiStateMap.set('loopRefreshErrored', !loopRefreshErrored)
    })
  }, [stateDoc, loopRefreshErrored])

  useEffect(() => {
    if (!loopRefreshErrored) {
      return
    }

    const interval = setInterval(() => {
      send({ type: 'refresh-errored-views' })
    }, 5000) // Refresh every 5 seconds

    return () => clearInterval(interval)
  }, [loopRefreshErrored, send])

  const toGlobalIdx = useCallback(
    (localIdx: number) => cellOffset + localIdx,
    [cellOffset],
  )

  const getViewsMap = useCallback(
    () => stateDoc.getMap<Y.Map<string | undefined>>('views'),
    [stateDoc],
  )

  const getSharedStreamId = useCallback(
    (globalIdx: number) => {
      if (!sharedState?.views) {
        return undefined
      }
      const asString = (sharedState.views as any)[String(globalIdx)]?.streamId
      const asNumber = (sharedState.views as any)[globalIdx]?.streamId
      return asString ?? asNumber
    },
    [sharedState],
  )

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
        const viewsState = getViewsMap()
        const startStreamId = viewsState
          ?.get(String(toGlobalIdx(swapStartIdx)))
          ?.get('streamId')
        const toStreamId = viewsState
          .get(String(toGlobalIdx(toIdx)))
          ?.get('streamId')
        const startSpaces = stateIdxMap.get(swapStartIdx)?.spaces ?? []
        const toSpaces = stateIdxMap.get(toIdx)?.spaces ?? []
        for (const startSpaceIdx of startSpaces) {
          viewsState
            .get(String(toGlobalIdx(startSpaceIdx)))
            ?.set('streamId', toStreamId)
        }
        for (const toSpaceIdx of toSpaces) {
          viewsState
            .get(String(toGlobalIdx(toSpaceIdx)))
            ?.set('streamId', startStreamId)
        }
      })
      setSwapStartIdx(undefined)
    },
    [getViewsMap, stateIdxMap, swapStartIdx, toGlobalIdx, stateDoc],
  )

  const [hoveringIdx, setHoveringIdx] = useState<number>()
  const [expandedIdx, setExpandedIdx] = useState<number | undefined>()
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
        const viewsState = getViewsMap()
        const streamId = viewsState
          .get(String(toGlobalIdx(dragStart)))
          ?.get('streamId')
        for (let idx = 0; idx < cols * rows; idx++) {
          if (idxInBox(cols, dragStart, hoveringIdx, idx)) {
            viewsState
              .get(String(toGlobalIdx(idx)))
              ?.set('streamId', streamId)
          }
        }
      })
      setDragStart(undefined)
    }
    window.addEventListener('mouseup', endDrag)
    return () => window.removeEventListener('mouseup', endDrag)
  }, [stateDoc, dragStart, hoveringIdx, getViewsMap, toGlobalIdx, cols, rows])

  const [focusedInputIdx, setFocusedInputIdx] = useState<number | undefined>()
  const handleBlurInput = useCallback(() => setFocusedInputIdx(undefined), [])

  const handleSetView = useCallback(
    (idx: number, streamId: string) => {
      // Allow spot placeholders (spot-1, spot-2, etc.) or any custom streamId
      // Even if they're not in the streams array, we still add them to the grid
      stateDoc
        .getMap<Y.Map<string | undefined>>('views')
        .get(String(toGlobalIdx(idx)))
        ?.set('streamId', streamId)
    },
    [stateDoc, toGlobalIdx],
  )

  const handleSetListening = useCallback(
    (idx: number, listening: boolean) => {
      send({
        type: 'set-listening-view',
        viewIdx: listening ? idx : null,
        gridId: activeGridId ?? undefined,
      })
    },
    [send, activeGridId],
  )

  const handleSetBackgroundListening = useCallback(
    (viewIdx: number, listening: boolean) => {
      send({
        type: 'set-view-background-listening',
        viewIdx,
        listening,
        gridId: activeGridId ?? undefined,
      })
    },
    [send, activeGridId],
  )

  const handleSetBlurred = useCallback(
    (viewIdx: number, blurred: boolean) => {
      send({
        type: 'set-view-blurred',
        viewIdx,
        blurred,
        gridId: activeGridId ?? undefined,
      })
    },
    [send, activeGridId],
  )

  const handleReloadView = useCallback(
    (viewIdx: number) => {
      send({
        type: 'reload-view',
        viewIdx,
        gridId: activeGridId ?? undefined,
      })
    },
    [send, activeGridId],
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

  const handleSpotlight = useCallback(
    (streamId: string) => {
      console.debug('handleSpotlight called with streamId:', streamId)
      const stream = streams.find((d) => d._id === streamId)
      console.debug('Found stream:', stream)
      if (!stream) {
        console.warn('Stream not found:', streamId)
        return
      }
      console.debug('Sending spotlight command for URL:', stream.link)
      // Toggle spotlight state
      setSpotlightedStreamId((prev) => (prev === streamId ? undefined : streamId))
      send({
        type: 'spotlight',
        url: stream.link,
        gridId: activeGridId ?? undefined,
      })
    },
    [streams, send, activeGridId],
  )

  const handleSaveLayout = useCallback(
    (slot: number, name: string) => {
      send({
        type: 'save-layout',
        slot,
        name,
        gridId: activeGridId ?? undefined,
      })
    },
    [send, activeGridId],
  )

  const handleLoadLayout = useCallback(
    (slot: number) => {
      send({
        type: 'load-layout',
        slot,
        gridId: activeGridId ?? undefined,
      })
    },
    [send, activeGridId],
  )

  const handleClearLayout = useCallback(
    (slot: number) => {
      send({
        type: 'clear-layout',
        slot,
        gridId: activeGridId ?? undefined,
      })
    },
    [send, activeGridId],
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

      const availableIdx = range(cols * rows).find((i) => {
        const globalIdx = toGlobalIdx(i)
        const streamIdAtIdx = getSharedStreamId(globalIdx)
        return !streamIdAtIdx
      })
      if (availableIdx === undefined) {
        return
      }
      handleSetView(availableIdx, streamId)
    },
    [cols, rows, sharedState, focusedInputIdx, toGlobalIdx, getSharedStreamId, handleSetView],
  )

  const handleSwapWithSpot = useCallback(
    (streamIdToSwap: string, spotNum: number) => {
      if (cols == null || rows == null) {
        return
      }

      const viewsMap = getViewsMap()
      const spotId = `spot-${spotNum}`
      
      // Find ALL spot placeholder positions
      const spotIndices: number[] = []
      for (let i = 0; i < cols * rows; i++) {
        const viewData = viewsMap.get(String(toGlobalIdx(i)))
        if (viewData?.get('streamId') === spotId) {
          spotIndices.push(i)
        }
      }
      
      if (spotIndices.length === 0) {
        return // Spot not found in grid
      }
      
      // Replace all spots with the stream ID - that's it, no automatic replacement
      stateDoc.transact(() => {
        spotIndices.forEach((spotIdx) => {
          const spotView = viewsMap.get(String(toGlobalIdx(spotIdx)))
          if (spotView) {
            spotView.set('streamId', streamIdToSwap)
          }
        })
      })
    },
    [cols, rows, getViewsMap, toGlobalIdx],
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

  const [layoutCollapsed, setLayoutCollapsed] = useState(true)
  const [accessCollapsed, setAccessCollapsed] = useState(true)
  const [streamFilter, setStreamFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'viewing' | 'live' | 'offline'>('all')
  
  const handleStreamFilterChange = useCallback<
    JSX.InputEventHandler<HTMLInputElement>
  >((ev) => {
    setStreamFilter(ev.currentTarget?.value)
  }, [])

  // Static filter options for offline streams
  const staticHighwayFilters = ['I-80', 'I-380', 'I-280', 'US 30', 'IA 13', 'IA 100', 'US 218'].sort()
  const staticCityFilters = ['IC', 'QC', 'CR', 'WL', 'DQ', 'WWD'].sort()

  const [selectedHighwayFilters, setSelectedHighwayFilters] = useState<Set<string>>(new Set())
  const [selectedCityFilters, setSelectedCityFilters] = useState<Set<string>>(new Set())

  const handleHighwayFilterToggle = useCallback((filter: string) => {
    setSelectedHighwayFilters(prev => {
      const newSet = new Set(prev)
      if (newSet.has(filter)) {
        newSet.delete(filter)
      } else {
        newSet.add(filter)
      }
      return newSet
    })
  }, [])

  const handleCityFilterToggle = useCallback((filter: string) => {
    setSelectedCityFilters(prev => {
      const newSet = new Set(prev)
      if (newSet.has(filter)) {
        newSet.delete(filter)
      } else {
        newSet.add(filter)
      }
      return newSet
    })
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
    () => filterStreams(streams, wallStreamIds, streamFilter, selectedHighwayFilters, selectedCityFilters),
    [streams, wallStreamIds, streamFilter, selectedHighwayFilters, selectedCityFilters],
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

  const handleStreamPreview = useCallback(
    (streamId: string) => {
      // Find the stream element in the list and scroll to it
      const streamElement = document.querySelector(`[data-stream-id="${streamId}"]`) as HTMLElement | null
      if (streamElement) {
        // Scroll to the element
        streamElement.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center' 
        })
        
        // Add highlight effect with background color
        streamElement.classList.add('stream-highlight')
        streamElement.style.backgroundColor = '#fff9c4'
        streamElement.style.transition = 'background-color 0.3s ease'
        
        // Remove highlight after 7 seconds
        setTimeout(() => {
          streamElement.classList.remove('stream-highlight')
          streamElement.style.backgroundColor = ''
        }, 7000)
      }
    },
    []
  )

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
        {grids && grids.length > 1 && (
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
            {grids.map((grid, idx) => {
              const paletteColor = GRID_PALETTE[idx % GRID_PALETTE.length]
              const isActive = activeGridId === grid.id
              const buttonBg = isActive
                ? Color(paletteColor).lighten(0.15).desaturate(0.05).hex()
                : Color(paletteColor).lighten(0.45).desaturate(0.2).hex()
              const borderColor = Color(paletteColor).darken(isActive ? 0.15 : 0.05).hex()

              return (
                <button
                  key={grid.id}
                  onClick={() => setActiveGridId(grid.id)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '6px',
                    border: `${isActive ? 2 : 1}px solid ${borderColor}`,
                    background: buttonBg,
                    color: '#0f172a',
                    fontWeight: isActive ? 700 : 500,
                    cursor: 'pointer',
                    minWidth: '110px',
                    boxShadow: isActive
                      ? `0 0 0 3px ${Color(paletteColor).alpha(0.12).string()}`
                      : 'none',
                    transition: 'background 120ms ease, box-shadow 120ms ease, border-color 120ms ease',
                  }}
                >
                  {grid.id.replace('grid-', 'Grid ')} ({grid.config.cols}x{grid.config.rows})
                </button>
              )
            })}
          </div>
        )}
        <StyledDataContainer isConnected={isConnected} bgColor={shadedBackground}>
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
                    const streamId = getSharedStreamId(toGlobalIdx(idx))
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

                  const gridIdx = pos.spaces[0]
                  const globalIdx = toGlobalIdx(gridIdx)
                  const { streamId } = sharedState?.views[globalIdx] ?? {}
                  // Allow spots (spot-1, spot-2, etc.) to be displayed even without stream data
                  // Regular streams must have actual data
                  if (streamId == null) {
                    return null
                  }
                  const data = streams.find((d) => d._id === streamId)
                  const isSpot = streamId.startsWith('spot-')
                  if (!isSpot && !data) {
                    return null
                  }

                  return (
                    <StyledGridPreviewBox
                      key={`preview-${globalIdx}`}
                      color={idColor(streamId)}
                      isSpot={isSpot}
                      pos={pos}
                      windowWidth={windowWidth}
                      windowHeight={windowHeight}
                      isListening={isListening}
                      isError={matchesState('displaying.error', state.state)}
                      isSpotlighted={spotlightedStreamId === streamId}
                      style={{
                        left: `${(100 * pos.x) / windowWidth}%`,
                        top: `${(100 * pos.y) / windowHeight}%`,
                        width: `${(100 * pos.width) / windowWidth}%`,
                        height: `${(100 * pos.height) / windowHeight}%`,
                        zIndex: 1,
                      }}
                    >
                      <StyledGridInfo>
                        <StyledGridLabel>
                          {isSpot ? streamId.toUpperCase() : streamId}
                        </StyledGridLabel>
                        {!isSpot && <div>{data?.source}</div>}
                      </StyledGridInfo>
                    </StyledGridPreviewBox>
                  )
                })}
              </StyledGridPreview>
              {/* Check if any spots exist in the grid */}
              {(() => {
                let hasSpots = false
                if (sharedState) {
                  for (let i = 0; i < (cols ?? 0) * (rows ?? 0); i++) {
                    const streamIdAtIdx = getSharedStreamId(toGlobalIdx(i))
                    if (streamIdAtIdx?.startsWith?.('spot-')) {
                      hasSpots = true
                      break
                    }
                  }
                }
                return (
                  <>
                    {views.map(
                      ({ state, isListening, isBackgroundListening, isBlurred }) => {
                        const { pos } = state.context
                        if (!pos) {
                          return null
                        }
                        const streamId = getSharedStreamId(
                          toGlobalIdx(pos.spaces[0]),
                        )
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
                            onSwapWithSpot={handleSwapWithSpot}
                            hasSpots={hasSpots}
                            onSpotlight={handleSpotlight}
                            spotlightedStreamId={spotlightedStreamId}
                            onSetView={handleSetView}
                            spaces={pos.spaces}
                          />
                        )
                      },
                    )}
                  </>
                )
              })()}
            </StyledGridContainer>
          )}
          {/* Two-column section: Debug/Custom Streams on left, Map on right */}
          <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', paddingTop: '16px' }}>
            {/* Left column: Debug Box and Custom Streams */}
            <div style={{ flex: '0 0 auto' }}>
              {/* Debug Tools */}
              {(roleCan(role, 'dev-tools') || roleCan(role, 'browse')) && (
                <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    {roleCan(role, 'refresh-all-views') && (
                      <>
                        <button 
                          onClick={handleRefreshAllViews} 
                          style={{ 
                            padding: '6px 12px',
                            backgroundColor: '#4CAF50',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontWeight: 'bold',
                            fontSize: '12px',
                            transition: 'all 0.2s'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = '#45a049'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = '#4CAF50'
                          }}
                        >
                          Refresh All Views Sequentially
                        </button>
                        {roleCan(role, 'refresh-errored-views') && (() => {
                          const errorCount = views.filter(view => 
                            matchesState('displaying.error', view.state.state)
                          ).length
                          return (
                            <button 
                              onClick={(e) => {
                                if (e.shiftKey) {
                                  e.preventDefault()
                                  toggleLoopRefreshErrored()
                                } else {
                                  handleRefreshErroredViews()
                                }
                              }}
                              onContextMenu={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                toggleLoopRefreshErrored()
                              }}
                              style={{ 
                                padding: '6px 12px',
                                backgroundColor: errorCount > 0 ? (loopRefreshErrored ? '#ff9800' : '#f44336') : '#cccccc',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: errorCount > 0 ? 'pointer' : 'default',
                                fontWeight: 'bold',
                                fontSize: '12px',
                                transition: 'all 0.2s',
                                opacity: errorCount > 0 ? 1 : 0.7,
                                position: 'relative'
                              }}
                              onMouseEnter={(e) => {
                                if (errorCount > 0) {
                                  e.currentTarget.style.backgroundColor = loopRefreshErrored ? '#f57c00' : '#d32f2f'
                                }
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = errorCount > 0 ? (loopRefreshErrored ? '#ff9800' : '#f44336') : '#cccccc'
                              }}
                              disabled={errorCount === 0}
                              title={`Left-click to refresh once. Shift+click or right-click to toggle continuous loop. Status: ${loopRefreshErrored ? 'LOOPING ⏸' : 'normal ▶'}`}
                            >
                              Refresh Errored Views {errorCount > 0 && `(${errorCount})`} {loopRefreshErrored && '🔄'}
                            </button>
                          )
                        })()}
                      </>
                    )}
                  </div>
                  {role === 'local' && openConfigFolder && (
                    <button 
                      onClick={openConfigFolder}
                      style={{ 
                        padding: '4px',
                        backgroundColor: '#4CAF50',
                        color: 'white',
                        border: 'none',
                        borderRadius: '50%',
                        cursor: 'pointer',
                        fontSize: '16px',
                        transition: 'all 0.2s',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '28px',
                        height: '28px'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = '#45a049'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = '#4CAF50'
                      }}
                      title="Open config folder"
                    >
                      <FaCog />
                    </button>
                  )}
                  <button 
                    onClick={handleChangeShowDebug} 
                    style={{ 
                      padding: '6px 12px',
                      backgroundColor: showDebug ? '#2196F3' : '#757575',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                      fontSize: '12px',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = showDebug ? '#0b7dda' : '#616161'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = showDebug ? '#2196F3' : '#757575'
                    }}
                    title={showDebug ? 'Debug tools enabled' : 'Debug tools disabled'}
                  >
                    {showDebug ? '✓ Debug Tools ON' : 'Debug Tools OFF'}
                  </button>
                </div>
              )}
              
              {/* Quick Spot Buttons */}
              <div style={{ marginTop: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontWeight: 'bold', fontSize: '12px', marginRight: '8px' }}>Placeholders:</span>
                {[1, 2, 3, 4].map((spotNum) => (
                  <button
                    key={`spot-${spotNum}`}
                    onClick={() => handleClickId(`spot-${spotNum}`)}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: '#f0f0f0',
                      color: '#333',
                      border: '2px solid #999',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                      fontSize: '12px',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#e0e0e0'
                      e.currentTarget.style.borderColor = '#666'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = '#f0f0f0'
                      e.currentTarget.style.borderColor = '#999'
                    }}
                    title={`Click to add SPOT${spotNum} placeholder to next available grid slot`}
                  >
                    SPOT{spotNum}
                  </button>
                ))}
              </div>
              
              {/* Custom Streams section */}
              {roleCan(role, 'update-custom-stream') &&
                roleCan(role, 'delete-custom-stream') && (
                  <>
                    <h2>Custom Streams</h2>
                    <div>
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
            </div>
            
            {/* Right column: Stream Location Map */}
            <div style={{ flex: '1', minWidth: '0' }}>
              <StreamLocationMap 
                streams={streams}
                wallStreams={wallStreams}
                onStreamPreview={handleStreamPreview}
              />
            </div>
          </div>
          
          {/* Layout Management section */}
          {roleCan(role, 'save-layout') && roleCan(role, 'load-layout') && roleCan(role, 'clear-layout') && (
            <>
              <h2 
                style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: '8px' }}
                onClick={() => setLayoutCollapsed(!layoutCollapsed)}
              >
                {layoutCollapsed ? '▶' : '▼'} Layout Management
              </h2>
              <div>
                <FixedLayoutGrid
                  savedLayouts={savedLayouts}
                  onSave={handleSaveLayout}
                  onLoad={handleLoadLayout}
                  onClear={handleClearLayout}
                  rowsToShow={layoutCollapsed ? 2 : 11}
                />
              </div>
            </>
          )}
          
          {/* Move Access section here */}
          {(roleCan(role, 'create-invite') || roleCan(role, 'delete-token')) &&
            authState && (
              <>
                <h2 
                  style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: '8px' }}
                  onClick={() => setAccessCollapsed(!accessCollapsed)}
                >
                  {accessCollapsed ? '▶' : '▼'} Access
                </h2>
                {!accessCollapsed && (
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
                )}
              </>
            )}
          
          <Facts />
        </StyledDataContainer>
      </Stack>
      <Stack className="stream-list" flex="1" scroll={true} minHeight={200}>
        <StyledDataContainer isConnected={isConnected} bgColor={shadedBackground}>
          {isConnected ? (
            <div>
              <input
                onChange={handleStreamFilterChange}
                value={streamFilter}
                placeholder="filter streams..."
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  marginBottom: '8px',
                  fontSize: '14px',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  boxSizing: 'border-box'
                }}
              />
              <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
                <button
                  onClick={() => setCategoryFilter('all')}
                  style={{
                    padding: '6px 12px',
                    fontSize: '12px',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    backgroundColor: categoryFilter === 'all' ? '#007bff' : '#f8f9fa',
                    color: categoryFilter === 'all' ? 'white' : 'black',
                    cursor: 'pointer',
                    fontWeight: categoryFilter === 'all' ? 'bold' : 'normal'
                  }}
                >
                  All
                </button>
                <button
                  onClick={() => setCategoryFilter('viewing')}
                  style={{
                    padding: '6px 12px',
                    fontSize: '12px',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    backgroundColor: categoryFilter === 'viewing' ? '#007bff' : '#f8f9fa',
                    color: categoryFilter === 'viewing' ? 'white' : 'black',
                    cursor: 'pointer',
                    fontWeight: categoryFilter === 'viewing' ? 'bold' : 'normal'
                  }}
                >
                  Viewing ({wallStreams.length})
                </button>
                <button
                  onClick={() => setCategoryFilter('live')}
                  style={{
                    padding: '6px 12px',
                    fontSize: '12px',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    backgroundColor: categoryFilter === 'live' ? '#007bff' : '#f8f9fa',
                    color: categoryFilter === 'live' ? 'white' : 'black',
                    cursor: 'pointer',
                    fontWeight: categoryFilter === 'live' ? 'bold' : 'normal'
                  }}
                >
                  Live ({liveStreams.length})
                </button>
                <button
                  onClick={() => setCategoryFilter('offline')}
                  style={{
                    padding: '6px 12px',
                    fontSize: '12px',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    backgroundColor: categoryFilter === 'offline' ? '#007bff' : '#f8f9fa',
                    color: categoryFilter === 'offline' ? 'white' : 'black',
                    cursor: 'pointer',
                    fontWeight: categoryFilter === 'offline' ? 'bold' : 'normal'
                  }}
                >
                  Offline/Unknown ({otherStreams.length})
                </button>
              </div>
              {(categoryFilter === 'all' || categoryFilter === 'viewing') && (
                <>
                  <h3>Viewing</h3>
                  <StreamList rows={wallStreams} />
                </>
              )}
              {delayState && (categoryFilter === 'all' || categoryFilter === 'viewing') && (
                <StreamDelayBox
                  role={role}
                  delayState={delayState}
                  setStreamCensored={setStreamCensored}
                  setStreamRunning={setStreamRunning}
                />
              )}
              {(categoryFilter === 'all' || categoryFilter === 'live') && (
                <>
                  <h3>Live</h3>
                  <StreamList rows={liveStreams} />
                </>
              )}
              {(categoryFilter === 'all' || categoryFilter === 'offline') && (
                <>
                  <h3>Offline / Unknown</h3>
                  <StyledOfflineFilters>
                    <div style={{ fontSize: '12px', marginBottom: '4px', color: '#666' }}>
                      Cities/Regions:
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                      {[...staticCityFilters].sort().map(filter => (
                        <StyledFilterButton
                          key={filter}
                          active={selectedCityFilters.has(filter)}
                          onClick={() => handleCityFilterToggle(filter)}
                        >
                          {selectedCityFilters.has(filter) && '✓ '}{filter}
                        </StyledFilterButton>
                      ))}
                      {selectedCityFilters.size > 0 && (
                        <StyledFilterButton
                          clear
                          onClick={() => setSelectedCityFilters(new Set())}
                        >
                          Clear Cities
                        </StyledFilterButton>
                      )}
                    </div>
                    
                    <div style={{ fontSize: '12px', marginBottom: '4px', color: '#666' }}>
                      Highways:
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                      {[...staticHighwayFilters].sort().map(filter => (
                        <StyledFilterButton
                          key={filter}
                          active={selectedHighwayFilters.has(filter)}
                          onClick={() => handleHighwayFilterToggle(filter)}
                        >
                          {selectedHighwayFilters.has(filter) && '✓ '}{filter}
                        </StyledFilterButton>
                      ))}
                      {selectedHighwayFilters.size > 0 && (
                        <StyledFilterButton
                          clear
                          onClick={() => setSelectedHighwayFilters(new Set())}
                        >
                          Clear Highways
                        </StyledFilterButton>
                      )}
                    </div>
                    
                    {(selectedCityFilters.size > 0 || selectedHighwayFilters.size > 0) && (
                      <StyledFilterButton
                        clear
                        onClick={() => {
                          setSelectedCityFilters(new Set())
                          setSelectedHighwayFilters(new Set())
                        }}
                        style={{ marginTop: '4px' }}
                      >
                        Clear All Filters
                      </StyledFilterButton>
                    )}
                  </StyledOfflineFilters>
                  <StreamList rows={otherStreams} />
                </>
              )}
            </div>
          ) : (
            <div>loading...</div>
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
  row: { label, source, link, notes },
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
    <StyledStreamLine data-stream-id={id}>
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
            <strong>{source}</strong>{' '}
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
  onSwapWithSpot,
  hasSpots,
  onSpotlight,
  spotlightedStreamId,
  onSetView,
  spaces,
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
  onSwapWithSpot?: (streamId: string, spotNum: number) => void
  hasSpots?: boolean
  onSpotlight?: (streamId: string) => void
  spotlightedStreamId?: string
  onSetView: (idx: number, value: string) => void
  spaces: number[]
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
  const handleClearClick = useCallback(
    () => {
      // Clear all grid spaces that are part of this merged/connected box
      spaces.forEach((space) => onSetView(space, ''))
    },
    [spaces, onSetView],
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
              {roleCan(role, 'mutate-state-doc') && (
                <StyledSmallButton onClick={handleClearClick} tabIndex={1} title="Clear stream">
                  <FaTimes />
                </StyledSmallButton>
              )}
            </>
          )}
        </StyledGridButtons>
      )}
      <StyledGridButtons side="right">
        {onSpotlight && roleCan(role, 'set-listening-view') && (
          <StyledButton
            onClick={() => onSpotlight(streamId)}
            tabIndex={1}
            title="Spotlight stream (click to close)"
            isActive={spotlightedStreamId === streamId}
            activeColor="red"
          >
            <FaSearch />
          </StyledButton>
        )}
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
      
      {/* Spot swap buttons on bottom-left */}
      {hasSpots && onSwapWithSpot && !streamId.startsWith('spot-') && (
        <div style={{ 
          position: 'absolute',
          bottom: '8px',
          left: '8px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '3px',
          width: '56px'
        }}>
          {[1, 2, 3, 4].map((spotNum) => (
            <button
              key={`swap-spot-${spotNum}`}
              onClick={() => onSwapWithSpot(streamId, spotNum)}
              style={{
                padding: '2px 4px',
                backgroundColor: '#ccc',
                color: '#333',
                border: '2px solid gray',
                borderRadius: '5px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '10px',
                transition: 'all 0.15s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#bbb'
                e.currentTarget.style.borderColor = '#666'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#ccc'
                e.currentTarget.style.borderColor = 'gray'
              }}
              title={`Swap with SPOT${spotNum}`}
            >
              S{spotNum}
            </button>
          ))}
        </div>
      )}
    </StyledGridControlsContainer>
  )
}

function FixedLayoutGrid({
  savedLayouts,
  onSave,
  onLoad,
  onClear,
  rowsToShow = 11,
}: {
  savedLayouts?: Record<string, { 
    name: string; 
    timestamp: number;
    gridSize?: { cols: number; rows: number };
    gridId?: string;
  }>
  onSave: (slot: number, name: string) => void
  onLoad: (slot: number) => void
  onClear: (slot: number) => void
  rowsToShow?: number
}) {
  // Fixed 4x11 grid (44 total slots), show specified number of rows
  const GRID_COLS = 4
  const GRID_ROWS = 11
  const totalSlots = GRID_COLS * GRID_ROWS
  const slotsToDisplay = GRID_COLS * rowsToShow
  
  const slotsToShow = Array.from({ length: slotsToDisplay }, (_, i) => i + 1)
  
  return (
    <StyledLayoutPresetGrid>
      {slotsToShow.map(slotNum => (
        <LayoutPresetCard
          key={slotNum}
          slot={slotNum}
          savedLayout={savedLayouts?.[`slot${slotNum}`]}
          onSave={onSave}
          onLoad={onLoad}
          onClear={onClear}
        />
      ))}
    </StyledLayoutPresetGrid>
  )
}

function LayoutPresetCard({
  slot,
  savedLayout,
  onSave,
  onLoad,
  onClear,
}: {
  slot: number
  savedLayout?: { 
    name: string; 
    timestamp: number;
    gridSize?: { cols: number; rows: number };
    gridId?: string;
  }
  onSave: (slot: number, name: string) => void
  onLoad: (slot: number) => void
  onClear: (slot: number) => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [name, setName] = useState('')

  const handleTitleClick = useCallback(() => {
    if (savedLayout) {
      onLoad(slot)
    }
  }, [savedLayout, onLoad, slot])

  const handleSaveClick = useCallback(() => {
    setIsEditing(true)
    setName(savedLayout?.name || `Layout ${slot}`)
  }, [savedLayout, slot])

  const handleSaveConfirm = useCallback(() => {
    if (name.trim()) {
      onSave(slot, name.trim())
      setIsEditing(false)
      setName('')
    }
  }, [slot, name, onSave])

  const handleSaveCancel = useCallback(() => {
    setIsEditing(false)
    setName('')
  }, [])

  const handleDeleteClick = useCallback(() => {
    if (confirm(`Delete ${savedLayout?.name || `Layout ${slot}`}?`)) {
      onClear(slot)
    }
  }, [savedLayout, slot, onClear])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveConfirm()
    } else if (e.key === 'Escape') {
      handleSaveCancel()
    }
  }, [handleSaveConfirm, handleSaveCancel])

  if (isEditing) {
    return (
      <StyledLayoutCard>
        <div style={{ padding: '8px', flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName((e.target as HTMLInputElement).value)}
            onKeyDown={handleKeyDown}
            placeholder="Layout name"
            autoFocus
            style={{ 
              border: '1px solid #ddd', 
              borderRadius: '3px', 
              padding: '4px',
              fontSize: '12px'
            }}
          />
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              onClick={handleSaveConfirm}
              disabled={!name.trim()}
              style={{ 
                flex: 1, 
                padding: '4px', 
                fontSize: '10px',
                background: '#4CAF50',
                color: 'white',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer'
              }}
            >
              Save
            </button>
            <button
              onClick={handleSaveCancel}
              style={{ 
                flex: 1, 
                padding: '4px', 
                fontSize: '10px',
                background: '#f44336',
                color: 'white',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </StyledLayoutCard>
    )
  }

  return (
    <StyledLayoutCard>
      <StyledLayoutCardTitle
        hasLayout={!!savedLayout}
        onClick={handleTitleClick}
        disabled={!savedLayout}
      >
        {savedLayout ? savedLayout.name : `Slot ${slot}`}
      </StyledLayoutCardTitle>
      
      <StyledLayoutCardControls>
        <StyledLayoutCardButtons>
          <StyledLayoutCardButton
            className="save"
            onClick={handleSaveClick}
            title="Save current layout"
          >
            💾
          </StyledLayoutCardButton>
          {savedLayout && (
            <StyledLayoutCardButton
              className="delete"
              onClick={handleDeleteClick}
              title={`Delete ${savedLayout.name}`}
            >
              🗑️
            </StyledLayoutCardButton>
          )}
        </StyledLayoutCardButtons>
        
        <StyledLayoutCardInfo>
          {savedLayout && (
            <>
              <div>{DateTime.fromMillis(savedLayout.timestamp).toFormat('M/d/yy')}</div>
              <div>{DateTime.fromMillis(savedLayout.timestamp).toFormat('HH:mm')}</div>
              {(savedLayout.gridId || savedLayout.gridSize) && (
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {savedLayout.gridId && (
                    <span style={{
                      padding: '2px 6px',
                      borderRadius: '10px',
                      background: '#eef2ff',
                      border: '1px solid #d0d7ff',
                      fontSize: '11px',
                    }}>
                      {savedLayout.gridId.replace('grid-', 'Grid ')}
                    </span>
                  )}
                  {savedLayout.gridSize && (
                    <span style={{
                      padding: '2px 6px',
                      borderRadius: '10px',
                      background: '#f5f5f5',
                      border: '1px solid #ddd',
                      fontSize: '11px',
                    }}>
                      {savedLayout.gridSize.cols}×{savedLayout.gridSize.rows}
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </StyledLayoutCardInfo>
      </StyledLayoutCardControls>
    </StyledLayoutCard>
  )
}

function LayoutSlot({
  slot,
  savedLayout,
  onSave,
  onLoad,
  onClear,
}: {
  slot: number
  savedLayout?: { name: string; timestamp: number }
  onSave: (slot: number, name: string) => void
  onLoad: (slot: number) => void
  onClear: (slot: number) => void
}) {
  const [name, setName] = useState('')
  const [isEditing, setIsEditing] = useState(false)

  const handleSave = useCallback(() => {
    if (name.trim()) {
      onSave(slot, name.trim())
      setName('')
      setIsEditing(false)
    }
  }, [slot, name, onSave])

  const handleLoad = useCallback(() => {
    onLoad(slot)
  }, [slot, onLoad])

  const handleClear = useCallback(() => {
    onClear(slot)
  }, [slot, onClear])

  const handleEditClick = useCallback(() => {
    setIsEditing(true)
    setName(savedLayout?.name || '')
  }, [savedLayout])

  const handleCancel = useCallback(() => {
    setIsEditing(false)
    setName('')
  }, [])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave()
    } else if (e.key === 'Escape') {
      handleCancel()
    }
  }, [handleSave, handleCancel])

  return (
    <StyledLayoutSlot>
      <div>
        <strong>Layout {slot}</strong>
        {savedLayout && (
          <span> - {savedLayout.name} ({DateTime.fromMillis(savedLayout.timestamp).toFormat('M/d/yy HH:mm')})</span>
        )}
      </div>
      <div>
        {isEditing ? (
          <>
            <input
              type="text"
              value={name}
              onChange={(e) => setName((e.target as HTMLInputElement).value)}
              onKeyDown={handleKeyDown}
              placeholder="Layout name"
              autoFocus
            />
            <StyledButton onClick={handleSave} disabled={!name.trim()}>
              Save
            </StyledButton>
            <StyledButton onClick={handleCancel}>
              Cancel
            </StyledButton>
          </>
        ) : (
          <>
            <StyledButton onClick={handleEditClick}>
              {savedLayout ? 'Rename & Save' : 'Save Current'}
            </StyledButton>
            {savedLayout && (
              <>
                <StyledButton onClick={handleLoad}>
                  Load
                </StyledButton>
                <StyledButton onClick={handleClear}>
                  Clear
                </StyledButton>
              </>
            )}
          </>
        )}
      </div>
    </StyledLayoutSlot>
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

const StyledConfigButton = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: #2196F3;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: background 0.2s;

  &:hover {
    background: #1976D2;
  }

  &:active {
    background: #1565C0;
  }

  svg {
    font-size: 16px;
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

const StyledDataContainer = styled.div<{ isConnected: boolean; bgColor?: string }>`
  opacity: ${({ isConnected }) => (isConnected ? 1 : 0.5)};
  background: ${({ bgColor }) => bgColor ?? 'transparent'};
  transition: background 160ms ease;
  border-radius: 10px;
  padding: 8px;
`

const StyledLayoutSlot = styled.div`
  margin: 8px 0;
  padding: 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  
  > div:first-child {
    flex: 1;
  }
  
  > div:last-child {
    display: flex;
    gap: 4px;
  }
  
  input {
    margin-right: 4px;
    padding: 2px 4px;
  }
`

const StyledLayoutPresetGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-template-rows: repeat(auto-fit, minmax(60px, 1fr));
  gap: 8px;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
`

const StyledLayoutCard = styled.div`
  border: 1px solid #ccc;
  border-radius: 6px;
  background: #f9f9f9;
  display: flex;
  flex-direction: column;
  min-height: 80px;
  position: relative;
  transition: box-shadow 0.2s;
  
  &:hover {
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  }
`

const StyledLayoutCardTitle = styled.button`
  flex: 1;
  background: ${props => props.hasLayout ? '#e8f4f8' : '#f5f5f5'};
  border: none;
  border-bottom: 1px solid #ddd;
  border-radius: 6px 6px 0 0;
  padding: 8px;
  text-align: center;
  font-weight: bold;
  font-size: 12px;
  cursor: ${props => props.hasLayout ? 'pointer' : 'default'};
  color: ${props => props.hasLayout ? '#2196F3' : '#666'};
  
  &:hover {
    background: ${props => props.hasLayout ? '#d1e7dd' : '#f5f5f5'};
  }
  
  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
`

const StyledLayoutCardControls = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 6px;
  background: #fff;
  border-radius: 0 0 6px 6px;
`

const StyledLayoutCardButtons = styled.div`
  display: flex;
  gap: 2px;
`

const StyledLayoutCardButton = styled.button`
  background: none;
  border: 1px solid #ddd;
  border-radius: 3px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.2s, border-color 0.2s;
  
  &:hover {
    background: #f0f0f0;
  }
  
  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  
  &.save {
    background: #c8e6c8;
    border-color: #4CAF50;
    color: #2e7d32;
    &:hover { 
      background: #a5d6a7;
      border-color: #45a049;
    }
  }
  
  &.delete {
    background: #ffcdd2;
    border-color: #f44336;
    color: #c62828;
    &:hover { 
      background: #ef9a9a;
      border-color: #d32f2f;
    }
  }
`

const StyledLayoutCardInfo = styled.div`
  font-size: 9px;
  color: #666;
  text-align: right;
  line-height: 1.2;
`

const StyledButton = styled.button`
  display: flex;
  align-items: center;
  border: 2px solid gray;
  border-color: gray;
  background: #ccc;
  border-radius: 5px;
  cursor: pointer;

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

  &:hover {
    background: #aaa;
  }

  &:active {
    background: #999;
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
  z-index: 1;
`

const StyledGridPreviewBox = styled.div.attrs(() => ({
  borderWidth: 2,
}))`
  display: flex;
  align-items: center;
  justify-content: center;
  position: absolute;
  background: ${({ color, isSpot }) =>
    isSpot ? '#e0e0e0' : Color(color).lightness(50).hsl().string() || '#333'};
  border: 0 solid
    ${({ isError, isSpotlighted }) =>
      isSpotlighted
        ? '#00ff00'
        : isError
        ? Color('red').hsl().string()
        : Color('black').hsl().string()};
  border-left-width: ${({ pos, borderWidth }) =>
    pos.x === 0 ? 0 : borderWidth}px;
  border-right-width: ${({ pos, borderWidth, windowWidth }) =>
    pos.x + pos.width === windowWidth ? 0 : borderWidth}px;
  border-top-width: ${({ pos, borderWidth }) =>
    pos.y === 0 ? 0 : borderWidth}px;
  border-bottom-width: ${({ pos, borderWidth, windowHeight }) =>
    pos.y + pos.height === windowHeight ? 0 : borderWidth}px;
  box-shadow: ${({ isListening, isSpotlighted }) =>
    isSpotlighted ? `0 0 0 4px #00ff00 inset` : isListening ? `0 0 0 4px red inset` : 'none'};
  box-sizing: border-box;
  overflow: visible;
  user-select: none;
`

const StyledGridInfo = styled.div`
  text-align: center;
`

const StyledGridLabel = styled.div`
  font-size: 30px;
  color: #333;
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
  z-index: 10;
  pointer-events: none;
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
    pointer-events: auto;
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
      <BLM></BLM>
      <TRM>
        
      </TRM>
      <TIN></TIN>
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
const StyledOfflineFilters = styled.div`
  margin-bottom: 8px;
`

const StyledFilterButton = styled.button<{ active?: boolean; clear?: boolean }>`
  padding: 2px 8px;
  border: 1px solid ${props => props.active && !props.clear ? '#0066cc' : props.clear ? '#666' : '#ddd'};
  background: ${props => props.active && !props.clear ? '#0066cc' : props.clear ? '#f5f5f5' : '#fff'};
  color: ${props => props.active && !props.clear ? '#fff' : props.clear ? '#666' : '#333'};
  border-radius: 3px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 4px;

  &:hover {
    background: ${props => props.active && !props.clear ? '#0052a3' : props.clear ? '#e0e0e0' : '#f0f0f0'};
    border-color: ${props => props.active && !props.clear ? '#003d7a' : props.clear ? '#555' : '#bbb'};
  }

  &:active {
    transform: translateY(1px);
  }
`
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
