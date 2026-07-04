/**
 * Chapote Bot Manager — wizard d'onboarding guidé (window.CBOOnboarding).
 *
 * Machine à états en 10 étapes :
 *   welcome → auth → choose → pick → customize → waiting → tree → preview → offer → activation
 * Le sous-état vit dans CBOAdmin.state.onb ; le rendu passe par CBOAdmin.render()
 * (admin.js délègue la vue 'onboarding' à CBOOnboarding.view()).
 *
 * RÉUTILISE le back-office : helpers DOM/proxy via window.CBOCore, configurateur
 * d'offre (buildPaymentForm), checkout, polling d'activation et navigation via
 * window.CBOAdmin. Aucune étape de build : ES5/ES2015 prudent, servi tel quel.
 *
 * Fenêtres du dashboard : l'apparence est un IFRAME embarqué, l'éditeur d'arbre
 * une fenêtre window.open. Synchronisation par POLLING (SSE via proxy non fiable)
 * + postMessage validé (origin app + nonce + source). Le token plugin reste
 * côté serveur ; les fenêtres embed s'authentifient par leur embed_token éphémère.
 */
(function () {
  'use strict';

  var wpI18n = (window.wp && window.wp.i18n) || null;
  var __ = wpI18n ? wpI18n.__ : function (s) { return s; };
  var _sprintf = wpI18n ? wpI18n.sprintf : function (s) { var a = Array.prototype.slice.call(arguments, 1), i = 0; return s.replace(/%s/g, function () { return a[i++]; }); };

  var C = window.CBOCore || {};
  var A = window.CBOAdmin || {};
  var CFG = window.CHAPOTE_BO || {};

  var h = C.h, clear = C.clear, loadingNote = C.loadingNote, apiMsg = C.apiMsg, call = C.call, fieldFor = C.fieldFor;

  // Phases visibles du stepper (regroupent les étapes internes).
  var PHASES = [
    { label: __('Sign in', 'chapote-bot-manager'),        steps: ['welcome', 'auth'] },
    { label: __('Your site', 'chapote-bot-manager'),      steps: ['choose', 'pick'] },
    { label: __('Customization', 'chapote-bot-manager'),  steps: ['customize'] },
    { label: __('Generation', 'chapote-bot-manager'),     steps: ['waiting', 'tree'] },
    { label: __('Preview', 'chapote-bot-manager'),        steps: ['preview'] },
    { label: __('Plan', 'chapote-bot-manager'),           steps: ['offer'] },
    { label: __('Live', 'chapote-bot-manager'),           steps: ['activation'] }
  ];

  // Étapes exigeant un bot déjà créé (sinon on retombe au choix de la source).
  var NEEDS_BOT = { customize: 1, waiting: 1, tree: 1, preview: 1, offer: 1, activation: 1 };

  // Intervalle du poll de l'éditeur d'arbre : simple FILET ; le postMessage `saved`
  // est la voie primaire (traité instantanément). Volontairement lent pour éviter
  // les GET /bots/{id} redondants (déchiffrement AES par appel).
  var EDITOR_POLL_MS = 15000;

  /* ----------------------------------------------------------- accès état */

  function S() { return A.state; }
  function O() { return A.state ? A.state.onb : null; }
  function defer(fn) { setTimeout(fn, 0); }

  function onbFromCfg() {
    var o = (CFG.onboarding && typeof CFG.onboarding === 'object') ? CFG.onboarding : {};
    return { done: o.done === true, bot_id: o.bot_id ? String(o.bot_id) : '', step: o.step ? String(o.step) : '' };
  }

  /* --------------------------------------------------------------- init */

  function init(onb, ctx) {
    onb = onb || onbFromCfg();
    ctx = ctx || {};
    var connected = !!(S() && S().connected);

    var step;
    if (!connected) {
      // Non connecté : il faut d'abord se connecter. Un client existant (parcours
      // déjà terminé) entre directement sur l'écran d'auth, sinon par le welcome.
      step = onb.done ? 'auth' : 'welcome';
    } else {
      // Déjà connecté : on saute welcome/auth. Reprise à l'étape persistée si sûre.
      step = (onb.step && onb.step !== 'welcome' && onb.step !== 'auth') ? onb.step : 'choose';
      if (ctx.fresh) step = 'choose';
      // Retour Stripe (seulement pertinent une fois connecté).
      if (ctx.stripe === 'success') step = 'activation';
      else if (ctx.stripe === 'cancel') step = 'offer';
    }

    // Garde-fou : une étape exigeant un bot sans bot_id retombe au choix.
    if (NEEDS_BOT[step] && !onb.bot_id) step = connected ? 'choose' : 'welcome';

    A.state.onb = {
      step: step,
      botId: onb.bot_id || '',
      jobId: '',
      pages: [], pagesLoaded: false, pagesLoading: false, error: '',
      selected: {},        // url -> true
      extra: [],           // URLs ajoutées manuellement (même host)
      preselected: false,
      search: '',
      role: '',
      visitors: '',
      tree: null, bot: null, updatedAt: '',
      recommendation: null, quickReplies: [],
      editorWin: null, editorNonce: '', syncTimer: null, unlisten: null,
      stripe: ctx.stripe === 'cancel' ? 'cancel' : (ctx.stripe === 'success' ? 'success' : ''),
      activating: false, done: false
    };
  }

  // Connexion établie pendant le wizard (popup OAuth) : compte déjà garni →
  // back-office ; sinon on enchaîne sur le choix de la source.
  function afterConnect() {
    var o = O(); if (!o) { init(onbFromCfg(), {}); o = O(); }
    call('GET', '/bots').then(function (br) {
      var bots = botsOf(br);
      var onb = onbFromCfg();
      if (onb.done || bots.length > 0) { A.exitOnboarding(__('Connected to Chapote.', 'chapote-bot-manager'), 'ok'); return; }
      goTo('choose');
    });
  }
  function botsOf(br) {
    if (br.ok && Array.isArray(br.data)) return br.data;
    if (br.ok && br.data && Array.isArray(br.data.bots)) return br.data.bots;
    return [];
  }

  /* ------------------------------------------------------------ rendu */

  var RENDER = {
    welcome: renderWelcome, auth: renderAuth, choose: renderChoose, pick: renderPick,
    customize: renderCustomize, waiting: renderWaiting, tree: renderTree,
    preview: renderPreview, offer: renderOffer, activation: renderActivation
  };

  function view() {
    var o = O();
    if (!o) { init(onbFromCfg(), {}); o = O(); }
    var wrap = h('div', { class: 'cbo-onb' });
    wrap.appendChild(stepper(o.step));
    var card = h('div', { class: 'cbo-card cbo-onb-card' });
    wrap.appendChild(card);
    (RENDER[o.step] || renderWelcome)(card);
    return wrap;
  }

  function goTo(step) {
    var o = O(); if (!o) return;
    // Changement d'étape : on coupe toute synchro/écoute embed en cours
    // (apparence en iframe, éditeur en fenêtre). Idempotent.
    if (o.step !== step) stopEditorSync();
    o.step = step;
    persist();
    A.render();
  }

  function persist(extra) {
    var o = O(); if (!o) return;
    var body = { step: o.step, bot_id: o.botId };
    if (extra) { for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) body[k] = extra[k]; }
    call('POST', '/onboarding', body);
  }

  function stepper(step) {
    var idx = 0;
    for (var i = 0; i < PHASES.length; i++) if (PHASES[i].steps.indexOf(step) !== -1) { idx = i; break; }
    var nav = h('ol', { class: 'cbo-onb-stepper' });
    PHASES.forEach(function (ph, i) {
      var cls = 'cbo-onb-step' + (i < idx ? ' is-done' : (i === idx ? ' is-current' : ''));
      nav.appendChild(h('li', { class: cls, 'aria-current': i === idx ? 'step' : null },
        h('span', { class: 'cbo-onb-step-n', text: i < idx ? '✓' : String(i + 1) }),
        h('span', { class: 'cbo-onb-step-l', text: ph.label })
      ));
    });
    return nav;
  }

  function backBtn(step) {
    return h('button', { type: 'button', class: 'button cbo-onb-back', onClick: function () { goTo(step); } }, __('← Back', 'chapote-bot-manager'));
  }
  function actions() {
    var a = h('div', { class: 'cbo-onb-actions' });
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) a.appendChild(arguments[i]);
    return a;
  }

  /* --------------------------------------------------------- 1. welcome */

  function renderWelcome(card) {
    card.appendChild(h('div', { class: 'cbo-onb-hero' },
      h('span', { class: 'cbo-onb-badge', text: __('Guided setup', 'chapote-bot-manager') }),
      h('h2', { text: __('Let’s build your chatbot, together', 'chapote-bot-manager') }),
      h('p', { class: 'cbo-onb-lead', text:
        __('In just a few minutes: we analyze your site, an AI generates an assistant ready to answer, you customize it, and it goes live.', 'chapote-bot-manager') }),
      h('ul', { class: 'cbo-onb-bullets' },
        h('li', null, __('We read your pages to understand your business', 'chapote-bot-manager')),
        h('li', null, __('An AI builds the conversation tree', 'chapote-bot-manager')),
        h('li', null, __('You fine-tune the appearance and the content', 'chapote-bot-manager')),
        h('li', null, __('Activate it on your site in one click', 'chapote-bot-manager'))
      ),
      actions(h('button', { class: 'button button-primary button-hero',
        onClick: function () { goTo(S().connected ? 'choose' : 'auth'); } }, __('Get started', 'chapote-bot-manager')))
    ));
  }

  /* ------------------------------------------------------------ 2. auth */

  function renderAuth(card) {
    if (S().connected) {
      card.appendChild(h('h2', { text: __('You are connected to Chapote', 'chapote-bot-manager') }));
      card.appendChild(actions(backBtn('welcome'),
        h('button', { class: 'button button-primary', onClick: function () { goTo('choose'); } }, __('Continue', 'chapote-bot-manager'))));
      return;
    }
    card.appendChild(h('h2', { text: __('Connect your site to Chapote', 'chapote-bot-manager') }));
    card.appendChild(h('p', { class: 'cbo-muted', text:
      __('A Chapote window will open to authorize this site, then you will come back here. Your credentials never pass through WordPress.', 'chapote-bot-manager') }));
    if (CFG.cryptoOk === false) {
      card.appendChild(h('p', { class: 'cbo-error', text:
        __('OpenSSL (AES-256-GCM) is unavailable: your credentials cannot be stored encrypted.', 'chapote-bot-manager') }));
    }
    var info = h('div', { class: 'cbo-device' });
    var btn = h('button', { class: 'button button-primary button-hero', disabled: CFG.cryptoOk === false,
      onClick: function () { A.startConnect(btn, info); } }, __('Sign in with Chapote', 'chapote-bot-manager'));
    card.appendChild(btn);
    card.appendChild(info);
    card.appendChild(actions(backBtn('welcome')));
  }

  /* ---------------------------------------------------------- 3. choose */

  function renderChoose(card) {
    card.appendChild(h('h2', { text: __('Let’s start from your WordPress site', 'chapote-bot-manager') }));
    card.appendChild(h('p', { class: 'cbo-muted' },
      __('We will list your published pages to understand your business and generate a relevant assistant.', 'chapote-bot-manager') + ' ' + __('Site analyzed:', 'chapote-bot-manager') + ' ',
      h('strong', { text: CFG.siteHost || CFG.homeUrl || __('this site', 'chapote-bot-manager') }), '.'));
    card.appendChild(actions(
      h('button', { class: 'button button-primary button-hero', onClick: function () { goTo('pick'); } }, __('Analyze my site', 'chapote-bot-manager')),
      h('button', { class: 'button', onClick: function (e) { startBlank(e.currentTarget); } }, __('Start from a blank assistant', 'chapote-bot-manager'))
    ));
  }

  function startBlank(btn) {
    if (btn) btn.disabled = true;
    call('POST', '/bots', { name: CFG.siteName || __('My assistant', 'chapote-bot-manager'), mode: 'hybrid' }).then(function (res) {
      if (btn) btn.disabled = false;
      if (!res.ok || !res.data || !res.data.id) { A.setNotice(apiMsg(res, __('Could not create the assistant.', 'chapote-bot-manager')), 'warn'); return; }
      var o = O(); o.botId = String(res.data.id); o.jobId = '';
      persist({ bot_id: o.botId, step: 'customize' });
      goTo('customize');
    });
  }

  /* ------------------------------------------------------------ 4. pick */

  function fetchPages(s) {
    return call('GET', '/site/pages' + (s ? ('?s=' + encodeURIComponent(s)) : ''));
  }
  function sameHost(u) {
    try {
      var a = document.createElement('a'); a.href = u;
      if (a.protocol !== 'http:' && a.protocol !== 'https:') return false;
      var host = (a.hostname || '').toLowerCase().replace(/^www\./, '');
      var site = (CFG.siteHost || '').toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '');
      return host === site;
    } catch (e) { return false; }
  }

  function renderPick(card) {
    var o = O();
    card.appendChild(h('h2', { text: __('Which pages describe your business?', 'chapote-bot-manager') }));
    card.appendChild(h('p', { class: 'cbo-muted', text:
      __('Check up to 15 pages. The most useful ones are pre-selected. You can adjust everything later.', 'chapote-bot-manager') }));

    var counter = h('span', { class: 'cbo-onb-counter' });
    var search = h('input', { type: 'search', class: 'regular-text', placeholder: __('Search for a page…', 'chapote-bot-manager'),
      value: o.search || '', 'aria-label': __('Search for a page', 'chapote-bot-manager') });
    var listHost = h('div', { class: 'cbo-onb-pages', role: 'group', 'aria-label': __('Pages on your site', 'chapote-bot-manager') });

    function updateCounter() {
      var n = Object.keys(o.selected).length;
      clear(counter);
      counter.appendChild(h('strong', { text: n + ' / 15' }));
      counter.appendChild(h('span', { text: ' ' + __('selected', 'chapote-bot-manager') }));
      counter.classList.toggle('is-over', n >= 15);
    }
    function rowFor(p) {
      var cb = h('input', { type: 'checkbox', checked: !!o.selected[p.url] });
      cb.addEventListener('change', function () {
        if (cb.checked) {
          if (Object.keys(o.selected).length >= 15) { cb.checked = false; A.setNotice(__('Maximum of 15 pages. Uncheck one first.', 'chapote-bot-manager'), 'warn'); return; }
          o.selected[p.url] = true;
        } else { delete o.selected[p.url]; }
        updateCounter();
      });
      return h('label', { class: 'cbo-onb-page' + (p.is_front ? ' is-front' : '') },
        cb,
        h('span', { class: 'cbo-onb-page-main' },
          h('span', { class: 'cbo-onb-page-title', text: p.title || p.url }),
          h('span', { class: 'cbo-onb-page-url', text: p.url })
        ),
        p.is_front ? h('span', { class: 'cbo-onb-tag', text: __('Home', 'chapote-bot-manager') })
          : (p.relevant ? h('span', { class: 'cbo-onb-tag cbo-onb-tag-rel', text: __('Recommended', 'chapote-bot-manager') }) : null)
      );
    }
    function mergedPages() {
      var seen = {}, out = [];
      function add(p) { if (!seen[p.url]) { seen[p.url] = 1; out.push(p); } }
      (o.pages || []).forEach(add);
      (o.extra || []).forEach(function (u) { add({ url: u, title: u, is_front: false, relevant: true, manual: true }); });
      Object.keys(o.selected).forEach(function (u) { if (!seen[u]) out.unshift({ url: u, title: u, is_front: false, relevant: false }); });
      return out;
    }
    function renderList() {
      clear(listHost);
      if (o.pagesLoading) { listHost.appendChild(loadingNote(__('Reading your pages…', 'chapote-bot-manager'))); return; }
      if (o.error) { listHost.appendChild(h('p', { class: 'cbo-error', text: o.error })); return; }
      var pages = mergedPages();
      if (!pages.length) { listHost.appendChild(h('p', { class: 'cbo-muted', text: __('No pages found.', 'chapote-bot-manager') })); return; }
      pages.forEach(function (p) { listHost.appendChild(rowFor(p)); });
    }
    function addManual(url) {
      url = (url || '').trim();
      if (!url) return;
      if (url.indexOf('//') === -1) url = (CFG.homeUrl || '').replace(/\/+$/, '') + (url.charAt(0) === '/' ? '' : '/') + url;
      /* translators: %s: site host name */
      if (!sameHost(url)) { A.setNotice(_sprintf(__('The URL must belong to your site (%s).', 'chapote-bot-manager'), CFG.siteHost || ''), 'warn'); return; }
      if (Object.keys(o.selected).length >= 15) { A.setNotice(__('Maximum of 15 pages.', 'chapote-bot-manager'), 'warn'); return; }
      if (o.extra.indexOf(url) === -1) o.extra.push(url);
      o.selected[url] = true;
      updateCounter(); renderList();
    }

    // Recherche debouncée (re-fetch serveur ; la sélection est conservée).
    var deb;
    search.addEventListener('input', function () {
      o.search = search.value;
      clearTimeout(deb);
      deb = setTimeout(function () {
        o.pagesLoading = true; renderList();
        fetchPages(o.search).then(function (res) {
          o.pagesLoading = false;
          if (res.ok && res.data && Array.isArray(res.data.pages)) { o.pages = res.data.pages; o.error = ''; }
          else o.error = apiMsg(res, __('Search failed.', 'chapote-bot-manager'));
          renderList();
        });
      }, 300);
    });

    // Ordre : 1) rôle de l'assistant, 2) visiteurs/mois, 3) ajout manuel d'URL,
    // 4) liste des pages détectées. (Le rôle + le trafic d'abord — ils orientent
    // la génération ; la liste de pages, plus longue, vient ensuite.)

    // 1) Rôle de l'assistant (sert à la génération de l'arbre).
    var role = h('textarea', { rows: 2, class: 'large-text', maxlength: 600,
      placeholder: __('e.g. Answer customer questions about our services and guide them to book an appointment.', 'chapote-bot-manager') });
    role.value = o.role || '';
    role.addEventListener('input', function () { o.role = role.value; });
    card.appendChild(fieldFor(__('What will your assistant’s role be? (optional)', 'chapote-bot-manager'), role));

    // 2) Visiteurs / mois (sert au palier IA recommandé).
    var vis = h('select', { 'aria-label': __('Visitors per month', 'chapote-bot-manager') },
      h('option', { value: '', selected: !o.visitors }, __('I don’t know', 'chapote-bot-manager')),
      h('option', { value: '1000', selected: o.visitors === '1000' }, __('Fewer than 1,000 / month', 'chapote-bot-manager')),
      h('option', { value: '5000', selected: o.visitors === '5000' }, __('1,000 to 10,000 / month', 'chapote-bot-manager')),
      h('option', { value: '30000', selected: o.visitors === '30000' }, __('10,000 to 50,000 / month', 'chapote-bot-manager')),
      h('option', { value: '100000', selected: o.visitors === '100000' }, __('More than 50,000 / month', 'chapote-bot-manager'))
    );
    vis.addEventListener('change', function () { o.visitors = vis.value; });
    card.appendChild(fieldFor(__('How many visitors per month? (optional)', 'chapote-bot-manager'), vis));

    // 3) Ajout manuel d'une URL (même domaine).
    var manual = h('input', { type: 'url', class: 'regular-text', placeholder: 'https://' + (CFG.siteHost || 'my-site') + '/page', 'aria-label': __('Add a URL from your site', 'chapote-bot-manager') });
    manual.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addManual(manual.value); manual.value = ''; } });
    card.appendChild(h('div', { class: 'cbo-onb-manual' },
      h('label', { class: 'cbo-onb-manual-l', text: __('Add a page manually (same domain)', 'chapote-bot-manager') }),
      h('div', { class: 'cbo-onb-manual-row' }, manual,
        h('button', { type: 'button', class: 'button', onClick: function () { addManual(manual.value); manual.value = ''; } }, __('Add', 'chapote-bot-manager')))
    ));

    // 4) Liste des pages détectées (recherche + compteur + cases).
    card.appendChild(h('div', { class: 'cbo-onb-pickbar' }, search, counter));
    card.appendChild(listHost);

    var genBtn = h('button', { class: 'button button-primary button-hero', onClick: function () { submitGenerate(genBtn); } }, __('Generate my chatbot', 'chapote-bot-manager'));
    card.appendChild(actions(backBtn('choose'), genBtn));

    updateCounter();
    if (!o.pagesLoaded && !o.pagesLoading) {
      o.pagesLoading = true; renderList();
      fetchPages('').then(function (res) {
        o.pagesLoading = false;
        if (res.ok && res.data && Array.isArray(res.data.pages)) {
          o.pages = res.data.pages; o.pagesLoaded = true; o.error = '';
          if (!o.preselected) {
            o.preselected = true;
            o.pages.forEach(function (p) { if ((p.is_front || p.relevant) && Object.keys(o.selected).length < 15) o.selected[p.url] = true; });
          }
        } else { o.error = apiMsg(res, __('Could not list your pages.', 'chapote-bot-manager')); }
        updateCounter(); renderList();
      });
    } else { renderList(); }
  }

  function submitGenerate(btn) {
    var o = O();
    var urls = Object.keys(o.selected);
    if (!urls.length) { A.setNotice(__('Select at least one page.', 'chapote-bot-manager'), 'warn'); return; }
    if (urls.length > 15) { A.setNotice(__('Maximum of 15 pages.', 'chapote-bot-manager'), 'warn'); return; }
    btn.disabled = true;
    var body = { urls: urls };
    if (o.botId) body.bot_id = o.botId;
    if (CFG.siteName) body.name = CFG.siteName;
    if (o.role) body.description = o.role;
    if (o.visitors) body.visitors_per_month = parseInt(o.visitors, 10) || 0;
    call('POST', '/site/generate', body).then(function (res) {
      btn.disabled = false;
      if (!res.ok || !res.data) { A.setNotice(apiMsg(res, __('Generation failed.', 'chapote-bot-manager')), 'warn'); return; }
      o.botId = res.data.bot_id ? String(res.data.bot_id) : o.botId;
      o.jobId = res.data.job_id ? String(res.data.job_id) : '';
      persist({ bot_id: o.botId, step: 'customize' });
      goTo('customize');
    });
  }

  /* ------------------------------------------------------- 5. customize */

  function renderCustomize(card) {
    var o = O();
    if (!o.botId) { defer(function () { goTo('choose'); }); return; }
    card.appendChild(h('h2', { text: __('Customize the appearance', 'chapote-bot-manager') }));
    card.appendChild(h('p', { class: 'cbo-muted', text:
      __('Colors, welcome message, position… Changes are saved automatically. Meanwhile, your assistant is being built in the background.', 'chapote-bot-manager') }));
    var host = h('div', { class: 'cbo-onb-embed' });
    card.appendChild(host);
    card.appendChild(actions(backBtn('pick'),
      h('button', { class: 'button button-primary button-hero', onClick: function () { goTo('waiting'); } }, __('Continue', 'chapote-bot-manager'))));
    mountAppearance(host);
  }

  function mountAppearance(host) {
    var o = O();
    stopEditorSync(); // pas de double écoute si on revient sur cette étape
    clear(host); host.appendChild(loadingNote(__('Opening the appearance editor…', 'chapote-bot-manager')));
    call('POST', '/bots/' + encodeURIComponent(o.botId) + '/embed-token').then(function (res) {
      if (!res.ok || !res.data || !res.data.embed_token) {
        clear(host); host.appendChild(h('p', { class: 'cbo-error', text: apiMsg(res, __('The appearance editor is unavailable.', 'chapote-bot-manager')) }));
        return;
      }
      var nonce = randNonce();
      o.editorNonce = nonce;
      var url = (CFG.appBase || '') + '/embed/appearance' + embedFrag(res.data.embed_token, nonce);
      clear(host);
      host.appendChild(h('iframe', { class: 'cbo-onb-iframe', src: url, title: __('Chatbot appearance', 'chapote-bot-manager'), allow: 'clipboard-write' }));
      o.unlisten = listenEmbed(nonce, function () {}); // saved/dirty informatifs
    });
  }

  /* --------------------------------------------------------- 6. waiting */

  function renderWaiting(card) {
    var o = O();
    if (!o.botId) { defer(function () { goTo('choose'); }); return; }
    card.appendChild(h('h2', { text: __('Your assistant is being built…', 'chapote-bot-manager') }));
    var bar = h('div', { class: 'cbo-onb-bar' });
    var fill = h('div', { class: 'cbo-onb-bar-fill', style: 'width:6%' });
    bar.appendChild(fill);
    var stage = h('p', { class: 'cbo-muted', role: 'status', 'aria-live': 'polite', text: __('Initializing…', 'chapote-bot-manager') });
    card.appendChild(bar);
    card.appendChild(stage);
    card.appendChild(h('p', { class: 'cbo-muted', text: __('This usually takes less than a minute.', 'chapote-bot-manager') }));
    var act = h('div', { class: 'cbo-onb-actions' });
    card.appendChild(act);

    if (!o.jobId) { defer(function () { goTo('tree'); }); return; } // chemin vierge / repris
    // Pendant la génération, on peut revenir à la Personnalisation.
    card.appendChild(actions(backBtn('customize')));
    pollJob(o, stage, fill, act);
  }

  function stageLabel(stage) {
    var M = {
      queued: __('Waiting in queue…', 'chapote-bot-manager'), fetch: __('Reading your pages…', 'chapote-bot-manager'), scrape: __('Reading your pages…', 'chapote-bot-manager'),
      analyze: __('Analyzing the content…', 'chapote-bot-manager'), plan: __('Designing the conversation tree…', 'chapote-bot-manager'), generate: __('Writing the answers…', 'chapote-bot-manager'),
      build: __('Assembling…', 'chapote-bot-manager'), finalize: __('Finalizing…', 'chapote-bot-manager')
    };
    return M[stage] || __('Build in progress…', 'chapote-bot-manager');
  }
  function pollJob(o, stage, fill, act) {
    var tries = 0, MAX = 120;
    (function loop() {
      if (O() !== o || o.step !== 'waiting') return; // navigation : on abandonne
      tries++;
      call('GET', '/bots/' + encodeURIComponent(o.botId) + '/tree-job/' + encodeURIComponent(o.jobId)).then(function (res) {
        if (O() !== o || o.step !== 'waiting') return;
        if (!res.ok) { if (tries < MAX) setTimeout(loop, 3000); return; }
        var d = res.data || {};
        var st = String(d.status || '');
        if (d.stage) stage.textContent = stageLabel(d.stage);
        if (d.pct != null) fill.style.width = Math.max(6, Math.min(100, d.pct)) + '%';
        if (st === 'done' || st === 'completed' || st === 'ready' || st === 'success') {
          if (d.tree_json) o.tree = d.tree_json;
          fill.style.width = '100%';
          goTo('tree'); return;
        }
        if (st === 'error' || st === 'failed') { jobError(act, d.error || __('Generation failed.', 'chapote-bot-manager')); return; }
        if (tries < MAX) setTimeout(loop, 2500);
        else jobError(act, __('Generation is taking longer than expected. Try again in a moment.', 'chapote-bot-manager'));
      });
    })();
  }
  function jobError(act, msg) {
    clear(act);
    act.appendChild(h('p', { class: 'cbo-error', text: msg }));
    act.appendChild(h('button', { class: 'button', onClick: function () { goTo('pick'); } }, __('Back to page selection', 'chapote-bot-manager')));
  }

  /* ------------------------------------------------------------ 7. tree */

  function renderTree(card) {
    var o = O();
    if (!o.botId) { defer(function () { goTo('choose'); }); return; }
    card.appendChild(h('h2', { text: __('Your conversation tree', 'chapote-bot-manager') }));
    card.appendChild(h('p', { class: 'cbo-muted', text:
      __('Here is the generated structure. Open the editor to adjust questions and answers; your changes sync back here automatically.', 'chapote-bot-manager') }));
    var treeHost = h('div', { class: 'cbo-onb-tree' });
    card.appendChild(treeHost);
    card.appendChild(actions(
      // Retour vers Personnalisation : 'waiting' est transitoire (il redirige vers
      // 'tree' dès que le job est fini) → y revenir bouclerait.
      backBtn('customize'),
      h('button', { class: 'button button-primary', onClick: function (e) { openEditor(e.currentTarget, treeHost); } }, __('Open the editor', 'chapote-bot-manager')),
      h('button', { class: 'button button-primary button-hero', onClick: function () { if (o.editorWin && !o.editorWin.closed) postToEditor('request-save'); goTo('preview'); } }, __('Continue', 'chapote-bot-manager'))
    ));
    loadBotTree(treeHost);
  }

  function loadBotTree(treeHost) {
    var o = O();
    clear(treeHost); treeHost.appendChild(loadingNote(__('Loading the tree…', 'chapote-bot-manager')));
    call('GET', '/bots/' + encodeURIComponent(o.botId)).then(function (res) {
      if (!res.ok || !res.data) { clear(treeHost); treeHost.appendChild(h('p', { class: 'cbo-error', text: apiMsg(res, __('Could not load the tree.', 'chapote-bot-manager')) })); return; }
      o.bot = res.data;
      o.tree = res.data.tree_json || o.tree;
      o.updatedAt = res.data.updated_at || o.updatedAt;
      o.quickReplies = deriveQuickReplies(o.tree);
      renderTreeView(treeHost);
    });
  }
  // Rendu hiérarchique badgé, ordonné par parcours depuis `start` (Accueil en
  // tête). Une carte par étape : badge de type (Question/Conseiller/Lead/RDV),
  // message tronqué, options en sous-items avec marquage « → IA ».
  function renderTreeView(treeHost) {
    var o = O();
    clear(treeHost);
    var ordered = orderedNodes(o.tree);
    if (!ordered.length) { treeHost.appendChild(h('p', { class: 'cbo-muted', text: __('The tree is still empty — open the editor to build it.', 'chapote-bot-manager') })); return; }
    /* translators: %s: number of conversation steps */
    treeHost.appendChild(h('p', { class: 'cbo-onb-treecount', text: ordered.length === 1 ? __('1 conversation step', 'chapote-bot-manager') : _sprintf(__('%s conversation steps', 'chapote-bot-manager'), ordered.length) }));
    var startNode = startNodeOf(o.tree), usesAi = false, list = h('ol', { class: 'cbo-onb-tree-list' });
    ordered.forEach(function (n) {
      var isStart = startNode && n.id === startNode.id, k = nodeKind(n), meta = KIND_META[k] || KIND_META.q;
      var li = h('li', { class: 'cbo-onb-node ' + meta.cls },
        h('div', { class: 'cbo-onb-node-head' },
          h('span', { class: 'cbo-onb-badge2 ' + meta.cls, text: isStart ? __('Home', 'chapote-bot-manager') : meta.label }),
          h('span', { class: 'cbo-onb-node-msg', text: trunc(nodeMessage(n), 140) })));
      var opts = nodeOptions(n);
      if (opts.length) {
        var ul = h('ul', { class: 'cbo-onb-opts' });
        opts.slice(0, 8).forEach(function (op) {
          var toAi = optNext(op) === AI_ID; if (toAi) usesAi = true;
          ul.appendChild(h('li', { class: 'cbo-onb-opt' + (toAi ? ' is-ai' : '') },
            h('span', { class: 'cbo-onb-opt-l', text: trunc(optLabel(op), 60) }),
            toAi ? h('span', { class: 'cbo-onb-opt-to', text: __('→ AI', 'chapote-bot-manager') }) : null));
        });
        /* translators: %s: number of additional options not shown */
        if (opts.length > 8) ul.appendChild(h('li', { class: 'cbo-onb-opt cbo-muted', text: _sprintf(__('+ %s more', 'chapote-bot-manager'), opts.length - 8) }));
        li.appendChild(ul);
      } else if (k === 'hum') { li.appendChild(h('p', { class: 'cbo-onb-opt-note', text: __('Hands the visitor over to a human agent', 'chapote-bot-manager') })); }
      else if (k === 'lead') { li.appendChild(h('p', { class: 'cbo-onb-opt-note', text: __('Collects the visitor’s contact details', 'chapote-bot-manager') })); }
      else if (k === 'rdv') { li.appendChild(h('p', { class: 'cbo-onb-opt-note', text: __('Offers to book an appointment', 'chapote-bot-manager') })); }
      list.appendChild(li);
    });
    treeHost.appendChild(list);
    if (usesAi) treeHost.appendChild(h('p', { class: 'cbo-onb-ai-note', text: __('Open-ended questions are handled by the AI.', 'chapote-bot-manager') }));
  }

  function openEditor(btn, treeHost) {
    var o = O();
    if (btn) btn.disabled = true;
    call('POST', '/bots/' + encodeURIComponent(o.botId) + '/embed-token').then(function (res) {
      if (btn) btn.disabled = false;
      if (!res.ok || !res.data || !res.data.embed_token) { A.setNotice(apiMsg(res, __('The editor is unavailable.', 'chapote-bot-manager')), 'warn'); return; }
      var nonce = randNonce();
      o.editorNonce = nonce;
      var url = (CFG.appBase || '') + '/embed/tree-editor' + embedFrag(res.data.embed_token, nonce, o.jobId);
      var win = window.open(url, 'chapote_editor', 'width=1200,height=820');
      if (!win) { A.setNotice(__('Allow pop-up windows to open the editor.', 'chapote-bot-manager'), 'warn'); return; }
      o.editorWin = win;
      startEditorSync(nonce, win, treeHost);
    });
  }

  // Synchronisation éditeur : le postMessage (saved/error) est la voie PRIMAIRE ;
  // le POLLING updated_at n'est qu'un filet tant que la fenêtre est ouverte (cas
  // d'un onglet sans opener). À la fermeture : ultime rechargement, puis arrêt.
  function startEditorSync(nonce, win, treeHost) {
    var o = O();
    stopEditorSync();
    o.unlisten = listenEmbed(nonce, function (msg) {
      if (msg.type === 'saved') {
        A.setNotice(__('Changes saved.', 'chapote-bot-manager'), 'ok');
        // L'arbre est désormais en DB : on oublie le job de génération (sinon une
        // ré-ouverture rechargerait l'arbre généré périmé et masquerait l'édition).
        var s = O(); if (s) s.jobId = '';
        loadBotTree(treeHost);
      }
      else if (msg.type === 'error') { A.setNotice(__('An error occurred in the editor.', 'chapote-bot-manager'), 'warn'); }
    });
    o.syncTimer = setInterval(function () {
      var cur = O();
      if (!cur || cur.editorWin !== win) { clearInterval(o.syncTimer); return; }
      if (!win || win.closed) { stopEditorSync(); cur.editorWin = null; loadBotTree(treeHost); return; }
      call('GET', '/bots/' + encodeURIComponent(cur.botId)).then(function (res) {
        if (res.ok && res.data && res.data.updated_at && res.data.updated_at !== cur.updatedAt) {
          cur.updatedAt = res.data.updated_at;
          cur.jobId = ''; // une sauvegarde a eu lieu : la DB fait foi, on lâche le job généré
          cur.bot = res.data; cur.tree = res.data.tree_json || cur.tree;
          cur.quickReplies = deriveQuickReplies(cur.tree);
          if (O() === cur && cur.step === 'tree') renderTreeView(treeHost);
        }
      });
    }, EDITOR_POLL_MS);
  }
  function stopEditorSync() {
    var o = O(); if (!o) return;
    if (o.syncTimer) { clearInterval(o.syncTimer); o.syncTimer = null; }
    if (typeof o.unlisten === 'function') { o.unlisten(); o.unlisten = null; }
  }
  function postToEditor(type, extra) {
    var o = O();
    if (!o || !o.editorWin || o.editorWin.closed || !o.editorNonce) return;
    var msg = { source: 'chapote-admin', nonce: o.editorNonce, type: type };
    if (extra) { for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) msg[k] = extra[k]; }
    try { o.editorWin.postMessage(msg, appOrigin()); } catch (e) {}
  }

  /* --------------------------------------------------------- 8. preview */

  function renderPreview(card) {
    var o = O();
    if (!o.botId) { defer(function () { goTo('choose'); }); return; }
    card.appendChild(h('h2', { text: __('Preview your chatbot', 'chapote-bot-manager') }));
    card.appendChild(h('p', { class: 'cbo-muted', text: __('Try your assistant exactly as your visitors will see it. This preview is private.', 'chapote-bot-manager') }));
    var host = h('div', { class: 'cbo-onb-preview' });
    card.appendChild(host);
    card.appendChild(actions(
      backBtn('tree'),
      // Reset : token frais + iframe neuve = conversation vierge (le widget ne
      // restaure pas la session en mode aperçu).
      h('button', { class: 'button cbo-onb-reset', type: 'button', onClick: function () { loadPreview(host); } }, __('↻ Start over', 'chapote-bot-manager')),
      h('button', { class: 'button button-primary button-hero', onClick: function () { goTo('offer'); } }, __('See my plan', 'chapote-bot-manager'))
    ));
    loadPreview(host);
  }

  function loadPreview(host) {
    var o = O();
    clear(host); host.appendChild(loadingNote(__('Preparing the preview…', 'chapote-bot-manager')));
    call('POST', '/bots/' + encodeURIComponent(o.botId) + '/preview-token').then(function (res) {
      if (!res.ok || !res.data || !res.data.preview_token) { clear(host); host.appendChild(h('p', { class: 'cbo-error', text: apiMsg(res, __('The preview is unavailable.', 'chapote-bot-manager')) })); return; }
      var token = res.data.preview_token;
      // /widget-frame exige le couple key(public_key)+preview_token (le token
      // seul ne suffit pas : bootstrap valide bot.public_key == key).
      function show(pk) {
        var url = (CFG.apiBase || '') + '/widget-frame?key=' + encodeURIComponent(pk) +
          '&preview_token=' + encodeURIComponent(token);
        clear(host);
        host.appendChild(h('iframe', { class: 'cbo-onb-widgetframe', src: url, title: __('Chatbot preview', 'chapote-bot-manager'),
          sandbox: 'allow-scripts allow-forms allow-same-origin allow-popups' }));
      }
      var pk = (o.bot && o.bot.public_key) || '';
      if (pk) { show(pk); return; }
      // Repli (ex. arrivée sur l'aperçu sans passer par l'arbre) : on récupère
      // le public_key via GET /bots/{id} avant de monter l'iframe.
      call('GET', '/bots/' + encodeURIComponent(o.botId)).then(function (r2) {
        if (r2.ok && r2.data) { o.bot = r2.data; }
        show((o.bot && o.bot.public_key) || '');
      });
    });
  }

  /* ----------------------------------------------------------- 9. offer */

  function renderOffer(card) {
    var o = O();
    if (!o.botId) { defer(function () { goTo('choose'); }); return; }
    card.appendChild(h('h2', { text: __('Your recommended plan', 'chapote-bot-manager') }));
    var pane = h('div', { class: 'cbo-onb-offer' });
    card.appendChild(pane);
    pane.appendChild(loadingNote(__('Working out the best plan…', 'chapote-bot-manager')));
    Promise.all([
      call('POST', '/bots/' + encodeURIComponent(o.botId) + '/recommendation', recoBody(o)),
      call('GET', '/catalog'),
      call('GET', '/bots/' + encodeURIComponent(o.botId))
    ]).then(function (r) {
      var rec = (r[0].ok && r[0].data) ? r[0].data : null;
      var catRes = r[1];
      var live = (catRes.ok && catRes.data && (Array.isArray(catRes.data.modules) || catRes.data.billing === 'disabled')) ? catRes.data : null;
      var bot = (r[2].ok && r[2].data) ? r[2].data : (o.bot || { id: o.botId });
      o.recommendation = rec;
      clear(pane);
      if (!live) {
        pane.appendChild(h('p', { class: 'cbo-error', text: __('The catalog is unavailable — try again in a moment.', 'chapote-bot-manager') }));
        pane.appendChild(actions(backBtn('preview')));
        return;
      }
      buildOffer(pane, bot, live, rec);
    });
  }
  function recoBody(o) {
    // On n'envoie PLUS l'arbre : la couche WP REST altérait l'objet imbriqué
    // (relayé en chaîne/liste -> 422 qui vidait la reco). Le backend utilise
    // l'arbre SAUVÉ du bot (autoritatif : l'éditeur le persiste, l'aperçu le lit).
    var b = {};
    if (o.role) b.description = o.role;
    if (o.visitors) b.visitors_per_month = parseInt(o.visitors, 10) || 0;
    return b;
  }
  function buildOffer(pane, bot, catalog, rec) {
    // Bot synthétique pré-rempli depuis la recommandation (buildPaymentForm lit
    // bot.modules / ai_tier_id / ai_byok pour pré-cocher).
    var sBot = {};
    for (var k in bot) if (Object.prototype.hasOwnProperty.call(bot, k)) sBot[k] = bot[k];
    if (rec) {
      var mods = Array.isArray(rec.recommended_modules) ? rec.recommended_modules.slice()
        : (Array.isArray(bot.modules) ? bot.modules.slice() : []);
      if ((rec.recommended_ai_tier || rec.recommended_byok) && mods.indexOf('ai') === -1) mods.push('ai');
      sBot.modules = mods;
      sBot.ai_tier_id = rec.recommended_ai_tier || sBot.ai_tier_id;
      sBot.ai_byok = !!rec.recommended_byok;
    }

    var banner = h('div', { class: 'cbo-onb-reco' },
      h('strong', { text: __('Based on your tree and your answers, here is the recommended plan.', 'chapote-bot-manager') }));
    if (rec && rec.reason) banner.appendChild(h('p', { class: 'cbo-muted', text: rec.reason }));
    /* translators: %s: estimated number of replies per month */
    if (rec && rec.expected_replies) banner.appendChild(h('p', { class: 'cbo-muted',
      text: _sprintf(__('Estimated volume: about %s replies / month.', 'chapote-bot-manager'), Number(rec.expected_replies).toLocaleString('fr-FR')) }));
    // Pourquoi cette formule : explication PERSONNALISÉE générée par l'IA si dispo
    // (sur mesure pour ce commerce), sinon repli sur la liste statique par module.
    if (rec && rec.explanation_ai) {
      banner.appendChild(h('p', { class: 'cbo-onb-reco-pitch', text: rec.explanation_ai }));
    } else if (rec && Array.isArray(rec.explanations) && rec.explanations.length) {
      banner.appendChild(h('p', { class: 'cbo-onb-reco-intro',
        text: __('In practice, here is what your assistant uses — and why:', 'chapote-bot-manager') }));
      var exList = h('ul', { class: 'cbo-onb-reco-list' });
      rec.explanations.forEach(function (ex) {
        exList.appendChild(h('li', null,
          h('strong', { text: ex.title }), h('span', { text: ' — ' + ex.why })));
      });
      banner.appendChild(exList);
    }

    A.buildPaymentForm(pane, sBot, catalog, {
      banner: banner,
      required: (rec && Array.isArray(rec.required_modules)) ? rec.required_modules : [],
      submitLabel: __('Subscribe and activate', 'chapote-bot-manager'),
      onSubscribe: function (config, consent, btn) { offerSubscribe(config, consent, btn); }
      // Pas de bouton « version gratuite » : le modèle n'a pas de palier gratuit
      // (souscription requise pour activer le widget).
    });
    pane.appendChild(h('div', { class: 'cbo-onb-actions cbo-onb-actions-back' }, backBtn('preview')));
  }

  function offerSubscribe(config, consent, btn) {
    var o = O();
    if (!consent) { A.setNotice(__('Check the immediate-execution consent box to subscribe.', 'chapote-bot-manager'), 'warn'); return; }
    if (btn) btn.disabled = true;
    pruneIfNeeded(config.modules).then(function () {
      persist({ step: 'activation', bot_id: o.botId });
      // doCheckout cible CBOAdmin.state.botId : on l'aligne sur le bot d'onboarding.
      A.state.botId = o.botId;
      A.doCheckout(btn || document.createElement('button'), config, true); // redirige vers Stripe
    });
  }
  // Élague l'arbre aux modules conservés si un module REQUIS a été retiré, PUIS
  // persiste l'arbre élagué : `tree-prune` ne calcule que le diff (sans sauver),
  // donc on enchaîne un PUT /tree pour que les sections promises « retirées » le
  // soient réellement (sinon le runtime se contente de les gater silencieusement).
  // Best-effort : un échec de persistance ne bloque pas la souscription (le
  // gating runtime reste le filet).
  function pruneIfNeeded(keptModules) {
    var o = O();
    var rec = o.recommendation;
    if (!rec || !Array.isArray(rec.required_modules)) return Promise.resolve();
    var kept = {}; (keptModules || []).forEach(function (k) { kept[k] = 1; });
    var dropped = rec.required_modules.filter(function (k) { return !kept[k]; });
    if (!dropped.length) return Promise.resolve();
    var id = encodeURIComponent(o.botId);
    return call('POST', '/bots/' + id + '/tree-prune', { kept_modules: keptModules || [] })
      .then(function (res) {
        if (res.ok && res.data && res.data.tree_json &&
            Array.isArray(res.data.removed_node_ids) && res.data.removed_node_ids.length) {
          return call('PUT', '/bots/' + id + '/tree', { tree_json: res.data.tree_json });
        }
      });
  }
  /* ------------------------------------------------------ 10. activation */

  function renderActivation(card) {
    var o = O();
    if (!o.botId) { defer(function () { goTo('choose'); }); return; }
    card.appendChild(h('h2', { text: __('Activation on your site', 'chapote-bot-manager') }));
    var status = h('p', { class: 'cbo-muted', role: 'status', 'aria-live': 'polite' });
    var body = h('div', { class: 'cbo-onb-activate' });
    card.appendChild(status);
    card.appendChild(body);

    if (o.done) { renderDone(status, body); return; }
    if (o.error) {
      body.appendChild(h('p', { class: 'cbo-error', text: o.error }));
      body.appendChild(h('button', { class: 'button button-primary', onClick: function () { o.error = ''; o.activating = false; kickoffActivation(status); } }, __('Try again', 'chapote-bot-manager')));
      return;
    }
    if (o.stripe === 'cancel' && !o.activating) {
      status.textContent = __('Payment canceled.', 'chapote-bot-manager');
      body.appendChild(h('p', { class: 'cbo-muted', text: __('You can review the plan or activate the free version.', 'chapote-bot-manager') }));
      body.appendChild(actions(
        h('button', { class: 'button', onClick: function () { o.stripe = ''; goTo('offer'); } }, __('Review the plan', 'chapote-bot-manager')),
        h('button', { class: 'button button-primary', onClick: function () { o.stripe = ''; kickoffActivation(status); } }, __('Activate the free version', 'chapote-bot-manager'))
      ));
      return;
    }
    status.textContent = __('Putting your assistant live…', 'chapote-bot-manager');
    if (!o.activating) kickoffActivation(status);
  }

  function kickoffActivation(status) {
    var o = O();
    o.activating = true;
    if (o.stripe === 'success') {
      status.textContent = __('Payment received. Verifying your subscription…', 'chapote-bot-manager');
      waitBillingThenEnable(status);
    } else {
      enableWidget(status);
    }
  }
  // Borné comme pollBillingActive du back-office (12 essais / 3 s) ; à l'échéance
  // on active quand même (le widget sert tous les bots servables, même gratuits).
  function waitBillingThenEnable(status) {
    var o = O(); var tries = 0, MAX = 12;
    (function loop() {
      if (O() !== o || o.step !== 'activation') return;
      tries++;
      call('GET', '/bots/' + encodeURIComponent(o.botId)).then(function (res) {
        var bs = (res.ok && res.data) ? res.data.billing_status : '';
        if (bs === 'active' || bs === 'trialing') { enableWidget(status); return; }
        if (tries < MAX) { setTimeout(loop, 3000); return; }
        status.textContent = __('Your subscription is still being validated — activating your widget in the meantime.', 'chapote-bot-manager');
        enableWidget(status);
      });
    })();
  }
  function enableWidget(status) {
    var o = O();
    if (status) status.textContent = __('Activating the widget on your site…', 'chapote-bot-manager');
    call('POST', '/bots/' + encodeURIComponent(o.botId) + '/local', { enabled: true, targeting: defaultTargeting() }).then(function (res) {
      var cur = O(); if (!cur) return;
      if (!res.ok) {
        cur.activating = false; cur.error = apiMsg(res, __('Activation failed. Try again.', 'chapote-bot-manager'));
        if (O() === cur && cur.step === 'activation') A.render();
        return;
      }
      call('POST', '/onboarding', { done: true, bot_id: cur.botId, step: 'activation' });
      if (CFG.onboarding) CFG.onboarding.done = true;
      cur.done = true; cur.activating = false;
      if (O() === cur && cur.step === 'activation') A.render();
    });
  }
  function defaultTargeting() {
    return { mode: 'everywhere', include_front: true, include_types: [], include_ids: [], exclude_types: [], exclude_ids: [] };
  }
  function renderDone(status, body) {
    status.textContent = '';
    clear(body);
    body.appendChild(h('div', { class: 'cbo-onb-success' },
      h('div', { class: 'cbo-onb-success-ic', text: '✓' }),
      h('h3', { text: __('Your chatbot is live!', 'chapote-bot-manager') }),
      h('p', { class: 'cbo-muted', text: __('It is now answering your visitors. You can adjust everything from “My bots”.', 'chapote-bot-manager') }),
      actions(
        h('button', { class: 'button button-primary button-hero', onClick: function () { A.exitOnboarding(__('Welcome to your Chapote dashboard.', 'chapote-bot-manager'), 'ok'); } }, __('Go to the dashboard', 'chapote-bot-manager')),
        CFG.homeUrl ? h('a', { class: 'button', href: CFG.homeUrl, target: '_blank', rel: 'noopener' }, __('View my site', 'chapote-bot-manager')) : null
      )
    ));
  }

  /* --------------------------------------------------------- helpers */

  function embedFrag(token, nonce, job) {
    var f = '#t=' + encodeURIComponent(token) + '&bot=' + encodeURIComponent(O().botId) +
      '&o=' + encodeURIComponent(window.location.origin) + '&n=' + encodeURIComponent(nonce);
    if (job) f += '&job=' + encodeURIComponent(job);
    return f;
  }
  function appOrigin() {
    try { return new URL(CFG.appBase || '').origin; } catch (e) { return CFG.appBase || ''; }
  }
  // Écoute les messages d'une fenêtre/iframe embed du dashboard. Validation stricte :
  // origine = app Chapote, source 'chapote-editor', nonce attendu.
  function listenEmbed(nonce, onMsg) {
    var origin = appOrigin();
    function handler(ev) {
      if (!origin || ev.origin !== origin) return;
      var d = ev.data;
      if (!d || d.source !== 'chapote-editor' || d.nonce !== nonce) return;
      onMsg(d);
    }
    window.addEventListener('message', handler);
    return function () { window.removeEventListener('message', handler); };
  }
  function randNonce() {
    try {
      var a = new Uint8Array(16); window.crypto.getRandomValues(a);
      return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    } catch (e) { return String(Date.now()) + Math.random().toString(16).slice(2); }
  }

  function treeNodes(tree) {
    if (!tree) return [];
    var n = tree.nodes;
    if (Array.isArray(n)) return n;
    if (n && typeof n === 'object') {
      return Object.keys(n).map(function (k) { var x = n[k]; if (x && typeof x === 'object' && x.id == null) x.id = k; return x; });
    }
    if (Array.isArray(tree)) return tree;
    return [];
  }
  function startNodeOf(tree) {
    if (!tree) return null;
    var nodes = treeNodes(tree);
    var id = tree.start || tree.start_node_id || tree.root || tree.entry;
    if (id != null) { var f = nodes.filter(function (n) { return n && n.id === id; })[0]; if (f) return f; }
    var st = nodes.filter(function (n) { return n && (n.type === 'start' || n.kind === 'start'); })[0];
    return st || nodes[0] || null;
  }
  function deriveQuickReplies(tree) {
    if (!tree) return [];
    var node = startNodeOf(tree);
    var opts = (node && (node.options || node.choices || node.replies)) || [];
    if (!Array.isArray(opts)) return [];
    return opts.map(function (o) { return (o && (o.label || o.text || o.title || o.value)) || ''; })
      .filter(Boolean).slice(0, 8);
  }
  // --- Rendu d'arbre (renderTreeView) : type, options, parcours, troncature.
  var AI_ID = '__ai__';
  var KIND_META = {
    q: { label: __('Question', 'chapote-bot-manager'), cls: 'is-q' }, hum: { label: __('Agent', 'chapote-bot-manager'), cls: 'is-hum' },
    lead: { label: __('Lead', 'chapote-bot-manager'), cls: 'is-lead' }, rdv: { label: __('Appointment', 'chapote-bot-manager'), cls: 'is-rdv' }
  };
  function nodeKind(n) {
    if (!n) return 'q';
    if (n.type === 'handoff') return 'hum';
    if (n.type === 'lead') return 'lead';
    if (n.type === 'appointment') return 'rdv';
    return 'q';
  }
  function nodeOptions(n) { var o = n && (n.options || n.choices || n.replies); return Array.isArray(o) ? o : []; }
  function optLabel(o) { return (o && (o.label || o.text || o.title || o.value)) || __('Option', 'chapote-bot-manager'); }
  function optNext(o) { return o && (o.next != null ? o.next : (o.target != null ? o.target : o.goto)); }
  function nodeMessage(n) { var m = n && (n.message || n.text || n.prompt || n.title || n.label || n.name); return m ? String(m) : __('(no message)', 'chapote-bot-manager'); }
  function trunc(s, n) {
    s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s;
  }
  // Parcours en largeur depuis `start` (ordre de conversation), puis orphelins.
  function orderedNodes(tree) {
    var nodes = treeNodes(tree), byId = {};
    nodes.forEach(function (n) { if (n && n.id != null) byId[n.id] = n; });
    var start = startNodeOf(tree), out = [], seen = {}, q = start ? [start] : [];
    while (q.length) {
      var n = q.shift();
      if (!n || n.id == null || seen[n.id]) continue;
      seen[n.id] = 1; out.push(n);
      nodeOptions(n).forEach(function (o) { var nx = optNext(o); if (nx != null && nx !== AI_ID && byId[nx] && !seen[nx]) q.push(byId[nx]); });
    }
    nodes.forEach(function (n) { if (n && n.id != null && !seen[n.id]) { seen[n.id] = 1; out.push(n); } });
    return out;
  }

  /* --------------------------------------------------------- expose */

  window.CBOOnboarding = { init: init, view: view, afterConnect: afterConnect };
})();
