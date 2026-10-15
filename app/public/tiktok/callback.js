// Redirect OAuth TikTok (Chapote Publisher) : lit code/state/error dans l'URL et
// les affiche. Aucune requête réseau : le code ne quitte jamais le navigateur.
(function () {
  function show(id) { document.getElementById(id).hidden = false }
  function run() {
    var p = new URLSearchParams(window.location.search)
    var code = p.get('code')
    var state = p.get('state')
    var error = p.get('error')

    if (code) {
      document.getElementById('code').value = code
      if (state) {
        document.getElementById('state').value = state
        show('state-block')
      }
      document.getElementById('copy').addEventListener('click', function () {
        var input = document.getElementById('code')
        var done = function () { document.getElementById('copied').textContent = 'Code copié.' }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(code).then(done, function () {
            input.select(); document.execCommand('copy'); done()
          })
        } else {
          input.select(); document.execCommand('copy'); done()
        }
      })
      show('ok')
    } else if (error) {
      document.getElementById('err-code').textContent = error
      document.getElementById('err-desc').textContent = p.get('error_description') || ''
      show('err')
    } else {
      show('none')
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run)
  else run()
})()
