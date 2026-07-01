// Téléchargement du plugin WordPress avec un nom de fichier VERSIONNÉ.
//
// Le bouton « Télécharger le plugin » pointait sur le « dernier stable » non daté
// (chapote-bot-manager.zip) — impossible de savoir quelle version on a (cf. l'incident
// où la prod servait une 2.1.0 sous le même nom). Ce hook lit la version dans le
// manifeste (chapote-bot-manager.json, régénéré à chaque déploiement par deploy.sh) et
// renvoie un lien vers l'archive VERSIONNÉE chapote-bot-manager-<version>.zip (qui
// existe aussi dans /downloads/). Repli silencieux sur le dernier stable tant que
// le manifeste n'est pas chargé (ou en prérendu, où l'effet ne tourne pas).
import { useEffect, useState } from 'react'
import { WP_PLUGIN_MANIFEST_URL, WP_PLUGIN_URL } from '../integrations'

export interface PluginDownload {
  url: string            // href du zip (versionné si connu, sinon dernier stable)
  filename: string       // nom de fichier suggéré (attribut download)
  version: string | null // version courante, ou null tant qu'inconnue
}

export function usePluginDownload(): PluginDownload {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch(WP_PLUGIN_MANIFEST_URL)
      .then(r => (r.ok ? r.json() : null))
      .then((d: { version?: unknown } | null) => {
        if (alive && d && typeof d.version === 'string') setVersion(d.version)
      })
      .catch(() => { /* repli silencieux : on garde le dernier stable */ })
    return () => { alive = false }
  }, [])

  return version
    ? { url: `/downloads/chapote-bot-manager-${version}.zip`, filename: `chapote-bot-manager-${version}.zip`, version }
    : { url: WP_PLUGIN_URL, filename: 'chapote-bot-manager.zip', version: null }
}
