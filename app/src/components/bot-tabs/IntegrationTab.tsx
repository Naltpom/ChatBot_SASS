// Onglet « Intégration » de BotPage — purement présentationnel. Reçoit en props
// l'état/les handlers définis dans BotPage (aucune logique de save ici).
import { Check, Clipboard } from 'lucide-react'
import { Btn, Card, InfoBox, SectionTitle } from '../../ui'
import type { Bot, Integration } from '../../types/bot'

export default function IntegrationTab({
  bot, integrations, integType, setIntegType, currentInteg, copied, setCopied,
  hasPerm, activateBot, isMobile,
}: {
  bot: Bot
  integrations: Integration[]
  integType: string
  setIntegType: (v: string) => void
  currentInteg: Integration | undefined
  copied: boolean
  setCopied: (v: boolean) => void
  hasPerm: (perm: string | null) => boolean
  activateBot: () => void
  isMobile: boolean
}) {
  return (
    <div className="col g18">
      <SectionTitle sub="Une seule balise avant </body>. Le widget pèse < 30 ko et ne bloque jamais le rendu de la page.">
        Intégration
      </SectionTitle>

      {!bot.is_active && (
        <InfoBox tone="warn" title="Bot inactif">
          La balise ne répondra pas tant que le bot n'est pas activé.{' '}
          {hasPerm('security') && (
            <button onClick={activateBot}
                    style={{ background: 'none', border: 'none', padding: 0, color: 'var(--acc)', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>
              Activer le bot
            </button>
          )}
        </InfoBox>
      )}

      {/* Intégration : extrait + timeline. Empilé en 1 colonne en mobile
          (grille inline, pas de classe globale à dépendre). */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.2fr 1fr', gap: 14, alignItems: 'start' }}>
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
          <div style={{ marginTop: 10 }}>
            <InfoBox tone="info" title="Site sous Content-Security-Policy">
              Pour l'overlay de prise de rendez-vous (mode script), autorisez :{' '}
              <span className="mono" style={{ fontSize: 10.5 }}>
                frame-src https://calendly.com https://*.calendly.com https://cal.com https://*.cal.com
              </span>
              . Le mode iframe (/widget-frame) n'est pas concerné.
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
              ['5', 'Chat prêt', '100 % gratuit, sans quota'],
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
  )
}
