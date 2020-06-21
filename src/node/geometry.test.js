import { boxesFromViewURLMap } from './geometry'

function example([text]) {
  return text
    .replace(/\s/g, '')
    .split('')
    .map((c) => (c === '.' ? undefined : c))
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
      { url: 'a', x: 0, y: 0, w: 1, h: 2, spaces: [0, 2] },
      { url: 'b', x: 1, y: 0, w: 1, h: 2, spaces: [1, 3] },
    ],
  ],
  [
    2,
    2,
    box2,
    [
      { url: 'a', x: 0, y: 0, w: 2, h: 1, spaces: [0, 1] },
      { url: 'b', x: 0, y: 1, w: 2, h: 1, spaces: [2, 3] },
    ],
  ],
  [
    3,
    3,
    box3,
    [
      { url: 'a', x: 0, y: 0, w: 2, h: 2, spaces: [0, 1, 3, 4] },
      { url: 'c', x: 2, y: 0, w: 1, h: 1, spaces: [2] },
      { url: 'a', x: 2, y: 1, w: 1, h: 1, spaces: [5] },
      { url: 'd', x: 0, y: 2, w: 1, h: 1, spaces: [6] },
      { url: 'a', x: 1, y: 2, w: 1, h: 1, spaces: [7] },
      { url: 'e', x: 2, y: 2, w: 1, h: 1, spaces: [8] },
    ],
  ],
  [3, 3, box4, [{ url: 'a', x: 1, y: 1, w: 2, h: 2, spaces: [4, 5, 7, 8] }]],
  [
    3,
    3,
    box5,
    [
      { url: 'a', x: 2, y: 0, w: 1, h: 3, spaces: [2, 5, 8] },
      { url: 'a', x: 1, y: 2, w: 1, h: 1, spaces: [7] },
    ],
  ],
])('boxesFromViewURLMap(%i, %i, %j)', (width, height, data, expected) => {
  test(`returns expected ${expected.length} boxes`, () => {
    const stateURLMap = new Map(data.map((v, idx) => [idx, v]))
    const result = boxesFromViewURLMap(width, height, stateURLMap)
    expect(result).toStrictEqual(expected)
  })
})
