import { Machine, assign } from 'xstate'

const viewStateMachine = Machine(
  {
    id: 'view',
    initial: 'loading',
    context: {
      id: null,
      pos: null,
      content: null,
      info: {},
      sendToWall: null,
      sendToFrame: null,
    },
    on: {
      DISPLAY: {
        actions: assign({
          pos: (context, event) => event.pos,
          content: (context, event) => event.content,
        }),
      },
      RELOAD: {
        actions: 'reload',
      },
      VIEW_INIT: {
        target: '.loading',
        actions: assign({
          sendToFrame: (context, event) => event.sendToFrame,
        }),
      },
      VIEW_ERROR: '.error',
    },
    states: {
      loading: {
        on: {
          VIEW_LOADED: {
            actions: assign({
              info: (context, event) => event.info,
            }),
            target: '#view.running',
          },
        },
      },
      running: {
        type: 'parallel',
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
  {
    actions: {
      logError: (context, event) => {
        console.warn(event.err)
      },
      reload: (context) => {
        // TODO: keep muted over reload
        context.sendToWall('reload-view', { viewId: context.id })
      },
      muteAudio: (context, event) => {
        context.sendToFrame('mute')
      },
      unmuteAudio: (context, event) => {
        context.sendToFrame('unmute')
      },
    },
  },
)

export default viewStateMachine
