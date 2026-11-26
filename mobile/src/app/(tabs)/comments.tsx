// Commentaires et messages de tous les comptes, au même endroit (filtrés par l'en-tête : espace,
// groupe ou compte). Comme cm/src/pages/Comments.tsx :
// - À traiter : regroupés par vidéo ; répondre, réponse privée (Instagram), masquer, traiter ;
//   recherche et tri par l'API, pages au défilement.
// - Mot-clé : ceux qui ont écrit « SHEET » (ou un autre mot), pour les contacter.
// - Messages : conversations Instagram (réponse possible 24 h après le dernier message reçu).
import { useRouter } from 'expo-router'
import { useEffect, useState, type ReactElement } from 'react'
import { FlatList, KeyboardAvoidingView, Platform as RNPlatform, Pressable, RefreshControl, ScrollView, View } from 'react-native'
import {
  getCommentsPage, getConversation, getConversations, getInboxAccounts, getKeyword, sendDm, syncInbox,
  type Comment, type Conversation, type DmMessage, type InboxAccount,
} from '../../lib/api'
import { fmtAgo } from '../../lib/format'
import { useLoad, useRole, useSession } from '../../lib/session'
import {
  Button, Card, Chip, Divider, Empty, Field, Icon, Msg, Row, SearchField, Seg, Skeleton, Txt,
} from '../../ui/kit'
import { radius, space, useTheme } from '../../ui/theme'
import { CommentCard, GroupHead } from '../../features/insights/CommentCard'
import { errText, openApp, useDebounced, useListState, usePages, useStored } from '../../features/insights/hooks'
import { applyChanges, byVideo, type CommentGroup } from '../../features/insights/logic'
import { ChipRow, SortChips } from '../../features/insights/parts'
import { t } from '../../lib/i18n'

type Tab = 'todo' | 'keyword' | 'messages'
const STATUS: [string, string][] = [['todo', 'À traiter'], ['replied', 'Répondus'], ['contacted', 'Contactés'], ['hidden', 'Masqués'], ['ignored', 'Ignorés'], ['all', 'Tous']]
const PLATFORM_NAME = { tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram' } as const

const listStyle = { padding: space.lg, paddingBottom: 48, gap: space.md, width: '100%' as const, maxWidth: 820, alignSelf: 'center' as const }

function Notices({ accounts }: { accounts: InboxAccount[] }) {
  const { c } = useTheme()
  const [open, setOpen] = useState(false)
  const by = new Map<string, string[]>()
  for (const a of accounts) if (a.notice) by.set(a.notice, [...(by.get(a.notice) || []), a.name || a.platform])
  if (!by.size) return null
  return (
    <Pressable onPress={() => setOpen(o => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }}
      style={{ backgroundColor: c.warnBg, borderRadius: radius.md, padding: space.md, gap: space.sm }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt small bold color={c.warn} style={{ flex: 1 }}>{by.size === 1 ? t('Une permission en attente pour certains comptes') : t('Des permissions en attente pour certains comptes')}</Txt>
        <Icon name={open ? 'down' : 'right'} size={16} color={c.warn} />
      </Row>
      {open ? [...by.entries()].map(([n, names]) => (
        <Txt key={n} small><Txt small bold>{names.join(', ')}</Txt> : {t(n)}</Txt>
      )) : null}
    </Pressable>
  )
}

/** Un groupe : la vidéo puis ses commentaires. */
function VideoGroup({ g, canEdit, template, onChanged }: { g: CommentGroup; canEdit: boolean; template?: string; onChanged: (id: number, c: Comment | null) => void }) {
  const router = useRouter()
  const plats = g.platforms.map(p => PLATFORM_NAME[p]).join(', ')
  const sub = `${g.fresh ? `${g.fresh > 1 ? t('{n} nouveaux', { n: g.fresh }) : t('{n} nouveau', { n: g.fresh })} · ` : ''}${plats}`
  return (
    <Card style={{ paddingVertical: space.md, gap: 0 }}>
      <GroupHead title={g.title || t('Vidéo')} thumb={g.thumb} sub={sub}
        onPress={g.videoId ? () => router.push(`/video/${g.videoId}`) : undefined} />
      {g.items.map(c => (
        <View key={c.id}>
          <Divider />
          <CommentCard c={c} canEdit={canEdit} template={template} onChanged={n => onChanged(c.id, n)} />
        </View>
      ))}
    </Card>
  )
}

function Todo({ top, canEdit, onRefresh }: { top: ReactElement; canEdit: boolean; onRefresh: () => void }) {
  const { c } = useTheme()
  const [st, setSt] = useState('todo')
  const list = useListState<'recent' | 'likes'>('recent', () => 'desc')
  const pages = usePages((s, cursor) => getCommentsPage(s, { status: st, q: list.q || undefined, sort: list.sort, order: list.order, cursor }),
    [st, list.q, list.sort, list.order], 'comments-todo')
  const [changed, setChanged] = useState<Record<number, Comment | null>>({})
  const shown = applyChanges(pages.items || [], changed, st)
  const groups = byVideo(shown)
  return (
    <FlatList
      data={groups}
      keyExtractor={g => g.key}
      renderItem={({ item }) => <VideoGroup g={item} canEdit={canEdit} onChanged={(id, n) => setChanged(m => ({ ...m, [id]: n }))} />}
      contentContainerStyle={listStyle}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets
      onEndReached={pages.more} onEndReachedThreshold={0.6}
      refreshControl={<RefreshControl refreshing={pages.refreshing} onRefresh={() => { setChanged({}); pages.reload(); onRefresh() }} tintColor={c.muted} />}
      ListHeaderComponent={
        <View style={{ gap: space.md }}>
          {top}
          <SearchField value={list.input} onChangeText={list.setInput} placeholder={t('Rechercher (texte, pseudo, vidéo)')} />
          <ChipRow label={t('Afficher')}>
            {STATUS.map(([v, l]) => <Chip key={v} label={t(l)} selected={st === v} onPress={() => { setSt(v); setChanged({}) }} />)}
          </ChipRow>
          <SortChips list={list} options={[['recent', 'Date'], ['likes', 'J’aime']]} />
          {pages.items ? <Txt small muted accessibilityRole="text">{shown.length > 1 ? t('{n} commentaires', { n: shown.length }) : t('{n} commentaire', { n: shown.length })}{pages.next ? ` ${t('et plus')}` : ''}</Txt> : null}
          {pages.error ? <Msg kind="err">{pages.error}</Msg> : null}
        </View>
      }
      ListEmptyComponent={
        !pages.items ? <View style={{ gap: space.md }}><Skeleton h={90} n={4} /></View>
          : list.q ? <Empty title={t('Aucun résultat')} icon="search">{t('Rien ne correspond à « {q} ». Essayez un autre mot ou un autre filtre.', { q: list.q })}</Empty>
          : st === 'todo' ? <Empty title={t('Tout est traité')} icon="check">{t('Aucun commentaire en attente. Les nouveaux arrivent ici, avec une notification si vous l’avez activée.')}</Empty>
          : <Empty title={t('Aucun commentaire')} icon="comment">{t('Les commentaires de vos vidéos arrivent ici dès leur relevé.')}</Empty>
      }
      ListFooterComponent={pages.busy ? <Skeleton h={70} /> : undefined}
    />
  )
}

function Keyword({ top, canEdit, onRefresh }: { top: ReactElement; canEdit: boolean; onRefresh: () => void }) {
  const { c } = useTheme()
  const [savedWord, saveWord, ready] = useStored('cm.kw', 'SHEET')
  const [tpl, setTpl] = useStored('cm.kw.msg', 'Hello {pseudo}! Thanks for your comment 🎹 Here is the sheet: ')
  const [word, setWord] = useState(savedWord)
  useEffect(() => { if (ready) setWord(savedWord) }, [ready]) // eslint-disable-line react-hooks/exhaustive-deps
  const w = useDebounced(word.trim(), 400)
  useEffect(() => { if (ready && w) saveWord(w) }, [w]) // eslint-disable-line react-hooks/exhaustive-deps
  const people = useLoad(s => (w.length >= 2 ? getKeyword(s, w) : Promise.resolve([] as Comment[])), [w], 'comments-keyword')
  const [done, setDone] = useState<number[]>([])
  const rows = (people.data || []).filter(p => !done.includes(p.id))
  const groups = byVideo(rows)
  return (
    <FlatList
      data={groups}
      keyExtractor={g => g.key}
      renderItem={({ item }) => <VideoGroup g={item} canEdit={canEdit} template={tpl}
        onChanged={(id, n) => { if (!n || n.status !== 'new' || n.private_replied_at) setDone(d => [...d, id]) }} />}
      contentContainerStyle={listStyle}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets
      refreshControl={<RefreshControl refreshing={people.loading && !!people.data} onRefresh={() => { setDone([]); people.reload(); onRefresh() }} tintColor={c.muted} />}
      ListHeaderComponent={
        <View style={{ gap: space.md }}>
          {top}
          <Card>
            <Field label={t('Mot écrit en commentaire')} value={word} onChangeText={setWord} maxLength={40} placeholder="SHEET" autoCapitalize="characters" autoCorrect={false} />
            <Field label={t('Message à envoyer ({pseudo} = la personne)')} value={tpl} onChangeText={setTpl} maxLength={1000} multiline />
            <Txt small muted>
              {t('Instagram ne donne pas la liste des personnes qui aiment un commentaire : la liste vient de celles qui ont écrit le mot. Réponse privée possible 7 jours après le commentaire ; sinon copiez le message et ouvrez Instagram.')}
            </Txt>
          </Card>
          {people.data ? <Txt small muted>{rows.length > 1 ? t('{n} personnes', { n: rows.length }) : t('{n} personne', { n: rows.length })}</Txt> : null}
          {people.error ? <Msg kind="err">{people.error}</Msg> : null}
        </View>
      }
      ListEmptyComponent={
        !people.data ? <View style={{ gap: space.md }}><Skeleton h={80} n={3} /></View>
          : <Empty title={t('Personne à contacter')} icon="check">{w.length < 2 ? t('Écrivez un mot d’au moins 2 lettres.') : t('Aucun nouveau commentaire contenant « {word} ».', { word: w })}</Empty>
      }
    />
  )
}

function Thread({ acc, conv, onBack }: { acc: InboxAccount; conv: Conversation; onBack: () => void }) {
  const { c } = useTheme()
  const { orgOf } = useSession()
  const org = orgOf('instagram', acc.id)
  const [thread, setThread] = useState<{ messages: DmMessage[]; can_write: boolean } | null>(null)
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const load = () => getConversation(org, acc.id, conv.id).then(setThread).catch(e => setErr(errText(e)))
  useEffect(() => { setThread(null); load() }, [conv.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const send = async () => {
    setErr('')
    try { await sendDm(org, acc.id, conv.id, conv.with_id || '', text.trim()); setText(''); await load() }
    catch (e) { setErr(errText(e)) }
  }
  return (
    <KeyboardAvoidingView behavior={RNPlatform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={100} style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm }}>
        <Row>
          <Button small kind="ghost" icon="left" title={t('Conversations')} onPress={onBack} />
          <Txt bold numberOfLines={1} style={{ flex: 1, textAlign: 'right' }}>@{conv.with}</Txt>
        </Row>
      </View>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.sm }} accessibilityLabel={t('Conversation avec @{name}', { name: conv.with })}>
        {err ? <Msg kind="err">{err}</Msg> : null}
        {!thread ? <Skeleton h={60} n={2} /> : null}
        {(thread?.messages || []).slice().reverse().map(m => (
          <View key={m.id} accessible accessibilityLabel={`${m.from_me ? t('Vous') : `@${conv.with}`} : ${m.text || ''}`}
            style={{ alignSelf: m.from_me ? 'flex-end' : 'flex-start', maxWidth: '82%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8,
              backgroundColor: m.from_me ? c.primary : c.surface2 }}>
            <Txt selectable color={m.from_me ? c.onPrimary : c.text}>{m.text}</Txt>
          </View>
        ))}
      </ScrollView>
      {thread ? (
        <View style={{ padding: space.lg, paddingTop: space.sm, borderTopWidth: 1, borderColor: c.border, backgroundColor: c.surface }}>
          {thread.can_write ? (
            <Row>
              <Field value={text} onChangeText={setText} placeholder={t('Message')} accessibilityLabel={t('Message')} maxLength={1000} style={{ flex: 1 }} />
              <Button kind="primary" title={t('Envoyer')} disabled={!text.trim()} onPress={send} />
            </Row>
          ) : (
            <View style={{ gap: space.sm }}>
              <Txt small muted>{t('Instagram n’autorise une réponse que dans les 24 h qui suivent le dernier message de la personne.')}</Txt>
              {conv.with ? <Button small title={t('Écrire depuis Instagram')} icon="external" onPress={() => openApp(`https://ig.me/m/${conv.with}`)} /> : null}
            </View>
          )}
        </View>
      ) : null}
    </KeyboardAvoidingView>
  )
}

function Messages({ top, accounts, onRefresh }: { top: ReactElement; accounts: InboxAccount[]; onRefresh: () => void }) {
  const { c } = useTheme()
  const { orgOf } = useSession()
  const ig = accounts.filter(a => a.platform === 'instagram')
  const [acc, setAcc] = useState<number | null>(ig.find(a => a.messages)?.id ?? ig[0]?.id ?? null)
  const current = ig.find(a => a.id === acc)
  const convs = useLoad(() => (current?.messages ? getConversations(orgOf('instagram', current.id), current.id) : Promise.resolve(null as Conversation[] | null)),
    [acc, current?.messages], 'comments-convs')
  const [open, setOpen] = useState<Conversation | null>(null)
  if (open && current) return <View style={{ flex: 1 }}><Thread acc={current} conv={open} onBack={() => setOpen(null)} /></View>
  return (
    <FlatList
      data={current?.messages ? convs.data || [] : []}
      keyExtractor={x => x.id}
      contentContainerStyle={listStyle}
      refreshControl={<RefreshControl refreshing={convs.loading && !!convs.data} onRefresh={() => { convs.reload(); onRefresh() }} tintColor={c.muted} />}
      renderItem={({ item }) => (
        <Pressable onPress={() => setOpen(item)} accessibilityRole="button"
          accessibilityLabel={`@${item.with}. ${item.last_from_me ? t('Vous : ') : ''}${item.last || ''}`}
          style={({ pressed }) => ({ backgroundColor: c.surface, borderRadius: radius.md, padding: space.md, minHeight: 56,
            flexDirection: 'row', alignItems: 'center', gap: space.md, opacity: pressed ? 0.6 : 1 })}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt bold numberOfLines={1} style={{ flex: 1 }}>@{item.with}</Txt>
              <Txt small faint>{fmtAgo(item.updated_at)}</Txt>
            </Row>
            <Txt small muted numberOfLines={1}>{item.last_from_me ? t('Vous : ') : ''}{item.last}</Txt>
          </View>
          <Icon name="right" size={18} color={c.faint} />
        </Pressable>
      )}
      ListHeaderComponent={
        <View style={{ gap: space.md }}>
          {top}
          {ig.length > 1 ? (
            <ChipRow label={t('Compte Instagram')}>
              {ig.map(a => <Chip key={a.id} label={a.name || 'Instagram'} selected={a.id === acc} onPress={() => { setAcc(a.id); setOpen(null) }} />)}
            </ChipRow>
          ) : null}
          {current && !current.messages
            ? <Msg>{current.source === 'routine' ? t('Les messages de ce compte (géré par la routine) se lisent dans Instagram.') : current.notice ? t(current.notice) : t('Messages indisponibles pour ce compte.')}</Msg>
            : null}
          {convs.error ? <Msg kind="err">{convs.error}</Msg> : null}
        </View>
      }
      ListEmptyComponent={
        !ig.length ? <Empty title={t('Aucun compte Instagram')} icon="comment">{t('Les messages privés concernent Instagram.')}</Empty>
          : current?.messages ? (convs.data ? <Txt small muted>{t('Aucune conversation.')}</Txt> : <View style={{ gap: space.md }}><Skeleton h={56} n={4} /></View>)
          : undefined
      }
    />
  )
}

export default function Comments() {
  const { c } = useTheme()
  const { org, orgOf } = useSession()
  const { canEdit } = useRole()
  const [tab, setTab] = useState<Tab>('todo')
  const accounts = useLoad(s => getInboxAccounts(s), [], 'inbox-accounts')
  const [syncMsg, setSyncMsg] = useState<{ kind: 'info' | 'err'; text: string } | null>(null)
  const sync = async () => {
    setSyncMsg(null)
    try {
      // « Tous » : chaque espace des comptes affichés est relu.
      const orgs = [...new Set((accounts.data || []).map(a => orgOf(a.platform, a.id)))]
      const all = await Promise.all((orgs.length ? orgs : [org]).map(o => syncInbox(o)))
      const r = { comments: all.reduce((n, x) => n + x.comments, 0), notices: all.flatMap(x => x.notices || []) }
      const head = r.comments > 1 ? t('{n} commentaires relus.', { n: r.comments }) : t('{n} commentaire relu.', { n: r.comments })
      setSyncMsg({ kind: 'info', text: `${head}${r.notices?.length ? ` ${r.notices.map(x => t(x)).join(' ')}` : ''}` })
      accounts.reload()
    } catch (e) { setSyncMsg({ kind: 'err', text: errText(e) }) }
  }
  const fresh = (accounts.data || []).reduce((s, a) => s + (a.new || 0), 0)
  const top = (
    <View style={{ gap: space.md }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Txt size={26} bold accessibilityRole="header">{t('Commentaires')}</Txt>
          <Txt small muted>{fresh ? `${fresh > 1 ? t('{n} nouveaux', { n: fresh }) : t('{n} nouveau', { n: fresh })} · ` : ''}{t('Tous vos comptes au même endroit.')}</Txt>
        </View>
        <Button small icon="refresh" title={t('Relire')} onPress={sync} accessibilityLabel={t('Relire les commentaires')} />
      </Row>
      {syncMsg ? <Msg kind={syncMsg.kind}>{syncMsg.text}</Msg> : null}
      {accounts.error ? <Msg kind="err">{accounts.error}</Msg> : null}
      {accounts.data ? <Notices accounts={accounts.data} /> : null}
      <Seg<Tab> value={tab} onChange={setTab} label={t('Vue')} options={[['todo', t('À traiter')], ['keyword', t('Mot-clé')], ['messages', t('Messages')]]} />

    </View>
  )
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {tab === 'todo' ? <Todo top={top} canEdit={canEdit} onRefresh={accounts.reload} /> : null}
      {tab === 'keyword' ? <Keyword top={top} canEdit={canEdit} onRefresh={accounts.reload} /> : null}
      {tab === 'messages' ? (
        accounts.data ? <Messages top={top} accounts={accounts.data} onRefresh={accounts.reload} />
          : <View style={{ padding: space.lg, gap: space.md }}>{top}<Skeleton h={56} n={3} /></View>
      ) : null}
    </View>
  )
}
