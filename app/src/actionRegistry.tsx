// Registre unique des TYPES D'ACTION du chatbot (OCP / SOLID).
//
// Tout vit ici, indexé par clé de type. Ajouter un type d'action =
// ajouter UNE entrée dans `ACTION_TYPES` (+ l'ajouter à l'union `BotActionType`
// dans types/bot.ts pour le typage). Les consommateurs (ActionsTab,
// useBotEditor) lisent le registre sans switch local sur les types.
//
// La forme des objets `actions_json` produits/sérialisés est lue par le
// backend action_executor.
import type { ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { Btn, Field, InfoBox, Toggle } from './ui'
import type { BotAction, BotActionField, BotActionType } from './types/bot'

// Champ secret write-only (secret HMAC webhook, clé Cal.com) : input password +
// avertissement de renommage partagé mot-pour-mot entre les deux blocs. La
// valeur est indexée par position (clé React = index) et écrite via
// setActionSecretAt(i, v) exposé par useBotEditor.
function ActionSecretField({
  label, hint, placeholder, i, value, onChange, warn,
}: {
  label: string
  hint: ReactNode
  placeholder: string
  i: number
  value: string
  onChange: (i: number, v: string) => void
  warn: boolean | undefined
}) {
  return (
    <Field label={label} hint={hint}>
      <input type="password" className="mono"
             placeholder={placeholder}
             value={value}
             onChange={e => onChange(i, e.target.value)} />
      {warn && (
        <div className="field-hint" style={{ color: 'var(--warn)' }}>
          Renommer sans ressaisir le secret le supprimera (le secret est rattaché au nom).
        </div>
      )}
    </Field>
  )
}

// Props passées au formulaire d'édition spécifique d'un type d'action. Chaque
// corps ne destructure que ce dont il a besoin (les autres props sont ignorées).
export interface ActionBodyProps {
  a: BotAction
  i: number
  updateAction: (i: number, fields: Partial<BotAction>) => void
  updateActionField: (ai: number, fi: number, fields: Record<string, unknown>) => void
  actionSecrets: Record<number, string>
  setActionSecretAt: (i: number, v: string) => void
  // Avertissement « renommage casse le secret » calculé par ActionsTab à partir
  // du flag *_set du type (cf. secretKind) et de la photo serveur.
  renameWarn: boolean
}

// Métadonnées + rendu d'UN type d'action.
export interface ActionTypeDef {
  key: BotActionType
  // Libellé du sélecteur de type (Seg) ET du chip de la galerie de modèles.
  label: string
  // Chip d'en-tête de la carte d'action (tone + libellé long).
  chip: { tone: 'info' | 'go' | 'acc'; label: string }
  // Clés additionnelles posées quand on crée/bascule vers ce type (au-delà de
  // name/description/type/secret_set/api_key_set). Fabrique des objets frais.
  defaults: () => Record<string, unknown>
  // Secret write-only de ce type : nom de la clé envoyée au PATCH ('api_key'
  // pour Cal.com, 'secret' pour le HMAC webhook) et flag *_set associé. null =
  // pas de secret. Pilote la sérialisation, le reset au changement de type et le
  // warning de renommage.
  secretKind: 'secret' | 'api_key' | null
  // Clés à OMETTRE du payload quand leur valeur est une chaîne vide/blanche (le
  // serveur retombe sur son défaut / rejette '' en 422). Ex. create_ticket
  // to_email (= envoi aux admins), calendar_slots timezone (= Europe/Paris).
  pruneWhenBlank?: string[]
  // Formulaire d'édition spécifique au type (rendu sur-mesure référencé DEPUIS
  // le registre — pas de switch de rendu dans ActionsTab).
  Body: (props: ActionBodyProps) => ReactNode
}

// ---- Corps d'édition par type --------------------------------------------

function WebhookBody({ a, i, updateAction, updateActionField, actionSecrets, setActionSecretAt, renameWarn }: ActionBodyProps) {
  return (
    <>
      <Field label="URL (https://…)"
             hint={!/^https:\/\//.test(a.url || '')
               ? <span style={{ color: 'var(--danger)' }}>L'URL doit commencer par https://</span>
               : undefined}>
        <input type="text" className="mono" placeholder="https://api.votre-site.fr/hooks/chapote"
               value={a.url || ''} onChange={e => updateAction(i, { url: e.target.value })} />
      </Field>
      <ActionSecretField label="Secret HMAC"
        hint="Signature HMAC-SHA256 dans l'en-tête X-Chapote-Signature."
        placeholder={a.secret_set ? '•••• (laisser vide pour conserver)' : 'Optionnel — signe chaque appel'}
        i={i} value={actionSecrets[i] || ''} onChange={setActionSecretAt} warn={renameWarn} />
      <div>
        <div className="field-label">Champs transmis</div>
        <div className="col g6">
          {(a.fields || []).map((f: BotActionField, fi: number) => (
            <div key={fi} className="row g8" style={{ flexWrap: 'wrap' }}>
              <input type="text" className="mono" style={{ width: 130 }} placeholder="nom"
                     value={f.name || ''}
                     onChange={e => updateActionField(i, fi, { name: e.target.value })} />
              <select value={f.type || 'string'} style={{ width: 102 }}
                      onChange={e => updateActionField(i, fi, { type: e.target.value })}>
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
              </select>
              <input type="text" style={{ flex: 1, minWidth: 140 }} placeholder="description"
                     value={f.description || ''}
                     onChange={e => updateActionField(i, fi, { description: e.target.value })} />
              <span className="row g6" style={{ fontSize: 11, fontWeight: 700, color: 'var(--mut)' }}>
                requis <Toggle label="Champ requis" on={!!f.required} onChange={v => updateActionField(i, fi, { required: v })} />
              </span>
              <button aria-label="Retirer le champ"
                      onClick={() => updateAction(i, { fields: (a.fields || []).filter((_, j) => j !== fi) })}
                      style={{ border: 'none', background: 'none', color: 'var(--faint)', cursor: 'pointer', fontSize: 14, padding: 2 }}>×</button>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 8 }}>
          <Btn kind="soft" small disabled={(a.fields || []).length >= 8}
               onClick={() => updateAction(i, { fields: [...(a.fields || []), { name: '', type: 'string', description: '', required: false }] })}>
            <Plus size={13} /> Ajouter un champ
          </Btn>
        </div>
      </div>
    </>
  )
}

function CaptureLeadBody() {
  return (
    <InfoBox tone="info">
      L'IA recueillera email, nom, téléphone et message au fil de la discussion et les déposera
      dans vos leads (notification email aux admins si le serveur a un SMTP).
    </InfoBox>
  )
}

function HandoffBody() {
  return (
    <InfoBox tone="info">
      L'IA transmet la conversation à un conseiller humain : le visiteur passe en file
      d'attente, vos admins sont notifiés par email et par le webhook Slack s'il est
      configuré (onglet Humain). Aucun champ à configurer.
    </InfoBox>
  )
}

function CreateTicketBody({ a, i, updateAction }: ActionBodyProps) {
  return (
    <>
      <Field label="Email de destination (optionnel)"
             hint="Vide : le ticket est envoyé aux admins de l'organisation. Sans SMTP configuré côté serveur, le ticket est uniquement journalisé.">
        <input type="email" placeholder="support@votre-domaine.fr"
               value={a.to_email || ''}
               onChange={e => updateAction(i, { to_email: e.target.value })} />
      </Field>
      <InfoBox tone="info">
        L'IA recueille sujet, résumé et coordonnées du visiteur, puis ouvre un ticket par
        email (référence TK-XXXXXXXX, trace visible dans le transcript).
      </InfoBox>
    </>
  )
}

function CalendarSlotsBody({ a, i, updateAction, actionSecrets, setActionSecretAt, renameWarn }: ActionBodyProps) {
  // event_type_id : même filet inline que nameBad/urlBad (le 422 FR de la save
  // bar reste le filet final). Rendu uniquement pour calendar_slots → pas de
  // garde sur a.type ici.
  const etidBad = !(typeof a.event_type_id === 'number' && Number.isInteger(a.event_type_id) && a.event_type_id >= 1)
  return (
    <>
      <Field label="Event type ID (Cal.com)"
             hint={etidBad
               ? <span style={{ color: 'var(--danger)' }}>Valeur requise (entier positif)</span>
               : undefined}>
        <input type="number" className="mono"
               value={a.event_type_id ?? ''}
               // '' transitoire toléré (input vidé) ; le filet etidBad + le
               // 422 serveur restent les gardes — d'où le cast du patch.
               onChange={e => updateAction(i, { event_type_id: e.target.value === '' ? '' : Number(e.target.value) } as Partial<BotAction>)} />
      </Field>
      <Field label="Fuseau horaire" hint="Identifiant IANA, ex. Europe/Paris.">
        <input type="text" className="mono"
               value={a.timezone || 'Europe/Paris'}
               onChange={e => updateAction(i, { timezone: e.target.value })} />
      </Field>
      <ActionSecretField label="Clé API Cal.com"
        hint="Stockée chiffrée, jamais réaffichée. L'IA consultera les disponibilités des 7 prochains jours (40 créneaux max)."
        placeholder={a.api_key_set ? '•••• (laisser vide pour conserver)' : 'cal_live_…'}
        i={i} value={actionSecrets[i] || ''} onChange={setActionSecretAt} warn={renameWarn} />
    </>
  )
}

// ---- Le registre ----------------------------------------------------------

export const ACTION_TYPES: Record<BotActionType, ActionTypeDef> = {
  webhook: {
    key: 'webhook',
    label: 'Webhook',
    chip: { tone: 'info', label: 'Webhook' },
    defaults: () => ({ url: '', fields: [] }),
    secretKind: 'secret',
    Body: WebhookBody,
  },
  capture_lead: {
    key: 'capture_lead',
    label: 'Capture de lead',
    chip: { tone: 'go', label: 'Capture de lead' },
    defaults: () => ({}),
    secretKind: null,
    Body: CaptureLeadBody,
  },
  handoff: {
    key: 'handoff',
    label: 'Conseiller',
    chip: { tone: 'acc', label: 'Conseiller humain' },
    defaults: () => ({}),
    secretKind: null,
    Body: HandoffBody,
  },
  create_ticket: {
    key: 'create_ticket',
    label: 'Ticket email',
    chip: { tone: 'go', label: 'Ticket par email' },
    // create_ticket : PAS de to_email seedé — clé absente = envoi aux admins.
    defaults: () => ({}),
    secretKind: null,
    pruneWhenBlank: ['to_email'],
    Body: CreateTicketBody,
  },
  calendar_slots: {
    key: 'calendar_slots',
    label: 'Créneaux Cal.com',
    chip: { tone: 'info', label: 'Créneaux Cal.com' },
    defaults: () => ({ event_type_id: '', timezone: 'Europe/Paris' }),
    secretKind: 'api_key',
    pruneWhenBlank: ['timezone'],
    Body: CalendarSlotsBody,
  },
}

// Ordre d'affichage du sélecteur de type (Seg) et source unique de la liste des
// types. Itérer dessus = ne JAMAIS redéclarer la liste des types ailleurs.
export const ACTION_TYPE_LIST: ActionTypeDef[] = [
  ACTION_TYPES.webhook,
  ACTION_TYPES.capture_lead,
  ACTION_TYPES.handoff,
  ACTION_TYPES.create_ticket,
  ACTION_TYPES.calendar_slots,
]

// Construit l'objet action « neuf » pour un type donné : name/description repris
// (ou vides), flags *_set remis à plat, défauts du type posés. Utilisé à
// l'ajout (type par défaut webhook) et au changement de type.
export function makeAction(
  type: BotActionType, base: { name?: string; description?: string } = {},
): BotAction {
  return {
    name: base.name || '',
    description: base.description || '',
    type,
    secret_set: false,
    api_key_set: false,
    ...ACTION_TYPES[type].defaults(),
  } as BotAction
}
