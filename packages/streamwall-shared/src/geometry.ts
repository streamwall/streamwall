import type { Rectangle } from 'electron'
import { isEqual } from 'lodash-es'
import type { ContentKind } from './types.ts'

export interface ViewPos extends Rectangle {
  /**
   * Grid space indexes inhabited by the view.
   */
  spaces: number[]
}

export interface ViewContent {
  url: string
  kind: ContentKind
}
export type ViewContentMap = Map<string, ViewContent>

export function boxesFromViewContentMap(
  cols: number,
  rows: number,
  viewContentMap: ViewContentMap,
) {
  const boxes = []
  const visited = new Set()

  function isPosContent(
    x: number,
    y: number,
    content: ViewContent | undefined,
  ) {
    const checkIdx = cols * y + x
    return (
      !visited.has(checkIdx) &&
      isEqual(viewContentMap.get(String(checkIdx)), content)
    )
  }

  function findLargestBox(x: number, y: number) {
    const idx = cols * y + x
    const spaces = [idx]
    const content = viewContentMap.get(String(idx))

    let maxY
    for (maxY = y + 1; maxY < rows; maxY++) {
      if (!isPosContent(x, maxY, content)) {
        break
      }
      spaces.push(cols * maxY + x)
    }

    let cx = x
    let cy = y
    scan: for (cx = x + 1; cx < cols; cx++) {
      for (cy = y; cy < maxY; cy++) {
        if (!isPosContent(cx, cy, content)) {
          break scan
        }
      }
      for (let cy = y; cy < maxY; cy++) {
        spaces.push(cols * cy + cx)
      }
    }
    const w = cx - x
    const h = maxY - y
    spaces.sort()
    return { content, x, y, w, h, spaces }
  }

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = cols * y + x
      if (visited.has(idx) || viewContentMap.get(String(idx)) === undefined) {
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

export function idxToCoords(cols: number, idx: number) {
  const x = idx % cols
  const y = Math.floor(idx / cols)
  return { x, y }
}

export function idxInBox(
  cols: number,
  start: number,
  end: number,
  idx: number,
) {
  const { x: startX, y: startY } = idxToCoords(cols, start)
  const { x: endX, y: endY } = idxToCoords(cols, end)
  const { x, y } = idxToCoords(cols, idx)
  const lowX = Math.min(startX, endX)
  const highX = Math.max(startX, endX)
  const lowY = Math.min(startY, endY)
  const highY = Math.max(startY, endY)
  const xInBox = x >= lowX && x <= highX
  const yInBox = y >= lowY && y <= highY
  return xInBox && yInBox
}
