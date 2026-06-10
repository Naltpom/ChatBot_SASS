// Landing publique — portée de « Kertios Chat - Landing.html » (design) :
// Bricolage Grotesque + accent serif italique, blobs, démo widget interactive,
// Pourquoi hybride / Fonctionnement / Sécurité (bandeau sombre) / Tarifs / CTA.
import { ChevronRight, GitBranch, ShieldCheck, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import WidgetPreview from '../components/WidgetPreview'

const DEMO_DESIGN = {
  primaryColor: '#0d9488', secondaryColor: null, position: 'right', size: 'md',
  borderRadius: 16, icon: 'chat', avatarImage: '', bordered: false,
  title: 'Assistant Marchand', placeholder: 'Écrivez votre message…',
  loadingAnimation: 'dots', poweredBy: true,
}

const DEMO_TREE = {
  start: 'root',
  nodes: {
    root: {
      message: "Bonjour ! Je suis l'assistant du cabinet. Comment puis-je vous aider ?",
      options: [
        { label: 'Prendre rendez-vous', next: 'rdv' },
        { label: 'Nos services', next: 'services' },
        { label: 'Tarifs', next: 'tarifs' },
        { label: 'Autre question', next: '__ai__' },
      ],
    },
    rdv: {
      message: 'Très bien ! Vous pouvez réserver un créneau directement en ligne, ou préférez-vous être rappelé ?',
      options: [
        { label: 'Réserver en ligne', next: 'rdv_ligne' },
        { label: 'Être rappelé', next: 'rdv_rappel' },
        { label: 'Menu principal', next: 'root' },
      ],
    },
    rdv_ligne: {
      message: 'Voici le lien de réservation : cabinet-marchand.fr/rdv — choisissez le créneau qui vous convient. À bientôt !',
      options: [{ label: 'Menu principal', next: 'root' }],
    },
    rdv_rappel: {
      message: 'Parfait. Laissez-nous votre numéro via le formulaire de contact et nous vous rappelons sous 24 h ouvrées.',
      options: [{ label: 'Menu principal', next: 'root' }],
    },
    services: {
      message: "Nous accompagnons TPE et indépendants : comptabilité, paie, création d'entreprise et pilotage. Un domaine vous intéresse ?",
      options: [
        { label: 'Comptabilité', next: 'compta' },
        { label: 'Paie & social', next: 'paie' },
        { label: 'Autre question', next: '__ai__' },
        { label: 'Menu principal', next: 'root' },
      ],
    },
    compta: {
      message: 'Tenue complète, bilans, liasses fiscales et tableaux de bord trimestriels. Forfaits dès 180 €/mois pour les TPE.',
      options: [{ label: 'Prendre rendez-vous', next: 'rdv' }, { label: 'Menu principal', next: 'root' }],
    },
    paie: {
      message: "Bulletins, DSN, contrats et conseil social. Tarification au bulletin, dégressive selon l'effectif.",
      options: [{ label: 'Prendre rendez-vous', next: 'rdv' }, { label: 'Menu principal', next: 'root' }],
    },
    tarifs: {
      message: 'Nos forfaits démarrent à 180 €/mois (TPE) et sont ajustés à votre volume. Un devis précis prend 10 minutes en rendez-vous.',
      options: [
        { label: 'Prendre rendez-vous', next: 'rdv' },
        { label: 'Autre question', next: '__ai__' },
        { label: 'Menu principal', next: 'root' },
      ],
    },
  },
}

const PLANS = [
  {
    name: 'Starter', price: '19', pop: false,
    feats: ['1 chatbot', '500 réponses IA / mois', 'Réponses arbre illimitées', 'Stats essentielles', 'Turnstile inclus'],
  },
  {
    name: 'Pro', price: '39', pop: true,
    feats: ['3 chatbots', '2 000 réponses IA / mois', 'Réponses arbre illimitées', 'Stats complètes', 'Équipe & permissions', 'Cap budget configurable'],
  },
  {
    name: 'Agence', price: '119', pop: false,
    feats: ['10 chatbots', '10 000 réponses IA / mois', 'BYOK (vos clés API)', 'Multi-organisations', 'Permissions par bot', 'Support prioritaire'],
  },
]

export default function Landing() {
  const { user } = useAuth()

  return (
    <div className="landing">
      <div className="page-blobs"><div className="b b1" /><div className="b b2" /><div className="b b3" /></div>
      <div className="l-content">

        {/* ---- Nav ---- */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 50, background: 'rgba(237,246,243,.86)',
          backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(220,235,231,.7)',
        }}>
          <div className="l-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 28px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <img src="/brand/icon.svg" alt="" style={{ width: 34, height: 34, borderRadius: 9 }} />
              <span className="font-display" style={{ fontWeight: 700, fontSize: 18, whiteSpace: 'nowrap' }}>
                Kertios <span style={{ color: 'var(--l-teal)' }}>Chat</span>
              </span>
            </div>
            <nav style={{ display: 'flex', alignItems: 'center', gap: 26 }} className="landing-nav">
              <a className="navlink" href="#hybride">Pourquoi hybride</a>
              <a className="navlink" href="#how">Fonctionnement</a>
              <a className="navlink" href="#secu">Sécurité</a>
              <a className="navlink" href="#tarifs">Tarifs</a>
            </nav>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {user ? (
                <Link className="l-btn l-btn-primary l-btn-sm" to="/app">Ouvrir l'application</Link>
              ) : (
                <>
                  <Link className="navlink" to="/login" style={{ padding: '8px 10px' }}>Se connecter</Link>
                  <Link className="l-btn l-btn-primary l-btn-sm" to="/register">Créer mon compte</Link>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ---- Hero + démo live ---- */}
        <section style={{ padding: '64px 0 90px' }}>
          <div className="l-container l-hero-grid" style={{ display: 'grid', gridTemplateColumns: '1.02fr .98fr', gap: 54, alignItems: 'center' }}>
            <div className="fade-up">
              <span className="eyebrow" style={{ marginBottom: 26 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--l-teal)', animation: 'pulseDot 2s infinite' }} />
                Chatbot hybride — arbre + IA
              </span>
              <h1 className="font-display" style={{ fontSize: 'clamp(44px, 5.6vw, 78px)', lineHeight: 1.04, fontWeight: 800, margin: '22px 0 26px', letterSpacing: '-.035em' }}>
                Un chatbot qui<br />
                <span className="font-serif" style={{ color: 'var(--l-teal)', fontWeight: 400, fontSize: '1.04em' }}>ne brûle pas</span><br />
                votre budget IA.
              </h1>
              <p style={{ fontSize: 19, lineHeight: 1.55, color: 'var(--l-ink2)', maxWidth: 470, margin: '0 0 30px' }}>
                L'arbre de décision répond <strong>gratuitement</strong> aux questions courantes.
                L'IA prend le relais <strong>seulement quand il faut</strong> — plafonnée, sécurisée, sans surprise sur la facture.
              </p>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <Link className="l-btn l-btn-primary" to="/register">
                  Créer mon chatbot <ChevronRight size={15} strokeWidth={2.5} />
                </Link>
                <a className="l-btn l-btn-ghost" href="#demo">Essayer la démo</a>
              </div>
              <div style={{ display: 'flex', gap: 18, marginTop: 28, fontSize: 13, color: 'var(--l-muted)', flexWrap: 'wrap' }}>
                <span>✓ Installation en 1 balise</span>
                <span>✓ Réponses arbre illimitées</span>
                <span>✓ RGPD-ready</span>
              </div>
            </div>

            <div id="demo" className="fade-up" style={{ animationDelay: '.12s' }}>
              <div className="l-card shadow-lg" style={{ overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 14px', borderBottom: '1px solid var(--l-line)', background: 'var(--l-cream)' }}>
                  {['#f87171', '#fbbf24', '#34d399'].map(c => <span key={c} style={{ width: 9, height: 9, borderRadius: 99, background: c, display: 'inline-block' }} />)}
                  <span className="mono" style={{ flex: 1, textAlign: 'center', fontSize: 10.5, color: 'var(--l-muted)' }}>cabinet-marchand.fr — démo interactive</span>
                </div>
                <div style={{ position: 'relative', height: 540, background: '#fff', overflow: 'hidden' }}>
                  <div style={{ padding: '24px 26px', opacity: .8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontWeight: 800, fontSize: 14, color: '#283733' }}>Cabinet Marchand</div>
                      <div style={{ display: 'flex', gap: 12 }}>
                        {['Services', 'Tarifs', 'Contact'].map(n => <span key={n} style={{ fontSize: 11, color: '#7d8c87' }}>{n}</span>)}
                      </div>
                    </div>
                    <div style={{ marginTop: 28, maxWidth: 330 }}>
                      <div style={{ height: 18, width: '75%', borderRadius: 6, background: '#e8eeec' }} />
                      <div style={{ height: 18, width: '52%', borderRadius: 6, background: '#e8eeec', marginTop: 7 }} />
                      <div style={{ height: 10, width: '90%', borderRadius: 5, background: '#f0f4f3', marginTop: 15 }} />
                      <div style={{ height: 10, width: '78%', borderRadius: 5, background: '#f0f4f3', marginTop: 6 }} />
                      <div style={{ height: 30, width: 116, borderRadius: 8, background: '#0d9488', opacity: .85, marginTop: 18 }} />
                    </div>
                  </div>
                  <div style={{
                    position: 'absolute', left: 18, bottom: 16, fontSize: 11, fontWeight: 700, color: 'var(--l-teal-deep)',
                    background: 'var(--l-teal-soft)', border: '1px solid #bfe2db', borderRadius: 99, padding: '6px 11px',
                  }}>Cliquez sur la bulle, c'est un vrai chat</div>
                  <WidgetPreview design={DEMO_DESIGN} mode="hybrid" tree={DEMO_TREE}
                                 botName="Assistant Marchand" defaultOpen={false} />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---- Pourquoi hybride ---- */}
        <section id="hybride" style={{ padding: '40px 0 80px' }}>
          <div className="l-container">
            <div style={{ textAlign: 'center', maxWidth: 640, margin: '0 auto 44px' }}>
              <span className="eyebrow">Pourquoi hybride</span>
              <h2 className="font-display" style={{ fontSize: 'clamp(30px, 3.6vw, 46px)', fontWeight: 700, lineHeight: 1.08, margin: '18px 0 12px' }}>
                Le tout-IA coûte cher.<br />Le tout-arbre <span className="font-serif" style={{ color: 'var(--l-teal)', fontWeight: 400 }}>frustre</span>.
              </h2>
            </div>
            <div className="l-grid3">
              {[
                {
                  icon: <GitBranch size={20} />, t: "L'arbre répond d'abord", co: '#0d9488', bg: '#e0f2ef',
                  d: 'Horaires, tarifs, prise de RDV : 70% des questions sont prévisibles. L\'arbre de décision y répond instantanément — gratuit et illimité.',
                },
                {
                  icon: <Sparkles size={20} />, t: "L'IA quand il le faut", co: '#7c5cd6', bg: '#ece7f9',
                  d: '« Autre question » bascule vers le modèle de votre choix (Claude, GPT), nourri par votre contexte. Chaque réponse IA est décomptée, pas une de plus.',
                },
                {
                  icon: <ShieldCheck size={20} />, t: 'Plafond = zéro surprise', co: '#b06f0e', bg: '#f7eed9',
                  d: 'Cap journalier de réponses IA : atteint, le bot repasse en mode arbre. Votre facture a un maximum, par construction.',
                },
              ].map(c => (
                <div key={c.t} className="l-card" style={{ padding: '26px 24px' }}>
                  <span style={{ width: 44, height: 44, borderRadius: 13, background: c.bg, color: c.co, display: 'grid', placeItems: 'center' }}>{c.icon}</span>
                  <h3 className="font-display" style={{ fontSize: 20, fontWeight: 700, margin: '16px 0 8px' }}>{c.t}</h3>
                  <p style={{ fontSize: 14.5, color: 'var(--l-ink2)', margin: 0, lineHeight: 1.6 }}>{c.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---- Fonctionnement ---- */}
        <section id="how" style={{ padding: '30px 0 80px' }}>
          <div className="l-container l-hero-grid" style={{ display: 'grid', gridTemplateColumns: '.9fr 1.1fr', gap: 54, alignItems: 'center' }}>
            <div>
              <span className="eyebrow">Fonctionnement</span>
              <h2 className="font-display" style={{ fontSize: 'clamp(30px, 3.6vw, 44px)', fontWeight: 700, lineHeight: 1.08, margin: '18px 0 26px' }}>
                En ligne <span className="font-serif" style={{ color: 'var(--l-teal)', fontWeight: 400 }}>avant</span> votre pause café.
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                {[
                  ['1', 'Configurez en 2 minutes', 'Wizard guidé : nom, type (arbre, IA ou hybride), apparence aux couleurs de votre site.'],
                  ['2', 'Collez une balise', "Un <script> avant </body> et c'est en ligne. WordPress, GTM, React ou iframe aussi. Moins de 30 ko, zéro impact sur votre vitesse."],
                  ['3', 'Suivez tout, pilotez tout', "Conversations, visiteurs uniques, conso IA en temps réel. Ajustez l'arbre là où l'IA est trop sollicitée."],
                ].map(([n, t, d]) => (
                  <div key={n} style={{ display: 'flex', gap: 16 }}>
                    <span className="font-display" style={{
                      width: 38, height: 38, borderRadius: 99, background: 'linear-gradient(135deg,#12a392,#0b7d72)', color: '#fff',
                      display: 'grid', placeItems: 'center', fontSize: 16, fontWeight: 700, flexShrink: 0, boxShadow: '0 4px 12px rgba(13,148,136,.3)',
                    }}>{n}</span>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 16.5 }}>{t}</div>
                      <div style={{ fontSize: 14, color: 'var(--l-ink2)', marginTop: 4, lineHeight: 1.6 }}>{d}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="l-card shadow-md" style={{ padding: 22 }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: .8, textTransform: 'uppercase', color: 'var(--l-muted)', marginBottom: 12 }}>
                Toute l'installation tient ici
              </div>
              <pre className="mono" style={{
                margin: 0, fontSize: 13, lineHeight: 1.8, padding: '18px 20px', borderRadius: 13,
                background: '#0b0e14', color: '#e6eaf0', overflowX: 'auto',
              }}>{'<script\n  src="https://chat.kertios.fr/widget.js"\n  data-bot-key="pk_…"\n  defer>\n</' + 'script>'}</pre>
              <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                {['HTML', 'WordPress', 'Tag Manager', 'React', 'iframe'].map(x => (
                  <span key={x} style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--l-teal-deep)', background: 'var(--l-teal-soft)', border: '1px solid #bfe2db', borderRadius: 99, padding: '5px 11px' }}>{x}</span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ---- Sécurité (bandeau sombre) ---- */}
        <section id="secu" style={{ padding: '30px 0 80px' }}>
          <div className="l-container">
            <div className="l-card shadow-lg" style={{ padding: '38px 36px', background: '#0f2a24', border: 'none' }}>
              <div className="l-hero-grid" style={{ display: 'grid', gridTemplateColumns: '.8fr 1.2fr', gap: 40, alignItems: 'center' }}>
                <div>
                  <span className="eyebrow" style={{ background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.14)', color: '#7adfd2' }}>Sécurité</span>
                  <h2 className="font-display" style={{ fontSize: 'clamp(26px, 3vw, 38px)', fontWeight: 700, lineHeight: 1.1, margin: '16px 0 10px', color: '#fff' }}>
                    Un script public,<br />des coûts <span className="font-serif" style={{ color: '#5eead4', fontWeight: 400 }}>privés</span>.
                  </h2>
                  <p style={{ fontSize: 14.5, color: 'rgba(255,255,255,.72)', lineHeight: 1.65, margin: 0 }}>
                    Un widget embarqué est exposé par nature. Le nôtre est conçu pour que ça ne vous coûte jamais rien.
                  </p>
                </div>
                <div className="l-grid2">
                  {[
                    ['Clé publique seulement', "Comme Stripe : la balise n'expose qu'un identifiant. Vos clés IA ne quittent jamais nos serveurs."],
                    ['Domaines verrouillés', 'Le widget refuse de se charger ailleurs que sur vos domaines autorisés.'],
                    ['Sessions éphémères', 'JWT 30 min + rate limiting multi-niveaux. Les bots et les scrapers paient leur tournée ailleurs.'],
                    ['RGPD par défaut', 'Captcha invisible Cloudflare Turnstile, pas de cookie publicitaire, flux de données documentés pour votre registre.'],
                  ].map(([t, d]) => (
                    <div key={t} style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 14, padding: '16px 17px' }}>
                      <div style={{ fontWeight: 800, fontSize: 14, color: '#aef0e6' }}>{t}</div>
                      <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.68)', marginTop: 5, lineHeight: 1.6 }}>{d}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---- Tarifs ---- */}
        <section id="tarifs" style={{ padding: '30px 0 90px' }}>
          <div className="l-container">
            <div style={{ textAlign: 'center', maxWidth: 560, margin: '0 auto 42px' }}>
              <span className="eyebrow">Tarifs</span>
              <h2 className="font-display" style={{ fontSize: 'clamp(30px, 3.6vw, 46px)', fontWeight: 700, lineHeight: 1.08, margin: '18px 0 10px' }}>
                Prévisible, <span className="font-serif" style={{ color: 'var(--l-teal)', fontWeight: 400 }}>par design</span>.
              </h2>
              <p style={{ color: 'var(--l-ink2)', fontSize: 15.5, margin: 0 }}>
                Compte gratuit pour découvrir. Jamais au-delà de votre plafond.
              </p>
            </div>
            <div className="l-grid3" style={{ alignItems: 'stretch' }}>
              {PLANS.map(p => (
                <div key={p.name} className={`l-card ${p.pop ? 'shadow-lg' : ''}`} style={{
                  padding: '28px 26px', display: 'flex', flexDirection: 'column', position: 'relative',
                  border: p.pop ? '2px solid var(--l-teal)' : '1px solid var(--l-line)',
                }}>
                  {p.pop && <span style={{
                    position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
                    background: 'linear-gradient(135deg,#12a392,#0b7d72)', color: '#fff', fontSize: 11, fontWeight: 800,
                    letterSpacing: .8, textTransform: 'uppercase', borderRadius: 99, padding: '5px 14px',
                  }}>Populaire</span>}
                  <div className="font-display" style={{ fontSize: 19, fontWeight: 700 }}>{p.name}</div>
                  <div style={{ margin: '10px 0 18px' }}>
                    <span className="font-display" style={{ fontSize: 44, fontWeight: 800, letterSpacing: '-.03em' }}>{p.price} €</span>
                    <span style={{ color: 'var(--l-muted)', fontSize: 14 }}> / mois</span>
                  </div>
                  <ul style={{ listStyle: 'none', margin: '0 0 24px', padding: 0, display: 'flex', flexDirection: 'column', gap: 9, flex: 1 }}>
                    {p.feats.map(f => (
                      <li key={f} style={{ display: 'flex', gap: 9, fontSize: 14, color: 'var(--l-ink2)' }}>
                        <span style={{ color: 'var(--l-teal)', fontWeight: 800 }}>✓</span>{f}
                      </li>
                    ))}
                  </ul>
                  <Link className={`l-btn ${p.pop ? 'l-btn-primary' : 'l-btn-ghost'}`} to="/register">Commencer</Link>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---- CTA final ---- */}
        <section style={{ padding: '10px 0 90px' }}>
          <div className="l-container" style={{ textAlign: 'center' }}>
            <h2 className="font-display" style={{ fontSize: 'clamp(32px, 4vw, 54px)', fontWeight: 800, lineHeight: 1.04, margin: '0 0 14px', letterSpacing: '-.03em' }}>
              Votre site mérite mieux<br />qu'un <span className="font-serif" style={{ color: 'var(--l-teal)', fontWeight: 400 }}>formulaire de contact</span>.
            </h2>
            <p style={{ color: 'var(--l-ink2)', fontSize: 16.5, margin: '0 0 28px' }}>
              Compte gratuit, premier bot en ligne en moins de 5 minutes.
            </p>
            <Link className="l-btn l-btn-primary" to="/register" style={{ fontSize: 16, padding: '15px 30px' }}>
              Créer mon chatbot <ChevronRight size={15} strokeWidth={2.5} />
            </Link>
          </div>
        </section>

        {/* ---- Footer ---- */}
        <footer style={{ borderTop: '1px solid var(--l-line)', background: 'rgba(255,255,255,.5)' }}>
          <div className="l-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '26px 28px', flexWrap: 'wrap', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <img src="/brand/icon.svg" alt="" style={{ width: 24, height: 24, borderRadius: 6 }} />
              <span className="font-display" style={{ fontWeight: 700, fontSize: 14.5, whiteSpace: 'nowrap' }}>
                Kertios <span style={{ color: 'var(--l-teal)' }}>Chat</span>
              </span>
              <span style={{ fontSize: 12.5, color: 'var(--l-muted)' }}>· chatbots hybrides arbre + IA</span>
            </div>
            <div style={{ display: 'flex', gap: 22, fontSize: 13 }}>
              <a className="navlink" href="#tarifs">Tarifs</a>
              <Link className="navlink" to="/register">Inscription</Link>
              <Link className="navlink" to="/login">Se connecter</Link>
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
}
