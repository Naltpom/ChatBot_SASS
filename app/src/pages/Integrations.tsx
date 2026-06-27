// Page « Intégrations » du dashboard (/app/integrations). Guide l'utilisateur
// pour connecter un site WordPress à Chapote via le plugin « Chapote
// Back-office » : 1) installer le plugin, 2) ouvrir le menu Chapote, 3) cliquer
// « Se connecter avec Chapote » — ce qui ouvre l'écran de consentement OAuth
// (/authorize) validé ici, dans ce même dashboard.
//
// Purement explicatif : aucun endpoint « sites liés » n'existe encore, donc on
// ne liste pas les connexions (on reste sur le mode d'emploi + téléchargement).
import { ReactNode } from 'react'
import { Download, ExternalLink, Plug } from 'lucide-react'
import { Card, InfoBox, SectionTitle } from '../ui'
import { WP_PLUGIN_URL, WP_PLUGIN_WPORG_URL } from '../integrations'

// Étape numérotée du mode d'emploi (pastille + titre + détail).
function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <span style={{
        flexShrink: 0, width: 28, height: 28, borderRadius: '50%',
        background: 'var(--acc-soft)', color: 'var(--acc)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 700, fontSize: 13.5,
      }}>{n}</span>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{title}</div>
        <div style={{ fontSize: 13, color: 'var(--mut)', lineHeight: 1.6, marginTop: 3 }}>{children}</div>
      </div>
    </div>
  )
}

export default function Integrations() {
  return (
    <div className="col g18">
      <SectionTitle sub="Pilotez vos chatbots Chapote depuis l'administration de votre site">
        Intégrations
      </SectionTitle>

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{
            width: 34, height: 34, borderRadius: 10, background: 'var(--acc-soft)',
            color: 'var(--acc)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Plug size={18} />
          </span>
          <div className="card-title" style={{ marginBottom: 0 }}>WordPress</div>
        </div>
        <p style={{ fontSize: 13, color: 'var(--mut)', lineHeight: 1.6, margin: '0 0 18px' }}>
          Installez le plugin <strong>Chapote Back-office</strong> sur votre site WordPress pour
          créer et gérer vos chatbots sans quitter votre administration. La connexion est
          sécurisée : vous l'autorisez explicitement ici, depuis votre compte Chapote.
        </p>

        <div className="col" style={{ gap: 16 }}>
          <Step n={1} title="Installer le plugin Chapote sur WordPress">
            Téléchargez le plugin ci-dessous, puis dans WordPress&nbsp;: <em>Extensions → Ajouter →
            Téléverser une extension</em>. Activez-le après l'installation.
          </Step>
          <Step n={2} title="Ouvrir le menu « Chapote »">
            Une fois activé, un menu <strong>Chapote</strong> apparaît dans la barre latérale de
            l'administration WordPress.
          </Step>
          <Step n={3} title="« Se connecter avec Chapote »">
            Cliquez sur ce bouton dans le menu Chapote&nbsp;: vous êtes redirigé ici pour
            autoriser votre site. Une fois autorisé, le plugin gère vos chatbots automatiquement.
          </Step>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 22 }}>
          {/* Téléchargement du plugin (zip statique du front pour l'instant). */}
          <a href={WP_PLUGIN_URL} download className="btn btn-primary" style={{ textDecoration: 'none' }}>
            <Download size={15} /> Télécharger le plugin
          </a>
          {/* Fiche WordPress.org (placeholder tant que non publié). */}
          <a href={WP_PLUGIN_WPORG_URL} target="_blank" rel="noreferrer" className="btn btn-ghost" style={{ textDecoration: 'none' }}>
            <ExternalLink size={15} /> Voir sur WordPress.org
          </a>
        </div>
      </Card>

      <InfoBox tone="info" title="Comment ça marche">
        Le plugin n'a jamais accès à votre mot de passe Chapote&nbsp;: il reçoit, après votre
        autorisation, un jeton dédié et révocable, limité à la gestion de vos chatbots. Vous
        pouvez connecter plusieurs sites à un même compte.
      </InfoBox>
    </div>
  )
}
