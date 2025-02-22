import Hls from 'hls.js'

function loadHLS(src: string) {
  const videoEl = document.createElement('video')

  const hls = new Hls()
  hls.attachMedia(videoEl)

  hls.loadSource(src)
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    document.body.appendChild(videoEl)
  })
}

const searchParams = new URLSearchParams(location.search)
const src = searchParams.get('src')
if (src) {
  loadHLS(src)
}
