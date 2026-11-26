// Choisir une vidéo de la bibliothèque (dossiers Drive) : recherche faite par le serveur, pages par curseur.
import { Image } from 'expo-image'
import { useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native'
import { getAssetsPage, type Asset } from '../../lib/api'
import { fmtDuration } from '../../lib/format'
import { useSession } from '../../lib/session'
import { Icon, Msg, SearchField, Sheet, Skeleton, Txt } from '../../ui/kit'
import { t } from '../../lib/i18n'
import { radius, space, useTheme } from '../../ui/theme'
import { apiUrl, useAuthHeaders } from './media'

export function LibrarySheet({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (a: Asset) => void }) {
  const { c } = useTheme()
  const { org } = useSession()
  const headers = useAuthHeaders()
  const [input, setInput] = useState('')
  const [q, setQ] = useState('')
  const [items, setItems] = useState<Asset[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { const t = setTimeout(() => setQ(input.trim()), 300); return () => clearTimeout(t) }, [input])
  const load = async (cursor: string | null, reset: boolean) => {
    setLoading(true); setErr('')
    try {
      const page = await getAssetsPage(org, { state: 'all', q: q || undefined, limit: 30, cursor })
      setItems(list => (reset ? page.items : [...list, ...page.items])); setNext(page.next)
    } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
  }
  useEffect(() => { if (visible) load(null, true) }, [visible, q, org]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Sheet visible={visible} onClose={onClose} title={t('Choisir dans la bibliothèque')} scroll={false}>
      <SearchField value={input} onChangeText={setInput} placeholder={t('Rechercher (nom, légende, dossier)')} />
      {err ? <Msg kind="err">{err}</Msg> : null}
      {!items.length && loading ? <View style={{ gap: space.sm }}><Skeleton h={88} n={3} /></View> : (
        <FlatList
          data={items}
          style={{ flexShrink: 1, minHeight: 240 }}
          keyExtractor={a => String(a.id)}
          keyboardShouldPersistTaps="handled"
          onEndReachedThreshold={0.5}
          onEndReached={() => { if (next && !loading) load(next, false) }}
          ListFooterComponent={loading && items.length ? <ActivityIndicator color={c.muted} style={{ padding: space.md }} /> : undefined}
          ListEmptyComponent={<Txt small muted center style={{ padding: space.lg }}>{q ? t('Aucune vidéo pour « {q} ».', { q }) : t('Aucune vidéo dans la bibliothèque.')}</Txt>}
          ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />}
          renderItem={({ item: a }) => (
            <Pressable onPress={() => onPick(a)} accessibilityRole="button" accessibilityLabel={t('Choisir {name}', { name: a.title || a.name })}
              style={({ pressed }) => ({ flexDirection: 'row', gap: space.md, paddingVertical: space.sm, alignItems: 'center', opacity: pressed ? 0.7 : 1 })}>
              <View style={{ width: 48, height: 72, borderRadius: radius.sm, backgroundColor: c.surface2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                {a.thumbnail && headers ? <Image source={{ uri: apiUrl(a.thumbnail, org), headers }} style={{ width: 48, height: 72 }} contentFit="cover" />
                  : <Icon name="video" size={20} color={c.faint} />}
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Txt bold numberOfLines={2}>{a.title || a.name}</Txt>
                <Txt small muted numberOfLines={1}>{fmtDuration(a.duration_sec)}{a.folder ? ` · ${a.folder}` : a.source_name ? ` · ${a.source_name}` : ''}</Txt>
                {a.scheduled || a.published ? (
                  <Txt size={12} color={c.warn}>{a.scheduled ? t('Déjà programmée ({when})', { when: a.scheduled }) : t('Déjà publiée ({when})', { when: a.published })}</Txt>
                ) : null}
              </View>
            </Pressable>
          )}
        />
      )}
    </Sheet>
  )
}
