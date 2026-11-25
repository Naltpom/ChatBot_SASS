// Envoi d'une vidéo en morceaux, comme le site (POST /posts → PUT /posts/{id}/parts/{n} → submit),
// lus un par un dans le fichier (jamais toute la vidéo en mémoire). Couverture : PUT /posts/{id}/cover.
import { fetch as expoFetch } from 'expo/fetch'
import { File } from 'expo-file-system'
import { API_URL, ApiError, authHeaders } from './http'
import { partPlan } from './upload-logic'

async function put(path: string, body: Uint8Array, contentType: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await expoFetch(API_URL + path, {
        method: 'PUT', body: body as unknown as BodyInit, credentials: 'omit',
        headers: { 'Content-Type': contentType, ...(await authHeaders(attempt > 0)) },
      }) as unknown as Response
    } catch {
      if (attempt < 4) { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); continue }
      throw new ApiError(0, 'Envoi interrompu : vérifiez votre connexion et relancez.')
    }
    if (res.ok) return
    if ((res.status >= 500 || res.status === 401) && attempt < 4) { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); continue }
    let message = `Envoi refusé (${res.status})`
    try { const b = await res.json(); if (typeof b?.detail === 'string') message = b.detail } catch { /* corps non JSON */ }
    throw new ApiError(res.status, message)
  }
}

/** Envoie la vidéo `uri` au post `postId` ; `onProgress(octets envoyés, total)`. `startAt` : reprise. */
export async function uploadParts(postId: number, uri: string, size: number, partSize: number,
  onProgress: (sent: number, total: number) => void, startAt = 0, isCancelled: () => boolean = () => false): Promise<void> {
  const file = new File(uri)
  const handle = file.open()
  try {
    for (const p of partPlan(size, partSize)) {
      if (p.index < startAt) continue
      if (isCancelled()) throw new ApiError(0, 'Envoi annulé.')
      handle.offset = p.start
      const bytes = await handle.readBytes(p.length)
      await put(`/api/cm/posts/${postId}/parts/${p.index}`, bytes, 'application/octet-stream')
      onProgress(p.start + p.length, size)
    }
  } finally {
    handle.close()
  }
}

export async function uploadCover(postId: number, uri: string, mime: string): Promise<void> {
  const bytes = await new File(uri).bytes()
  if (bytes.length > 8 * 1024 * 1024) throw new ApiError(400, 'Couverture trop lourde (8 Mo au plus).')
  await put(`/api/cm/posts/${postId}/cover`, bytes, mime || 'image/jpeg')
}
