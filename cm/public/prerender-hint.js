// Pages pré-rendues (scripts/prerender.mjs), avant React : l'apparence gardée sur ce navigateur (comme
// palette.ts) et, sur l'accueil, la landing pré-rendue cachée si une session est connue (l'app s'affiche
// ensuite, comme avant le pré-rendu). Fichier externe : la CSP n'autorise pas les scripts en ligne.
(function () {
  var root = document.documentElement
  try {
    var a = JSON.parse(localStorage.getItem('cm.appearance') || 'null') || {}
    var p = a.palette || localStorage.getItem('cm.palette')
    if (p === 'ocean' || p === 'forest') root.setAttribute('data-palette', p)
    if (a.theme === 'light' || a.theme === 'dark') root.setAttribute('data-theme', a.theme)
    if (localStorage.getItem('cm.session') === '1') root.classList.add('cm-session')
  } catch (e) { /* stockage indisponible */ }
})()
