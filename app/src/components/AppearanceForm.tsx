// Contrôles d'apparence du widget — portés d'AppearanceControls (pages-bot.jsx).
// Réutilisés par la page bot ET le wizard (compact : sections affinables masquées).
// Parité STRICTE : chaque clé écrite ici est lue par WidgetPreview ET
// widget/widget.js, et bornée côté serveur (routers/widget.py _sanitize_design).
import { ReactNode, useRef, useState } from 'react'
import { Image as ImageIcon } from 'lucide-react'
import { uploadImage } from '../api'
import { BubbleIcon, Field, Seg, Toggle } from '../ui'
import { APPEARANCE_PRESETS, AppearancePreset, GRADIENT_SECOND_COLORS, WIDGET_BRAND_COLORS } from '../botConstants'

interface Props {
  design: Record<string, any>
  botName: string
  onChange: (partial: Record<string, any>) => void
  onNameChange: (name: string) => void
  compact?: boolean
}

function ColorDots({ colors, value, onPick }: { colors: string[]; value: string; onPick: (c: string) => void }) {
  return (
    <div className="color-dots">
      {colors.map(c => (
        <button key={c} className={`color-dot ${value === c ? 'selected' : ''}`}
                style={{ background: c }} aria-label={c} onClick={() => onPick(c)} />
      ))}
      <input type="color" value={value || '#0d9488'} onChange={e => onPick(e.target.value)}
             title="Couleur personnalisée"
             style={{ width: 28, height: 28, padding: 0, border: '1px solid var(--border2)', borderRadius: 99, cursor: 'pointer', background: 'none' }} />
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="af-sec">{children}</div>
}

// Le preset est « sélectionné » si toutes ses clés matchent le design courant
// (avec les mêmes défauts que le widget pour les clés absentes).
function presetMatches(d: Record<string, any>, p: AppearancePreset): boolean {
  const current: Record<string, any> = {
    primaryColor: d.primaryColor || '#0d9488',
    secondaryColor: d.secondaryColor || null,
    headerStyle: d.headerStyle === 'soft' ? 'soft' : 'solid',
    darkMode: d.darkMode === true,
    bubbleStyle: d.bubbleStyle === 'square' ? 'square' : 'rounded',
    font: ['system', 'serif', 'mono'].includes(d.font) ? d.font : 'system',
    bordered: !!d.bordered,
    loadingAnimation: ['dots', 'wave', 'pulse'].includes(d.loadingAnimation) ? d.loadingAnimation : 'dots',
  }
  return Object.entries(p.values).every(([k, v]) => current[k] === (v ?? null))
}

export default function AppearanceForm({ design, botName, onChange, onNameChange, compact = false }: Props) {
  const d = design || {}
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  const ox = typeof d.offsetX === 'number' ? Math.max(0, Math.min(120, d.offsetX)) : 18
  const oy = typeof d.offsetY === 'number' ? Math.max(0, Math.min(120, d.offsetY)) : 18

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setUploading(true)
    setUploadError('')
    try {
      const url = await uploadImage(f)
      onChange({ avatarImage: url, icon: 'image' })
    } catch (err: any) {
      setUploadError(err.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="col" style={{ gap: compact ? 12 : 14 }}>
      {/* ---------- Thèmes : presets à fort impact (merge partiel) ---------- */}
      <SectionLabel>Thèmes</SectionLabel>
      <div className="preset-grid">
        {APPEARANCE_PRESETS.map(p => (
          <button key={p.id} className={`preset-card ${presetMatches(d, p) ? 'selected' : ''}`}
                  onClick={() => onChange({ ...p.values })}>
            <span className="preset-dots">
              <span className="p-dot" style={{ background: p.values.primaryColor }} />
              <span className="p-dot p-dot2" style={{ background: p.values.secondaryColor || p.values.primaryColor }} />
              {p.values.darkMode && <span className="p-dark" />}
            </span>
            <span className="preset-name">{p.name}</span>
          </button>
        ))}
      </div>

      {/* ---------- Identité ---------- */}
      <SectionLabel>Identité</SectionLabel>
      <Field label="Nom du bot">
        <input type="text" value={botName} onChange={e => onNameChange(e.target.value)} />
      </Field>

      {!compact && (
        <Field label="Titre du widget" hint="Vide : le nom du bot est affiché.">
          <input type="text" maxLength={100} value={d.title || ''} placeholder={botName}
                 onChange={e => onChange({ title: e.target.value })} />
        </Field>
      )}

      <Field label="Couleur de marque">
        <ColorDots colors={WIDGET_BRAND_COLORS} value={d.primaryColor} onPick={c => onChange({ primaryColor: c })} />
      </Field>

      <div className="toggle-row">
        <div className="tl">Dégradé</div>
        <Toggle on={!!d.secondaryColor} onChange={v => onChange({ secondaryColor: v ? '#7c2d92' : null })} />
      </div>
      {d.secondaryColor && (
        <Field label="Seconde couleur">
          <ColorDots colors={GRADIENT_SECOND_COLORS} value={d.secondaryColor} onPick={c => onChange({ secondaryColor: c })} />
        </Field>
      )}

      <Field label="Icône de la bulle">
        <div className="row g8" style={{ flexWrap: 'wrap' }}>
          {['chat', 'spark', 'help'].map(k => (
            <button key={k} className={`icon-pick ${d.icon === k ? 'selected' : ''}`} onClick={() => onChange({ icon: k })}>
              <BubbleIcon kind={k} size={19} />
            </button>
          ))}
          <button className={`icon-pick ${d.icon === 'image' ? 'selected' : ''}`}
                  title="Image personnalisée"
                  onClick={() => d.avatarImage ? onChange({ icon: 'image' }) : fileRef.current?.click()}>
            {d.avatarImage
              ? <img src={d.avatarImage} alt="" style={{ width: 26, height: 26, borderRadius: 7, objectFit: 'cover' }} />
              : <ImageIcon size={17} />}
          </button>
          <button className="link-btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? 'Envoi…' : d.avatarImage ? 'Changer…' : 'Importer une image…'}
          </button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" hidden onChange={onFile} />
        </div>
        {uploadError && <div className="field-hint" style={{ color: 'var(--danger)' }}>{uploadError}</div>}
      </Field>

      {/* ---------- Bulle de lancement ---------- */}
      <SectionLabel>Bulle de lancement</SectionLabel>
      <div className="grid2" style={{ gap: 10 }}>
        <Field label="Taille">
          <Seg small value={d.size || 'md'} onChange={v => onChange({ size: v })}
               options={[{ value: 'sm', label: 'S' }, { value: 'md', label: 'M' }, { value: 'lg', label: 'L' }]} />
        </Field>
        <Field label="Emplacement">
          <Seg small value={d.position || 'right'} onChange={v => onChange({ position: v })}
               options={[{ value: 'left', label: 'Gauche' }, { value: 'right', label: 'Droite' }]} />
        </Field>
      </div>

      <Field label="Texte du lanceur" hint="Transforme la bulle en pilule avec libellé.">
        <input type="text" maxLength={40} value={d.launcherText || ''} placeholder="ex. Une question ?"
               onChange={e => onChange({ launcherText: e.target.value })} />
      </Field>

      <div className="toggle-row">
        <div>
          <div className="tl">Liseré</div>
          <div className="ts">Bordure blanche autour de la bulle</div>
        </div>
        <Toggle on={!!d.bordered} onChange={v => onChange({ bordered: v })} />
      </div>

      {!compact && (
        <div className="grid2" style={{ gap: 10 }}>
          <Field label={`Marge latérale — ${ox} px`}>
            <input type="range" min={0} max={120} value={ox}
                   onChange={e => onChange({ offsetX: Number(e.target.value) })} />
          </Field>
          <Field label={`Marge basse — ${oy} px`}>
            <input type="range" min={0} max={120} value={oy}
                   onChange={e => onChange({ offsetY: Number(e.target.value) })} />
          </Field>
        </div>
      )}

      {/* ---------- Fenêtre ---------- */}
      <SectionLabel>Fenêtre</SectionLabel>
      <Field label="Arrondi">
        <input type="range" min={4} max={24} value={d.borderRadius ?? 16}
               onChange={e => onChange({ borderRadius: Number(e.target.value) })} />
      </Field>

      {!compact && (
        <>
          <Field label="Style d'en-tête">
            <Seg small value={d.headerStyle === 'soft' ? 'soft' : 'solid'} onChange={v => onChange({ headerStyle: v })}
                 options={[{ value: 'solid', label: 'Couleur' }, { value: 'soft', label: 'Clair' }]} />
          </Field>
          <div className="toggle-row">
            <div>
              <div className="tl">Mode sombre</div>
              <div className="ts">Surfaces sombres, votre couleur conservée</div>
            </div>
            <Toggle on={d.darkMode === true} onChange={v => onChange({ darkMode: v })} />
          </div>
          <Field label="Densité">
            <Seg small value={d.density === 'compact' ? 'compact' : 'cozy'} onChange={v => onChange({ density: v })}
                 options={[{ value: 'cozy', label: 'Normale' }, { value: 'compact', label: 'Compacte' }]} />
          </Field>
          <Field label="Police">
            <Seg small value={['serif', 'mono'].includes(d.font) ? d.font : 'system'} onChange={v => onChange({ font: v })}
                 options={[{ value: 'system', label: 'Standard' }, { value: 'serif', label: 'Serif' }, { value: 'mono', label: 'Mono' }]} />
          </Field>
          <Field label="Style des bulles">
            <Seg small value={d.bubbleStyle === 'square' ? 'square' : 'rounded'} onChange={v => onChange({ bubbleStyle: v })}
                 options={[{ value: 'rounded', label: 'Arrondies' }, { value: 'square', label: 'Carrées' }]} />
          </Field>
        </>
      )}

      {/* ---------- Messages ---------- */}
      <SectionLabel>Messages</SectionLabel>
      {!compact && (
        <>
          {/* locale : clé HORS presets (presetMatches ne la considère pas) — le
              BotOut sert design_json BRUT, souvent sans la clé → lecture
              défensive, défaut fr (= rendu historique du widget). */}
          <Field label="Langue du widget"
                 hint={'Traduit les textes d\'interface du widget (placeholders, formulaire de contact, erreurs). Le contenu de l\'arbre et les messages des déclencheurs restent dans la langue où vous les avez écrits. "Auto" suit la langue du navigateur et demande aussi à l\'IA de répondre dans la langue du visiteur.'}>
            <Seg small value={['auto', 'en'].includes(d.locale) ? d.locale : 'fr'} onChange={v => onChange({ locale: v })}
                 options={[{ value: 'auto', label: 'Auto' }, { value: 'fr', label: 'Français' }, { value: 'en', label: 'English' }]} />
          </Field>
          <Field label="Message d'accueil (mode IA)"
                 hint="Premier message quand le bot est en mode IA pur. En mode arbre/hybride, c'est le message d'accueil de l'arbre.">
            <textarea rows={2} maxLength={500} value={d.welcomeMessage || ''}
                      onChange={e => onChange({ welcomeMessage: e.target.value })} />
          </Field>
          <Field label="Placeholder de saisie">
            <input type="text" maxLength={100} value={d.placeholder || ''} placeholder="Écrivez votre message…"
                   onChange={e => onChange({ placeholder: e.target.value })} />
          </Field>
        </>
      )}
      <Field label="Animation de chargement">
        <Seg small value={d.loadingAnimation || 'dots'} onChange={v => onChange({ loadingAnimation: v })}
             options={[
               { value: 'dots', label: 'Points' },
               { value: 'wave', label: 'Vague' },
               { value: 'pulse', label: 'Pulsation' },
             ]} />
      </Field>
    </div>
  )
}
