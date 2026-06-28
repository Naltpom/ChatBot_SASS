// BotConfigurator — configurateur modulaire « type VPS » (spec §5.3). Deux modes :
//
//   - Présélections : 3 presets guidés (Vitrine / Service client recommandé /
//     Volume). Un clic applique la compo (modules + palier IA). Total transparent.
//   - Avancé        : Toggle par module + variante IA (Désactivée | Managé | BYOK)
//     + sélection du palier de quota. Auto-active les `requires`. JAMAIS de toggle
//     sur une capacité gratuite (price_cents == 0 ET pas de variante BYOK payante).
//
// La config est CONTRÔLÉE par le parent (BotConfig, remontée via onChange). Seul le
// MODE d'affichage (presets/avancé) est un état local. Le configurateur ne calcule
// aucun prix : c'est PriceCart + computeCart (utils/billing, source backend) qui
// affichent le panier. Réutilise les primitives ui.tsx (Seg/Toggle/Card/Chip/
// InfoBox) — aucune nouvelle primitive ni prix codé en dur dans la LOGIQUE.
import { useMemo, useState } from 'react'
import { Card, Chip, InfoBox, Seg, Toggle } from '../../ui'
import { formatCents } from './PriceCart'
import type {
  AiTier,
  BillingCatalog,
  BotConfig,
  CatalogModule,
  CatalogPreset,
  ModuleKey,
} from '../../types/billing'

// Un module est « gratuit » (non facturable) si son forfait vaut 0 ET qu'il n'a
// pas de variante payante (BYOK). On ne propose JAMAIS de toggle dessus (spec §5.3).
function isFreeModule(m: CatalogModule): boolean {
  return m.price_cents === 0 && !m.byok_price_cents
}

// Ferme transitivement les dépendances `requires` d'un ensemble de modules
// (ex. activer 'inbox' qui requiert 'ai' active aussi 'ai').
function withRequires(catalog: BillingCatalog, modules: Set<ModuleKey>): Set<ModuleKey> {
  const byKey = new Map(catalog.modules.map(m => [m.key, m]))
  const out = new Set(modules)
  let changed = true
  while (changed) {
    changed = false
    for (const key of [...out]) {
      for (const r of byKey.get(key)?.requires ?? []) {
        if (!out.has(r)) { out.add(r); changed = true }
      }
    }
  }
  return out
}

// Modules actifs qui requièrent `target` (interdit le retrait d'une dépendance utilisée).
function dependentsOf(catalog: BillingCatalog, target: ModuleKey, active: Set<ModuleKey>): ModuleKey[] {
  return catalog.modules
    .filter(m => active.has(m.key) && (m.requires ?? []).includes(target))
    .map(m => m.key)
}

// Palier managé payant par défaut (1er > 0 €), sinon le 1er disponible.
function defaultManagedTier(catalog: BillingCatalog): string | null {
  return catalog.ai_tiers.find(t => t.price_cents > 0)?.id ?? catalog.ai_tiers[0]?.id ?? null
}

// Modules implicites d'un preset : ses add-ons + 'ai' si un palier IA est défini
// (le preset porte le plan IA dans ai_tier_id, jamais comme module 'ai' explicite),
// fermés transitivement par `requires`.
function presetModules(catalog: BillingCatalog, p: CatalogPreset): Set<ModuleKey> {
  const base = new Set<ModuleKey>(p.modules)
  if (p.ai_tier_id) base.add('ai')
  return withRequires(catalog, base)
}

// Une config qui ne correspond à aucun preset → ouvrir directement en mode Avancé.
function configMatchesPreset(catalog: BillingCatalog, config: BotConfig, p: CatalogPreset): boolean {
  if (config.ai_byok) return false
  if (config.ai_tier_id !== p.ai_tier_id) return false
  const want = presetModules(catalog, p)
  if (want.size !== config.modules.length) return false
  return config.modules.every(k => want.has(k))
}

export default function BotConfigurator({
  catalog,
  config,
  onChange,
  readOnly = false,
}: {
  catalog: BillingCatalog
  config: BotConfig
  onChange: (next: BotConfig) => void
  // Org non-owner : modules payants en lecture seule (le parent affiche l'InfoBox).
  readOnly?: boolean
}) {
  const active = useMemo(() => new Set(config.modules), [config.modules])
  const aiModule = catalog.modules.find(m => m.key === 'ai')
  const addons = catalog.modules.filter(m => m.key !== 'ai')
  const aiOn = active.has('ai')
  const aiVariant: 'off' | 'managed' | 'byok' = !aiOn ? 'off' : config.ai_byok ? 'byok' : 'managed'

  // Mode initial : Présélections si la config est VIDE (nouveau bot, on guide) ou
  // si elle correspond à un preset ; sinon Avancé (compo sur-mesure existante).
  const isEmpty = config.modules.length === 0 && !config.ai_tier_id && !config.ai_byok
  const initialMode: 'presets' | 'advanced' =
    isEmpty || catalog.presets.some(p => configMatchesPreset(catalog, config, p)) ? 'presets' : 'advanced'
  const [mode, setMode] = useState<'presets' | 'advanced'>(initialMode)

  function emit(next: BotConfig) {
    if (!readOnly) onChange(next)
  }

  // --- Presets ----------------------------------------------------------------
  function applyPreset(p: CatalogPreset) {
    // 'ai' inclus si le preset porte un palier IA (sinon l'IA apparaîtrait
    // « Désactivée » en mode Avancé alors qu'un palier est sélectionné).
    emit({ modules: [...presetModules(catalog, p)], ai_tier_id: p.ai_tier_id, ai_byok: false })
  }

  // --- Avancé : module IA (variante + palier) ---------------------------------
  function setAiVariant(variant: string) {
    if (variant === 'off') {
      // Retirer 'ai' ET tous les add-ons qui en dépendent (cascade).
      const next = new Set(active)
      next.delete('ai')
      for (const dep of catalog.modules) {
        if ((dep.requires ?? []).includes('ai')) next.delete(dep.key)
      }
      emit({ modules: [...next], ai_tier_id: null, ai_byok: false })
      return
    }
    const next = withRequires(catalog, new Set(active).add('ai'))
    if (variant === 'byok') {
      emit({ modules: [...next], ai_tier_id: null, ai_byok: true })
    } else {
      emit({ modules: [...next], ai_tier_id: config.ai_tier_id ?? defaultManagedTier(catalog), ai_byok: false })
    }
  }

  function setTier(id: string) {
    emit({ modules: [...active], ai_tier_id: id, ai_byok: false })
  }

  // --- Avancé : add-ons -------------------------------------------------------
  function toggleAddon(m: CatalogModule, on: boolean) {
    if (isFreeModule(m)) return // jamais de toggle sur une capacité gratuite
    if (on) {
      const next = withRequires(catalog, new Set(active).add(m.key))
      // Si l'activation tire l'IA (via requires) et qu'elle était éteinte, choisir
      // le palier managé par défaut (sauf BYOK déjà choisi).
      const aiPulled = next.has('ai') && !aiOn && !config.ai_byok
      emit({
        modules: [...next],
        ai_tier_id: aiPulled ? (config.ai_tier_id ?? defaultManagedTier(catalog)) : config.ai_tier_id,
        ai_byok: config.ai_byok,
      })
    } else {
      if (dependentsOf(catalog, m.key, active).length) return // dépendance encore requise
      const next = new Set(active)
      next.delete(m.key)
      emit({ modules: [...next], ai_tier_id: config.ai_tier_id, ai_byok: config.ai_byok })
    }
  }

  return (
    <div className="bot-configurator">
      <div style={{ margin: '0 0 12px' }}>
        <Seg
          options={[{ value: 'presets', label: 'Présélections' }, { value: 'advanced', label: 'Avancé' }]}
          value={mode}
          onChange={v => setMode(v as 'presets' | 'advanced')}
        />
      </div>

      {mode === 'presets' ? (
        <div className="cfg-presets" style={{ display: 'grid', gap: 10 }}>
          {catalog.presets.map(p => {
            const selected = configMatchesPreset(catalog, config, p)
            // Remise intro 1er mois (% selon le palier IA du preset ; 'default' sinon).
            const introPct = catalog.intro_discounts?.[p.ai_tier_id ?? 'default'] ?? catalog.intro_discounts?.default ?? 0
            const introFirst = Math.round(p.est_price_cents * (100 - introPct) / 100)
            return (
              <Card key={p.key} className={selected ? 'selected' : ''}
                    onClick={readOnly ? undefined : () => applyPreset(p)}
                    style={{ cursor: readOnly ? 'default' : 'pointer',
                             borderColor: selected ? 'var(--acc)' : undefined,
                             background: selected ? 'var(--acc-soft)' : undefined }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                  <div style={{ fontWeight: 700 }}>
                    {p.label} {p.recommended && <Chip tone="acc">Recommandé</Chip>}
                  </div>
                  <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {introPct > 0 ? (
                      <>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, justifyContent: 'flex-end' }}>
                          <span style={{ textDecoration: 'line-through', color: 'var(--mut)', fontSize: 13 }}>
                            {formatCents(p.est_price_cents, catalog.currency)}
                          </span>
                          <span style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: 'var(--acc)' }}>
                            {formatCents(introFirst, catalog.currency)}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--acc)', fontWeight: 700 }}>
                          −{introPct}% le 1er mois<span style={{ color: 'var(--mut)', fontWeight: 400 }}>, puis {formatCents(p.est_price_cents, catalog.currency)}/mois</span>
                        </div>
                      </>
                    ) : (
                      <div style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                        {formatCents(p.est_price_cents, catalog.currency)}
                        <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--mut)' }}> /mois</span>
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--mut)', marginTop: 2 }}>{p.tagline}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {p.ai_tier_id && <Chip tone="acc">{tierChipLabel(catalog, p.ai_tier_id)}</Chip>}
                  {p.modules.map(k => {
                    const m = catalog.modules.find(x => x.key === k)
                    return m ? <Chip key={k} tone="mut">{m.short}</Chip> : null
                  })}
                </div>
              </Card>
            )
          })}
        </div>
      ) : (
        <div className="cfg-advanced" style={{ display: 'grid', gap: 14 }}>
          {/* Module IA : variante + palier */}
          <Card>
            <div style={{ fontWeight: 700 }}>{aiModule?.label ?? 'Intelligence artificielle'}</div>
            <div style={{ fontSize: 12.5, color: 'var(--mut)', marginTop: 2 }}>{aiModule?.desc}</div>
            <div style={{ marginTop: 10 }}>
              <Seg
                small
                options={[
                  { value: 'off', label: 'Désactivée' },
                  { value: 'managed', label: 'Managé' },
                  { value: 'byok', label: 'BYOK' },
                ]}
                value={aiVariant}
                onChange={v => !readOnly && setAiVariant(v)}
              />
            </div>

            {aiVariant === 'managed' && (
              <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--mut)' }}>Palier de quota mensuel</div>
                {catalog.ai_tiers.map(t => (
                  <TierRow key={t.id} tier={t} currency={catalog.currency}
                           selected={config.ai_tier_id === t.id}
                           onSelect={() => setTier(t.id)} readOnly={readOnly} />
                ))}
                {/* Intro : 1er mois remisé selon le palier (coupon Stripe duration:once),
                    puis plein tarif. Pas de plafond IA — le client paie dès le 1er mois. */}
                <div style={{ fontSize: 11.5, color: 'var(--mut)', marginTop: 2, lineHeight: 1.5 }}>
                  1er mois à tarif réduit (remise selon le palier), puis plein tarif. Sans engagement,
                  annulable à tout moment.
                </div>
              </div>
            )}

            {aiVariant === 'byok' && (
              <div style={{ marginTop: 12 }}>
                <InfoBox tone="info" title="BYOK — votre propre clé IA">
                  Vous fournissez votre clé du fournisseur : réponses <strong>illimitées</strong>, non
                  métrées. Forfait plateforme{' '}
                  {aiModule?.byok_price_cents != null ? formatCents(aiModule.byok_price_cents, catalog.currency) : ''} /mois.
                </InfoBox>
              </div>
            )}
          </Card>

          {/* Add-ons (toggle on/off), capacités gratuites exclues */}
          <Card>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Modules</div>
            <div style={{ display: 'grid' }}>
              {addons.map(m => {
                if (isFreeModule(m)) return null // jamais de toggle sur une capacité gratuite
                // Add-on dépendant de l'IA (rag, mcp) masqué tant que l'IA est OFF :
                // on ne propose pas d'activer un module qui n'aurait aucun effet sans IA.
                if ((m.requires ?? []).includes('ai') && !aiOn) return null
                const on = active.has(m.key)
                const blockedRemoval = on && dependentsOf(catalog, m.key, active).length > 0
                return (
                  <div key={m.key} className="cfg-addon-row"
                       style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                gap: 12, padding: '10px 0', borderBottom: '1px solid var(--bd)' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                        {m.label}{' '}
                        <span style={{ fontWeight: 400, color: 'var(--mut)', fontSize: 12 }}>
                          {formatCents(m.price_cents, catalog.currency)} /mois
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--mut)' }}>{m.desc}</div>
                      {(m.requires ?? []).length > 0 && (
                        <div style={{ fontSize: 11.5, color: 'var(--mut)', marginTop: 2 }}>
                          Nécessite&nbsp;: {(m.requires ?? []).map(r => requiresLabel(catalog, r)).join(', ')}
                        </div>
                      )}
                    </div>
                    <Toggle label={`Module ${m.label}`} on={on} disabled={readOnly || blockedRemoval}
                            onChange={v => toggleAddon(m, v)} />
                  </div>
                )
              })}
            </div>
          </Card>

          {readOnly && (
            <InfoBox tone="warn">
              Seul le propriétaire de l'organisation gère la facturation. Les modules payants sont en lecture seule.
            </InfoBox>
          )}
        </div>
      )}
    </div>
  )
}

// Une ligne de palier IA managé (sélection radio-like via Card cliquable).
function TierRow({ tier, currency, selected, onSelect, readOnly }: {
  tier: AiTier; currency: string; selected: boolean; onSelect: () => void; readOnly: boolean
}) {
  return (
    <Card onClick={readOnly ? undefined : onSelect}
          style={{ cursor: readOnly ? 'default' : 'pointer', padding: '10px 12px',
                   borderColor: selected ? 'var(--acc)' : undefined,
                   background: selected ? 'var(--acc-soft)' : undefined,
                   display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: selected ? 700 : 500, fontSize: 13.5 }}>
          {tier.included_replies.toLocaleString('fr-FR')} réponses IA / mois
        </div>
        {/* Description RÉELLE du palier (catalogue) — pas une répétition du quota. */}
        {tier.desc && <div style={{ fontSize: 12, color: 'var(--mut)', marginTop: 2 }}>{tier.desc}</div>}
      </div>
      <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {tier.price_cents === 0 ? 'gratuit' : `${formatCents(tier.price_cents, currency)} /mois`}
      </span>
    </Card>
  )
}

function tierChipLabel(catalog: BillingCatalog, id: string): string {
  const t = catalog.ai_tiers.find(x => x.id === id)
  return t ? `IA ${t.included_replies.toLocaleString('fr-FR')} rép.` : id
}

function requiresLabel(catalog: BillingCatalog, key: ModuleKey): string {
  return catalog.modules.find(m => m.key === key)?.short ?? key
}
