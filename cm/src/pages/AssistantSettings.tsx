// Réglages → Assistant IA (docs/CM_MCP.md, §3) : accord IA de l'utilisateur, ce qu'il autorise, et le
// tableau de permissions de chaque compte (modifiable par son possesseur, en lecture seule pour les
// personnes invitées). Retirer l'accord se fait en un geste et prend effet tout de suite.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  eraseAiConversations, getAiStatus, PLATFORM_LABEL, putAiConsent, putAiPermissions,
  type AiAccount, type AiKind, type AiStatus,
} from '../api'
import { Icon, Msg } from '../components/ui'

const KINDS: { id: AiKind; label: string; hint: string }[] = [
  { id: 'stats', label: 'Statistiques', hint: 'Vues, j’aime, partages, enregistrements, abonnés.' },
  { id: 'planning', label: 'Planning et statuts', hint: 'Publications à venir, publiées, en échec.' },
  { id: 'captions', label: 'Titres et légendes', hint: 'Désactivé par défaut : ils peuvent contenir des noms de personnes.' },
]

export default function AssistantSettings() {
  const [st, setSt] = useState<AiStatus | null>(null)
  const [off, setOff] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState('')

  useEffect(() => { getAiStatus().then(setSt).catch(e => (e.status === 404 ? setOff(true) : setErr(e.message))) }, [])
  useEffect(() => { if (!done) return; const t = setTimeout(() => setDone(''), 2000); return () => clearTimeout(t) }, [done])

  const run = async (fn: () => Promise<AiStatus | void>, msg = 'Enregistré') => {
    setBusy(true); setErr('')
    try { const r = await fn(); if (r) setSt(r); setDone(msg) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (off) return <div className="col"><h1>Assistant IA</h1><Msg kind="info">L’assistant sur vos données n’est pas encore proposé.</Msg></div>
  if (!st) return <div className="col" aria-busy="true"><h1>Assistant IA</h1>{err && <Msg kind="err">{err}</Msg>}</div>

  const c = st.consent
  const provider = st.provider || 'notre prestataire d’IA'
  const toggleExcluded = (a: AiAccount) => run(() => putAiConsent({
    excluded_accounts: a.excluded ? c.excluded_accounts.filter(k => k !== a.key) : [...c.excluded_accounts, a.key] }))
  const setPerm = (a: AiAccount, kind: AiKind, value: boolean) => {
    const cur = a.permissions || { stats: true, planning: true, captions: false }
    const [platform, id] = a.key.split(':')
    return run(() => putAiPermissions(platform as AiAccount['platform'], Number(id), { ...cur, [kind]: value }))
  }
  const erase = () => {
    if (!window.confirm('Effacer toutes vos conversations avec l’assistant ? C’est définitif.')) return
    run(async () => { const r = await eraseAiConversations(); setDone(`${r.deleted} conversation(s) effacée(s)`) }, '')
  }

  return (
    <div className="settings col">
      <div className="page-head"><div>
        <p className="small"><Link to="/reglages">← Réglages</Link></p>
        <h1>Assistant IA</h1>
        <p>L’assistant peut lire vos données Chapote CM pour répondre à vos questions, par exemple « fais-moi le bilan de mes
          vidéos de la semaine ». Il ne fait que lire. Ces données sont traitées par <b>{provider}</b>, notre fournisseur d’IA.</p>
      </div></div>
      {err && <Msg kind="err">{err}</Msg>}
      {st.needs_review && <Msg kind="info">La politique IA ou le prestataire a changé : relisez-la et réactivez l’assistant si vous êtes d’accord.</Msg>}

      <section className="card col set-card" aria-labelledby="t-ai">
        <h2 id="t-ai">Mon accord</h2>
        {!st.old_enough
          ? <p className="small muted" style={{ margin: 0 }}>L’assistant sur vos données est réservé aux personnes de 15 ans et plus.</p>
          : <label className="check">
              <input type="checkbox" checked={st.active} disabled={busy}
                     onChange={e => run(() => putAiConsent({ enabled: e.target.checked, source: 'profil' }))} />
              <span><b>Activer l’assistant IA sur mes données</b><br />
                <span className="small muted">Facultatif. Refuser ou retirer votre accord ne change rien d’autre dans Chapote CM.
                  {' '}<Link to="/politique-ia">Politique IA</Link></span></span>
            </label>}
        {st.active && <>
          <div className="small strong muted" style={{ marginTop: 8 }}>Ce que l’assistant peut lire</div>
          {KINDS.map(k => (
            <label key={k.id} className="check">
              <input type="checkbox" checked={c[k.id]} disabled={busy} onChange={e => run(() => putAiConsent({ [k.id]: e.target.checked }))} />
              <span>{k.label}<br /><span className="small muted">{k.hint}</span></span>
            </label>
          ))}
        </>}
      </section>

      <section className="card col set-card" aria-labelledby="t-acc">
        <h2 id="t-acc">Comptes</h2>
        <p className="small muted" style={{ margin: 0 }}>Pour chaque compte, son possesseur (l’administrateur de l’espace) décide de ce qui
          peut être envoyé à l’IA. Les personnes invitées voient ces réglages sans pouvoir les changer. Un compte jamais réglé
          n’envoie rien. Sous les noms, l’IA ne voit que « Compte TikTok 1 », jamais vos pseudos.</p>
        {st.accounts.length === 0 && <p className="small muted" style={{ margin: 0 }}>Aucun compte connecté.</p>}
        {st.accounts.map(a => (
          <div key={a.key} className="col" style={{ gap: 2, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
            <span className="strong">{a.name || a.alias}</span>
            <span className="tiny muted">{PLATFORM_LABEL[a.platform]} · vu par l’IA comme « {a.alias} »
              {a.owner ? ' · vous en êtes le possesseur' : ' · réglé par son possesseur'}</span>
            <span className="small muted" style={{ marginTop: 4 }}>Peut être envoyé à l’IA :</span>
            {KINDS.map(k => (
              <label key={k.id} className={`check${!a.owner ? ' disabled' : ''}`}>
                <input type="checkbox" checked={!!a.permissions?.[k.id]} disabled={!a.owner || busy}
                       onChange={e => setPerm(a, k.id, e.target.checked)} />
                <span>{k.label}</span>
              </label>
            ))}
            <label className={`check${!st.active ? ' disabled' : ''}`}>
              <input type="checkbox" checked={!a.excluded} disabled={!st.active || busy} onChange={() => toggleExcluded(a)} />
              <span>Inclure ce compte dans mes conversations</span>
            </label>
          </div>
        ))}
      </section>

      <section className="card col set-card" aria-labelledby="t-conv">
        <h2 id="t-conv">Mes conversations</h2>
        <p className="small muted" style={{ margin: 0 }}>Les conversations sur vos données sont gardées 30 jours, puis supprimées.</p>
        <button type="button" className="btn btn-ghost btn-danger" disabled={busy} onClick={erase}><Icon name="trash" />Effacer mes conversations avec l’assistant</button>
        <Link to="/politique-ia" className="small">Lire la politique IA</Link>
      </section>
      {done && <div className="toast" role="status"><Icon name="check" size={16} />{done}</div>}
    </div>
  )
}
