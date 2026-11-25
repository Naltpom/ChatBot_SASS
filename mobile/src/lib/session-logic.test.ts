import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { base64url, errorMessage, isChallenge, parseReturn, sessionIsFresh } from './session-logic.ts'

test('base64url matches Node for every padding length', () => {
  for (let n = 0; n < 70; n++) {
    const bytes = new Uint8Array(Array.from({ length: n }, (_, i) => (i * 37 + n) % 256))
    assert.equal(base64url(bytes), Buffer.from(bytes).toString('base64url'))
  }
})

test('PKCE challenge is base64url(sha256(verifier)) on 43 chars', () => {
  const verifier = base64url(new Uint8Array(48).fill(7))
  const challenge = base64url(new Uint8Array(createHash('sha256').update(verifier).digest()))
  assert.equal(challenge.length, 43)
  assert.match(challenge, /^[A-Za-z0-9_-]{43}$/)
})

test('session is refreshed one minute before it ends', () => {
  assert.equal(sessionIsFresh(1_000_000, 1_000_000 - 120_000), true)
  assert.equal(sessionIsFresh(1_000_000, 1_000_000 - 30_000), false)
})

test('error messages from the API', () => {
  assert.equal(errorMessage(404, { detail: 'Compte introuvable' }).message, 'Compte introuvable')
  const taken = errorMessage(409, { detail: { message: 'Déjà connecté', code: 'account_taken' } })
  assert.equal(taken.message, 'Déjà connecté')
  assert.equal(taken.data?.code, 'account_taken')
  assert.equal(errorMessage(422, { detail: [{ msg: 'trop long' }] }).message, 'Champ invalide : trop long')
  assert.equal(errorMessage(502, null).message, 'Le serveur ne répond pas : réessayez dans un moment.')
  assert.equal(errorMessage(429, 'x').message, 'Trop de tentatives : réessayez dans un moment.')
})

test('return link parsing', () => {
  assert.deepEqual(parseReturn('chapotecm://auth?code=a.b.c&state=xy%2Bz'), { code: 'a.b.c', state: 'xy+z' })
  assert.deepEqual(parseReturn('exp://192.168.1.2:8081/--/auth?state=s&code=k#frag'), { code: 'k', state: 's' })
  assert.deepEqual(parseReturn('chapotecm://auth'), { code: null, state: null })
})

test('2FA challenge vs signed-in user (twofa_required: false)', () => {
  assert.equal(isChallenge({ id: 1, email: 'a@t.dev', twofa_required: false }), false)
  assert.equal(isChallenge({ twofa_required: true, challenge: 'c', methods: { totp: true, passkey: false, recovery: true } }), true)
  assert.equal(isChallenge(null), false)
})
