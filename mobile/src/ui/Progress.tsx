// Barre de progression des étapes d'inscription : jamais à zéro (le compte créé compte déjà).
import { View } from 'react-native'
import { Txt } from './kit'
import { space, useTheme } from './theme'

export function StepProgress({ step, total, label }: { step: number; total: number; label?: string }) {
  const { c } = useTheme()
  return (
    <View style={{ gap: 6 }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: step }}>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {Array.from({ length: total }, (_, i) => (
          <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i < step ? c.primary : c.border }} />
        ))}
      </View>
      <Txt small muted>Étape {step} sur {total}{label ? ` · ${label}` : ''}</Txt>
    </View>
  )
}

/** Petite ligne « il manque … » sous un bouton désactivé : on ne grise jamais sans dire pourquoi. */
export function Missing({ items }: { items: string[] }) {
  const { c } = useTheme()
  if (!items.length) return null
  return <Txt small center color={c.muted} style={{ marginTop: -space.xs }}>Il manque : {items.join(', ')}.</Txt>
}
