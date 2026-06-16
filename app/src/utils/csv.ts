// Export CSV — quoting + anti-injection de formule (Excel/LibreOffice). Les
// valeurs viennent de visiteurs anonymes : on préfixe ' si la cellule commence
// par = + - @ tab ou CR, sinon elle serait interprétée comme formule.

export function csvEsc(v: any): string {
  let s = String(v ?? '')
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

// Construit un CSV (header + lignes, chaque cellule échappée) et déclenche le
// téléchargement. `rows` = tableau de tableaux de valeurs, alignés sur headers.
export function downloadCsv(filename: string, headers: string[], rows: any[][]): void {
  const csv = [headers.join(','), ...rows.map(r => r.map(csvEsc).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}
