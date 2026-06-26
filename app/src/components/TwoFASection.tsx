// Section « Authentification à deux facteurs » de la page Profil.
// Gère l'enrôlement TOTP (authenticator, via QR), les passkeys (WebAuthn) et la
// régénération des codes de secours. Obligatoire pour le staff (bandeau si non
// configurée) ; recommandée pour les autres.
import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { KeyRound, Shield, ShieldCheck, Smartphone, Trash2 } from 'lucide-react'
import { useAuth } from '../AuthContext'
import { Btn, Card, Chip, InfoBox } from '../ui'
import { errMsg } from '../utils/errors'
import {
  addPasskey, deletePasskey, getStatus, passkeysSupported,
  regenerateRecovery, totpDisable, totpEnable, totpSetup, type TwoFAStatus,
} from '../utils/twofa'

// Bloc d'affichage (unique) des codes de secours fraîchement générés.
function RecoveryCodes({ codes }: { codes: string[] }) {
  return (
    <InfoBox tone="warn" title="Codes de secours — copiez-les maintenant">
      <div style={{ fontSize: 11.5, marginBottom: 8 }}>
        Chaque code ne fonctionne qu'une fois. Conservez-les hors ligne : ils permettent
        de vous connecter si vous perdez votre téléphone.
      </div>
      <div className="mono" style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 6,
        fontSize: 13, fontWeight: 700, color: 'var(--ink)',
      }}>
        {codes.map(c => <span key={c}>{c}</span>)}
      </div>
    </InfoBox>
  )
}

export default function TwoFASection() {
  const { user, refreshUser } = useAuth()
  const [status, setStatus] = useState<TwoFAStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Enrôlement TOTP en cours : secret + QR + code saisi.
  const [enroll, setEnroll] = useState<{ secret: string; qr: string } | null>(null)
  const [code, setCode] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  // Saisie de code pour désactiver / régénérer.
  const [manageCode, setManageCode] = useState('')
  const [mode, setMode] = useState<'' | 'disable' | 'regen'>('')

  const reload = useCallback(async () => {
    try { setStatus(await getStatus()) }
    catch (err: unknown) { setError(errMsg(err, 'Chargement 2FA impossible.')) }
  }, [])

  useEffect(() => { reload() }, [reload])

  async function run(fn: () => Promise<void>, fallback: string) {
    setError(''); setBusy(true)
    try { await fn() } catch (err: unknown) { setError(errMsg(err, fallback)) }
    finally { setBusy(false) }
  }

  // --- TOTP ---
  async function startTotp() {
    await run(async () => {
      const { secret, otpauth_uri } = await totpSetup()
      const qr = await QRCode.toDataURL(otpauth_uri, { margin: 1, width: 200 })
      setEnroll({ secret, qr }); setCode(''); setRecoveryCodes(null)
    }, 'Impossible de démarrer la configuration.')
  }
  async function confirmTotp() {
    await run(async () => {
      const { recovery_codes } = await totpEnable(code)
      setEnroll(null); setCode(''); setRecoveryCodes(recovery_codes)
      await reload(); await refreshUser()
    }, 'Code invalide.')
  }
  async function disableTotp() {
    await run(async () => {
      await totpDisable(manageCode)
      setMode(''); setManageCode(''); setRecoveryCodes(null)
      await reload(); await refreshUser()
    }, 'Code invalide.')
  }
  async function regen() {
    await run(async () => {
      const { recovery_codes } = await regenerateRecovery(manageCode)
      setMode(''); setManageCode(''); setRecoveryCodes(recovery_codes)
      await reload()
    }, 'Code TOTP invalide.')
  }

  // --- Passkeys ---
  async function onAddPasskey() {
    await run(async () => {
      const name = (window.prompt('Nom de cette passkey (ex. « iPhone », « YubiKey ») :', 'Ma passkey') || '').trim()
      if (!name) return
      await addPasskey(name)
      await reload(); await refreshUser()
    }, "Échec de l'ajout de la passkey.")
  }
  async function onDeletePasskey(id: number, name: string) {
    if (!window.confirm(`Supprimer la passkey « ${name} » ?`)) return
    await run(async () => { await deletePasskey(id); await reload(); await refreshUser() },
      'Suppression impossible.')
  }

  if (!user) return null
  const required = status?.required ?? user.twofa_required
  const enabled = status?.enabled ?? user.twofa_enabled
  const canPasskey = passkeysSupported()

  return (
    <Card>
      <div className="row" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
        <div className="card-title" style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Shield size={16} /> Authentification à deux facteurs
        </div>
        {enabled
          ? <Chip tone="go"><ShieldCheck size={12} /> Activée</Chip>
          : <Chip tone={required ? 'danger' : 'mut'}>{required ? 'Requise' : 'Inactive'}</Chip>}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--mut)', lineHeight: 1.55, marginBottom: 14 }}>
        Ajoutez une seconde vérification à la connexion : application d'authentification (TOTP)
        et/ou passkey (Face&nbsp;ID, empreinte, clé physique).
      </div>

      {required && !enabled && (
        <InfoBox tone="danger" title="2FA obligatoire pour le staff">
          Votre compte a accès à l'administration : configurez au moins un second facteur
          ci-dessous pour continuer à y accéder.
        </InfoBox>
      )}

      {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
      {recoveryCodes && <div style={{ marginTop: 12 }}><RecoveryCodes codes={recoveryCodes} /></div>}

      {/* ---- TOTP ---- */}
      <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
        <div className="row" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div className="row g8" style={{ alignItems: 'center' }}>
            <Smartphone size={15} style={{ color: 'var(--mut)' }} />
            <span style={{ fontSize: 13, fontWeight: 700 }}>Application d'authentification</span>
            {status?.totp_enabled && <Chip tone="go">Activée</Chip>}
          </div>
          {status && !status.totp_enabled && !enroll && (
            <Btn small kind="primary" onClick={startTotp} disabled={busy}>Configurer</Btn>
          )}
          {status?.totp_enabled && mode !== 'disable' && (
            <Btn small kind="ghost" onClick={() => { setMode('disable'); setManageCode('') }} disabled={busy}>
              Désactiver
            </Btn>
          )}
        </div>

        {/* Enrôlement : QR + secret + code */}
        {enroll && (
          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 16, alignItems: 'start' }}>
            <img src={enroll.qr} alt="QR code TOTP" width={160} height={160}
                 style={{ border: '1px solid var(--border)', borderRadius: 10, background: '#fff' }} />
            <div className="col g8" style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, color: 'var(--mut)', lineHeight: 1.5 }}>
                Scannez ce QR avec Google Authenticator, Authy, 1Password… ou saisissez la clé :
              </div>
              <code className="mono" style={{ fontSize: 12, wordBreak: 'break-all', background: 'var(--surface2)',
                     padding: '6px 9px', borderRadius: 8, border: '1px solid var(--border)' }}>{enroll.secret}</code>
              <div className="row g8">
                <input type="text" inputMode="numeric" placeholder="Code à 6 chiffres" value={code}
                       onChange={e => setCode(e.target.value)} style={{ flex: 1, maxWidth: 180 }}
                       onKeyDown={e => e.key === 'Enter' && code.trim() && confirmTotp()} />
                <Btn small kind="primary" onClick={confirmTotp} disabled={busy || !code.trim()}>Activer</Btn>
                <Btn small kind="ghost" onClick={() => setEnroll(null)} disabled={busy}>Annuler</Btn>
              </div>
            </div>
          </div>
        )}

        {/* Désactivation : confirmation par code */}
        {mode === 'disable' && (
          <div className="row g8" style={{ marginTop: 12, flexWrap: 'wrap' }}>
            <input type="text" inputMode="numeric" placeholder="Code TOTP ou de secours" value={manageCode}
                   onChange={e => setManageCode(e.target.value)} style={{ flex: 1, maxWidth: 220 }} />
            <Btn small kind="danger" onClick={disableTotp} disabled={busy || !manageCode.trim()}>Confirmer</Btn>
            <Btn small kind="ghost" onClick={() => setMode('')} disabled={busy}>Annuler</Btn>
          </div>
        )}

        {/* Codes de secours (TOTP actif) */}
        {status?.totp_enabled && (
          <div className="row" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
            <span style={{ fontSize: 12, color: 'var(--mut)' }}>
              Codes de secours restants : <strong>{status.recovery_remaining}</strong>
            </span>
            {mode === 'regen' ? (
              <div className="row g8" style={{ flexWrap: 'wrap' }}>
                <input type="text" inputMode="numeric" placeholder="Code TOTP" value={manageCode}
                       onChange={e => setManageCode(e.target.value)} style={{ width: 150 }} />
                <Btn small kind="primary" onClick={regen} disabled={busy || !manageCode.trim()}>Régénérer</Btn>
                <Btn small kind="ghost" onClick={() => setMode('')} disabled={busy}>Annuler</Btn>
              </div>
            ) : (
              <Btn small kind="ghost" onClick={() => { setMode('regen'); setManageCode('') }} disabled={busy}>
                Régénérer les codes
              </Btn>
            )}
          </div>
        )}
      </div>

      {/* ---- Passkeys ---- */}
      <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
        <div className="row" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div className="row g8" style={{ alignItems: 'center' }}>
            <KeyRound size={15} style={{ color: 'var(--mut)' }} />
            <span style={{ fontSize: 13, fontWeight: 700 }}>Passkeys</span>
          </div>
          {canPasskey && (
            <Btn small kind="soft" onClick={onAddPasskey} disabled={busy}>+ Ajouter une passkey</Btn>
          )}
        </div>
        {!canPasskey && (
          <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 8 }}>
            Ce navigateur ne supporte pas les passkeys.
          </div>
        )}
        {status && status.passkeys.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 8 }}>Aucune passkey enregistrée.</div>
        ) : (
          <div className="col g8" style={{ marginTop: 10 }}>
            {status?.passkeys.map(pk => (
              <div key={pk.id} className="row" style={{ justifyContent: 'space-between', gap: 10,
                   padding: '8px 11px', border: '1px solid var(--border)', borderRadius: 10 }}>
                <div className="row g8" style={{ alignItems: 'center', minWidth: 0 }}>
                  <KeyRound size={14} style={{ color: 'var(--acc)', flexShrink: 0 }} />
                  <span style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {pk.name}
                  </span>
                </div>
                <button onClick={() => onDeletePasskey(pk.id, pk.name)} disabled={busy} aria-label="Supprimer"
                        style={{ border: 'none', background: 'none', color: 'var(--faint)', cursor: 'pointer', padding: 4 }}>
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}
