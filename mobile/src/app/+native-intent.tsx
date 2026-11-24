// Liens système : le partage depuis la galerie arrive en « chapotecm://dataUrl=… » → nouvelle publication.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    if (path.includes('dataUrl=')) return '/new?shared=1'
    return path
  } catch {
    return '/'
  }
}
