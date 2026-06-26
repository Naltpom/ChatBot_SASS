// Card « Conversations récentes » — table dépliable (clic = ouvre les messages),
// pur présentationnel, extrait de StatsPanel (refacto R13). Consomme timeAgo /
// pathnameOf de utils/time (résorption D9 : new URL sans try/catch).
import React, { useState } from 'react'
import { Bot as BotIcon, User } from 'lucide-react'
import { Card, Chip } from '../../ui'
import { pathnameOf, timeAgo } from '../../utils/time'
import type { Conv } from './types'

function convMode(messages: Conv['messages']) {
  const hasAI = messages.some(m => m.source === 'ai')
  const hasTree = messages.some(m => m.source === 'tree' && m.role === 'user')
  if (hasAI && hasTree) return 'TREE→IA'
  if (hasAI) return 'IA'
  return 'TREE'
}

export default function RecentConversationsTable({ convs }: { convs: Conv[] }) {
  const [openConv, setOpenConv] = useState<string | null>(null)

  return (
    <Card nopad>
      <div className="card-title" style={{ padding: '14px 16px 10px', marginBottom: 0 }}>Conversations récentes</div>
      <div className="table-scroll">
      <table className="kc">
        <thead>
          <tr><th>Page</th><th>Mode</th><th>Msgs</th><th>Quand</th></tr>
        </thead>
        <tbody>
          {convs.map(c => {
            const mode = convMode(c.messages)
            const open = openConv === c.id
            return (
              <React.Fragment key={c.id}>
                <tr className="click" onClick={() => setOpenConv(open ? null : c.id)}>
                  <td className="mono" style={{ fontSize: 11, color: 'var(--mut)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.page_url ? pathnameOf(c.page_url) : '—'}
                  </td>
                  <td><Chip tone={mode === 'IA' ? 'acc' : mode === 'TREE' ? 'mut' : 'warn'}>{mode}</Chip></td>
                  <td className="num" style={{ color: 'var(--mut)' }}>{c.messages.length}</td>
                  <td style={{ color: 'var(--faint)', fontSize: 11.5 }}>{timeAgo(c.started_at)}</td>
                </tr>
                {open && (
                  <tr>
                    <td colSpan={4} style={{ background: 'var(--surface3)' }}>
                      <div className="col" style={{ gap: 7, padding: '4px 2px' }}>
                        {c.messages.map((m, i) => (
                          <div key={`${m.at}-${i}`} className="row g8" style={{ alignItems: 'baseline', fontSize: 12.5 }}>
                            <Chip tone={m.source === 'ai' ? 'acc' : 'mut'}>
                              {m.role === 'user' ? <User size={11} /> : <BotIcon size={11} />} {m.source}
                            </Chip>
                            <span style={{ color: m.role === 'user' ? 'var(--ink)' : 'var(--mut)' }}>{m.content}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            )
          })}
          {convs.length === 0 && (
            <tr><td colSpan={4} style={{ color: 'var(--faint)', textAlign: 'center', padding: 20 }}>Aucune conversation.</td></tr>
          )}
        </tbody>
      </table>
      </div>
    </Card>
  )
}
