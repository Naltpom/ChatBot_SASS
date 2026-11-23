// Brouillons automatiques d'un dossier Drive : on analyse le rangement (noms de fichiers et de
// dossiers seulement), on montre ce qu'on a compris sur des exemples réels, l'admin corrige si
// besoin et active. Ensuite chaque nouvelle vidéo devient un brouillon « À valider ».
import { useEffect, useRef, useState } from 'react'
import {
  analyzeSource, previewRecipe, saveRecipe,
  type Analysis, type DatePattern, type Recipe, type RecipeExample, type Source,
} from '../api'
import { fmtDateTime } from '../format'
import { useSession } from '../session'
import { Icon, Loading, Msg, Sheet } from './ui'

const PATTERNS: DatePattern[] = ['ymd_hm', 'ymd', 'dmy_hm', 'dmy', 'compact', 'none']

export function RecipeSheet({ s, onClose, onSaved }: { s: Source; onClose: () => void; onSaved: (s: Source, proposed: number) => void }) {
  const { org } = useSession()
  const [an, setAn] = useState<Analysis | null>(null)
  const [recipe, setRecipe] = useState<Recipe | null>(s.recipe || null)
  const [examples, setExamples] = useState<RecipeExample[]>([])
  const [auto, setAuto] = useState(s.recipe ? !!s.auto_drafts : true)
  const [backlog, setBacklog] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const first = useRef(true)

  const analyze = async () => {
    setBusy(true); setErr('')
    try { const a = await analyzeSource(org, s.id); setAn(a); setRecipe(a.recipe); setExamples(a.examples); first.current = true }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  useEffect(() => { analyze() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Exemples recalculés quand on corrige la recette.
  useEffect(() => {
    if (!recipe || !an) return
    if (first.current) { first.current = false; return }
    const t = window.setTimeout(() => previewRecipe(org, s.id, recipe).then(r => setExamples(r.examples)).catch(() => {}), 350)
    return () => window.clearTimeout(t)
  }, [recipe]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (fn: (r: Recipe) => Recipe) => setRecipe(r => (r ? fn(structuredClone(r)) : r))
  const save = async () => {
    if (!recipe) return
    setBusy(true); setErr('')
    try { const r = await saveRecipe(org, s.id, recipe, auto, backlog); onSaved(r.source, r.proposed) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const level = String(recipe?.account.level || 1) as '1' | '2' | '3'
  const folders = an?.folders[level] || []
  const targets = [...(an?.groups || []).map(g => ({ ...g, name: `Groupe · ${g.name}` })), ...(an?.accounts || [])]

  return (
    <Sheet title={`Brouillons automatiques · ${s.name}`} onClose={onClose}>
      <div className="col" style={{ gap: 16 }}>
        <p className="small muted" style={{ margin: 0 }}>
          Chapote lit la façon dont votre équipe range ses vidéos (noms des dossiers et des fichiers, jamais les vidéos)
          et prépare un brouillon pour chaque nouvelle vidéo. Rien n’est publié sans votre validation.
        </p>
        {!an && busy && <Loading label="Analyse du rangement…" />}
        {err && <Msg kind="err">{err}</Msg>}
        {an && recipe && (
          <>
            <div className="card col" style={{ gap: 6, background: 'var(--surface-2)' }}>
              <span className="tiny muted strong">{an.engine === 'gemini' ? 'Ce que j’ai compris' : 'Rangement détecté'} · {an.videos} vidéo{an.videos > 1 ? 's' : ''} analysée{an.videos > 1 ? 's' : ''}</span>
              <span className="small">{an.explanation || 'Vérifiez les réglages ci-dessous sur les exemples.'}</span>
              <button type="button" className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={analyze}><Icon name="refresh" size={16} />Réanalyser</button>
            </div>

            <fieldset className="col" style={{ gap: 8 }}>
              <legend>Comptes</legend>
              <label className="check"><input type="radio" name="acc" checked={recipe.account.from === 'source'} onChange={() => set(r => { r.account.from = 'source'; return r })} />
                <span>Les comptes proposés par défaut pour ce dossier<br /><span className="field-hint">Réglage « Comptes proposés par défaut » du dossier.</span></span></label>
              <label className="check"><input type="radio" name="acc" checked={recipe.account.from === 'folder'} onChange={() => set(r => { r.account.from = 'folder'; return r })} />
                <span>Selon le sous-dossier (un dossier par compte ou par client)</span></label>
              {recipe.account.from === 'folder' && (
                <div className="col" style={{ gap: 8, paddingLeft: 8 }}>
                  <label className="field">Niveau du sous-dossier
                    <select className="input" value={recipe.account.level} onChange={e => set(r => { r.account.level = Number(e.target.value); return r })}>
                      <option value={1}>1er niveau (ex. « kiwi/… »)</option><option value={2}>2e niveau</option><option value={3}>3e niveau</option>
                    </select>
                  </label>
                  {folders.length === 0 && <p className="tiny muted" style={{ margin: 0 }}>Aucun sous-dossier à ce niveau.</p>}
                  {folders.map(f => (
                    <label key={f} className="field">« {f} » →
                      <select className="input" value={(recipe.account.map[f] || [])[0] || ''}
                              onChange={e => set(r => { if (e.target.value) r.account.map[f] = [e.target.value]; else delete r.account.map[f]; return r })}>
                        <option value="">Ne pas proposer</option>
                        {targets.map(t => <option key={t.key} value={t.key}>{t.name}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>

            <fieldset className="col" style={{ gap: 8 }}>
              <legend>Date et heure</legend>
              <label className="field">Lues dans les noms
                <select className="input" value={recipe.when.pattern} onChange={e => set(r => { r.when.pattern = e.target.value as DatePattern; return r })}>
                  {PATTERNS.map(p => <option key={p} value={p}>{p === 'none' ? 'Pas de date : je choisis l’heure en validant' : `Comme « ${an.patterns[p]} »`}</option>)}
                </select>
              </label>
              {recipe.when.pattern !== 'none' && (
                <label className="field">Heure si le nom n’en donne pas
                  <input className="input" type="time" value={recipe.when.default_time} onChange={e => set(r => { r.when.default_time = e.target.value || '18:00'; return r })} />
                </label>
              )}
            </fieldset>

            <fieldset className="col" style={{ gap: 8 }}>
              <legend>Texte</legend>
              <label className="field">Titre
                <select className="input" value={recipe.title.from} onChange={e => set(r => { r.title.from = e.target.value as Recipe['title']['from']; return r })}>
                  <option value="file">Nom du fichier vidéo</option><option value="folder">Nom du dossier de la vidéo</option><option value="txt_first_line">1re ligne du .txt</option>
                </select>
              </label>
              <label className="check"><input type="checkbox" checked={recipe.caption.from === 'txt'} onChange={e => set(r => { r.caption.from = e.target.checked ? 'txt' : 'none'; return r })} />Légende : le fichier .txt à côté de la vidéo</label>
              <label className="check"><input type="checkbox" checked={recipe.cover.from === 'image'} onChange={e => set(r => { r.cover.from = e.target.checked ? 'image' : 'none'; return r })} />Couverture : l’image à côté de la vidéo</label>
            </fieldset>

            {examples.length > 0 && (
              <section className="col" style={{ gap: 8 }} aria-labelledby="rx-ex">
                <h3 id="rx-ex" style={{ margin: 0 }}>Sur vos vidéos</h3>
                <ul className="list">
                  {examples.map(x => (
                    <li key={x.asset_id} style={{ alignItems: 'flex-start' }}>
                      <div className="grow col" style={{ gap: 2, minWidth: 0 }}>
                        <span className="tiny muted ellipsis" title={x.path}>{x.path}</span>
                        <span className="strong ellipsis">{x.title}</span>
                        <span className="tiny">
                          {x.scheduled_at ? fmtDateTime(x.scheduled_at) : <span className="muted">heure à choisir</span>}
                          {' · '}{x.accounts.length ? x.accounts.join(', ') : <span className="status-warn">aucun compte</span>}
                          {x.cover && ' · couverture'}
                        </span>
                        {x.caption && <span className="tiny muted clamp2">{x.caption}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="col" style={{ gap: 6 }}>
              <label className="check"><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} />
                <span><b>Créer les brouillons automatiquement</b><br /><span className="field-hint">À chaque nouvelle vidéo du dossier, un brouillon arrive dans « À valider ».</span></span></label>
              {auto && !s.auto_drafts && (
                <label className="check"><input type="checkbox" checked={backlog} onChange={e => setBacklog(e.target.checked)} />
                  Aussi pour les vidéos déjà dans le dossier (pas encore programmées)</label>
              )}
            </div>
            <div className="row-nw">
              <button type="button" className="btn grow" onClick={onClose}>Annuler</button>
              <button type="button" className="btn btn-primary grow" disabled={busy} onClick={save}>Enregistrer</button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  )
}
