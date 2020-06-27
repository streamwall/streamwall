import isEqual from 'lodash/isEqual'
import { Machine, assign } from 'xstate'

import { ensureValidURL } from '../util'

const VIDEO_OVERRIDE_STYLE = `
  * {
    pointer-events: none;
    display: none !important;
    position: static !important;
    z-index: 0 !important;
  }
  html, body, video {
    display: block !important;
    background: black !important;
  }
  html, body {
    overflow: hidden !important;
    background: black !important;
  }
  video, iframe.__video__ {
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
  .__video_parent__ {
    display: block !important;
  }
  body.__scale_contain__ video, body.__scale_contain__ iframe.__video__ {
          object-fit: contain !important;
  }
`

const viewStateMachine = Machine(
  {
    id: 'view',
    initial: 'empty',
    context: {
      view: null,
      pos: null,
      content: null,
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
          RELOAD: '.loading',
          DEVTOOLS: {
            actions: 'openDevTools',
          },
        },
        states: {
          loading: {
            initial: 'page',
            entry: 'offscreenView',
            states: {
              page: {
                invoke: {
                  src: 'loadPage',
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
              scale: {
                initial: 'cover',
                on: {
                  COVER: '.cover',
                  CONTAIN: '.contain',
                },
                states: {
                  cover: {
                    entry: 'setScaleCover',
                  },
                  contain: {
                    entry: 'setScaleContain',
                  }
                }
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
      setScaleContain: (context, event) => {
        context.view.webContents.executeJavascript(`
          document.body.classList.add('__scale_contain__')
        `)
      },
      setScaleCover: (context, event) => {
        context.view.webContents.executeJavascript(`
          document.body.classList.remove('__scale_contain__')
        `)
      },
      openDevTools: (context, event) => {
        const { view } = context
        const { inWebContents } = event
        view.webContents.setDevToolsWebContents(inWebContents)
        view.webContents.openDevTools({ mode: 'detach' })
      },
    },
    guards: {
      contentUnchanged: (context, event) => {
        return isEqual(context.content, event.content)
      },
    },
    services: {
      loadPage: async (context, event) => {
        const { content, view } = context
        ensureValidURL(content.url)
        const wc = view.webContents
        wc.audioMuted = true
        await wc.loadURL(content.url)
        if (content.kind === 'video') {
          wc.insertCSS(VIDEO_OVERRIDE_STYLE, { cssOrigin: 'user' })
        } else if (content.kind === 'web') {
          wc.insertCSS(
            `
            html, body {
              overflow: hidden !important;
            }
            `,
            { cssOrigin: 'user' },
          )
        }
      },
      startVideo: async (context, event) => {
        const { content, view } = context
        if (content.kind !== 'video') {
          return
        }
        const wc = view.webContents
        const info = await wc.executeJavaScript(`
          const sleep = ms => new Promise((resolve) => setTimeout(resolve, ms))

          async function waitForVideo() {
            let tries = 0
            let video
            while ((!video || !video.src) && tries < 10) {
              video = document.querySelector('video')
              tries++
              await sleep(200)
            }
            if (video) {
              return {video}
            }

            tries = 0
            let iframe
            while ((!video || !video.src) && tries < 10) {
              for (iframe of document.querySelectorAll('iframe')) {
                if (!iframe.contentDocument) {
                  continue
                }
                video = iframe.contentDocument.querySelector('video')
                if (video) {
                  break
                }
              }
              tries++
              await sleep(200)
            }
            if (video) {
              return { video, iframe }
            }
            return {}
          }

          async function findVideo() {
            const { video, iframe } = await waitForVideo()
            if (!video) {
              throw new Error('could not find video')
            }
            if (iframe) {
              const style = iframe.contentDocument.createElement('style')
              style.innerHTML = \`${VIDEO_OVERRIDE_STYLE}\`
              iframe.contentDocument.head.appendChild(style)
              iframe.className = '__video__'
              let parentEl = iframe.parentElement
              while (parentEl) {
                parentEl.className = '__video_parent__'
                parentEl = parentEl.parentElement
              }
              iframe.contentDocument.body.appendChild(video)
            } else {
              document.body.appendChild(video)
            }
            video.muted = false
            video.autoPlay = true
            video.play()
            setInterval(() => video.play(), 1000)

            // Prevent sites from re-muting the video (Periscope, I'm looking at you!)
            Object.defineProperty(video, 'muted', {writable: true, value: false})

            const info = { title: document.title }
            let divBase = document.querySelector('div.BaseVideo') // This will filter for only periscope videos
            if (divBase && divBase.style && divBase.style.transform) {
              // periscope videos can be rotated using transform matrix. They need to be rotated correctly.
              const tr = divBase.style.transform
              if (tr.endsWith("matrix(0, 1, -1, 0, 0, 0)")) {
                video.style.transform = 'rotate(90deg)'
              } else if (tr.endsWith("matrix(-1, 0, 0, -1, 0)")) {
                video.style.transform = 'rotate(180deg)'
              } else if (tr.endsWith("matrix(0, -1, 1, 0, 0, 0)")) {
                video.style.transform = 'rotate(-90deg)'
              }
            }
            return info
          }
          findVideo()
        `)
        return info
      },
    },
  },
)

export default viewStateMachine
