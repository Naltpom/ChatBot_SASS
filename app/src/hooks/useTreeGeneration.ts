// Domaine GÉNÉRATION D'ARBRE de BotPage — panneau « Générer avec l'IA » (arbre A) :
// saisie texte/URL, état busy/erreur, et appel POST /api/bots/{id}/tree/generate
// (treegen_limiter 10/24h/org). Le tree_json renvoyé est posé dans l'arbre A LOCAL
// via patch() (la save bar apparaît, l'utilisateur prévisualise puis enregistre).
// Extrait tel quel de BotPage (comportement strictement identique).
import { useState } from 'react'
import { api, ApiError } from '../api'
import { errMsg } from '../utils/errors'
import type { Bot, BotUpdate, Tree } from '../types/bot'

export function useTreeGeneration(botId: number, bot: Bot | null, patch: (fields: BotUpdate) => void) {
  const [genOpen, setGenOpen] = useState(false)                  // panneau « Générer avec l'IA » (arbre A)
  const [genMode, setGenMode] = useState<'text' | 'url'>('text')
  const [genText, setGenText] = useState('')
  const [genUrl, setGenUrl] = useState('')
  const [genBusy, setGenBusy] = useState(false)
  const [genError, setGenError] = useState('')

  // Génération d'arbre par l'IA (perm contexte). POST /tree/generate renvoie un
  // tree_json NON sauvegardé → on le pose dans l'arbre A local. Réservée à la vue A.
  async function generateTree() {
    if (!bot) return
    setGenError('')
    setGenBusy(true)
    try {
      const body = genMode === 'url' ? { url: genUrl.trim() } : { source_text: genText }
      const res = await api<{ tree_json: Tree }>(`/api/bots/${botId}/tree/generate`, { method: 'POST', body })
      const nodeCount = Object.keys(bot.tree_json?.nodes || {}).length
      if (nodeCount > 2 && !window.confirm("Remplacer l'arbre actuel par l'arbre généré ?")) return
      patch({ tree_json: res.tree_json })
      setGenText('')
      setGenUrl('')
      setGenOpen(false)
    } catch (err: unknown) {
      const status = err instanceof ApiError ? err.status : undefined
      setGenError(status === 429
        ? "Limite quotidienne atteinte : 10 générations d'arbre par jour et par organisation. Réessayez demain."
        : errMsg(err, 'Erreur'))
    } finally {
      setGenBusy(false)
    }
  }

  return {
    genOpen, setGenOpen, genMode, setGenMode, genText, setGenText,
    genUrl, setGenUrl, genBusy, genError, generateTree,
  }
}
