import { Fragment, useEffect, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useI18n } from '../i18n'
import { Center } from '../components/ui'
import { DOCS, UPDATED, type DocKey } from '../legal/texts'

const KEYS: DocKey[] = ['terms', 'use', 'privacy', 'notice']

// **gras** et adresses e-mail cliquables, rien d'autre
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|[\w.+-]+@[\w-]+\.[\w.]+)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(part)) return <a key={i} href={`mailto:${part}`}>{part}</a>
    return <Fragment key={i}>{part}</Fragment>
  })
}

function render(body: string): ReactNode[] {
  const out: ReactNode[] = []
  let list: string[] = []
  const flush = () => {
    if (list.length) out.push(<ul key={`u${out.length}`}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>)
    list = []
  }
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('- ')) { list.push(line.slice(2)); continue }
    flush()
    if (!line) continue
    if (line.startsWith('## ')) out.push(<h2 key={`h${out.length}`}>{line.slice(3)}</h2>)
    else out.push(<p key={`p${out.length}`}>{inline(line)}</p>)
  }
  flush()
  return out
}

export default function LegalPage() {
  const { doc = '' } = useParams()
  const { t, lang } = useI18n()
  const d = (DOCS[lang] as Record<string, { title: string; body: string }>)[doc]
  useEffect(() => { if (d) document.title = `${d.title} · Ghost Hands Sheets` }, [d])
  if (!d) return <Center><p>{t.notFound}</p><Link to="/">{t.backHome}</Link></Center>
  const labels: Record<DocKey, string> = { terms: t.terms, use: t.use, privacy: t.privacy, notice: t.notice }
  return (
    <main className="legal">
      <nav className="legal-tabs chips" aria-label="Legal">
        {KEYS.map(k => <Link key={k} to={`/legal/${k}`} className="chip" aria-current={k === doc ? 'page' : undefined}
                             style={k === doc ? { background: 'var(--ink)', color: '#fff' } : undefined}>{labels[k]}</Link>)}
      </nav>
      <h1>{d.title}</h1>
      <p className="upd">{UPDATED[lang]}</p>
      {render(d.body)}
    </main>
  )
}
