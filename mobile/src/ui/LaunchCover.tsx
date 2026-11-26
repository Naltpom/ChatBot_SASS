// Page de chargement aux couleurs choisies (orange, bleu océan, vert forêt ; clair ou sombre). L'écran natif
// d'Android (figé dans la version installée) laisse la place à celle-ci dès que la couleur est connue ; elle
// reste jusqu'à ce que l'app soit prête, puis disparaît en fondu.
import * as SplashScreen from 'expo-splash-screen'
import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, StyleSheet } from 'react-native'
import { Logo } from './Logo'
import { useTheme } from './theme'
import { t } from '../lib/i18n'

let done = false
const listeners = new Set<() => void>()
/** L'app est prête : la page de chargement s'efface. */
export function launchDone() {
  if (done) return
  done = true
  listeners.forEach(l => l())
  SplashScreen.hideAsync().catch(() => {})      // au cas où l'écran natif serait encore là
}

export function LaunchCover() {
  const { c, loaded } = useTheme()
  const [gone, setGone] = useState(done)
  const fade = useRef(new Animated.Value(1)).current
  const pulse = useRef(new Animated.Value(0)).current
  // Couleur connue : l'écran natif part, on prend le relais.
  useEffect(() => { if (loaded) SplashScreen.hideAsync().catch(() => {}) }, [loaded])
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]))
    loop.start()
    const out = () => Animated.timing(fade, { toValue: 0, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(() => setGone(true))
    if (done) out()
    listeners.add(out)
    return () => { loop.stop(); listeners.delete(out) }
  }, [fade, pulse])
  if (gone || !loaded) return null
  return (
    <Animated.View pointerEvents="none" accessibilityLabel={t('Chargement de Chapote CM')}
      style={[StyleSheet.absoluteFill, { backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', opacity: fade }]}>
      <Animated.View style={{ transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] }) }] }}>
        <Logo size={96} bg={c.logo} />
      </Animated.View>
    </Animated.View>
  )
}
