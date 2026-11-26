// « Préparer les publications toutes seules » pour un dossier Drive. Simple d'abord :
// 1. un exemple réel (ce fichier → devient tel brouillon) ; 2. trois questions résumées en une ligne,
// chacune avec « Changer » ; 3. Activer. Rien ne part sans validation (page « À valider »).
// Chapote lit seulement les noms des dossiers et des fichiers, jamais les vidéos.
import { useEffect, useRef, useState } from 'react'
import {
  analyzeSource, previewRecipe, saveRecipe,
  type Analysis, type DatePattern, type Recipe, type RecipeExample, type Source,
} from '../api'
import { fmtDateTime } from '../format'
import { useSession } from '../session'
import { Icon, Loading, Msg, Sheet } from './ui'
import { t } from '../i18n'

const PATTERNS: DatePattern[] = ['ymd_hm', 'ymd', 'dmy_hm', 'dmy', 'compact', 'none']
const TITLE_FROM: Record<Recipe['title']['from'], string> = { folder: 'le nom du dossier', file: 'le nom du fichier', txt_first_line: 'la 1re ligne du .txt' }

function Example({ x }: { x: RecipeExample }) {
  return (
    <div className="rx-ex">
      <div className="rx-path"><Icon name="layers" size={14} /><span>{x.path.split('/').join(' / ')}</span></div>
      <div className="rx-to"><span className="tiny muted">{t('devient')}</span>
        <dl className="rx-dl">
          <dt>{t('Titre')}</dt><dd className="strong">{x.title}</dd>
          <dt>{t('Quand')}</dt><dd>{x.scheduled_at ? fmtDateTime(x.scheduled_at) : <span className="muted">{t('à choisir en validant')}</span>}</dd>
          <dt>{t('Où')}</dt><dd>{x.accounts.length ? x.accounts.join(', ') : <span className="status-warn">{t('aucun compte : à choisir')}</span>}</dd>
          <dt>{t('Légende')}</dt><dd>{x.caption ? <span className="clamp2">{x.caption}</span> : <span className="muted">{t('aucune')}</span>}</dd>
          <dt>{t('Couverture')}</dt><dd>{x.cover ? t('l’image du dossier') : <span className="muted">{t('choisie par la plateforme')}</span>}</dd>
        </dl>
      </div>
    </div>
  )
}

function Question({ title, summary, open, onToggle, children }: { title: string; summary: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="rx-q">
      <div className="row-nw" style={{ gap: 10, alignItems: 'center' }}>
        <div className="grow" style={{ minWidth: 0 }}><div className="strong">{title}</div><div className="small muted">{summary}</div></div>
        <button type="button" className="btn btn-sm" aria-expanded={open} onClick={onToggle}>{open ? t('OK') : t('Changer')}</button>
      </div>
      {open && <div className="col" style={{ gap: 10, marginTop: 10 }}>{children}</div>}
    </div>
  )
}

export function RecipeSheet({ s, onClose, onSaved }: { s: Source; onClose: () => void; onSaved: (s: Source, proposed: number) => void }) {
  const { org } = useSession()
  const [an, setAn] = useState<Analysis | null>(null)
  const [recipe, setRecipe] = useState<Recipe | null>(s.recipe || null)
  const [examples, setExamples] = useState<RecipeExample[]>([])
  const [more, setMore] = useState(false)
  const [open, setOpen] = useState<'acc' | 'when' | 'text' | null>(null)
  const [backlog, setBacklog] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const first = useRef(true)

  const analyze = async () => {
    setBusy(true); setErr('')
    try { const a = await analyzeSource(org, s.id); setAn(a); setRecipe(s.recipe || a.recipe); setExamples(a.examples); first.current = !s.recipe }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  useEffect(() => { analyze() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!recipe || !an) return
    if (first.current) { first.current = false; return }
    const t = window.setTimeout(() => previewRecipe(org, s.id, recipe).then(r => setExamples(r.examples)).catch(() => {}), 350)
    return () => window.clearTimeout(t)
  }, [recipe]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (fn: (r: Recipe) => Recipe) => setRecipe(r => (r ? fn(structuredClone(r)) : r))
  const save = async (active: boolean) => {
    if (!recipe) return
    setBusy(true); setErr('')
    try { const r = await saveRecipe(org, s.id, recipe, active, backlog); onSaved(r.source, r.proposed) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const targets = [...(an?.groups || []).map(g => ({ ...g, name: t('Groupe {name}', { name: g.name }) })), ...(an?.accounts || [])]
  const nameOf = (k: string) => targets.find(x => x.key === k)?.name || k
  const names = (ks: string[]) => (ks.length > 2 ? `${ks.slice(0, 2).map(nameOf).join(', ')} +${ks.length - 2}` : ks.map(nameOf).join(', '))
  const level = String(recipe?.account.level || 1) as '1' | '2' | '3'
  const folders = an?.folders[level] || []
  const accSummary = !recipe ? '' : recipe.account.from === 'folder'
    ? t('Selon le dossier : {list}', { list: Object.entries(recipe.account.map).filter(([f]) => f !== '*').map(([f, k]) => `${f} → ${names(k)}`).join(' · ') || t('à associer') })
    : t('Toujours : {list}', { list: (recipe.account.map['*'] || []).map(nameOf).join(', ') || t('les comptes proposés par défaut pour ce dossier') })
  const whenSummary = !recipe ? '' : recipe.when.pattern === 'none' ? t('Je choisis l’heure en validant.')
    : t('La date écrite dans le nom (comme « {example} »). Sans heure : {time}.', { example: an?.patterns[recipe.when.pattern], time: recipe.when.default_time })
  const textSummary = !recipe ? '' : t('Titre : {title}. Légende : {caption}. Couverture : {cover}.', { title: t(TITLE_FROM[recipe.title.from]), caption: recipe.caption.from === 'txt' ? t('le .txt') : t('aucune'), cover: recipe.cover.from === 'image' ? t('l’image') : t('aucune') })

  return (
    <Sheet title={t('Préparer les publications toutes seules')} onClose={onClose}>
      <div className="col" style={{ gap: 18 }}>
        <p className="small muted" style={{ margin: 0 }}>
          {t('Quand votre équipe dépose une vidéo dans « {name} », Chapote prépare la publication. Vous la vérifiez avant qu’elle parte.', { name: s.name })}
        </p>
        {!an && busy && <Loading label={t('Lecture du rangement du dossier…')} />}
        {err && <Msg kind="err">{err}</Msg>}
        {an && recipe && (
          <>
            <section className="col" style={{ gap: 8 }} aria-labelledby="rx1">
              <h3 id="rx1" className="rx-h">{t('Exemple avec une de vos vidéos')}</h3>
              {examples[0] ? <Example x={examples[0]} /> : <p className="small muted" style={{ margin: 0 }}>{t('Aucune vidéo dans le dossier pour l’instant.')}</p>}
              {examples.length > 1 && (
                <button type="button" className="linkbtn" style={{ alignSelf: 'flex-start' }} aria-expanded={more} onClick={() => setMore(m => !m)}>
                  {more ? t('Masquer les autres exemples') : examples.length > 2 ? t('Voir {n} autres exemples', { n: examples.length - 1 }) : t('Voir {n} autre exemple', { n: examples.length - 1 })}
                </button>
              )}
              {more && examples.slice(1).map(x => <Example key={x.asset_id} x={x} />)}
            </section>

            <section className="col" style={{ gap: 8 }} aria-labelledby="rx2">
              <h3 id="rx2" className="rx-h">{t('C’est juste ? Sinon, corrigez')}</h3>
              <div className="rx-qs">
                <Question title={t('Sur quels comptes ?')} summary={accSummary} open={open === 'acc'} onToggle={() => setOpen(open === 'acc' ? null : 'acc')}>
                  <label className="check"><input type="radio" name="acc" checked={recipe.account.from === 'source'} onChange={() => set(r => { r.account.from = 'source'; return r })} />{t('Toujours les mêmes comptes')}</label>
                  {recipe.account.from === 'source' && (
                    <select className="input" aria-label={t('Comptes')} value={(recipe.account.map['*'] || [])[0] || ''}
                            onChange={e => set(r => { if (e.target.value) r.account.map['*'] = [e.target.value]; else delete r.account.map['*']; return r })}>
                      <option value="">{t('Les comptes proposés par défaut pour ce dossier')}</option>
                      {targets.map(x => <option key={x.key} value={x.key}>{x.name}</option>)}
                    </select>
                  )}
                  <label className="check"><input type="radio" name="acc" checked={recipe.account.from === 'folder'} onChange={() => set(r => { r.account.from = 'folder'; return r })} />{t('Ça dépend du sous-dossier (un dossier par compte ou par client)')}</label>
                  {recipe.account.from === 'folder' && (
                    <>
                      {folders.map(f => (
                        <label key={f} className="field">{t('Dossier « {name} »', { name: f })}
                          <select className="input" value={(recipe.account.map[f] || [])[0] || ''}
                                  onChange={e => set(r => { if (e.target.value) r.account.map[f] = [e.target.value]; else delete r.account.map[f]; return r })}>
                            <option value="">{t('Ne rien préparer')}</option>
                            {targets.map(x => <option key={x.key} value={x.key}>{x.name}</option>)}
                          </select>
                        </label>
                      ))}
                      <details>
                        <summary className="small muted" style={{ cursor: 'pointer' }}>{t('Les comptes sont rangés plus profond ?')}</summary>
                        <select className="input" aria-label={t('Niveau des dossiers de comptes')} value={recipe.account.level} style={{ marginTop: 8 }}
                                onChange={e => set(r => { r.account.level = Number(e.target.value); return r })}>
                          <option value={1}>{t('Directement dans le dossier partagé')}</option><option value={2}>{t('Un niveau plus bas')}</option><option value={3}>{t('Deux niveaux plus bas')}</option>
                        </select>
                      </details>
                    </>
                  )}
                </Question>
                <Question title={t('Quand publier ?')} summary={whenSummary} open={open === 'when'} onToggle={() => setOpen(open === 'when' ? null : 'when')}>
                  <select className="input" aria-label={t('Où lire la date')} value={recipe.when.pattern} onChange={e => set(r => { r.when.pattern = e.target.value as DatePattern; return r })}>
                    {PATTERNS.map(p => <option key={p} value={p}>{p === 'none' ? t('Je choisis l’heure en validant') : t('La date est écrite comme « {example} »', { example: an.patterns[p] })}</option>)}
                  </select>
                  {recipe.when.pattern !== 'none' && (
                    <label className="field">{t('Heure si le nom n’en donne pas')}
                      <input className="input" type="time" value={recipe.when.default_time} onChange={e => set(r => { r.when.default_time = e.target.value || '18:00'; return r })} />
                    </label>
                  )}
                </Question>
                <Question title={t('Titre et légende ?')} summary={textSummary} open={open === 'text'} onToggle={() => setOpen(open === 'text' ? null : 'text')}>
                  <label className="field">{t('Le titre vient de')}
                    <select className="input" value={recipe.title.from} onChange={e => set(r => { r.title.from = e.target.value as Recipe['title']['from']; return r })}>
                      {(Object.keys(TITLE_FROM) as Recipe['title']['from'][]).map(k => <option key={k} value={k}>{t(TITLE_FROM[k])}</option>)}
                    </select>
                  </label>
                  <label className="check"><input type="checkbox" checked={recipe.caption.from === 'txt'} onChange={e => set(r => { r.caption.from = e.target.checked ? 'txt' : 'none'; return r })} />{t('Légende : le fichier .txt posé à côté de la vidéo')}</label>
                  <label className="check"><input type="checkbox" checked={recipe.cover.from === 'image'} onChange={e => set(r => { r.cover.from = e.target.checked ? 'image' : 'none'; return r })} />{t('Couverture : l’image posée à côté de la vidéo')}</label>
                </Question>
              </div>
            </section>

            {!s.auto_drafts && (
              <label className="check"><input type="checkbox" checked={backlog} onChange={e => setBacklog(e.target.checked)} />
                {t('Préparer aussi les vidéos déjà dans le dossier')}</label>
            )}
            <div className="col" style={{ gap: 8 }}>
              <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => save(true)}>{s.auto_drafts ? t('Enregistrer') : t('Activer')}</button>
              {s.auto_drafts && <button type="button" className="btn btn-ghost btn-block" disabled={busy} onClick={() => save(false)}>{t('Désactiver')}</button>}
              <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>{t('Rien ne part sans votre validation, dans « À valider ».')}</p>
            </div>
          </>
        )}
      </div>
    </Sheet>
  )
}
