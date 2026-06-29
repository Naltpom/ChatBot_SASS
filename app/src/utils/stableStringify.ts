// Sérialisation JSON STABLE : clés d'objet triées récursivement, pour comparer
// deux structures (dirty-tracking) indépendamment de l'ordre des clés que le
// serveur peut renvoyer. Les tableaux gardent leur ordre.
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.keys(val as Record<string, unknown>).sort().reduce((a, k) => {
        a[k] = (val as Record<string, unknown>)[k]; return a
      }, {} as Record<string, unknown>)
      : val)
}
