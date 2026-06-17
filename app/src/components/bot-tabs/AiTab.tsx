// Onglet « IA » de BotPage — présentationnel. KbPanel (RAG) vit HORS save bar et
// reste monté ici comme dans l'original.
import { Card, Chip, Divider, InfoBox, SectionTitle, Seg } from '../../ui'
import { MODEL_OPTIONS, ModelOption } from '../../botConstants'
import KbPanel from '../KbPanel'
import type { AiProvider, ApiKeyMode, Bot, BotUpdate } from '../../types/bot'

export default function AiTab({
  bot, patch, byokKey, setByokKey, currentModel, botId, aiTabRelevant,
}: {
  bot: Bot
  patch: (fields: BotUpdate) => void
  byokKey: string
  setByokKey: (v: string) => void
  currentModel: ModelOption | undefined
  botId: number
  aiTabRelevant: boolean
}) {
  return (
    <div className="col g18">
      <SectionTitle sub="Modèle, clés API et instructions utilisées par l'IA pour répondre.">
        IA
      </SectionTitle>
      <div className="grid2">
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
          <div>
            <Seg value={bot.api_key_mode}
                 onChange={v => patch({ api_key_mode: v as ApiKeyMode })}
                 options={[{ value: 'managed', label: 'Clé Chapote (managée)' }, { value: 'byok', label: 'Ma propre clé (BYOK)' }]} />
          </div>
          <div style={{ marginTop: 10 }}>
            {bot.api_key_mode === 'managed' ? (
              <InfoBox tone="go" title="Clé managée">
                L'IA utilise la clé Chapote managée. Aucune clé à gérer — Chapote est 100 % gratuit.
              </InfoBox>
            ) : (
              <div className="col g8">
                <input type="password" className="mono"
                       placeholder={bot.byok_key_set ? '•••• (laisser vide pour conserver)' : 'sk-ant-api03-…'}
                       value={byokKey} onChange={e => setByokKey(e.target.value)} />
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

      {/* Base de connaissances (RAG) — KbPanel vit HORS save bar */}
      <Divider />
      <KbPanel botId={botId} aiActive={aiTabRelevant} />
    </div>
  )
}
