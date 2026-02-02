import { ipcRenderer, webFrame } from 'electron'
import throttle from 'lodash/throttle'
import { ContentDisplayOptions, ViewPos } from 'streamwall-shared'

const SCAN_THROTTLE = 500
const INITIAL_TIMEOUT = 10 * 1000

const VIDEO_OVERRIDE_STYLE = `
  * {
    pointer-events: none;
    display: none !important;
    z-index: 0 !important;
  }
  html, body, video, audio, body:after {
    display: block !important;
    background: transparent !important;
    min-height: 0 !important;
    min-width: 0 !important;
  }
  html, body {
    overflow: hidden !important;
    background: transparent !important;
  }
  video, audio, body:after {
    display: block !important;
    position: absolute !important;
    top: 0 !important;
    bottom: 0 !important;
    left: 0 !important;
    right: 0 !important;
    width: 100% !important;
    height: 100% !important;
    object-fit: cover !important;
    z-index: 999999 !important;
  }
  audio {
    z-index: 999998 !important;
  }
`

const WEB_OVERRIDE_STYLE = `
  html, body {
    overflow: hidden !important;
  }
  body {
    background: white;
  }
`

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(() => resolve(), ms))

const pageReady = new Promise((resolve) =>
  document.addEventListener('DOMContentLoaded', resolve, { once: true }),
)

class BodyStyleController {
  cssKey: string | undefined
  pos: ViewPos
  options: ContentDisplayOptions

  constructor(pos: ViewPos, options: ContentDisplayOptions) {
    this.pos = pos
    this.options = options
  }

  updatePosition(pos: ViewPos) {
    this.pos = pos
    this.update()
  }

  updateOptions(options: ContentDisplayOptions) {
    this.options = options
    this.update()
  }

  update() {
    const { pos, options } = this
    const { x, y, width, height } = pos
    const { rotation, glowColor } = options
    const borderWidth = 2
    const windowWidth = window.innerWidth
    const windowHeight = window.innerHeight

    const styleParts = []
    styleParts.push(`
      body {
        position: fixed !important;
        contain: strict;
        left: ${x}px !important;
        top: ${y}px !important;
        width: ${width}px !important;
        height: ${height}px !important;
        min-width: 0 !important;
        min-height: 0 !important;
        max-width: none !important;
        max-height: none !important;
        border: 0 solid black !important;
        border-left-width: ${x === 0 ? 0 : borderWidth}px !important;
        border-right-width: ${x + width === windowWidth ? 0 : borderWidth}px !important;
        border-top-width: ${y === 0 ? 0 : borderWidth}px !important;
        border-bottom-width: ${y + height === windowHeight ? 0 : borderWidth}px !important;
        box-sizing: border-box !important;
        transition: top 250ms ease, left 250ms ease, width 250ms ease, height 250ms ease, transform 250ms ease !important;
        transform: rotate(0deg);
      }
    `)

    if (rotation === 180) {
      styleParts.push(`
        body {
          transform: rotate(180deg) !important;
        }
      `)
    }

    if (rotation === 90 || rotation === 270) {
      // For 90 degree rotations, we position with swapped width and height and rotate it into place.
      // It's helpful to offset the position so the centered transform origin is in the center of the intended destination.
      // Then we use translate to center on the position and rotate around the center.
      // Note that the width and height are swapped in the translate because the video starts with the side dimensions swapped.
      const halfWidth = width / 2
      const halfHeight = height / 2
      styleParts.push(`
        body {
          left: ${x + halfWidth}px !important;
          top: ${y + halfHeight}px !important;
          width: ${height}px !important;
          height: ${width}px !important;
          transform: translate(-${halfHeight}px, -${halfWidth}px) rotate(${rotation}deg) !important;
        }
      `)
    }

    if (glowColor) {
      styleParts.push(`
        body:after {
          content: '';
          box-shadow: 0 0 10px ${glowColor} inset !important;
        }
      `)
    }

    if (this.cssKey !== undefined) {
      webFrame.removeInsertedCSS(this.cssKey)
    }
    // Note: we can't use 'user' origin here because it can't be removed (https://github.com/electron/electron/issues/27792)
    this.cssKey = webFrame.insertCSS(styleParts.join('\n'))
  }
}

class SnapshotController {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  latestSnapshotURL: string | null = null

  constructor() {
    this.canvas = document.createElement('canvas')
  }

  async snapshotVideo(videoEl: HTMLVideoElement) {
    if (!('requestVideoFrameCallback' in videoEl)) {
      console.warn('requestVideoFrameCallback not supported')
      return
    }

    videoEl.requestVideoFrameCallback(() => {
      const { canvas } = this
      canvas.width = videoEl.videoWidth
      canvas.height = videoEl.videoHeight

      const ctx = canvas.getContext('2d')
      if (!ctx) {
        console.warn('could not get canvas context')
        return
      }

      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => {
        if (!blob) {
          console.warn('could not create blob from canvas')
          return
        }

        if (this.latestSnapshotURL) {
          URL.revokeObjectURL(this.latestSnapshotURL)
        }

        const url = URL.createObjectURL(blob)
        videoEl.poster = url
      }, 'image/png')
    })
  }
}

/** Watch for media tags and mute them as soon as possible. */
async function lockdownMediaTags() {
  const lockdown = throttle(() => {
    webFrame.executeJavaScript(`
      for (const el of document.querySelectorAll('video, audio')) {
        if (el.__sw) {
          continue
        }
        // Prevent sites from re-muting the video
        Object.defineProperty(el, 'muted', { writable: true, value: false })
        // Prevent Facebook from pausing the video after page load.
        Object.defineProperty(el, 'pause', { writable: false, value: () => {} })
        el.__sw = true
      }
    `)
  }, SCAN_THROTTLE)
  await pageReady
  const observer = new MutationObserver(lockdown)
  observer.observe(document.body, { subtree: true, childList: true })
}

async function waitForQuery(query: string): Promise<Element> {
  console.log(`waiting for '${query}'...`)
  await pageReady
  return new Promise((resolve) => {
    const scan = throttle(() => {
      const el = document.querySelector(query)
      if (el) {
        console.log(`found '${query}'`)
        resolve(el)
        observer.disconnect()
      }
    }, SCAN_THROTTLE)

    const observer = new MutationObserver(scan)
    observer.observe(document.body, { subtree: true, childList: true })
    scan()
  })
}

async function waitForVideo(
  kind: 'video' | 'audio',
  timeoutMs = INITIAL_TIMEOUT,
): Promise<{
  video?: HTMLMediaElement
}> {
  lockdownMediaTags()

  let queryPromise: Promise<Element | void> = waitForQuery(kind)
  if (timeoutMs !== Infinity) {
    queryPromise = Promise.race([queryPromise, sleep(timeoutMs)])
  }
  const video: Element | null | void = await queryPromise
  if (video instanceof HTMLMediaElement) {
    return { video }
  }

  return {}
}

async function findMedia(
  kind: 'video' | 'audio',
  elementTimeout = INITIAL_TIMEOUT,
) {
  const { video } = await waitForVideo(kind, elementTimeout)
  if (!video) {
    throw new Error('could not find video')
  }
  document.body.appendChild(video)

  video.play()

  if (video instanceof HTMLVideoElement && !video.videoWidth) {
    console.log(`video isn't playing yet. waiting for it to start...`)
    const videoReady = new Promise((resolve) =>
      video.addEventListener('playing', resolve, { once: true }),
    )
    await Promise.race([videoReady, sleep(INITIAL_TIMEOUT)])
    if (!video.videoWidth) {
      throw new Error('timeout waiting for video to start')
    }
    console.log('video started')
  }

  video.muted = false

  return video
}

async function main() {
  const viewInit = ipcRenderer.invoke('view-init')
  const pageReady = new Promise((resolve) => process.once('loaded', resolve))

  const [{ content, pos: initialPos, options: initialOptions }] =
    await Promise.all([viewInit, pageReady])

  const styleController = new BodyStyleController(initialPos, initialOptions)
  styleController.update()

  const snapshotController = new SnapshotController()

  async function acquireMedia(elementTimeout: number) {
    let snapshotInterval: number | undefined

    const media = await findMedia(content.kind, elementTimeout)
    console.log('media acquired', media)

    ipcRenderer.send('view-loaded')

    if (content.kind === 'video' && media instanceof HTMLVideoElement) {
      snapshotInterval = window.setInterval(() => {
        snapshotController.snapshotVideo(media)
      }, 1000)
    }

    media.addEventListener(
      'emptied',
      async () => {
        console.warn('media emptied, re-acquiring', media)

        ipcRenderer.send('view-stalled')
        clearInterval(snapshotInterval)

        const newMedia = await acquireMedia(Infinity)
        if (newMedia !== media) {
          media.remove()
        }
      },
      { once: true },
    )
    return media
  }

  if (content.kind === 'video' || content.kind === 'audio') {
    webFrame.insertCSS(VIDEO_OVERRIDE_STYLE, { cssOrigin: 'user' })
    acquireMedia(INITIAL_TIMEOUT)
    ipcRenderer.send('view-info', {
      info: {
        title: document.title,
      },
    })
  } else if (content.kind === 'web') {
    webFrame.insertCSS(WEB_OVERRIDE_STYLE, { cssOrigin: 'user' })
    ipcRenderer.send('view-loaded')
  }

  ipcRenderer.on('position', (_ev, pos) => styleController.updatePosition(pos))
  ipcRenderer.on('options', (_ev, options) =>
    styleController.updateOptions(options),
  )
}

main().catch((error) => {
  ipcRenderer.send('view-error', { error })
})
