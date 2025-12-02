import Color from 'color'
import { render } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { useHotkeys } from 'react-hotkeys-hook'
import {
  FaFacebook,
  FaInstagram,
  FaTiktok,
  FaTwitch,
  FaVolumeUp,
  FaYoutube,
} from 'react-icons/fa'
import { RiKickFill, RiTwitterXFill } from 'react-icons/ri'
import { StreamwallState } from 'streamwall-shared'
import { styled } from 'styled-components'
import { TailSpin } from 'svg-loaders-react'
import { matchesState } from 'xstate'
import packageInfo from '../../package.json'
import { StreamwallLayerGlobal } from '../preload/layerPreload'

import '@fontsource/noto-sans'
import 'streamwall-control-ui/src/index.css'

declare global {
  interface Window {
    streamwallLayer: StreamwallLayerGlobal
  }
}

function Overlay({
  config,
  views,
  streams,
}: Pick<StreamwallState, 'config' | 'views' | 'streams'>) {
  const { width, height, activeColor } = config
  const [expandedUrl, setExpandedUrl] = useState<string | undefined>()
  
  // Listen for spotlight messages from the main process
  useEffect(() => {
    console.debug('Setting up spotlight listener')
    const unsubscribe = window.streamwallLayer.onSpotlight((url: string) => {
      console.debug('Received spotlight message for URL:', url)
      console.debug('Current expandedUrl:', expandedUrl)
      console.debug('Toggling expandedUrl...')
      setExpandedUrl(expandedUrl === url ? undefined : url)
    })
    return unsubscribe
  }, [expandedUrl])
  
  // Memoize stream lookup map for faster access
  const streamsByUrl = useMemo(() => {
    const map = new Map()
    streams.forEach(s => map.set(s.link, s))
    return map
  }, [streams])
  
  const expandedData = expandedUrl ? streamsByUrl.get(expandedUrl) : undefined
  
  const activeViews = views.filter(
    ({ state }) =>
      matchesState('displaying', state) &&
      !matchesState('displaying.error', state),
  )
  const overlays = streams.filter((s) => s.kind === 'overlay')
  return (
    <OverlayContainer>
      <VersionFooter />
      {activeViews.map(({ state, context }) => {
        const { content, pos } = context
        if (!content || !pos) {
          return
        }

        const data = streams.find((d) => content.url === d.link)
        const isListening = matchesState(
          'displaying.running.audio.listening',
          state,
        )
        const isBackgroundListening = matchesState(
          'displaying.running.audio.background',
          state,
        )
        const isBlurred = matchesState(
          'displaying.running.video.blurred',
          state,
        )
        const isLoading = matchesState('displaying.loading', state)
        const hasTitle = data && (data.label || data.source)
        const position = data?.labelPosition ?? 'top-left'
        const isExpanded = expandedUrl === content.url
        return (
          <div key={`${pos.spaces.join('-')}`}>
            <SpaceBorder
              pos={pos}
              windowWidth={width}
              windowHeight={height}
              activeColor={activeColor}
              isListening={isListening}
              isExpanded={false}
              isHighlighted={expandedUrl === content.url}
              onClick={() => setExpandedUrl(content.url)}
              style={{ cursor: 'pointer' }}
            >
              <BlurCover isBlurred={isBlurred} />
              {hasTitle && (
                <StreamTitle
                  position={position}
                  activeColor={activeColor}
                  isListening={isListening}
                >
                  <StreamIcon url={content.url} />
                  <span>
                    {data.label ? (
                      data.label
                    ) : (
                      <>
                        {data.source} &ndash; {data.city} {data.state}
                      </>
                    )}
                  </span>
                  {(isListening || isBackgroundListening) && <FaVolumeUp />}
                </StreamTitle>
              )}
              {isLoading && <LoadingSpinner />}
            </SpaceBorder>
          </div>
        )
      })}
      {overlays.map((s) => (
        <OverlayIFrame
          key={s._id}
          src={s.link}
          sandbox="allow-scripts allow-same-origin"
          allow="autoplay"
          scrolling="no"
        />
      ))}
      {expandedUrl && expandedData && (
        <ExpandedOverlay onClick={() => setExpandedUrl(undefined)}>
          <ExpandedContent onClick={() => setExpandedUrl(undefined)}>
            {expandedData && (expandedData.label || expandedData.source) && (
              <StreamTitle
                position={expandedData.labelPosition ?? 'top-left'}
                activeColor={activeColor}
                isListening={false}
              >
                <StreamIcon url={expandedData.link} />
                <span>
                  {expandedData.label ? (
                    expandedData.label
                  ) : (
                    <>
                      {expandedData.source} &ndash; {expandedData.city} {expandedData.state}
                    </>
                  )}
                </span>
              </StreamTitle>
            )}
            {/\.m3u8(\?.*)?$/.test(expandedUrl) ? (
              <ExpandedVideoFrame
                key={expandedUrl}
                src={`./playHLS.html?src=${encodeURIComponent(expandedUrl)}`}
                sandbox="allow-scripts allow-same-origin allow-presentation allow-forms"
                allow="autoplay accelerometer camera geolocation gyroscope magnetometer microphone midi payment usb vr xr-spatial-tracking"
                scrolling="no"
              />
            ) : (
              <ExpandedVideoFrame
                key={expandedUrl}
                src={expandedUrl}
                sandbox="allow-scripts allow-same-origin allow-presentation allow-forms"
                allow="autoplay accelerometer camera geolocation gyroscope magnetometer microphone midi payment usb vr xr-spatial-tracking"
                scrolling="no"
              />
            )}
          </ExpandedContent>
        </ExpandedOverlay>
      )}
    </OverlayContainer>
  )
}

function App() {
  const [state, setState] = useState<StreamwallState | undefined>()

  useEffect(() => {
    const unsubscribe = window.streamwallLayer.onState(setState)
    window.streamwallLayer.load()
    return unsubscribe
  }, [])

  useHotkeys('ctrl+shift+i', () => {
    window.streamwallLayer.openDevTools()
  })

  if (!state) {
    return
  }

  const { config, views, streams } = state
  return <Overlay config={config} views={views} streams={streams} />
}

function VersionFooter() {
  const [isShowing, setShowing] = useState(false)
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined = undefined
    const interval = setInterval(() => {
      setShowing(true)
      timeout = setTimeout(() => {
        setShowing(false)
      }, 5000)
    }, 30 * 1000)
    return () => {
      clearInterval(interval)
      clearTimeout(timeout)
    }
  }, [])
  return (
    <VersionText isShowing={isShowing}>
      <strong>streamwall.io</strong> {packageInfo.version}
    </VersionText>
  )
}

function StreamIcon({ url }: { url: string }) {
  let parsedURL
  try {
    parsedURL = new URL(url)
  } catch {
    return null
  }

  let { host } = parsedURL
  host = host.replace(/^www\./, '')
  if (host === 'youtube.com' || host === 'youtu.be') {
    return <FaYoutube />
  } else if (host === 'facebook.com' || host === 'm.facebook.com') {
    return <FaFacebook />
  } else if (host === 'twitch.tv') {
    return <FaTwitch />
  } else if (host === 'instagram.com') {
    return <FaInstagram />
  } else if (host === 'tiktok.com') {
    return <FaTiktok />
  } else if (host === 'kick.com') {
    return <RiKickFill />
  } else if (host === 'x.com') {
    return <RiTwitterXFill />
  }
  return null
}

const OverlayContainer = styled.div`
  overflow: hidden;
`

const ExpandedOverlay = styled.div`
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 10000;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
`

const ExpandedContent = styled.div`
  position: relative;
  width: 80vw;
  height: 80vh;
  max-width: 90vw;
  max-height: 90vh;
  overflow: hidden;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
`

const ExpandedVideoFrame = styled.iframe`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border: none;
  pointer-events: none;
  cursor: pointer;
  object-fit: contain;
`

const CloseButton = styled.button`
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 10001;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  border: 1px solid #666;
  border-radius: 4px;
  width: 32px;
  height: 32px;
  font-size: 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  
  &:hover {
    background: rgba(0, 0, 0, 0.9);
    border-color: #999;
  }
`

const SpaceBorder = styled.div.attrs(() => ({
  borderWidth: 2,
}))`
  display: flex;
  align-items: flex-start;
  position: fixed;
  left: ${({ pos, isExpanded, windowWidth }) => isExpanded ? windowWidth * 0.1666 : pos.x}px;
  top: ${({ pos, isExpanded, windowHeight }) => isExpanded ? windowHeight * 0.1666 : pos.y}px;
  width: ${({ pos, isExpanded, windowWidth }) => isExpanded ? windowWidth * 0.6666 : pos.width}px;
  height: ${({ pos, isExpanded, windowHeight }) => isExpanded ? windowHeight * 0.6666 : pos.height}px;
  border: 0 solid ${({ isHighlighted }) => isHighlighted ? '#00ff00' : 'black'};
  border-left-width: ${({ pos, borderWidth, isExpanded }) =>
    (isExpanded || pos.x === 0) ? 0 : borderWidth}px;
  border-right-width: ${({ pos, borderWidth, windowWidth, isExpanded }) =>
    (isExpanded || pos.x + pos.width === windowWidth) ? 0 : borderWidth}px;
  border-top-width: ${({ pos, borderWidth, isExpanded }) =>
    (isExpanded || pos.y === 0) ? 0 : borderWidth}px;
  border-bottom-width: ${({ pos, borderWidth, windowHeight, isExpanded }) =>
    (isExpanded || pos.y + pos.height === windowHeight) ? 0 : borderWidth}px;
  box-shadow: ${({ isListening, activeColor, isExpanded }) =>
    isListening || isExpanded ? `0 0 10px ${activeColor} inset` : 'none'};
  box-sizing: border-box;
  cursor: pointer;
  transition: ${({ isExpanded }) => isExpanded ? 'all 0.3s ease' : 'none'};
  z-index: ${({ isExpanded }) => isExpanded ? 1000 : 1};
  pointer-events: auto;
  user-select: none;
`

const StreamTitle = styled.div`
  position: absolute;
  z-index: 100;
  pointer-events: auto;
  ${({ position }) => {
    if (position === 'top-left') {
      return `top: 10px; left: 10px;`
    } else if (position === 'top-right') {
      return `top: 10px; right: 10px;`
    } else if (position === 'bottom-right') {
      return `bottom: 10px; right: 10px;`
    } else if (position === 'bottom-left') {
      return `bottom: 10px; left: 10px;`
    }
  }}
  max-width: calc(100% - 30px);
  box-sizing: border-box;

  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px 10px;
  font-weight: 600;
  font-size: 20px;
  color: white;
  text-shadow: 0 0 4px black;
  letter-spacing: -0.025em;
  background: ${({
    isListening,
    activeColor,
  }: {
    isListening: boolean
    activeColor: string
  }) =>
    Color(isListening ? activeColor : 'black')
      .alpha(0.5)
      .toString()};
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

const VersionText = styled.div`
  position: fixed;
  bottom: 4px;
  right: 4px;
  color: white;
  font-size: 12px;
  text-shadow:
    0 0 1px rgba(0, 0, 0, 0.5),
    1px 0 1px rgba(0, 0, 0, 0.5),
    0 1px 1px rgba(0, 0, 0, 0.5),
    1px 1px 1px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(30px);
  padding: 1px 4px;
  border-bottom-left-radius: 4px;
  opacity: ${({ isShowing }) => (isShowing ? '.65' : '.35')};
  transition: ease-out 500ms all;
`

const OverlayIFrame = styled.iframe`
  position: fixed;
  left: 0;
  top: 0;
  width: 100vw;
  height: 100vh;
  border: none;
  pointer-events: none;
`

render(<App />, document.body)
