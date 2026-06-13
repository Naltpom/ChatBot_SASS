// Onglet « Inbox » — live chat côté staff (perm inbox). Monté UNIQUEMENT quand
// l'onglet est ouvert : le refetch périodique (5 s) meurt au changement
// d'onglet (cleanup quand même obligatoire, StrictMode). Toutes les erreurs
// d'action (take/reply/close) restent dans des divs locales — jamais le canal
// setError de la save bar.
import { useEffect, useRef, useState } from 'react'
import { Send, ThumbsDown, ThumbsUp } from 'lucide-react'
import { api } from '../api'
import { Btn, Card, Chip, SectionTitle, Seg } from '../ui'

interface LastMessage { role: string; source: string; content: string; created_at: string }

interface ConvSummary {
  id: string
  status: 'ai' | 'human_requested' | 'human' | 'closed'
  visitor_id: string
  domain: string
  page_url: string | null
  started_at: string
  last_activity_at: string
  human_requested_at: string | null
  closed_at: string | null
  unread: number
  last_message: LastMessage | null
}

interface TranscriptMsg {
  id: number
  role: string
  source: string
  content: string
  rating: number | null
  created_at: string
}

interface Transcript {
  conversation: Omit<ConvSummary, 'unread' | 'last_message'>
  messages: TranscriptMsg[]
}

const FILTERS = [
  { value: '', label: 'Toutes' },
  { value: 'human_requested', label: 'À prendre' },
  { value: 'human', label: 'En cours' },
  { value: 'ai', label: 'Bot' },
  { value: 'closed', label: 'Clôturées' },
]

function minutesSince(iso: string) {
  return Math.max(0, Math.round((Date.now() - new Date(iso + 'Z').getTime()) / 60000))
}

function timeAgo(iso: string) {
  const mins = minutesSince(iso)
  if (mins < 60) return `il y a ${mins} min`
  if (mins < 60 * 24) return `il y a ${Math.round(mins / 60)} h`
  return `il y a ${Math.round(mins / 1440)} j`
}

function statusChipOf(status: string) {
  if (status === 'human_requested') return <Chip tone="warn">À prendre</Chip>
  if (status === 'human') return <Chip tone="acc">En cours</Chip>
  if (status === 'closed') return <Chip tone="mut">Clôturée</Chip>
  return <Chip tone="mut">Bot</Chip>
}

function msgPrefix(m: LastMessage) {
  if (m.role === 'user') return 'Visiteur : '
  if (m.source === 'human') return 'Conseiller : '
  return 'Bot : '
}

function pathnameOf(url: string | null) {
  if (!url) return ''
  try { return new URL(url).pathname } catch { return url }
}

export default function InboxPanel({ botId, onPending }: { botId: number; onPending?: (n: number) => void }) {
  const [filter, setFilter] = useState('')
  const [convs, setConvs] = useState<ConvSummary[] | null>(null)
  const [listError, setListError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<Transcript | null>(null)
  const [actionError, setActionError] = useState('')
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)

  // Refs pour le refetch périodique : l'interval ne dépend pas de la sélection
  const selRef = useRef<string | null>(null)
  selRef.current = selectedId
  const msgBoxRef = useRef<HTMLDivElement>(null)

  async function loadList(silent: boolean) {
    try {
      // « Toutes » = paramètre status OMIS (status= vide → 422 « Statut inconnu »)
      const d = await api(`/api/bots/${botId}/conversations?${filter ? `status=${filter}&` : ''}limit=50`)
      setConvs(d.conversations)
      setListError('')
      // Pastille « à prendre » : TOUJOURS un total exact côté serveur — jamais
      // un comptage de la page courante (limit=50 → sous-compte qui oscillerait
      // avec le d.total exact du poll 30 s de BotPage).
      if (filter === 'human_requested') {
        onPending?.(d.total)
      } else if (filter === '') {
        // Filtre « Toutes » : requête de comptage dédiée (limit=1, on ne lit
        // que total) pour garder l'affinage 5 s. Échec silencieux.
        api(`/api/bots/${botId}/conversations?status=human_requested&limit=1`)
          .then((dd: any) => onPending?.(dd.total))
          .catch(() => {})
      }
    } catch (err: any) {
      if (!silent) setListError(err.message)
    }
  }

  async function loadTranscript(cid: string, silent: boolean) {
    try {
      const d = await api(`/api/bots/${botId}/conversations/${cid}`)
      if (selRef.current === cid) setTranscript(d)
    } catch (err: any) {
      if (!silent) setActionError(err.message)
    }
  }

  // Liste : fetch initial + refetch silencieux toutes les 5 s (liste courante
  // + transcript ouvert). Cleanup clearInterval impératif (StrictMode).
  useEffect(() => {
    setConvs(null)
    loadList(false)
    const h = setInterval(() => {
      loadList(true)
      if (selRef.current) loadTranscript(selRef.current, true)
    }, 5000)
    return () => clearInterval(h)
  }, [botId, filter])  // eslint-disable-line react-hooks/exhaustive-deps

  // Autoscroll en bas du transcript à chaque nouveau message — scroll du
  // CONTENEUR seulement (scrollIntoView déplacerait aussi la page à chaque
  // refetch 5 s)
  const msgCount = transcript?.messages.length || 0
  useEffect(() => {
    const el = msgBoxRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [selectedId, msgCount])

  function openConv(cid: string) {
    if (cid === selectedId) return
    setSelectedId(cid)
    setTranscript(null)
    setActionError('')
    setReply('')
    selRef.current = cid
    loadTranscript(cid, false)
  }

  // Après un 409 (état désynchronisé : timeout 15 min, autre staff…),
  // refetch immédiat liste + transcript.
  function resync() {
    loadList(true)
    if (selRef.current) loadTranscript(selRef.current, true)
  }

  async function doAction(verb: 'take' | 'close') {
    if (!selectedId || busy) return
    if (verb === 'close' && !window.confirm('Clôturer cette conversation ? Le visiteur en sera informé.')) return
    setBusy(true)
    setActionError('')
    try {
      await api(`/api/bots/${botId}/conversations/${selectedId}/${verb}`, { method: 'POST' })
      await loadTranscript(selectedId, false)
      loadList(true)
    } catch (err: any) {
      setActionError(err.message)
      if (err.status === 409) resync()
    } finally {
      setBusy(false)
    }
  }

  async function sendReply() {
    const content = reply.trim()
    if (!selectedId || !content || busy) return
    setBusy(true)
    setActionError('')
    try {
      await api(`/api/bots/${botId}/conversations/${selectedId}/reply`, { method: 'POST', body: { content } })
      setReply('')
      await loadTranscript(selectedId, false)
      loadList(true)
    } catch (err: any) {
      setActionError(err.message)
      if (err.status === 409) resync()
    } finally {
      setBusy(false)
    }
  }

  const conv = transcript?.conversation
  const canReply = conv && (conv.status === 'human_requested' || conv.status === 'human')

  return (
    <div className="col g18">
      <SectionTitle sub="Les visiteurs qui demandent un conseiller arrivent ici. Prenez la main, répondez, clôturez.">
        Conversations en direct
      </SectionTitle>

      {listError && <div className="error">{listError}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 14, alignItems: 'start' }}>
        {/* ---- Liste ---- */}
        <Card nopad>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
            <Seg small value={filter} onChange={setFilter} options={FILTERS} />
          </div>
          {convs === null ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--mut)', fontSize: 12.5 }}>Chargement…</div>
          ) : convs.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--faint)', fontSize: 12.5 }}>Aucune conversation.</div>
          ) : (
            convs.map(c => {
              const waiting = c.status === 'human_requested' && c.human_requested_at
              const waitMins = waiting ? minutesSince(c.human_requested_at!) : 0
              return (
                <button key={c.id} className={`inbox-row ${selectedId === c.id ? 'active' : ''}`}
                        onClick={() => openConv(c.id)}>
                  <div className="row g8" style={{ flexWrap: 'wrap' }}>
                    {statusChipOf(c.status)}
                    <span className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>{c.visitor_id.slice(0, 6)}</span>
                    <span style={{ flex: 1 }} />
                    {waiting ? (
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: waitMins > 15 ? 'var(--warn)' : 'var(--faint)' }}
                            title={waitMins > 15
                              ? 'Le visiteur a probablement été rebasculé vers le bot (délai de 15 min) — la demande reste à clôturer.'
                              : undefined}>
                        en attente depuis {waitMins} min
                      </span>
                    ) : (
                      <span style={{ fontSize: 10.5, color: 'var(--faint)' }}>{timeAgo(c.last_activity_at)}</span>
                    )}
                    {c.unread > 0 && (
                      <span className="tab-badge" role="img" aria-label={`${c.unread} non lus`}>{c.unread}</span>
                    )}
                  </div>
                  {c.last_message && (
                    <div style={{
                      fontSize: 11.5, color: 'var(--faint)', marginTop: 4,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {msgPrefix(c.last_message)}{c.last_message.content}
                    </div>
                  )}
                </button>
              )
            })
          )}
        </Card>

        {/* ---- Transcript ---- */}
        <Card>
          {!selectedId ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--faint)', fontSize: 12.5 }}>
              Sélectionnez une conversation.
            </div>
          ) : !transcript ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--mut)', fontSize: 12.5 }}>Chargement…</div>
          ) : (
            <div className="col" style={{ gap: 12 }}>
              {/* Header */}
              <div className="row g10" style={{ flexWrap: 'wrap', paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
                {statusChipOf(conv!.status)}
                <span style={{ fontSize: 12, fontWeight: 700 }}>{conv!.domain}</span>
                <span className="mono" style={{
                  fontSize: 11, color: 'var(--faint)', maxWidth: 180,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{pathnameOf(conv!.page_url)}</span>
                <span style={{ fontSize: 11, color: 'var(--faint)' }}>
                  {new Date(conv!.started_at + 'Z').toLocaleString('fr-FR')}
                </span>
                <span style={{ flex: 1 }} />
                {conv!.status === 'human_requested' && (
                  <Btn kind="primary" small onClick={() => doAction('take')} disabled={busy}>Prendre en main</Btn>
                )}
                {(conv!.status === 'human_requested' || conv!.status === 'human') && (
                  <Btn kind="ghost" small onClick={() => doAction('close')} disabled={busy}>Clôturer</Btn>
                )}
              </div>

              {/* Messages */}
              <div ref={msgBoxRef} className="col" style={{ gap: 8, maxHeight: 420, overflowY: 'auto', padding: '2px 2px' }}>
                {transcript.messages.map(m => {
                  if (m.source === 'system') {
                    return (
                      <div key={m.id} style={{ textAlign: 'center', fontStyle: 'italic', color: 'var(--faint)', fontSize: 11.5 }}>
                        {m.content}
                      </div>
                    )
                  }
                  const isVisitor = m.role === 'user'
                  const isStaff = m.role === 'assistant' && m.source === 'human'
                  return (
                    <div key={m.id} className="col"
                         style={{ gap: 2, alignItems: isVisitor ? 'flex-start' : 'flex-end', maxWidth: '100%' }}>
                      <span className="row g6" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--faint)' }}>
                        {isVisitor ? 'Visiteur' : isStaff ? 'Conseiller' : <>Bot <Chip tone="mut">{m.source}</Chip></>}
                      </span>
                      <div style={{
                        maxWidth: '85%', padding: '8px 11px', borderRadius: 11, fontSize: 12.5, lineHeight: 1.5,
                        whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
                        background: isVisitor ? 'var(--surface2)' : isStaff ? 'var(--acc-soft)' : 'var(--surface3)',
                        border: '1px solid var(--border)',
                      }}>
                        {m.content}
                      </div>
                      {m.rating === 1 && (
                        <span title="Le visiteur a jugé cette réponse utile">
                          <ThumbsUp size={12} style={{ color: 'var(--go)' }} />
                        </span>
                      )}
                      {m.rating === -1 && (
                        <span title="Le visiteur a jugé cette réponse peu utile">
                          <ThumbsDown size={12} style={{ color: 'var(--danger)' }} />
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Erreurs take/reply/close */}
              {actionError && <div className="error">{actionError}</div>}

              {/* Zone de réponse */}
              {canReply ? (
                <>
                  <div className="row g8">
                    <input type="text" placeholder="Votre réponse au visiteur…" value={reply}
                           onChange={e => setReply(e.target.value)}
                           onKeyDown={e => e.key === 'Enter' && sendReply()}
                           maxLength={4000} style={{ flex: 1 }} />
                    <Btn kind="primary" onClick={sendReply} disabled={busy || !reply.trim()}>
                      <Send size={13} /> Envoyer
                    </Btn>
                  </div>
                  <div className="field-hint">
                    Répondre prend automatiquement la conversation en main. Le visiteur voit l'étiquette
                    "Conseiller", jamais votre nom.
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--faint)' }}>
                  Conversation {conv!.status === 'closed' ? 'clôturée' : 'gérée par le bot'} — répondre n'est
                  pas possible.
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
