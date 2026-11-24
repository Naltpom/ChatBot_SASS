import { test } from 'node:test'
import assert from 'node:assert/strict'
import { baseFor } from './route-logic.ts'

const CM = 'https://cm.chapote.fr', MAIN = 'https://chapote.fr'
test('routes de connexion autorisées sur cm.chapote.fr, le reste de /api/auth et /api/orgs sur chapote.fr', () => {
  for (const p of ['/api/auth/login', '/api/auth/google', '/api/auth/me', '/api/auth/logout', '/api/auth/password/forgot', '/api/auth/2fa/login/totp'])
    assert.equal(baseFor(p, CM, MAIN), CM, p)
  for (const p of ['/api/auth/2fa/status', '/api/auth/2fa/totp/setup', '/api/auth/password', '/api/auth/password/reset', '/api/orgs/12/leave', '/api/auth/me/extra'])
    assert.equal(baseFor(p, CM, MAIN), MAIN, p)
  assert.equal(baseFor('/api/cm/spaces', CM, MAIN), CM)
  assert.equal(baseFor('/api/cm/mobile/refresh', CM, MAIN), CM)
})
