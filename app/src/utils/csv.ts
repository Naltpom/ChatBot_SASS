// Export CSV — quoting + anti-injection de formule (Excel/LibreOffice). Les
// valeurs viennent de visiteurs anonymes : on préfixe ' si la cellule commence
// par = + - @ tab ou CR, sinon elle serait interprétée comme formule.

export function csvEsc(v: unknown): string {
  let s = String(v ?? '')
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

// Construit un CSV (header + lignes, chaque cellule échappée) et déclenche le
// téléchargement. `rows` = tableau de tableaux de valeurs, alignés sur headers.
// Générique sur la clé de colonne (K) pour que l'appelant passe `(keyof T)[]`
// comme en-têtes et indexe ses lignes via cette même clé — sans `as any`.
export function downloadCsv<K extends string = string>(
  filename: string,
  headers: readonly K[],
  rows: ReadonlyArray<readonly unknown[]>,
): void {
  const csv = [headers.join(','), ...rows.map(r => r.map(csvEsc).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}
