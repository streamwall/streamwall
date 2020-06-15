export function boxesFromSpaceURLMap(width, height, stateURLMap) {
  const boxes = []
  const visited = new Set()

  function findLargestBox(x, y) {
    const idx = width * y + x
    const spaces = [idx]
    const url = stateURLMap.get(idx)

    let maxY
    for (maxY = y + 1; maxY < height; maxY++) {
      const checkIdx = width * maxY + x
      if (visited.has(checkIdx) || stateURLMap.get(checkIdx) !== url) {
        break
      }
      spaces.push(width * maxY + x)
    }

    let cx = x
    let cy = y
    scan: for (cx = x + 1; cx < width; cx++) {
      for (cy = y; cy < maxY; cy++) {
        const checkIdx = width * cy + cx
        if (visited.has(checkIdx) || stateURLMap.get(checkIdx) !== url) {
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
    return { url, x, y, w, h, spaces }
  }

  for (let y = 0; y < width; y++) {
    for (let x = 0; x < height; x++) {
      const idx = width * y + x
      if (visited.has(idx) || stateURLMap.get(idx) === undefined) {
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
