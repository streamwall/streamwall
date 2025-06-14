import * as jsondiffpatch from 'jsondiffpatch'

export const stateDiff = jsondiffpatch.create({
  objectHash: (obj: any, idx) => obj._id || `$$index:${idx}`,
  omitRemovedValues: true,
})
