import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Account, Group, Space } from '../../lib/api'
import {
  accountState, adminSpaceChoices, claimToken, connectEnabled, filterAccounts, followersSum, groupBody, groupMembers, groupsOf,
  isEmail, orgFromKey, parseKey, personLine, scopeText, shareDoneText, toggleIn, transferBody, transferChoices, transferDoneText,
} from './logic.ts'

const acc = (platform: Account['platform'], id: number, name: string, followers = 0, extra: Partial<Account> = {}): Account => ({
  platform, id, name, avatar_url: null, needs_reconnect: false, can_publish: true, stats_available: true, connected_at: null, mode: 'api',
  stats: { followers, views: null, likes: null, videos: null, updated_at: null, error: null }, ...extra,
})
const accounts = [acc('tiktok', 1, 'Ghost Hands', 100), acc('youtube', 2, 'Élodie', 50), acc('instagram', 3, 'piano.fr', 0, { username: 'piano.fr' })]
const group: Group = { id: 9, name: 'Ghost', color: 'blue', accounts: [{ platform: 'tiktok', id: 1 }, { platform: 'youtube', id: 2 }, { platform: 'tiktok', id: 99 }] }
const spaces: Space[] = [
  { org_id: null, name: 'Espace perso', role: null },
  { org_id: 4, name: 'Studio', role: 'member', cm_role: 'admin' },
  { org_id: 5, name: 'Client', role: 'member', cm_role: 'editor' },
]

test('account state priority', () => {
  assert.equal(accountState({ needs_reconnect: true, mode: 'routine', stats: null }).label, 'À reconnecter')
  assert.equal(accountState({ needs_reconnect: false, mode: 'routine', stats: null }).tone, 'muted')
  assert.equal(accountState({ needs_reconnect: false, mode: 'api', stats: { error: 'x' } as Account['stats'] }).label, 'Relevé en échec')
  assert.equal(accountState({ needs_reconnect: false, mode: 'api', stats: null }).tone, 'ok')
})

test('groups', () => {
  assert.deepEqual(groupMembers(group, accounts).map(a => a.id), [1, 2])
  assert.equal(followersSum(groupMembers(group, accounts)), 150)
  assert.deepEqual(groupsOf([group], accounts[2]), [])
  assert.deepEqual(groupBody('  Ghost ', 'red', ['tiktok:1', 'youtube:2']),
    { name: 'Ghost', color: 'red', accounts: [{ platform: 'tiktok', account_id: 1 }, { platform: 'youtube', account_id: 2 }] })
  assert.deepEqual(parseKey('instagram:3'), { platform: 'instagram', account_id: 3 })
  assert.deepEqual(toggleIn([1, 2], 2), [1])
  assert.deepEqual(toggleIn([1], 2), [1, 2])
})

test('filterAccounts ignores case and accents', () => {
  assert.deepEqual(filterAccounts(accounts, 'elo').map(a => a.id), [2])
  assert.deepEqual(filterAccounts(accounts, 'PIANO').map(a => a.id), [3])
  assert.deepEqual(filterAccounts(accounts, 'youtube').map(a => a.id), [2])
  assert.equal(filterAccounts(accounts, ' ').length, 3)
})

test('connectEnabled', () => {
  const cfg = { tiktok: true, youtube: false, instagram_api: true }
  assert.equal(connectEnabled(cfg, 'tiktok'), true)
  assert.equal(connectEnabled(cfg, 'youtube'), false)
  assert.equal(connectEnabled(null, 'instagram'), false)
})

test('transfers', () => {
  assert.deepEqual(transferChoices(spaces, 4), [['perso', 'Espace perso'], ['email', 'Une autre personne']])
  assert.deepEqual(transferChoices(spaces, null), [['4', 'Studio'], ['email', 'Une autre personne']])
  assert.deepEqual(transferBody('email', ' a@b.fr '), { to_email: 'a@b.fr' })
  assert.deepEqual(transferBody('perso', ''), { to_perso: true })
  assert.deepEqual(transferBody('4', ''), { to_org_id: 4 })
  assert.equal(transferDoneText({ pending: true }, 'X', undefined), 'Transfert proposé.')
  assert.equal(transferDoneText({ moved_targets: 2 }, 'Ghost', 'Studio'), 'Ghost est maintenant dans « Studio », avec 2 publications à venir.')
  assert.deepEqual(adminSpaceChoices(spaces).map(x => x[0]), ['perso', '4'])
  assert.equal(orgFromKey('perso'), null)
  assert.equal(orgFromKey('4'), 4)
})

test('claimToken reads the account_taken error', () => {
  assert.equal(claimToken({ data: { code: 'account_taken', claim_token: 'tok' } }), 'tok')
  assert.equal(claimToken({ data: { code: 'other' } }), null)
  assert.equal(claimToken(new Error('x')), null)
  assert.equal(claimToken(null), null)
})

test('people texts', () => {
  const gName = (id: number) => (id === 9 ? 'Ghost' : undefined)
  const aName = (k: string) => (k === 'tiktok:1' ? 'Ghost Hands' : undefined)
  assert.equal(scopeText({ role: 'admin', scope: { all: false, groups: [], accounts: [] } }, gName, aName), 'Tous les comptes')
  assert.equal(scopeText({ role: 'editor', scope: { all: false, groups: [9], accounts: ['tiktok:1', 'x:2'] } }, gName, aName), 'Ghost, Ghost Hands')
  assert.equal(scopeText({ role: 'viewer', scope: { all: false, groups: [], accounts: [] } }, gName, aName), 'Aucun compte')
  assert.equal(personLine({ pending: true, owner: false, role: 'editor', scope: { all: true, groups: [], accounts: [] } }, 'Tous'), 'Invitation envoyée · Tous')
  assert.equal(shareDoneText({ invited: true }, 'a@b.fr', 'X'), 'Invitation envoyée à a@b.fr : l’accès s’ouvrira à son inscription.')
  assert.equal(shareDoneText({}, 'a@b.fr', 'tout l’espace'), 'a@b.fr a maintenant accès à tout l’espace.')
  assert.equal(isEmail('a@b.fr'), true)
  assert.equal(isEmail('a@b'), false)
})
