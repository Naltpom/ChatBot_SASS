// Options propres à chaque plateforme (mêmes règles que le Composer du site).
// TikTok (Content Sharing Guidelines) : pseudo affiché, confidentialité SANS valeur présélectionnée,
// interactions décochées et grisées si coupées chez le créateur, divulgation commerciale.
import type React from 'react'
import { Pressable, View } from 'react-native'
import type { Account } from '../../lib/api'
import { TIKTOK_PRIVACY } from '../../lib/format'
import { Image } from 'expo-image'
import { Avatar, Button, Field, Icon, Loading, Msg, Row, Txt } from '../../ui/kit'
import { space, useTheme } from '../../ui/theme'
import { YT_CATEGORIES, YT_PRIVACY, type CreatorState, type InstaOpts, type TikTokOpts, type YouTubeOpts } from './compose'
import { Check, Choice } from './ui'
import { FramePicker } from './FramePicker'

/** Vidéo de la publication, pour choisir la miniature dans ses images. */
export interface Media { source: string | { uri: string; headers?: Record<string, string> } | null; duration: number | null }
/** Ce qui a été écrit à l'étape 1, repris dans chaque réseau. */
export interface Common { title: string; caption: string }

/** Miniature propre à un réseau : une image de la vidéo (et, pour Instagram, une image envoyée à part). */
function Thumb({ media, value, onChange, busy, note, children }: {
  media?: Media; value: number | null | undefined; onChange: (ms: number | null) => void; busy: boolean; note: string; children?: React.ReactNode
}) {
  return (
    <View style={{ gap: 8 }}>
      <Txt small bold>Miniature</Txt>
      <Txt size={12} muted>{note}</Txt>
      {media ? <FramePicker source={media.source} duration={media.duration} value={value ?? null} onChange={onChange} disabled={busy} /> : null}
      {children}
    </View>
  )
}

/** Texte propre à une plateforme, déjà rempli avec le texte commun de l'étape 1 (modifié ici : seulement pour ce réseau). */
function OwnText({ value, common, onChange, busy, label, max }: { value: string; common: string; onChange: (v: string) => void; busy: boolean; label: string; max: number }) {
  const { c } = useTheme()
  const shown = value || common
  const own = !!value && value !== common
  return (
    <View style={{ gap: 6 }}>
      <Field label={label} value={shown} onChangeText={v => onChange(v === common ? '' : v)} maxLength={max} editable={!busy} multiline
        placeholder="Le texte sous la vidéo" hint={`${shown.length.toLocaleString('fr-FR')} / ${max.toLocaleString('fr-FR')}${own ? ' · propre à ce réseau' : ' · le texte commun'}`} />
      {own ? (
        <Pressable onPress={() => onChange('')} disabled={busy} accessibilityRole="button" style={{ minHeight: 36, justifyContent: 'center' }}>
          <Txt small bold color={c.accent}>Reprendre le texte commun</Txt>
        </Pressable>
      ) : null}
    </View>
  )
}

export function TikTokPanel({ account, o, ci, busy, set, media, common }: { account: Account; o: TikTokOpts; ci: CreatorState | undefined; busy: boolean
  set: (p: Partial<TikTokOpts>) => void; media?: Media; common: Common }) {
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
          <OwnText label="Légende TikTok" value={o.text} common={common.caption || common.title} onChange={v => set({ text: v })} busy={busy} max={2200} />
          <Thumb media={media} value={o.coverMs} onChange={v => set({ coverMs: v })} busy={busy}
            note="TikTok prend une image de la vidéo : choisissez-la ci-dessous (sinon TikTok choisit)." />
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

export function YouTubePanel({ o, busy, set, common }: { o: YouTubeOpts; busy: boolean; set: (p: Partial<YouTubeOpts>) => void; common: Common }) {
  const title = o.title || common.title.slice(0, 100)
  return (
    <View style={{ gap: space.sm }}>
      <Field label="Titre YouTube" value={title} maxLength={100} editable={!busy} onChangeText={v => set({ title: v === common.title ? '' : v })}
        placeholder="Le titre de la vidéo" hint={`${title.length} / 100`} />
      <Choice label="Visibilité" value={o.privacy} disabled={busy} onChange={v => set({ privacy: v })} options={YT_PRIVACY} />
      <Choice label="Catégorie" value={o.category} disabled={busy} onChange={v => set({ category: v })} options={YT_CATEGORIES} />
      <OwnText label="Description YouTube" value={o.description} common={common.caption} onChange={v => set({ description: v })} busy={busy} max={5000} />
      <Field label="Mots-clés" value={o.tags} editable={!busy} onChangeText={v => set({ tags: v })} placeholder="piano, debussy, partition" hint="Séparés par des virgules." autoCapitalize="none" />
      <Choice label="Conçue pour les enfants ? (obligatoire)" value={o.kids} disabled={busy} onChange={v => set({ kids: v })} options={[['yes', 'Oui'], ['no', 'Non']]} />
      <Check label="Contenu modifié ou synthétique réaliste" hint="Une personne, un lieu ou un événement réaliste créé ou modifié (IA comprise)." checked={o.synthetic} disabled={busy} onChange={v => set({ synthetic: v })} />
      <Check label="Prévenir les abonnés" checked={o.notify} disabled={busy} onChange={v => set({ notify: v })} />
      <Txt small bold>Miniature</Txt>
      <Txt size={12} muted>YouTube choisit lui-même l’image des Shorts : l’API ne permet pas de la choisir.</Txt>
    </View>
  )
}

export function InstaPanel({ o, busy, set, media, common, image }: { o: InstaOpts; busy: boolean; set: (p: Partial<InstaOpts>) => void
  media?: Media; common: Common; image: { uri: string | null; pick: () => void; remove: () => void; fromDrive?: boolean } }) {
  const { c } = useTheme()
  return (
    <View style={{ gap: space.sm }}>
      <OwnText label="Légende Instagram" value={o.text} common={common.caption} onChange={v => set({ text: v })} busy={busy} max={2200} />
      <Field label="Collaborateurs (facultatif)" value={o.collaborators} editable={!busy} onChangeText={v => set({ collaborators: v })}
        placeholder="@pseudo1, @pseudo2" autoCapitalize="none" autoCorrect={false} hint="3 pseudos au plus : ils reçoivent une invitation de collaboration." />
      <Check label="Afficher aussi le Reel dans le fil" checked={o.feed} disabled={busy} onChange={v => set({ feed: v })} />
      <Thumb media={image.uri ? undefined : media} value={o.coverMs} onChange={v => set({ coverMs: v })} busy={busy}
        note={image.uri ? 'Image envoyée à part : c’est elle qui sert de couverture.'
          : `Une image de la vidéo, ou une autre image ci-dessous.${image.fromDrive ? ' Image trouvée à côté de la vidéo dans le Drive : utilisée si vous ne choisissez rien.' : ''}`}>
        <Row gap={space.md} style={{ alignItems: 'center' }}>
          {image.uri ? <Image source={{ uri: image.uri }} style={{ width: 54, height: 96, borderRadius: 8 }} contentFit="cover" accessibilityLabel="Image de couverture choisie" />
            : <View style={{ width: 54, height: 96, borderRadius: 8, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}><Icon name="upload" size={18} color={c.faint} /></View>}
          <View style={{ flex: 1, gap: 6 }}>
            <Button small title={image.uri ? 'Changer l’image' : 'Choisir une autre image'} disabled={busy} onPress={image.pick} style={{ alignSelf: 'flex-start' }} />
            {image.uri ? <Button small kind="ghost" title="Retirer" disabled={busy} onPress={image.remove} style={{ alignSelf: 'flex-start' }} /> : null}
            <Txt size={12} muted>JPEG ou PNG, 8 Mo au plus. Même image pour tous les comptes Instagram de la publication.</Txt>
          </View>
        </Row>
      </Thumb>
    </View>
  )
}
