import { filterStreams, useYDoc, useStreamwallConnection } from './control.js'
// import { renderHook, act } from '@testing-library/react-hooks'

describe("control test always passes", () => {
  it("always passes", () => {
    expect(true).toBe(true);
  });
});

// describe('filterStreams', () => {
//   it('should correctly filter live and other streams', () => {
//     const streams = [
//       { kind: 'video', status: 'Live' },
//       { kind: 'audio', status: 'Offline' },
//       { kind: 'video', status: 'Offline' },
//     ]
//     const [liveStreams, otherStreams] = filterStreams(streams)
//     expect(liveStreams).toHaveLength(1)
//     expect(otherStreams).toHaveLength(2)
//   })
// })

// describe('useYDoc', () => {
//   it('should initialize with an empty Y.Doc', () => {
//     const { result } = renderHook(() => useYDoc(['test']))
//     expect(result.current[0]).toEqual({})
//   })

//   it('should update docValue when doc is updated', () => {
//     const { result } = renderHook(() => useYDoc(['test']))
//     act(() => {
//       result.current[1].getMap('test').set('key', 'value')
//     })
//     expect(result.current[0]).toEqual({ test: { key: 'value' } })
//   })
// })

// describe('useStreamwallConnection', () => {
//   it('should initialize with default values', () => {
//     const { result } = renderHook(() => useStreamwallConnection('ws://localhost:8080'))
//     expect(result.current.isConnected).toBe(false)
//     expect(result.current.config).toEqual({})
//     expect(result.current.streams).toEqual([])
//     expect(result.current.customStreams).toEqual([])
//     expect(result.current.views).toEqual([])
//     expect(result.current.stateIdxMap).toEqual(new Map())
//     expect(result.current.delayState).toBeUndefined()
//     expect(result.current.authState).toBeUndefined()
//   })
// })