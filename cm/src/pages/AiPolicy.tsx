// Politique IA de l'Assistant Chapote CM (docs/CM_MCP.md, §3). Page publique ; le prestataire affiché est
// celui réellement configuré sur le bot assistant (chapote.fr). Fonction éteinte : rien n'est proposé.
import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Link } from 'react-router-dom'
import { getAiPublic, type AiPublic } from '../api'
import { BrandMark } from '../components/ui'
import policy from '../legal/ai-policy.md?raw'
import policyEn from '../legal/ai-policy.en.md?raw'
import { getLang, t } from '../i18n'

// Paragraphe propre au prestataire (vérifié pour Anthropic ; à compléter avant d'en changer).
const DETAILS: Record<string, string> = {
  Anthropic: 'Anthropic Ireland Limited, fournisseur du modèle Claude, traite ces données sur des serveurs aux États-Unis ; '
    + 'ce transfert est encadré par les clauses contractuelles types de la Commission européenne. Anthropic n’utilise pas ces '
    + 'données pour entraîner ses modèles et les supprime sous 30 jours (sauf contenu signalé comme contraire à ses règles '
    + 'd’usage, gardé jusqu’à 2 ans).',
}

export default function AiPolicy() {
  const [info, setInfo] = useState<AiPublic | null>(null)
  useEffect(() => { document.title = t('Politique IA · Chapote CM'); window.scrollTo(0, 0); getAiPublic().then(setInfo).catch(() => setInfo({ enabled: false })) }, [])
  const provider = info?.provider || t('notre prestataire d’IA')
  const md = (getLang() === 'en' ? policyEn : policy)
    .replace('{version}', info?.policy_version || '—')
    .replace(/\{provider\}/g, provider)
    .replace('{provider_details}', DETAILS[provider] ? t(DETAILS[provider]) : '')
    .replace('{retention}', String(info?.retention_days ?? 30))
    .replace('{min_age}', String(info?.min_age ?? 15))
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)' }}>
      <header style={{ maxWidth: 760, margin: '0 auto', padding: '16px 16px 0' }}>
        <Link to="/" className="row-nw" style={{ gap: 8, color: 'var(--text)', fontWeight: 700 }} aria-label={t('Chapote CM, accueil')}><BrandMark size={28} />Chapote CM</Link>
      </header>
      <main className="legal" style={{ maxWidth: 760, margin: '0 auto', padding: '8px 16px 48px', lineHeight: 1.6, overflowWrap: 'anywhere' }}>
        {info && !info.enabled
          ? <><h1>{t('Politique IA')}</h1><p>{t('L’assistant sur vos données n’est pas encore proposé.')}</p></>
          : <ReactMarkdown components={{ a: ({ href, children }) => href?.startsWith('/') ? <Link to={href}>{children}</Link> : <a href={href} target="_blank" rel="noreferrer">{children}</a> }}>{md}</ReactMarkdown>}
      </main>
    </div>
  )
}
