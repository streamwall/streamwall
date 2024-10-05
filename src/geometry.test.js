import { boxesFromViewContentMap, idxInBox, idxToCoords } from './geometry'

function example([text]) {
  return text
    .replace(/\s/g, '')
    .split('')
    .map((c) => (c === '.' ? undefined : { url: c }))
}

const box1 = example`
  ab
  ab
`

const box2 = example`
  aa
  bb
`

const box3 = example`
  aac
  aaa
  dae
`

const box4 = example`
  ...
  .aa
  .aa
`

const box5 = example`
  ..a
  ..a
  .aa
`

describe.each([
  [
    2,
    2,
    box1,
    [
      { content: { url: 'a' }, x: 0, y: 0, w: 1, h: 2, spaces: [0, 2] },
      { content: { url: 'b' }, x: 1, y: 0, w: 1, h: 2, spaces: [1, 3] },
    ],
  ],
  [
    2,
    2,
    box2,
    [
      { content: { url: 'a' }, x: 0, y: 0, w: 2, h: 1, spaces: [0, 1] },
      { content: { url: 'b' }, x: 0, y: 1, w: 2, h: 1, spaces: [2, 3] },
    ],
  ],
  [
    3,
    3,
    box3,
    [
      { content: { url: 'a' }, x: 0, y: 0, w: 2, h: 2, spaces: [0, 1, 3, 4] },
      { content: { url: 'c' }, x: 2, y: 0, w: 1, h: 1, spaces: [2] },
      { content: { url: 'a' }, x: 2, y: 1, w: 1, h: 1, spaces: [5] },
      { content: { url: 'd' }, x: 0, y: 2, w: 1, h: 1, spaces: [6] },
      { content: { url: 'a' }, x: 1, y: 2, w: 1, h: 1, spaces: [7] },
      { content: { url: 'e' }, x: 2, y: 2, w: 1, h: 1, spaces: [8] },
    ],
  ],
  [
    3,
    3,
    box4,
    [{ content: { url: 'a' }, x: 1, y: 1, w: 2, h: 2, spaces: [4, 5, 7, 8] }],
  ],
  [
    3,
    3,
    box5,
    [
      { content: { url: 'a' }, x: 2, y: 0, w: 1, h: 3, spaces: [2, 5, 8] },
      { content: { url: 'a' }, x: 1, y: 2, w: 1, h: 1, spaces: [7] },
    ],
  ],
])('boxesFromViewContentMap(%i, %i, %j)', (width, height, data, expected) => {
  test(`returns expected ${expected.length} boxes`, () => {
    const stateURLMap = new Map(data.map((v, idx) => [idx, v]))
    const result = boxesFromViewContentMap(width, height, stateURLMap)
    expect(result).toStrictEqual(expected)
  })
})

describe.each([
  [
    'a middle index',
    5,
    12,
    { x: 2, y: 2 },
  ],
  [
    'the top-left corner',
    5,
    0,
    { x: 0, y: 0 },
  ],
  [
    'the top-right corner',
    5,
    4,
    { x: 4, y: 0 },
  ],
  [
    'the bottom-left corner',
    5,
    20,
    { x: 0, y: 4 },
  ],
  [
    'the bottom-right corner',
    5,
    24,
    { x: 4, y: 4 },
  ],

])('idxToCoords', (humanized_location, gridCount, idx, coords) => {
  test(`should support ${humanized_location}`, () => {
    const result = idxToCoords(gridCount, idx)
    expect(result).toEqual(coords)
  })
})

describe('idxInBox', () => {
  it('should return true if index is within the box', () => {
    const gridCount = 5
    const start = 0
    const end = 24
    const idx = 12
    const result = idxInBox(gridCount, start, end, idx)
    expect(result).toBe(true)
  })

  it('should return false if index is outside the box', () => {
    const gridCount = 5
    const start = 0
    const end = 24
    const idx = 25
    const result = idxInBox(gridCount, start, end, idx)
    expect(result).toBe(false)
  })
})