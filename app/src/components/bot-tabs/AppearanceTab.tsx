// Onglet « Apparence » de BotPage — extrait de l'inline historique. Contrôles
// en pleine largeur, organisés en sous-onglets (Thème/Lanceur/Fenêtre/Messages)
// au-dessus du formulaire ; l'aperçu live est désormais le widget flottant géré
// par BotPage (plus de colonne d'aperçu ici). « Déclencheurs proactifs » est
// rangé dans le sous-onglet Messages ; « Comportement » (mode) vit désormais
// dans l'onglet Arbre. Présentationnel : état/handlers viennent de BotPage.
//
// La barre de sous-onglets + le formulaire sont délégués à AppearancePanel
// (composant PARTAGÉ avec l'éditeur d'apparence embarqué) ; la carte
// « Déclencheurs proactifs » reste ici, injectée via renderExtra pour la section
// Conversation (l'état du sous-onglet vit dans AppearancePanel).
import { Plus } from 'lucide-react'
import { Btn, Card, Chip, Field, SectionTitle, Seg, Toggle } from '../../ui'
import AppearancePanel from '../AppearancePanel'
import type { Bot, BotUpdate, Trigger } from '../../types/bot'

export default function AppearanceTab({
  bot, patch, patchDesign,
  updateTrigger, updateTriggerType, addTrigger, removeTrigger,
  previewOpen, setPreviewOpen, previewSide, setPreviewSide,
  whiteLabelLocked, onUpgrade,
}: {
  bot: Bot
  patch: (fields: BotUpdate) => void
  patchDesign: (fields: Record<string, unknown>) => void
  // Props encore passées par BotPage (aperçu désormais flottant) — conservées
  // dans le contrat pour ne pas casser le site d'appel ; non utilisées ici.
  isMobile?: boolean
  site?: string
  orgName?: string
  updateTrigger: (i: number, fields: Partial<Trigger>) => void
  updateTriggerType: (i: number, v: string) => void
  addTrigger: () => void
  removeTrigger: (i: number) => void
  // Pilotage de la DÉMO flottante (état dans BotPage) : ouvrir/fermer le panneau
  // et choisir le côté d'affichage de l'aperçu (n'affecte pas la position réelle).
  previewOpen: boolean
  setPreviewOpen: (v: boolean) => void
  previewSide: 'left' | 'right'
  setPreviewSide: (v: 'left' | 'right') => void
  // Verrou White-label sur « Propulsé par » (cf. AppearanceForm).
  whiteLabelLocked: boolean
  onUpgrade: () => void
}) {
  const triggers = bot.triggers_json || []
  return (
    <div className="col g18">
      <SectionTitle
        sub="Personnalisez le widget aux couleurs du site client. L'aperçu flottant suit vos changements. Le côté de l'aperçu sert juste à le pousser hors des réglages — il ne change pas la position réelle (réglée dans « Lanceur »)."
        right={
          <div className="row g8" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--faint)' }}>Aperçu</span>
            <Seg small value={previewOpen ? 'open' : 'closed'} onChange={v => setPreviewOpen(v === 'open')}
                 options={[{ value: 'closed', label: 'Fermé' }, { value: 'open', label: 'Ouvert' }]} />
            <Seg small value={previewSide} onChange={v => setPreviewSide(v as 'left' | 'right')}
                 options={[{ value: 'left', label: 'Gauche' }, { value: 'right', label: 'Droite' }]} />
          </div>
        }>
        Apparence du widget
      </SectionTitle>

      {/* Sous-onglets + formulaire d'apparence : délégués à AppearancePanel
          (composant PARTAGÉ avec l'éditeur d'apparence embarqué). La carte
          « Déclencheurs proactifs » reste ici, injectée pour la section
          « Conversation » via renderExtra (l'état du sous-onglet vit dans le
          panneau). « Comportement » (mode) a été déplacé dans l'onglet Arbre. */}
      <AppearancePanel
        design={bot.design_json || {}}
        botName={bot.name}
        onChange={patchDesign}
        onNameChange={v => patch({ name: v })}
        whiteLabelLocked={whiteLabelLocked}
        onUpgrade={onUpgrade}
        renderExtra={section => section === 'conversation' && (
      <Card>
        <div className="card-title">Déclencheurs proactifs</div>
        <div style={{ fontSize: 11.5, color: 'var(--mut)', lineHeight: 1.55, marginBottom: 4 }}>
          Ouvre le panneau avec un message local (aucun appel serveur), au plus un déclenchement
          par chargement de page, jamais en mode iframe. 5 déclencheurs max.
        </div>
        <div className="col" style={{ gap: 10 }}>
          {triggers.map((tr, i) => {
            // Déclencheur numérique (time_on_page / scroll_depth) : même
            // champ à 3 littéraux près (label, bornes input, plage du hint).
            const numTriggerField = (label: string, min: number, max: number, range: string) => (
              <Field label={label}
                     hint={typeof tr.value !== 'number'
                       ? <span style={{ color: 'var(--danger)' }}>Valeur requise ({range})</span>
                       : undefined}>
                <input type="number" min={min} max={max}
                       value={typeof tr.value === 'number' ? tr.value : ''}
                       onChange={e => updateTrigger(i, { value: e.target.value === '' ? '' : Number(e.target.value) })} />
              </Field>
            )
            return (
            // Clé = type + index : plus stable que l'index nu quand un
            // déclencheur du milieu est retiré (l'index seul décale tout le
            // reste). On n'inclut PAS le message (il remonterait la ligne à
            // chaque frappe et ferait perdre le focus au textarea).
            <div key={`${tr.type}-${i}`} style={{ border: '1px solid var(--border)', borderRadius: 11, padding: '11px 13px' }}>
              <div className="col" style={{ gap: 10 }}>
                <Field label="Type">
                  <select value={tr.type} onChange={e => updateTriggerType(i, e.target.value)}>
                    <option value="time_on_page">Temps passé sur la page</option>
                    <option value="scroll_depth">Profondeur de défilement</option>
                    <option value="exit_intent">Intention de sortie</option>
                    <option value="url_pattern">Adresse de la page</option>
                  </select>
                </Field>
                {/* value : Number strict côté serveur (_check_triggers) — un
                    string numérique ferait 422. Input vide = '' conservé +
                    hint rouge, le 422 verbatim de la save bar reste le filet. */}
                {tr.type === 'time_on_page' && numTriggerField('Après (secondes)', 1, 600, '1-600')}
                {tr.type === 'scroll_depth' && numTriggerField('À partir de (% de page)', 1, 100, '1-100')}
                {tr.type === 'url_pattern' && (
                  <Field label="Le chemin de la page contient">
                    <input type="text" className="mono" maxLength={200} placeholder="/tarifs"
                           value={typeof tr.value === 'string' ? tr.value : ''}
                           onChange={e => updateTrigger(i, { value: e.target.value })} />
                  </Field>
                )}
                {tr.type === 'exit_intent' && (
                  <div className="field-hint">
                    Souris quittant la page par le haut. Désactivé sur mobile.
                  </div>
                )}
                <Field label="Message"
                       hint={!tr.message
                         ? <span style={{ color: 'var(--danger)' }}>Message requis (1 à 300 caractères)</span>
                         : undefined}>
                  <textarea rows={2} maxLength={300} value={tr.message || ''}
                            onChange={e => updateTrigger(i, { message: e.target.value })} />
                </Field>
                {/* once_per_session peut être ABSENT du JSON stocké → défaut true */}
                <div className="toggle-row">
                  <div className="tl">Une seule fois par session</div>
                  <Toggle label="Une seule fois par session" on={tr.once_per_session ?? true}
                          onChange={v => updateTrigger(i, { once_per_session: v })} />
                </div>
                <div>
                  <Btn kind="danger" small onClick={() => removeTrigger(i)}>Retirer</Btn>
                </div>
              </div>
            </div>
            )
          })}
        </div>
        <div className="row g10" style={{ marginTop: 10 }}>
          <Btn kind="soft" small onClick={addTrigger} disabled={triggers.length >= 5}>
            <Plus size={13} /> Ajouter un déclencheur
          </Btn>
          {triggers.length >= 5 && <Chip tone="warn">5/5</Chip>}
        </div>
      </Card>
        )}
      />
    </div>
  )
}
