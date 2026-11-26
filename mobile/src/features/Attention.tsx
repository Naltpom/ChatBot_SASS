// En haut du Planning : ce qui demande une action maintenant (échecs, brouillons TikTok à valider),
// en une ligne cliquable. Rien à signaler : rien n'est affiché.
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, View } from 'react-native'
import { getPosts } from '../lib/api'
import { useSession } from '../lib/session'
import { Icon, Txt } from '../ui/kit'
import { radius, space, useTheme } from '../ui/theme'
import { t } from '../lib/i18n'

export function useAttention() {
  const { scope } = useSession()
  const [n, setN] = useState<{ failed: number; drafts: number } | null>(null)
  useFocusEffect(useCallback(() => {
    getPosts(scope, new Date(Date.now() - 7 * 864e5), new Date(Date.now() + 864e5), { limit: 200 }).then(posts => {
      let failed = 0, drafts = 0
      for (const p of posts) for (const t of p.targets) { if (t.status === 'FAILED') failed++; else if (t.status === 'INBOX') drafts++ }
      setN({ failed, drafts })
    }).catch(() => setN(null))
  }, [scope]))
  return n
}

export function AttentionBar() {
  const router = useRouter()
  const { c } = useTheme()
  const n = useAttention()
  if (!n || (!n.failed && !n.drafts)) return null
  const parts = [
    n.failed && (n.failed > 1 ? t('{n} publications en échec', { n: n.failed }) : t('{n} publication en échec', { n: n.failed })),
    n.drafts && (n.drafts > 1 ? t('{n} brouillons TikTok à valider', { n: n.drafts }) : t('{n} brouillon TikTok à valider', { n: n.drafts })),
  ].filter(Boolean)
  const tone = n.failed ? c.danger : c.warn
  return (
    <Pressable onPress={() => router.push('/activity')} accessibilityRole="button" accessibilityLabel={`${parts.join(', ')}. ${t('Voir')}`}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md,
        backgroundColor: n.failed ? c.dangerBg : c.warnBg, opacity: pressed ? 0.7 : 1 })}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tone }} />
      <Txt bold style={{ flex: 1 }} color={tone}>{parts.join(' · ')}</Txt>
      <Txt small bold color={tone}>{n.failed ? t('Réessayer') : t('Voir')}</Txt>

      <Icon name="right" size={16} color={tone} />
    </Pressable>
  )
}
