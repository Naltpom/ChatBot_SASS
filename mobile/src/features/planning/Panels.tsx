// Options propres à chaque plateforme (mêmes règles que le Composer du site).
// TikTok (Content Sharing Guidelines) : pseudo affiché, confidentialité SANS valeur présélectionnée,
// interactions décochées et grisées si coupées chez le créateur, divulgation commerciale.
import { useState } from 'react'
import { Pressable, View } from 'react-native'
import type { Account } from '../../lib/api'
import { TIKTOK_PRIVACY } from '../../lib/format'
import { Avatar, Field, Icon, Loading, Msg, Row, Txt } from '../../ui/kit'
import { space, useTheme } from '../../ui/theme'
import { YT_CATEGORIES, YT_PRIVACY, type CreatorState, type InstaOpts, type TikTokOpts, type YouTubeOpts } from './compose'
import { Check, Choice } from './ui'

/** Texte propre à une plateforme, replié tant qu'il est vide. */
function OwnText({ value, onChange, busy, label, max }: { value: string; onChange: (v: string) => void; busy: boolean; label: string; max: number }) {
  const { c } = useTheme()
  const [open, setOpen] = useState(!!value)
  return (
    <View style={{ gap: 6 }}>
      <Pressable onPress={() => setOpen(o => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }}
        style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Txt small bold color={c.accent}>{label}</Txt>
        <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}><Icon name="down" size={16} color={c.accent} /></View>
      </Pressable>
      {open ? <Field value={value} onChangeText={onChange} maxLength={max} editable={!busy} multiline accessibilityLabel={label}
        placeholder="Vide = la légende commune" hint={`${value.length} / ${max.toLocaleString('fr-FR')}`} /> : null}
    </View>
  )
}

export function TikTokPanel({ account, o, ci, busy, set }: { account: Account; o: TikTokOpts; ci: CreatorState | undefined; busy: boolean; set: (p: Partial<TikTokOpts>) => void }) {
  if (!ci || ci === 'loading') return <Loading label="Lecture des options du compte TikTok…" />
  if ('error' in ci) return <Msg kind="err">{ci.error}</Msg>
  if (!ci.can_post || !ci.creator) return <Msg kind="err">{ci.message || 'Publication impossible sur ce compte.'}</Msg>
  const cr = ci.creator
  const direct = o.mode === 'direct'
  const brandedOn = direct && o.commercial && o.branded
  return (
    <View style={{ gap: space.sm }}>
      <Row gap={8}><Avatar src={cr.avatar_url} name={cr.nickname} size={28} /><Txt small muted numberOfLines={1} style={{ flex: 1 }}>Publié sur {cr.nickname || cr.username || account.name}</Txt></Row>
      {account.can_draft && account.can_direct ? (
        <Choice label="Mode" value={o.mode} disabled={busy} onChange={v => set({ mode: v })}
          options={[['direct', 'Publication directe'], ['draft', 'Brouillon dans l’app']]} />
      ) : null}
      {direct ? (
        <>
          <OwnText label="Légende propre à TikTok" value={o.text} onChange={v => set({ text: v })} busy={busy} max={2200} />
          <Choice label="Qui peut voir cette vidéo (obligatoire)" value={o.privacy} disabled={busy} onChange={v => set({ privacy: v })}
            options={cr.privacy_level_options.map(p => [p, TIKTOK_PRIVACY[p] || p] as [string, string])}
            isDisabled={v => v === 'SELF_ONLY' && brandedOn} />
          {brandedOn ? <Txt small muted>La visibilité d’un contenu de marque ne peut pas être privée.</Txt> : null}
          <Txt small bold>Autoriser</Txt>
          {([['Commentaires', 'comment', cr.comment_disabled], ['Duos', 'duet', cr.duet_disabled], ['Collages', 'stitch', cr.stitch_disabled]] as const).map(([l, f, off]) => (
            <Check key={f} label={l} checked={!off && o[f]} disabled={off || busy} onChange={v => set({ [f]: v } as Partial<TikTokOpts>)} />
          ))}
          {cr.comment_disabled || cr.duet_disabled || cr.stitch_disabled
            ? <Txt small muted>Les options grisées sont désactivées dans les paramètres de votre compte TikTok.</Txt> : null}
          <Check label="Divulgation de contenu commercial" checked={o.commercial} disabled={busy}
            hint="Activez si cette vidéo fait la promotion de vous-même, d’une marque, d’un produit ou d’un service."
            onChange={v => set(v ? { commercial: true } : { commercial: false, yourBrand: false, branded: false })} />
          {o.commercial ? (
            <View style={{ paddingLeft: 34, gap: 4 }}>
              <Check label="Votre marque" hint="Vous faites la promotion de vous-même ou de votre propre activité." checked={o.yourBrand} disabled={busy} onChange={v => set({ yourBrand: v })} />
              <Check label="Contenu de marque" hint="Vous faites la promotion d’une autre marque ou d’un tiers." checked={o.branded} disabled={busy}
                onChange={v => set({ branded: v, ...(v && o.privacy === 'SELF_ONLY' ? { privacy: '' } : {}) })} />
              {o.branded ? <Msg>Votre vidéo sera étiquetée « Partenariat rémunéré ».</Msg>
                : o.yourBrand ? <Msg>Votre vidéo sera étiquetée « Contenu promotionnel ».</Msg>
                : <Txt small muted>Vous devez indiquer si votre contenu fait la promotion de vous-même, d’un tiers, ou des deux.</Txt>}
            </View>
          ) : null}
        </>
      ) : (
        <Txt small muted>La vidéo arrivera dans la boîte de réception TikTok du compte : vous terminerez la légende et la publication dans l’app.</Txt>
      )}
    </View>
  )
}

export function YouTubePanel({ o, busy, set }: { o: YouTubeOpts; busy: boolean; set: (p: Partial<YouTubeOpts>) => void }) {
  return (
    <View style={{ gap: space.sm }}>
      <Field label="Titre YouTube" value={o.title} maxLength={100} editable={!busy} onChangeText={v => set({ title: v })} placeholder="Vide = le titre de la publication"
        hint={`${o.title.length} / 100`} />
      <Choice label="Visibilité" value={o.privacy} disabled={busy} onChange={v => set({ privacy: v })} options={YT_PRIVACY} />
      <Choice label="Catégorie" value={o.category} disabled={busy} onChange={v => set({ category: v })} options={YT_CATEGORIES} />
      <OwnText label="Description propre à YouTube" value={o.description} onChange={v => set({ description: v })} busy={busy} max={5000} />
      <Field label="Mots-clés" value={o.tags} editable={!busy} onChangeText={v => set({ tags: v })} placeholder="piano, debussy, partition" hint="Séparés par des virgules." autoCapitalize="none" />
      <Choice label="Conçue pour les enfants ? (obligatoire)" value={o.kids} disabled={busy} onChange={v => set({ kids: v })} options={[['yes', 'Oui'], ['no', 'Non']]} />
      <Check label="Contenu modifié ou synthétique réaliste" hint="Une personne, un lieu ou un événement réaliste créé ou modifié (IA comprise)." checked={o.synthetic} disabled={busy} onChange={v => set({ synthetic: v })} />
      <Check label="Prévenir les abonnés" checked={o.notify} disabled={busy} onChange={v => set({ notify: v })} />
    </View>
  )
}

export function InstaPanel({ o, busy, set }: { o: InstaOpts; busy: boolean; set: (p: Partial<InstaOpts>) => void }) {
  return (
    <View style={{ gap: space.sm }}>
      <OwnText label="Légende propre à Instagram" value={o.text} onChange={v => set({ text: v })} busy={busy} max={2200} />
      <Field label="Collaborateurs (facultatif)" value={o.collaborators} editable={!busy} onChangeText={v => set({ collaborators: v })}
        placeholder="@pseudo1, @pseudo2" autoCapitalize="none" autoCorrect={false} hint="3 pseudos au plus : ils reçoivent une invitation de collaboration." />
      <Check label="Afficher aussi le Reel dans le fil" checked={o.feed} disabled={busy} onChange={v => set({ feed: v })} />
    </View>
  )
}
