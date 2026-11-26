// « Préparer les publications toutes seules » pour un dossier Drive (comme cm/src/components/RecipeSheet.tsx) :
// 1. un exemple réel ; 2. trois questions résumées, chacune avec « Changer » ; 3. Activer.
// Rien ne part sans validation (écran « Brouillons à valider »).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { View } from 'react-native'
import { analyzeSource, previewRecipe, saveRecipe, type Analysis, type DatePattern, type Recipe, type RecipeExample, type Source } from '../../lib/api'
import { fmtDateTime } from '../../lib/format'
import { t } from '../../lib/i18n'
import { useSession } from '../../lib/session'
import { Button, Field, Icon, Label, Loading, Msg, Row, Sheet, Txt } from '../../ui/kit'
import { radius, space, useTheme } from '../../ui/theme'
import {
  LEVELS, PATTERNS, TITLE_FROM, accountSummary, editRecipe, normalizeTime, patternLabel, recipeTargets, setMapping, textSummary, whenSummary,
} from './logic'
import { Choice, Select } from './ui'

function Example({ x }: { x: RecipeExample }) {
  const { c } = useTheme()
  const rows: [string, ReactNode][] = [
    [t('Titre'), <Txt small bold>{x.title}</Txt>],
    [t('Quand'), x.scheduled_at ? <Txt small>{fmtDateTime(x.scheduled_at)}</Txt> : <Txt small muted>{t('à choisir en validant')}</Txt>],
    [t('Où'), x.accounts.length ? <Txt small>{x.accounts.join(', ')}</Txt> : <Txt small color={c.warn}>{t('aucun compte : à choisir')}</Txt>],
    [t('Légende'), x.caption ? <Txt small numberOfLines={2}>{x.caption}</Txt> : <Txt small muted>{t('aucune')}</Txt>],
    [t('Couverture'), x.cover ? <Txt small>{t('l’image du dossier')}</Txt> : <Txt small muted>{t('choisie par la plateforme')}</Txt>],
  ]
  return (
    <View style={{ borderRadius: radius.md, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, padding: space.md, gap: space.sm }}>
      <Row gap={6} style={{ alignItems: 'flex-start' }}>
        <Icon name="folder" size={16} color={c.muted} />
        <Txt small muted style={{ flex: 1 }}>{x.path.split('/').join(' / ')}</Txt>
      </Row>
      <Txt small faint>{t('devient')}</Txt>
      {rows.map(([k, v]) => (
        <Row key={k} gap={space.sm} style={{ alignItems: 'flex-start' }}>
          <Txt small muted style={{ width: 86 }}>{k}</Txt>
          <View style={{ flex: 1 }}>{v}</View>
        </Row>
      ))}
    </View>
  )
}

function Question({ title, summary, open, onToggle, children }: { title: string; summary: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  const { c } = useTheme()
  return (
    <View style={{ borderRadius: radius.md, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, padding: space.md, gap: space.md }}>
      <Row gap={space.md}>
        <View style={{ flex: 1 }}>
          <Txt bold>{title}</Txt>
          <Txt small muted>{t(summary)}</Txt>
        </View>
        <Button small title={open ? t('OK') : t('Changer')} onPress={onToggle} accessibilityLabel={open ? t('Fermer : {title}', { title }) : t('Changer : {title}', { title })} />
      </Row>
      {open ? <View style={{ gap: space.sm }}>{children}</View> : null}
    </View>
  )
}

export function RecipeSheet({ s, visible, onClose, onSaved }: { s: Source; visible: boolean; onClose: () => void; onSaved: (s: Source, proposed: number) => void }) {
  const { org } = useSession()
  const [an, setAn] = useState<Analysis | null>(null)
  const [recipe, setRecipe] = useState<Recipe | null>(s.recipe || null)
  const [examples, setExamples] = useState<RecipeExample[]>([])
  const [more, setMore] = useState(false)
  const [open, setOpen] = useState<'acc' | 'when' | 'text' | null>(null)
  const [backlog, setBacklog] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [time, setTime] = useState(s.recipe?.when.default_time || '18:00')
  const first = useRef(true)

  const analyze = async () => {
    setBusy(true); setErr('')
    try {
      const a = await analyzeSource(org, s.id)
      const r = s.recipe || a.recipe
      setAn(a); setRecipe(r); setTime(r.when.default_time); setExamples(a.examples); first.current = !s.recipe
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  useEffect(() => { if (visible && !an) analyze() }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps
  // Exemples recalculés par l'API après chaque changement (petite pause).
  useEffect(() => {
    if (!recipe || !an) return
    if (first.current) { first.current = false; return }
    const t = setTimeout(() => previewRecipe(org, s.id, recipe).then(r => setExamples(r.examples)).catch(() => {}), 350)
    return () => clearTimeout(t)
  }, [recipe]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (fn: (r: Recipe) => void) => setRecipe(r => (r ? editRecipe(r, fn) : r))
  const save = async (active: boolean) => {
    if (!recipe) return
    setBusy(true); setErr('')
    try { const r = await saveRecipe(org, s.id, recipe, active, backlog); onSaved(r.source, r.proposed) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const targets = recipeTargets(an, t).map(x => [x.key, x.name] as [string, string])
  const level = String(recipe?.account.level || 1) as '1' | '2' | '3'
  const folders = an?.folders[level] || []
  const commitTime = () => {
    const v = normalizeTime(time)
    if (v) { setTime(v); set(r => { r.when.default_time = v }) } else setTime(recipe?.when.default_time || '18:00')
  }

  return (
    <Sheet visible={visible} title={t('Préparer les publications toutes seules')} onClose={onClose}
      footer={an && recipe ? (
        <View style={{ gap: space.sm }}>
          <Button kind="primary" title={s.auto_drafts ? t('Enregistrer') : t('Activer')} disabled={busy} onPress={() => save(true)} />
          {s.auto_drafts ? <Button kind="ghost" title={t('Désactiver')} disabled={busy} onPress={() => save(false)} /> : null}
          <Txt small muted center>{t('Rien ne part sans votre validation, dans « À valider ».')}</Txt>
        </View>
      ) : undefined}>
      <Txt small muted>{t('Quand votre équipe dépose une vidéo dans « {name} », Chapote prépare la publication. Vous la vérifiez avant qu’elle parte.', { name: s.name })}</Txt>
      {!an && busy ? <Loading label={t('Lecture du rangement du dossier…')} /> : null}
      {!an && busy ? <Txt small muted center>{t('Lecture du rangement du dossier…')}</Txt> : null}
      {err ? <Msg kind="err">{err}</Msg> : null}
      {!an && !busy && err ? <Button title={t('Réessayer')} icon="refresh" onPress={analyze} /> : null}
      {an && recipe ? (
        <>
          <Label>{t('Exemple avec une de vos vidéos')}</Label>
          {examples[0] ? <Example x={examples[0]} /> : <Txt small muted>{t('Aucune vidéo dans le dossier pour l’instant.')}</Txt>}
          {examples.length > 1 ? (
            <Button kind="ghost" small style={{ alignSelf: 'flex-start' }} onPress={() => setMore(m => !m)}
              title={more ? t('Masquer les autres exemples') : examples.length > 2 ? t('Voir {n} autres exemples', { n: examples.length - 1 }) : t('Voir 1 autre exemple')} />
          ) : null}
          {more ? examples.slice(1).map(x => <Example key={x.asset_id} x={x} />) : null}

          <Label>{t('C’est juste ? Sinon, corrigez')}</Label>
          <Question title={t('Sur quels comptes ?')} summary={accountSummary(recipe, an, t)} open={open === 'acc'} onToggle={() => setOpen(open === 'acc' ? null : 'acc')}>
            <Choice radio label={t('Toujours les mêmes comptes')} checked={recipe.account.from === 'source'} onPress={() => set(r => { r.account.from = 'source' })} />
            {recipe.account.from === 'source' ? (
              <Select label={t('Comptes')} value={(recipe.account.map['*'] || [])[0] || ''}
                options={[['', t('Les comptes proposés par défaut pour ce dossier')], ...targets]}
                onChange={v => setRecipe(r => (r ? setMapping(r, '*', v) : r))} />
            ) : null}
            <Choice radio label={t('Ça dépend du sous-dossier (un dossier par compte ou par client)')} checked={recipe.account.from === 'folder'}
              onPress={() => set(r => { r.account.from = 'folder' })} />
            {recipe.account.from === 'folder' ? (
              <>
                {folders.map(f => (
                  <Select key={f} label={t('Dossier « {name} »', { name: f })} value={(recipe.account.map[f] || [])[0] || ''}
                    options={[['', t('Ne rien préparer')], ...targets]} onChange={v => setRecipe(r => (r ? setMapping(r, f, v) : r))} />
                ))}
                <Select label={t('Les comptes sont rangés plus profond ?')} value={recipe.account.level} options={LEVELS.map(([v, l]) => [v, t(l)] as [number, string])}
                  onChange={v => set(r => { r.account.level = v })} />
              </>
            ) : null}
          </Question>
          <Question title={t('Quand publier ?')} summary={whenSummary(recipe, an)} open={open === 'when'} onToggle={() => setOpen(open === 'when' ? null : 'when')}>
            <Select<DatePattern> label={t('Où lire la date')} value={recipe.when.pattern} options={PATTERNS.map(p => [p, t(patternLabel(p, an))])}
              onChange={v => set(r => { r.when.pattern = v })} />
            {recipe.when.pattern !== 'none' ? (
              <Field label={t('Heure si le nom n’en donne pas')} value={time} onChangeText={setTime} onBlur={commitTime} onSubmitEditing={commitTime}
                placeholder="18:00" keyboardType="numbers-and-punctuation" maxLength={5} hint={t('Au format 18:00.')} />
            ) : null}
          </Question>
          <Question title={t('Titre et légende ?')} summary={textSummary(recipe)} open={open === 'text'} onToggle={() => setOpen(open === 'text' ? null : 'text')}>
            <Select label={t('Le titre vient de')} value={recipe.title.from} options={(Object.keys(TITLE_FROM) as Recipe['title']['from'][]).map(k => [k, t(TITLE_FROM[k])])}
              onChange={v => set(r => { r.title.from = v })} />
            <Choice label={t('Légende : le fichier .txt posé à côté de la vidéo')} checked={recipe.caption.from === 'txt'}
              onPress={() => set(r => { r.caption.from = r.caption.from === 'txt' ? 'none' : 'txt' })} />
            <Choice label={t('Couverture : l’image posée à côté de la vidéo')} checked={recipe.cover.from === 'image'}
              onPress={() => set(r => { r.cover.from = r.cover.from === 'image' ? 'none' : 'image' })} />
          </Question>
          {!s.auto_drafts ? <Choice label={t('Préparer aussi les vidéos déjà dans le dossier')} checked={backlog} onPress={() => setBacklog(b => !b)} /> : null}
        </>
      ) : null}
    </Sheet>
  )
}
