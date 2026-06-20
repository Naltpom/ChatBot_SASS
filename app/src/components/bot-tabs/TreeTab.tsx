// Onglet « Arbre » de BotPage — extrait de l'inline historique. Bloc Test A/B
// (activation/désactivation de la variante B + slider de répartition), barre
// d'outils config-as-code (export/import) + génération IA, puis le TreeFlow
// (UN SEUL monté à la fois, vue A OU B). Présentationnel : tout l'état et les
// handlers viennent de BotPage / useBotEditor.
import { RefObject } from 'react'
import { Download, Sparkles, Upload } from 'lucide-react'
import { Btn, Card, Chip, Field, Seg } from '../../ui'
import TreeFlow from '../TreeFlow'
import type { Bot, BotUpdate, Tree } from '../../types/bot'

export default function TreeTab({
  bot, patch, hasPerm, aiTabRelevant,
  treeView, setTreeView,
  genOpen, setGenOpen, genMode, setGenMode, genText, setGenText, genUrl, setGenUrl,
  genBusy, genError, generateTree,
  exportConfig, importConfig, treeFileRef,
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
}) {
  return (
    <div className="col g14">
      {bot.tree_variant_json == null ? (
        <Card>
          <div className="card-title">Test A/B de l'arbre</div>
          <div style={{ fontSize: 11.5, color: 'var(--mut)', lineHeight: 1.55, marginBottom: 10 }}>
            Servez une variante B à une partie des nouvelles conversations et comparez conversations
            et satisfaction dans vos statistiques. L'affectation est tirée au sort à l'ouverture et
            reste stable pour toute la conversation.
          </div>
          <Btn kind="soft" onClick={() => {
            patch({ tree_variant_json: JSON.parse(JSON.stringify(bot.tree_json)) as Tree, ab_split_pct: bot.ab_split_pct || 50 })
            setTreeView('b')
          }}>Activer une variante B</Btn>
        </Card>
      ) : (
        <Card>
          <div className="row" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>Test A/B de l'arbre</div>
            <Chip tone="acc">A/B actif</Chip>
          </div>
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
        </Card>
      )}

      {/* Barre d'outils config-as-code + génération IA (arbre A uniquement).
          TreeFlow ne porte plus l'export/import ni la génération : on les
          garde ici en boutons discrets. La variante B n'a ni export/import
          (config.json l'exclut) ni génération IA (elle remplacerait la
          variante : coût + confusion). */}
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

      {/* UN SEUL TreeFlow monté à la fois (la variante absente ne reste
          jamais affichée — garde useEffect treeView). key force le remount
          au switch A/B. */}
      {treeView === 'b' && bot.tree_variant_json ? (
        <TreeFlow key="b" tree={bot.tree_variant_json}
                  onChange={t => patch({ tree_variant_json: t })}
                  allowAI={aiTabRelevant} />
      ) : (
        <TreeFlow key="a" tree={bot.tree_json}
                  onChange={t => patch({ tree_json: t })}
                  allowAI={aiTabRelevant} />
      )}
      {/* Le test en direct n'est plus une carte ici : le widget flottant vit
          directement sur la page du bot (BotPage), comme s'il était déployé. */}
    </div>
  )
}
