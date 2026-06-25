// Page légale générique : rend un document Markdown (mentions légales, CGU, CGV,
// politique de confidentialité) importé en ?raw, via react-markdown + remark-gfm
// (tables GFM). Page autoportante (fond blanc, hors shell applicatif).
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Link } from 'react-router-dom'

export default function LegalPage({ md }: { md: string }) {
  return (
    <div style={{ background: '#fff', minHeight: '100vh' }}>
      <style>{LEGAL_CSS}</style>
      <div style={{ maxWidth: 820, margin: '0 auto', padding: '28px 24px 90px' }}>
        <Link to="/" style={{ color: '#2563eb', fontSize: 14, textDecoration: 'none' }}>
          ← Retour à l'accueil
        </Link>
        <article className="legal-doc">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
        </article>
      </div>
    </div>
  )
}

const LEGAL_CSS = `
.legal-doc { color:#1f2937; font-size:15px; line-height:1.65; }
.legal-doc h1 { font-size:28px; margin:22px 0 8px; }
.legal-doc h2 { font-size:20px; margin:30px 0 8px; border-bottom:1px solid #eee; padding-bottom:5px; }
.legal-doc h3 { font-size:16px; margin:20px 0 6px; }
.legal-doc p { margin:10px 0; }
.legal-doc ul { margin:10px 0; padding-left:22px; }
.legal-doc li { margin:4px 0; }
.legal-doc a { color:#2563eb; }
.legal-doc blockquote { margin:14px 0; padding:10px 14px; background:#fff7ed; border-left:3px solid #fb923c; border-radius:6px; color:#7c2d12; font-size:13.5px; }
.legal-doc table { border-collapse:collapse; width:100%; margin:14px 0; font-size:13.5px; }
.legal-doc th, .legal-doc td { border:1px solid #e5e7eb; padding:7px 10px; text-align:left; vertical-align:top; }
.legal-doc th { background:#f9fafb; font-weight:600; }
.legal-doc code { background:#f3f4f6; padding:1px 5px; border-radius:4px; font-size:13px; }
.legal-doc hr { border:none; border-top:1px solid #eee; margin:24px 0; }
`
