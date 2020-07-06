import isEqual from 'lodash/isEqual'

export function boxesFromViewContentMap(width, height, viewContentMap) {
  const boxes = []
  const visited = new Set()

  function isPosContent(x, y, content) {
    const checkIdx = width * y + x
    return (
      !visited.has(checkIdx) && isEqual(viewContentMap.get(checkIdx), content)
    )
  }

  function findLargestBox(x, y) {
    const idx = width * y + x
    const spaces = [idx]
    const content = viewContentMap.get(idx)

    let maxY
    for (maxY = y + 1; maxY < height; maxY++) {
      if (!isPosContent(x, maxY, content)) {
        break
      }
      spaces.push(width * maxY + x)
    }

    let cx = x
    let cy = y
    scan: for (cx = x + 1; cx < width; cx++) {
      for (cy = y; cy < maxY; cy++) {
        if (!isPosContent(cx, cy, content)) {
          break scan
        }
      }
      for (let cy = y; cy < maxY; cy++) {
        spaces.push(width * cy + cx)
      }
    }
    const w = cx - x
    const h = maxY - y
    spaces.sort()
    return { content, x, y, w, h, spaces }
  }

  for (let y = 0; y < width; y++) {
    for (let x = 0; x < height; x++) {
      const idx = width * y + x
      if (visited.has(idx) || viewContentMap.get(idx) === undefined) {
        continue
      }

      const box = findLargestBox(x, y)
      boxes.push(box)
      for (const boxIdx of box.spaces) {
        visited.add(boxIdx)
      }
    }
  }

  return boxes
}

export function idxToCoords(gridCount, idx) {
  const x = idx % gridCount
  const y = Math.floor(idx / gridCount)
  return { x, y }
}

export function idxInBox(gridCount, start, end, idx) {
  let { x: startX, y: startY } = idxToCoords(gridCount, start)
  let { x: endX, y: endY } = idxToCoords(gridCount, end)
  const { x, y } = idxToCoords(gridCount, idx)
  const lowX = Math.min(startX, endX)
  const highX = Math.max(startX, endX)
  const lowY = Math.min(startY, endY)
  const highY = Math.max(startY, endY)
  const xInBox = x >= lowX && x <= highX
  const yInBox = y >= lowY && y <= highY
  return xInBox && yInBox
}
