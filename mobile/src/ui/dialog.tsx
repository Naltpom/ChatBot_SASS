// Fenêtre de confirmation aux couleurs de l'app (remplace la boîte d'Android). Même forme que Alert.alert :
// showDialog(titre, message?, boutons?, options?). Bouton « cancel » : discret ; « destructive » : rouge ;
// les autres : bouton principal. Toucher le fond ou le bouton retour annule (si un bouton « cancel » existe).
import * as Haptics from 'expo-haptics'
import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, Modal, Pressable, View, type AlertButton } from 'react-native'
import { Button, Txt } from './kit'
import { radius, space, useTheme } from './theme'

interface Dialog { title: string; message?: string; buttons: AlertButton[]; cancelable: boolean; onDismiss?: () => void }
let push: ((d: Dialog) => void) | null = null
const waiting: Dialog[] = []

export function showDialog(title: string, message?: string, buttons?: AlertButton[], options?: { cancelable?: boolean; onDismiss?: () => void }) {
  const d: Dialog = { title, message, buttons: buttons?.length ? buttons : [{ text: 'OK' }], cancelable: options?.cancelable ?? true, onDismiss: options?.onDismiss }
  if (push) push(d)
  else waiting.push(d)
}

/** À placer une fois, sous le thème. */
export function DialogHost() {
  const { c } = useTheme()
  const [queue, setQueue] = useState<Dialog[]>([])
  const fade = useRef(new Animated.Value(0)).current
  useEffect(() => {
    push = d => setQueue(q => [...q, d])
    if (waiting.length) setQueue(q => [...q, ...waiting.splice(0)])
    return () => { push = null }
  }, [])
  const cur = queue[0]
  useEffect(() => {
    if (!cur) return
    fade.setValue(0)
    Animated.timing(fade, { toValue: 1, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: true }).start()
  }, [cur, fade])
  if (!cur) return null

  const close = (b?: AlertButton) => {
    setQueue(q => q.slice(1))
    setTimeout(() => b?.onPress?.(), 60)       // après la fermeture : la suite peut ouvrir une autre fenêtre
  }
  const cancelBtn = cur.buttons.find(b => b.style === 'cancel')
  const dismiss = () => {
    if (!cur.cancelable && !cancelBtn) return
    close(cancelBtn)
    if (!cancelBtn) cur.onDismiss?.()
  }
  // Ordre d'affichage : actions d'abord, « Annuler » en dernier (en bas, loin du pouce qui confirme).
  const ordered = [...cur.buttons.filter(b => b.style !== 'cancel'), ...(cancelBtn ? [cancelBtn] : [])]
  return (
    <Modal visible transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent navigationBarTranslucent>
      <Animated.View style={{ flex: 1, opacity: fade }}>
        <Pressable style={{ flex: 1, backgroundColor: c.overlay, alignItems: 'center', justifyContent: 'center', padding: space.xl }}
          onPress={dismiss} accessibilityRole="button" accessibilityLabel="Fermer">
          <Animated.View accessibilityViewIsModal accessibilityRole="alert" onStartShouldSetResponder={() => true}
            style={{ width: '100%', maxWidth: 400, backgroundColor: c.surface, borderRadius: radius.lg, padding: space.xl, gap: space.md,
              borderWidth: 1, borderColor: c.border,
              transform: [{ scale: fade.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }}>
            <Pressable onPress={() => {}} style={{ gap: space.sm }} accessible={false}>
              <Txt bold size={20} accessibilityRole="header">{cur.title}</Txt>
              {cur.message ? <Txt muted>{cur.message}</Txt> : null}
            </Pressable>
            <View style={{ gap: space.sm, marginTop: space.xs }}>
              {ordered.map((b, i) => (
                <Button key={`${b.text}-${i}`} title={b.text || 'OK'}
                  kind={b.style === 'cancel' ? 'ghost' : b.style === 'destructive' ? 'destructive' : 'primary'}
                  onPress={() => { Haptics.selectionAsync().catch(() => {}); close(b) }} />
              ))}
            </View>
          </Animated.View>
        </Pressable>
      </Animated.View>
    </Modal>
  )
}
