import assert from 'assert'
import {
  BrowserWindow,
  Rectangle,
  WebContents,
  WebContentsView,
} from 'electron'
import { isEqual } from 'lodash-es'
import { ViewContent, ViewPos } from 'streamwall-shared'
import {
  ContentDisplayOptions,
  ContentViewInfo,
} from 'streamwall-shared/src/types'
import { Actor, assign, fromPromise, setup } from 'xstate'
import { ensureValidURL } from '../util'
import { loadHTML } from './loadHTML'

const viewStateMachine = setup({
  types: {
    input: {} as {
      id: number
      view: WebContentsView
      win: BrowserWindow
    },

    context: {} as {
      id: number
      win: BrowserWindow
      view: WebContentsView
      pos: ViewPos | null
      content: ViewContent | null
      options: ContentDisplayOptions | null
      info: ContentViewInfo | null
    },

    events: {} as
      | { type: 'OPTIONS'; options: ContentDisplayOptions }
      | {
          type: 'DISPLAY'
          pos: ViewPos
          content: ViewContent
        }
      | { type: 'VIEW_INIT' }
      | { type: 'VIEW_LOADED' }
      | { type: 'VIEW_INFO'; info: ContentViewInfo }
      | { type: 'VIEW_ERROR'; error: unknown }
      | { type: 'MUTE' }
      | { type: 'UNMUTE' }
      | { type: 'BACKGROUND' }
      | { type: 'UNBACKGROUND' }
      | { type: 'BLUR' }
      | { type: 'UNBLUR' }
      | { type: 'RELOAD' }
      | { type: 'DEVTOOLS'; inWebContents: WebContents },
  },

  actions: {
    logError: (_, params: { error: unknown }) => {
      console.warn(params.error)
    },

    muteAudio: ({ context }) => {
      context.view.webContents.audioMuted = true
    },

    unmuteAudio: ({ context }) => {
      context.view.webContents.audioMuted = false
    },

    openDevTools: ({ context }, params: { inWebContents: WebContents }) => {
      const { view } = context
      const { inWebContents } = params
      view.webContents.setDevToolsWebContents(inWebContents)
      view.webContents.openDevTools({ mode: 'detach' })
    },

    sendViewOptions: (
      { context },
      params: { options: ContentDisplayOptions },
    ) => {
      const { view } = context
      view.webContents.send('options', params.options)
    },

    offscreenView: ({ context }) => {
      const { view, win } = context
      const wc = view.webContents
      if (!win || win.isDestroyed() || !wc || wc.isDestroyed()) {
        return
      }
      try {
        win.contentView.addChildView(view, 0) // Insert below background (so hidden by background)
        const { width, height } = win.getBounds()
        view.setBounds({ x: 0, y: 0, width, height })
      } catch (err) {
        console.warn('[view] offscreenView failed; view/window destroyed?', err)
      }
    },

    positionView: ({ context }) => {
      const { pos, view, win } = context

      if (!pos) {
        return
      }

      const wc = view.webContents
      if (!win || win.isDestroyed() || !wc || wc.isDestroyed()) {
        return
      }

      try {
        win.contentView.addChildView(view, win.contentView.children.length - 2) // Insert below overlay but above background
        view.setBounds(pos)
      } catch (err) {
        console.warn('[view] positionView failed; view/window destroyed?', err)
      }
    },
  },

  guards: {
    contentUnchanged: ({ context }, params: { content: ViewContent }) => {
      return isEqual(context.content, params.content)
    },

    contentPosUnchanged: (
      { context },
      params: { content: ViewContent; pos: Rectangle },
    ) => {
      return (
        isEqual(context.content, params.content) &&
        isEqual(context.pos, params.pos)
      )
    },

    optionsChanged: (
      { context },
      params: { options: ContentDisplayOptions },
    ) => {
      return !isEqual(context.options, params.options)
    },
  },

  actors: {
    loadPage: fromPromise(
      async ({
        input: { content, view },
      }: {
        input: { content: ViewContent | null; view: WebContentsView }
      }) => {
        assert(content !== null)

        ensureValidURL(content.url)
        const wc = view.webContents
        wc.audioMuted = true

        if (/\.m3u8?$/.test(content.url)) {
          loadHTML(wc, 'playHLS', { query: { src: content.url } })
        } else {
          wc.loadURL(content.url)
        }
      },
    ),
  },
}).createMachine({
  id: 'view',
  initial: 'empty',
  context: ({ input: { id, view, win } }) => ({
    id,
    view,
    win,
    pos: null,
    content: null,
    options: null,
    info: null,
  }),
  on: {
    DISPLAY: {
      target: '.displaying',
      actions: assign({
        pos: ({ event }) => event.pos,
        content: ({ event }) => event.content,
      }),
    },
  },
  states: {
    empty: {},
    displaying: {
      id: 'displaying',
      initial: 'loading',
      entry: 'offscreenView',
      on: {
        DISPLAY: {
          actions: assign({
            pos: ({ event }) => event.pos,
          }),
          guard: {
            type: 'contentUnchanged',
            params: ({ event: { content } }) => ({ content }),
          },
        },
        OPTIONS: {
          actions: [
            assign({
              options: ({ event }) => event.options,
            }),
            {
              type: 'sendViewOptions',
              params: ({ event: { options } }) => ({ options }),
            },
          ],
          guard: {
            type: 'optionsChanged',
            params: ({ event: { options } }) => ({ options }),
          },
        },
        RELOAD: '.loading',
        DEVTOOLS: {
          actions: {
            type: 'openDevTools',
            params: ({ event: { inWebContents } }) => ({ inWebContents }),
          },
        },
        VIEW_ERROR: {
          target: '.error',
          actions: {
            type: 'logError',
            params: ({ event: { error } }) => ({ error }),
          },
        },
        VIEW_INFO: {
          actions: assign({
            info: ({ event }) => event.info,
          }),
        },
      },
      states: {
        loading: {
          initial: 'navigate',
          states: {
            navigate: {
              invoke: {
                src: 'loadPage',
                input: ({ context: { content, view } }) => ({ content, view }),
                onDone: {
                  target: 'waitForInit',
                },
                onError: {
                  target: '#view.displaying.error',
                  actions: {
                    type: 'logError',
                    params: ({ event: { error } }) => ({ error }),
                  },
                },
              },
            },
            waitForInit: {
              on: {
                VIEW_INIT: 'waitForVideo',
              },
            },
            waitForVideo: {
              on: {
                VIEW_LOADED: '#view.displaying.running',
              },
            },
          },
        },
        running: {
          type: 'parallel',
          entry: 'positionView',
          on: {
            DISPLAY: [
              // Noop if nothing changed.
              {
                guard: {
                  type: 'contentPosUnchanged',
                  params: ({ event: { content, pos } }) => ({ content, pos }),
                },
              },
              {
                actions: [
                  assign({
                    pos: ({ event }) => event.pos,
                  }),
                  'positionView',
                ],
                guard: {
                  type: 'contentUnchanged',
                  params: ({ event: { content } }) => ({ content }),
                },
              },
            ],
          },
          states: {
            audio: {
              initial: 'muted',
              on: {
                MUTE: '.muted',
                UNMUTE: '.listening',
                BACKGROUND: '.background',
                UNBACKGROUND: '.muted',
              },
              states: {
                muted: {
                  entry: 'muteAudio',
                },
                listening: {
                  entry: 'unmuteAudio',
                },
                background: {
                  on: {
                    // Ignore normal audio swapping.
                    MUTE: {},
                  },
                  entry: 'unmuteAudio',
                },
              },
            },
            video: {
              initial: 'normal',
              on: {
                BLUR: '.blurred',
                UNBLUR: '.normal',
              },
              states: {
                normal: {},
                blurred: {},
              },
            },
          },
        },
        error: {},
      },
    },
  },
})

export type ViewActor = Actor<typeof viewStateMachine>

export default viewStateMachine
