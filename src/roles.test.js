import { roleCan } from './roles.js';

describe('roleCan', () => {
  it('should return true for admin role regardless of action', () => {
    expect(roleCan('admin', 'any-action')).toBe(true);
  });

  it('should return true for operator role and valid action', () => {
    expect(roleCan('operator', 'set-listening-view')).toBe(true);
  });

  it('should return false for operator role and invalid action', () => {
    expect(roleCan('operator', 'invalid-action')).toBe(false);
  });

  it('should return false for operator role and un-granted action', () => {
    expect(roleCan('operator', 'dev-tools')).toBe(false);
  });

  it('should return true for monitor role and valid action', () => {
    expect(roleCan('monitor', 'set-view-blurred')).toBe(true);
  });

  it('should return false for monitor role and invalid action', () => {
    expect(roleCan('monitor', 'invalid-action')).toBe(false);
  });

  it('should return false for monitor role and un-granted action', () => {
    expect(roleCan('monitor', 'set-listening-view')).toBe(false);
  });

  it('should return false for invalid role regardless of action', () => {
    expect(roleCan('invalid-role', 'any-action')).toBe(false);
  });

  it('should return false for invalid role and valid action', () => {
    expect(roleCan('invalid-role', 'set-listening-view')).toBe(false);
  });
});