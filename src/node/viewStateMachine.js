import isEqual from 'lodash/isEqual'
import { Machine, assign } from 'xstate'

import { ensureValidURL } from '../util'

const viewStateMachine = Machine(
  {
    id: 'view',
    initial: 'empty',
    context: {
      id: null,
      view: null,
      pos: null,
      content: null,
      options: null,
      info: {},
    },
    on: {
      DISPLAY: 'displaying',
    },
    states: {
      empty: {},
      displaying: {
        id: 'displaying',
        initial: 'loading',
        entry: assign({
          pos: (context, event) => event.pos,
          content: (context, event) => event.content,
        }),
        on: {
          DISPLAY: {
            actions: assign({
              pos: (context, event) => event.pos,
            }),
            cond: 'contentUnchanged',
          },
          OPTIONS: {
            actions: [
              assign({
                options: (context, event) => event.options,
              }),
              'sendViewOptions',
            ],
            cond: 'optionsChanged',
          },
          RELOAD: '.loading',
          DEVTOOLS: {
            actions: 'openDevTools',
          },
          VIEW_ERROR: '.error',
          VIEW_INFO: {
            actions: assign({
              info: (context, event) => event.info,
            }),
          },
        },
        states: {
          loading: {
            initial: 'navigate',
            entry: 'offscreenView',
            states: {
              navigate: {
                invoke: {
                  src: 'loadPage',
                  onDone: {
                    target: 'waitForInit',
                  },
                  onError: {
                    target: '#view.displaying.error',
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
              DISPLAY: {
                actions: [
                  assign({
                    pos: (context, event) => event.pos,
                  }),
                  'positionView',
                ],
                cond: 'contentUnchanged',
              },
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
          error: {
            entry: 'logError',
          },
        },
      },
    },
  },
  {
    actions: {
      logError: (context, event) => {
        console.warn(event)
      },
      muteAudio: (context, event) => {
        context.view.webContents.audioMuted = true
      },
      unmuteAudio: (context, event) => {
        context.view.webContents.audioMuted = false
      },
      openDevTools: (context, event) => {
        const { view } = context
        const { inWebContents } = event
        view.webContents.setDevToolsWebContents(inWebContents)
        view.webContents.openDevTools({ mode: 'detach' })
      },
      sendViewOptions: (context, event) => {
        const { view } = context
        view.webContents.send('options', event.options)
      },
    },
    guards: {
      contentUnchanged: (context, event) => {
        return isEqual(context.content, event.content)
      },
      optionsChanged: (context, event) => {
        return !isEqual(context.options, event.options)
      },
    },
    services: {
      loadPage: async (context, event) => {
        const { content, view } = context
        ensureValidURL(content.url)
        const wc = view.webContents
        wc.audioMuted = true
        wc.loadURL(content.url)
      },
    },
  },
)

export default viewStateMachine
