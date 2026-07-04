/**
 * Chapote Bot Manager — SPA admin en vanilla JS (aucune étape de build).
 *
 * Le navigateur ne parle JAMAIS à Chapote directement : il appelle le proxy
 * REST WordPress (CHAPOTE_BO.restBase) avec le nonce wp_rest. Le token reste
 * côté serveur, chiffré. Tout le HTML est construit via createElement (textNode)
 * pour neutraliser toute injection.
 */
(function () {
  'use strict';

  var wpI18n = (window.wp && window.wp.i18n) || null;
  var __ = wpI18n ? wpI18n.__ : function (s) { return s; };
  var _sprintf = wpI18n ? wpI18n.sprintf : function (s) { var a = Array.prototype.slice.call(arguments, 1), i = 0; return s.replace(/%s/g, function () { return a[i++]; }); };

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

  // Note TVA statique (le catalogue LIVE ne porte pas de tax_note racine).
  var TAX_NOTE = __('VAT not applicable, art. 293 B of the French Tax Code (CGI)', 'chapote-bot-manager');

  // URL du dashboard Chapote (app) : on s'appuie UNIQUEMENT sur app_base, jamais
  // sur api_base (l'hôte API ne sert pas le dashboard et renverrait une page
  // d'erreur). Si app_base n'est pas configuré, on renvoie null et l'appelant
  // affiche une note explicative au lieu d'un lien cassé.
  function appDashboardUrl() {
    return (typeof CFG.appBase === 'string' && CFG.appBase) ? (CFG.appBase + '/app') : null;
  }

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
        h('button', { type: 'button', class: 'cbo-notice-x', 'aria-label': __('Close', 'chapote-bot-manager'), onClick: function () { setNotice(null); } }, '×')
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
    setNotice(__('Session expired. Please sign in again.', 'chapote-bot-manager'), 'warn');
  };

  /* ------------------------------------------------------------------- shell */

  var root = document.getElementById('chapote-bo-app');
  var noticeHost = null;

  function render() {
    if (!root) return;
    var fk = currentFocusKey();   // relève le focus logique AVANT le clear
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
      left.appendChild(navBtn(__('My bots', 'chapote-bot-manager'), state.view !== 'bot' && state.view !== 'seo', function () { state.view = 'bots'; state.botId = null; render(); }));
      left.appendChild(navBtn(__('SEO', 'chapote-bot-manager'), state.view === 'seo', function () { state.view = 'seo'; state.botId = null; render(); }));
    }
    nav.appendChild(left);
    var right = h('div', { class: 'cbo-nav-right' });
    if (state.connected) {
      right.appendChild(h('span', { class: 'cbo-dot cbo-dot-ok' }));
      /* translators: %s: email address of the connected Chapote account */
      var conn = (state.account && state.account.email)
        ? _sprintf(__('Connected to Chapote — %s', 'chapote-bot-manager'), state.account.email)
        : __('Connected to Chapote', 'chapote-bot-manager');
      right.appendChild(h('span', { class: 'cbo-conn', text: conn }));
      right.appendChild(h('button', { class: 'button', onClick: disconnect }, __('Log out', 'chapote-bot-manager')));
    } else {
      right.appendChild(h('span', { class: 'cbo-dot cbo-dot-off' }));
      right.appendChild(h('span', { class: 'cbo-conn', text: __('Not connected', 'chapote-bot-manager') }));
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
    wrap.appendChild(h('h2', { text: __('Sign in with Chapote', 'chapote-bot-manager') }));
    wrap.appendChild(h('p', { class: 'cbo-muted', text:
      __('Connect this site to your Chapote account to manage your bots, their appearance, billing and widget activation.', 'chapote-bot-manager') }));
    if (CFG.cryptoOk === false) {
      wrap.appendChild(h('p', { class: 'cbo-error', text:
        __('OpenSSL (AES-256-GCM) is unavailable: your credentials cannot be stored encrypted.', 'chapote-bot-manager') }));
    }
    wrap.appendChild(h('p', { class: 'cbo-muted', text:
      __('You will be redirected to Chapote to authorize this site, then brought back here automatically.', 'chapote-bot-manager') }));
    var info = h('div', { class: 'cbo-device' });
    wrap.appendChild(info);
    var btn = h('button', { class: 'button button-primary button-hero', disabled: CFG.cryptoOk === false,
      onClick: function () { startConnect(btn, info); } }, __('Sign in with Chapote', 'chapote-bot-manager'));
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
    info.appendChild(loadingNote(__('Opening the Chapote window…', 'chapote-bot-manager')));
    call('GET', '/connect/url').then(function (res) {
      if (!res.ok || !res.data || !res.data.url) {
        btn.disabled = (CFG.cryptoOk === false);
        clear(info);
        // Propage la cause réelle (le proxy renvoie p.ex. crypto_unavailable) ;
        // pas de renvoi vers des « réglages » : le plugin n'expose pas d'écran de
        // configuration d'adresses (elles sont définies à l'installation).
        info.appendChild(h('p', { class: 'cbo-error', text:
          apiMsg(res, __('Could not start the connection to Chapote. Please try again in a moment.', 'chapote-bot-manager')) }));
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

    if (info) { clear(info); info.appendChild(loadingNote(__('Finish signing in in the Chapote window…', 'chapote-bot-manager'))); }
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
      else { finish(false); setNotice(__('Sign-in canceled or denied. You can try again.', 'chapote-bot-manager'), 'warn'); }
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
      setNotice(__('Signed in successfully.', 'chapote-bot-manager'), 'ok');
      loadAccount();
      loadBots();
    }
  }

  function disconnect() {
    call('POST', '/disconnect').then(function () {
      state.connected = false; state.account = null; state.bots = []; state.view = 'connect';
      render();
      setNotice(__('Signed out.', 'chapote-bot-manager'), 'info');
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
      h('h2', { text: __('My bots', 'chapote-bot-manager') }),
      h('div', { class: 'cbo-row-actions' },
        window.CBOOnboarding ? h('button', { class: 'button button-primary', onClick: startNewOnboarding }, __('Start a new bot', 'chapote-bot-manager')) : null,
        h('button', { class: 'button', onClick: openCreate }, __('Create a bot (manual)', 'chapote-bot-manager'))
      )
    );
    wrap.appendChild(head);
    wrap.appendChild(h('div', { class: 'cbo-create', id: 'cbo-create' }));

    if (!state.bots.length) {
      wrap.appendChild(h('p', { class: 'cbo-muted', text: __('No bots yet. Create one to get started.', 'chapote-bot-manager') }));
      return wrap;
    }

    var table = h('table', { class: 'widefat striped cbo-table' });
    table.appendChild(h('thead', null, h('tr', null,
      h('th', { text: __('Name', 'chapote-bot-manager') }), h('th', { text: __('On the site', 'chapote-bot-manager') }), h('th', { text: __('Billing', 'chapote-bot-manager') }),
      h('th', { text: __('Plan / modules', 'chapote-bot-manager') }), h('th', { text: '' })
    )));
    var tb = h('tbody');
    state.bots.forEach(function (b) {
      var modules = Array.isArray(b.modules) ? b.modules.join(', ') : (b.modules ? String(b.modules) : '—');
      tb.appendChild(h('tr', null,
        h('td', null, h('strong', { text: b.name || __('(unnamed)', 'chapote-bot-manager') })),
        h('td', null, activationToggle(b, { compact: true })),
        h('td', null, billingBadge(b.billing_status)),
        h('td', { text: modules }),
        h('td', null, h('button', { class: 'button', onClick: function () { openBot(b.id); } }, __('Manage', 'chapote-bot-manager')))
      ));
    });
    table.appendChild(tb);
    wrap.appendChild(table);

    var dash = appDashboardUrl();
    wrap.appendChild(h('p', { class: 'cbo-muted cbo-deeplink' },
      __('The conversation tree, the knowledge base and security are configured in the Chapote dashboard', 'chapote-bot-manager'),
      dash ? ': ' : __(' (open the Chapote dashboard from your browser).', 'chapote-bot-manager'),
      dash ? h('a', { href: dash, target: '_blank', rel: 'noopener', text: __('open the dashboard', 'chapote-bot-manager') }) : null,
      dash ? '.' : null
    ));
    return wrap;
  }

  function billingBadge(status) {
    // billing_status null/undefined = bot servable sans abonnement payant = « Gratuit ».
    if (status == null || status === '') return h('span', { class: 'cbo-badge cbo-badge-off', text: __('Free', 'chapote-bot-manager') });
    var map = { active: [__('Active', 'chapote-bot-manager'), 'ok'], trialing: [__('Trial', 'chapote-bot-manager'), 'ok'], inactive: [__('Inactive', 'chapote-bot-manager'), 'off'], past_due: [__('Past due', 'chapote-bot-manager'), 'warn'], canceled: [__('Canceled', 'chapote-bot-manager'), 'off'], suspended: [__('Blocked', 'chapote-bot-manager'), 'warn'] };
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
    /* translators: %s: bot name */
    var switchLabel = bot.name
      ? _sprintf(__('Show the “%s” widget on the site', 'chapote-bot-manager'), bot.name)
      : __('Show the widget on the site', 'chapote-bot-manager');
    var cb = h('input', { type: 'checkbox', checked: !!bot.enabled, role: 'switch',
      'aria-checked': bot.enabled ? 'true' : 'false', 'aria-label': switchLabel });
    if (blocked) { cb.disabled = true; cb.title = __('Bot blocked: the widget is turned off.', 'chapote-bot-manager'); }
    var txt = opts.compact ? null
      : h('span', { text: bot.enabled ? __('Shown on the site', 'chapote-bot-manager') : __('Show on the site', 'chapote-bot-manager') });
    cb.addEventListener('change', function () {
      var want = cb.checked;
      cb.disabled = true;
      call('POST', '/bots/' + encodeURIComponent(bot.id) + '/local', { enabled: want }).then(function (res) {
        cb.disabled = blocked;
        if (res.ok) {
          bot.enabled = !!(res.data && res.data.enabled);
          cb.checked = bot.enabled;
          syncSwitch(cb);
          if (txt) txt.textContent = bot.enabled ? __('Shown on the site', 'chapote-bot-manager') : __('Show on the site', 'chapote-bot-manager');
          setNotice(bot.enabled ? __('Widget enabled on the site.', 'chapote-bot-manager') : __('Widget disabled on the site.', 'chapote-bot-manager'), 'ok');
          if (typeof opts.onChange === 'function') opts.onChange(bot.enabled);
        } else {
          cb.checked = !want; // revert visuel
          syncSwitch(cb);
          setNotice(__('Action failed.', 'chapote-bot-manager'), 'warn');
        }
      });
    });
    var label = h('label', { class: 'cbo-check cbo-actoggle' }, cb);
    if (txt) label.appendChild(txt);
    if (blocked && !opts.compact) label.appendChild(h('span', { class: 'cbo-muted', text: __(' — blocked', 'chapote-bot-manager') }));
    return label;
  }

  function openCreate() {
    var box = document.getElementById('cbo-create');
    if (!box) return;
    if (box.childNodes.length) { clear(box); return; }
    var name = h('input', { type: 'text', class: 'regular-text', placeholder: __('Bot name', 'chapote-bot-manager'), maxlength: 80, 'aria-label': __('Bot name', 'chapote-bot-manager') });
    var mode = h('select', { 'aria-label': __('Bot type', 'chapote-bot-manager') },
      h('option', { value: 'hybrid' }, __('Hybrid (tree + AI)', 'chapote-bot-manager')),
      h('option', { value: 'tree' }, __('Tree only', 'chapote-bot-manager')),
      h('option', { value: 'ai' }, __('AI only', 'chapote-bot-manager'))
    );
    // Bouton capturé en variable pour le désactiver pendant la requête : un
    // double-clic ne crée pas deux bots. Réactivé dans tous les chemins
    // de sortie (succès = re-render via loadBots, échec/réseau = ré-activation).
    var createBtn = h('button', { class: 'button button-primary', onClick: function () {
      var nm = (name.value || '').trim();
      if (!nm) { setNotice(__('Give the bot a name.', 'chapote-bot-manager'), 'warn'); return; }
      createBtn.disabled = true;
      call('POST', '/bots', { name: nm, mode: mode.value }).then(function (res) {
        createBtn.disabled = false;
        if (!res.ok) { setNotice(apiMsg(res, __('Could not create the bot.', 'chapote-bot-manager')), 'warn'); return; }
        setNotice(__('Bot created.', 'chapote-bot-manager'), 'ok');
        loadBots();
      });
    } }, __('Create', 'chapote-bot-manager'));
    box.appendChild(h('div', { class: 'cbo-create-row' },
      name, mode,
      createBtn,
      h('button', { class: 'button', onClick: function () { clear(box); } }, __('Cancel', 'chapote-bot-manager'))
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
      h('button', { class: 'button-link', onClick: function () { state.view = 'bots'; render(); } }, __('← My bots', 'chapote-bot-manager')),
      h('h2', { text: bot.name || __('Bot', 'chapote-bot-manager') }),
      billingBadge(bot.billing_status),
      h('span', { class: 'cbo-bothead-toggle' }, activationToggle(bot, {}))
    ));
    var tabs = h('div', { class: 'cbo-subtabs', role: 'tablist', 'aria-label': __('Bot settings', 'chapote-bot-manager') },
      subTab(__('Page targeting', 'chapote-bot-manager'), 'activation'),
      subTab(__('My plan', 'chapote-bot-manager'), 'payment'),
      subTab(__('Appearance', 'chapote-bot-manager'), 'appearance')
    );
    wireTablistKeys(tabs);
    wrap.appendChild(tabs);
    // Le pane est le tabpanel piloté par l'onglet actif (aria-controls/labelledby).
    var pane = h('div', { class: 'cbo-pane', id: 'cbo-pane', role: 'tabpanel', tabindex: '0',
      'aria-labelledby': 'cbo-subtab-' + state.botTab });
    wrap.appendChild(pane);

    if (state.botTab === 'payment') renderPayment(pane);
    else if (state.botTab === 'appearance') renderAppearance(pane);
    else renderActivation(pane); // 'activation' par défaut
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
    pane.appendChild(loadingNote(__('Loading appearance…', 'chapote-bot-manager')));
    call('GET', '/bots/' + encodeURIComponent(state.botId)).then(function (res) {
      if (!res.ok) { clear(pane); pane.appendChild(h('p', { class: 'cbo-error', text: __('Could not load this bot.', 'chapote-bot-manager') })); return; }
      var design = (res.data && res.data.design_json) || {};
      var botName = res.data.name || __('Assistant', 'chapote-bot-manager');
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
        field(__('Primary color', 'chapote-bot-manager'), colorInput('primaryColor', '#0d9488')),
        field(__('Secondary color', 'chapote-bot-manager'), colorInput('secondaryColor', '#0d9488'))
      ),
      h('div', { class: 'cbo-row2' },
        field(__('Position', 'chapote-bot-manager'), selectInput('position', [['right', __('Right', 'chapote-bot-manager')], ['left', __('Left', 'chapote-bot-manager')]], 'right')),
        field(__('Size', 'chapote-bot-manager'), selectInput('size', [['sm', __('Small', 'chapote-bot-manager')], ['md', __('Medium', 'chapote-bot-manager')], ['lg', __('Large', 'chapote-bot-manager')]], 'md'))
      ),
      field(__('Chat title', 'chapote-bot-manager'), textInput('title', botName, 100)),
      field(__('Welcome message', 'chapote-bot-manager'), (function () {
        var ta = h('textarea', { rows: 2, maxlength: 500, class: 'large-text' }); ta.value = d.welcomeMessage || '';
        ta.addEventListener('input', function () { d.welcomeMessage = ta.value; refresh(); });
        return ta;
      })()),
      field(__('Input placeholder', 'chapote-bot-manager'), textInput('placeholder', __('Type your message…', 'chapote-bot-manager'), 100)),
      field(__('Launcher text', 'chapote-bot-manager'), textInput('launcherText', __('e.g. Any questions?', 'chapote-bot-manager'), 40)),
      field(__('Interface language', 'chapote-bot-manager'), selectInput('locale', [['fr', __('French', 'chapote-bot-manager')], ['en', __('English', 'chapote-bot-manager')], ['auto', __('Auto (browser)', 'chapote-bot-manager')]], 'fr')),
      h('div', { class: 'cbo-checks' },
        checkInput('darkMode', __('Dark mode', 'chapote-bot-manager'), false),
        checkInput('greeting', __('Greeting bubble', 'chapote-bot-manager'), false),
        checkInput('poweredBy', __('Show “Powered by Chapote”', 'chapote-bot-manager'), false)
      ),
      h('div', { class: 'cbo-actions' },
        h('button', { class: 'button button-primary', onClick: function (e) { saveAppearance(e.target, d); } }, __('Save appearance', 'chapote-bot-manager'))
      )
    );

    grid.appendChild(form);
    grid.appendChild(h('div', { class: 'cbo-previewcol' }, h('div', { class: 'cbo-muted', text: __('Preview', 'chapote-bot-manager') }), preview));
    pane.appendChild(grid);
    refresh();
  }

  function saveAppearance(btn, design) {
    btn.disabled = true;
    // Copie superficielle : on omet `poweredBy` quand il est falsy pour éviter le
    // 402 (gate White-label côté API). L'objet `design` d'origine n'est pas muté
    // (il pilote l'aperçu live).
    var payload = Object.assign({}, design);
    if (!payload.poweredBy) { delete payload.poweredBy; }
    call('POST', '/bots/' + encodeURIComponent(state.botId) + '/appearance', { design_json: payload }).then(function (res) {
      btn.disabled = false;
      if (res.ok) setNotice(__('Appearance saved.', 'chapote-bot-manager'), 'ok');
      else setNotice(__('Could not save the appearance.', 'chapote-bot-manager'), 'warn');
    });
  }

  /* -------------------------------------------------------------- paiement */

  function renderPayment(pane) {
    clear(pane);
    pane.appendChild(loadingNote(__('Loading your plan…', 'chapote-bot-manager')));
    // Bot + catalogue LIVE en parallèle. Le catalogue (prix/paliers/modules) est
    // la SOURCE UNIQUE backend (proxy /catalog -> GET /api/account/catalog) : plus
    // aucun repli de prix codé en dur côté plugin. Si le proxy échoue, on affiche
    // un état d'erreur PROPRE.
    Promise.all([
      call('GET', '/bots/' + encodeURIComponent(state.botId)),
      call('GET', '/catalog')
    ]).then(function (r) {
      var botRes = r[0], catRes = r[1];
      if (!botRes.ok) { clear(pane); pane.appendChild(h('p', { class: 'cbo-error', text: __('Could not load this bot.', 'chapote-bot-manager') })); return; }
      // billing OFF renvoie {billing:'disabled'} (sans `modules`) : le compter comme
      // « live » pour que buildPaymentForm atteigne sa branche dédiée (compte sans
      // facturation), sinon le tableau de modules est requis.
      var live = (catRes.ok && catRes.data && (Array.isArray(catRes.data.modules) || catRes.data.billing === 'disabled')) ? catRes.data : null;
      if (!live) {
        clear(pane);
        pane.appendChild(h('p', { class: 'cbo-error', text: __('Catalog unavailable right now — please try again in a moment.', 'chapote-bot-manager') }));
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
        h('strong', { text: __('Billing disabled.', 'chapote-bot-manager') }),
        ' ' + __('Billing is disabled on this Chapote account: no subscription is required for this bot.', 'chapote-bot-manager')
      ));
      return;
    }

    var active = bot.billing_status === 'active';
    if (active) {
      pane.appendChild(h('div', { class: 'cbo-statusline' },
        h('strong', { text: __('Subscription active.', 'chapote-bot-manager') }),
        ' ' + __('You can change your plan or cancel below.', 'chapote-bot-manager')
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
        return (m && m.label) || (k === 'ai' ? __('AI', 'chapote-bot-manager') : k);
      });
      /* translators: %s: comma-separated list of module names */
      reqWarn.appendChild(h('p', { class: 'cbo-hint cbo-reqwarn-msg', text:
        _sprintf(__('Modules removed: %s. Tree sections that depend on them will be deleted when you subscribe.', 'chapote-bot-manager'), names.join(', ')) }));
    }

    function recompute() {
      if (requiresAi() && aiMode === 'off') aiMode = 'managed';
      renderModules(); renderAi(); renderTotal(); renderReqWarn();
    }

    function renderModules() {
      clear(modBox);
      modBox.appendChild(h('h3', { text: __('Modules', 'chapote-bot-manager') }));
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
          h('span', { class: 'cbo-modprice', text: _sprintf(__('%s /month', 'chapote-bot-manager'), euros(m.price_cents)) }),
          (m.requires && m.requires.indexOf('ai') !== -1) ? h('span', { class: 'cbo-modtag', text: __('AI required', 'chapote-bot-manager') }) : null
        ));
      });
    }

    function renderAi() {
      clear(aiBox);
      aiBox.appendChild(h('h3', { text: __('Artificial intelligence', 'chapote-bot-manager') }));
      var modes = [['off', __('No AI', 'chapote-bot-manager')], ['managed', __('AI included (quota)', 'chapote-bot-manager')], ['byok', __('AI with my own key (BYOK)', 'chapote-bot-manager')]];
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
            /* translators: %s: number of AI replies included per month */
            h('span', { text: _sprintf(__('%s replies/month', 'chapote-bot-manager'), (t.included_replies || 0).toLocaleString('fr-FR')) }),
            h('span', { class: 'cbo-modprice', text: _sprintf(__('%s /month', 'chapote-bot-manager'), euros(t.price_cents)) })
          ));
        });
        aiBox.appendChild(tiers);
      } else if (aiMode === 'byok') {
        /* translators: %s: monthly price */
        aiBox.appendChild(h('p', { class: 'cbo-hint', text: _sprintf(__('With your own key: %s /month, unlimited replies (key configured in the dashboard).', 'chapote-bot-manager'), euros(byokCents)) }));
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
        // pas ajouté ici. Aligne l'estimation sur les line_items Stripe.
        total += (catalog.base_price_cents || 0);
      }
      return total;
    }

    function renderTotal() {
      clear(totalLine);
      totalLine.appendChild(h('span', { text: __('Estimate: ', 'chapote-bot-manager') }));
      totalLine.appendChild(h('strong', { text: _sprintf(__('%s /month', 'chapote-bot-manager'), euros(estimate())) }));
      /* translators: %s: VAT note */
      totalLine.appendChild(h('span', { class: 'cbo-muted', text: _sprintf(__(' (%s). Actual price applied by Stripe.', 'chapote-bot-manager'), TAX_NOTE) }));
    }

    var consent = h('input', { type: 'checkbox' });
    var consentLine = h('label', { class: 'cbo-check cbo-consent' }, consent,
      h('span', { text: __('I agree to the subscription starting immediately and waive my 14-day right of withdrawal.', 'chapote-bot-manager') }));

    var subscribeBtn = h('button', { class: 'button button-primary button-hero',
      onClick: function () {
        if (typeof opts.onSubscribe === 'function') opts.onSubscribe(buildConfig(), consent.checked, subscribeBtn);
        else doCheckout(subscribeBtn, buildConfig(), consent.checked);
      } },
      opts.submitLabel || (active ? __('Update plan', 'chapote-bot-manager') : __('Subscribe', 'chapote-bot-manager')));
    // 1re souscription : le consentement 14j (exécution immédiate, B2C) est
    // OBLIGATOIRE -> bouton DÉSACTIVÉ tant qu'il n'est pas coché.
    if (!active) {
      var syncConsent = function () {
        subscribeBtn.disabled = !consent.checked;
        subscribeBtn.title = consent.checked ? '' : __('Check the consent box above to subscribe.', 'chapote-bot-manager');
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
        onClick: function (e) { updateSubscription(e.currentTarget, buildConfig()); } }, __('Change plan (prorated)', 'chapote-bot-manager')));
      actions.appendChild(confirmButton(__('Cancel subscription', 'chapote-bot-manager'), __('Confirm cancellation', 'chapote-bot-manager'), cancelSubscription));
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
    if (!consent) { setNotice(__('Check the immediate-start consent box to subscribe.', 'chapote-bot-manager'), 'warn'); return; }
    btn.disabled = true;
    call('POST', '/bots/' + encodeURIComponent(state.botId) + '/checkout', { config: config, consent: true }).then(function (res) {
      btn.disabled = false;
      if (res.ok && res.data && res.data.checkout_url) {
        window.location.href = res.data.checkout_url; // redirection Stripe hébergé
        return;
      }
      setNotice(apiMsg(res, __('Could not open the payment page.', 'chapote-bot-manager')), 'warn');
    });
  }

  // btn désactivé pendant la requête (anti double-soumission) et ré-activé
  // dans tous les chemins (succès = re-render via loadBots, échec/réseau).
  function updateSubscription(btn, config) {
    if (btn) btn.disabled = true;
    call('POST', '/bots/' + encodeURIComponent(state.botId) + '/subscription/update', { config: config }).then(function (res) {
      if (btn) btn.disabled = false;
      if (res.ok) { setNotice(__('Plan updated.', 'chapote-bot-manager'), 'ok'); loadBots(); }
      else setNotice(apiMsg(res, __('Could not update the plan.', 'chapote-bot-manager')), 'warn');
    });
  }
  function cancelSubscription(btn) {
    if (btn) btn.disabled = true;
    call('POST', '/bots/' + encodeURIComponent(state.botId) + '/subscription/cancel').then(function (res) {
      if (btn) btn.disabled = false;
      if (res.ok) { setNotice(__('Subscription canceled.', 'chapote-bot-manager'), 'info'); loadBots(); }
      else setNotice(apiMsg(res, __('Could not cancel the subscription.', 'chapote-bot-manager')), 'warn');
    });
  }

  // Polling d'activation après retour Stripe : borné à POLL_MAX essais. À
  // l'expiration on ne laisse PAS la notice trompeuse « Activation en cours… »
  // mais un message clair invitant à recharger / contacter le support.
  var POLL_MAX = 12;
  function pollBillingActive(botId) {
    var tries = 0;
    (function loop() {
      tries++;
      call('GET', '/bots/' + encodeURIComponent(botId)).then(function (res) {
        if (res.ok && res.data && res.data.billing_status === 'active') {
          setNotice(__('Subscription active. You can enable the widget on the site (Page targeting tab).', 'chapote-bot-manager'), 'ok');
          loadBots(); // rafraîchit le badge + le pane courant
          return;
        }
        if (tries < POLL_MAX) { setTimeout(loop, 3000); return; }
        // Borne atteinte : le paiement est encaissé mais l'activation (webhook
        // Stripe) tarde. On remplace la notice « en cours » par un message net.
        setNotice(__('Payment received, but activation is taking longer than expected. Reload the page in a moment; if the bot remains inactive, contact support.', 'chapote-bot-manager'), 'warn');
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
        pane.appendChild(h('p', { class: 'cbo-error', text: __('Could not load targeting for this bot — please try again in a moment.', 'chapote-bot-manager') }));
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
          __('This bot runs in free mode (no active paid subscription): AI replies are limited to the free quota. You can still enable it on the site.', 'chapote-bot-manager') + ' ',
          h('button', { type: 'button', class: 'cbo-linkbtn', onClick: function () { state.botTab = 'payment'; render(); } }, __('See “My plan”', 'chapote-bot-manager'))
        )
      ));
    }

    // Cet onglet ne gère QUE le ciblage des pages.
    pane.appendChild(h('p', { class: 'cbo-muted', text:
      __('Whether the widget is shown on the site (on/off) is controlled with the switch at the top of this page, or in “My bots”. Below: choose which pages it appears on.', 'chapote-bot-manager') }));

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
        wrap.appendChild(h('span', { class: 'cbo-muted', text: __('No public content types detected.', 'chapote-bot-manager') }));
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
    var includeIds = h('input', { type: 'text', class: 'regular-text', value: (t.include_ids || []).join(', '), placeholder: __('e.g. 12, 34', 'chapote-bot-manager') });
    var excludeIds = h('input', { type: 'text', class: 'regular-text', value: (t.exclude_ids || []).join(', '), placeholder: __('e.g. 7, 99', 'chapote-bot-manager') });

    customBox.appendChild(h('h3', { class: 'cbo-custom-h', text: __('Show on', 'chapote-bot-manager') }));
    customBox.appendChild(h('label', { class: 'cbo-check' }, frontCb, h('span', { text: __('Homepage', 'chapote-bot-manager') })));
    customBox.appendChild(fieldGroup(__('Content types to include', 'chapote-bot-manager'), inc.wrap));
    customBox.appendChild(fieldFor(__('Content IDs to include', 'chapote-bot-manager'), includeIds));

    // Exclusions (PRIORITAIRES sur toute inclusion).
    customBox.appendChild(h('h3', { class: 'cbo-custom-h', text: __('Never show on (takes priority)', 'chapote-bot-manager') }));
    customBox.appendChild(fieldGroup(__('Content types to exclude', 'chapote-bot-manager'), exc.wrap));
    customBox.appendChild(fieldFor(__('Content IDs to exclude', 'chapote-bot-manager'), excludeIds));
    customBox.appendChild(h('p', { class: 'cbo-hint', text: __('An exclusion (type or ID) always overrides an inclusion.', 'chapote-bot-manager') }));

    pane.appendChild(fieldGroup(__('Where should the widget appear?', 'chapote-bot-manager'),
      h('div', { class: 'cbo-targetmodes' },
        h('label', { class: 'cbo-radio' }, modeEverywhere, h('span', { text: __('Entire site', 'chapote-bot-manager') })),
        h('label', { class: 'cbo-radio' }, modeCustom, h('span', { text: __('Custom pages', 'chapote-bot-manager') }))
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
      } }, __('Save targeting', 'chapote-bot-manager'))
    ));

    // Rappel domaine : pour que le widget réponde aux visiteurs, ce domaine doit
    // être autorisé côté Chapote.
    pane.appendChild(h('div', { class: 'cbo-domain' },
      h('h3', { class: 'cbo-custom-h', text: __('Allow this domain in Chapote', 'chapote-bot-manager') }),
      h('p', { class: 'cbo-muted', text: __('For the widget to answer visitors, add this domain to your bot’s allowed domains (Security tab in Chapote):', 'chapote-bot-manager') }),
      h('code', { class: 'cbo-host', text: CFG.siteHost || '' }),
      h('p', { class: 'cbo-muted', text: __('Security (allowed domains, captcha, limits) is managed on the Chapote side, not in WordPress.', 'chapote-bot-manager') }),
      h('p', null, (function () {
        var dash = appDashboardUrl();
        return dash
          ? h('a', { href: dash, target: '_blank', rel: 'noopener', text: __('Open the Chapote dashboard', 'chapote-bot-manager') })
          : h('span', { class: 'cbo-muted', text: __('Open the Chapote dashboard from your browser (app address not configured).', 'chapote-bot-manager') });
      })())
    ));
  }

  // Enregistre UNIQUEMENT le ciblage (on omet `enabled` -> l'état d'affichage est
  // préservé côté serveur ; il se règle via le toggle de l'en-tête / « Mes bots »).
  function saveActivation(btn, targeting) {
    btn.disabled = true;
    call('POST', '/bots/' + encodeURIComponent(state.botId) + '/local', { targeting: targeting }).then(function (res) {
      btn.disabled = false;
      if (res.ok) setNotice(__('Targeting saved.', 'chapote-bot-manager'), 'ok');
      else setNotice(__('Could not save.', 'chapote-bot-manager'), 'warn');
    });
  }

  /* ------------------------------------------------------------------- SEO */
  // Leviers SEO rendus CÔTÉ SERVEUR (crawlables), pilotés par l'option WP
  // chapote_bo_seo : lien « Powered by » opt-in + FAQ JSON-LD (schema.org).
  function renderSeo() {
    var wrap = h('div', { class: 'cbo-card' });
    wrap.appendChild(h('h2', { text: __('SEO (search visibility)', 'chapote-bot-manager') }));
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
    wrap.appendChild(h('h2', { text: __('SEO (search visibility)', 'chapote-bot-manager') }));
    wrap.appendChild(h('p', { class: 'cbo-muted', text:
      __('These features are rendered server-side (visible to search engines), unlike the JavaScript-loaded widget.', 'chapote-bot-manager') }));

    // 1) Backlink opt-in.
    var poweredCb = h('input', { type: 'checkbox', checked: !!seo.powered_by });
    wrap.appendChild(h('div', { class: 'cbo-field' },
      h('h3', { text: __('“Chatbot by Chapote” link', 'chapote-bot-manager') }),
      h('label', { class: 'cbo-check' }, poweredCb,
        h('span', { text: __('Show a small crawlable link to Chapote in the footer (disabled by default).', 'chapote-bot-manager') }))
    ));

    // 2) Éditeur de paires FAQ (Question / Réponse) -> JSON-LD.
    wrap.appendChild(h('h3', { text: __('FAQ (schema.org structured data)', 'chapote-bot-manager') }));
    wrap.appendChild(h('p', { class: 'cbo-muted', text:
      __('Each Question / Answer pair is published as JSON-LD (FAQPage), eligible for Google rich results.', 'chapote-bot-manager') }));

    var list = h('div', { class: 'cbo-faqlist' });
    var rows = [];

    function addRow(q, a) {
      var qInput = h('input', { type: 'text', class: 'regular-text', value: q || '', placeholder: __('Question', 'chapote-bot-manager'), maxlength: 300, 'aria-label': __('Question', 'chapote-bot-manager') });
      var aInput = h('textarea', { rows: 2, class: 'large-text', maxlength: 2000, placeholder: __('Answer', 'chapote-bot-manager'), 'aria-label': __('Answer', 'chapote-bot-manager') });
      aInput.value = a || '';
      var row = { q: qInput, a: aInput };
      rows.push(row);
      var node = h('div', { class: 'cbo-faqrow' },
        h('div', { class: 'cbo-field' }, qInput),
        h('div', { class: 'cbo-field' }, aInput),
        h('button', { type: 'button', class: 'button cbo-danger', 'aria-label': __('Remove this question', 'chapote-bot-manager'), onClick: function () {
          var i = rows.indexOf(row); if (i !== -1) rows.splice(i, 1);
          if (node.parentNode) node.parentNode.removeChild(node);
        } }, __('Remove', 'chapote-bot-manager'))
      );
      list.appendChild(node);
    }

    (seo.faq || []).forEach(function (p) { addRow(p.q, p.a); });
    wrap.appendChild(list);
    wrap.appendChild(h('p', null,
      h('button', { class: 'button', onClick: function () { addRow('', ''); } }, __('Add a question', 'chapote-bot-manager'))
    ));

    wrap.appendChild(h('div', { class: 'cbo-actions' },
      h('button', { class: 'button button-primary', onClick: function (e) {
        var faq = rows.map(function (r) {
          return { q: (r.q.value || '').trim(), a: (r.a.value || '').trim() };
        }).filter(function (p) { return p.q && p.a; });
        saveSeo(e.target, { powered_by: poweredCb.checked, faq: faq });
      } }, __('Save SEO settings', 'chapote-bot-manager'))
    ));
  }

  function saveSeo(btn, payload) {
    btn.disabled = true;
    call('POST', '/seo', payload).then(function (res) {
      btn.disabled = false;
      if (res.ok) setNotice(__('SEO settings saved.', 'chapote-bot-manager'), 'ok');
      else setNotice(__('Could not save SEO settings.', 'chapote-bot-manager'), 'warn');
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
            state.notice = { msg: __('Payment received. Activation in progress…', 'chapote-bot-manager'), type: 'ok' };
            pollBillingActive(CFG.returnBot);
          } else {
            state.notice = { msg: __('Payment canceled. You can restart the subscription.', 'chapote-bot-manager'), type: 'warn' };
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
      /* translators: %s: OAuth error code */
      setNotice(_sprintf(__('Sign-in canceled or denied (%s). You can try again.', 'chapote-bot-manager'), cb.error), 'warn');
      return;
    }
    state.connected = false;
    render();
    setNotice(__('Finishing sign-in…', 'chapote-bot-manager'), 'info');
    call('POST', '/connect/callback', { code: cb.code, state: cb.state }).then(function (res) {
      if (res.ok && res.data && res.data.status === 'connected') {
        routeFirstRun();
        setNotice(__('Signed in successfully.', 'chapote-bot-manager'), 'ok');
        return;
      }
      state.connected = false;
      if (state.view !== 'onboarding') state.view = 'connect';
      render();
      setNotice(apiMsg(res, __('Sign-in failed. Click “Sign in with Chapote” to try again.', 'chapote-bot-manager')), 'warn');
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
