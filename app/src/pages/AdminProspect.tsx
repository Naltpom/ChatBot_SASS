// Vue ADMIN — Détail d'un prospect : données SIRENE complètes + scraping poussé
// du site, brouillon d'email IA éditable, envoi manuel, suppression (RGPD).
import { useCallback, useEffect, useState } from 'react'
import { Globe, Mail, Phone, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { Btn, Card, Chip, Field, InfoBox, Stat } from '../ui'
import { errMsg } from '../utils/errors'
import { Enrichment, Prospect, prospectStatusChip } from './AdminProspecting'

const SOCIAL_LABEL: Record<string, string> = {
  linkedin: 'LinkedIn', facebook: 'Facebook', instagram: 'Instagram',
  twitter: 'X/Twitter', youtube: 'YouTube', tiktok: 'TikTok',
}

// Bloc d'affichage de tout l'enrichissement (contacts site + données légales).
function EnrichmentView({ enr, onPickEmail }: { enr: Enrichment | null; onPickEmail: (e: string) => void }) {
  const web = enr?.web
  const sirene = enr?.sirene
  if (!web && !sirene) return null
  const finances = sirene?.finances ? Object.entries(sirene.finances).sort().reverse() : []
  return (
    <div className="col g10">
      {web && (
        <Card>
          <div className="card-title">Contacts du site {web.cms && <Chip tone="mut">{web.cms}</Chip>}</div>
          {web.note && <div className="muted" style={{ fontSize: 12.5 }}>{web.note}</div>}
          {!!web.emails?.length && (
            <div style={{ marginTop: 8 }}>
              <div className="field-label">Emails ({web.emails.length})</div>
              <div className="row g6" style={{ flexWrap: 'wrap' }}>
                {web.emails.map(e => (
                  <button key={e.value} className="chip chip-acc" title={`Définir comme destinataire — trouvé sur ${e.page}`}
                          style={{ cursor: 'pointer', border: 'none' }} onClick={() => onPickEmail(e.value)}>
                    <Mail size={11} style={{ marginRight: 4, verticalAlign: -1 }} />{e.value}
                  </button>
                ))}
              </div>
            </div>
          )}
          {!!web.phones?.length && (
            <div style={{ marginTop: 8 }}>
              <div className="field-label">Téléphones</div>
              <div className="row g6" style={{ flexWrap: 'wrap' }}>
                {web.phones.map(p => <Chip key={p} tone="mut"><Phone size={11} style={{ marginRight: 4, verticalAlign: -1 }} />{p}</Chip>)}
              </div>
            </div>
          )}
          {web.socials && Object.keys(web.socials).length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="field-label">Réseaux sociaux</div>
              <div className="row g6" style={{ flexWrap: 'wrap' }}>
                {Object.entries(web.socials).map(([k, url]) => (
                  <a key={k} href={url} target="_blank" rel="noreferrer noopener" className="chip chip-go" style={{ textDecoration: 'none' }}>
                    {SOCIAL_LABEL[k] || k}
                  </a>
                ))}
              </div>
            </div>
          )}
          {!!web.tech?.length && (
            <div style={{ marginTop: 8 }}>
              <div className="field-label">Techno détectée</div>
              <div className="row g6" style={{ flexWrap: 'wrap' }}>
                {web.tech.map(t => <Chip key={t} tone="mut">{t}</Chip>)}
              </div>
            </div>
          )}
          {!!web.pages_crawled?.length && (
            <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
              {web.pages_crawled.length} page(s) analysée(s).
            </div>
          )}
        </Card>
      )}
      {sirene && (
        <Card>
          <div className="card-title">Données légales (SIRENE)</div>
          <div className="row g16" style={{ flexWrap: 'wrap', fontSize: 13 }}>
            {sirene.forme_juridique && <span><strong>Forme :</strong> {sirene.forme_juridique}</span>}
            {sirene.date_creation && <span><strong>Création :</strong> {sirene.date_creation}</span>}
            {sirene.tranche_effectif && <span><strong>Effectif :</strong> {sirene.tranche_effectif}</span>}
            {sirene.etat_administratif && <span><strong>État :</strong> {sirene.etat_administratif === 'A' ? 'Actif' : sirene.etat_administratif}</span>}
            {sirene.adresse && <span><strong>Adresse :</strong> {sirene.adresse}</span>}
          </div>
          {!!sirene.dirigeants?.length && (
            <div style={{ marginTop: 10 }}>
              <div className="field-label">Dirigeants</div>
              <div className="row g6" style={{ flexWrap: 'wrap' }}>
                {sirene.dirigeants.map((d, i) => (
                  <Chip key={i} tone="acc">{d.nom}{d.qualite ? ` — ${d.qualite}` : ''}</Chip>
                ))}
              </div>
            </div>
          )}
          {finances.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div className="field-label">Finances</div>
              <div className="row g10" style={{ flexWrap: 'wrap', fontSize: 12.5, color: 'var(--mut)' }}>
                {finances.slice(0, 3).map(([year, f]) => (
                  <span key={year}>{year} : CA {f.ca != null ? f.ca.toLocaleString('fr-FR') + ' €' : '—'}
                    {f.resultat_net != null ? `, résultat ${f.resultat_net.toLocaleString('fr-FR')} €` : ''}</span>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

export default function AdminProspect() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [p, setP] = useState<Prospect | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  // Champs éditables (synchronisés au chargement / après chaque action).
  const [website, setWebsite] = useState('')
  const [email, setEmail] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')

  const sync = useCallback((data: Prospect) => {
    setP(data)
    setWebsite(data.website || '')
    setEmail(data.contact_email || '')
    setSubject(data.email_subject || '')
    setBody(data.email_body || '')
  }, [])

  const load = useCallback(() => {
    api<Prospect[]>('/api/admin/prospecting/prospects')
      .then(list => {
        const found = list.find(x => x.id === Number(id))
        if (found) sync(found)
        else setError('Prospect introuvable.')
      })
      .catch((err: unknown) => setError(`Chargement impossible : ${errMsg(err)}`))
  }, [id, sync])
  useEffect(() => { load() }, [load])

  async function run(label: string, fn: () => Promise<Prospect>) {
    setError(''); setBusy(label)
    try { sync(await fn()) }
    catch (err: unknown) { setError(errMsg(err)) }
    finally { setBusy('') }
  }

  const enrich = () => run('enrich', () =>
    api<Prospect>(`/api/admin/prospecting/prospects/${id}/enrich`, { method: 'POST' }))

  const saveEdits = () => run('save', () =>
    api<Prospect>(`/api/admin/prospecting/prospects/${id}`, {
      method: 'PATCH',
      body: { website, contact_email: email, email_subject: subject, email_body: body },
    }))

  const generate = () => run('draft', async () => {
    // Persiste d'abord les éventuelles éditions (site/email) pour un meilleur contexte.
    await api<Prospect>(`/api/admin/prospecting/prospects/${id}`, {
      method: 'PATCH', body: { website, contact_email: email },
    })
    return api<Prospect>(`/api/admin/prospecting/prospects/${id}/draft`, { method: 'POST' })
  })

  const send = () => run('send', async () => {
    await api<Prospect>(`/api/admin/prospecting/prospects/${id}`, {
      method: 'PATCH', body: { contact_email: email, email_subject: subject, email_body: body },
    })
    return api<Prospect>(`/api/admin/prospecting/prospects/${id}/send`, { method: 'POST' })
  })

  async function remove() {
    if (!confirm('Supprimer définitivement ce prospect ?')) return
    setBusy('delete')
    try {
      await api(`/api/admin/prospecting/prospects/${id}`, { method: 'DELETE' })
      navigate('/admin/prospecting')
    } catch (err: unknown) {
      setError(errMsg(err)); setBusy('')
    }
  }

  if (!p) return <div className="center-page">{error || 'Chargement…'}</div>

  return (
    <div className="col g18">
      <div>
        <button className="back-link" onClick={() => navigate('/admin/prospecting')}>← Tous les prospects</button>
        <div className="bot-head">
          <div style={{ flex: 1, minWidth: 200 }}>
            <div className="bot-head-title">{p.company_name} {prospectStatusChip(p.status)}</div>
            <div style={{ fontSize: 12, color: 'var(--mut)', marginTop: 2 }}>
              {[p.sector_label, [p.postal_code, p.city].filter(Boolean).join(' '), p.contact_name].filter(Boolean).join(' · ') || '—'}
            </div>
          </div>
          <div className="row g8">
            <Btn kind="danger" small onClick={remove} disabled={busy === 'delete'}>
              <span className="row g6"><Trash2 size={13} />Supprimer</span>
            </Btn>
          </div>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="stat-row">
        <Stat label="SIREN" value={p.siren || '—'} />
        <Stat label="Site web" value={p.website ? 'Trouvé' : '—'} icon={<Globe size={15} />} />
        <Stat label="Chatbot existant" value={p.has_existing_chatbot == null ? '?' : p.has_existing_chatbot ? 'Oui' : 'Non'} />
        <Stat label="Statut" value={prospectStatusChip(p.status)} />
      </div>

      {/* Étape 1 : enrichissement */}
      <Card>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div className="card-title" style={{ marginBottom: 2 }}>1. Analyser le site</div>
            <div className="muted" style={{ fontSize: 12.5 }}>Cherche le site, un email de contact et un éventuel chatbot.</div>
          </div>
          <Btn kind="soft" onClick={enrich} disabled={busy === 'enrich'}>
            <span className="row g6"><Sparkles size={15} />{busy === 'enrich' ? 'Analyse…' : 'Analyser'}</span>
          </Btn>
        </div>
        {p.site_summary && (
          <div className="muted" style={{ fontSize: 12.5, marginTop: 10, lineHeight: 1.5 }}>
            « {p.site_summary.slice(0, 280)}… »
          </div>
        )}
        <div className="row g10" style={{ flexWrap: 'wrap', marginTop: 12 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <Field label="Site web"><input type="text" value={website} placeholder="https://…"
              onChange={e => setWebsite(e.target.value)} style={{ width: '100%' }} /></Field>
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <Field label="Email du contact"><input type="email" value={email} placeholder="contact@entreprise.fr"
              onChange={e => setEmail(e.target.value)} style={{ width: '100%' }} /></Field>
          </div>
        </div>
      </Card>

      {/* Tout l'enrichissement (contacts site + données légales) */}
      <EnrichmentView enr={p.enrichment} onPickEmail={setEmail} />

      {/* Étape 2 : brouillon IA */}
      <Card>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div className="card-title" style={{ marginBottom: 2 }}>2. Rédiger l'email</div>
            <div className="muted" style={{ fontSize: 12.5 }}>L'IA propose un email personnalisé que vous pouvez modifier.</div>
          </div>
          <Btn kind="soft" onClick={generate} disabled={busy === 'draft'}>
            <span className="row g6"><Wand2 size={15} />{busy === 'draft' ? 'Rédaction…' : (subject ? 'Régénérer' : 'Générer le brouillon')}</span>
          </Btn>
        </div>
        <div className="col g10" style={{ marginTop: 12 }}>
          <Field label="Objet"><input type="text" value={subject} placeholder="(généré par l'IA)"
            onChange={e => setSubject(e.target.value)} style={{ width: '100%' }} /></Field>
          <Field label="Corps du message"><textarea value={body} rows={12} placeholder="(généré par l'IA)"
            onChange={e => setBody(e.target.value)} style={{ width: '100%' }} /></Field>
          <div className="row g8">
            <Btn kind="ghost" small onClick={saveEdits} disabled={busy === 'save'}>{busy === 'save' ? 'Enregistrement…' : 'Enregistrer les modifications'}</Btn>
          </div>
        </div>
      </Card>

      {/* Étape 3 : envoi */}
      <Card>
        <div className="card-title">3. Envoyer</div>
        {p.status === 'sent'
          ? <InfoBox tone="go" title="Email envoyé">
              Envoyé à {p.contact_email}{p.sent_at ? ` le ${new Date(p.sent_at).toLocaleString('fr-FR')}` : ''}.
            </InfoBox>
          : <>
              <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
                L'email part vers <strong>{email || '(aucun destinataire)'}</strong> depuis l'adresse SMTP configurée.
              </div>
              <Btn onClick={send} disabled={busy === 'send' || !email || !subject || !body}>
                {busy === 'send' ? 'Envoi…' : 'Envoyer l\'email'}
              </Btn>
            </>}
      </Card>
    </div>
  )
}
