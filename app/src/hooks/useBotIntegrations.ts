// Domaine INTÉGRATION de BotPage — chargement des extraits d'intégration du bot
// (GET /api/bots/{id}/embed), sélection du type d'intégration affiché et copie de
// l'extrait courant dans le presse-papier (flag « Copié » 1,6 s). Extrait tel quel
// de BotPage (comportement strictement identique).
import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Integration } from '../types/bot'

export function useBotIntegrations(botId: number) {
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [integType, setIntegType] = useState('html')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api<{ integrations: Integration[] }>(`/api/bots/${botId}/embed`)
      .then(d => setIntegrations(d.integrations)).catch(() => {})
  }, [botId])

  const currentInteg = integrations.find(i => i.id === integType) || integrations[0]

  // Copie de l'extrait d'intégration courant (clipboard + flag « Copié » 1,6 s).
  function copySnippet() {
    navigator.clipboard.writeText(currentInteg?.snippet || '').catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return { integrations, integType, setIntegType, currentInteg, copied, copySnippet }
}
