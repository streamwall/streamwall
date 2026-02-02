import Color from 'color'
import { render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { useHotkeys } from 'react-hotkeys-hook'
import {
  FaFacebook,
  FaInstagram,
  FaMapMarkerAlt,
  FaTiktok,
  FaTwitch,
  FaVolumeUp,
  FaYoutube,
} from 'react-icons/fa'
import { RiKickFill, RiTwitterXFill } from 'react-icons/ri'
import { StreamwallState, ViewState } from 'streamwall-shared'
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
  const { activeColor } = config
  const activeViews = views.filter(
    ({ state }) =>
      matchesState('displaying', state) &&
      !matchesState('displaying.error', state),
  )
  activeViews.sort((a: ViewState, b: ViewState) => a.context.id - b.context.id)
  const overlays = streams.filter((s) => s.kind === 'overlay')
  return (
    <OverlayContainer>
      <VersionFooter />
      {activeViews.map(({ state, context }) => {
        const { content, pos } = context
        if (!content) {
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
        const isStalled = matchesState(
          'displaying.running.playback.stalled',
          state,
        )
        const hasTitle = data && (data.label || data.source)
        const position = data?.labelPosition ?? 'top-left'
        return (
          <SpaceBorder
            key={`view-${context.id}`}
            pos={pos}
            isLoading={isLoading}
          >
            <FilterCover isBlurred={isBlurred} isDesaturated={isStalled} />
            {hasTitle && (
              <StreamTitle
                position={position}
                activeColor={activeColor}
                isListening={isListening}
              >
                <StreamIcon url={content.url} />
                <span>{data.label ? data.label : <>{data.source}</>}</span>
                {(isListening || isBackgroundListening) && <FaVolumeUp />}
              </StreamTitle>
            )}
            {data?.city && (
              <StreamLocation>
                <FaMapMarkerAlt />
                <span>
                  {data.city} {data.state}
                </span>
              </StreamLocation>
            )}
            <LoadingSpinner isVisible={isLoading || isStalled} />
          </SpaceBorder>
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

const SpaceBorder = styled.div.attrs(() => ({
  borderWidth: 2,
}))`
  display: flex;
  align-items: flex-start;
  position: fixed;
  left: ${({ pos }) => pos.x}px;
  top: ${({ pos }) => pos.y}px;
  width: ${({ pos }) => pos.width}px;
  height: ${({ pos }) => pos.height}px;
  box-sizing: border-box;
  pointer-events: none;
  user-select: none;
  background-color: ${({ isLoading }) =>
    isLoading ? 'rgba(0, 0, 0, .8)' : ''};
  transition:
    top 250ms ease,
    left 250ms ease,
    width 250ms ease,
    height 250ms ease,
    background-color 250ms ease;
`

const StreamTitle = styled.div`
  position: absolute;
  ${({ position }) => {
    if (position === 'top-left') {
      return `top: 0; left: 0;`
    } else if (position === 'top-right') {
      return `top: 0; right: 0;`
    } else if (position === 'bottom-right') {
      return `bottom: 0; right: 0;`
    } else if (position === 'bottom-left') {
      return `bottom: 0; left: 0;`
    }
  }}
  max-width: calc(100% - 10px);
  box-sizing: border-box;

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

const StreamLocation = styled.div`
  position: absolute;
  bottom: 0px;
  left: 0px;
  max-width: calc(100% - 18px);

  display: flex;
  align-items: center;
  gap: 3px;
  margin: 5px 9px;
  font-weight: 800;
  font-size: 14px;
  color: white;
  letter-spacing: -0.025em;
  opacity: 0.9;
  filter: drop-shadow(0 0 4px black);

  span {
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
  }

  svg {
    flex-shrink: 0;
  }
`

const LoadingSpinner = styled(TailSpin)<{ isVisible: boolean }>`
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 100px;
  height: 100px;
  opacity: ${({ isVisible }) => (isVisible ? 0.5 : 0)};

  transition:
    opacity 0.5s ease-in-out,
    visibility 0s ${({ isVisible }) => (isVisible ? '0s' : '0.5s')};
  visibility: ${({ isVisible }) => (isVisible ? 'visible' : 'hidden')};
`

const FilterCover = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  backdrop-filter: ${({ isBlurred, isDesaturated }) =>
    [isBlurred ? 'blur(30px)' : '', isDesaturated ? 'grayscale(75%)' : ''].join(
      ' ',
    )};
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
