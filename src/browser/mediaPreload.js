import { ipcRenderer, webFrame } from 'electron'
import throttle from 'lodash/throttle'

const SCAN_THROTTLE = 500

const VIDEO_OVERRIDE_STYLE = `
  * {
    pointer-events: none;
    display: none !important;
    position: static !important;
    z-index: 0 !important;
  }
  html, body, video, audio {
    display: block !important;
    background: black !important;
  }
  html, body {
    overflow: hidden !important;
    background: black !important;
  }
  video, iframe.__video__, audio {
    display: block !important;
    position: fixed !important;
    left: 0 !important;
    right: 0 !important;
    top: 0 !important;
    bottom: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    object-fit: cover !important;
    transition: none !important;
    z-index: 999999 !important;
  }
  audio {
    z-index: 999998 !important;
  }
  .__video_parent__ {
    display: block !important;
  }
  video.__rot180__ {
    transform: rotate(180deg) !important;
  }
  /* For 90 degree rotations, we position the video with swapped width and height and rotate it into place.
     It's helpful to offset the video so the transformation is centered in the viewport center.
     We move the video top left corner to center of the page and then translate half the video dimensions up and left.
     Note that the width and height are swapped in the translate because the video starts with the side dimensions swapped. */
  video.__rot90__ {
    transform: translate(-50vh, -50vw) rotate(90deg) !important;
  }
  video.__rot270__ {
    transform: translate(-50vh, -50vw) rotate(270deg) !important;
  }
  video.__rot90__, video.__rot270__ {
    left: 50vw !important;
    top: 50vh !important;
    width: 100vh !important;
    height: 100vw !important;
  }
`

const NO_SCROLL_STYLE = `
  html, body {
    overflow: hidden !important;
  }
`

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const pageReady = new Promise((resolve) =>
  document.addEventListener('DOMContentLoaded', resolve, { once: true }),
)

class RotationController {
  constructor(video) {
    this.video = video
    this.siteRotation = 0
    this.customRotation = 0
  }

  _update() {
    const rotation = (this.siteRotation + this.customRotation) % 360
    if (![0, 90, 180, 270].includes(rotation)) {
      console.warn('ignoring invalid rotation', rotation)
    }
    this.video.className = `__rot${rotation}__`
  }

  setSite(rotation = 0) {
    this.siteRotation = rotation
    this._update()
  }

  setCustom(rotation = 0) {
    this.customRotation = rotation
    this._update()
  }
}

// Watch for media tags and mute them as soon as possible.
async function lockdownMediaTags() {
  const lockdown = throttle(() => {
    webFrame.executeJavaScript(`
      for (const el of document.querySelectorAll('video, audio')) {
        if (el.__sw) {
          continue
        }
        // Prevent sites from re-muting the video (Periscope, I'm looking at you!)
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

function waitForQuery(query) {
  console.log(`waiting for '${query}'...`)
  return new Promise(async (resolve) => {
    const scan = throttle(() => {
      const el = document.querySelector(query)
      if (el) {
        console.log(`found '${query}'`)
        resolve(el)
        observer.disconnect()
      }
    }, SCAN_THROTTLE)

    await pageReady
    const observer = new MutationObserver(scan)
    observer.observe(document.body, { subtree: true, childList: true })
    scan()
  })
}

async function waitForVideo(kind) {
  lockdownMediaTags()

  let video = await Promise.race([waitForQuery(kind), sleep(10 * 1000)])
  if (video) {
    return { video }
  }

  let iframe
  for (iframe of document.querySelectorAll('iframe')) {
    video = iframe.contentDocument?.querySelector?.(kind)
    if (video) {
      return { video, iframe }
    }
  }
  return {}
}

const periscopeHacks = {
  isMatch() {
    return (
      location.host === 'www.pscp.tv' || location.host === 'www.periscope.tv'
    )
  },
  async onLoad() {
    const playButton = await Promise.race([
      waitForQuery('.PlayButton'),
      sleep(1000),
    ])
    if (playButton) {
      playButton.click()
    }
  },
  afterPlay(rotationController) {
    const baseVideoEl = document.querySelector('div.BaseVideo')
    if (!baseVideoEl) {
      return
    }

    function positionPeriscopeVideo() {
      // Periscope videos can be rotated using transform matrix. They need to be rotated correctly.
      const tr = baseVideoEl.style.transform
      let rotation
      if (tr.endsWith('matrix(0, 1, -1, 0, 0, 0)')) {
        rotation = 90
      } else if (tr.endsWith('matrix(-1, 0, 0, -1, 0)')) {
        rotation = 180
      } else if (tr.endsWith('matrix(0, -1, 1, 0, 0, 0)')) {
        rotation = 270
      }
      rotationController.setSite(rotation)
    }

    positionPeriscopeVideo()
    const obs = new MutationObserver((ml) => {
      for (const m of ml) {
        if (m.attributeName === 'style') {
          positionPeriscopeVideo()
          return
        }
      }
    })
    obs.observe(baseVideoEl, { attributes: true })
  },
}

async function findVideo(kind) {
  if (periscopeHacks.isMatch()) {
    await periscopeHacks.onLoad()
  }

  const { video, iframe } = await waitForVideo(kind)
  if (!video) {
    throw new Error('could not find video')
  }
  if (iframe) {
    // TODO: verify iframe still works
    const style = iframe.contentDocument.createElement('style')
    style.innerHTML = VIDEO_OVERRIDE_STYLE
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

  video.play()

  if (!video.videoWidth) {
    console.log(`video isn't playing yet. waiting for it to start...`)
    const videoReady = new Promise((resolve) =>
      video.addEventListener('playing', resolve, { once: true }),
    )
    await videoReady
    console.log('video started')
  }

  const info = {
    title: document.title,
  }
  return { info, video }
}

async function main() {
  const viewInit = ipcRenderer.invoke('view-init')
  const pageReady = new Promise((resolve) => process.once('loaded', resolve))

  const [{ content, options: initialOptions }] = await Promise.all([
    viewInit,
    pageReady,
  ])

  let rotationController
  if (content.kind === 'video' || content.kind === 'audio') {
    webFrame.insertCSS(VIDEO_OVERRIDE_STYLE, { cssOrigin: 'user' })
    const { info, video } = await findVideo(content.kind)
    if (content.kind === 'video') {
      rotationController = new RotationController(video)
      if (periscopeHacks.isMatch()) {
        periscopeHacks.afterPlay(rotationController)
      }
    }
    ipcRenderer.send('view-info', { info })
  } else if (content.kind === 'web') {
    webFrame.insertCSS(NO_SCROLL_STYLE, { cssOrigin: 'user' })
  }

  ipcRenderer.send('view-loaded')

  function updateOptions(options) {
    if (rotationController) {
      rotationController.setCustom(options.rotation)
    }
  }
  ipcRenderer.on('options', (ev, options) => updateOptions(options))
  updateOptions(initialOptions)
}

main().catch((err) => {
  ipcRenderer.send('view-error', { err })
})
