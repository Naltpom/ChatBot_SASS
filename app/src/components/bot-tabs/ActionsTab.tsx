// Onglet « Actions IA » de BotPage — présentationnel (galerie de modèles,
// éditeur des 5 types d'actions, serveurs MCP). Tous les handlers et le state des
// secrets restent définis dans BotPage et sont passés en props.
import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Btn, Card, Chip, Field, InfoBox, SectionTitle, Seg } from '../../ui'
import { ACTION_TEMPLATES } from '../../botConstants'
import { ACTION_TYPES, ACTION_TYPE_LIST } from '../../actionRegistry'
import SubTabs from '../SubTabs'
import ModuleLockBanner from '../billing/ModuleLockBanner'
import type { Bot, BotAction, BotActionType, McpServer, BotUpdate } from '../../types/bot'

const ACTION_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/
// Nom de serveur MCP : règle serveur _check_mcp_servers (31 caractères max)
const MCP_NAME_RE = /^[a-z][a-z0-9_]{0,30}$/

export default function ActionsTab({
  bot, savedBot, patch, actions, mcpServers,
  actionSecrets, setActionSecretAt, mcpTokens, setMcpTokenAt,
  updateAction, addAction, removeAction, updateActionField, updateActionType,
  updateMcpServer, addMcpServer, removeMcpServer,
  actionsLocked, mcpLocked, aiActive, onUpgrade,
}: {
  bot: Bot
  savedBot: Bot | null
  patch: (fields: BotUpdate) => void
  actions: BotAction[]
  mcpServers: McpServer[]
  actionSecrets: Record<number, string>
  setActionSecretAt: (i: number, v: string) => void
  mcpTokens: Record<number, string>
  setMcpTokenAt: (i: number, v: string) => void
  updateAction: (i: number, fields: Partial<BotAction>) => void
  addAction: () => void
  removeAction: (i: number) => void
  updateActionField: (ai: number, fi: number, fields: Record<string, unknown>) => void
  updateActionType: (i: number, v: string) => void
  updateMcpServer: (i: number, fields: Partial<McpServer>) => void
  addMcpServer: () => void
  removeMcpServer: (i: number) => void
  // DEUX modules distincts (split Actions / MCP) : chaque section porte SA bannière.
  //   actionsLocked → module 'actions' (webhooks, leads, tickets, créneaux — sans IA) ;
  //   mcpLocked     → module 'mcp'     (serveurs/outils MCP appelés par l'IA).
  actionsLocked: boolean
  mcpLocked: boolean
  // IA active sur ce bot (mode != tree) : MCP n'a de sens qu'avec l'IA — la section
  // est masquée du sélecteur et verrouillée tant que l'IA est OFF.
  aiActive: boolean
  onUpgrade: () => void
}) {
  const [sec, setSec] = useState<'actions' | 'mcp'>('actions')
  // MCP masqué du sélecteur tant que l'IA est OFF ; on retombe sur « Actions » si
  // on était sur l'onglet MCP au moment où l'IA est désactivée.
  const mcpAvailable = aiActive
  const activeSec = sec === 'mcp' && !mcpAvailable ? 'actions' : sec
  const subTabOptions: { value: 'actions' | 'mcp'; label: string }[] = mcpAvailable
    ? [{ value: 'actions', label: 'Actions' }, { value: 'mcp', label: 'Serveurs MCP' }]
    : [{ value: 'actions', label: 'Actions' }]
  return (
    <div className="col g18">
      <SectionTitle sub="Donnez à votre bot le pouvoir d'agir (webhooks, leads, tickets, créneaux), puis — avec l'IA — branchez-le sur vos services via MCP. Deux modules distincts.">
        Actions &amp; MCP
      </SectionTitle>

      <SubTabs value={activeSec} onChange={setSec} maxWidth={340}
               options={subTabOptions} />

      {activeSec === 'actions' && (
      <div className="col g18">
      <ModuleLockBanner locked={actionsLocked} label="Actions" onUpgrade={onUpgrade} />
      {bot.ai_provider === 'gemini' && (
        <InfoBox tone="warn" title="Non supporté par Gemini">
          Les actions, la recherche dans les connaissances et les serveurs MCP sont ignorés tant que
          le modèle Gemini est sélectionné — choisissez Claude ou GPT dans l'onglet IA.
        </InfoBox>
      )}

      <Card>
        <div className="card-title">Modèles d'actions</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
          {ACTION_TEMPLATES.map(tpl => (
            <div key={tpl.id} className="tpl-card">
              <div style={{ fontSize: 13, fontWeight: 800 }}>{tpl.label}</div>
              <div style={{ fontSize: 11.5, color: 'var(--mut)', lineHeight: 1.5, flex: 1 }}>{tpl.blurb}</div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <Chip tone="mut">{ACTION_TYPES[tpl.action.type as BotActionType]?.label ?? 'Webhook'}</Chip>
                <Btn kind="soft" small disabled={actions.length >= 5}
                     onClick={() => patch({ actions_json: [...actions, JSON.parse(JSON.stringify(tpl.action))] })}>
                  Utiliser
                </Btn>
              </div>
            </div>
          ))}
        </div>
        <div className="field-hint" style={{ marginTop: 8 }}>
          Pré-remplit une action — ajustez l'URL ou l'email avant d'enregistrer.
        </div>
      </Card>

      {actions.map((a, i) => {
        const nameBad = !ACTION_NAME_RE.test(a.name || '')
          || actions.filter(x => x.name === a.name).length > 1
        // Le secret (HMAC ou clé Cal.com) est rattaché au NOM côté serveur
        // (_merge_action_secrets) : on compare donc la photo serveur sous le
        // nom COURANT — jamais par index, les index glissent après une
        // suppression locale non sauvegardée. Le flag *_set de l'action live
        // vient du serveur et survit aux édits : warning ssi l'action croit
        // avoir un secret qu'aucune action sauvegardée du même nom ne porte.
        // Le flag *_set concerné dépend du type (registre.secretKind).
        const savedByName = (savedBot?.actions_json || []).find(x => x.name === a.name)
        const secretKind = ACTION_TYPES[a.type]?.secretKind ?? null
        const hasOwnSecretSet = secretKind === 'secret' ? !!a.secret_set
          : secretKind === 'api_key' ? !!a.api_key_set : false
        const renameWarn = hasOwnSecretSet
          && !(savedByName?.secret_set || savedByName?.api_key_set) && !actionSecrets[i]
        // Chip d'en-tête et corps d'édition tirés du registre (1 source).
        // Fallback type inconnu → chip Webhook, corps Capture de lead.
        const chip = (ACTION_TYPES[a.type] ?? ACTION_TYPES.webhook).chip
        const Body = (ACTION_TYPES[a.type] ?? ACTION_TYPES.capture_lead).Body
        return (
          <Card key={i}>
            <div className="row g10" style={{ flexWrap: 'wrap', marginBottom: 4 }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <input type="text" className="mono" placeholder="nom_de_l_action"
                       value={a.name || ''} onChange={e => updateAction(i, { name: e.target.value })} />
              </div>
              <Chip tone={chip.tone}>{chip.label}</Chip>
              <Btn kind="danger" small onClick={() => removeAction(i)}>Retirer</Btn>
            </div>
            {nameBad && (
              <div className="field-hint" style={{ color: 'var(--danger)', marginBottom: 8 }}>
                minuscules, chiffres, _ — unique
              </div>
            )}
            <div className="col" style={{ gap: 12, marginTop: 8 }}>
              <Field label="Description (pour l'IA)"
                     hint="Expliquez quand l'IA doit déclencher cette action (1 à 500 caractères)">
                <textarea rows={2} value={a.description || ''}
                          onChange={e => updateAction(i, { description: e.target.value })} />
              </Field>
              <Field label="Type">
                <Seg small value={a.type} onChange={v => updateActionType(i, v)}
                     options={ACTION_TYPE_LIST.map(d => ({ value: d.key, label: d.label }))} />
              </Field>

              <Body a={a} i={i} updateAction={updateAction} updateActionField={updateActionField}
                    actionSecrets={actionSecrets} setActionSecretAt={setActionSecretAt} renameWarn={renameWarn} />
            </div>
          </Card>
        )
      })}

      <div className="row g10">
        <Btn kind="soft" onClick={addAction} disabled={actions.length >= 5}>
          <Plus size={14} /> Ajouter une action
        </Btn>
        {actions.length >= 5 && <Chip tone="warn">5/5</Chip>}
      </div>
      </div>
      )}

      {activeSec === 'mcp' && (
      <div className="col g18">
      <ModuleLockBanner locked={mcpLocked} label="MCP (outils IA)" onUpgrade={onUpgrade} />
      <SectionTitle sub="Branchez l'IA sur vos services externes via le protocole MCP. 2 serveurs maximum.">
        Serveurs MCP
      </SectionTitle>

      <InfoBox tone="info" title="Qu'est-ce que MCP ?">
        MCP (Model Context Protocol) est une prise standard : votre serveur expose des outils
        (rechercher un client, consulter un stock…) et l'IA peut les appeler pendant la conversation.
        Les outils sont proposés au modèle sous le nom{' '}
        <span className="mono">{'mcp_<serveur>_<outil>'}</span>. Serveur en échec ou trop lent : ses
        outils sont simplement absents, le chat n'est jamais bloqué.
      </InfoBox>

      {mcpServers.map((s, i) => {
        const nameBad = !MCP_NAME_RE.test(s.name || '')
          || mcpServers.filter(x => x.name === s.name).length > 1
        const urlBad = !/^https:\/\//.test(s.url || '')
        // Divergence voulue avec le webhook : le jeton Bearer est un
        // credential ENVOYÉ au serveur — il n'est hérité par nom qu'à URL
        // inchangée (_merge_mcp_secrets). Renommer OU changer l'URL = ressaisir.
        // Comparaison par nom+URL contre la photo serveur (jamais par index,
        // les index glissent après une suppression locale non sauvegardée).
        const tokenWarn = s.auth_token_set
          && !((savedBot?.mcp_servers_json || []).find(x => x.name === s.name && x.url === s.url)?.auth_token_set)
          && !mcpTokens[i]
        return (
          <Card key={i}>
            <div className="row g10" style={{ flexWrap: 'wrap', marginBottom: 4 }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <input type="text" className="mono" placeholder="crm"
                       value={s.name || ''} onChange={e => updateMcpServer(i, { name: e.target.value })} />
              </div>
              <Btn kind="danger" small onClick={() => removeMcpServer(i)}>Retirer</Btn>
            </div>
            <div className="field-hint" style={nameBad ? { color: 'var(--danger)' } : undefined}>
              nom court en minuscules (a-z, 0-9, _), 31 caractères max, unique
            </div>
            <div className="col" style={{ gap: 12, marginTop: 10 }}>
              <Field label="URL du serveur"
                     hint={urlBad
                       ? <span style={{ color: 'var(--danger)' }}>L'URL du serveur doit commencer par https://</span>
                       : undefined}>
                <input type="text" className="mono" placeholder="https://mcp.votre-site.fr/mcp"
                       value={s.url || ''} onChange={e => updateMcpServer(i, { url: e.target.value })} />
              </Field>
              <Field label="Jeton (Bearer, optionnel)">
                <input type="password" className="mono"
                       placeholder={s.auth_token_set ? '•••• (laisser vide pour conserver le jeton)' : 'Jeton Bearer — optionnel'}
                       value={mcpTokens[i] || ''}
                       onChange={e => setMcpTokenAt(i, e.target.value)} />
                {tokenWarn && (
                  <div className="field-hint" style={{ color: 'var(--warn)' }}>
                    Renommer le serveur ou changer son URL invalide le jeton enregistré — ressaisissez-le.
                  </div>
                )}
              </Field>
            </div>
          </Card>
        )
      })}

      <div className="row g10">
        <Btn kind="soft" onClick={addMcpServer} disabled={mcpServers.length >= 2}>
          <Plus size={14} /> Ajouter un serveur MCP
        </Btn>
        {mcpServers.length >= 2 && <Chip tone="warn">2/2</Chip>}
      </div>
      </div>
      )}
    </div>
  )
}
