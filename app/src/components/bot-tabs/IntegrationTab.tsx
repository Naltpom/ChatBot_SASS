// Onglet « Intégration » de BotPage — purement présentationnel. Reçoit en props
// l'état/les handlers définis dans BotPage (aucune logique de save ici).
import { useState } from 'react'
import { Check, Clipboard } from 'lucide-react'
import { Btn, Card, InfoBox, SectionTitle } from '../../ui'
import type { Bot, Integration } from '../../types/bot'

export default function IntegrationTab({
  bot, integrations, integType, setIntegType, currentInteg, copied, copySnippet,
  hasPerm, activateBot, isMobile,
}: {
  bot: Bot
  integrations: Integration[]
  integType: string
  setIntegType: (v: string) => void
  currentInteg: Integration | undefined
  copied: boolean
  copySnippet: () => void
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
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(0, 1.2fr) minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
        <Card>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
            <div className="card-title" style={{ marginBottom: 0 }}>Extrait à insérer</div>
            <Btn kind={copied ? 'soft' : 'primary'} small onClick={copySnippet}>
              {copied ? <><Check size={13} /> Copié</> : <><Clipboard size={13} /> Copier</>}
            </Btn>
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
              ['1', 'Le widget se charge', 'en arrière-plan, sans ralentir la page'],
              ['2', 'Vérification du site', 'seuls vos domaines autorisés peuvent l\'afficher'],
              ['3', 'Anti-robot invisible', 'rien à cliquer pour vos visiteurs'],
              ['4', 'Session sécurisée', 'valable 30 min, liée à votre site'],
              ['5', 'Le chat est prêt', 'vos visiteurs peuvent écrire'],
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

      <SiteColorsCard publicKey={bot.public_key} design={bot.design_json || {}}
                      widgetSrc={integrations.map(it => /src="([^"]+\/widget\.js)"/.exec(it.snippet || '')?.[1]).find(Boolean)} />
    </div>
  )
}

// Options facultatives de la balise : suivre les couleurs et le thème du site, et
// n'envoyer que le chemin des pages. Mêmes attributs que widget.js (docs/WIDGET_CM.md).
function SiteColorsCard({ publicKey, design, widgetSrc }: {
  publicKey: string
  design: { primaryColor?: string | null; onPrimary?: string | null }
  widgetSrc?: string
}) {
  const [copied, setCopied] = useState(false)
  const color = design.primaryColor || '#0d9488'
  const text = design.onPrimary || '#ffffff'
  const src = widgetSrc || 'https://chapote.fr/widget.js'
  const snippet = `<script src="${src}" defer
  data-bot-key="${publicKey}"
  data-color="${color}" data-color-text="${text}"
  data-theme="light"
  data-url-mode="path"></script>`
  const js = `// Si votre site change de thème ou de couleur :
window.ChapoteWidget["${publicKey}"].setAppearance({ color: "${color}", colorText: "${text}", theme: "dark" })`

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* presse-papiers indisponible : l'utilisateur sélectionne à la main */ }
  }

  const rows: [string, string][] = [
    ['data-color', 'Couleur de la bulle, de l\'en-tête et des boutons.'],
    ['data-color-text', 'Couleur du texte posé dessus (blanc ou sombre).'],
    ['data-theme', '« light » ou « dark » : suit le thème clair ou sombre de votre site.'],
    ['data-url-mode="path"', 'N\'envoie que le chemin des pages, jamais les paramètres d\'adresse.'],
  ]
  return (
    <Card>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6, gap: 10, flexWrap: 'wrap' }}>
        <div className="card-title" style={{ marginBottom: 0 }}>Suivre les couleurs de votre site <span style={{ fontWeight: 600, color: 'var(--faint)', fontSize: 12 }}>· facultatif</span></div>
        <Btn kind={copied ? 'soft' : 'ghost'} small onClick={copy}>
          {copied ? <><Check size={13} /> Copié</> : <><Clipboard size={13} /> Copier</>}
        </Btn>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--mut)', lineHeight: 1.55, marginBottom: 10 }}>
        Ces attributs remplacent les couleurs choisies dans Apparence, pour ce site seulement. Utile si votre site a un mode sombre.
      </div>
      <pre className="snippet">{snippet}</pre>
      <div className="col" style={{ gap: 6, marginTop: 10 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ fontSize: 12, lineHeight: 1.5 }}>
            <span className="mono" style={{ fontSize: 11 }}>{k}</span> <span style={{ color: 'var(--mut)' }}>— {v}</span>
          </div>
        ))}
      </div>
      <pre className="snippet" style={{ marginTop: 10 }}>{js}</pre>
    </Card>
  )
}
