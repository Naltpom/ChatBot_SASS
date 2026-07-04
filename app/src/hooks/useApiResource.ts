import { useEffect, useState } from 'react'
import { api } from '../api'
import { errMsg } from '../utils/errors'

export interface ApiResource<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
}

// Charge une ressource GET via le client api() (donc gestion 401 -> /login
// conservée) :
//   - loading vrai pendant le fetch, faux à la résolution (succès ou échec) ;
//   - error = err.message (ApiError porte déjà un message FR exploitable) ;
//   - reload() relance la requête.
// Course conditions : une réponse n'est appliquée que si le hook est toujours
// monté ET que la requête n'a pas été relancée entre-temps (path changé ou
// reload()). Le drapeau `alive` par effet garantit qu'une réponse obsolète est
// ignorée.
export function useApiResource<T>(path: string): ApiResource<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    api<T>(path)
      .then(d => { if (alive) setData(d) })
      .catch((err: unknown) => { if (alive) setError(errMsg(err, 'Erreur')) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [path, tick])

  return { data, loading, error, reload: () => setTick(n => n + 1) }
}
