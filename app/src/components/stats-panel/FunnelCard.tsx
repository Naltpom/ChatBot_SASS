// Card « Parcours dans l'arbre (funnel) » — pur présentationnel, extrait de
// StatsPanel (refacto R13). Mappe node_key → libellé via le tree_json local
// (logique nodeLabel historique) ; gère son erreur LOCALE de chargement.
import { Card, Chip, Meter } from '../../ui'
import type { Tree, TreeNode } from '../../types/bot'
import type { Funnel } from './types'

// Label d'un nœud du funnel : racine → libellé fixe ; sinon l'option qui
// pointe vers lui, d'abord dans l'arbre A puis dans la variante B (suffixée) ;
// à défaut la clé brute (nœud supprimé).
function funnelLabel(key: string, tree: Tree | null, variantTree: Tree | null): { text: string; raw?: boolean } {
  if (key === tree?.start) return { text: "Message d'accueil (racine)" }
  const findOpt = (nodes: Record<string, TreeNode> | undefined) => {
    for (const n of Object.values(nodes || {})) {
      const opt = (n.options || []).find(o => o.next === key)
      if (opt) return opt
    }
    return null
  }
  const optA = findOpt(tree?.nodes)
  if (optA) return { text: optA.label }
  const optB = findOpt(variantTree?.nodes)
  if (optB) return { text: `${optB.label} (variante B)` }
  return { text: key, raw: true }
}

export default function FunnelCard({ funnel, funnelError, tree, variantTree }: {
  funnel: Funnel | null
  funnelError: string
  tree: Tree | null
  variantTree: Tree | null
}) {
  const maxCount = funnel?.nodes[0]?.count || 1   // nodes triés count desc côté serveur
  const funnelHasB = (funnel?.variant_totals.b ?? 0) > 0

  return (
    <Card>
      <div className="row" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>Parcours dans l'arbre (funnel)</div>
        {funnelHasB && funnel && (
          <div className="row g6">
            <Chip tone="acc">A {funnel.variant_totals.a}</Chip>
            <Chip tone="mut">B {funnel.variant_totals.b}</Chip>
          </div>
        )}
      </div>
      {funnelError ? (
        <div className="error">{funnelError}</div>
      ) : !funnel ? (
        <div style={{ color: 'var(--faint)', fontSize: 12 }}>Chargement…</div>
      ) : funnel.total_events === 0 ? (
        <div style={{ color: 'var(--faint)', fontSize: 12, lineHeight: 1.55 }}>
          Aucun événement d'arbre sur la période — le funnel se remplit à mesure que les visiteurs
          naviguent dans le menu guidé.
        </div>
      ) : (
        <div className="col" style={{ gap: 9 }}>
          {funnel.nodes.slice(0, 12).map(n => {
            const lbl = funnelLabel(n.node_key, tree, variantTree)
            const exitPct = Math.round(n.exit_rate * 100)
            const hot = n.exit_rate > 0.5 && n.count >= 5
            return (
              <div key={n.node_key} className="col" style={{ gap: 3 }}>
                <div className="row g10">
                  <span title={lbl.text} className={lbl.raw ? 'mono' : undefined}
                        style={{
                          flex: 1, minWidth: 0, fontSize: lbl.raw ? 11.5 : 12.5, fontWeight: 600,
                          color: lbl.raw ? 'var(--faint)' : undefined,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                    {lbl.text}
                  </span>
                  <span className="num mono" style={{ fontSize: 12, fontWeight: 700 }}>{n.count}</span>
                  <div style={{ width: 150, flexShrink: 0 }}>
                    <Meter pct={Math.round((n.count / maxCount) * 100)} height={6} />
                  </div>
                  <span style={{ fontSize: 10.5, width: 112, textAlign: 'right', flexShrink: 0, color: hot ? 'var(--warn)' : 'var(--faint)' }}>
                    {n.exits} sorties · {exitPct} %
                  </span>
                </div>
                {funnelHasB && (
                  <div style={{ fontSize: 10.5, color: 'var(--faint)' }}>
                    A {n.variants.a.count} ({n.variants.a.exits} sorties) · B {n.variants.b.count} ({n.variants.b.exits} sorties)
                  </div>
                )}
              </div>
            )
          })}
          {funnel.nodes.length > 12 && (
            <div style={{ fontSize: 11, color: 'var(--faint)' }}>
              +{funnel.nodes.length - 12} autres nœuds
            </div>
          )}
        </div>
      )}
      <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 12, lineHeight: 1.5 }}>
        Une "sortie" = dernier nœud vu dans la conversation. Mesuré côté serveur ; les valeurs sont
        affichées telles quelles.
      </div>
    </Card>
  )
}
