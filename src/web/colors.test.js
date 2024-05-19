import { hashText, idColor } from './colors'
import Color from 'color'

describe('colors.js tests', () => {
  describe('hashText', () => {
    it('should return a number within the provided range', () => {
      const text = 'test'
      const range = 100
      const result = hashText(text, range)
      expect(typeof result).toBe('number')
      expect(result).toBeGreaterThanOrEqual(0)
      expect(result).toBeLessThan(range)
    })
  })

  describe('idColor', () => {
    it('should return a Color object', () => {
      const id = 'test'
      const result = idColor(id)
      expect(result).toBeInstanceOf(Color)
    })

    it('should return white color for empty id', () => {
      const id = ''
      const result = idColor(id)
      expect(result.hex()).toBe('#FFFFFF')
    })

    it('should generate the same color for the same id', () => {
      const id = 'test'
      const result1 = idColor(id)
      const result2 = idColor(id)
      expect(result1.hex()).toBe(result2.hex())
    })

    it('should generate different colors for different ids', () => {
      const id1 = 'test1'
      const id2 = 'test2'
      const result1 = idColor(id1)
      const result2 = idColor(id2)
      expect(result1.hex()).not.toBe(result2.hex())
    })
  })
})