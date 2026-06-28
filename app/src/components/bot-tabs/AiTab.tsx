// Onglet « IA » de BotPage — présentationnel. Sous-onglets Modèle / Instructions
// / Connaissances (RAG). Le mode est binaire : un toggle « Activer l'IA »
// bascule arbre (gratuit) <-> hybride (IA). Verrou module = bannière au-dessus
// (pas de calque). KbPanel (RAG) vit HORS save bar comme dans l'original.
import { useState } from 'react'
import { Card, Chip, Divider, InfoBox, SectionTitle, Seg, Toggle } from '../../ui'
import { MODEL_OPTIONS, ModelOption } from '../../botConstants'
import KbPanel from '../KbPanel'
import SubTabs from '../SubTabs'
import ModuleLockBanner from '../billing/ModuleLockBanner'
import type { AiProvider, ApiKeyMode, Bot, BotMode, BotUpdate } from '../../types/bot'

type IaSection = 'model' | 'prompt' | 'rag'
const IA_TABS: { value: IaSection; label: string }[] = [
  { value: 'model', label: 'Modèle & clé' },
  { value: 'prompt', label: 'Instructions' },
  { value: 'rag', label: 'Connaissances (RAG)' },
]

export default function AiTab({
  bot, patch, byokKey, setByokKey, currentModel, botId, aiTabRelevant,
  locked, ragLocked, onUpgrade,
}: {
  bot: Bot
  patch: (fields: BotUpdate) => void
  byokKey: string
  setByokKey: (v: string) => void
  currentModel: ModelOption | undefined
  botId: number
  aiTabRelevant: boolean
  // Module 'ai' verrouillé : bannière au-dessus, contenu visible et réglable.
  locked: boolean
  // Module 'rag' verrouillé : bannière au-dessus du panneau Connaissances.
  ragLocked: boolean
  onUpgrade: () => void
}) {
  const [sec, setSec] = useState<IaSection>('model')
  const iaOn = bot.mode !== 'tree'   // hybride = IA activée (plus de mode 'ai' pur)

  return (
    <div className="col g18">
      <SectionTitle sub="Modèle, clés API et instructions utilisées par l'IA pour répondre.">
        IA
      </SectionTitle>

      {/* Verrou module IA — bannière propre (s'efface sur le sous-onglet RAG qui
          a son propre verrou). */}
      <ModuleLockBanner locked={locked && sec !== 'rag'} label="Intelligence artificielle" onUpgrade={onUpgrade} />

      {/* Activer l'IA : binaire arbre <-> hybride (remplace l'ancien sélecteur de
          mode Arbre/Hybride/IA). Toucher le mode est gardé serveur par MODULE_AI. */}
      <Card>
        <div className="toggle-row">
          <div>
            <div className="tl">Activer l'IA</div>
            <div className="ts">Mode hybride : arbre guidé d'abord, IA à la demande. Désactivé : arbre seul (gratuit).</div>
          </div>
          <Toggle label="Activer l'IA" on={iaOn} onChange={v => patch({ mode: (v ? 'hybrid' : 'tree') as BotMode })} />
        </div>
      </Card>

      <SubTabs value={sec} onChange={setSec} options={IA_TABS} maxWidth={520} />

      {/* ---------------- Modèle & clé ---------------- */}
      {sec === 'model' && (
        <Card>
          <div className="card-title">Modèle IA</div>
          <div className="col" style={{ gap: 8 }}>
            {MODEL_OPTIONS.map(m => {
              const selected = currentModel?.model === m.model
              return (
                <button key={m.model} className={`radio-card ${selected ? 'selected' : ''}`}
                        onClick={() => patch({ ai_provider: m.provider as AiProvider, ai_model: m.model })}>
                  <span className="radio-dot" />
                  <span style={{ flex: 1 }}>
                    <span className="rc-name">{m.name}</span>
                    <span className="rc-desc">{m.desc}</span>
                  </span>
                  {m.recommended && <Chip tone="acc">Recommandé</Chip>}
                </button>
              )
            })}
          </div>

          <Divider />
          <div className="card-title" style={{ marginBottom: 8 }}>Clé API</div>
          <Seg value={bot.api_key_mode}
               onChange={v => patch({ api_key_mode: v as ApiKeyMode })}
               options={[{ value: 'managed', label: 'Clé Chapote (managée)' }, { value: 'byok', label: 'Ma propre clé (BYOK)' }]} />
          <div style={{ marginTop: 10 }}>
            {bot.api_key_mode === 'managed' ? (
              <InfoBox tone="go" title="Clé managée">
                L'IA utilise la clé Chapote managée — rien à gérer (forfait IA selon votre plan).
              </InfoBox>
            ) : (
              <div className="col g8">
                <input type="password" className="mono"
                       placeholder={bot.byok_key_set ? '•••• (laisser vide pour conserver)' : 'sk-ant-api03-…'}
                       value={byokKey} onChange={e => setByokKey(e.target.value)} />
                <InfoBox tone="info" title="BYOK — votre clé, chiffrée côté serveur">
                  Variante de l'abonnement IA non métrée : vous payez les tokens directement au fournisseur.
                  Votre clé est stockée chiffrée et n'est jamais exposée dans le widget.
                </InfoBox>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ---------------- Instructions ---------------- */}
      {sec === 'prompt' && (
        <div className="grid2">
          <Card>
            <div className="card-title" style={{ marginBottom: 8 }}>Instructions (prompt système)</div>
            <textarea rows={6} value={bot.system_prompt} onChange={e => patch({ system_prompt: e.target.value })} />
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
      )}

      {/* ---------------- Connaissances (RAG) ---------------- */}
      {sec === 'rag' && (
        <div className="col g14">
          <ModuleLockBanner locked={ragLocked} label="Connaissances (RAG)" onUpgrade={onUpgrade} />
          <KbPanel botId={botId} aiActive={aiTabRelevant} />
        </div>
      )}
    </div>
  )
}
