import { Auth } from './auth'

describe('Auth', () => {
  it('uses provided salt from persistData', () => {
    const auth = new Auth({
      adminUsername: 'admin',
      adminPassword: 'pass',
      persistData: { salt: 'MY_FIXED_SALT' }
    })
    expect(auth.salt).toBe('MY_FIXED_SALT')
  })

  it('throws on invalid role', async () => {
    const auth = new Auth({ adminUsername: 'admin', adminPassword: 'pass' })
    await expect(
      auth.createToken({ kind: 'session', role: 'notreal', name: 'Test' })
    ).rejects.toThrow('invalid role')
  })

  it('logs when logEnabled is true', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const auth = new Auth({
      adminUsername: 'admin',
      adminPassword: 'pass',
      logEnabled: true
    })
    await auth.createToken({ kind: 'session', role: 'operator', name: 'Test' })
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Created session token:'),
      expect.objectContaining({ role: 'operator', name: 'Test' })
    )
    consoleSpy.mockRestore()
  })

  it('silently ignores deleting a non-existent token', () => {
    const auth = new Auth({ adminUsername: 'admin', adminPassword: 'pass' })
    expect(() => auth.deleteToken('nope')).not.toThrow()
  })
})
