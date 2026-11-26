// Barre de progression des étapes d'inscription : jamais à zéro (le compte créé compte déjà).
import { View } from 'react-native'
import { Txt } from './kit'
import { space, useTheme } from './theme'
import { t } from '../lib/i18n'

export function StepProgress({ step, total, label }: { step: number; total: number; label?: string }) {
  const { c } = useTheme()
  return (
    <View style={{ gap: 6 }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: step }}>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {Array.from({ length: total }, (_, i) => (
          <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i < step ? c.primary : c.border }} />
        ))}
      </View>
      <Txt small muted>{t('Étape {step} sur {total}', { step, total })}{label ? ` · ${label}` : ''}</Txt>
    </View>
  )
}

/** Petite ligne « il manque … » sous un bouton désactivé : on ne grise jamais sans dire pourquoi. */
export function Missing({ items }: { items: string[] }) {
  const { c } = useTheme()
  if (!items.length) return null
  return <Txt small center color={c.muted} style={{ marginTop: -space.xs }}>{t('Il manque : {items}.', { items: items.join(', ') })}</Txt>
}
