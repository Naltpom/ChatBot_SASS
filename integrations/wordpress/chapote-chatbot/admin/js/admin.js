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

  // Repli ultime du prix BYOK (en centimes) si le catalogue live n'expose ni
  // module 'ai'.byok_price_cents ni catalog.ai_byok_price_cents. En pratique le
  // catalogue live fournit toujours la valeur ; ce défaut n'est qu'un garde-fou.
  var DEFAULT_BYOK_PRICE_CENTS = 2900;

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
    botTab: 'activation',
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
    else if (state.view === 'seo') body.appendChild(renderSeo());
    else body.appendChild(renderBots());
  }

  function renderNav() {
    var nav = h('div', { class: 'cbo-nav' });
    var left = h('div', { class: 'cbo-nav-left' });
    if (state.connected) {
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
  // généré state + code_verifier CÔTÉ SERVEUR) puis on quitte WordPress vers
  // l'écran de consentement Chapote. Aucun secret ne transite par le JS.
  function startConnect(btn, info) {
    btn.disabled = true;
    clear(info);
    info.appendChild(h('p', { class: 'cbo-muted', text: 'Redirection vers Chapote…' }));
    call('GET', '/connect/url').then(function (res) {
      if (!res.ok || !res.data || !res.data.url) {
        btn.disabled = (CFG.cryptoOk === false);
        clear(info);
        info.appendChild(h('p', { class: 'cbo-error', text:
          'Impossible de démarrer la connexion. Vérifiez les adresses (API et dashboard) dans les réglages.' }));
        return;
      }
      window.location.href = res.data.url;
    });
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

    wrap.appendChild(h('p', { class: 'cbo-muted cbo-deeplink' },
      'L’arbre de conversation, la base de connaissances et la sécurité se configurent dans le dashboard Chapote : ',
      h('a', { href: (CFG.appBase || CFG.apiBase) + '/app', target: '_blank', rel: 'noopener', text: 'ouvrir le dashboard' }),
      '.'
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
    var cb = h('input', { type: 'checkbox', checked: !!bot.enabled });
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
          if (txt) txt.textContent = bot.enabled ? 'Affiché sur le site' : 'Afficher sur le site';
          setNotice(bot.enabled ? 'Widget activé sur le site.' : 'Widget désactivé du site.', 'ok');
          if (typeof opts.onChange === 'function') opts.onChange(bot.enabled);
        } else {
          cb.checked = !want; // revert visuel
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
    var tabs = h('div', { class: 'cbo-subtabs' },
      subTab('Ciblage des pages', 'activation'),
      subTab('Mon offre', 'payment'),
      subTab('Apparence', 'appearance')
    );
    wrap.appendChild(tabs);
    var pane = h('div', { class: 'cbo-pane', id: 'cbo-pane' });
    wrap.appendChild(pane);

    if (state.botTab === 'payment') renderPayment(pane);
    else if (state.botTab === 'appearance') renderAppearance(pane);
    else renderActivation(pane); // 'activation' par défaut (onglet Domaine fusionné ici)
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

  // Icônes SVG du vrai widget (tracés constants repris de widget.js) construites
  // sans innerHTML (createElementNS) -> aucune surface d'injection.
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var ICON_CHAT = 'M12 3C7 3 3 6.6 3 11c0 2.2 1 4.2 2.7 5.6-.1 1-.5 2.1-1.4 3 1.7-.1 3.1-.7 4.1-1.4 1.1.4 2.3.7 3.6.7 5 0 9-3.6 9-7.9S17 3 12 3z';
  var ICON_SEND = 'M3.4 20.6 21.8 12 3.4 3.4l.01 6.6L15 12 3.41 14z';
  function svgIcon(pathD) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'currentColor');
    var p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', pathD);
    svg.appendChild(p);
    return svg;
  }
  // Avatar : image du bot (icon === 'image' + avatarImage, posée en PROPRIÉTÉ
  // img.src, jamais interpolée) sinon l'icône chat du widget.
  function avatarNode(d, cls) {
    var box = h('span', { class: cls });
    if (d.icon === 'image' && typeof d.avatarImage === 'string' && d.avatarImage) {
      box.classList.add('cbo-wp-hasimg');
      var img = h('img', { alt: '' });
      img.src = String(d.avatarImage);
      box.appendChild(img);
    } else {
      box.appendChild(svgIcon(ICON_CHAT));
    }
    return box;
  }

  // Aperçu FIDÈLE du widget (mêmes proportions/arrondis/couleurs/typo que
  // widget.js), reconstruit à chaque changement de champ. Toutes les couleurs
  // passent par hexColor() avant injection inline (#27). Affiche la fenêtre
  // OUVERTE + le lanceur fermé (comme sur le site).
  function renderPreview(node, d, botName) {
    clear(node);
    var primary = hexColor(d.primaryColor, '#0d9488');
    var secondary = hexColor(d.secondaryColor, primary);
    // En-tête / lanceur : dégradé 135° si une secondaire distincte est posée,
    // sinon couleur pleine (parité widget : color2 ? linear-gradient : brand).
    var brandBg = (d.secondaryColor && secondary !== primary)
      ? 'linear-gradient(135deg,' + primary + ',' + secondary + ')'
      : primary;
    var dark = d.darkMode === true;
    var pos = (d.position === 'left') ? 'left' : 'right';
    var size = (d.size === 'sm' || d.size === 'lg') ? d.size : 'md';

    // Fenêtre de chat (état ouvert).
    var panel = h('div', { class: 'cbo-wp cbo-pos-' + pos + ' cbo-size-' + size + (dark ? ' cbo-wp-dark' : '') });

    // En-tête : fond marque, avatar, nom + statut « En ligne » (point vert), croix.
    panel.appendChild(h('div', { class: 'cbo-wp-head', style: 'background:' + brandBg },
      avatarNode(d, 'cbo-wp-avatar'),
      h('div', { class: 'cbo-wp-headmid' },
        h('span', { class: 'cbo-wp-title', text: d.title || botName || 'Assistant' }),
        h('span', { class: 'cbo-wp-status' }, h('span', { class: 'cbo-wp-dot' }), h('span', { text: 'En ligne' }))
      ),
      h('span', { class: 'cbo-wp-close', text: '×' })
    ));

    // Corps : bulle bot (accueil, ergot haut-gauche) + bulle visiteur (marque,
    // ergot bas-droite). Le visiteur reprend la couleur PRINCIPALE (parité widget).
    panel.appendChild(h('div', { class: 'cbo-wp-body' },
      h('div', { class: 'cbo-wp-msg cbo-wp-bot', text: d.welcomeMessage || 'Bonjour ! Comment puis-je vous aider ?' }),
      h('div', { class: 'cbo-wp-msg cbo-wp-user', style: 'background:' + primary, text: 'Bonjour, j’ai une question.' })
    ));

    // Zone de saisie : champ pilule + bouton d'envoi rond (couleur principale).
    var send = h('span', { class: 'cbo-wp-send', style: 'background:' + primary });
    send.appendChild(svgIcon(ICON_SEND));
    panel.appendChild(h('div', { class: 'cbo-wp-inputrow' },
      h('span', { class: 'cbo-wp-input', text: d.placeholder || 'Écrivez votre message…' }),
      send
    ));

    // Mention « Propulsé par Chapote » (affichée tant que white-label non décoché).
    if (d.poweredBy !== false) {
      panel.appendChild(h('div', { class: 'cbo-wp-powered' }, 'Propulsé par ', h('b', { text: 'Chapote' })));
    }
    node.appendChild(panel);

    // Bulle d'accroche, au-dessus/à côté du lanceur, si activée.
    if (d.greeting === true) {
      node.appendChild(h('div', { class: 'cbo-wp-greeting cbo-pos-' + pos,
        text: d.greetingText || d.launcherText || d.title || botName || 'Une question ?' }));
    }

    // Lanceur fermé (bulle flottante marque) dans le même coin que la fenêtre.
    // Pilule [icône + libellé] si launcherText, sinon bouton rond icône seule.
    var launcher = h('div', { class: 'cbo-wp-launcher cbo-pos-' + pos + (d.launcherText ? ' cbo-wp-launcher-pill' : ''),
      style: 'background:' + brandBg });
    launcher.appendChild(avatarNode(d, 'cbo-wp-launcher-ico'));
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
          h('a', { href: '#', onClick: function (e) { e.preventDefault(); state.botTab = 'payment'; render(); } }, 'Voir « Mon offre »')
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
        saveActivation(e.target, targeting);
      } }, 'Enregistrer le ciblage')
    ));

    // Rappel domaine (anciennement onglet « Domaine », fusionné ici) : pour que le
    // widget réponde aux visiteurs, ce domaine doit être autorisé côté Chapote.
    pane.appendChild(h('div', { class: 'cbo-domain' },
      h('h4', { class: 'cbo-custom-h', text: 'Autoriser ce domaine dans Chapote' }),
      h('p', { class: 'cbo-muted', text: 'Pour que le widget réponde aux visiteurs, ajoutez ce domaine à la liste des domaines autorisés de votre bot (onglet Sécurité dans Chapote) :' }),
      h('code', { class: 'cbo-host', text: CFG.siteHost || '' }),
      h('p', { class: 'cbo-muted', text: 'La sécurité (domaines autorisés, captcha, limites) se gère côté Chapote, pas dans WordPress.' }),
      h('p', null, h('a', { href: (CFG.appBase || CFG.apiBase) + '/app', target: '_blank', rel: 'noopener', text: 'Ouvrir le dashboard Chapote' }))
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
    wrap.appendChild(h('p', { class: 'cbo-muted', text: 'Chargement…' }));
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
      h('h4', { text: 'Lien « Chatbot par Chapote »' }),
      h('label', { class: 'cbo-check' }, poweredCb,
        h('span', { text: 'Afficher un petit lien crawlable vers Chapote dans le pied de page (désactivé par défaut).' }))
    ));

    // 2) Éditeur de paires FAQ (Question / Réponse) -> JSON-LD.
    wrap.appendChild(h('h4', { text: 'FAQ (données structurées schema.org)' }));
    wrap.appendChild(h('p', { class: 'cbo-muted', text:
      'Chaque paire Question / Réponse est publiée en JSON-LD (FAQPage), éligible aux résultats enrichis Google.' }));

    var list = h('div', { class: 'cbo-faqlist' });
    var rows = [];

    function addRow(q, a) {
      var qInput = h('input', { type: 'text', class: 'regular-text', value: q || '', placeholder: 'Question', maxlength: 300 });
      var aInput = h('textarea', { rows: 2, class: 'large-text', maxlength: 2000, placeholder: 'Réponse' });
      aInput.value = a || '';
      var row = { q: qInput, a: aInput };
      rows.push(row);
      var node = h('div', { class: 'cbo-faqrow' },
        h('div', { class: 'cbo-field' }, qInput),
        h('div', { class: 'cbo-field' }, aInput),
        h('button', { class: 'button cbo-danger', onClick: function () {
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
      action();
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

  // Charge /status puis peint l'écran adéquat (connecté → bots, sinon → connexion).
  // `after` est appelé une fois le rendu effectué (pour poser une notice).
  function loadStatusAndRender(after) {
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
      if (typeof after === 'function') after();
    });
  }

  // Retour OAuth : on nettoie l'URL d'abord, puis on échange le code côté serveur
  // (le proxy vérifie le state et détient le code_verifier). Le code est one-time.
  function handleOAuthCallback(cb) {
    cleanUrl();
    if (cb.error) {
      loadStatusAndRender(function () {
        setNotice('Connexion annulée ou refusée (' + cb.error + '). Vous pouvez réessayer.', 'warn');
      });
      return;
    }
    state.connected = false; state.view = 'connect';
    render();
    setNotice('Finalisation de la connexion…', 'info');
    call('POST', '/connect/callback', { code: cb.code, state: cb.state }).then(function (res) {
      if (res.ok && res.data && res.data.status === 'connected') {
        state.connected = true; state.view = 'bots';
        render();
        setNotice('Connexion réussie.', 'ok');
        loadAccount();
        loadBots();
        return;
      }
      state.connected = false; state.view = 'connect';
      render();
      setNotice('Échec de la connexion. Relancez « Se connecter avec Chapote ».', 'warn');
    });
  }

  function boot() {
    if (!root) return;
    var cb = readOAuthCallback();
    if (cb) { handleOAuthCallback(cb); return; }
    loadStatusAndRender();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
