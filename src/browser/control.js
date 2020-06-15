import { ipcRenderer } from 'electron'
import range from 'lodash/range'
import { h, render } from 'preact'
import { useEffect, useState, useCallback } from 'preact/hooks'
import styled from 'styled-components'

import './index.css'
import SoundIcon from './static/volume-up-solid.svg'

function App() {
  const [streamData, setStreamData] = useState()
  const [spaceIdxMap, setSpaceIdxMap] = useState(new Map())
  const [listeningIdx, setListeningIdx] = useState()

  useEffect(() => {
    ipcRenderer.on('stream-data', (ev, data) => {
      setStreamData(data)
    })
  }, [])

  const handleSetSpace = useCallback(
    (idx, value) => {
      const newSpaceIdxMap = new Map(spaceIdxMap)
      if (value !== undefined) {
        newSpaceIdxMap.set(idx, value)
      } else {
        newSpaceIdxMap.delete(idx)
      }
      setSpaceIdxMap(newSpaceIdxMap)

      const newSpaceURLMap = new Map(
        Array.from(newSpaceIdxMap, ([spaceIdx, dataIdx]) => [
          spaceIdx,
          streamData[dataIdx].Link,
        ]),
      )
      ipcRenderer.send('set-videos', newSpaceURLMap)
    },
    [streamData, spaceIdxMap],
  )

  const handleSetListening = useCallback(
    (idx) => {
      const newIdx = idx === listeningIdx ? null : idx
      setListeningIdx(newIdx)
      ipcRenderer.send('set-sound-source', newIdx)
    },
    [listeningIdx],
  )

  return (
    <div>
      <h1>Stream Wall</h1>
      <div>
        {range(0, 3).map((y) => (
          <StyledGridLine>
            {range(0, 3).map((x) => {
              const idx = 3 * y + x
              return (
                <GridInput
                  idx={idx}
                  onChangeSpace={handleSetSpace}
                  spaceValue={spaceIdxMap.get(idx)}
                  isListening={idx === listeningIdx}
                  onSetListening={handleSetListening}
                />
              )
            })}
          </StyledGridLine>
        ))}
      </div>
      <div>
        {streamData
          ? streamData.map((row, idx) => <StreamLine idx={idx} row={row} />)
          : 'loading...'}
      </div>
    </div>
  )
}

function StreamLine({ idx, row: { Source, Title, Link, Notes } }) {
  return (
    <StyledStreamLine>
      <StyledIdx>{idx}</StyledIdx>
      <div>
        <strong>{Source}</strong> <a href={Link}>{Title || Link}</a> {Notes}
      </div>
    </StyledStreamLine>
  )
}

function GridInput({
  idx,
  onChangeSpace,
  spaceValue,
  isListening,
  onSetListening,
}) {
  const handleChange = useCallback(
    (ev) => {
      const { name, value } = ev.target
      const newValue = value ? Number(value) : NaN
      onChangeSpace(
        Number(name),
        Number.isFinite(newValue) ? newValue : undefined,
      )
    },
    [onChangeSpace],
  )
  const handleListeningClick = useCallback(() => onSetListening(idx), [
    idx,
    onSetListening,
  ])
  const handleClick = useCallback((ev) => {
    ev.target.select()
  })
  return (
    <StyledGridContainer>
      <ListeningButton
        isListening={isListening}
        onClick={handleListeningClick}
      />
      <StyledGridInput
        name={idx}
        value={spaceValue}
        onClick={handleClick}
        onChange={handleChange}
      />
    </StyledGridContainer>
  )
}

function ListeningButton(props) {
  return (
    <StyledListeningButton {...props}>
      <SoundIcon />
    </StyledListeningButton>
  )
}

const StyledGridLine = styled.div`
  display: flex;
`

const StyledListeningButton = styled.button`
  display: flex;
  align-items: center;
  border: 2px solid gray;
  border-color: ${({ isListening }) => (isListening ? 'red' : 'gray')};
  background: ${({ isListening }) => (isListening ? '#c77' : '#ccc')};
  border-radius: 5px;

  &:focus {
    outline: none;
    box-shadow: 0 0 10px orange inset;
  }

  svg {
    width: 20px;
    height: 20px;
  }
`

const StyledGridContainer = styled.div`
  position: relative;

  ${StyledListeningButton} {
    position: absolute;
    bottom: 5px;
    right: 5px;
  }
`

const StyledGridInput = styled.input`
  width: 150px;
  height: 50px;
  padding: 20px;
  border: 2px solid black;
  font-size: 20px;
  text-align: center;

  &:focus {
    outline: none;
    box-shadow: 0 0 5px orange inset;
  }
`

const StyledIdx = styled.div`
  flex-shrink: 0;
  margin-right: 5px;
  background: #333;
  color: white;
  padding: 3px;
  border-radius: 5px;
  width: 2em;
  text-align: center;
`

const StyledStreamLine = styled.div`
  display: flex;
  align-items: center;
  margin: 0.5em 0;
`

function main() {
  render(<App />, document.body)
}

main()
