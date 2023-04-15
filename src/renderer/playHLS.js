import Hls from 'hls.js'

const searchParams = new URLSearchParams(location.search)
const src = searchParams.get('src')

const videoEl = document.createElement('video')

var hls = new Hls()
hls.attachMedia(videoEl)

hls.loadSource(src)
hls.on(Hls.Events.MANIFEST_PARSED, () => {
  document.body.appendChild(videoEl)
})
