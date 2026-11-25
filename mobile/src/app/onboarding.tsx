// Inscription, étape 1 (obligatoire) : prénom, nom, date de naissance et conditions acceptées.
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker'
import { Stack, useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useEffect, useState } from 'react'
import { Platform as RNPlatform, Pressable, View } from 'react-native'
import { putIdentity } from '../lib/api'
import { useIdentity } from '../lib/identity'
import { stepTitle } from '../lib/onboarding'
import { useOwnAccounts } from '../features/steps'
import { Button, Card, Field, H1, Icon, Msg, Row, Screen, Txt } from '../ui/kit'
import { radius, space, useTheme } from '../ui/theme'

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const fr = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

function Check({ checked, onToggle, children }: { checked: boolean; onToggle: () => void; children: React.ReactNode }) {
  const { c } = useTheme()
  return (
    <Pressable onPress={onToggle} accessibilityRole="checkbox" accessibilityState={{ checked }} hitSlop={6}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 }}>
      <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: checked ? c.primary : c.borderStrong,
        backgroundColor: checked ? c.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {checked ? <Icon name="check" size={16} color="#fff" strokeWidth={3} /> : null}
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </Pressable>
  )
}

export default function Onboarding() {
  const router = useRouter()
  const { identity, set } = useIdentity()
  const { c, dark } = useTheme()
  const own = useOwnAccounts()
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [born, setBorn] = useState<Date | null>(null)
  const [ok, setOk] = useState({ cgu: false, cgv: false, privacy: false })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const fixedBirth = !!identity?.birth_date
  useEffect(() => {
    if (!identity) return
    setFirst(f => f || identity.first_name || '')
    setLast(l => l || identity.last_name || '')
    if (identity.birth_date) setBorn(new Date(`${identity.birth_date}T12:00:00`))
  }, [identity])

  const legal = identity?.legal || { cgu: 'https://chapote.fr/legal/cgu', cgv: 'https://chapote.fr/legal/cgv', privacy: 'https://chapote.fr/legal/confidentialite' }
  const open = (u: string) => WebBrowser.openBrowserAsync(u).catch(() => {})
  const pickDate = () => {
    if (fixedBirth) return
    DateTimePickerAndroid.open({ value: born || new Date(2000, 0, 1), mode: 'date', maximumDate: new Date(),
      onValueChange: (_, d) => { if (d) setBorn(d) } })
  }
  const valid = first.trim() && last.trim() && born && ok.cgu && ok.cgv && ok.privacy

  const save = async () => {
    if (!valid || !born) return
    setErr(null); setBusy(true)
    try {
      const i = await putIdentity({ first_name: first.trim(), last_name: last.trim(), birth_date: iso(born), accept_terms: true })
      set(i)
      router.replace(i.blocked_until ? '/blocked' : own.length ? '/' : '/welcome')
    } catch (e: any) { setErr(e?.message || 'Enregistrement impossible') } finally { setBusy(false) }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: stepTitle(1, own.length), headerBackVisible: false, gestureEnabled: false }} />
      <View style={{ gap: space.sm, paddingTop: space.md }}>
        <H1>Vos informations</H1>
        <Txt muted>Pour finir votre inscription.</Txt>
      </View>
      {err ? <Msg kind="err">{err}</Msg> : null}
      <Card>
        <Field label="Prénom" value={first} onChangeText={setFirst} autoComplete="given-name" textContentType="givenName" maxLength={80} />
        <Field label="Nom" value={last} onChangeText={setLast} autoComplete="family-name" textContentType="familyName" maxLength={80} />
        <View style={{ gap: 6 }}>
          <Txt small bold>Date de naissance</Txt>
          {RNPlatform.OS === 'ios' && !fixedBirth ? (
            <DateTimePicker value={born || new Date(2000, 0, 1)} mode="date" display="compact" locale="fr-FR" maximumDate={new Date()}
              themeVariant={dark ? 'dark' : 'light'} accentColor={c.primary} accessibilityLabel="Date de naissance"
              onValueChange={(_, d) => { if (d) setBorn(d) }} />
          ) : (
            <Pressable onPress={pickDate} disabled={fixedBirth} accessibilityRole="button" accessibilityLabel="Date de naissance"
              style={{ minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderStrong, backgroundColor: c.surface,
                flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, opacity: fixedBirth ? 0.6 : 1 }}>
              <Icon name="calendar" size={18} color={c.muted} />
              <Txt muted={!born}>{born ? fr(born) : 'Choisir la date'}</Txt>
            </Pressable>
          )}
          {fixedBirth ? <Txt small muted>Déjà enregistrée. Une erreur ? Écrivez à contact@chapote.fr.</Txt> : null}
        </View>
      </Card>
      <Card>
        <Check checked={ok.cgu} onToggle={() => setOk(o => ({ ...o, cgu: !o.cgu }))}>
          <Txt>J’accepte les <Txt bold color={c.primary} onPress={() => open(legal.cgu)}>conditions d’utilisation</Txt></Txt>
        </Check>
        <Check checked={ok.cgv} onToggle={() => setOk(o => ({ ...o, cgv: !o.cgv }))}>
          <Txt>J’accepte les <Txt bold color={c.primary} onPress={() => open(legal.cgv)}>conditions de vente</Txt></Txt>
        </Check>
        <Check checked={ok.privacy} onToggle={() => setOk(o => ({ ...o, privacy: !o.privacy }))}>
          <Txt>J’ai lu la <Txt bold color={c.primary} onPress={() => open(legal.privacy)}>politique de confidentialité</Txt></Txt>
        </Check>
      </Card>
      <Button kind="primary" title="Continuer" loading={busy} disabled={!valid} onPress={save} />
    </Screen>
  )
}
