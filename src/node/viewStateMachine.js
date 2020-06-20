import { Machine, assign } from 'xstate'

const viewStateMachine = Machine(
  {
    id: 'view',
    initial: 'empty',
    context: {
      view: null,
      pos: null,
      url: null,
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
          url: (context, event) => event.url,
        }),
        on: {
          DISPLAY: {
            actions: assign({
              pos: (context, event) => event.pos,
            }),
            cond: 'urlUnchanged',
          },
          RELOAD: '.loading',
        },
        states: {
          loading: {
            initial: 'page',
            entry: 'offscreenView',
            states: {
              page: {
                invoke: {
                  src: 'loadURL',
                  onDone: {
                    target: 'video',
                  },
                  onError: {
                    target: '#view.displaying.error',
                  },
                },
              },
              video: {
                invoke: {
                  src: 'startVideo',
                  onDone: {
                    target: '#view.displaying.running',
                    actions: assign({
                      info: (context, event) => event.data,
                    }),
                  },
                  onError: {
                    target: '#view.displaying.error',
                  },
                },
              },
            },
          },
          running: {
            initial: 'muted',
            entry: 'positionView',
            on: {
              DISPLAY: {
                actions: [
                  assign({
                    pos: (context, event) => event.pos,
                  }),
                  'positionView',
                ],
                cond: 'urlUnchanged',
              },
              MUTE: '.muted',
              UNMUTE: '.listening',
            },
            states: {
              muted: {
                entry: 'muteAudio',
              },
              listening: {
                entry: 'unmuteAudio',
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
    },
    guards: {
      urlUnchanged: (context, event) => {
        return context.url === event.url
      },
    },
    services: {
      loadURL: async (context, event) => {
        const { url, view } = context
        const wc = view.webContents
        wc.audioMuted = true
        await wc.loadURL(url)
        wc.insertCSS(
          `
          * {
            display: none !important;
            pointer-events: none;
          }
          html, body, video {
            display: block !important;
            background: black !important;
          }
          html, body {
            overflow: hidden !important;
            background: black !important;
          }
          video {
            display: block !important;
            position: fixed !important;
            left: 0 !important;
            right: 0 !important;
            top: 0 !important;
            bottom: 0 !important;
            width: 100% !important;
            height: 100% !important;
            object-fit: cover !important;
            z-index: 999999 !important;
          }
        `,
          { cssOrigin: 'user' },
        )
      },
      startVideo: async (context, event) => {
        const wc = context.view.webContents
        const info = await wc.executeJavaScript(`
          const sleep = ms => new Promise((resolve) => setTimeout(resolve, ms))
          async function waitForVideo() {
            let tries = 0
            let video
            while ((!video || !video.src) && tries < 20) {
              video = document.querySelector('video')
              tries++
              await sleep(200)
            }
            if (!video) {
              throw new Error('could not find video')
            }
            document.body.appendChild(video)
            video.muted = false
            video.autoPlay = true
            video.play()
            setInterval(() => video.play(), 1000)
            const info = { title: document.title }
            return info
          }
          waitForVideo()
        `)
        return info
      },
    },
  },
)

export default viewStateMachine
