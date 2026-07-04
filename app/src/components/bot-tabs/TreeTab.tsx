// Onglet « Arbre » de BotPage. Bloc Test A/B
// (activation/désactivation de la variante B + slider de répartition), barre
// d'outils config-as-code (export/import) + génération IA, puis le TreeFlow
// (UN SEUL monté à la fois, vue A OU B). Présentationnel : tout l'état et les
// handlers viennent de BotPage / useBotEditor.
import { RefObject, useMemo, useState } from 'react'
import { Download, Sparkles, Upload } from 'lucide-react'
import { Btn, Card, Chip, Field, Seg } from '../../ui'
import TreeFlow from '../TreeFlow'
import ModuleLockBanner from '../billing/ModuleLockBanner'
import { MODULE_BADGE, nodesDependingOnModule, treeUsesAi } from '../tree-editor/treeGraph'
import type { Bot, BotUpdate, Tree } from '../../types/bot'
import type { ModuleKey } from '../../types/billing'

export default function TreeTab({
  bot, patch, hasPerm, aiTabRelevant,
  treeView, setTreeView,
  genOpen, setGenOpen, genMode, setGenMode, genText, setGenText, genUrl, setGenUrl,
  genBusy, genError, generateTree,
  exportConfig, importConfig, treeFileRef,
  abLocked, onUpgrade, activeModules,
}: {
  bot: Bot
  patch: (fields: BotUpdate) => void
  hasPerm: (perm: string | null) => boolean
  aiTabRelevant: boolean
  treeView: 'a' | 'b'
  setTreeView: (v: 'a' | 'b') => void
  genOpen: boolean
  setGenOpen: (fn: (o: boolean) => boolean) => void
  genMode: 'text' | 'url'
  setGenMode: (v: 'text' | 'url') => void
  genText: string
  setGenText: (v: string) => void
  genUrl: string
  setGenUrl: (v: string) => void
  genBusy: boolean
  genError: string
  generateTree: () => void
  exportConfig: () => void
  importConfig: (file: File) => void
  treeFileRef: RefObject<HTMLInputElement>
  // Module 'ab' verrouillé : SEULE la carte « Test A/B de l'arbre » est
  // verrouillée ; l'éditeur d'arbre (TreeFlow) reste gratuit (socle).
  abLocked: boolean
  onUpgrade: () => void
  // Modules entitlés du bot (depuis l'entitlement) : un nœud dont le module n'y
  // figure pas affiche un cadenas dans l'éditeur (étape qui ne marchera pas en
  // prod sans ce module). Non fourni = aucun cadenas (rétro-compat).
  activeModules?: Set<ModuleKey>
}) {
  // Légende de modules survolable : repère, dans l'arbre affiché, les étapes qui
  // dépendent d'un module (handoff→Inbox, branche IA). Le survol surligne ces
  // nœuds dans l'éditeur (highlightModule). Dérivé de l'arbre, pas de l'entitlement.
  const activeTree = treeView === 'b' && bot.tree_variant_json ? bot.tree_variant_json : bot.tree_json
  const usedModules = useMemo<ModuleKey[]>(() => {
    const out: ModuleKey[] = []
    if (nodesDependingOnModule(activeTree, 'inbox').length) out.push('inbox')
    if (treeUsesAi(activeTree)) out.push('ai')
    return out
  }, [activeTree])
  const [highlightModule, setHighlightModule] = useState<ModuleKey | null>(null)

  return (
    <div className="col g14">
      {/* Test A/B (module 'ab') : SEULE cette carte est gardée ; l'éditeur d'arbre
          ci-dessous reste gratuit. Verrouillé -> message « Ajouter à l'abonnement »
          (pas de CTA d'activation). Le « Comportement » (mode) vit dans l'onglet IA. */}
      <Card>
        <div className="row" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>Test A/B de l'arbre</div>
          {!abLocked && bot.tree_variant_json != null && <Chip tone="acc">A/B actif</Chip>}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--mut)', lineHeight: 1.55, marginBottom: 10 }}>
          Servez une variante B à une partie des nouvelles conversations et comparez conversations
          et satisfaction dans vos statistiques. L'affectation est tirée au sort à l'ouverture et
          reste stable pour toute la conversation.
        </div>
        {abLocked ? (
          <ModuleLockBanner locked label="A/B testing" onUpgrade={onUpgrade} />
        ) : bot.tree_variant_json == null ? (
          <Btn kind="soft" onClick={() => {
            patch({ tree_variant_json: JSON.parse(JSON.stringify(bot.tree_json)) as Tree, ab_split_pct: bot.ab_split_pct || 50 })
            setTreeView('b')
          }}>Activer une variante B</Btn>
        ) : (
          <div className="col" style={{ gap: 12 }}>
            <Seg value={treeView} onChange={v => setTreeView(v as 'a' | 'b')}
                 options={[{ value: 'a', label: 'Variante A (originale)' }, { value: 'b', label: 'Variante B' }]} />
            <Field label={`Répartition — ${bot.ab_split_pct ?? 0} % des nouvelles conversations voient la variante B`}
                   hint="0 % = variante en pause (aucun nouveau visiteur ne la voit). Les conversations déjà affectées gardent leur arbre.">
              <input type="range" min={0} max={100} value={bot.ab_split_pct ?? 0}
                     onChange={e => patch({ ab_split_pct: Number(e.target.value) })} />
            </Field>
            <div>
              <Btn kind="danger" small onClick={() => {
                if (!window.confirm('Désactiver la variante B ? Son contenu sera perdu à l\'enregistrement.')) return
                patch({ tree_variant_json: null, ab_split_pct: 0 })
                setTreeView('a')
              }}>Désactiver la variante B</Btn>
            </div>
          </div>
        )}
      </Card>

      {/* Barre d'outils config-as-code + génération IA (arbre A uniquement).
          La variante B n'a ni export/import (config.json l'exclut) ni
          génération IA (elle remplacerait la variante : coût + confusion). */}
      {treeView === 'a' && (
        <div className="col g14">
          <div className="row g8" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Btn kind="ghost" small onClick={() => setGenOpen(o => !o)}>
              <Sparkles size={13} /> Générer avec l'IA
            </Btn>
            <Btn kind="ghost" small onClick={exportConfig}>
              <Download size={13} /> Exporter JSON
            </Btn>
            {hasPerm('context') && hasPerm('appearance') && (
              <>
                <Btn kind="ghost" small onClick={() => treeFileRef.current?.click()}>
                  <Upload size={13} /> Importer
                </Btn>
                <input ref={treeFileRef} type="file" accept=".json" hidden
                       onChange={e => { if (e.target.files?.[0]) importConfig(e.target.files[0]); e.target.value = '' }} />
              </>
            )}
          </div>

          {genOpen && (
            <Card>
              <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <Sparkles size={14} style={{ color: 'var(--acc)' }} /> Générer l'arbre avec l'IA
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--mut)', marginBottom: 10, lineHeight: 1.5 }}>
                Collez votre FAQ / documentation, ou indiquez l'URL d'une page d'aide : l'IA construit un
                arbre de décision complet que vous pourrez retoucher avant d'enregistrer.
              </div>
              <div className="col g10">
                <Seg small value={genMode} onChange={v => setGenMode(v as 'text' | 'url')}
                     options={[{ value: 'text', label: 'Texte collé' }, { value: 'url', label: "URL d'une page" }]} />
                {genMode === 'text' ? (
                  <textarea rows={5} value={genText} onChange={e => setGenText(e.target.value)}
                            placeholder={'Q : Quels sont vos horaires ?\nR : Du lundi au vendredi, 9h-18h…\n\nQ : Comment prendre rendez-vous ?\nR : …'} />
                ) : (
                  <input type="text" className="mono" value={genUrl} onChange={e => setGenUrl(e.target.value)}
                         placeholder="https://votre-site.fr/faq" />
                )}
                {genError && <div className="error">{genError}</div>}
                <div>
                  <Btn kind="soft" onClick={generateTree}
                       disabled={genBusy || (genMode === 'text' ? genText.trim().length < 50 : !genUrl.trim())}>
                    {genBusy ? 'Génération en cours…' : "Générer l'arbre"}
                  </Btn>
                </div>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Légende des modules utilisés par l'arbre : survol -> surbrillance des
          étapes qui en dépendent (handoff→Inbox, branche IA) dans l'éditeur. */}
      {usedModules.length > 0 && (
        <div className="row g8" style={{ flexWrap: 'wrap', alignItems: 'center', fontSize: 11.5, color: 'var(--mut)' }}>
          <span>Survolez un module pour repérer les étapes qui en dépendent :</span>
          {usedModules.map(m => {
            const b = MODULE_BADGE[m]
            if (!b) return null
            return (
              <span key={m}
                    onMouseEnter={() => setHighlightModule(m)}
                    onMouseLeave={() => setHighlightModule(null)}
                    style={{ cursor: 'default', display: 'inline-flex', alignItems: 'center', gap: 4,
                             padding: '2px 9px', borderRadius: 999, fontWeight: 700,
                             border: `1px solid ${b.color}`, color: b.color }}>
                {b.label}
              </span>
            )
          })}
        </div>
      )}

      {/* UN SEUL TreeFlow monté à la fois (la variante absente ne reste
          jamais affichée — garde useEffect treeView). key force le remount
          au switch A/B. */}
      {treeView === 'b' && bot.tree_variant_json ? (
        <TreeFlow key="b" tree={bot.tree_variant_json}
                  onChange={t => patch({ tree_variant_json: t })}
                  allowAI={aiTabRelevant}
                  activeModules={activeModules} highlightModule={highlightModule} />
      ) : (
        <TreeFlow key="a" tree={bot.tree_json}
                  onChange={t => patch({ tree_json: t })}
                  allowAI={aiTabRelevant}
                  activeModules={activeModules} highlightModule={highlightModule} />
      )}
    </div>
  )
}
