import { ReactNode } from 'react'
import { Btn, InfoBox } from '../ui'

// État d'erreur présentationnel + bouton « Réessayer », factorisé du pattern
// dupliqué dans BotList/Analytics/Inbox (InfoBox tone="danger" titré + Btn
// soft). Volontairement « bête » : pas de fetch, l'appelant fournit le message
// et la relance (typiquement `reload` de useApiResource). Le titre est
// surchargeable mais reste « Impossible de charger vos chatbots » par défaut,
// libellé déjà utilisé par ces pages.
export function ErrorRetry({
  message,
  onRetry,
  title = 'Impossible de charger vos chatbots',
}: {
  message: ReactNode
  onRetry: () => void
  title?: ReactNode
}) {
  return (
    <>
      <InfoBox tone="danger" title={title}>{message}</InfoBox>
      <div><Btn kind="soft" onClick={onRetry}>Réessayer</Btn></div>
    </>
  )
}

export default ErrorRetry
