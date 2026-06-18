// Rendu MARKDOWN LÉGER et SÛR (pas de HTML brut, anti-XSS) pour les messages de
// bulle : **gras**, *italique* / _italique_, [libellé](url) (http/https only) et
// sauts de ligne. Miroir EXACT du renderMd() de widget/widget.js (parité widget).
// Tout texte sans token markdown ressort à l'identique (les sélecteurs e2e qui
// font toHaveText exact restent valides).
import type { ReactNode } from 'react'

const INLINE = /\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_|\[([^\]]+)\]\(([^)\s]+)\)/g

function inline(line: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  INLINE.lastIndex = 0
  let i = 0
  while ((m = INLINE.exec(line)) !== null) {
    if (m.index > last) out.push(line.slice(last, m.index))
    const k = `${keyBase}-${i++}`
    if (m[1] != null) out.push(<strong key={k}>{m[1]}</strong>)
    else if (m[2] != null) out.push(<em key={k}>{m[2]}</em>)
    else if (m[3] != null) out.push(<em key={k}>{m[3]}</em>)
    else if (m[4] != null) {
      const href = m[5]
      out.push(/^https?:\/\//i.test(href)
        ? <a key={k} href={href} target="_blank" rel="noopener nofollow">{m[4]}</a>
        : m[4]) // url non http(s) -> texte brut (sécurité)
    }
    last = INLINE.lastIndex
  }
  if (last < line.length) out.push(line.slice(last))
  return out
}

export function renderMarkdown(text: string): ReactNode {
  // Inline uniquement : les sauts de ligne (\n) sont conservés en texte et
  // rendus par white-space:pre-wrap (parité avec widget.js + assertions e2e).
  return inline(String(text ?? ''), '0')
}
