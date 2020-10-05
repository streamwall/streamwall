import { h, Fragment, render } from 'preact'
import { useEffect, useState, useRef } from 'preact/hooks'
import { State } from 'xstate'
import styled from 'styled-components'
import { useHotkeys } from 'react-hotkeys-hook'
import { TailSpin } from 'svg-loaders-react'
import Color from 'color'

import '../index.css'

import InstagramIcon from '../static/instagram.svg'
import FacebookIcon from '../static/facebook.svg'
import PeriscopeIcon from '../static/periscope.svg'
import TwitchIcon from '../static/twitch.svg'
import YouTubeIcon from '../static/youtube.svg'
import SoundIcon from '../static/volume-up-solid.svg'

const VIEW_POS_TRANSITION = '0.1s linear'
const VIEW_OPACITY_TRANSITION = '0.5s ease-out'

function Overlay({ config, views, streams }) {
  const { width, height, activeColor } = config
  const activeViews = views
    .map(({ state, context }) => State.from(state, context))
    .filter((s) => !s.matches('error'))
  const backgrounds = streams.filter((s) => s.kind === 'background')
  const overlays = streams.filter((s) => s.kind === 'overlay')
  // TODO: prevent iframes from being reparented
  return (
    <div>
      {backgrounds.map((s) => (
        <OverlayIframe key={s._id} src={s.link} />
      ))}
      {activeViews.map((viewState) => {
        const { viewId, content, pos, info } = viewState.context
        const data = streams.find((d) => content.url === d.link)
        const isListening = viewState.matches('running.audio.listening')
        const isBackgroundListening = viewState.matches(
          'running.audio.background',
        )
        const isBlurred = viewState.matches('running.video.blurred')
        const isLoading = viewState.matches('loading')
        const isRunning = viewState.matches('running')
        return (
          <ViewContainer key={viewId} pos={pos}>
            <MediaIframe
              key={viewId}
              pos={pos}
              intrinsicWidth={info.intrinsicWidth}
              intrinsicHeight={info.intrinsicHeight}
              isRunning={isRunning}
              src={content.url}
              name={viewId}
            ></MediaIframe>
            <SpaceBorder
              pos={pos}
              windowWidth={width}
              windowHeight={height}
              activeColor={activeColor}
              isListening={isListening}
            >
              {data && (
                <StreamTitle
                  activeColor={activeColor}
                  isListening={isListening}
                >
                  <StreamIcon url={content.url} />
                  <span>
                    {data.hasOwnProperty('label') ? (
                      data.label
                    ) : (
                      <>
                        {data.source} &ndash; {data.city} {data.state}
                      </>
                    )}
                  </span>
                  {(isListening || isBackgroundListening) && <SoundIcon />}
                </StreamTitle>
              )}
            </SpaceBorder>
            {isLoading && <LoadingSpinner />}
          </ViewContainer>
        )
      })}
      {overlays.map((s) => (
        <OverlayIframe key={s._id} src={s.link} />
      ))}
    </div>
  )
}

function App() {
  const [state, setState] = useState({
    config: {},
    views: [],
    streams: [],
    customStreams: [],
  })

  useEffect(() => {
    streamwall.onState(setState)
    streamwall.onReloadView(({ viewId }) => {
      const viewFrame = document.querySelector(`iframe[name="${viewId}"]`)
      if (viewFrame) {
        viewFrame.src = viewFrame.src
      }
    })
  }, [])

  useHotkeys('ctrl+shift+i', () => {
    streamwall.openDevTools()
  })

  const { config, views, streams, customStreams } = state
  return (
    <Overlay
      config={config}
      views={views}
      streams={streams}
      customStreams={customStreams}
    />
  )
}

function StreamIcon({ url, ...props }) {
  let parsedURL
  try {
    parsedURL = new URL(url)
  } catch {
    return null
  }

  let { host } = parsedURL
  host = host.replace(/^www\./, '')
  if (host === 'youtube.com' || host === 'youtu.be') {
    return <YouTubeIcon {...props} />
  } else if (host === 'facebook.com' || host === 'm.facebook.com') {
    return <FacebookIcon {...props} />
  } else if (host === 'twitch.tv') {
    return <TwitchIcon {...props} />
  } else if (
    host === 'periscope.tv' ||
    host === 'pscp.tv' ||
    host === 'twitter.com'
  ) {
    return <PeriscopeIcon {...props} />
  } else if (host === 'instagram.com') {
    return <InstagramIcon {...props} />
  }
  return null
}

function MediaIframe({
  isRunning,
  pos,
  intrinsicWidth,
  intrinsicHeight,
  ...props
}) {
  const frameRef = useRef()

  // Set isMounted after render so the transition doesn't apply to the initial sizing of the frame.
  useEffect(() => {
    if (!isRunning) {
      return
    }
    const { current: el } = frameRef
    el.style.transition = `transform ${VIEW_POS_TRANSITION}, opacity ${VIEW_OPACITY_TRANSITION}`
    el.style.opacity = 1
  }, [isRunning])

  let style = {
    position: 'absolute',
    left: -9999,
    width: pos.width,
    height: pos.height,
    opacity: 0,
  }
  if (isRunning) {
    const scale = Math.max(
      pos.width / intrinsicWidth,
      pos.height / intrinsicHeight,
    )
    const translateX = -(intrinsicWidth * scale - pos.width) / 2
    const translateY = -(intrinsicHeight * scale - pos.height) / 2
    const transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`
    style = {
      opacity: 0,
      transform,
      transition: 'none',
      // TODO: explore not oversampling as a perf improvement
      width: intrinsicWidth,
      height: intrinsicHeight,
    }
  }
  return <StyledMediaIframe ref={frameRef} {...props} style={style} />
}

const ViewContainer = styled.div`
  position: fixed;
  left: ${({ pos }) => pos.x}px;
  top: ${({ pos }) => pos.y}px;
  width: ${({ pos }) => pos.width}px;
  height: ${({ pos }) => pos.height}px;
  overflow: hidden;
  transition: left ${VIEW_POS_TRANSITION}, top ${VIEW_POS_TRANSITION},
    width ${VIEW_POS_TRANSITION}, height ${VIEW_POS_TRANSITION};
  will-change: left, top, width, height;
`

const SpaceBorder = styled.div.attrs((props) => ({
  borderWidth: 2,
}))`
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: flex-start;
  border: 0 solid black;
  border-left-width: ${({ pos, borderWidth }) =>
    pos.x === 0 ? 0 : borderWidth}px;
  border-right-width: ${({ pos, borderWidth, windowWidth }) =>
    pos.x + pos.width === windowWidth ? 0 : borderWidth}px;
  border-top-width: ${({ pos, borderWidth }) =>
    pos.y === 0 ? 0 : borderWidth}px;
  border-bottom-width: ${({ pos, borderWidth, windowHeight }) =>
    pos.y + pos.height === windowHeight ? 0 : borderWidth}px;
  box-shadow: ${({ isListening, activeColor }) =>
    isListening ? `0 0 10px ${activeColor} inset` : 'none'};
  box-sizing: border-box;
  pointer-events: none;
  user-select: none;
`

const StreamTitle = styled.div`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px 10px;
  margin: 5px;
  font-weight: 600;
  font-size: 20px;
  color: white;
  text-shadow: 0 0 4px black;
  letter-spacing: -0.025em;
  background: ${({ isListening, activeColor }) =>
    Color(isListening ? activeColor : 'black').alpha(0.5)};
  border-radius: 4px;
  backdrop-filter: blur(10px);
  overflow: hidden;

  span {
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
  }

  svg {
    width: 1.25em;
    height: 1.25em;
    overflow: visible;
    filter: drop-shadow(0 0 4px black);

    &:first-child {
      margin-right: 0.35em;
    }

    &:last-child {
      margin-left: 0.5em;
    }

    path {
      fill: white;
    }
  }
`

const LoadingSpinner = styled(TailSpin)`
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 100px;
  height: 100px;
  opacity: 0.5;
`

const BlurCover = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  backdrop-filter: ${({ isBlurred }) => (isBlurred ? 'blur(30px)' : 'blur(0)')};
`

const Iframe = styled.iframe.attrs((props) => ({
  sandbox: 'allow-scripts allow-same-origin',
  allow: 'autoplay',
}))`
  border: none;
  pointer-events: none;
`

const StyledMediaIframe = styled(Iframe)`
  position: absolute;
  transform-origin: top left;
  will-change: opacity, transform;
`

const OverlayIframe = styled(Iframe)`
  position: fixed;
  left: 0;
  top: 0;
  width: 100vw;
  height: 100vh;
`

render(<App />, document.body)
