import { test } from 'node:test'
import assert from 'node:assert/strict'
import { partPlan, progressPct } from './upload-logic.ts'

test('parts cover the whole file, last one shorter', () => {
  const plan = partPlan(10, 4)
  assert.deepEqual(plan, [{ index: 0, start: 0, length: 4 }, { index: 1, start: 4, length: 4 }, { index: 2, start: 8, length: 2 }])
  assert.equal(partPlan(8, 4).length, 2)
  assert.deepEqual(partPlan(0, 4), [])
  assert.deepEqual(partPlan(5, 0), [])
})

test('progress', () => {
  assert.equal(progressPct(0, 0), 0)
  assert.equal(progressPct(999, 1000), 99)
  assert.equal(progressPct(1000, 1000), 100)
})
