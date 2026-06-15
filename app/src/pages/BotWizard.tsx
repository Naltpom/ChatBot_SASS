// Wizard de création — 5 étapes (wizard.jsx du design) :
// Les bases → Intelligence → Apparence → Sécurité → Intégration → page bot.
import { useEffect, useState } from 'react'
import { Check, GitBranch, Layers, Lock, PartyPopper, Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../AuthContext'
import { Btn, Card, Chip, Field, InfoBox, Seg, SectionTitle } from '../ui'
import { MODEL_OPTIONS, TREE_TEMPLATES, TreeTemplate } from '../botConstants'
import AppearanceForm from '../components/AppearanceForm'
import TreeBuilder from '../components/TreeBuilder'
import WidgetPreview, { PreviewFrame } from '../components/WidgetPreview'

const MODES = [
  { v: 'tree', icon: <GitBranch size={17} />, t: 'Arbre', d: 'Menu guidé uniquement. Réponses gratuites, illimitées.' },
  { v: 'hybrid', icon: <Layers size={17} />, t: 'Hybride', d: "Arbre d'abord, IA sur certaines sections. Recommandé." },
  { v: 'ai', icon: <Sparkles size={17} />, t: 'IA', d: 'Texte libre dès le départ. Décompté par réponse.' },
]

const DEFAULT_DESIGN = {
  primaryColor: '#0d9488', secondaryColor: null as string | null, position: 'right', size: 'md',
  borderRadius: 16, icon: 'chat', avatarImage: '', bordered: false,
  welcomeMessage: '', placeholder: 'Écrivez votre message…', loadingAnimation: 'dots', poweredBy: true,
}

const STARTER_TREE = {
  start: 'root',
  nodes: {
    root: {
      message: 'Bonjour ! Comment puis-je vous aider ?',
      options: [
        { label: 'Nos services', next: 'services' },
        { label: 'Autre question', next: '__ai__' },
      ],
    },
    services: {
      message: 'Nous proposons… (personnalisez cet arbre dans l\'onglet Arbre)',
      options: [{ label: '↩ Menu principal', next: 'root' }],
    },
  },
}

interface Integration { id: string; label: string; icon: string; description: string; snippet: string }

export default function BotWizard() {
  const { activeOrg } = useAuth()
  const navigate = useNavigate()

  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [site, setSite] = useState('')
  const [mode, setMode] = useState('hybrid')
  const [tree, setTree] = useState<Record<string, any>>(JSON.parse(JSON.stringify(STARTER_TREE)))
  const [usage, setUsage] = useState<{ tree_only: boolean; max_tree_nodes: number | null } | null>(null)
  const [modelIdx, setModelIdx] = useState(1) // Claude Sonnet par défaut
  const [keyMode, setKeyMode] = useState('managed')
  const [byokKey, setByokKey] = useState('')
  const [design, setDesign] = useState<Record<string, any>>({ ...DEFAULT_DESIGN })

  const [previewTpl, setPreviewTpl] = useState<string | null>(null)   // template d'arbre en aperçu (1 max)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [createdBotId, setCreatedBotId] = useState<number | null>(null)
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    if (!activeOrg) return
    api(`/api/orgs/${activeOrg.id}/usage`).then(u => {
      setUsage(u)
      if (u.tree_only) setMode('tree')
    }).catch(() => {})
  }, [activeOrg?.id])

  // Mode arbre pur : retire les options "Escalade IA" du brouillon d'arbre
  useEffect(() => {
    if (mode !== 'tree') return
    setTree(t => {
      const copy = JSON.parse(JSON.stringify(t))
      let changed = false
      for (const node of Object.values(copy.nodes) as any[]) {
        const before = (node.options || []).length
        node.options = (node.options || []).filter((o: any) => o.next !== '__ai__')
        if (node.options.length !== before) changed = true
      }
      return changed ? copy : t
    })
  }, [mode])

  const treeOnly = usage?.tree_only ?? false
  // En mode tree, l'étape "Intelligence" devient la construction de l'arbre
  const STEPS = mode === 'tree'
    ? ['Les bases', 'Arbre', 'Apparence', 'Sécurité', 'Intégration']
    : ['Les bases', 'Intelligence', 'Apparence', 'Sécurité', 'Intégration']

  const isLast = step === STEPS.length - 1
  const canNext = step === 0 ? !!(name.trim() && site.trim()) : true

  async function next() {
    setError('')
    // Passage Sécurité → Intégration : création réelle du bot
    if (step === 3) {
      setBusy(true)
      try {
        const model = MODEL_OPTIONS[modelIdx]
        const bot = await api(`/api/orgs/${activeOrg!.id}/bots`, {
          method: 'POST', body: { name: name.trim(), mode },
        })
        const body: Record<string, any> = {
          ai_provider: model.provider,
          ai_model: model.model,
          api_key_mode: keyMode,
          design_json: design,
          tree_json: tree,
          allowed_domains: [site.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')],
          captcha_provider: 'turnstile',
        }
        if (keyMode === 'byok' && byokKey) body.byok_key = byokKey
        await api(`/api/bots/${bot.id}`, { method: 'PATCH', body })
        const embed = await api(`/api/bots/${bot.id}/embed`)
        setCreatedBotId(bot.id)
        setIntegrations(embed.integrations)
        setStep(4)
      } catch (err: any) {
        setError(err.message)
      } finally {
        setBusy(false)
      }
      return
    }
    setStep(s => Math.min(s + 1, STEPS.length - 1))
  }

  // Applique un template d'arbre (deep clone : l'état du wizard ne partage
  // jamais les objets de botConstants). STARTER_TREE = 2 nœuds → pas de confirm
  // tant que l'utilisateur n'a rien construit lui-même.
  function applyTemplate(tpl: TreeTemplate) {
    if (Object.keys(tree.nodes || {}).length > 2
        && !window.confirm('Remplacer l\'arbre en cours par ce modèle ?')) return
    setTree(JSON.parse(JSON.stringify(tpl.tree)))
    setPreviewTpl(null)
  }

  function copy(integ: Integration) {
    navigator.clipboard.writeText(integ.snippet).catch(() => {})
    setCopiedId(integ.id)
    setTimeout(() => setCopiedId(null), 1600)
  }

  if (!activeOrg) return <Card>Sélectionnez d'abord une organisation.</Card>

  return (
    <div className="col g18" style={{ maxWidth: 860, margin: '0 auto' }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div className="section-title">Nouveau chatbot</div>
          <div style={{ fontSize: 12, color: 'var(--mut)', marginTop: 2 }}>
            {activeOrg.name} · étape {step + 1}/{STEPS.length}
          </div>
        </div>
        <Btn kind="ghost" small onClick={() => navigate('/app')}>Annuler</Btn>
      </div>

      <div className="wiz-steps">
        {STEPS.map((s, i) => (
          <div key={s} className={`wiz-step ${i === step ? 'current' : i < step ? 'done' : ''}`}
               onClick={() => i < step && step < 4 && setStep(i)}>
            <div className="bar" />
            <div className="lbl">{s}</div>
          </div>
        ))}
      </div>

      {error && <div className="error">{error}</div>}

      {/* ---- Étape 0 : Les bases ---- */}
      {step === 0 && (
        <Card>
          <div className="col g14" style={{ maxWidth: 560 }}>
            <Field label="Nom du bot" hint="Affiché dans l'en-tête du widget.">
              <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="ex. Assistant d'accueil" autoFocus />
            </Field>
            <Field label="Site web" hint="Premier domaine autorisé — vous pourrez en ajouter d'autres.">
              <input type="text" className="mono" value={site} onChange={e => setSite(e.target.value)} placeholder="www.mon-site.fr" />
            </Field>
            <Field label="Type de bot">
              <div className="mode-cards">
                {MODES.map(m => {
                  const locked = treeOnly && m.v !== 'tree'
                  return (
                    <button key={m.v} className={`mode-card ${mode === m.v ? 'selected' : ''}`}
                            disabled={locked} style={locked ? { opacity: .55, cursor: 'default' } : undefined}
                            onClick={() => !locked && setMode(m.v)}>
                      <div className="ico">{m.icon}</div>
                      <div className="ttl" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        {m.t} {locked && <Chip tone="mut"><Lock size={10} /> Starter+</Chip>}
                      </div>
                      <div className="dsc">{m.d}</div>
                    </button>
                  )
                })}
              </div>
              {treeOnly && (
                <div className="field-hint">
                  Le plan free est limité au mode arbre ({usage?.max_tree_nodes ?? 10} bulles max, réponses
                  illimitées). Passez au plan Starter pour activer l'IA.
                </div>
              )}
            </Field>
          </div>
        </Card>
      )}

      {/* ---- Étape 1 : Arbre (mode tree) ou Intelligence (modes IA) ---- */}
      {/* Galerie de templates AU-DESSUS du builder, jamais à sa place : le
          builder reste visible dès l'arrivée à l'étape (contrat wizard-tree.spec).
          Limitation actée : en mode hybrid/ai l'étape Arbre n'existe pas
          (STARTER_TREE posé tel quel) — la galerie ne vit qu'ici. */}
      {step === 1 && mode === 'tree' && (
        <>
          <Card>
            <div className="card-title">Partir d'un modèle</div>
            <div style={{ fontSize: 11.5, color: 'var(--mut)', lineHeight: 1.5, marginBottom: 10 }}>
              Quatre arbres prêts à personnaliser — boutons, textes et liens restent modifiables ci-dessous.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
              {TREE_TEMPLATES.map(tpl => (
                <div key={tpl.id} className="tpl-card">
                  <div style={{ fontSize: 13, fontWeight: 800 }}>{tpl.label}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--mut)', lineHeight: 1.5, flex: 1 }}>{tpl.blurb}</div>
                  <div><Chip tone="mut">{Object.keys(tpl.tree.nodes).length} bulles</Chip></div>
                  <div className="row g6" style={{ flexWrap: 'wrap' }}>
                    <Btn kind="ghost" small onClick={() => setPreviewTpl(p => (p === tpl.id ? null : tpl.id))}>
                      Aperçu
                    </Btn>
                    <Btn kind="soft" small onClick={() => applyTemplate(tpl)}>Utiliser ce modèle</Btn>
                  </div>
                </div>
              ))}
            </div>
            {previewTpl && (() => {
              const tpl = TREE_TEMPLATES.find(x => x.id === previewTpl)
              if (!tpl) return null
              return (
                <div className="col" style={{ gap: 10, marginTop: 12 }}>
                  <PreviewFrame site={site || 'votre-site.fr'} brandColor={design.primaryColor} height={520}>
                    <WidgetPreview design={design} mode="tree" tree={tpl.tree} botName={name || 'Aperçu'} />
                  </PreviewFrame>
                  <div>
                    <Btn kind="ghost" small onClick={() => setPreviewTpl(null)}>Fermer l'aperçu</Btn>
                  </div>
                </div>
              )
            })()}
          </Card>
          <TreeBuilder tree={tree as any} onChange={t => setTree(t)}
                       maxNodes={usage?.max_tree_nodes ?? null} allowAI={false} />
        </>
      )}
      {step === 1 && mode !== 'tree' && (
        <Card>
          {(
            <div className="grid2" style={{ gap: 16 }}>
              <Field label="Modèle IA">
                <div className="col" style={{ gap: 7 }}>
                  {MODEL_OPTIONS.map((m, i) => (
                    <button key={m.model} className={`radio-card ${modelIdx === i ? 'selected' : ''}`} onClick={() => setModelIdx(i)}>
                      <span className="radio-dot" />
                      <span style={{ flex: 1 }}>
                        <span className="rc-name">{m.name}</span>
                        <span className="rc-desc">{m.desc}</span>
                      </span>
                      <Chip tone={m.recommended ? 'acc' : 'mut'}>{m.price}</Chip>
                    </button>
                  ))}
                </div>
              </Field>
              <div className="col g14">
                <Field label="Clé API">
                  <Seg value={keyMode} onChange={setKeyMode}
                       options={[{ value: 'managed', label: 'Chapote (managée)' }, { value: 'byok', label: 'BYOK' }]} />
                </Field>
                {keyMode === 'byok' && (
                  <input type="password" className="mono" placeholder="sk-ant-api03-…" value={byokKey}
                         onChange={e => setByokKey(e.target.value)} />
                )}
                {keyMode === 'managed' ? (
                  <InfoBox tone="go" title="Clé managée">
                    La consommation IA est facturée en crédits sur votre plan. Aucune clé à gérer, les plafonds
                    protègent votre budget.
                  </InfoBox>
                ) : (
                  <InfoBox tone="info" title="BYOK — votre clé, chiffrée côté serveur">
                    Votre clé est stockée chiffrée et utilisée uniquement côté serveur. Elle n'est jamais exposée
                    dans le widget. Vous payez les tokens directement au fournisseur.
                  </InfoBox>
                )}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* ---- Étape 2 : Apparence ---- */}
      {step === 2 && (
        <div className="grid-controls" style={{ gridTemplateColumns: '320px 1fr' }}>
          <Card>
            <AppearanceForm design={design} botName={name}
                            onChange={p => setDesign(prev => ({ ...prev, ...p }))}
                            onNameChange={setName} compact />
          </Card>
          <Card nopad>
            <PreviewFrame site={site || 'votre-site.fr'} brandColor={design.primaryColor} height={520}>
              <WidgetPreview design={design} mode={mode} tree={tree} botName={name || 'Mon bot'} />
            </PreviewFrame>
          </Card>
        </div>
      )}

      {/* ---- Étape 3 : Sécurité ---- */}
      {step === 3 && (
        <Card>
          <div className="col g14" style={{ maxWidth: 560 }}>
            <Field label="Domaines autorisés" hint="Le widget refusera de se charger ailleurs.">
              <div className="domain-row">
                <span className="dot" />
                <span className="dm">{site || 'votre-site.fr'}</span>
              </div>
            </Field>
            <Field label="Vérification anti-bot">
              <div className="row g10" style={{ padding: '10px 12px', borderRadius: 10, border: '1.5px solid var(--acc)', background: 'var(--acc-soft)' }}>
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--ink)' }}>Cloudflare Turnstile</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--mut)' }}>Invisible, conforme RGPD. Modifiable ensuite.</span>
                </span>
                <Chip tone="go">Défaut</Chip>
              </div>
            </Field>
            <InfoBox tone="go" title="Protections activées automatiquement">
              JWT de session éphémère, rate limits, limites de taille et plafond budgétaire journalier sont actifs
              dès le départ. Affinez-les dans l'onglet Sécurité du bot.
            </InfoBox>
          </div>
        </Card>
      )}

      {/* ---- Étape 4 : Intégration ---- */}
      {step === 4 && (
        <Card>
          <div className="col g14">
            <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <PartyPopper size={17} style={{ color: 'var(--acc)' }} /> « {name} » est prêt. Ajoutez-le à votre site :
            </div>
            <pre className="snippet">{integrations[0]?.snippet}</pre>
            <div className="row g8" style={{ flexWrap: 'wrap' }}>
              {integrations.map(it => (
                <Btn key={it.id} kind={copiedId === it.id ? 'soft' : 'ghost'} small onClick={() => copy(it)}>
                  {copiedId === it.id ? <><Check size={13} /> Copié</> : it.label}
                </Btn>
              ))}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>
              Vous retrouverez ces extraits à tout moment sur la card du bot et dans son onglet Intégration.
            </div>
          </div>
        </Card>
      )}

      {/* ---- Navigation ---- */}
      <div className="row" style={{ justifyContent: 'space-between' }}>
        {step < 4 ? (
          <Btn kind="ghost" onClick={() => step === 0 ? navigate('/app') : setStep(s => s - 1)}>
            {step === 0 ? 'Annuler' : '← Retour'}
          </Btn>
        ) : <span />}
        {step === 4
          ? <Btn onClick={() => navigate(`/app/bots/${createdBotId}`)}>Terminer → ouvrir le bot</Btn>
          : <Btn onClick={next} disabled={!canNext || busy}>{busy ? 'Création…' : step === 3 ? 'Créer le chatbot →' : 'Continuer →'}</Btn>}
      </div>
    </div>
  )
}
