// Onglet « Connaissances » — base de connaissances RAG du bot (perm context).
// Tout le CRUD est immédiat (POST/DELETE + refetch) : ce panneau vit HORS de la
// save bar de BotPage — ses erreurs restent dans des divs locales, jamais dans
// le canal setError réservé à la sauvegarde.
import { useEffect, useRef, useState } from 'react'
import { BookOpen, Plus, RefreshCw, Search, Trash2, Upload } from 'lucide-react'
import { api, postFile } from '../api'
import { Btn, Card, Chip, Field, InfoBox, SectionTitle, Seg } from '../ui'

interface KbSource {
  id: number
  bot_id: number
  type: 'url' | 'sitemap' | 'pdf' | 'text'
  ref: string
  status: 'pending' | 'ready' | 'error'
  error: string | null
  chunk_count: number
  page_count: number
  created_at: string
}

interface KbSearchResult { chunk_id: number; content: string; ref: string | null; score: number }

const TYPE_LABELS: Record<string, string> = { url: 'URL', sitemap: 'SITEMAP', pdf: 'PDF', text: 'TEXTE' }

const MAX_PDF_BYTES = 10 * 1024 * 1024

export default function KbPanel({ botId, aiActive }: { botId: number; aiActive: boolean }) {
  const [sources, setSources] = useState<KbSource[] | null>(null)
  const [total, setTotal] = useState(0)
  const [loadError, setLoadError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  // Formulaire d'ajout
  const [srcType, setSrcType] = useState('url')
  const [ref, setRef] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [addBusy, setAddBusy] = useState(false)
  const [addError, setAddError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // Suppression
  const [listError, setListError] = useState('')

  // Tester la recherche
  const [query, setQuery] = useState('')
  const [searchBusy, setSearchBusy] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [searchRes, setSearchRes] = useState<{ mode: 'hybrid' | 'fts'; results: KbSearchResult[] } | null>(null)

  // Fetch initial + polling tant qu'une source est pending : chaîne de
  // setTimeout avec flag alive (StrictMode-safe — le double-mount dev annule
  // proprement la première chaîne). Jamais de POST dans cet effet.
  useEffect(() => {
    let alive = true
    let h: ReturnType<typeof setTimeout> | undefined
    const tick = (silent: boolean) => {
      api(`/api/bots/${botId}/kb/sources`)
        .then((d: { total: number; sources: KbSource[] }) => {
          if (!alive) return
          setSources(d.sources)
          setTotal(d.total)
          setLoadError('')
          if (d.sources.some(s => s.status === 'pending')) h = setTimeout(() => tick(true), 4000)
        })
        .catch((err: any) => {
          if (!alive) return
          if (silent) h = setTimeout(() => tick(true), 4000) // tick de poll raté : silencieux, on retente
          else setLoadError(err.message)
        })
    }
    tick(false)
    return () => { alive = false; if (h) clearTimeout(h) }
  }, [botId, refreshKey])

  const atCap = total >= 20
  const hasPending = (sources || []).some(s => s.status === 'pending')
  const hasReady = (sources || []).some(s => s.status === 'ready')

  const addDisabled = addBusy || atCap
    || (srcType === 'url' && !ref.trim())
    || (srcType === 'sitemap' && !ref.trim())
    || (srcType === 'text' && !content.trim())

  async function addSource() {
    if (addDisabled || srcType === 'pdf') return
    setAddBusy(true)
    setAddError('')
    try {
      const body = srcType === 'text'
        ? { type: 'text', content: content.trim(), title: title.trim() || undefined }
        : { type: srcType, ref: ref.trim() }
      await api(`/api/bots/${botId}/kb/sources`, { method: 'POST', body })
      setRef('')
      setTitle('')
      setContent('')
      setRefreshKey(k => k + 1)
    } catch (err: any) {
      setAddError(err.message)
    } finally {
      setAddBusy(false)
    }
  }

  async function addPdf(file: File) {
    if (file.size > MAX_PDF_BYTES) {
      setAddError('PDF trop volumineux (10 Mo max)')
      return
    }
    setAddBusy(true)
    setAddError('')
    try {
      await postFile(`/api/bots/${botId}/kb/sources/pdf`, file)
      setRefreshKey(k => k + 1)
    } catch (err: any) {
      setAddError(err.message)
    } finally {
      setAddBusy(false)
    }
  }

  async function deleteSource(s: KbSource) {
    if (!window.confirm('Supprimer cette source ? Les extraits indexés seront retirés des réponses de l\'IA.')) return
    setListError('')
    try {
      await api(`/api/bots/${botId}/kb/sources/${s.id}`, { method: 'DELETE' })
      setRefreshKey(k => k + 1)
    } catch (err: any) {
      setListError(err.message)
    }
  }

  async function runSearch() {
    const q = query.trim()
    if (!q || searchBusy) return
    setSearchBusy(true)
    setSearchError('')
    try {
      setSearchRes(await api(`/api/bots/${botId}/kb/search`, { method: 'POST', body: { query: q } }))
    } catch (err: any) {
      setSearchError(err.message)
    } finally {
      setSearchBusy(false)
    }
  }

  if (loadError) {
    return (
      <div className="col g18">
        <div className="error" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: 1 }}>{loadError}</span>
          <Btn kind="soft" small onClick={() => setRefreshKey(k => k + 1)}>Réessayer</Btn>
        </div>
      </div>
    )
  }

  return (
    <div className="col g18">
      <SectionTitle sub="Vos pages, FAQ et PDF, indexés localement : l'IA y recherche automatiquement les passages pertinents. 20 sources et ~1 000 extraits max par bot.">
        Base de connaissances
      </SectionTitle>

      {!aiActive ? (
        <InfoBox tone="warn" title="L'IA de ce bot est inactive">
          Ce bot répond uniquement avec l'arbre (mode arbre) : les connaissances ne seront
          utilisées que lorsque l'IA sera activée. Vous pouvez préparer vos sources dès maintenant.
        </InfoBox>
      ) : hasReady ? (
        <InfoBox tone="go" title="Branchée automatiquement">
          L'IA dispose de l'outil de recherche search_docs dès qu'une source est prête — rien d'autre à
          configurer.
        </InfoBox>
      ) : null}

      {/* ---- Ajouter une source ---- */}
      <Card>
        <div className="card-title">Ajouter une source</div>
        <div className="col" style={{ gap: 12 }}>
          <Seg small value={srcType} onChange={v => { setSrcType(v); setAddError('') }}
               options={[
                 { value: 'url', label: 'Page web' },
                 { value: 'sitemap', label: 'Sitemap' },
                 { value: 'text', label: 'Texte libre' },
                 { value: 'pdf', label: 'PDF' },
               ]} />

          {(srcType === 'url' || srcType === 'sitemap') && (
            <Field label="Adresse (https://…)"
                   hint={srcType === 'sitemap'
                     ? 'Les pages de l\'index sont suivies sur un niveau (30 pages max).'
                     : undefined}>
              <input type="text" className="mono"
                     placeholder={srcType === 'sitemap' ? 'https://votre-site.fr/sitemap.xml' : 'https://votre-site.fr/faq'}
                     value={ref} onChange={e => setRef(e.target.value)}
                     onKeyDown={e => e.key === 'Enter' && addSource()} />
            </Field>
          )}

          {srcType === 'text' && (
            <>
              <Field label="Titre (optionnel)">
                <input type="text" maxLength={120} placeholder="ex. Conditions de livraison"
                       value={title} onChange={e => setTitle(e.target.value)} />
              </Field>
              <Field label="Contenu">
                <textarea rows={6} maxLength={200000} value={content}
                          onChange={e => setContent(e.target.value)} />
              </Field>
            </>
          )}

          {addError && <div className="error">{addError}</div>}

          <div className="row g10">
            {srcType === 'pdf' ? (
              <>
                <Btn kind="soft" onClick={() => fileRef.current?.click()} disabled={addBusy || atCap}>
                  <Upload size={14} /> Choisir un PDF…
                </Btn>
                <input ref={fileRef} type="file" accept="application/pdf" hidden
                       onChange={e => {
                         const f = e.target.files?.[0]
                         e.target.value = ''
                         if (f) addPdf(f)
                       }} />
              </>
            ) : (
              <Btn kind="primary" onClick={addSource} disabled={addDisabled}>
                <Plus size={14} /> Ajouter la source
              </Btn>
            )}
            {atCap && <Chip tone="warn">20/20</Chip>}
          </div>
        </div>
      </Card>

      {/* ---- Liste des sources ---- */}
      {hasPending && (
        <InfoBox tone="info" title="Indexation en cours">
          L'indexation tourne en arrière-plan. Au tout premier ajout, le serveur télécharge le modèle
          d'analyse (~240 Mo) : comptez quelques minutes. Les ajouts suivants sont bien plus rapides.
        </InfoBox>
      )}

      {listError && (
        <div className="error" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: 1 }}>{listError}</span>
          <button onClick={() => setListError('')} aria-label="Fermer"
                  style={{ border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', fontSize: 15, padding: 2, lineHeight: 1 }}>×</button>
        </div>
      )}

      {sources === null ? (
        <Card style={{ textAlign: 'center', color: 'var(--mut)' }}>Chargement…</Card>
      ) : sources.length === 0 ? (
        <Card style={{ textAlign: 'center', padding: '40px 24px' }}>
          <div className="col" style={{ alignItems: 'center', gap: 9 }}>
            <BookOpen size={24} style={{ color: 'var(--faint)' }} />
            <div style={{ fontSize: 14, fontWeight: 800 }}>Aucune source de connaissances</div>
            <div style={{ fontSize: 12, color: 'var(--mut)', maxWidth: 440, lineHeight: 1.55 }}>
              Ajoutez vos pages d'aide, votre FAQ, un sitemap ou des PDF : l'IA y recherchera
              automatiquement les passages pertinents pour répondre aux visiteurs (rien à configurer côté
              arbre ou prompt).
            </div>
          </div>
        </Card>
      ) : (
        <Card nopad>
          <table className="kc">
            <thead>
              <tr><th>Type</th><th>Source</th><th>Statut</th><th>Extraits</th><th>Ajoutée</th><th></th></tr>
            </thead>
            <tbody>
              {sources.map(s => (
                <tr key={s.id}>
                  <td><Chip tone="mut"><span className="mono">{TYPE_LABELS[s.type] || s.type}</span></Chip></td>
                  <td style={{ maxWidth: 260 }}>
                    <div className="mono" title={s.ref}
                         style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.ref}
                      {s.page_count > 0 && (
                        <span style={{ color: 'var(--faint)' }}> · {s.page_count} page(s)</span>
                      )}
                    </div>
                    {s.status === 'error' && s.error && (
                      <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 3, lineHeight: 1.45 }}>{s.error}</div>
                    )}
                  </td>
                  <td>
                    {s.status === 'pending' ? (
                      <Chip tone="info"><RefreshCw size={11} /> Indexation…</Chip>
                    ) : s.status === 'ready' ? (
                      <Chip tone="go">Prête</Chip>
                    ) : (
                      <Chip tone="danger">Erreur</Chip>
                    )}
                  </td>
                  <td className="mono">{s.chunk_count}</td>
                  <td style={{ whiteSpace: 'nowrap', color: 'var(--mut)' }}>
                    {new Date(s.created_at + 'Z').toLocaleDateString('fr-FR')}
                  </td>
                  <td>
                    <button onClick={() => deleteSource(s)} aria-label="Supprimer la source"
                            style={{ border: 'none', background: 'none', color: 'var(--faint)', cursor: 'pointer', padding: 4 }}>
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* ---- Tester la recherche ---- */}
      <Card>
        <div className="card-title">Tester la recherche</div>
        <div className="row g8" style={{ flexWrap: 'wrap' }}>
          <input type="text" maxLength={500} placeholder="ex. quels sont vos délais de livraison ?"
                 value={query} onChange={e => setQuery(e.target.value)}
                 onKeyDown={e => e.key === 'Enter' && runSearch()} style={{ flex: 1, minWidth: 220 }} />
          <Btn kind="soft" onClick={runSearch} disabled={!query.trim() || searchBusy}>
            <Search size={13} /> Tester la recherche
          </Btn>
        </div>

        {searchError && <div className="error" style={{ marginTop: 10 }}>{searchError}</div>}

        {searchRes && (
          <div className="col" style={{ gap: 10, marginTop: 12 }}>
            <div className="row g8" style={{ flexWrap: 'wrap' }}>
              {searchRes.mode === 'hybrid' ? (
                <Chip tone="go">hybride (vecteurs + texte)</Chip>
              ) : (
                <>
                  <Chip tone="warn">dégradée (texte seul)</Chip>
                  <span style={{ fontSize: 11, color: 'var(--mut)' }}>
                    Le modèle d'embeddings local est indisponible — résultats moins pertinents jusqu'au
                    redémarrage du serveur.
                  </span>
                </>
              )}
            </div>
            {searchRes.results.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--faint)' }}>Aucun extrait trouvé pour cette requête.</div>
            ) : (
              searchRes.results.map((r, i) => (
                <div key={r.chunk_id} className="row g10" style={{ alignItems: 'flex-start' }}>
                  <span className="num" style={{ fontSize: 11, fontWeight: 800, color: 'var(--faint)', width: 16, paddingTop: 2 }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 12, lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box',
                      WebkitLineClamp: 4, WebkitBoxOrient: 'vertical' as any,
                    }}>{r.content}</div>
                    {r.ref && (
                      <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.ref}</div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        <div className="field-hint" style={{ marginTop: 10 }}>
          Cette recherche est exactement celle que l'outil search_docs exécute pour l'IA — aucun crédit IA
          consommé.
        </div>
      </Card>
    </div>
  )
}
