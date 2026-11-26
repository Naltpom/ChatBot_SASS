// Réglages → Assistant IA (comme cm/src/pages/AssistantSettings.tsx, docs/CM_MCP.md §3 et §7) : accord IA
// facultatif, ce que l'assistant peut lire, permissions de chaque compte (modifiables par son possesseur,
// en lecture seule pour les invités), effacement des conversations. Retirer l'accord : un geste, effet immédiat.
import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import { eraseAiConversations, getAiStatus, PLATFORM_LABEL, putAiConsent, putAiPermissions, type AiAccount, type AiKind, type AiStatus } from '../lib/api'
import { openLink } from '../features/planning/media'
import { Check } from '../features/planning/ui'
import { Button, Card, Label, Loading, Msg, Screen, Txt } from '../ui/kit'
import { space, useTheme } from '../ui/theme'
import { showDialog } from '../ui/dialog'

const KINDS: { id: AiKind; label: string; hint: string }[] = [
  { id: 'stats', label: 'Statistiques', hint: 'Vues, j’aime, partages, enregistrements, abonnés.' },
  { id: 'planning', label: 'Planning et statuts', hint: 'Publications à venir, publiées, en échec.' },
  { id: 'captions', label: 'Titres et légendes', hint: 'Désactivé par défaut : ils peuvent contenir des noms de personnes.' },
]
const POLICY = 'https://cm.chapote.fr/politique-ia'

export default function AssistantSettings() {
  const { c } = useTheme()
  const [st, setSt] = useState<AiStatus | null>(null)
  const [off, setOff] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState('')

  useEffect(() => { getAiStatus().then(setSt).catch(e => ((e as { status?: number }).status === 404 ? setOff(true) : setErr((e as Error).message))) }, [])
  useEffect(() => { if (!done) return; const t = setTimeout(() => setDone(''), 2500); return () => clearTimeout(t) }, [done])

  const run = async (fn: () => Promise<AiStatus | void>, msg = 'Enregistré') => {
    setBusy(true); setErr('')
    try { const r = await fn(); if (r) setSt(r); if (msg) setDone(msg) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (off) return <Screen><Msg>L’assistant sur vos données n’est pas encore proposé.</Msg></Screen>
  if (!st) return <Screen>{err ? <Msg kind="err">{err}</Msg> : <Loading />}</Screen>

  const consent = st.consent
  const provider = st.provider || 'notre prestataire d’IA'
  const toggleExcluded = (a: AiAccount) => run(() => putAiConsent({
    excluded_accounts: a.excluded ? consent.excluded_accounts.filter(k => k !== a.key) : [...consent.excluded_accounts, a.key] }))
  const setPerm = (a: AiAccount, kind: AiKind, value: boolean) => {
    const cur = a.permissions || { stats: true, planning: true, captions: false }
    const [platform, id] = a.key.split(':')
    return run(() => putAiPermissions(platform as AiAccount['platform'], Number(id), { ...cur, [kind]: value }))
  }
  const erase = () => showDialog('Effacer vos conversations ?', 'Toutes vos conversations avec l’assistant seront supprimées. C’est définitif.', [
    { text: 'Annuler', style: 'cancel' },
    { text: 'Effacer', style: 'destructive', onPress: () => run(async () => { const r = await eraseAiConversations(); setDone(`${r.deleted} conversation(s) effacée(s)`) }, '') },
  ])

  return (
    <Screen>
      <Txt muted>
        L’assistant peut lire vos données Chapote CM pour répondre à vos questions, par exemple « fais-moi le bilan de mes vidéos de la semaine ».
        Il ne fait que lire. Ces données sont traitées par <Text style={{ fontWeight: '700', color: c.text }}>{provider}</Text>, notre fournisseur d’IA.
      </Txt>
      {err ? <Msg kind="err">{err}</Msg> : null}
      {done ? <Msg kind="ok">{done}</Msg> : null}
      {st.needs_review ? <Msg>La politique IA ou le prestataire a changé : relisez-la et réactivez l’assistant si vous êtes d’accord.</Msg> : null}

      <Card style={{ gap: space.sm }}>
        <Label>Mon accord</Label>
        {!st.old_enough ? <Txt small muted>L’assistant sur vos données est réservé aux personnes de 15 ans et plus.</Txt> : (
          <Check checked={st.active} disabled={busy} onChange={v => run(() => putAiConsent({ enabled: v, source: 'mobile' }))}
            label="Activer l’assistant IA sur mes données"
            hint="Facultatif. Refuser ou retirer votre accord ne change rien d’autre dans Chapote CM." />
        )}
        {st.active ? (
          <>
            <Txt small bold muted>Ce que l’assistant peut lire</Txt>
            {KINDS.map(k => (
              <Check key={k.id} checked={consent[k.id]} disabled={busy} onChange={v => run(() => putAiConsent({ [k.id]: v }))} label={k.label} hint={k.hint} />
            ))}
          </>
        ) : null}
        <Button small kind="ghost" icon="external" title="Lire la politique IA" onPress={() => openLink(POLICY)} style={{ alignSelf: 'flex-start' }} />
      </Card>

      <Card style={{ gap: space.sm }}>
        <Label>Comptes</Label>
        <Txt small muted>Pour chaque compte, son possesseur (l’administrateur de l’espace) décide de ce qui peut être envoyé à l’IA. Les personnes invitées voient ces réglages sans pouvoir les changer. Un compte jamais réglé n’envoie rien. L’IA ne voit que « Compte TikTok 1 », jamais vos pseudos.</Txt>
        {st.accounts.length === 0 ? <Txt small muted>Aucun compte connecté.</Txt> : null}
        {st.accounts.map(a => (
          <View key={a.key} style={{ gap: 4, paddingTop: space.sm, borderTopWidth: 1, borderColor: c.border }}>
            <Txt bold>{a.name || a.alias}</Txt>
            <Txt size={12} muted>{PLATFORM_LABEL[a.platform]} · vu par l’IA comme « {a.alias} »{a.owner ? ' · vous en êtes le possesseur' : ' · réglé par son possesseur'}</Txt>
            <Txt small muted>Peut être envoyé à l’IA :</Txt>
            {KINDS.map(k => (
              <Check key={k.id} checked={!!a.permissions?.[k.id]} disabled={!a.owner || busy} onChange={v => setPerm(a, k.id, v)} label={k.label} />
            ))}
            <Check checked={!a.excluded} disabled={!st.active || busy} onChange={() => toggleExcluded(a)} label="Inclure ce compte dans mes conversations" />
          </View>
        ))}
      </Card>

      <Card style={{ gap: space.sm }}>
        <Label>Mes conversations</Label>
        <Txt small muted>Les conversations sur vos données sont gardées 30 jours, puis supprimées.</Txt>
        <Button kind="danger" icon="trash" title="Effacer mes conversations avec l’assistant" disabled={busy} onPress={erase} />
      </Card>
    </Screen>
  )
}
