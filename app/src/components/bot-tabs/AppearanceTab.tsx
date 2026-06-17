// Onglet « Apparence » de BotPage — extrait de l'inline historique. Contrôles
// (AppearanceForm + mode + déclencheurs proactifs) à gauche, aperçu live à
// droite (WidgetPreview dans PreviewFrame). Présentationnel : tout l'état et les
// handlers viennent de BotPage / useBotEditor.
import { Plus } from 'lucide-react'
import { Btn, Card, Chip, Field, SectionTitle, Seg, Toggle } from '../../ui'
import AppearanceForm from '../AppearanceForm'
import WidgetPreview, { PreviewFrame } from '../WidgetPreview'
import type { Bot, BotMode, BotUpdate, Trigger } from '../../types/bot'

export default function AppearanceTab({
  bot, patch, patchDesign, isMobile, site, orgName,
  updateTrigger, updateTriggerType, addTrigger, removeTrigger,
}: {
  bot: Bot
  patch: (fields: BotUpdate) => void
  patchDesign: (fields: Record<string, unknown>) => void
  isMobile: boolean
  site: string
  orgName: string
  updateTrigger: (i: number, fields: Partial<Trigger>) => void
  updateTriggerType: (i: number, v: string) => void
  addTrigger: () => void
  removeTrigger: (i: number) => void
}) {
  const d = bot.design_json || {}
  const triggers = bot.triggers_json || []
  return (
    <div className="col g18">
      <SectionTitle sub="Personnalisez le widget aux couleurs du site client. Aperçu en direct à droite.">
        Apparence du widget
      </SectionTitle>
      {/* Apparence : contrôles + aperçu live. En mobile on force 1 colonne
          (aperçu sous les contrôles, 100% de large) sans dépendre de la media
          query de styles.css (réservée à l'agent shell). En desktop : grille
          .grid-controls native (330px + 1fr). */}
      <div className="grid-controls" style={isMobile ? { gridTemplateColumns: '1fr' } : undefined}>
        <div className="col g14">
          <Card>
            <AppearanceForm design={d} botName={bot.name}
                            onChange={patchDesign} onNameChange={v => patch({ name: v })} />
          </Card>
          <Card>
            <div className="card-title">Comportement</div>
            <div className="col" style={{ gap: 12 }}>
              <Field label="Mode" hint="Hybride : arbre guidé d'abord, IA à la demande. Les réponses arbre sont gratuites.">
                <Seg value={bot.mode} onChange={v => patch({ mode: v as BotMode })}
                     options={[{ value: 'tree', label: 'Arbre' }, { value: 'hybrid', label: 'Hybride' }, { value: 'ai', label: 'IA' }]} />
              </Field>
            </div>
          </Card>

          <Card>
            <div className="card-title">Déclencheurs proactifs</div>
            <div style={{ fontSize: 11.5, color: 'var(--mut)', lineHeight: 1.55, marginBottom: 4 }}>
              Ouvre le panneau avec un message local (aucun appel serveur), au plus un déclenchement
              par chargement de page, jamais en mode iframe. 5 déclencheurs max.
            </div>
            <div className="field-hint" style={{ marginBottom: 10 }}>
              Les déclencheurs ne sont pas simulés dans l'aperçu ci-contre.
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
                      <Toggle on={tr.once_per_session ?? true}
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
        </div>
        <Card nopad>
          <PreviewFrame site={site} siteName={orgName || site} brandColor={d.primaryColor || '#1C3F5C'}>
            <WidgetPreview design={d} mode={bot.mode} tree={bot.tree_json}
                           botName={bot.name} />
          </PreviewFrame>
        </Card>
      </div>
    </div>
  )
}
