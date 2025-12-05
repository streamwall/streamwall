import type { ViewContent, ViewPos } from './geometry.ts'
import type { StreamwallRole } from './roles.ts'

export interface StreamWindowConfig {
  cols: number
  rows: number
  width: number
  height: number
  x?: number
  y?: number
  frameless: boolean
  activeColor: string
  backgroundColor: string
}

export interface ContentDisplayOptions {
  rotation?: number
}

/** Metadata scraped from a loaded view */
export interface ContentViewInfo {
  title: string
}

export type ContentKind = 'video' | 'audio' | 'web' | 'background' | 'overlay'

export interface StreamDataContent extends ContentDisplayOptions {
  kind: ContentKind
  link: string
  label?: string
  labelPosition?: 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left'
  source?: string
  notes?: string
  status?: string
  city?: string
  state?: string
  latitude?: number
  longitude?: number
  _id?: string
  _dataSource?: string
  isLive?: boolean
}

export interface StreamData extends StreamDataContent {
  _id: string
  _dataSource: string
}

export type LocalStreamData = Omit<StreamData, '_id' | '_dataSource'>

export type StreamList = StreamData[] & { byURL?: Map<string, StreamData> }

// matches viewStateMachine.ts
export type ViewStateValue =
  | 'empty'
  | {
      displaying:
        | 'error'
        | {
            loading: 'navigate' | 'waitForInit' | 'waitForVideo'
          }
        | {
            running: {
              video: 'normal' | 'blurred'
              audio: 'background' | 'muted' | 'listening'
            }
          }
    }

export interface ViewState {
  state: ViewStateValue
  context: {
    id: number
    content: ViewContent | null
    info: ContentViewInfo | null
    pos: ViewPos | null
  }
}

export interface GridState {
  id: string
  config: StreamWindowConfig
  views: ViewState[]
  cellOffset: number
}

export interface StreamDelayStatus {
  isConnected: boolean
  delaySeconds: number
  restartSeconds: number
  isCensored: boolean
  isStreamRunning: boolean
  startTime: number
  state: string
}

export type AuthTokenKind = 'invite' | 'session' | 'streamwall'

export interface AuthTokenInfo {
  tokenId: string
  kind: AuthTokenKind
  role: StreamwallRole
  name: string
}

export interface StreamwallState {
  identity: {
    role: StreamwallRole
  }
  auth?: {
    invites: AuthTokenInfo[]
    sessions: AuthTokenInfo[]
  }
  config: StreamWindowConfig
  streams: StreamList
  customStreams: StreamList
  views: ViewState[]
  streamdelay: StreamDelayStatus | null
  grids?: GridState[]
  savedLayouts?: Record<
    string,
    {
      name: string
      timestamp: number
      gridSize?: { cols: number; rows: number }
      gridId?: string
    }
  >
}

type MessageMeta = {
  id: number
  clientId: string
}

export type ControlCommand =
  | { type: 'set-listening-view'; viewIdx: number | null; gridId?: string }
  | {
      type: 'set-view-background-listening'
      viewIdx: number
      listening: boolean
      gridId?: string
    }
  | { type: 'set-view-blurred'; viewIdx: number; blurred: boolean; gridId?: string }
  | { type: 'rotate-stream'; url: string; rotation: number }
  | { type: 'update-custom-stream'; url: string; data: LocalStreamData }
  | { type: 'delete-custom-stream'; url: string }
  | { type: 'reload-view'; viewIdx: number; gridId?: string }
  | { type: 'browse'; url: string }
  | { type: 'dev-tools'; viewIdx: number; gridId?: string }
  | { type: 'set-stream-censored'; isCensored: boolean }
  | { type: 'set-stream-running'; isStreamRunning: boolean }
  | { type: 'create-invite'; role: string; name: string }
  | { type: 'delete-token'; tokenId: string }
  | { type: 'refresh-all-views'; gridId?: string }
  | { type: 'refresh-errored-views'; gridId?: string }
  | { type: 'save-layout'; slot: number; name: string; gridId?: string }
  | { type: 'load-layout'; slot: number; gridId?: string }
  | { type: 'clear-layout'; slot: number; gridId?: string }
  | { type: 'spotlight'; url: string; gridId?: string }

export type ControlUpdate = {
  type: 'state'
  state: StreamwallState
}

export type ControlCommandMessage = MessageMeta & ControlCommand

export type ControlUpdateMessage = MessageMeta & ControlUpdate
