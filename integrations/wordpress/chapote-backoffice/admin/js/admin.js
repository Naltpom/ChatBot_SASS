/**
 * Chapote Back-Office — SPA admin en vanilla JS (aucune étape de build).
 *
 * Le navigateur ne parle JAMAIS à Chapote directement : il appelle le proxy
 * REST WordPress (CHAPOTE_BO.restBase) avec le nonce wp_rest. Le token reste
 * côté serveur, chiffré. Tout le HTML est construit via createElement (textNode)
 * pour neutraliser toute injection.
 */
(function () {
  'use strict';

  var CFG = window.CHAPOTE_BO || {};

  /* ------------------------------------------------------------------ utils */

  function h(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'for') node.htmlFor = v;
        else if (k.indexOf('on') === 0 && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'checked' || k === 'disabled' || k === 'selected') { node[k] = !!v; }
        else if (k === 'value') { node.value = v; }
        else node.setAttribute(k, v);
      }
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) { c.forEach(function (x) { append(node, x); }); }
      else append(node, c);
    }
    return node;
  }
  function append(node, c) {
    if (c == null || c === false) return;
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function euros(cents) {
    try { return (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }); }
    catch (e) { return (cents / 100).toFixed(2) + ' €'; }
  }

  // Couleur HEX sûre (#abc ou #aabbcc) avant injection en style inline (#27) :
  // toute valeur non conforme retombe sur la couleur par défaut.
  var HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  function hexColor(v, fallback) {
    return (typeof v === 'string' && HEX_RE.test(v)) ? v : fallback;
  }

  // Note TVA statique (le catalogue LIVE ne porte pas de tax_note racine).
  var TAX_NOTE = 'TVA non applicable, art. 293 B du CGI';

  function call(method, path, body) {
    return fetch(CFG.restBase + path, {
      method: method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': CFG.nonce },
      body: body != null ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        // 401 sur un appel account = session morte → on repasse en « déconnecté ».
        if (res.status === 401 && data && (data.error === 'session_expired' || data.error === 'not_connected')) {
          if (state.connected) { state.connected = false; state.view = 'connect'; render(); setNotice('Session expirée. Reconnectez-vous.', 'warn'); }
        }
        return { status: res.status, ok: res.ok, data: data || {} };
      });
    });
  }

  /* ------------------------------------------------------------------ state */

  var state = {
    connected: false,
    account: null,     // { email, name } du compte Chapote connecté
    bots: [],
    view: 'connect',   // connect | bots | bot
    botId: null,
    botTab: 'appearance',
    poll: null,
    notice: null
  };

  // setNotice ne reconstruit PAS le corps (sinon un formulaire en cours d'édition
  // perdrait ses valeurs) : il ne repeint que la barre de notices.
  function setNotice(msg, type) { state.notice = msg ? { msg: msg, type: type || 'info' } : null; paintNotice(); }
  function paintNotice() {
    if (!noticeHost) return;
    clear(noticeHost);
    if (state.notice) {
      noticeHost.appendChild(h('div', { class: 'cbo-notice cbo-notice-' + state.notice.type },
        h('span', { text: state.notice.msg }),
        h('button', { class: 'cbo-notice-x', 'aria-label': 'Fermer', onClick: function () { setNotice(null); } }, '×')
      ));
    }
  }

  /* ------------------------------------------------------------------- shell */

  var root = document.getElementById('chapote-bo-app');
  var noticeHost = null;

  function render() {
    if (!root) return;
    clear(root);
    noticeHost = h('div', { class: 'cbo-notice-host' });
    root.appendChild(noticeHost);
    paintNotice();
    root.appendChild(renderNav());
    var body = h('div', { class: 'cbo-body' });
    root.appendChild(body);
    if (!state.connected) body.appendChild(renderConnect());
    else if (state.view === 'bot') body.appendChild(renderBot());
    else body.appendChild(renderBots());
  }

  function renderNav() {
    var nav = h('div', { class: 'cbo-nav' });
    var left = h('div', { class: 'cbo-nav-left' });
    if (state.connected) {
      left.appendChild(navBtn('Mes bots', state.view !== 'bot', function () { state.view = 'bots'; state.botId = null; render(); }));
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
    return h('button', { class: 'cbo-tab' + (active ? ' is-active' : ''), onClick: on }, label);
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
    var panel = h('div', { class: 'cbo-device' });
    wrap.appendChild(panel);
    wrap.appendChild(h('button', { class: 'button button-primary button-hero', disabled: CFG.cryptoOk === false,
      onClick: function () { startDevice(panel); } }, 'Se connecter avec Chapote'));
    return wrap;
  }

  function startDevice(panel) {
    clear(panel);
    panel.appendChild(h('p', { class: 'cbo-muted', text: 'Préparation de la connexion…' }));
    call('POST', '/connect/start').then(function (res) {
      if (!res.ok || !res.data.user_code) {
        clear(panel);
        panel.appendChild(h('p', { class: 'cbo-error', text: 'Impossible de démarrer la connexion. Vérifiez l’adresse de l’API dans Réglages.' }));
        return;
      }
      var d = res.data;
      clear(panel);
      panel.appendChild(h('div', { class: 'cbo-steps' },
        h('p', null, '1. Ouvrez la page de validation Chapote.'),
        h('p', null, '2. Connectez-vous puis confirmez le code ci-dessous.'),
        h('div', { class: 'cbo-usercode', text: d.user_code }),
        h('a', { class: 'button button-primary', href: d.verification_uri_complete || d.verification_uri, target: '_blank', rel: 'noopener' },
          'Ouvrir la page de validation'),
        h('p', { class: 'cbo-muted cbo-poll', text: 'En attente de validation…' })
      ));
      pollDevice(panel, Math.max(2, parseInt(d.interval, 10) || 5));
    });
  }

  function pollDevice(panel, interval) {
    if (state.poll) clearTimeout(state.poll);
    state.poll = setTimeout(function () {
      call('POST', '/connect/poll').then(function (res) {
        var s = res.data && res.data.status;
        if (s === 'connected') {
          state.poll = null;
          state.connected = true;
          state.view = 'bots';
          setNotice('Connexion réussie.', 'ok');
          loadAccount();
          loadBots();
          return;
        }
        if (s === 'pending') {
          pollDevice(panel, Math.max(2, parseInt(res.data.interval, 10) || interval));
          return;
        }
        // expired | error
        state.poll = null;
        var poll = panel.querySelector('.cbo-poll');
        if (poll) { poll.textContent = 'Connexion expirée ou refusée. Relancez la connexion.'; poll.className = 'cbo-error'; }
      });
    }, interval * 1000);
  }

  function disconnect() {
    if (state.poll) { clearTimeout(state.poll); state.poll = null; }
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
      h('button', { class: 'button button-primary', onClick: openCreate }, 'Créer un bot')
    );
    wrap.appendChild(head);
    wrap.appendChild(h('div', { class: 'cbo-create', id: 'cbo-create' }));

    if (!state.bots.length) {
      wrap.appendChild(h('p', { class: 'cbo-muted', text: 'Aucun bot pour le moment. Créez-en un pour commencer.' }));
      return wrap;
    }

    var table = h('table', { class: 'widefat striped cbo-table' });
    table.appendChild(h('thead', null, h('tr', null,
      h('th', { text: 'Nom' }), h('th', { text: 'Facturation' }), h('th', { text: 'Plan / modules' }), h('th', { text: '' })
    )));
    var tb = h('tbody');
    state.bots.forEach(function (b) {
      var modules = Array.isArray(b.modules) ? b.modules.join(', ') : (b.modules ? String(b.modules) : '—');
      tb.appendChild(h('tr', null,
        h('td', null, h('strong', { text: b.name || '(sans nom)' })),
        h('td', null, billingBadge(b.billing_status)),
        h('td', { text: modules }),
        h('td', null, h('button', { class: 'button', onClick: function () { openBot(b.id); } }, 'Gérer'))
      ));
    });
    table.appendChild(tb);
    wrap.appendChild(table);

    wrap.appendChild(h('p', { class: 'cbo-muted cbo-deeplink' },
      'L’arbre de conversation, la base de connaissances et la sécurité se configurent dans le dashboard Chapote : ',
      h('a', { href: CFG.apiBase + '/app', target: '_blank', rel: 'noopener', text: 'ouvrir le dashboard' }),
      '.'
    ));
    return wrap;
  }

  function billingBadge(status) {
    var map = { active: ['Actif', 'ok'], inactive: ['Inactif', 'off'], past_due: ['Impayé', 'warn'], canceled: ['Résilié', 'off'] };
    var m = map[status] || [status || 'Inconnu', 'off'];
    return h('span', { class: 'cbo-badge cbo-badge-' + m[1], text: m[0] });
  }

  function openCreate() {
    var box = document.getElementById('cbo-create');
    if (!box) return;
    if (box.childNodes.length) { clear(box); return; }
    var name = h('input', { type: 'text', class: 'regular-text', placeholder: 'Nom du bot', maxlength: 80 });
    var mode = h('select', null,
      h('option', { value: 'hybrid' }, 'Hybride (arbre + IA)'),
      h('option', { value: 'tree' }, 'Arbre seul'),
      h('option', { value: 'ai' }, 'IA seule')
    );
    box.appendChild(h('div', { class: 'cbo-create-row' },
      name, mode,
      h('button', { class: 'button button-primary', onClick: function () {
        var nm = (name.value || '').trim();
        if (!nm) { setNotice('Donnez un nom au bot.', 'warn'); return; }
        call('POST', '/bots', { name: nm, mode: mode.value }).then(function (res) {
          if (!res.ok) { setNotice('Création impossible.', 'warn'); return; }
          setNotice('Bot créé.', 'ok');
          loadBots();
        });
      } }, 'Créer'),
      h('button', { class: 'button', onClick: function () { clear(box); } }, 'Annuler')
    ));
  }

  /* ----------------------------------------------------------- bot (détail) */

  function openBot(id) {
    state.view = 'bot'; state.botId = id; state.botTab = 'appearance';
    render();
  }

  function renderBot() {
    var bot = state.bots.filter(function (b) { return String(b.id) === String(state.botId); })[0] || {};
    var wrap = h('div');
    wrap.appendChild(h('div', { class: 'cbo-bothead' },
      h('button', { class: 'button-link', onClick: function () { state.view = 'bots'; render(); } }, '← Mes bots'),
      h('h2', { text: bot.name || 'Bot' }),
      billingBadge(bot.billing_status)
    ));
    var tabs = h('div', { class: 'cbo-subtabs' },
      subTab('Apparence', 'appearance'),
      subTab('Mon offre', 'payment'),
      subTab('Activation & ciblage', 'activation'),
      subTab('Domaine', 'domain')
    );
    wrap.appendChild(tabs);
    var pane = h('div', { class: 'cbo-pane', id: 'cbo-pane' });
    wrap.appendChild(pane);

    if (state.botTab === 'appearance') renderAppearance(pane);
    else if (state.botTab === 'payment') renderPayment(pane);
    else if (state.botTab === 'activation') renderActivation(pane);
    else renderDomain(pane);
    return wrap;
  }
  function subTab(label, key) {
    return h('button', { class: 'cbo-subtab' + (state.botTab === key ? ' is-active' : ''),
      onClick: function () { state.botTab = key; render(); } }, label);
  }

  /* ----------------------------------------------------------- apparence */

  function renderAppearance(pane) {
    clear(pane);
    pane.appendChild(h('p', { class: 'cbo-muted', text: 'Chargement de l’apparence…' }));
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

    function field(label, control) { return h('div', { class: 'cbo-field' }, h('label', { text: label }), control); }
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

  // Aperçu FIDÈLE du widget, reconstruit à chaque changement de champ. Toutes les
  // couleurs passent par hexColor() avant injection inline (#27).
  function renderPreview(node, d, botName) {
    clear(node);
    var primary = hexColor(d.primaryColor, '#0d9488');
    var secondary = hexColor(d.secondaryColor, primary);
    var dark = d.darkMode === true;
    var pos = (d.position === 'left') ? 'left' : 'right';
    var size = (d.size === 'sm' || d.size === 'lg') ? d.size : 'md';

    // Fenêtre de chat (état ouvert).
    var panel = h('div', { class: 'cbo-wp cbo-pos-' + pos + ' cbo-size-' + size + (dark ? ' cbo-wp-dark' : '') });

    // En-tête : couleur principale, avatar, titre, croix de fermeture.
    panel.appendChild(h('div', { class: 'cbo-wp-head', style: 'background:' + primary },
      h('span', { class: 'cbo-wp-avatar' }),
      h('span', { class: 'cbo-wp-title', text: d.title || botName || 'Assistant' }),
      h('span', { class: 'cbo-wp-close', text: '×' })
    ));

    // Corps : message d'accueil (bot) + message visiteur (couleur secondaire).
    panel.appendChild(h('div', { class: 'cbo-wp-body' },
      h('div', { class: 'cbo-wp-msg cbo-wp-bot', text: d.welcomeMessage || 'Bonjour ! Comment puis-je vous aider ?' }),
      h('div', { class: 'cbo-wp-msg cbo-wp-user', style: 'background:' + secondary, text: 'Bonjour, j’ai une question.' })
    ));

    // Zone de saisie : placeholder + bouton d'envoi (couleur principale).
    panel.appendChild(h('div', { class: 'cbo-wp-inputrow' },
      h('span', { class: 'cbo-wp-input', text: d.placeholder || 'Écrivez votre message…' }),
      h('span', { class: 'cbo-wp-send', style: 'background:' + primary, text: '→' })
    ));

    // Mention « Powered by » (affichée tant que white-label non décoché).
    if (d.poweredBy !== false) {
      panel.appendChild(h('div', { class: 'cbo-wp-powered', text: 'Powered by Chapote' }));
    }
    node.appendChild(panel);

    // Bulle d'accroche, à côté du lanceur, si activée.
    if (d.greeting === true) {
      node.appendChild(h('div', { class: 'cbo-wp-greeting cbo-pos-' + pos,
        text: d.launcherText || d.title || botName || 'Une question ?' }));
    }

    // Lanceur (bouton bulle) dans le même coin que la fenêtre.
    var launcher = h('div', { class: 'cbo-wp-launcher cbo-pos-' + pos, style: 'background:' + primary });
    launcher.appendChild(h('span', { class: 'cbo-wp-launcher-ico', text: '💬' }));
    if (d.launcherText) launcher.appendChild(h('span', { class: 'cbo-wp-launcher-txt', text: d.launcherText }));
    node.appendChild(launcher);
  }

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
    pane.appendChild(h('p', { class: 'cbo-muted', text: 'Chargement de l’offre…' }));
    // Bot + catalogue LIVE en parallèle (repli CFG.catalog si le proxy échoue).
    Promise.all([
      call('GET', '/bots/' + encodeURIComponent(state.botId)),
      call('GET', '/catalog')
    ]).then(function (r) {
      var botRes = r[0], catRes = r[1];
      if (!botRes.ok) { clear(pane); pane.appendChild(h('p', { class: 'cbo-error', text: 'Impossible de charger ce bot.' })); return; }
      // billing OFF renvoie {billing:'disabled'} (sans `modules`) : le compter comme
      // « live » pour que buildPaymentForm atteigne sa branche dédiée (sinon repli
      // statique = configurateur payant affiché à tort sur un compte sans facturation).
      var live = (catRes.ok && catRes.data && (Array.isArray(catRes.data.modules) || catRes.data.billing === 'disabled')) ? catRes.data : null;
      var catalog = live || CFG.catalog || { modules: [], ai_tiers: [] };
      buildPaymentForm(pane, botRes.data || {}, catalog);
    });
  }

  function buildPaymentForm(pane, bot, catalog) {
    clear(pane);
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
      : (catalog.ai_byok_price_cents != null ? catalog.ai_byok_price_cents : 2900);

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

    function requiresAi() {
      return Object.keys(selected).some(function (k) {
        var m = payableModules.filter(function (x) { return x.key === k; })[0];
        return m && Array.isArray(m.requires) && m.requires.indexOf('ai') !== -1;
      });
    }

    function recompute() {
      if (requiresAi() && aiMode === 'off') aiMode = 'managed';
      renderModules(); renderAi(); renderTotal();
    }

    function renderModules() {
      clear(modBox);
      modBox.appendChild(h('h4', { text: 'Modules' }));
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
      aiBox.appendChild(h('h4', { text: 'Intelligence artificielle' }));
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
      } else if (aiMode === 'byok') total += byokCents;
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
      onClick: function () { doCheckout(subscribeBtn, buildConfig(), consent.checked); } },
      active ? 'Mettre à jour le plan' : 'Souscrire');

    pane.appendChild(modBox);
    pane.appendChild(aiBox);
    pane.appendChild(totalLine);
    pane.appendChild(consentLine);

    var actions = h('div', { class: 'cbo-actions' }, subscribeBtn);
    if (active) {
      actions.appendChild(h('button', { class: 'button',
        onClick: function () { updateSubscription(buildConfig()); } }, 'Changer de plan (prorata)'));
      actions.appendChild(confirmButton('Résilier', 'Confirmer la résiliation', cancelSubscription));
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
      var msg = (res.data && (res.data.detail || res.data.message || res.data.error)) || 'Impossible d’ouvrir le paiement.';
      setNotice(typeof msg === 'string' ? msg : 'Impossible d’ouvrir le paiement.', 'warn');
    });
  }

  function updateSubscription(config) {
    call('POST', '/bots/' + encodeURIComponent(state.botId) + '/subscription/update', { config: config }).then(function (res) {
      if (res.ok) { setNotice('Plan mis à jour.', 'ok'); loadBots(); }
      else setNotice('Mise à jour impossible.', 'warn');
    });
  }
  function cancelSubscription() {
    call('POST', '/bots/' + encodeURIComponent(state.botId) + '/subscription/cancel').then(function (res) {
      if (res.ok) { setNotice('Abonnement résilié.', 'info'); loadBots(); }
      else setNotice('Résiliation impossible.', 'warn');
    });
  }

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
        if (tries < 12) setTimeout(loop, 3000);
      });
    })();
  }

  /* ------------------------------------------------------- activation/ciblage */

  function renderActivation(pane) {
    clear(pane);
    pane.appendChild(h('p', { class: 'cbo-muted', text: 'Chargement…' }));
    Promise.all([
      call('GET', '/bots/' + encodeURIComponent(state.botId) + '/local'),
      call('GET', '/bots/' + encodeURIComponent(state.botId))
    ]).then(function (r) {
      var local = (r[0].data) || {};
      var bot = (r[1].data) || {};
      buildActivation(pane, local, bot);
    });
  }

  function buildActivation(pane, local, bot) {
    clear(pane);
    var active = bot.billing_status === 'active';
    var t = local.targeting || { mode: 'everywhere', include_front: true, include_types: [], include_ids: [], exclude_types: [], exclude_ids: [] };

    // Verrou produit : activation impossible tant que non payé.
    if (!active) {
      pane.appendChild(h('div', { class: 'cbo-lock' },
        h('strong', { text: '🔒 Activation verrouillée' }),
        h('p', { text: 'Le widget ne peut être activé sur le site qu’une fois l’abonnement payé (statut « actif »). Rendez-vous dans l’onglet Mon offre.' })
      ));
    }

    var toggle = h('input', { type: 'checkbox', checked: !!local.enabled, disabled: !active });
    pane.appendChild(h('div', { class: 'cbo-toggle' },
      h('label', { class: 'cbo-check' }, toggle, h('span', { text: 'Afficher le widget de ce bot sur le site' }))
    ));

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
    customBox.appendChild(h('h4', { class: 'cbo-custom-h', text: 'Afficher sur' }));
    customBox.appendChild(h('label', { class: 'cbo-check' }, frontCb, h('span', { text: 'Page d’accueil' })));
    customBox.appendChild(h('div', { class: 'cbo-field' }, h('label', { text: 'Types de contenu à inclure' }), inc.wrap));
    customBox.appendChild(h('div', { class: 'cbo-field' }, h('label', { text: 'IDs de contenus à inclure' }), includeIds));

    // Exclusions (PRIORITAIRES sur toute inclusion).
    customBox.appendChild(h('h4', { class: 'cbo-custom-h', text: 'Ne jamais afficher sur (prioritaire)' }));
    customBox.appendChild(h('div', { class: 'cbo-field' }, h('label', { text: 'Types de contenu à exclure' }), exc.wrap));
    customBox.appendChild(h('div', { class: 'cbo-field' }, h('label', { text: 'IDs de contenus à exclure' }), excludeIds));
    customBox.appendChild(h('p', { class: 'cbo-hint', text: 'Une exclusion (type ou ID) l’emporte toujours sur une inclusion.' }));

    pane.appendChild(h('div', { class: 'cbo-field' }, h('label', { text: 'Où afficher le widget ?' }),
      h('div', { class: 'cbo-targetmodes' },
        h('label', { class: 'cbo-radio' }, modeEverywhere, h('span', { text: 'Tout le site' })),
        h('label', { class: 'cbo-radio' }, modeCustom, h('span', { text: 'Pages personnalisées' }))
      )
    ));
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
        saveActivation(e.target, toggle.checked, targeting);
      } }, 'Enregistrer l’activation')
    ));
  }

  function saveActivation(btn, enabled, targeting) {
    btn.disabled = true;
    call('POST', '/bots/' + encodeURIComponent(state.botId) + '/local', { enabled: enabled, targeting: targeting }).then(function (res) {
      btn.disabled = false;
      if (res.ok) setNotice(enabled ? 'Widget activé sur le site.' : 'Réglages enregistrés.', 'ok');
      else if (res.status === 403 && res.data && res.data.error === 'not_active') setNotice('Activation refusée : l’abonnement n’est pas actif.', 'warn');
      else setNotice('Enregistrement impossible.', 'warn');
    });
  }

  /* ------------------------------------------------------------- domaine */

  function renderDomain(pane) {
    clear(pane);
    pane.appendChild(h('div', { class: 'cbo-card cbo-domain' },
      h('h3', { text: 'Autoriser ce domaine dans Chapote' }),
      h('p', null, 'Pour que le widget réponde aux visiteurs, ajoutez ce domaine à la liste des domaines autorisés de votre bot (onglet Sécurité dans Chapote) :'),
      h('code', { class: 'cbo-host', text: CFG.siteHost || '' }),
      h('p', { class: 'cbo-muted', text: 'La sécurité (domaines autorisés, captcha, limites) se gère côté Chapote, pas dans WordPress.' }),
      h('p', null, h('a', { href: CFG.apiBase + '/app', target: '_blank', rel: 'noopener', text: 'Ouvrir le dashboard Chapote' }))
    ));
  }

  /* ----------------------------------------------------------- helpers UI */

  function confirmButton(label, confirmLabel, action) {
    var btn = h('button', { class: 'button cbo-danger' }, label);
    var armed = false;
    btn.addEventListener('click', function () {
      if (!armed) { armed = true; btn.textContent = confirmLabel; setTimeout(function () { armed = false; btn.textContent = label; }, 4000); return; }
      action();
    });
    return btn;
  }

  /* ------------------------------------------------------------------ boot */

  function boot() {
    if (!root) return;
    call('GET', '/status').then(function (res) {
      state.connected = !!(res.data && res.data.connected);
      state.account = (res.data && res.data.account) ? res.data.account : null;
      if (state.connected) {
        // Retour Stripe : ouvrir directement le bon bot sur l'onglet paiement.
        if (CFG.returnBot && (CFG.returnStatus === 'success' || CFG.returnStatus === 'cancel')) {
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
        loadBots();
      } else {
        state.view = 'connect';
        render();
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
