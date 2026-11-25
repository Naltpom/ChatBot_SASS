// « Donner mon avis » : trois questions courtes, toutes facultatives. Les réponses arrivent dans les retours
// de l'app (liste réservée à l'administration). Rien d'autre n'est envoyé que ce que la personne écrit.
import { useState, type FormEvent } from 'react'
import { sendFeedback } from '../api'
import { Msg, Sheet } from './ui'

const QUESTIONS: [string, string, string][] = [
  ['how', 'Comment publiez-vous vos vidéos aujourd’hui ?', 'Ex. 4 comptes, je publie le soir depuis mon téléphone…'],
  ['block', 'Qu’est-ce qui vous a bloqué ou agacé dans Chapote CM ?', 'Un écran, une étape, un mot pas clair…'],
  ['miss', 'Que manque-t-il pour que vous l’utilisiez tous les jours ?', ''],
]

export default function FeedbackSheet({ onClose }: { onClose: () => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  const [err, setErr] = useState('')
  const empty = QUESTIONS.every(([k]) => !(answers[k] || '').trim())

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('')
    if (empty) { setErr('Répondez à au moins une question.'); return }
    const text = QUESTIONS.filter(([k]) => (answers[k] || '').trim()).map(([k, q]) => `${q}\n${answers[k].trim()}`).join('\n\n').slice(0, 2000)
    setState('busy')
    try { await sendFeedback(text); setState('done') }
    catch { setErr('L’envoi n’a pas marché. Réessayez dans un instant.'); setState('idle') }
  }

  return (
    <Sheet title="Donner mon avis" onClose={onClose} labelledBy="feedback-title">
      {state === 'done' ? (
        <div className="col" style={{ gap: 14 }}>
          <Msg kind="ok">Merci ! Votre avis est bien arrivé. C’est ce qui décide de la suite de Chapote CM.</Msg>
          <button type="button" className="btn btn-primary btn-block" onClick={onClose}>Fermer</button>
        </div>
      ) : (
        <form className="col" style={{ gap: 14 }} onSubmit={submit}>
          <p className="muted small">Trois questions, toutes facultatives. Vos réponses sont lues une par une.</p>
          {QUESTIONS.map(([k, q, ph]) => (
            <label key={k} className="field" htmlFor={`fb-${k}`}>{q}
              <textarea id={`fb-${k}`} className="input" rows={3} maxLength={600} placeholder={ph}
                        value={answers[k] || ''} onChange={e => setAnswers(a => ({ ...a, [k]: e.target.value }))} />
            </label>
          ))}
          {err && <Msg kind="err">{err}</Msg>}
          <button className="btn btn-primary btn-block" disabled={state === 'busy'}>{state === 'busy' ? 'Envoi…' : 'Envoyer mon avis'}</button>
        </form>
      )}
    </Sheet>
  )
}
