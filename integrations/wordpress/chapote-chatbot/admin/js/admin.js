/**
 * Chapote Chatbot — SPA admin en vanilla JS (aucune étape de build).
 *
 * Le navigateur ne parle JAMAIS à Chapote directement : il appelle le proxy
 * REST WordPress (CHAPOTE_BO.restBase) avec le nonce wp_rest. Le token reste
 * côté serveur, chiffré. Tout le HTML est construit via createElement (textNode)
 * pour neutraliser toute injection.
 */
(function () {
  'use strict';

  var CFG = window.CHAPOTE_BO || {};
  var C = window.CBOCore || {};

  // Primitives partagées (cf. cbo-core.js). Aliasées localement pour garder le
  // corps du back-office IDENTIQUE : mêmes noms, mêmes signatures. Le wizard
  // d'onboarding (onboarding.js) consomme les mêmes via window.CBOCore.
  var h = C.h, clear = C.clear;
  var fieldFor = C.fieldFor, fieldGroup = C.fieldGroup, loadingNote = C.loadingNote, syncSwitch = C.syncSwitch;
  var euros = C.euros, apiMsg = C.apiMsg, call = C.call;
  var renderPreview = C.renderPreview;

  // Repli ultime du prix BYOK (en centimes) si le catalogue live n'expose ni
  // module 'ai'.byok_price_cents ni catalog.ai_byok_price_cents. En pratique le
  // catalogue live fournit toujours la valeur ; ce défaut n'est qu'un garde-fou.
  var DEFAULT_BYOK_PRICE_CENTS = 2900;

  /* ------------------------------------------------------------------ utils */

  // --- Restauration de focus après un re-render intégral (clear(root)) -------
  // render() reconstruit tout le DOM : sans cela, le focus clavier retombe sur
  // <body> à chaque action. On marque les contrôles « logiques » (onglets de nav
  // et sous-onglets du bot) d'un data-focuskey stable ; render() relève la clé du
  // contrôle focalisé AVANT le clear et la restaure APRÈS reconstruction.
  function currentFocusKey() {
    var a = document.activeElement;
    return (a && a.getAttribute) ? a.getAttribute('data-focuskey') : null;
  }
  function restoreFocus(key) {
    if (!key || !root) return;
    var el = root.querySelector('[data-focuskey="' + key.replace(/"/g, '') + '"]');
    if (el && typeof el.focus === 'function') el.focus();
  }
  // Navigation clavier d'une tablist (flèches + Home/End) : déplace le focus puis
  // active l'onglet (activation automatique) ; le re-render restaure le focus sur
  // le nouvel onglet via son data-focuskey.
  function wireTablistKeys(tablist) {
    tablist.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k !== 'ArrowRight' && k !== 'ArrowLeft' && k !== 'Home' && k !== 'End') return;
      var tabs = Array.prototype.slice.call(tablist.querySelectorAll('[role="tab"]'));
      var idx = tabs.indexOf(document.activeElement);
      if (idx === -1) return;
      var next = idx;
      if (k === 'ArrowRight') next = (idx + 1) % tabs.length;
      else if (k === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
      else if (k === 'Home') next = 0;
      else if (k === 'End') next = tabs.length - 1;
      e.preventDefault();
      tabs[next].focus();  // active element = nouvel onglet AVANT le render
      tabs[next].click();  // change d'onglet + re-render (focus restauré sur lui)
    });
  }

  // euros : déplacé dans cbo-core.js (aliasé en tête de fichier).

  // Note TVA statique (le catalogue LIVE ne porte pas de tax_note racine).
  var TAX_NOTE = 'TVA non applicable, art. 293 B du CGI';

  // URL du dashboard Chapote (app) : on s'appuie UNIQUEMENT sur app_base, jamais
  // sur api_base (l'hôte API ne sert pas le dashboard et renverrait une page
  // d'erreur). Si app_base n'est pas configuré, on renvoie null et l'appelant
  // affiche une note explicative au lieu d'un lien cassé (#UX-4).
  function appDashboardUrl() {
    return (typeof CFG.appBase === 'string' && CFG.appBase) ? (CFG.appBase + '/app') : null;
  }

  // apiMsg / call : déplacés dans cbo-core.js. La réaction « session morte (401) »
  // y est déléguée au hook CBOCore.onAuthLost, posé juste après l'état ci-dessous.

  /* ------------------------------------------------------------------ state */

  var state = {
    connected: false,
    account: null,     // { email, name } du compte Chapote connecté
    bots: [],
    view: 'connect',   // connect | bots | bot | seo | onboarding
    botId: null,
    botTab: 'activation',
    onb: null,         // sous-état du wizard d'onboarding (géré par onboarding.js)
    notice: null
  };

  // setNotice ne reconstruit PAS le corps (sinon un formulaire en cours d'édition
  // perdrait ses valeurs) : il ne repeint que la barre de notices.
  function setNotice(msg, type) { state.notice = msg ? { msg: msg, type: type || 'info' } : null; paintNotice(); }
  function paintNotice() {
    if (!noticeHost) return;
    clear(noticeHost);
    if (state.notice) {
      // Erreur/avertissement = role=alert (annonce assertive) ; autres = laissé à
      // la région live polie du noticeHost.
      var assertive = state.notice.type === 'warn';
      noticeHost.appendChild(h('div', { class: 'cbo-notice cbo-notice-' + state.notice.type, role: assertive ? 'alert' : null },
        h('span', { text: state.notice.msg }),
        h('button', { type: 'button', class: 'cbo-notice-x', 'aria-label': 'Fermer', onClick: function () { setNotice(null); } }, '×')
      ));
    }
  }

  // Session morte (401) détectée par CBOCore.call : on bascule en « déconnecté ».
  // Pendant l'onboarding on RESTE sur la vue wizard (son écran d'auth reprend la
  // main) plutôt que sur l'écran de connexion du back-office.
  C.onAuthLost = function () {
    if (!state.connected) return;
    state.connected = false;
    if (state.view !== 'onboarding') state.view = 'connect';
    render();
    setNotice('Session expirée. Reconnectez-vous.', 'warn');
  };

  /* ------------------------------------------------------------------- shell */

  var root = document.getElementById('chapote-bo-app');
  var noticeHost = null;

  function render() {
    if (!root) return;
    var fk = currentFocusKey();   // relève le focus logique AVANT le clear (point 5)
    clear(root);
    noticeHost = h('div', { class: 'cbo-notice-host', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    root.appendChild(noticeHost);
    paintNotice();
    root.appendChild(renderNav());
    var body = h('div', { class: 'cbo-body' });
    root.appendChild(body);
    // Wizard d'onboarding : il gère lui-même l'écran de connexion (étape auth),
    // donc il passe AVANT le test `connected` (premier lancement = non connecté).
    if (state.view === 'onboarding' && window.CBOOnboarding) body.appendChild(CBOOnboarding.view());
    else if (!state.connected) body.appendChild(renderConnect());
    else if (state.view === 'bot') body.appendChild(renderBot());
    else if (state.view === 'seo') body.appendChild(renderSeo());
    else body.appendChild(renderBots());
    restoreFocus(fk);             // restaure le focus sur le contrôle équivalent reconstruit
  }

  function renderNav() {
    var nav = h('div', { class: 'cbo-nav' });
    var left = h('div', { class: 'cbo-nav-left' });
    // Onglets back-office masqués pendant le wizard (parcours guidé sans sortie).
    if (state.connected && state.view !== 'onboarding') {
      left.appendChild(navBtn('Mes bots', state.view !== 'bot' && state.view !== 'seo', function () { state.view = 'bots'; state.botId = null; render(); }));
      left.appendChild(navBtn('SEO', state.view === 'seo', function () { state.view = 'seo'; state.botId = null; render(); }));
    }
    nav.appendChild(left);
    var right = h('div', { class: 'cbo-nav-right' });
    if (state.connected) {
      right.appendChild(h('span', { class: 'cbo-dot cbo-dot-ok' }));
      var conn = 'Connecté à Chapote';
      if (state.account && state.account.email) conn += ' — ' + state.account.email;
      right.appendChild(h('span', { class: 'cbo-conn', text: conn }));
      right.appendChild(h('button', { class: 'button', onClick: disconnect }, 'Déconnexion'));
    } else {
      right.appendChild(h('span', { class: 'cbo-dot cbo-dot-off' }));
      right.appendChild(h('span', { class: 'cbo-conn', text: 'Non connecté' }));
    }
    nav.appendChild(right);
    return nav;
  }
  function navBtn(label, active, on) {
    return h('button', { type: 'button', class: 'cbo-tab' + (active ? ' is-active' : ''),
      'data-focuskey': 'nav-' + label, 'aria-current': active ? 'page' : null, onClick: on }, label);
  }

  /* --------------------------------------------------------------- connexion */

  function renderConnect() {
    var wrap = h('div', { class: 'cbo-card cbo-connect' });
    wrap.appendChild(h('h2', { text: 'Se connecter avec Chapote' }));
    wrap.appendChild(h('p', { class: 'cbo-muted', text:
      'Connectez ce site à votre compte Chapote pour gérer vos bots, leur apparence, le paiement et l’activation du widget.' }));
    if (CFG.cryptoOk === false) {
      wrap.appendChild(h('p', { class: 'cbo-error', text:
        'OpenSSL (AES-256-GCM) indisponible : impossible de stocker vos identifiants de façon chiffrée.' }));
    }
    wrap.appendChild(h('p', { class: 'cbo-muted', text:
      'Vous serez redirigé vers Chapote pour autoriser ce site, puis ramené ici automatiquement.' }));
    var info = h('div', { class: 'cbo-device' });
    wrap.appendChild(info);
    var btn = h('button', { class: 'button button-primary button-hero', disabled: CFG.cryptoOk === false,
      onClick: function () { startConnect(btn, info); } }, 'Se connecter avec Chapote');
    wrap.appendChild(btn);
    return wrap;
  }

  // Authorization Code + PKCE : on demande au proxy l'URL d'autorisation (qui a
  // généré state + code_verifier CÔTÉ SERVEUR) puis on ouvre l'écran de
  // consentement Chapote dans une POPUP. La popup (même page admin = redirect_uri)
  // échange le code et postMessage l'opener avant de se fermer. Repli : si la
  // popup est bloquée, on retombe sur la redirection pleine page historique.
  // Aucun secret ne transite par le JS.
  function startConnect(btn, info) {
    btn.disabled = true;
    clear(info);
    info.appendChild(loadingNote('Ouverture de la fenêtre Chapote…'));
    call('GET', '/connect/url').then(function (res) {
      if (!res.ok || !res.data || !res.data.url) {
        btn.disabled = (CFG.cryptoOk === false);
        clear(info);
        // Propage la cause réelle (le proxy renvoie p.ex. crypto_unavailable) ;
        // pas de renvoi vers des « réglages » : le plugin n'expose pas d'écran de
        // configuration d'adresses (elles sont définies à l'installation).
        info.appendChild(h('p', { class: 'cbo-error', text:
          apiMsg(res, 'Impossible de démarrer la connexion à Chapote. Réessayez dans un instant.') }));
        return;
      }
      openOAuthPopup(res.data.url, btn, info);
    });
  }

  // Ouvre la popup OAuth nommée 'chapote_oauth'. Écoute le postMessage du retour
  // (origine = ce site WP, source 'chapote-oauth') ; filet : surveille pop.closed
  // sans message et revérifie /status. Repli redirection si popup bloquée.
  function openOAuthPopup(url, btn, info) {
    var pop = null;
    try { pop = window.open(url, 'chapote_oauth', 'width=480,height=720'); } catch (e) { pop = null; }
    if (!pop) { window.location.href = url; return; } // popup bloquée -> pleine page

    if (info) { clear(info); info.appendChild(loadingNote('Terminez la connexion dans la fenêtre Chapote…')); }
    var settled = false;

    function finish(ok) {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMsg);
      if (watch) clearInterval(watch);
      if (ok) { onConnected(); return; }
      if (btn) btn.disabled = (CFG.cryptoOk === false);
      if (info) clear(info);
    }
    function onMsg(ev) {
      if (ev.origin !== window.location.origin) return;
      // event.source doit être notre popup (certains navigateurs le mettent à
      // null après navigation cross-origin : on tolère alors l'absence).
      if (ev.source && ev.source !== pop) return;
      if (!ev.data || ev.data.source !== 'chapote-oauth') return;
      if (ev.data.status === 'connected') finish(true);
      else { finish(false); setNotice('Connexion annulée ou refusée. Vous pouvez réessayer.', 'warn'); }
    }
    window.addEventListener('message', onMsg);

    // Filet : la popup s'est fermée sans message (perdu / fermeture manuelle).
    var watch = setInterval(function () {
      if (!pop || !pop.closed) return;
      clearInterval(watch); watch = null;
      if (settled) return;
      call('GET', '/status').then(function (res) {
        finish(!!(res.data && res.data.connected));
      });
    }, 800);
  }

  // Connexion établie (via popup) : on bascule en connecté et on relance la suite
  // adéquate selon la vue (wizard d'onboarding ou back-office « Mes bots »).
  function onConnected() {
    state.connected = true;
    state.account = null;
    if (state.view === 'onboarding' && window.CBOOnboarding) {
      render();
      loadAccount();
      CBOOnboarding.afterConnect();
    } else {
      state.view = 'bots';
      render();
      setNotice('Connexion réussie.', 'ok');
      loadAccount();
      loadBots();
    }
  }

  function disconnect() {
    call('POST', '/disconnect').then(function () {
      state.connected = false; state.account = null; state.bots = []; state.view = 'connect';
      render();
      setNotice('Déconnecté.', 'info');
    });
  }

  // Récupère le compte connecté (email/nom) via /status puis rafraîchit l'en-tête.
  function loadAccount() {
    call('GET', '/status').then(function (res) {
      state.account = (res.data && res.data.account) ? res.data.account : null;
      if (state.connected) render();
    });
  }

  /* ------------------------------------------------------------------- bots */

  function loadBots() {
    call('GET', '/bots').then(function (res) {
      if (res.ok && Array.isArray(res.data)) { state.bots = res.data; }
      else if (res.ok && Array.isArray(res.data.bots)) { state.bots = res.data.bots; }
      render();
    });
  }

  function renderBots() {
    var wrap = h('div', { class: 'cbo-card' });
    var head = h('div', { class: 'cbo-row-between' },
      h('h2', { text: 'Mes bots' }),
      h('div', { class: 'cbo-row-actions' },
        window.CBOOnboarding ? h('button', { class: 'button button-primary', onClick: startNewOnboarding }, 'Démarrer un nouveau bot') : null,
        h('button', { class: 'button', onClick: openCreate }, 'Créer un bot (manuel)')
      )
    );
    wrap.appendChild(head);
    wrap.appendChild(h('div', { class: 'cbo-create', id: 'cbo-create' }));

    if (!state.bots.length) {
      wrap.appendChild(h('p', { class: 'cbo-muted', text: 'Aucun bot pour le moment. Créez-en un pour commencer.' }));
      return wrap;
    }

    var table = h('table', { class: 'widefat striped cbo-table' });
    table.appendChild(h('thead', null, h('tr', null,
      h('th', { text: 'Nom' }), h('th', { text: 'Sur le site' }), h('th', { text: 'Facturation' }),
      h('th', { text: 'Plan / modules' }), h('th', { text: '' })
    )));
    var tb = h('tbody');
    state.bots.forEach(function (b) {
      var modules = Array.isArray(b.modules) ? b.modules.join(', ') : (b.modules ? String(b.modules) : '—');
      tb.appendChild(h('tr', null,
        h('td', null, h('strong', { text: b.name || '(sans nom)' })),
        h('td', null, activationToggle(b, { compact: true })),
        h('td', null, billingBadge(b.billing_status)),
        h('td', { text: modules }),
        h('td', null, h('button', { class: 'button', onClick: function () { openBot(b.id); } }, 'Gérer'))
      ));
    });
    table.appendChild(tb);
    wrap.appendChild(table);

    var dash = appDashboardUrl();
    wrap.appendChild(h('p', { class: 'cbo-muted cbo-deeplink' },
      'L’arbre de conversation, la base de connaissances et la sécurité se configurent dans le dashboard Chapote',
      dash ? ' : ' : ' (ouvrez le tableau de bord Chapote depuis votre navigateur).',
      dash ? h('a', { href: dash, target: '_blank', rel: 'noopener', text: 'ouvrir le dashboard' }) : null,
      dash ? '.' : null
    ));
    return wrap;
  }

  function billingBadge(status) {
    // billing_status null/undefined = bot servable sans abonnement payant = « Gratuit ».
    if (status == null || status === '') return h('span', { class: 'cbo-badge cbo-badge-off', text: 'Gratuit' });
    var map = { active: ['Actif', 'ok'], trialing: ['Essai', 'ok'], inactive: ['Inactif', 'off'], past_due: ['Impayé', 'warn'], canceled: ['Résilié', 'off'], suspended: ['Bloqué', 'warn'] };
    var m = map[status] || [status, 'off'];
    return h('span', { class: 'cbo-badge cbo-badge-' + m[1], text: m[0] });
  }

  // Toggle d'AFFICHAGE du widget sur le site (on/off), réutilisé dans « Mes bots »
  // ET l'en-tête du bot (plus dans un onglet). N'envoie QUE { enabled } : le ciblage
  // est préservé côté serveur. Un bot 'suspended' (bloqué admin) ne peut pas être
  // exposé (widget coupé) -> toggle désactivé. `bot` est muté (bot.enabled) pour
  // rester cohérent entre la liste et l'en-tête.
  function activationToggle(bot, opts) {
    opts = opts || {};
    var blocked = bot.billing_status === 'suspended';
    // Interrupteur d'affichage du widget : role=switch + aria-checked + nom
    // accessible (aria-label) car le mode compact n'a pas de texte visible.
    var switchLabel = 'Afficher le widget' + (bot.name ? ' « ' + bot.name + ' »' : '') + ' sur le site';
    var cb = h('input', { type: 'checkbox', checked: !!bot.enabled, role: 'switch',
      'aria-checked': bot.enabled ? 'true' : 'false', 'aria-label': switchLabel });
    if (blocked) { cb.disabled = true; cb.title = 'Bot bloqué : le widget est coupé.'; }
    var txt = opts.compact ? null
      : h('span', { text: bot.enabled ? 'Affiché sur le site' : 'Afficher sur le site' });
    cb.addEventListener('change', function () {
      var want = cb.checked;
      cb.disabled = true;
      call('POST', '/bots/' + encodeURIComponent(bot.id) + '/local', { enabled: want }).then(function (res) {
        cb.disabled = blocked;
        if (res.ok) {
          bot.enabled = !!(res.data && res.data.enabled);
          cb.checked = bot.enabled;
          syncSwitch(cb);
          if (txt) txt.textContent = bot.enabled ? 'Affiché sur le site' : 'Afficher sur le site';
          setNotice(bot.enabled ? 'Widget activé sur le site.' : 'Widget désactivé du site.', 'ok');
          if (typeof opts.onChange === 'function') opts.onChange(bot.enabled);
        } else {
          cb.checked = !want; // revert visuel
          syncSwitch(cb);
          setNotice('Action impossible.', 'warn');
        }
      });
    });
    var label = h('label', { class: 'cbo-check cbo-actoggle' }, cb);
    if (txt) label.appendChild(txt);
    if (blocked && !opts.compact) label.appendChild(h('span', { class: 'cbo-muted', text: ' — bloqué' }));
    return label;
  }

  function openCreate() {
    var box = document.getElementById('cbo-create');
    if (!box) return;
    if (box.childNodes.length) { clear(box); return; }
    var name = h('input', { type: 'text', class: 'regular-text', placeholder: 'Nom du bot', maxlength: 80, 'aria-label': 'Nom du bot' });
    var mode = h('select', { 'aria-label': 'Type de bot' },
      h('option', { value: 'hybrid' }, 'Hybride (arbre + IA)'),
      h('option', { value: 'tree' }, 'Arbre seul'),
      h('option', { value: 'ai' }, 'IA seule')
    );
    // Bouton capturé en variable pour le désactiver pendant la requête : un
    // double-clic ne crée pas deux bots (#UX-2). Réactivé dans tous les chemins
    // de sortie (succès = re-render via loadBots, échec/réseau = ré-activation).
    var createBtn = h('button', { class: 'button button-primary', onClick: function () {
      var nm = (name.value || '').trim();
      if (!nm) { setNotice('Donnez un nom au bot.', 'warn'); return; }
      createBtn.disabled = true;
      call('POST', '/bots', { name: nm, mode: mode.value }).then(function (res) {
        createBtn.disabled = false;
        if (!res.ok) { setNotice(apiMsg(res, 'Création impossible.'), 'warn'); return; }
        setNotice('Bot créé.', 'ok');
        loadBots();
      });
    } }, 'Créer');
    box.appendChild(h('div', { class: 'cbo-create-row' },
      name, mode,
      createBtn,
      h('button', { class: 'button', onClick: function () { clear(box); } }, 'Annuler')
    ));
  }

  /* ----------------------------------------------------------- bot (détail) */

  function openBot(id) {
    state.view = 'bot'; state.botId = id; state.botTab = 'activation';
    render();
  }

  function renderBot() {
    var bot = state.bots.filter(function (b) { return String(b.id) === String(state.botId); })[0] || {};
    var wrap = h('div');
    wrap.appendChild(h('div', { class: 'cbo-bothead' },
      h('button', { class: 'button-link', onClick: function () { state.view = 'bots'; render(); } }, '← Mes bots'),
      h('h2', { text: bot.name || 'Bot' }),
      billingBadge(bot.billing_status),
      // Toggle d'affichage du widget DIRECTEMENT dans l'en-tête (plus dans un onglet).
      h('span', { class: 'cbo-bothead-toggle' }, activationToggle(bot, {}))
    ));
    var tabs = h('div', { class: 'cbo-subtabs', role: 'tablist', 'aria-label': 'Réglages du bot' },
      subTab('Ciblage des pages', 'activation'),
      subTab('Mon offre', 'payment'),
      subTab('Apparence', 'appearance')
    );
    wireTablistKeys(tabs);
    wrap.appendChild(tabs);
    // Le pane est le tabpanel piloté par l'onglet actif (aria-controls/labelledby).
    var pane = h('div', { class: 'cbo-pane', id: 'cbo-pane', role: 'tabpanel', tabindex: '0',
      'aria-labelledby': 'cbo-subtab-' + state.botTab });
    wrap.appendChild(pane);

    if (state.botTab === 'payment') renderPayment(pane);
    else if (state.botTab === 'appearance') renderAppearance(pane);
    else renderActivation(pane); // 'activation' par défaut (onglet Domaine fusionné ici)
    return wrap;
  }
  function subTab(label, key) {
    var active = state.botTab === key;
    return h('button', { type: 'button', class: 'cbo-subtab' + (active ? ' is-active' : ''),
      id: 'cbo-subtab-' + key, role: 'tab', 'aria-selected': active ? 'true' : 'false',
      'aria-controls': 'cbo-pane', tabindex: active ? '0' : '-1', 'data-focuskey': 'subtab-' + key,
      onClick: function () { state.botTab = key; render(); } }, label);
  }

  /* ----------------------------------------------------------- apparence */

  function renderAppearance(pane) {
    clear(pane);
    pane.appendChild(loadingNote('Chargement de l’apparence…'));
    call('GET', '/bots/' + encodeURIComponent(state.botId)).then(function (res) {
      if (!res.ok) { clear(pane); pane.appendChild(h('p', { class: 'cbo-error', text: 'Impossible de charger ce bot.' })); return; }
      var design = (res.data && res.data.design_json) || {};
      var botName = res.data.name || 'Assistant';
      buildAppearanceForm(pane, design, botName);
    });
  }

  function buildAppearanceForm(pane, design, botName) {
    clear(pane);
    var d = Object.assign({}, design);

    var grid = h('div', { class: 'cbo-grid2' });
    var preview = h('div', { class: 'cbo-preview' });
    function refresh() { renderPreview(preview, d, botName); }

    function field(label, control) { return fieldFor(label, control); }
    function colorInput(key, fallback) {
      var inp = h('input', { type: 'color', value: d[key] || fallback });
      inp.addEventListener('input', function () { d[key] = inp.value; refresh(); });
      return inp;
    }
    function textInput(key, ph, max) {
      var inp = h('input', { type: 'text', class: 'regular-text', value: d[key] || '', placeholder: ph || '', maxlength: max || 100 });
      inp.addEventListener('input', function () { d[key] = inp.value; refresh(); });
      return inp;
    }
    function selectInput(key, opts, def) {
      var sel = h('select', null, opts.map(function (o) {
        return h('option', { value: o[0], selected: (d[key] || def) === o[0] }, o[1]);
      }));
      sel.addEventListener('change', function () { d[key] = sel.value; refresh(); });
      return sel;
    }
    function checkInput(key, label, def) {
      var on = (d[key] === undefined) ? def : (d[key] === true);
      var inp = h('input', { type: 'checkbox', checked: on });
      inp.addEventListener('change', function () { d[key] = inp.checked; refresh(); });
      return h('label', { class: 'cbo-check' }, inp, h('span', { text: label }));
    }

    var form = h('div', { class: 'cbo-form' },
      h('div', { class: 'cbo-row2' },
        field('Couleur principale', colorInput('primaryColor', '#0d9488')),
        field('Couleur secondaire', colorInput('secondaryColor', '#0d9488'))
      ),
      h('div', { class: 'cbo-row2' },
        field('Position', selectInput('position', [['right', 'À droite'], ['left', 'À gauche']], 'right')),
        field('Taille', selectInput('size', [['sm', 'Petite'], ['md', 'Moyenne'], ['lg', 'Grande']], 'md'))
      ),
      field('Titre du chat', textInput('title', botName, 100)),
      field('Message d’accueil', (function () {
        var ta = h('textarea', { rows: 2, maxlength: 500, class: 'large-text' }); ta.value = d.welcomeMessage || '';
        ta.addEventListener('input', function () { d.welcomeMessage = ta.value; refresh(); });
        return ta;
      })()),
      field('Placeholder du champ', textInput('placeholder', 'Écrivez votre message…', 100)),
      field('Texte du lanceur', textInput('launcherText', 'ex. Une question ?', 40)),
      field('Langue de l’interface', selectInput('locale', [['fr', 'Français'], ['en', 'Anglais'], ['auto', 'Auto (navigateur)']], 'fr')),
      h('div', { class: 'cbo-checks' },
        checkInput('darkMode', 'Mode sombre', false),
        checkInput('greeting', 'Bulle d’accroche', false),
        checkInput('poweredBy', 'Afficher « Powered by Chapote »', true)
      ),
      h('p', { class: 'cbo-hint', text: 'Retirer « Powered by » nécessite le module White-label : sans lui, la mention reste affichée même si décochée.' }),
      h('div', { class: 'cbo-actions' },
        h('button', { class: 'button button-primary', onClick: function (e) { saveAppearance(e.target, d); } }, 'Enregistrer l’apparence')
      )
    );

    grid.appendChild(form);
    grid.appendChild(h('div', { class: 'cbo-previewcol' }, h('div', { class: 'cbo-muted', text: 'Aperçu' }), preview));
    pane.appendChild(grid);
    refresh();
  }

  // renderPreview + icônes SVG du widget : déplacés dans cbo-core.js
  // (window.CBOCore.renderPreview), aliasés en tête de fichier.

  function saveAppearance(btn, design) {
    btn.disabled = true;
    call('POST', '/bots/' + encodeURIComponent(state.botId) + '/appearance', { design_json: design }).then(function (res) {
      btn.disabled = false;
      if (res.ok) setNotice('Apparence enregistrée.', 'ok');
      else setNotice('Échec de l’enregistrement de l’apparence.', 'warn');
    });
  }

  /* -------------------------------------------------------------- paiement */

  function renderPayment(pane) {
    clear(pane);
    pane.appendChild(loadingNote('Chargement de l’offre…'));
    // Bot + catalogue LIVE en parallèle. Le catalogue (prix/paliers/modules) est
    // la SOURCE UNIQUE backend (proxy /catalog -> GET /api/account/catalog) : plus
    // aucun repli de prix codé en dur côté plugin. Si le proxy échoue, on affiche
    // un état d'erreur PROPRE.
    Promise.all([
      call('GET', '/bots/' + encodeURIComponent(state.botId)),
      call('GET', '/catalog')
    ]).then(function (r) {
      var botRes = r[0], catRes = r[1];
      if (!botRes.ok) { clear(pane); pane.appendChild(h('p', { class: 'cbo-error', text: 'Impossible de charger ce bot.' })); return; }
      // billing OFF renvoie {billing:'disabled'} (sans `modules`) : le compter comme
      // « live » pour que buildPaymentForm atteigne sa branche dédiée (compte sans
      // facturation), sinon le tableau de modules est requis.
      var live = (catRes.ok && catRes.data && (Array.isArray(catRes.data.modules) || catRes.data.billing === 'disabled')) ? catRes.data : null;
      if (!live) {
        clear(pane);
        pane.appendChild(h('p', { class: 'cbo-error', text: 'Catalogue indisponible pour le moment — réessayez dans un instant.' }));
        return;
      }
      buildPaymentForm(pane, botRes.data || {}, live);
    });
  }

  // opts (optionnel, utilisé par le wizard d'onboarding) :
  //   banner       : noeud DOM inséré en tête (« d'après l'arbre et vos demandes… »)
  //   required     : [clés modules] requis par l'arbre ; décocher prévient d'un retrait
  //   submitLabel  : libellé du bouton principal
  //   onSubscribe  : fn(config, consent, btn) -> remplace le checkout par défaut
  //   secondary    : { label, onClick(btn) } -> bouton secondaire (ex. activer en gratuit)
  function buildPaymentForm(pane, bot, catalog, opts) {
    clear(pane);
    opts = opts || {};
    if (opts.banner) pane.appendChild(opts.banner);
    catalog = catalog || { modules: [], ai_tiers: [] };
    var allModules = Array.isArray(catalog.modules) ? catalog.modules : [];
    var aiTiers = Array.isArray(catalog.ai_tiers) ? catalog.ai_tiers : [];

    // Forme RÉELLE : l'IA est un module (key === 'ai') porteur de byok_price_cents.
    // On l'isole pour l'afficher dans sa propre section et on ne propose à la
    // case à cocher que les AUTRES modules.
    var aiModule = allModules.filter(function (m) { return m.key === 'ai'; })[0] || null;
    var payableModules = allModules.filter(function (m) { return m.key !== 'ai'; });
    var byokCents = (aiModule && aiModule.byok_price_cents != null)
      ? aiModule.byok_price_cents
      : (catalog.ai_byok_price_cents != null ? catalog.ai_byok_price_cents : DEFAULT_BYOK_PRICE_CENTS);

    // Facturation désactivée côté compte : on n'affiche pas le configurateur.
    if (catalog.billing === 'disabled') {
      pane.appendChild(h('div', { class: 'cbo-statusline' },
        h('strong', { text: 'Facturation désactivée.' }),
        ' La facturation est désactivée sur ce compte Chapote : aucune souscription n’est requise pour ce bot.'
      ));
      return;
    }

    var active = bot.billing_status === 'active';
    if (active) {
      pane.appendChild(h('div', { class: 'cbo-statusline' },
        h('strong', { text: 'Abonnement actif.' }),
        ' Vous pouvez changer de plan ou résilier ci-dessous.'
      ));
    }

    // État du configurateur.
    var selected = {};
    (Array.isArray(bot.modules) ? bot.modules : []).forEach(function (m) { if (m !== 'ai') selected[m] = true; });
    var aiMode = (Array.isArray(bot.modules) && bot.modules.indexOf('ai') !== -1)
      ? (bot.ai_byok ? 'byok' : 'managed') : 'off';
    var aiTier = bot.ai_tier_id || (aiTiers[0] || {}).id || 'ai_starter';

    var modBox = h('div', { class: 'cbo-modules' });
    var aiBox = h('div', { class: 'cbo-aitiers' });
    var totalLine = h('div', { class: 'cbo-total' });
    // Onboarding : modules requis par l'arbre généré (décocher = section retirée).
    var requiredSet = {};
    (opts.required || []).forEach(function (k) { requiredSet[k] = true; });
    var reqWarn = h('div', { class: 'cbo-reqwarn', role: 'status', 'aria-live': 'polite' });

    function requiresAi() {
      return Object.keys(selected).some(function (k) {
        var m = payableModules.filter(function (x) { return x.key === k; })[0];
        return m && Array.isArray(m.requires) && m.requires.indexOf('ai') !== -1;
      });
    }

    // Avertit que les sections de l'arbre liées à un module REQUIS décoché seront
    // retirées à la souscription (le backend élague via /tree-prune).
    function renderReqWarn() {
      clear(reqWarn);
      var removed = Object.keys(requiredSet).filter(function (k) { return k !== 'ai' && !selected[k]; });
      if (requiredSet.ai && aiMode === 'off') removed.push('ai');
      if (!removed.length) return;
      var names = removed.map(function (k) {
        var m = payableModules.filter(function (x) { return x.key === k; })[0];
        return (m && m.label) || (k === 'ai' ? 'IA' : k);
      });
      reqWarn.appendChild(h('p', { class: 'cbo-hint cbo-reqwarn-msg', text:
        'Modules retirés : ' + names.join(', ') + '. Les sections de l’arbre qui en dépendent seront supprimées à la souscription.' }));
    }

    function recompute() {
      if (requiresAi() && aiMode === 'off') aiMode = 'managed';
      renderModules(); renderAi(); renderTotal(); renderReqWarn();
    }

    function renderModules() {
      clear(modBox);
      modBox.appendChild(h('h3', { text: 'Modules' }));
      payableModules.forEach(function (m) {
        var cb = h('input', { type: 'checkbox', checked: !!selected[m.key] });
        cb.addEventListener('change', function () {
          if (cb.checked) selected[m.key] = true; else delete selected[m.key];
          recompute();
        });
        modBox.appendChild(h('label', { class: 'cbo-modline' },
          cb,
          h('span', { class: 'cbo-modname' },
            h('span', { text: m.label }),
            m.desc ? h('span', { class: 'cbo-moddesc', text: m.desc }) : null
          ),
          h('span', { class: 'cbo-modprice', text: euros(m.price_cents) + ' /mois' }),
          (m.requires && m.requires.indexOf('ai') !== -1) ? h('span', { class: 'cbo-modtag', text: 'IA requise' }) : null
        ));
      });
    }

    function renderAi() {
      clear(aiBox);
      aiBox.appendChild(h('h3', { text: 'Intelligence artificielle' }));
      var modes = [['off', 'Sans IA'], ['managed', 'IA incluse (quota)'], ['byok', 'IA avec ma clé (BYOK)']];
      var row = h('div', { class: 'cbo-airow' });
      modes.forEach(function (mo) {
        var r = h('input', { type: 'radio', name: 'cbo-aimode', checked: aiMode === mo[0], disabled: mo[0] === 'off' && requiresAi() });
        r.addEventListener('change', function () { if (r.checked) { aiMode = mo[0]; recompute(); } });
        row.appendChild(h('label', { class: 'cbo-airadio' }, r, h('span', { text: mo[1] })));
      });
      aiBox.appendChild(row);
      if (aiMode === 'managed') {
        var tiers = h('div', { class: 'cbo-tiers' });
        aiTiers.forEach(function (t) {
          var r = h('input', { type: 'radio', name: 'cbo-aitier', checked: aiTier === t.id });
          r.addEventListener('change', function () { if (r.checked) { aiTier = t.id; renderTotal(); } });
          tiers.appendChild(h('label', { class: 'cbo-tier' }, r,
            h('span', { text: (t.included_replies || 0).toLocaleString('fr-FR') + ' réponses/mois' }),
            h('span', { class: 'cbo-modprice', text: euros(t.price_cents) + ' /mois' })
          ));
        });
        aiBox.appendChild(tiers);
      } else if (aiMode === 'byok') {
        aiBox.appendChild(h('p', { class: 'cbo-hint', text: 'Avec votre propre clé : ' + euros(byokCents) + ' /mois, réponses illimitées (clé configurée dans le dashboard).' }));
      }
    }

    function buildConfig() {
      var modules = Object.keys(selected);
      var ai_tier_id = null, ai_byok = false;
      if (aiMode === 'managed') { modules.push('ai'); ai_tier_id = aiTier; }
      else if (aiMode === 'byok') { modules.push('ai'); ai_byok = true; }
      var uniq = {}; modules.forEach(function (m) { uniq[m] = true; });
      return { modules: Object.keys(uniq), ai_tier_id: ai_tier_id, ai_byok: ai_byok };
    }

    function estimate() {
      var total = 0;
      payableModules.forEach(function (m) { if (selected[m.key]) total += (m.price_cents || 0); });
      if (aiMode === 'managed') {
        var t = aiTiers.filter(function (x) { return x.id === aiTier; })[0];
        if (t) total += (t.price_cents || 0);
      } else if (aiMode === 'byok') {
        total += byokCents;
      } else {
        // Aucun plan IA (arbre seul) : le SOCLE (9€) est facturé. Dès qu'un plan IA
        // est pris (managé/BYOK) le socle est INCLUS dans le prix du palier, donc
        // pas ajouté ici. Aligne l'estimation sur les line_items Stripe (point 6).
        total += (catalog.base_price_cents || 0);
      }
      return total;
    }

    function renderTotal() {
      clear(totalLine);
      totalLine.appendChild(h('span', { text: 'Estimation : ' }));
      totalLine.appendChild(h('strong', { text: euros(estimate()) + ' /mois' }));
      totalLine.appendChild(h('span', { class: 'cbo-muted', text: ' (' + TAX_NOTE + '). Tarif réel appliqué par Stripe.' }));
    }

    var consent = h('input', { type: 'checkbox' });
    var consentLine = h('label', { class: 'cbo-check cbo-consent' }, consent,
      h('span', { text: 'J’accepte l’exécution immédiate de l’abonnement et renonce à mon droit de rétractation de 14 jours.' }));

    var subscribeBtn = h('button', { class: 'button button-primary button-hero',
      onClick: function () {
        if (typeof opts.onSubscribe === 'function') opts.onSubscribe(buildConfig(), consent.checked, subscribeBtn);
        else doCheckout(subscribeBtn, buildConfig(), consent.checked);
      } },
      opts.submitLabel || (active ? 'Mettre à jour le plan' : 'Souscrire'));
    // 1re souscription : le consentement 14j (exécution immédiate, B2C) est
    // OBLIGATOIRE -> bouton DÉSACTIVÉ tant qu'il n'est pas coché. Évite le clic
    // « sans effet » (la notice d'avertissement s'affichait hors du cadre wizard).
    if (!active) {
      var syncConsent = function () {
        subscribeBtn.disabled = !consent.checked;
        subscribeBtn.title = consent.checked ? '' : 'Cochez le consentement ci-dessus pour souscrire.';
      };
      syncConsent();
      consent.addEventListener('change', syncConsent);
    }

    pane.appendChild(modBox);
    pane.appendChild(reqWarn);
    pane.appendChild(aiBox);
    pane.appendChild(totalLine);
    pane.appendChild(consentLine);

    var actions = h('div', { class: 'cbo-actions' }, subscribeBtn);
    if (active) {
      actions.appendChild(h('button', { class: 'button',
        onClick: function (e) { updateSubscription(e.currentTarget, buildConfig()); } }, 'Changer de plan (prorata)'));
      actions.appendChild(confirmButton('Résilier', 'Confirmer la résiliation', cancelSubscription));
    }
    // Bouton secondaire (onboarding : « activer en version gratuite », sans paiement).
    if (opts.secondary && opts.secondary.label) {
      actions.appendChild(h('button', { class: 'button',
        onClick: function (e) { opts.secondary.onClick(e.currentTarget); } }, opts.secondary.label));
    }
    pane.appendChild(actions);

    recompute();
  }

  function doCheckout(btn, config, consent) {
    if (!consent) { setNotice('Cochez le consentement à l’exécution immédiate pour souscrire.', 'warn'); return; }
    btn.disabled = true;
    call('POST', '/bots/' + encodeURIComponent(state.botId) + '/checkout', { config: config, consent: true }).then(function (res) {
      btn.disabled = false;
      if (res.ok && res.data && res.data.checkout_url) {
        window.location.href = res.data.checkout_url; // redirection Stripe hébergé
        return;
      }
      setNotice(apiMsg(res, 'Impossible d’ouvrir le paiement.'), 'warn');
    });
  }

  // btn désactivé pendant la requête (anti double-soumission #UX-2) et ré-activé
  // dans tous les chemins (succès = re-render via loadBots, échec/réseau).
  function updateSubscription(btn, config) {
    if (btn) btn.disabled = true;
    call('POST', '/bots/' + encodeURIComponent(state.botId) + '/subscription/update', { config: config }).then(function (res) {
      if (btn) btn.disabled = false;
      if (res.ok) { setNotice('Plan mis à jour.', 'ok'); loadBots(); }
      else setNotice(apiMsg(res, 'Mise à jour impossible.'), 'warn');
    });
  }
  function cancelSubscription(btn) {
    if (btn) btn.disabled = true;
    call('POST', '/bots/' + encodeURIComponent(state.botId) + '/subscription/cancel').then(function (res) {
      if (btn) btn.disabled = false;
      if (res.ok) { setNotice('Abonnement résilié.', 'info'); loadBots(); }
      else setNotice(apiMsg(res, 'Résiliation impossible.'), 'warn');
    });
  }

  // Polling d'activation après retour Stripe : borné à POLL_MAX essais. À
  // l'expiration on ne laisse PAS la notice trompeuse « Activation en cours… »
  // mais un message clair invitant à recharger / contacter le support (#UX-3).
  var POLL_MAX = 12;
  function pollBillingActive(botId) {
    var tries = 0;
    (function loop() {
      tries++;
      call('GET', '/bots/' + encodeURIComponent(botId)).then(function (res) {
        if (res.ok && res.data && res.data.billing_status === 'active') {
          setNotice('Abonnement actif. Vous pouvez activer le widget sur le site (onglet Activation & ciblage).', 'ok');
          loadBots(); // rafraîchit le badge + le pane courant
          return;
        }
        if (tries < POLL_MAX) { setTimeout(loop, 3000); return; }
        // Borne atteinte : le paiement est encaissé mais l'activation (webhook
        // Stripe) tarde. On remplace la notice « en cours » par un message net.
        setNotice('Paiement bien reçu, mais l’activation prend plus de temps que prévu. Rechargez la page dans un instant ; si le bot reste inactif, contactez le support.', 'warn');
        loadBots();
      });
    })();
  }

  /* ------------------------------------------------------- activation/ciblage */

  function renderActivation(pane) {
    clear(pane);
    pane.appendChild(loadingNote());
    Promise.all([
      call('GET', '/bots/' + encodeURIComponent(state.botId) + '/local'),
      call('GET', '/bots/' + encodeURIComponent(state.botId))
    ]).then(function (r) {
      // Échec (réseau ou serveur) : état d'erreur explicite plutôt qu'un
      // formulaire vide trompeur (homogène avec apparence/paiement).
      if (!r[0].ok || !r[1].ok) {
        clear(pane);
        pane.appendChild(h('p', { class: 'cbo-error', text: 'Impossible de charger le ciblage de ce bot — réessayez dans un instant.' }));
        return;
      }
      var local = (r[0].data) || {};
      var bot = (r[1].data) || {};
      buildActivation(pane, local, bot);
    });
  }

  function buildActivation(pane, local, bot) {
    clear(pane);
    var billed = bot.billing_status;
    var t = local.targeting || { mode: 'everywhere', include_front: true, include_types: [], include_ids: [], exclude_types: [], exclude_ids: [] };

    // Décision produit : le widget Chapote sert TOUS les bots servables. Un bot
    // gratuit (socle, billing_status null) ou en essai reste utilisable -> pas de
    // verrou dur. Si aucun abonnement payant n'est actif, on affiche seulement une
    // note informative (non bloquante) renvoyant vers l'onglet « Mon offre ».
    if (billed !== 'active' && billed !== 'trialing') {
      pane.appendChild(h('div', { class: 'cbo-freenote' },
        h('p', null,
          'Ce bot fonctionne en mode gratuit (pas d’abonnement payant actif) : les réponses IA sont limitées au quota gratuit. Vous pouvez quand même l’activer sur le site. ',
          h('button', { type: 'button', class: 'cbo-linkbtn', onClick: function () { state.botTab = 'payment'; render(); } }, 'Voir « Mon offre »')
        )
      ));
    }

    // L'activation on/off du widget vit désormais dans l'en-tête du bot et dans la
    // liste « Mes bots » (plus ici). Cet onglet ne gère QUE le ciblage des pages.
    pane.appendChild(h('p', { class: 'cbo-muted', text:
      'L’affichage du widget sur le site (on/off) se règle avec l’interrupteur en haut de cette page, ou dans « Mes bots ». Ci-dessous : sur quelles pages l’afficher.' }));

    // Ciblage.
    var modeEverywhere = h('input', { type: 'radio', name: 'cbo-target', checked: t.mode !== 'custom' });
    var modeCustom = h('input', { type: 'radio', name: 'cbo-target', checked: t.mode === 'custom' });
    var customBox = h('div', { class: 'cbo-custom' });

    function renderCustom() {
      customBox.style.display = modeCustom.checked ? 'block' : 'none';
    }
    modeEverywhere.addEventListener('change', renderCustom);
    modeCustom.addEventListener('change', renderCustom);

    // Construit un jeu de cases « types de contenu publics » et renvoie l'index
    // de cases (slug -> input) pour relire la sélection à l'enregistrement.
    function typeChecks(selectedSlugs) {
      var boxes = {};
      var wrap = h('div', { class: 'cbo-types' });
      var pts = CFG.postTypes || [];
      if (!pts.length) {
        wrap.appendChild(h('span', { class: 'cbo-muted', text: 'Aucun type de contenu public détecté.' }));
      }
      pts.forEach(function (pt) {
        var cb = h('input', { type: 'checkbox', checked: (selectedSlugs || []).indexOf(pt.slug) !== -1 });
        boxes[pt.slug] = cb;
        wrap.appendChild(h('label', { class: 'cbo-check' }, cb, h('span', { text: pt.label })));
      });
      return { boxes: boxes, wrap: wrap };
    }
    function checkedSlugs(boxes) {
      return Object.keys(boxes).filter(function (k) { return boxes[k].checked; });
    }

    var frontCb = h('input', { type: 'checkbox', checked: !!t.include_front });
    var inc = typeChecks(t.include_types);
    var exc = typeChecks(t.exclude_types);
    var includeIds = h('input', { type: 'text', class: 'regular-text', value: (t.include_ids || []).join(', '), placeholder: 'ex. 12, 34' });
    var excludeIds = h('input', { type: 'text', class: 'regular-text', value: (t.exclude_ids || []).join(', '), placeholder: 'ex. 7, 99' });

    // Inclusions.
    customBox.appendChild(h('h3', { class: 'cbo-custom-h', text: 'Afficher sur' }));
    customBox.appendChild(h('label', { class: 'cbo-check' }, frontCb, h('span', { text: 'Page d’accueil' })));
    customBox.appendChild(fieldGroup('Types de contenu à inclure', inc.wrap));
    customBox.appendChild(fieldFor('IDs de contenus à inclure', includeIds));

    // Exclusions (PRIORITAIRES sur toute inclusion).
    customBox.appendChild(h('h3', { class: 'cbo-custom-h', text: 'Ne jamais afficher sur (prioritaire)' }));
    customBox.appendChild(fieldGroup('Types de contenu à exclure', exc.wrap));
    customBox.appendChild(fieldFor('IDs de contenus à exclure', excludeIds));
    customBox.appendChild(h('p', { class: 'cbo-hint', text: 'Une exclusion (type ou ID) l’emporte toujours sur une inclusion.' }));

    pane.appendChild(fieldGroup('Où afficher le widget ?',
      h('div', { class: 'cbo-targetmodes' },
        h('label', { class: 'cbo-radio' }, modeEverywhere, h('span', { text: 'Tout le site' })),
        h('label', { class: 'cbo-radio' }, modeCustom, h('span', { text: 'Pages personnalisées' }))
      ), 'radiogroup'));
    pane.appendChild(customBox);
    renderCustom();

    function idList(s) {
      return (s || '').split(',').map(function (x) { return parseInt(x.trim(), 10); }).filter(function (n) { return n > 0; });
    }

    pane.appendChild(h('div', { class: 'cbo-actions' },
      h('button', { class: 'button button-primary', onClick: function (e) {
        var targeting = {
          mode: modeCustom.checked ? 'custom' : 'everywhere',
          include_front: frontCb.checked,
          include_types: checkedSlugs(inc.boxes),
          include_ids: idList(includeIds.value),
          exclude_types: checkedSlugs(exc.boxes),
          exclude_ids: idList(excludeIds.value)
        };
        saveActivation(e.target, targeting);
      } }, 'Enregistrer le ciblage')
    ));

    // Rappel domaine (anciennement onglet « Domaine », fusionné ici) : pour que le
    // widget réponde aux visiteurs, ce domaine doit être autorisé côté Chapote.
    pane.appendChild(h('div', { class: 'cbo-domain' },
      h('h3', { class: 'cbo-custom-h', text: 'Autoriser ce domaine dans Chapote' }),
      h('p', { class: 'cbo-muted', text: 'Pour que le widget réponde aux visiteurs, ajoutez ce domaine à la liste des domaines autorisés de votre bot (onglet Sécurité dans Chapote) :' }),
      h('code', { class: 'cbo-host', text: CFG.siteHost || '' }),
      h('p', { class: 'cbo-muted', text: 'La sécurité (domaines autorisés, captcha, limites) se gère côté Chapote, pas dans WordPress.' }),
      h('p', null, (function () {
        var dash = appDashboardUrl();
        return dash
          ? h('a', { href: dash, target: '_blank', rel: 'noopener', text: 'Ouvrir le dashboard Chapote' })
          : h('span', { class: 'cbo-muted', text: 'Ouvrez le tableau de bord Chapote depuis votre navigateur (adresse de l’app non configurée).' });
      })())
    ));
  }

  // Enregistre UNIQUEMENT le ciblage (on omet `enabled` -> l'état d'affichage est
  // préservé côté serveur ; il se règle via le toggle de l'en-tête / « Mes bots »).
  function saveActivation(btn, targeting) {
    btn.disabled = true;
    call('POST', '/bots/' + encodeURIComponent(state.botId) + '/local', { targeting: targeting }).then(function (res) {
      btn.disabled = false;
      if (res.ok) setNotice('Ciblage enregistré.', 'ok');
      else setNotice('Enregistrement impossible.', 'warn');
    });
  }

  /* ------------------------------------------------------------------- SEO */
  // Leviers SEO rendus CÔTÉ SERVEUR (crawlables), pilotés par l'option WP
  // chapote_bo_seo : lien « Powered by » opt-in + FAQ JSON-LD (schema.org).
  function renderSeo() {
    var wrap = h('div', { class: 'cbo-card' });
    wrap.appendChild(h('h2', { text: 'SEO (référencement)' }));
    wrap.appendChild(loadingNote());
    call('GET', '/seo').then(function (res) {
      var s = (res.data && typeof res.data === 'object') ? res.data : {};
      buildSeoForm(wrap, {
        powered_by: !!s.powered_by,
        faq: Array.isArray(s.faq) ? s.faq : []
      });
    });
    return wrap;
  }

  function buildSeoForm(wrap, seo) {
    clear(wrap);
    wrap.appendChild(h('h2', { text: 'SEO (référencement)' }));
    wrap.appendChild(h('p', { class: 'cbo-muted', text:
      'Ces leviers sont rendus côté serveur (visibles des moteurs de recherche), contrairement au widget chargé en JavaScript.' }));

    // 1) Backlink opt-in.
    var poweredCb = h('input', { type: 'checkbox', checked: !!seo.powered_by });
    wrap.appendChild(h('div', { class: 'cbo-field' },
      h('h3', { text: 'Lien « Chatbot par Chapote »' }),
      h('label', { class: 'cbo-check' }, poweredCb,
        h('span', { text: 'Afficher un petit lien crawlable vers Chapote dans le pied de page (désactivé par défaut).' }))
    ));

    // 2) Éditeur de paires FAQ (Question / Réponse) -> JSON-LD.
    wrap.appendChild(h('h3', { text: 'FAQ (données structurées schema.org)' }));
    wrap.appendChild(h('p', { class: 'cbo-muted', text:
      'Chaque paire Question / Réponse est publiée en JSON-LD (FAQPage), éligible aux résultats enrichis Google.' }));

    var list = h('div', { class: 'cbo-faqlist' });
    var rows = [];

    function addRow(q, a) {
      var qInput = h('input', { type: 'text', class: 'regular-text', value: q || '', placeholder: 'Question', maxlength: 300, 'aria-label': 'Question' });
      var aInput = h('textarea', { rows: 2, class: 'large-text', maxlength: 2000, placeholder: 'Réponse', 'aria-label': 'Réponse' });
      aInput.value = a || '';
      var row = { q: qInput, a: aInput };
      rows.push(row);
      var node = h('div', { class: 'cbo-faqrow' },
        h('div', { class: 'cbo-field' }, qInput),
        h('div', { class: 'cbo-field' }, aInput),
        h('button', { type: 'button', class: 'button cbo-danger', 'aria-label': 'Retirer cette question', onClick: function () {
          var i = rows.indexOf(row); if (i !== -1) rows.splice(i, 1);
          if (node.parentNode) node.parentNode.removeChild(node);
        } }, 'Retirer')
      );
      list.appendChild(node);
    }

    (seo.faq || []).forEach(function (p) { addRow(p.q, p.a); });
    wrap.appendChild(list);
    wrap.appendChild(h('p', null,
      h('button', { class: 'button', onClick: function () { addRow('', ''); } }, 'Ajouter une question')
    ));

    // Enregistrement.
    wrap.appendChild(h('div', { class: 'cbo-actions' },
      h('button', { class: 'button button-primary', onClick: function (e) {
        var faq = rows.map(function (r) {
          return { q: (r.q.value || '').trim(), a: (r.a.value || '').trim() };
        }).filter(function (p) { return p.q && p.a; });
        saveSeo(e.target, { powered_by: poweredCb.checked, faq: faq });
      } }, 'Enregistrer le SEO')
    ));
  }

  function saveSeo(btn, payload) {
    btn.disabled = true;
    call('POST', '/seo', payload).then(function (res) {
      btn.disabled = false;
      if (res.ok) setNotice('Réglages SEO enregistrés.', 'ok');
      else setNotice('Enregistrement SEO impossible.', 'warn');
    });
  }

  /* ----------------------------------------------------------- helpers UI */

  function confirmButton(label, confirmLabel, action) {
    var btn = h('button', { class: 'button cbo-danger' }, label);
    var armed = false;
    btn.addEventListener('click', function () {
      if (!armed) { armed = true; btn.textContent = confirmLabel; setTimeout(function () { armed = false; btn.textContent = label; }, 4000); return; }
      action(btn); // passe le bouton à l'action pour qu'elle puisse le désactiver
    });
    return btn;
  }

  /* ------------------------------------------------------------------ boot */

  // Lit un éventuel retour OAuth (?code=&state= ou ?error=) sur l'URL admin.
  function readOAuthCallback() {
    try {
      var p = new URLSearchParams(window.location.search);
      var err = p.get('error');
      if (err) return { error: err };
      var code = p.get('code'), st = p.get('state');
      if (code && st) return { code: code, state: st };
    } catch (e) {}
    return null;
  }

  // Retire code/state/error de la barre d'adresse SANS recharger (anti-rejeu au refresh).
  function cleanUrl() {
    try {
      var u = new URL(window.location.href);
      ['code', 'state', 'error', 'error_description'].forEach(function (k) { u.searchParams.delete(k); });
      window.history.replaceState({}, document.title, u.pathname + u.search + u.hash);
    } catch (e) {}
  }

  // État d'onboarding localisé (forme garantie).
  function onbConfig() {
    var o = (CFG.onboarding && typeof CFG.onboarding === 'object') ? CFG.onboarding : {};
    return { done: o.done === true, bot_id: o.bot_id ? String(o.bot_id) : '', step: o.step ? String(o.step) : '' };
  }
  function botsOf(br) {
    if (br.ok && Array.isArray(br.data)) return br.data;
    if (br.ok && br.data && Array.isArray(br.data.bots)) return br.data.bots;
    return [];
  }

  // Routage de démarrage : décide entre le WIZARD d'onboarding (premier lancement,
  // reprise, retour Stripe pendant l'onboarding) et le BACK-OFFICE classique
  // (inchangé). Un compte non connecté entre par le wizard (écran welcome/auth).
  function routeFirstRun() {
    call('GET', '/status').then(function (res) {
      state.connected = !!(res.data && res.data.connected);
      state.account = (res.data && res.data.account) ? res.data.account : null;
      var onb = onbConfig();
      var stripeReturn = CFG.returnBot && (CFG.returnStatus === 'success' || CFG.returnStatus === 'cancel');
      var ctx = { stripe: stripeReturn ? CFG.returnStatus : '', returnBot: CFG.returnBot, step: CFG.returnStep };

      if (!state.connected) { startOnboarding(onb, ctx); return; }

      // Connecté : la décision « first-run » dépend de la liste des bots.
      call('GET', '/bots').then(function (br) {
        state.bots = botsOf(br);
        var hasBots = state.bots.length > 0;
        var firstRun = (onb.done !== true) && (!hasBots || !!onb.bot_id);
        var resumeStripe = stripeReturn && onb.done !== true && onb.bot_id && onb.bot_id === CFG.returnBot;

        if (window.CBOOnboarding && (firstRun || resumeStripe)) { startOnboarding(onb, ctx); return; }

        // Back-office classique (INCHANGÉ), reprise au retour Stripe incluse.
        if (stripeReturn) {
          state.view = 'bot'; state.botId = CFG.returnBot; state.botTab = 'payment';
          if (CFG.returnStatus === 'success') {
            state.notice = { msg: 'Paiement reçu. Activation en cours…', type: 'ok' };
            pollBillingActive(CFG.returnBot);
          } else {
            state.notice = { msg: 'Paiement annulé. Vous pouvez relancer la souscription.', type: 'warn' };
          }
        } else {
          state.view = 'bots';
        }
        render();
        loadAccount();
      });
    });
  }

  // Lance le wizard (vue 'onboarding'). Filet : si onboarding.js n'a pas chargé,
  // on retombe sur le back-office / l'écran de connexion sans casser la page.
  function startOnboarding(onb, ctx) {
    if (!window.CBOOnboarding) {
      state.view = state.connected ? 'bots' : 'connect';
      render();
      if (state.connected) loadBots();
      return;
    }
    state.view = 'onboarding';
    CBOOnboarding.init(onb, ctx || {});
    render();
    if (state.connected) loadAccount();
  }

  // Le wizard rend la main au back-office (compte existant, parcours terminé…).
  function exitOnboarding(notice, type) {
    state.view = 'bots';
    state.onb = null;
    render();
    if (notice) setNotice(notice, type || 'ok');
    loadBots();
  }

  // Bouton « Démarrer un nouveau bot » du back-office : relance le wizard au choix
  // de la source (compte déjà connecté, donc on saute welcome/auth).
  function startNewOnboarding() {
    call('POST', '/onboarding', { done: false, bot_id: '', step: 'choose' });
    startOnboarding({ done: false, bot_id: '', step: 'choose' }, { fresh: true });
  }

  /* ------------------------------------------------------------------ boot */

  // Cette page est-elle la POPUP OAuth ouverte par l'opener ?
  function isOAuthPopup() {
    try { return !!(window.opener && window.opener !== window && window.name === 'chapote_oauth'); }
    catch (e) { return false; }
  }
  // Dans la popup : échange le code, prévient l'opener (postMessage même origine)
  // puis se ferme. L'opener (openOAuthPopup) avance alors le wizard / le back-office.
  function runOAuthPopupCallback() {
    var cb = readOAuthCallback();
    function tell(status) {
      try { window.opener.postMessage({ source: 'chapote-oauth', status: status }, window.location.origin); } catch (e) {}
      try { window.close(); } catch (e) {}
    }
    cleanUrl();
    if (!cb || cb.error) { tell('error'); return; }
    call('POST', '/connect/callback', { code: cb.code, state: cb.state }).then(function (res) {
      tell((res.ok && res.data && res.data.status === 'connected') ? 'connected' : 'error');
    });
  }

  // Retour OAuth PLEINE PAGE (repli quand la popup est bloquée) : on nettoie l'URL,
  // on échange le code côté serveur, puis routeFirstRun route correctement
  // (wizard ou back-office) selon l'état réel.
  function handleOAuthCallback(cb) {
    cleanUrl();
    if (cb.error) {
      routeFirstRun();
      setNotice('Connexion annulée ou refusée (' + cb.error + '). Vous pouvez réessayer.', 'warn');
      return;
    }
    state.connected = false;
    render();
    setNotice('Finalisation de la connexion…', 'info');
    call('POST', '/connect/callback', { code: cb.code, state: cb.state }).then(function (res) {
      if (res.ok && res.data && res.data.status === 'connected') {
        routeFirstRun();
        setNotice('Connexion réussie.', 'ok');
        return;
      }
      state.connected = false;
      if (state.view !== 'onboarding') state.view = 'connect';
      render();
      setNotice(apiMsg(res, 'Échec de la connexion. Relancez « Se connecter avec Chapote ».'), 'warn');
    });
  }

  function boot() {
    if (isOAuthPopup()) { runOAuthPopupCallback(); return; }
    if (!root) return;
    var cb = readOAuthCallback();
    if (cb) { handleOAuthCallback(cb); return; }
    routeFirstRun();
  }

  // Bridge consommé par onboarding.js (le wizard RÉUTILISE le back-office :
  // configurateur d'offre, checkout, polling d'activation, navigation).
  window.CBOAdmin = {
    state: state,
    render: render,
    setNotice: setNotice,
    loadBots: loadBots,
    loadAccount: loadAccount,
    openBot: openBot,
    startConnect: startConnect,
    buildPaymentForm: buildPaymentForm,
    doCheckout: doCheckout,
    pollBillingActive: pollBillingActive,
    exitOnboarding: exitOnboarding
  };

  // boot différé d'un tick : laisse onboarding.js (chargé APRÈS admin.js) enregistrer
  // window.CBOOnboarding avant le routage first-run (les deux globals coexistent).
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 0); });
  else setTimeout(boot, 0);
})();
