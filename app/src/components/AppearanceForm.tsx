// Contrôles d'apparence du widget — montés par AppearanceTab, une SECTION à la
// fois. Découpage PAR ZONE du widget : Couleurs / Lanceur / En-tête / Fenêtre /
// Conversation. Chaque section rend une mosaïque de cartes sur 2 colonnes
// (.grid2). Les réglages dépendants sont co-localisés (ex. statut + libellé).
// Parité STRICTE : chaque clé écrite ici est lue par WidgetPreview ET
// widget/widget.js, et bornée côté serveur (routers/widget_helpers.py
// _sanitize_design).
import { ReactNode, useRef, useState } from 'react'
import { Image as ImageIcon, Lock, Sparkles } from 'lucide-react'
import { uploadImage } from '../api'
import { BubbleIcon, Card, Field, Seg, Toggle } from '../ui'
import { APPEARANCE_PRESETS, AppearancePreset, GRADIENT_SECOND_COLORS, WIDGET_BRAND_COLORS, surpriseDesign } from '../botConstants'
import type { DesignJson } from '../types/bot'
import { errMsg } from '../utils/errors'

// Section de contrôles affichée (pilotée par le sous-onglet d'AppearanceTab).
export type AppearanceSection = 'colors' | 'launcher' | 'header' | 'window' | 'conversation'

interface Props {
  design: DesignJson
  botName: string
  section: AppearanceSection
  onChange: (partial: Partial<DesignJson>) => void
  onNameChange: (name: string) => void
  // Module White-label non débloqué pour ce bot : on garde la mention « Propulsé
  // par » réglable (pour l'aperçu) mais on la verrouille avec un renvoi facturation.
  whiteLabelLocked: boolean
  onUpgrade: () => void
}

// Texte sombre posé sur une couleur de marque claire (même encre que les textes du widget).
const DARK_ON_PRIMARY = '#1d2b27'

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

// Étiquette MAJUSCULE en tête de carte.
function CardLabel({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--faint)', marginBottom: 12 }}>{children}</div>
}

// Le preset est « sélectionné » si toutes ses clés matchent le design courant
// (avec les mêmes défauts que le widget pour les clés absentes).
function presetMatches(d: DesignJson, p: AppearancePreset): boolean {
  const current: Record<string, unknown> = {
    primaryColor: d.primaryColor || '#0d9488',
    secondaryColor: d.secondaryColor || null,
    headerStyle: d.headerStyle === 'soft' ? 'soft' : (d.headerStyle === 'gradient' ? 'gradient' : 'solid'),
    darkMode: d.darkMode === true,
    bubbleStyle: d.bubbleStyle === 'square' ? 'square' : 'rounded',
    font: d.font && ['system', 'serif', 'mono'].includes(d.font) ? d.font : 'system',
    bordered: !!d.bordered,
    loadingAnimation: d.loadingAnimation && ['dots', 'wave', 'pulse', 'bars', 'ring', 'typing'].includes(d.loadingAnimation) ? d.loadingAnimation : 'dots',
  }
  return Object.entries(p.values).every(([k, v]) => current[k] === (v ?? null))
}

export default function AppearanceForm({ design, botName, section, onChange, onNameChange, whiteLabelLocked, onUpgrade }: Props) {
  const d = design || {}
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  const ox = typeof d.offsetX === 'number' ? Math.max(0, Math.min(120, d.offsetX)) : 18
  const oy = typeof d.offsetY === 'number' ? Math.max(0, Math.min(120, d.offsetY)) : 18
  // Défaut 338 = largeur ACTUELLE codée en dur du panneau widget (parité : les
  // autres couches retombent aussi sur 338 quand la clé est absente).
  const winW = typeof d.windowWidth === 'number' ? Math.max(300, Math.min(560, d.windowWidth)) : 338
  // Hauteur : null/absente = auto (selon densité, = hauteur historique).
  const winH = typeof d.windowHeight === 'number' ? Math.max(360, Math.min(720, d.windowHeight)) : (d.density === 'compact' ? 420 : 460)
  const shadow = typeof d.shadow === 'number' ? Math.max(0, Math.min(3, d.shadow)) : 2

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setUploading(true)
    setUploadError('')
    try {
      const url = await uploadImage(f)
      onChange({ avatarImage: url, icon: 'image' })
    } catch (err: unknown) {
      setUploadError(errMsg(err))
    } finally {
      setUploading(false)
    }
  }

  // ==================================================================== COULEURS
  if (section === 'colors') {
    return (
      <div className="grid2">
        {/* Presets — pleine largeur */}
        <Card style={{ gridColumn: '1 / -1' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--faint)' }}>
              Thèmes prêts à l'emploi
            </div>
            <button className="link-btn" onClick={() => onChange(surpriseDesign())}>
              <Sparkles size={13} /> Surprends-moi
            </button>
          </div>
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
        </Card>

        {/* Couleur de marque */}
        <Card>
          <CardLabel>Couleur de marque</CardLabel>
          <div className="col" style={{ gap: 12 }}>
            <Field label="Couleur de marque" hint="Une pastille, ou la pipette pour une teinte personnalisée.">
              <ColorDots colors={WIDGET_BRAND_COLORS} value={d.primaryColor || ''} onPick={c => onChange({ primaryColor: c })} />
            </Field>
            <Field label="Texte sur la couleur" hint="Choisissez « Sombre » si votre couleur est claire (jaune, orange clair…).">
              <Seg small value={d.onPrimary && d.onPrimary.toLowerCase() !== '#fff' && d.onPrimary.toLowerCase() !== '#ffffff' ? 'dark' : 'light'}
                   onChange={v => onChange({ onPrimary: v === 'dark' ? DARK_ON_PRIMARY : null })}
                   options={[{ value: 'light', label: 'Blanc' }, { value: 'dark', label: 'Sombre' }]} />
            </Field>
            <div className="toggle-row">
              <div className="tl">Dégradé</div>
              <Toggle label="Dégradé" on={!!d.secondaryColor} onChange={v => onChange({ secondaryColor: v ? '#7c2d92' : null })} />
            </div>
            {d.secondaryColor && (
              <Field label="Seconde couleur">
                <ColorDots colors={GRADIENT_SECOND_COLORS} value={d.secondaryColor} onPick={c => onChange({ secondaryColor: c })} />
              </Field>
            )}
            <div className="toggle-row">
              <div>
                <div className="tl">Mode sombre</div>
                <div className="ts">Surfaces sombres, votre couleur conservée</div>
              </div>
              <Toggle label="Mode sombre" on={d.darkMode === true} onChange={v => onChange({ darkMode: v })} />
            </div>
            {d.darkMode === true && (
              <Field label="Teinte du mode sombre" hint="« Neutre » : gris foncé, mieux sur les sites aux tons chauds.">
                <Seg small value={d.surfaceTone === 'neutral' ? 'neutral' : 'classic'}
                     onChange={v => onChange({ surfaceTone: v as DesignJson['surfaceTone'] })}
                     options={[{ value: 'classic', label: 'Classique' }, { value: 'neutral', label: 'Neutre' }]} />
              </Field>
            )}
          </div>
        </Card>

        {/* Surfaces & boutons */}
        <Card>
          <CardLabel>Surfaces &amp; boutons</CardLabel>
          <div className="col" style={{ gap: 12 }}>
            <Field label="Fond de la conversation">
              <Seg small value={d.chatBg && ['soft', 'pattern'].includes(d.chatBg) ? d.chatBg : 'plain'} onChange={v => onChange({ chatBg: v as DesignJson['chatBg'] })}
                   options={[{ value: 'plain', label: 'Uni' }, { value: 'soft', label: 'Dégradé' }, { value: 'pattern', label: 'Motif' }]} />
            </Field>
            <Field label="Couleur des boutons" hint="« Marque » : suit la couleur principale. « Accent » : couleur dédiée.">
              <Seg small value={d.accentColor ? 'accent' : 'brand'}
                   onChange={v => onChange({ accentColor: v === 'accent' ? (d.accentColor || d.primaryColor || '#0d9488') : null })}
                   options={[{ value: 'brand', label: 'Marque' }, { value: 'accent', label: 'Accent' }]} />
            </Field>
            {d.accentColor && (
              <Field label="Couleur d'accent">
                <ColorDots colors={WIDGET_BRAND_COLORS} value={d.accentColor} onPick={c => onChange({ accentColor: c })} />
              </Field>
            )}
          </div>
        </Card>
      </div>
    )
  }

  // ==================================================================== LANCEUR
  if (section === 'launcher') {
    // « Forme du lanceur » est ignorée quand un texte de lanceur est saisi (le
    // texte force une pilule à libellé) : on grise le contrôle pour le signaler.
    const launcherTextSet = !!(d.launcherText || '').trim()
    return (
      <div className="grid2">
        {/* Bulle & forme */}
        <Card>
          <CardLabel>Bulle &amp; forme</CardLabel>
          <div className="col" style={{ gap: 12 }}>
            <Field label="Icône de la bulle">
              <div className="row g8" style={{ flexWrap: 'wrap' }}>
                {['chat', 'spark', 'help', 'bot', 'message', 'headset', 'smile', 'zap'].map(k => (
                  <button key={k} className={`icon-pick ${d.icon === k ? 'selected' : ''}`} onClick={() => onChange({ icon: k as DesignJson['icon'] })}>
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
            <Field label="Forme du lanceur"
                   hint={launcherTextSet
                     ? 'Désactivée : un texte de lanceur force la pilule à libellé.'
                     : 'Géométrie de la bulle sans texte.'}>
              <div style={launcherTextSet ? { opacity: .45, pointerEvents: 'none' } : undefined}>
                <Seg small value={d.launcherShape && ['pill', 'square'].includes(d.launcherShape) ? d.launcherShape : 'round'} onChange={v => onChange({ launcherShape: v as DesignJson['launcherShape'] })}
                     options={[{ value: 'round', label: 'Ronde' }, { value: 'pill', label: 'Pilule' }, { value: 'square', label: 'Carrée' }]} />
              </div>
            </Field>
            <div className="grid2" style={{ gap: 10 }}>
              <Field label="Taille">
                <Seg small value={d.size || 'md'} onChange={v => onChange({ size: v as DesignJson['size'] })}
                     options={[{ value: 'sm', label: 'S' }, { value: 'md', label: 'M' }, { value: 'lg', label: 'L' }]} />
              </Field>
              <Field label="Emplacement">
                <Seg small value={d.position || 'right'} onChange={v => onChange({ position: v as DesignJson['position'] })}
                     options={[{ value: 'left', label: 'Gauche' }, { value: 'right', label: 'Droite' }]} />
              </Field>
            </div>
            <Field label="Animation au repos" hint="Animation de la bulle fermée.">
              <Seg small value={d.launcherAnimation && ['float', 'pulse'].includes(d.launcherAnimation) ? d.launcherAnimation : 'none'} onChange={v => onChange({ launcherAnimation: v as DesignJson['launcherAnimation'] })}
                   options={[{ value: 'none', label: 'Aucune' }, { value: 'float', label: 'Flottante' }, { value: 'pulse', label: 'Pulsation' }]} />
            </Field>
          </div>
        </Card>

        {/* Accroche & placement */}
        <Card>
          <CardLabel>Accroche &amp; placement</CardLabel>
          <div className="col" style={{ gap: 12 }}>
            <div className="toggle-row">
              <div>
                <div className="tl">Bulle d'accroche</div>
                <div className="ts">Petit message au-dessus de la bulle fermée</div>
              </div>
              <Toggle label="Bulle d'accroche" on={d.greeting === true} onChange={v => onChange({ greeting: v })} />
            </div>
            {d.greeting && (
              <Field label="Texte de l'accroche">
                <input type="text" maxLength={80} value={d.greetingText || ''} placeholder="Une question ? 👋"
                       onChange={e => onChange({ greetingText: e.target.value })} />
              </Field>
            )}
            <Field label="Texte du lanceur" hint="Transforme la bulle en pilule avec libellé.">
              <input type="text" maxLength={40} value={d.launcherText || ''} placeholder="ex. Une question ?"
                     onChange={e => onChange({ launcherText: e.target.value })} />
            </Field>
            <div className="toggle-row">
              <div>
                <div className="tl">Pastille « 1 »</div>
                <div className="ts">Petit rond rouge sur la bulle fermée, pour attirer l'œil</div>
              </div>
              <Toggle label="Pastille « 1 »" on={d.launcherBadge !== false} onChange={v => onChange({ launcherBadge: v })} />
            </div>
            <div className="toggle-row">
              <div>
                <div className="tl">Liseré</div>
                <div className="ts">Bordure blanche autour de la bulle</div>
              </div>
              <Toggle label="Liseré" on={!!d.bordered} onChange={v => onChange({ bordered: v })} />
            </div>
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
          </div>
        </Card>
      </div>
    )
  }

  // ==================================================================== EN-TÊTE
  if (section === 'header') {
    const headerStyle = d.headerStyle === 'soft' ? 'soft' : (d.headerStyle === 'gradient' ? 'gradient' : 'solid')
    return (
      <div className="grid2">
        {/* Identité */}
        <Card>
          <CardLabel>Identité</CardLabel>
          <div className="col" style={{ gap: 12 }}>
            <Field label="Nom du bot">
              <input type="text" value={botName} onChange={e => onNameChange(e.target.value)} />
            </Field>
            <Field label="Titre du widget" hint="Vide : le nom du bot est affiché.">
              <input type="text" maxLength={100} value={d.title || ''} placeholder={botName}
                     onChange={e => onChange({ title: e.target.value })} />
            </Field>
          </div>
        </Card>

        {/* Barre d'en-tête */}
        <Card>
          <CardLabel>Barre d'en-tête</CardLabel>
          <div className="col" style={{ gap: 12 }}>
            <Field label="Style d'en-tête">
              <Seg small value={headerStyle} onChange={v => onChange({ headerStyle: v as DesignJson['headerStyle'] })}
                   options={[{ value: 'solid', label: 'Couleur' }, { value: 'soft', label: 'Clair' }, { value: 'gradient', label: 'Dégradé' }]} />
            </Field>
            <div className="toggle-row">
              <div className="tl">Avatar dans l'en-tête</div>
              <Toggle label="Avatar dans l'en-tête" on={d.headerAvatar !== false} onChange={v => onChange({ headerAvatar: v })} />
            </div>
            {/* Statut + libellé CO-LOCALISÉS (le libellé n'a d'effet que si le
                statut est activé : on ne l'affiche donc que dans ce cas). */}
            <div className="toggle-row">
              <div>
                <div className="tl">Statut « En ligne »</div>
                <div className="ts">Pastille + libellé sous le titre</div>
              </div>
              <Toggle label="Statut « En ligne »" on={d.headerStatus === true} onChange={v => onChange({ headerStatus: v })} />
            </div>
            {d.headerStatus && (
              <Field label="Libellé du statut" hint="Vide : « En ligne ».">
                <input type="text" maxLength={60} value={d.statusLabel || ''} placeholder="En ligne"
                       onChange={e => onChange({ statusLabel: e.target.value })} />
              </Field>
            )}
          </div>
        </Card>
      </div>
    )
  }

  // ==================================================================== FENÊTRE
  if (section === 'window') {
    return (
      <div className="grid2">
        {/* Dimensions */}
        <Card>
          <CardLabel>Dimensions</CardLabel>
          <div className="col" style={{ gap: 12 }}>
            <Field label={`Largeur du panneau — ${winW} px`}>
              <input type="range" min={300} max={560} value={winW}
                     onChange={e => onChange({ windowWidth: Number(e.target.value) })} />
            </Field>
            <Field label={`Hauteur du panneau — ${winH} px`}>
              <input type="range" min={360} max={720} value={winH}
                     onChange={e => onChange({ windowHeight: Number(e.target.value) })} />
            </Field>
            <Field label="Arrondi des coins">
              <input type="range" min={4} max={24} value={d.borderRadius ?? 16}
                     onChange={e => onChange({ borderRadius: Number(e.target.value) })} />
            </Field>
            <Field label={`Ombre — ${['Aucune', 'Légère', 'Moyenne', 'Forte'][shadow]}`}>
              <input type="range" min={0} max={3} value={shadow}
                     onChange={e => onChange({ shadow: Number(e.target.value) })} />
            </Field>
          </div>
        </Card>

        {/* Affichage */}
        <Card>
          <CardLabel>Affichage</CardLabel>
          <div className="col" style={{ gap: 12 }}>
            <Field label="Densité">
              <Seg small value={d.density === 'compact' ? 'compact' : 'cozy'} onChange={v => onChange({ density: v as DesignJson['density'] })}
                   options={[{ value: 'cozy', label: 'Normale' }, { value: 'compact', label: 'Compacte' }]} />
            </Field>
            <Field label="Animation d'ouverture">
              <Seg small value={d.openAnimation && ['fade', 'slide', 'pop', 'flip'].includes(d.openAnimation) ? d.openAnimation : 'zoom'} onChange={v => onChange({ openAnimation: v as DesignJson['openAnimation'] })}
                   options={[{ value: 'zoom', label: 'Zoom' }, { value: 'fade', label: 'Fondu' }, { value: 'slide', label: 'Glissé' }, { value: 'pop', label: 'Pop' }, { value: 'flip', label: 'Bascule' }]} />
            </Field>
            {/* « Propulsé par » : la retirer en production nécessite le module
                White-label. On laisse le toggle ACTIF (pour tester le visuel dans
                l'aperçu) mais on pose un cadenas + renvoi facturation si non débloqué. */}
            <div className="toggle-row"
                 style={whiteLabelLocked ? { background: 'var(--warn-soft)', border: '1px solid var(--warn-bd)', borderRadius: 10, padding: '11px 12px' } : undefined}>
              <div>
                <div className="tl" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {whiteLabelLocked && <Lock size={13} style={{ color: 'var(--warn)', flexShrink: 0 }} />}
                  Mention « Propulsé par »
                </div>
                {whiteLabelLocked ? (
                  <div className="ts">
                    Aperçu libre, mais la <strong>retirer en production</strong> demande le module White-label.{' '}
                    <button type="button" className="link-btn" onClick={onUpgrade}>Ajouter à mon abonnement →</button>
                  </div>
                ) : (
                  <div className="ts">Lien discret en pied de widget</div>
                )}
              </div>
              <Toggle label="Mention « Propulsé par »" on={d.poweredBy !== false} onChange={v => onChange({ poweredBy: v })} />
            </div>
          </div>
        </Card>
      </div>
    )
  }

  // =============================================================== CONVERSATION
  // locale : clé HORS presets (presetMatches ne la considère pas) — le BotOut
  // sert design_json BRUT, souvent sans la clé → lecture défensive, défaut fr
  // (= rendu historique du widget).
  return (
    <div className="grid2">
      {/* Texte & bulles */}
      <Card>
        <CardLabel>Texte &amp; bulles</CardLabel>
        <div className="col" style={{ gap: 12 }}>
          <div className="grid2" style={{ gap: 10 }}>
            <Field label="Police">
              <Seg small value={d.font && ['serif', 'mono'].includes(d.font) ? d.font : 'system'} onChange={v => onChange({ font: v as DesignJson['font'] })}
                   options={[{ value: 'system', label: 'Standard' }, { value: 'serif', label: 'Serif' }, { value: 'mono', label: 'Mono' }]} />
            </Field>
            <Field label="Taille du texte">
              <Seg small value={d.textScale && ['sm', 'lg'].includes(d.textScale) ? d.textScale : 'md'} onChange={v => onChange({ textScale: v as DesignJson['textScale'] })}
                   options={[{ value: 'sm', label: 'S' }, { value: 'md', label: 'M' }, { value: 'lg', label: 'L' }]} />
            </Field>
          </div>
          <Field label="Style des bulles">
            <Seg small value={d.bubbleStyle === 'square' ? 'square' : 'rounded'} onChange={v => onChange({ bubbleStyle: v as DesignJson['bubbleStyle'] })}
                 options={[{ value: 'rounded', label: 'Arrondies' }, { value: 'square', label: 'Carrées' }]} />
          </Field>
          <Field label="Ergot des bulles" hint="Coin asymétrique « bulle de BD ».">
            <Seg small value={d.bubbleTail === false ? 'off' : 'on'} onChange={v => onChange({ bubbleTail: v === 'on' })}
                 options={[{ value: 'on', label: 'Avec' }, { value: 'off', label: 'Sans' }]} />
          </Field>
          <div className="toggle-row">
            <div className="tl">Horodatage des messages</div>
            <Toggle label="Horodatage des messages" on={d.timestamps === true} onChange={v => onChange({ timestamps: v })} />
          </div>
        </div>
      </Card>

      {/* Interactions */}
      <Card>
        <CardLabel>Interactions</CardLabel>
        <div className="col" style={{ gap: 12 }}>
          <Field label="Animation de chargement">
            <Seg small value={d.loadingAnimation && ['wave', 'pulse', 'bars', 'ring', 'typing'].includes(d.loadingAnimation) ? d.loadingAnimation : 'dots'} onChange={v => onChange({ loadingAnimation: v as DesignJson['loadingAnimation'] })}
                 options={[
                   { value: 'dots', label: 'Points' },
                   { value: 'wave', label: 'Vague' },
                   { value: 'pulse', label: 'Pulsation' },
                   { value: 'bars', label: 'Barres' },
                   { value: 'ring', label: 'Anneau' },
                   { value: 'typing', label: 'Saisie' },
                 ]} />
          </Field>
          <Field label="Style des réponses rapides" hint="Apparence des boutons d'options.">
            <Seg small value={d.quickReplyStyle === 'button' ? 'button' : 'pill'} onChange={v => onChange({ quickReplyStyle: v as DesignJson['quickReplyStyle'] })}
                 options={[{ value: 'pill', label: 'Pilules' }, { value: 'button', label: 'Boutons' }]} />
          </Field>
          <Field label="Bouton d'envoi">
            <Seg small value={d.sendStyle === 'colored' ? 'colored' : 'icon'} onChange={v => onChange({ sendStyle: v as DesignJson['sendStyle'] })}
                 options={[{ value: 'icon', label: 'Icône' }, { value: 'colored', label: 'Coloré' }]} />
          </Field>
          <div className="toggle-row">
            <div>
              <div className="tl">Son à la réception</div>
              <div className="ts">Petit « ping » quand le bot répond</div>
            </div>
            <Toggle label="Son à la réception" on={d.sound === true} onChange={v => onChange({ sound: v })} />
          </div>
        </div>
      </Card>

      {/* Contenu — pleine largeur */}
      <Card style={{ gridColumn: '1 / -1' }}>
        <CardLabel>Contenu</CardLabel>
        <div className="col" style={{ gap: 12 }}>
          <Field label="Langue du widget"
                 hint={'Traduit les textes d\'interface du widget (placeholders, formulaire de contact, erreurs). Le contenu de l\'arbre et les messages des déclencheurs restent dans la langue où vous les avez écrits. "Auto" suit la langue du navigateur et demande aussi à l\'IA de répondre dans la langue du visiteur.'}>
            <Seg small value={d.locale && ['auto', 'en'].includes(d.locale) ? d.locale : 'fr'} onChange={v => onChange({ locale: v as DesignJson['locale'] })}
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
        </div>
      </Card>
    </div>
  )
}
