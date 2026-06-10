// Page bot à onglets — portée du shell du prototype (Kertios Chat - Prototype.html) :
// header avatar de marque + chips, onglets Stats / Arbre / Bot & IA / Apparence /
// Sécurité / Intégration, bannière « Vue admin » pour les superadmins.
import { useEffect, useState } from 'react'
import { Check, Clipboard, Lock, Plus, Trash2 } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../AuthContext'
import {
  Btn, BubbleIcon, Card, Chip, Divider, Field, InfoBox, Meter, SectionTitle, Seg, Toggle,
  brandBg, modeChip, statusChip,
} from '../ui'
import { CAPTCHA_OPTIONS, MODEL_OPTIONS, findModelOption } from '../botConstants'
import AppearanceForm from '../components/AppearanceForm'
import StatsPanel from '../components/StatsPanel'
import TreeBuilder from '../components/TreeBuilder'
import WidgetPreview, { PreviewFrame } from '../components/WidgetPreview'

// perm = permission par bot requise pour un MEMBER (admins : tout)
const TABS = [
  { id: 'stats', label: 'Stats', perm: null },
  { id: 'tree', label: 'Arbre', perm: 'context' },
  { id: 'ai', label: 'Bot & IA', perm: 'context' },
  { id: 'appearance', label: 'Apparence', perm: 'appearance' },
  { id: 'security', label: 'Sécurité', perm: 'security' },
  { id: 'install', label: 'Intégration', perm: 'copy' },
]

interface Integration { id: string; label: string; icon: string; description: string; snippet: string }

export default function BotPage() {
  const { id } = useParams()
  const botId = Number(id)
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { user } = useAuth()

  const [bot, setBot] = useState<any>(null)
  const [tab, setTab] = useState(params.get('tab') || 'stats')
  const [byokKey, setByokKey] = useState('')
  const [captchaSecret, setCaptchaSecret] = useState('')
  const [newDomain, setNewDomain] = useState('')
  const [previewDegraded, setPreviewDegraded] = useState(false)
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [integType, setIntegType] = useState('html')
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [usage, setUsage] = useState<{ tree_only: boolean; max_tree_nodes: number | null } | null>(null)

  const fromAdmin = params.get('from') === 'admin'
  const isAdminView = !!user?.is_superadmin && fromAdmin

  useEffect(() => {
    api(`/api/bots/${botId}`).then((b: any) => {
      setBot(b)
      api(`/api/orgs/${b.organization_id}/usage`).then(setUsage).catch(() => {})
    })
    api(`/api/bots/${botId}/embed`).then(d => setIntegrations(d.integrations)).catch(() => {})
  }, [botId])

  function patch(fields: Record<string, any>) {
    setBot((b: any) => ({ ...b, ...fields }))
    setDirty(true)
  }
  function patchDesign(fields: Record<string, any>) {
    setBot((b: any) => ({ ...b, design_json: { ...b.design_json, ...fields } }))
    setDirty(true)
  }

  function switchTab(t: string) {
    setTab(t)
    params.set('tab', t)
    setParams(params, { replace: true })
  }

  async function save() {
    setError('')
    const body: Record<string, any> = {
      name: bot.name,
      is_active: bot.is_active,
      mode: bot.mode,
      ai_provider: bot.ai_provider,
      ai_model: bot.ai_model,
      system_prompt: bot.system_prompt,
      temperature: bot.temperature,
      api_key_mode: bot.api_key_mode,
      tree_json: bot.tree_json,
      design_json: bot.design_json,
      allowed_domains: bot.allowed_domains,
      captcha_provider: bot.captcha_provider,
      captcha_site_key: bot.captcha_site_key || null,
      daily_ai_message_cap: bot.daily_ai_message_cap,
    }
    if (byokKey) body.byok_key = byokKey
    if (captchaSecret) body.captcha_secret = captchaSecret
    try {
      const updated = await api(`/api/bots/${botId}`, { method: 'PATCH', body })
      setBot(updated)
      setByokKey('')
      setCaptchaSecret('')
      setDirty(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err: any) {
      setError(err.message)
    }
  }

  function exportConfig() {
    api(`/api/bots/${botId}/config.json`).then(config => {
      const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `bot-${bot.name.toLowerCase().replace(/\s+/g, '-')}.json`
      a.click()
      URL.revokeObjectURL(a.href)
    })
  }

  function importConfig(file: File) {
    file.text().then(text => api(`/api/bots/${botId}/config.json`, { method: 'PUT', body: JSON.parse(text) }))
      .then(updated => { setBot(updated); setDirty(false); setSaved(true); setTimeout(() => setSaved(false), 2500) })
      .catch(err => setError(`Import échoué : ${err.message}`))
  }

  async function deleteBot() {
    if (!window.confirm(`Supprimer définitivement « ${bot.name} » ?\n\nLe widget cessera de fonctionner sur tous les sites où il est installé, et les conversations seront perdues.`)) return
    try {
      await api(`/api/bots/${botId}`, { method: 'DELETE' })
      navigate(isAdminView ? `/admin/clients/${bot.organization_id}` : '/app')
    } catch (err: any) {
      setError(err.message)
    }
  }

  function addDomain() {
    const d = newDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (d && !bot.allowed_domains.includes(d)) patch({ allowed_domains: [...bot.allowed_domains, d] })
    setNewDomain('')
  }

  if (!bot) return <div className="center-page">Chargement…</div>

  const d = bot.design_json || {}
  const site = bot.allowed_domains[0] || 'votre-site.fr'
  const botOrg = user?.organizations.find(o => o.id === bot.organization_id)
  const orgName = botOrg?.name || ''
  // Permissions par bot : admins d'org et superadmins ont tout, les members
  // voient uniquement les onglets couverts par leurs permissions
  const isOrgAdmin = !!user?.is_superadmin || botOrg?.role === 'admin'
  const hasPerm = (perm: string | null) =>
    perm === null || isOrgAdmin || (botOrg?.permissions?.[String(botId)] || []).includes(perm)
  // Mode arbre pur (ou plan free) : l'onglet Bot & IA n'a pas lieu d'être
  const aiTabRelevant = bot.mode !== 'tree' && !usage?.tree_only
  const visibleTabs = TABS.filter(t => hasPerm(t.perm) && (t.id !== 'ai' || aiTabRelevant))
  const activeTab = visibleTabs.some(t => t.id === tab) ? tab : 'stats'
  const currentModel = findModelOption(bot.ai_provider, bot.ai_model)
  const currentInteg = integrations.find(i => i.id === integType) || integrations[0]
  const capPct = Math.min(100, Math.round((bot.daily_ai_message_cap / 2000) * 100))

  return (
    <div className="col" style={{ gap: 16 }}>
      {isAdminView && (
        <InfoBox tone="warn" title="Vue admin">
          Vous éditez le bot d'un client ({orgName}). Chaque modification est journalisée.
        </InfoBox>
      )}

      <div>
        <button className="back-link"
                onClick={() => navigate(isAdminView ? `/admin/clients/${bot.organization_id}` : '/app')}>
          {isAdminView ? `← Bots de ${orgName}` : '← Mes chatbots'}
        </button>
        <div className="bot-head">
          <span className={`bot-avatar ${d.bordered ? 'bordered' : ''}`}
                style={{ width: 42, height: 42, background: brandBg(d) }}>
            <BubbleIcon kind={d.icon} size={d.icon === 'image' && d.avatarImage ? 42 : 20} avatarImg={d.avatarImage} />
          </span>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div className="bot-head-title">
              {bot.name} {statusChip(bot.is_active)} {modeChip(bot.mode)}
            </div>
            <div className="bot-head-key">{site} · {bot.public_key}</div>
          </div>
          {(dirty || saved) && (
            <Btn onClick={save} kind={saved ? 'soft' : 'primary'}>
              {saved ? <><Check size={14} /> Enregistré</> : 'Enregistrer'}
            </Btn>
          )}
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="tabs">
        {visibleTabs.map(t => (
          <button key={t.id} className={activeTab === t.id ? 'active' : ''} onClick={() => switchTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {/* ================= STATS ================= */}
      {activeTab === 'stats' && <StatsPanel botId={botId} botName={bot.name} orgId={bot.organization_id} />}

      {/* ================= ARBRE ================= */}
      {activeTab === 'tree' && (
        <TreeBuilder tree={bot.tree_json} onChange={t => patch({ tree_json: t })}
                     onExport={exportConfig} onImport={importConfig}
                     botId={botId}
                     canGenerate={!usage?.tree_only}
                     maxNodes={usage?.max_tree_nodes ?? null}
                     allowAI={aiTabRelevant} />
      )}

      {/* ================= BOT & IA ================= */}
      {activeTab === 'ai' && (
        <div className="col g18">
          <SectionTitle sub="Modèle, clés API et instructions utilisées par l'IA pour répondre.">
            Bot &amp; IA
          </SectionTitle>
          <div className="grid2">
            <Card>
              <div className="card-title">Modèle IA</div>
              <div className="col" style={{ gap: 8 }}>
                {MODEL_OPTIONS.map(m => {
                  const selected = currentModel?.model === m.model
                  return (
                    <button key={m.model} className={`radio-card ${selected ? 'selected' : ''}`}
                            onClick={() => patch({ ai_provider: m.provider, ai_model: m.model })}>
                      <span className="radio-dot" />
                      <span style={{ flex: 1 }}>
                        <span className="rc-name">{m.name}</span>
                        <span className="rc-desc">{m.desc}</span>
                      </span>
                      <Chip tone={m.recommended ? 'acc' : 'mut'}>{m.price}</Chip>
                    </button>
                  )
                })}
              </div>

              <Divider />
              <div className="card-title" style={{ marginBottom: 8 }}>Clé API</div>
              <Seg value={bot.api_key_mode} onChange={v => patch({ api_key_mode: v })}
                   options={[{ value: 'managed', label: 'Clé Kertios (managée)' }, { value: 'byok', label: 'Ma propre clé (BYOK)' }]} />
              <div style={{ marginTop: 10 }}>
                {bot.api_key_mode === 'managed' ? (
                  <InfoBox tone="go" title="Clé managée">
                    La consommation IA est facturée en crédits sur votre plan. Aucune clé à gérer, les plafonds
                    protègent votre budget.
                  </InfoBox>
                ) : (
                  <div className="col g8">
                    <input type="password" className="mono"
                           placeholder={bot.byok_key_set ? '•••• (laisser vide pour conserver)' : 'sk-ant-api03-…'}
                           value={byokKey} onChange={e => { setByokKey(e.target.value); setDirty(true) }} />
                    <InfoBox tone="info" title="BYOK — votre clé, chiffrée côté serveur">
                      Votre clé est stockée chiffrée et utilisée uniquement côté serveur. Elle n'est jamais
                      exposée dans le widget. Vous payez les tokens directement au fournisseur.
                    </InfoBox>
                  </div>
                )}
              </div>
            </Card>

            <div className="col g14">
              <Card>
                <div className="card-title" style={{ marginBottom: 8 }}>Instructions (prompt système)</div>
                <textarea rows={5} value={bot.system_prompt} onChange={e => patch({ system_prompt: e.target.value })} />
                <div style={{ marginTop: 8 }}>
                  <InfoBox tone="warn" title="Verrouillé côté serveur">
                    Le visiteur final ne peut jamais modifier ces instructions, le modèle ou la température — le
                    widget n'y a pas accès (protection prompt-injection).
                  </InfoBox>
                </div>
              </Card>
              <Card>
                <div className="card-title" style={{ marginBottom: 8 }}>Température : {(bot.temperature / 100).toFixed(2)}</div>
                <input type="range" min={0} max={100} value={bot.temperature}
                       onChange={e => patch({ temperature: Number(e.target.value) })} />
                <div className="field-hint">Basse = réponses factuelles et stables · haute = réponses plus créatives.</div>
              </Card>
            </div>
          </div>
        </div>
      )}

      {/* ================= APPARENCE ================= */}
      {activeTab === 'appearance' && (
        <div className="col g18">
          <SectionTitle sub="Personnalisez le widget aux couleurs du site client. Aperçu en direct à droite.">
            Apparence du widget
          </SectionTitle>
          <div className="grid-controls">
            <div className="col g14">
              <Card>
                <AppearanceForm design={d} botName={bot.name}
                                onChange={patchDesign} onNameChange={v => patch({ name: v })} />
              </Card>
              <Card>
                <div className="card-title">Comportement</div>
                <div className="col" style={{ gap: 12 }}>
                  <Field label="Mode" hint={usage?.tree_only
                    ? 'Plan free : mode arbre uniquement. Passez au plan Starter pour activer l\'IA.'
                    : 'Hybride : arbre guidé d\'abord, IA à la demande. Les réponses arbre sont gratuites.'}>
                    {usage?.tree_only ? (
                      <Chip tone="mut"><Lock size={11} /> Arbre (plan free)</Chip>
                    ) : (
                      <Seg value={bot.mode} onChange={v => patch({ mode: v })}
                           options={[{ value: 'tree', label: 'Arbre' }, { value: 'hybrid', label: 'Hybride' }, { value: 'ai', label: 'IA' }]} />
                    )}
                  </Field>
                  <div className="toggle-row">
                    <div>
                      <div className="tl">Simuler le mode dégradé</div>
                      <div className="ts">Cap budget atteint → arbre seul (aperçu uniquement)</div>
                    </div>
                    <Toggle on={previewDegraded} onChange={setPreviewDegraded} />
                  </div>
                </div>
              </Card>
            </div>
            <Card nopad>
              <PreviewFrame site={site} siteName={orgName || site} brandColor={d.primaryColor || '#0d9488'}>
                <WidgetPreview design={d} mode={bot.mode} tree={bot.tree_json}
                               botName={bot.name} degraded={previewDegraded} />
              </PreviewFrame>
            </Card>
          </div>
        </div>
      )}

      {/* ================= SÉCURITÉ ================= */}
      {activeTab === 'security' && (
        <div className="col g18">
          <SectionTitle sub="Protection en couches : clé publique → vérif. d'origine → JWT éphémère → rate limits → cap budget. Vos vraies clés IA ne quittent jamais le serveur.">
            Sécurité &amp; anti-abus
          </SectionTitle>
          <div className="grid2">
            <div className="col g14">
              <Card>
                <div className="card-title" style={{ marginBottom: 4 }}>Domaines autorisés</div>
                <div style={{ fontSize: 11.5, color: 'var(--mut)', marginBottom: 11, lineHeight: 1.5 }}>
                  Le widget ne s'initialise que si l'Origin correspond. Vérification côté serveur — les
                  navigateurs ne peuvent pas la forger.
                </div>
                <div className="col g6">
                  {bot.allowed_domains.map((dom: string) => (
                    <div key={dom} className="domain-row">
                      <span className="dot" />
                      <span className="dm">{dom}</span>
                      <button className="rm" aria-label="Retirer"
                              onClick={() => patch({ allowed_domains: bot.allowed_domains.filter((x: string) => x !== dom) })}>×</button>
                    </div>
                  ))}
                  {bot.allowed_domains.length === 0 && (
                    <InfoBox tone="danger" title="Aucun domaine autorisé">
                      Le widget ne fonctionnera nulle part tant qu'aucun domaine n'est déclaré.
                    </InfoBox>
                  )}
                </div>
                <div className="row g8" style={{ marginTop: 10 }}>
                  <input type="text" className="mono" value={newDomain} placeholder="autre-domaine.fr"
                         onChange={e => setNewDomain(e.target.value)}
                         onKeyDown={e => e.key === 'Enter' && addDomain()} style={{ flex: 1 }} />
                  <Btn kind="soft" small onClick={addDomain}><Plus size={13} /> Ajouter</Btn>
                </div>
              </Card>

              <Card>
                <div className="card-title">Limites de débit</div>
                <div className="col" style={{ gap: 9 }}>
                  {[
                    ['Par session', '20 msg / 10 min', 'JWT éphémère (30 min)'],
                    ['Par IP', '100 req / min', 'anti-flood uniquement'],
                    ['Taille message', '4 000 caractères max', 'protection tokens'],
                    ['Historique IA', '20 messages max', 'envoyés au modèle'],
                  ].map(([k, v, hint]) => (
                    <div key={k} className="row g10">
                      <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600 }}>{k}</span>
                      <span className="mono" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--acc)' }}>{v}</span>
                      <span style={{ fontSize: 10.5, color: 'var(--faint)', width: 130, textAlign: 'right' }}>{hint}</span>
                    </div>
                  ))}
                </div>
              </Card>

              {aiTabRelevant && (
                <Card>
                  <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                    <div className="card-title" style={{ marginBottom: 0 }}>Plafond IA journalier</div>
                    <Chip tone="acc">{bot.daily_ai_message_cap} rép. / jour</Chip>
                  </div>
                  <input type="range" min={0} max={2000} step={10} value={bot.daily_ai_message_cap}
                         onChange={e => patch({ daily_ai_message_cap: Number(e.target.value) })} />
                  <div style={{ margin: '6px 0' }}><Meter pct={capPct} height={6} /></div>
                  <div style={{ fontSize: 11.5, color: 'var(--mut)', lineHeight: 1.55 }}>
                    S'il est atteint, le widget passe en mode dégradé (arbre seul). C'est votre protection
                    cash-flow.
                  </div>
                </Card>
              )}

              {isOrgAdmin && (
                <Card style={{ borderColor: 'var(--danger-bd)' }}>
                  <div className="card-title" style={{ color: 'var(--danger)' }}>Zone de danger</div>
                  <div className="toggle-row" style={{ marginBottom: 12 }}>
                    <div>
                      <div className="tl">Widget actif</div>
                      <div className="ts">Désactivé : le chat disparaît des sites, sans rien supprimer.</div>
                    </div>
                    <Toggle on={bot.is_active} onChange={v => patch({ is_active: v })} />
                  </div>
                  <Btn kind="danger" onClick={deleteBot}>
                    <Trash2 size={14} /> Supprimer ce chatbot
                  </Btn>
                  <div className="field-hint" style={{ marginTop: 6 }}>
                    Suppression définitive : widget coupé partout, conversations et stats perdues.
                  </div>
                </Card>
              )}
            </div>

            <Card>
              <div className="card-title" style={{ marginBottom: 4 }}>Vérification anti-bot (captcha)</div>
              <div style={{ fontSize: 11.5, color: 'var(--mut)', marginBottom: 12, lineHeight: 1.5 }}>
                Vérifié une seule fois à l'ouverture de session — invisible pour le visiteur, jamais à chaque
                message.
              </div>
              <div className="col g10">
                {CAPTCHA_OPTIONS.map(o => {
                  const selected = bot.captcha_provider === o.value
                  return (
                    <div key={o.value} onClick={() => patch({ captcha_provider: o.value })}
                         style={{
                           borderRadius: 11, cursor: 'pointer', padding: '11px 13px',
                           border: `1.5px solid ${selected ? 'var(--acc)' : 'var(--border)'}`,
                           background: selected ? 'var(--acc-soft)' : 'var(--surface)',
                         }}>
                      <div className="row g10">
                        <span className="radio-dot" style={selected ? { borderColor: 'var(--acc)', background: 'var(--acc)', boxShadow: 'inset 0 0 0 3px var(--surface)' } : {}} />
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{o.name}</span>
                        <Chip tone={o.tagTone}>{o.tag}</Chip>
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--mut)', margin: '6px 0 0 25px', lineHeight: 1.5 }}>{o.desc}</div>
                      {selected && (
                        <div style={{ margin: '9px 0 0 25px' }} onClick={e => e.stopPropagation()}>
                          <InfoBox tone={o.rgpdTone} title="Flux de données (pour votre registre RGPD)">
                            {o.rgpd}
                          </InfoBox>
                          {o.value === 'recaptcha_v3' && (
                            <div className="col" style={{ gap: 7, marginTop: 9 }}>
                              <input type="text" className="mono" placeholder="Site key — 6Lc•••"
                                     value={bot.captcha_site_key || ''}
                                     onChange={e => patch({ captcha_site_key: e.target.value })} />
                              <input type="password" className="mono"
                                     placeholder={bot.captcha_secret_set ? 'Secret key — •••• (conservée si vide)' : 'Secret key — 6Lc•••'}
                                     value={captchaSecret}
                                     onChange={e => { setCaptchaSecret(e.target.value); setDirty(true) }} />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ================= INTÉGRATION ================= */}
      {activeTab === 'install' && (
        <div className="col g18">
          <SectionTitle sub="Une seule balise avant </body>. Le widget pèse < 30 ko et ne bloque jamais le rendu de la page.">
            Intégration
          </SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 14, alignItems: 'start' }}>
            <Card>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
                <div className="card-title" style={{ marginBottom: 0 }}>Extrait à insérer</div>
                <Btn kind={copied ? 'soft' : 'primary'} small onClick={() => {
                  navigator.clipboard.writeText(currentInteg?.snippet || '').catch(() => {})
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1600)
                }}>{copied ? <><Check size={13} /> Copié</> : <><Clipboard size={13} /> Copier</>}</Btn>
              </div>
              <div className="snippet-pills" style={{ marginBottom: 10 }}>
                {integrations.map(it => (
                  <button key={it.id} className={integType === it.id ? 'active' : ''}
                          onClick={() => setIntegType(it.id)}>{it.label}</button>
                ))}
              </div>
              <pre className="snippet">{currentInteg?.snippet}</pre>
              {currentInteg?.description && (
                <div style={{ fontSize: 11.5, color: 'var(--mut)', marginTop: 8, lineHeight: 1.5 }}>{currentInteg.description}</div>
              )}
              <div style={{ marginTop: 10 }}>
                <InfoBox tone="info" title="pk_… est un identifiant public, pas un secret">
                  Elle permet uniquement d'initialiser une session de chat sur vos domaines autorisés. Vos clés
                  IA restent côté serveur — même modèle que les clés publiques Stripe.
                </InfoBox>
              </div>
            </Card>

            <Card>
              <div className="card-title" style={{ marginBottom: 12 }}>Ce qui se passe au chargement</div>
              <div className="col">
                {[
                  ['1', 'Chargement du widget', 'async, < 30 ko'],
                  ['2', 'Handshake POST /session', 'clé publique + jeton Turnstile invisible'],
                  ['3', 'Vérif. Origin + captcha', 'côté serveur, liste de domaines'],
                  ['4', 'Émission du JWT éphémère', '30 min, lié au domaine + conversation'],
                  ['5', 'Chat prêt', 'arbre gratuit / IA décomptée'],
                ].map(([n, t, dsc], i, arr) => (
                  <div key={n} className="timeline-step">
                    <div className="col" style={{ alignItems: 'center' }}>
                      <span className="timeline-num">{n}</span>
                      {i < arr.length - 1 && <span className="timeline-line" />}
                    </div>
                    <div style={{ paddingBottom: i < arr.length - 1 ? 14 : 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700 }}>{t}</div>
                      <div style={{ fontSize: 11, color: 'var(--mut)', marginTop: 1 }}>{dsc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
