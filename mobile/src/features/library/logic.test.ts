import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Recipe } from '../../lib/api'
import {
  accountSummary, addedFlash, assetBadge, emptyAssetsText, mediaUrl, mergeById, normalizeTime, proposalWhen,
  recipeSavedNote, recipeTargets, setMapping, sourceLine, streamPath, textSummary, usageText, whenSummary, editRecipe,
} from './logic.ts'

const recipe: Recipe = {
  version: 1,
  account: { from: 'source', level: 1, map: {} },
  when: { pattern: 'ymd_hm', default_time: '18:00', timezone: 'Europe/Paris' },
  title: { from: 'file' }, caption: { from: 'txt' }, cover: { from: 'none' },
}
const an = {
  accounts: [{ key: 'tiktok:1', name: 'Ghost TT' }, { key: 'youtube:2', name: 'Ghost YT' }, { key: 'instagram:3', name: 'Ghost IG' }],
  groups: [{ key: 'group:9', name: 'Ghost' }],
  patterns: { ymd_hm: '2026-11-24 18h30', ymd: '2026-11-24', dmy_hm: '24-11-2026 18h30', dmy: '24-11-2026', compact: '20261124', none: '' },
}

test('mediaUrl joins the API host, keeps absolute URLs, adds the space', () => {
  assert.equal(mediaUrl('https://cm.chapote.fr', '/api/cm/assets/3/stream'), 'https://cm.chapote.fr/api/cm/assets/3/stream')
  assert.equal(mediaUrl('https://cm.chapote.fr/', '/api/x', 7), 'https://cm.chapote.fr/api/x?org_id=7')
  assert.equal(mediaUrl('https://cm.chapote.fr', '/api/x?a=1', 7), 'https://cm.chapote.fr/api/x?a=1&org_id=7')
  assert.equal(mediaUrl('https://cm.chapote.fr', 'https://cdn.example/x.jpg'), 'https://cdn.example/x.jpg')
  assert.equal(mediaUrl('https://cm.chapote.fr', null), null)
  assert.equal(streamPath({ id: 5 }), '/api/cm/assets/5/stream')
  assert.equal(streamPath({ id: 5, stream: '/s/5' }), '/s/5')
})

test('assetBadge follows the web priority', () => {
  assert.deepEqual(assetBadge({ published: 1, scheduled: 2, kind: null }), { label: 'Publiée', fresh: false })
  assert.equal(assetBadge({ published: 0, scheduled: 0, kind: 'routine' }).label, 'Programmée')
  assert.equal(assetBadge({ published: 0, scheduled: 0, kind: 'reserve' }).label, 'Réserve')
  assert.equal(assetBadge({ published: 0, scheduled: 0, kind: 'waiting' }).label, 'En attente')
  assert.deepEqual(assetBadge({ published: 0, scheduled: 0, kind: null }), { label: 'Nouvelle', fresh: true })
})

test('sourceLine and addedFlash', () => {
  assert.equal(sourceLine({ videos: 1, new: 0, role: 'reader', can_upload: null }), '1 vidéo · Lecteur')
  assert.equal(sourceLine({ videos: 4, new: 2, role: 'writer', can_upload: false }), '4 vidéos · 2 à publier · Éditeur · dépôt de fichiers refusé par Google')
  assert.equal(addedFlash({ name: 'Rushs', videos: 3, last_error: null }).text, 'Dossier « Rushs » relié : 3 vidéos trouvées.')
  assert.equal(addedFlash({ name: 'Rushs', videos: 0, last_error: null, scan: { ok: false, error: 'refus' } }).kind, 'err')
})

test('texts', () => {
  assert.equal(emptyAssetsText('chat', 'new'), 'Aucune vidéo ne correspond à « chat ».')
  assert.equal(emptyAssetsText('', 'new'), 'Toutes les vidéos ont déjà été programmées.')
  assert.equal(usageText({ published: 0, scheduled: 0, last_published_at: null }, x => x), 'Jamais publiée')
  assert.equal(usageText({ published: 2, scheduled: 1, last_published_at: 'J' }, x => `<${x}>`), 'Publiée 2 fois, dernière le <J> · 1 à venir')
  assert.deepEqual(proposalWhen({ scheduled_at: null, when_from: null }, x => x), { text: 'Heure à choisir', warn: true })
  assert.equal(proposalWhen({ scheduled_at: 'T', when_from: 'date' }, x => x).text, 'T (heure par défaut)')
  assert.equal(recipeSavedNote(true, 3), 'C’est activé : 3 publications à valider.')
  assert.equal(recipeSavedNote(true, 0), 'C’est activé.')
  assert.equal(recipeSavedNote(false, 0), 'Préparation automatique désactivée.')
})

test('mergeById appends without duplicates', () => {
  assert.deepEqual(mergeById([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }]).map(x => x.id), [1, 2, 3])
})

test('recipe summaries and edits never mutate the original', () => {
  assert.equal(recipeTargets(an)[0].name, 'Groupe Ghost')
  assert.equal(accountSummary(recipe, an), 'Toujours : les comptes proposés par défaut pour ce dossier')
  const one = setMapping(recipe, '*', 'group:9')
  assert.equal(accountSummary(one, an), 'Toujours : Groupe Ghost')
  assert.deepEqual(recipe.account.map, {})
  let byFolder = editRecipe(recipe, r => { r.account.from = 'folder' })
  assert.equal(accountSummary(byFolder, an), 'Selon le dossier : à associer')
  byFolder = editRecipe(byFolder, r => { r.account.map.Ghost = ['tiktok:1', 'youtube:2', 'instagram:3'] })
  assert.equal(accountSummary(byFolder, an), 'Selon le dossier : Ghost → Ghost TT, Ghost YT +1')
  assert.deepEqual(setMapping(byFolder, 'Ghost', '').account.map, {})
  assert.equal(whenSummary(recipe, an), 'La date écrite dans le nom (comme « 2026-11-24 18h30 »). Sans heure : 18:00.')
  assert.equal(whenSummary(editRecipe(recipe, r => { r.when.pattern = 'none' }), an), 'Je choisis l’heure en validant.')
  assert.equal(textSummary(recipe), 'Titre : le nom du fichier. Légende : le .txt. Couverture : aucune.')
})

test('normalizeTime', () => {
  assert.equal(normalizeTime('9:5'), '09:05')
  assert.equal(normalizeTime('18h'), '18:00')
  assert.equal(normalizeTime('18h30'), '18:30')
  assert.equal(normalizeTime('24:00'), null)
  assert.equal(normalizeTime('abc'), null)
})
