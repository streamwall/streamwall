const operatorActions = new Set([
  'set-listening-view',
  'set-view-background-listening',
  'set-view-blurred',
  'set-custom-streams',
  'reload-view',
  'set-stream-censored',
  'set-stream-running',
  'mutate-state-doc',
])

const monitorActions = new Set(['set-view-blurred', 'set-stream-censored'])

export const validRoles = new Set(['admin', 'operator', 'monitor'])

export function roleCan(role, action) {
  if (role === 'admin') {
    return true
  }

  if (role === 'operator' && operatorActions.has(action)) {
    return true
  }

  if (role === 'monitor' && monitorActions.has(action)) {
    return true
  }

  return false
}
