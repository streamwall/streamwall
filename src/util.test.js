import { ensureValidURL } from './util'

describe('ensureValidURL', () => {
  it('should not throw an error for valid http and https URLs', () => {
    expect(() => ensureValidURL('http://example.com')).not.toThrow()
    expect(() => ensureValidURL('https://example.com')).not.toThrow()
  })

  it('should throw an error for non-http and non-https URLs', () => {
    expect(() => ensureValidURL('ftp://example.com')).toThrow()
    expect(() => ensureValidURL('file://example.com')).toThrow()
  })

  it('should throw an error for invalid URLs', () => {
    expect(() => ensureValidURL('invalid')).toThrow()
  })
})