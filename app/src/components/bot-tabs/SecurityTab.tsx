// Onglet « Sécurité » de BotPage — présentationnel (domaines, captcha, déplacer
// vers une équipe, zone de danger). Tous les handlers/état viennent de BotPage.
import { Plus } from 'lucide-react'
import { Btn, Card, Chip, InfoBox, SectionTitle, Toggle } from '../../ui'
import { CAPTCHA_OPTIONS } from '../../botConstants'
import type { Bot, BotUpdate, CaptchaProvider } from '../../types/bot'

export default function SecurityTab({
  bot, patch, newDomain, setNewDomain, addDomain, captchaSecret, setCaptchaSecret,
  canMoveToTeam, myTeams, moveTarget, setMoveTarget, moveBusy, moveToTeam,
  isOrgAdmin,
}: {
  bot: Bot
  patch: (fields: BotUpdate) => void
  newDomain: string
  setNewDomain: (v: string) => void
  addDomain: () => void
  captchaSecret: string
  setCaptchaSecret: (v: string) => void
  canMoveToTeam: boolean
  myTeams: { id: number; name: string }[]
  moveTarget: number | ''
  setMoveTarget: (v: number | '') => void
  moveBusy: boolean
  moveToTeam: () => void
  isOrgAdmin: boolean
}) {
  return (
    <div className="col g18">
      <SectionTitle sub="Protection en couches : clé publique → vérif. d'origine → JWT éphémère → rate limits. Vos vraies clés IA ne quittent jamais le serveur.">
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
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div className="card-title" style={{ marginBottom: 0 }}>Limites de débit</div>
              <Chip tone="mut">Lecture seule</Chip>
            </div>
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

          {canMoveToTeam && (
            <Card>
              <div className="card-title">Déplacer vers une équipe</div>
              <div style={{ fontSize: 11.5, color: 'var(--mut)', lineHeight: 1.55, marginBottom: 10 }}>
                Ce chatbot est personnel. Transférez-le à une équipe pour le partager avec ses
                membres. <strong>Transfert définitif</strong> : un bot d'équipe ne peut pas redevenir
                personnel.
              </div>
              <div className="row g8" style={{ flexWrap: 'wrap' }}>
                <select value={moveTarget === '' ? '' : String(moveTarget)}
                        onChange={e => setMoveTarget(e.target.value === '' ? '' : Number(e.target.value))}
                        style={{ flex: 1, minWidth: 180 }}>
                  <option value="">Choisir une équipe…</option>
                  {myTeams.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
                <Btn kind="soft" onClick={moveToTeam} disabled={moveTarget === '' || moveBusy}>
                  {moveBusy ? 'Déplacement…' : 'Déplacer'}
                </Btn>
              </div>
            </Card>
          )}

          {isOrgAdmin && (
            <Card>
              <div className="card-title">Activation</div>
              <div className="toggle-row">
                <div>
                  <div className="tl">Widget actif</div>
                  <div className="ts">Désactivé : le chat disparaît des sites, sans rien supprimer.</div>
                </div>
                <Toggle label="Widget actif" on={bot.is_active} onChange={v => patch({ is_active: v })} />
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
          {/* role=radiogroup + radios accessibles au clavier (Enter/Space). On
              garde des <div> (et non des <button>) car l'option sélectionnée
              imbrique des inputs : un bouton contenant des champs serait du HTML
              invalide. */}
          <div className="col g10" role="radiogroup" aria-label="Vérification anti-bot (captcha)">
            {CAPTCHA_OPTIONS.map(o => {
              const selected = bot.captcha_provider === o.value
              const pick = () => patch({ captcha_provider: o.value as CaptchaProvider })
              return (
                <div key={o.value} role="radio" aria-checked={selected} tabIndex={0}
                     aria-label={o.name}
                     onClick={pick}
                     onKeyDown={e => {
                       // Enter/Space n'activent l'option QUE si la carte elle-même a le
                       // focus — un appui dans un input imbriqué (site/secret key)
                       // bubble jusqu'ici, on ne l'intercepte pas (la saisie d'espace
                       // dans les clés doit passer).
                       if (e.target !== e.currentTarget) return
                       if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick() }
                     }}
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
                                 onChange={e => setCaptchaSecret(e.target.value)} />
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
  )
}
