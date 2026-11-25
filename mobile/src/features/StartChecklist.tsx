// « Bien démarrer » en haut du planning, après l'inscription : de vraies actions, une progression qui ne
// part jamais de zéro (compte créé), et la carte disparaît quand tout est fait (ou si on la masque).
// Remplace les fenêtres de sécurité à l'arrivée : notifications et empreinte se proposent ici.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { getPosts } from '../lib/api'
import { call } from '../lib/http'
import { useLock } from '../lib/lock'
import { enablePush, getPush, pushUnsupported } from '../lib/push'
import { useSession } from '../lib/session'
import { useOwnAccounts, useSetupOrg, useSharedAccounts } from './steps'
import { Card, Icon, Txt } from '../ui/kit'
import { radius, space, useTheme } from '../ui/theme'

type Item = { key: string; title: string; done: boolean; run?: () => void }

export function StartChecklist() {
  const router = useRouter()
  const { c } = useTheme()
  const { me, spaces, groups } = useSession()
  const lock = useLock()
  const own = useOwnAccounts()
  const shared = useSharedAccounts()
  const org = useSetupOrg()
  const [hidden, setHidden] = useState<boolean | null>(null)
  const [push, setPush] = useState<boolean | null>(null)
  const [hasPost, setHasPost] = useState<boolean | null>(null)
  const [mailSent, setMailSent] = useState(false)
  const key = `cm.checklist.hidden.${me?.id}`
  useEffect(() => { AsyncStorage.getItem(key).then(v => setHidden(v === '1')).catch(() => setHidden(false)) }, [key])
  useFocusEffect(useCallback(() => {
    getPush().then(p => setPush(p.enabled)).catch(() => setPush(null))
    if (own.length) getPosts(org, new Date(Date.now() - 90 * 864e5), new Date(Date.now() + 365 * 864e5), { limit: 1 })
      .then(p => setHasPost(p.length > 0)).catch(() => setHasPost(null))
  }, [own.length, org]))

  const storage = spaces.find(s => (s.org_id ?? null) === org)?.storage
  const items: Item[] = [
    { key: 'account', title: 'Compte Chapote créé', done: true },
    { key: 'connect', title: 'Connecter un compte TikTok, YouTube ou Instagram', done: own.length > 0 || shared.length > 0, run: () => router.push('/accounts') },
    ...(own.length ? [
      { key: 'drive', title: 'Relier Google Drive', done: !!storage && storage.state !== 'missing', run: () => router.push('/storage') },
      { key: 'video', title: 'Planifier une première vidéo', done: !!hasPost, run: () => router.push('/new') },
    ] : []),
    // Vérification de l'e-mail demandée après la 1re victoire, pas à l'inscription.
    ...(hasPost && me && me.email_verified === false ? [{ key: 'email', title: mailSent ? `E-mail envoyé à ${me.email} : ouvrez le lien` : 'Confirmer mon adresse e-mail', done: false,
      run: () => { call('/api/auth/verify-email/request', { method: 'POST', body: '{}' }).then(() => setMailSent(true)).catch(() => setMailSent(true)) } }] : []),
    ...(pushUnsupported() ? [] : [{ key: 'push', title: 'Être prévenu quand une vidéo part', done: !!push, run: () => { enablePush().then(r => { if (typeof r !== 'string') setPush(r.enabled) }) } }]),
    ...(lock.supported ? [{ key: 'lock', title: `Protéger l’app par ${lock.label.toLowerCase()}`, done: lock.enabled, run: () => { lock.setEnabled(true) } }] : []),
    ...(own.length >= 2 ? [{ key: 'groups', title: 'Ranger vos comptes en groupes', done: groups.length > 0, run: () => router.push('/setup/groups') }] : []),
    { key: 'invite', title: 'Inviter quelqu’un de l’équipe (facultatif)', done: false, run: () => router.push('/people') },
  ]
  const total = items.length - 1  // l'invitation reste facultative
  const count = items.filter(i => i.done && i.key !== 'invite').length
  if (hidden !== false || push === null || count >= total) return null
  const hide = () => { setHidden(true); AsyncStorage.setItem(key, '1').catch(() => {}) }

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Txt bold size={17}>Bien démarrer</Txt>
        <Pressable onPress={hide} accessibilityRole="button" accessibilityLabel="Masquer Bien démarrer" hitSlop={8}>
          <Txt small color={c.muted}>Masquer</Txt>
        </Pressable>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: c.border, overflow: 'hidden' }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: count }}>
        <View style={{ width: `${Math.round((count / total) * 100)}%`, height: 6, backgroundColor: c.ok }} />
      </View>
      <Txt small muted>{count} sur {total} · plus que {total - count} pour tout avoir en place</Txt>
      <Txt small color={c.ok}>✓ {items.filter(i => i.done).map(i => i.title.replace(/ \(facultatif\)/, '')).join(' · ')}</Txt>
      <View style={{ gap: 2 }}>
        {items.filter(i => !i.done).map(i => (
          <Pressable key={i.key} onPress={i.done ? undefined : i.run} disabled={i.done || !i.run} accessibilityRole="button"
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44, borderRadius: radius.sm, opacity: pressed ? 0.6 : 1 })}>
            <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
              backgroundColor: i.done ? c.ok : 'transparent', borderWidth: i.done ? 0 : 1.5, borderColor: c.borderStrong }}>
              {i.done ? <Icon name="check" size={14} color="#fff" strokeWidth={3} /> : null}
            </View>
            <Txt style={{ flex: 1, textDecorationLine: i.done ? 'line-through' : 'none' }} color={i.done ? c.muted : c.text}>{i.title}</Txt>
            {i.done ? null : <Icon name="right" size={16} color={c.muted} />}
          </Pressable>
        ))}
      </View>
    </Card>
  )
}
