import Color from 'color'

export function hashText(text, range) {
  // DJBX33A-ish
  // based on https://github.com/euphoria-io/heim/blob/978c921063e6b06012fc8d16d9fbf1b3a0be1191/client/lib/hueHash.js#L16-L45
  let val = 0
  for (let i = 0; i < text.length; i++) {
    // Multiply by an arbitrary prime number to spread out similar letters.
    const charVal = (text.charCodeAt(i) * 401) % range

    // Multiply val by 33 while constraining within signed 32 bit int range.
    // this keeps the value within Number.MAX_SAFE_INTEGER without throwing out
    // information.
    const origVal = val
    val = val << 5
    val += origVal

    // Add the character to the hash.
    val += charVal
  }

  return (val + range) % range
}

export function idColor(id) {
  if (!id) {
    return Color('white')
  }
  const h = hashText(id, 360)
  const sPart = hashText(id, 40)
  return Color({ h, s: 20 + sPart, l: 50 })
}
