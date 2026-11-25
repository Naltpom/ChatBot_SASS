// Inscription, étape 1 (obligatoire) : prénom, nom, date de naissance et conditions acceptées.
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker'
import { useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useEffect, useState } from 'react'
import { Platform as RNPlatform, Pressable, View } from 'react-native'
import { putIdentity } from '../lib/api'
import { useIdentity } from '../lib/identity'
import { STEPS } from '../lib/onboarding'
import { StepHeader, useOwnAccounts } from '../features/steps'
import { Missing, StepProgress } from '../ui/Progress'
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
        {checked ? <Icon name="check" size={16} color={c.onPrimary} strokeWidth={3} /> : null}
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
  const [ok, setOk] = useState(false)
  const [touched, setTouched] = useState(false)
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
  const missing = [!first.trim() && 'le prénom', !last.trim() && 'le nom', !born && 'la date de naissance', !ok && 'l’accord sur les conditions'].filter(Boolean) as string[]
  const valid = missing.length === 0

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
      <StepHeader n={1} />
      <View style={{ gap: space.md }}>
        <StepProgress step={1} total={STEPS} label="Vos informations" />
        <H1>Faisons connaissance</H1>
        <Txt muted>Trois informations, puis on connecte vos comptes.</Txt>
      </View>
      {err ? <Msg kind="err">{err}</Msg> : null}
      <Card>
        <Field label="Prénom" value={first} onChangeText={setFirst} onBlur={() => setTouched(true)} error={touched && !first.trim() ? 'Indiquez votre prénom.' : null} autoComplete="given-name" textContentType="givenName" maxLength={80} />
        <Field label="Nom" value={last} onChangeText={setLast} error={touched && first.trim() && !last.trim() ? 'Indiquez votre nom.' : null} autoComplete="family-name" textContentType="familyName" maxLength={80} />
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
      <Check checked={ok} onToggle={() => setOk(v => !v)}>
        <Txt>J’accepte les <Txt bold color={c.primary} onPress={() => open(legal.cgu)}>conditions d’utilisation</Txt>, les{' '}
          <Txt bold color={c.primary} onPress={() => open(legal.cgv)}>conditions de vente</Txt> et la{' '}
          <Txt bold color={c.primary} onPress={() => open(legal.privacy)}>politique de confidentialité</Txt>.</Txt>
      </Check>
      <Txt small muted>Chapote CM est réservé aux 15 ans et plus. Votre date de naissance ne sert qu’à le vérifier.</Txt>
      <Button kind="primary" title="Continuer : connecter mes comptes" loading={busy} disabled={!valid} onPress={save} style={{ minHeight: 52 }} />
      <Missing items={missing} />
    </Screen>
  )
}
