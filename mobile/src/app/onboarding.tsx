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
import { t, locale } from '../lib/i18n'

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const fr = (d: Date) => d.toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' })

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
  const missing = [!first.trim() && t('le prénom'), !last.trim() && t('le nom'), !born && t('la date de naissance'), !ok && t('l’accord sur les conditions')].filter(Boolean) as string[]
  const valid = missing.length === 0

  const save = async () => {
    if (!valid || !born) return
    setErr(null); setBusy(true)
    try {
      const i = await putIdentity({ first_name: first.trim(), last_name: last.trim(), birth_date: iso(born), accept_terms: true })
      set(i)
      router.replace(i.blocked_until ? '/blocked' : own.length ? '/' : '/welcome')
    } catch (e: any) { setErr(e?.message || t('Enregistrement impossible')) } finally { setBusy(false) }
  }

  return (
    <Screen>
      <StepHeader n={1} />
      <View style={{ gap: space.md }}>
        <StepProgress step={1} total={STEPS} label={t('Vos informations')} />
        <H1>{t('Faisons connaissance')}</H1>
        <Txt muted>{t('Trois informations, puis on connecte vos comptes.')}</Txt>
      </View>
      {err ? <Msg kind="err">{err}</Msg> : null}
      <Card>
        <Field label={t('Prénom')} value={first} onChangeText={setFirst} onBlur={() => setTouched(true)} error={touched && !first.trim() ? t('Indiquez votre prénom.') : null} autoComplete="given-name" textContentType="givenName" maxLength={80} />
        <Field label={t('Nom')} value={last} onChangeText={setLast} error={touched && first.trim() && !last.trim() ? t('Indiquez votre nom.') : null} autoComplete="family-name" textContentType="familyName" maxLength={80} />
        <View style={{ gap: 6 }}>
          <Txt small bold>{t('Date de naissance')}</Txt>
          {RNPlatform.OS === 'ios' && !fixedBirth ? (
            <DateTimePicker value={born || new Date(2000, 0, 1)} mode="date" display="compact" locale={locale()} maximumDate={new Date()}
              themeVariant={dark ? 'dark' : 'light'} accentColor={c.primary} accessibilityLabel={t('Date de naissance')}
              onValueChange={(_, d) => { if (d) setBorn(d) }} />
          ) : (
            <Pressable onPress={pickDate} disabled={fixedBirth} accessibilityRole="button" accessibilityLabel={t('Date de naissance')}
              style={{ minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderStrong, backgroundColor: c.surface,
                flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, opacity: fixedBirth ? 0.6 : 1 }}>
              <Icon name="calendar" size={18} color={c.muted} />
              <Txt muted={!born}>{born ? fr(born) : t('Choisir la date')}</Txt>
            </Pressable>
          )}
          {fixedBirth ? <Txt small muted>{t('Déjà enregistrée. Une erreur ? Écrivez à contact@chapote.fr.')}</Txt> : null}
        </View>
      </Card>
      <Check checked={ok} onToggle={() => setOk(v => !v)}>
        <Txt>{t('J’accepte les ')}<Txt bold color={c.primary} onPress={() => open(legal.cgu)}>{t('conditions d’utilisation')}</Txt>{t(', les')}{' '}
          <Txt bold color={c.primary} onPress={() => open(legal.cgv)}>{t('conditions de vente')}</Txt>{t(' et la')}{' '}
          <Txt bold color={c.primary} onPress={() => open(legal.privacy)}>{t('politique de confidentialité')}</Txt>.</Txt>
      </Check>
      <Txt small muted>{t('Chapote CM est réservé aux 15 ans et plus. Votre date de naissance ne sert qu’à le vérifier.')}</Txt>
      <Button kind="primary" title={t('Continuer : connecter mes comptes')} loading={busy} disabled={!valid} onPress={save} style={{ minHeight: 52 }} />
      <Missing items={missing} />
    </Screen>
  )
}
