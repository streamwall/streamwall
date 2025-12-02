import Hls from 'hls.js'

// Parse src immediately on load
const searchParams = new URLSearchParams(location.search)
const src = searchParams.get('src')

console.debug('PlayHLS loading with src:', src)

// Create and append video immediately
const videoEl = document.createElement('video')
videoEl.autoplay = true
videoEl.muted = true
videoEl.style.position = 'absolute'
videoEl.style.top = '0'
videoEl.style.left = '0'
videoEl.style.width = '100%'
videoEl.style.height = '100%'
videoEl.style.objectFit = 'fill'
videoEl.style.display = 'block'
videoEl.style.margin = '0'
videoEl.style.padding = '0'
videoEl.loop = false // Explicitly disable looping for live streams
videoEl.controls = false
document.body.appendChild(videoEl)

// Add event listeners to detect and prevent looping
videoEl.addEventListener('ended', (e) => {
  console.debug('Video ended event - pausing playback')
  videoEl.pause()
  videoEl.currentTime = 0
})

// Start HLS loading immediately if src exists
if (src) {
  const hls = new Hls({
    lowLatencyMode: true,
    enableWorker: true,
    startLevel: -1, // Auto-select quality
    defaultAudioCodec: undefined,
    backBufferLength: 90,
    liveDurationInfinity: true,
  })

  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    console.debug('HLS manifest parsed, starting playback')
    // Don't automatically start playback - let autoplay handle it
  })

  hls.on(Hls.Events.ERROR, (event, data) => {
    console.error('HLS error:', data)
    // Ignore error if it's just about a rendition that doesn't exist
    if (data.fatal) {
      console.error('Fatal HLS error, recovering...')
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        hls.startLoad()
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError()
      }
    }
  })

  hls.attachMedia(videoEl)
  hls.loadSource(src)
  
  console.debug('Loading HLS stream:', src)
}


