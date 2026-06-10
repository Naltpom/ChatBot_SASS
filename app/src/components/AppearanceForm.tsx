// Contrôles d'apparence du widget — portés d'AppearanceControls (pages-bot.jsx).
// Réutilisés par la page bot ET le wizard.
import { useRef, useState } from 'react'
import { Image as ImageIcon } from 'lucide-react'
import { uploadImage } from '../api'
import { BubbleIcon, Field, Seg, Toggle } from '../ui'
import { GRADIENT_SECOND_COLORS, WIDGET_BRAND_COLORS } from '../botConstants'

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

export default function AppearanceForm({ design, botName, onChange, onNameChange, compact = false }: Props) {
  const d = design || {}
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

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
      <Field label="Nom du bot">
        <input type="text" value={botName} onChange={e => onNameChange(e.target.value)} />
      </Field>

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

      <Field label="Arrondi">
        <input type="range" min={4} max={24} value={d.borderRadius ?? 16}
               onChange={e => onChange({ borderRadius: Number(e.target.value) })} />
      </Field>

      <div className="toggle-row">
        <div>
          <div className="tl">Liseré</div>
          <div className="ts">Bordure blanche autour de la bulle</div>
        </div>
        <Toggle on={!!d.bordered} onChange={v => onChange({ bordered: v })} />
      </div>

      <Field label="Animation de chargement">
        <Seg small value={d.loadingAnimation || 'dots'} onChange={v => onChange({ loadingAnimation: v })}
             options={[
               { value: 'dots', label: '⋯ Dots' },
               { value: 'wave', label: '∿ Wave' },
               { value: 'pulse', label: '◉ Pulse' },
             ]} />
      </Field>
    </div>
  )
}
