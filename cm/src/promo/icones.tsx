// Icônes de l'espace /promo (trait 1.8, 20 px, couleur du texte). Pas de bibliothèque.
const P: Record<string, string> = {
  vue: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  calendrier: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  publications: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  labo: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3M7.5 14h9',
  bilan: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  blog: 'M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2zM4 21V5M8 7h6',
  regles: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2',
  ecrans: 'M7 2h10v20H7zM11 18h2',
  menu: 'M4 6h16M4 12h16M4 18h16',
  fermer: 'M6 6l12 12M18 6L6 18',
  retour: 'M15 18l-6-6 6-6',
  sortie: 'M10 14L21 3M21 3h-6M21 3v6M19 14v6H4V5h6',
  actions: 'M9 11l3 3 8-8M20 12v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h11',
  gauche: 'M15 18l-6-6 6-6', droite: 'M9 6l6 6-6 6',
}

export function Icone({ n, taille = 18 }: { n: keyof typeof P | string; taille?: number }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={P[n] ?? ''} />
    </svg>
  )
}
