/**
 * Chapote Chatbot — wizard d'onboarding guidé (window.CBOOnboarding).
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

  var C = window.CBOCore || {};
  var A = window.CBOAdmin || {};
  var CFG = window.CHAPOTE_BO || {};

  var h = C.h, clear = C.clear, loadingNote = C.loadingNote, apiMsg = C.apiMsg, call = C.call, fieldFor = C.fieldFor;

  // Phases visibles du stepper (regroupent les étapes internes).
  var PHASES = [
    { label: 'Connexion',       steps: ['welcome', 'auth'] },
    { label: 'Votre site',      steps: ['choose', 'pick'] },
    { label: 'Personnalisation', steps: ['customize'] },
    { label: 'Génération',      steps: ['waiting', 'tree'] },
    { label: 'Aperçu',          steps: ['preview'] },
    { label: 'Offre',           steps: ['offer'] },
    { label: 'En ligne',        steps: ['activation'] }
  ];

  // Étapes exigeant un bot déjà créé (sinon on retombe au choix de la source).
  var NEEDS_BOT = { customize: 1, waiting: 1, tree: 1, preview: 1, offer: 1, activation: 1 };

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
      if (onb.done || bots.length > 0) { A.exitOnboarding('Connecté à Chapote.', 'ok'); return; }
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
    return h('button', { type: 'button', class: 'button cbo-onb-back', onClick: function () { goTo(step); } }, '← Retour');
  }
  function actions() {
    var a = h('div', { class: 'cbo-onb-actions' });
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) a.appendChild(arguments[i]);
    return a;
  }

  /* --------------------------------------------------------- 1. welcome */

  function renderWelcome(card) {
    card.appendChild(h('div', { class: 'cbo-onb-hero' },
      h('span', { class: 'cbo-onb-badge', text: 'Assistant guidé' }),
      h('h2', { text: 'Créons votre chatbot, ensemble' }),
      h('p', { class: 'cbo-onb-lead', text:
        'En quelques minutes : on analyse votre site, une IA génère un assistant prêt à répondre, vous le personnalisez, et il passe en ligne.' }),
      h('ul', { class: 'cbo-onb-bullets' },
        h('li', null, 'On lit vos pages pour comprendre votre activité'),
        h('li', null, 'Une IA construit l’arbre de conversation'),
        h('li', null, 'Vous ajustez l’apparence et le contenu'),
        h('li', null, 'Activation sur votre site en un clic')
      ),
      actions(h('button', { class: 'button button-primary button-hero',
        onClick: function () { goTo(S().connected ? 'choose' : 'auth'); } }, 'Commencer'))
    ));
  }

  /* ------------------------------------------------------------ 2. auth */

  function renderAuth(card) {
    if (S().connected) {
      card.appendChild(h('h2', { text: 'Vous êtes connecté à Chapote' }));
      card.appendChild(actions(backBtn('welcome'),
        h('button', { class: 'button button-primary', onClick: function () { goTo('choose'); } }, 'Continuer')));
      return;
    }
    card.appendChild(h('h2', { text: 'Connectez votre site à Chapote' }));
    card.appendChild(h('p', { class: 'cbo-muted', text:
      'Une fenêtre Chapote va s’ouvrir pour autoriser ce site, puis vous reviendrez ici. Vos identifiants ne transitent jamais par WordPress.' }));
    if (CFG.cryptoOk === false) {
      card.appendChild(h('p', { class: 'cbo-error', text:
        'OpenSSL (AES-256-GCM) indisponible : impossible de stocker vos identifiants de façon chiffrée.' }));
    }
    var info = h('div', { class: 'cbo-device' });
    var btn = h('button', { class: 'button button-primary button-hero', disabled: CFG.cryptoOk === false,
      onClick: function () { A.startConnect(btn, info); } }, 'Se connecter avec Chapote');
    card.appendChild(btn);
    card.appendChild(info);
    card.appendChild(actions(backBtn('welcome')));
  }

  /* ---------------------------------------------------------- 3. choose */

  function renderChoose(card) {
    card.appendChild(h('h2', { text: 'On part de votre site WordPress' }));
    card.appendChild(h('p', { class: 'cbo-muted' },
      'Nous allons lister vos pages publiées pour comprendre votre activité et générer un assistant pertinent. Site analysé : ',
      h('strong', { text: CFG.siteHost || CFG.homeUrl || 'ce site' }), '.'));
    card.appendChild(actions(
      h('button', { class: 'button button-primary button-hero', onClick: function () { goTo('pick'); } }, 'Analyser mon site'),
      h('button', { class: 'button', onClick: function (e) { startBlank(e.currentTarget); } }, 'Partir d’un assistant vierge')
    ));
  }

  function startBlank(btn) {
    if (btn) btn.disabled = true;
    call('POST', '/bots', { name: CFG.siteName || 'Mon assistant', mode: 'hybrid' }).then(function (res) {
      if (btn) btn.disabled = false;
      if (!res.ok || !res.data || !res.data.id) { A.setNotice(apiMsg(res, 'Création impossible.'), 'warn'); return; }
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
    card.appendChild(h('h2', { text: 'Quelles pages décrivent votre activité ?' }));
    card.appendChild(h('p', { class: 'cbo-muted', text:
      'Cochez jusqu’à 15 pages. Les plus utiles sont pré-sélectionnées. Vous pourrez tout ajuster ensuite.' }));

    var counter = h('span', { class: 'cbo-onb-counter' });
    var search = h('input', { type: 'search', class: 'regular-text', placeholder: 'Rechercher une page…',
      value: o.search || '', 'aria-label': 'Rechercher une page' });
    var listHost = h('div', { class: 'cbo-onb-pages', role: 'group', 'aria-label': 'Pages de votre site' });

    function updateCounter() {
      var n = Object.keys(o.selected).length;
      clear(counter);
      counter.appendChild(h('strong', { text: n + ' / 15' }));
      counter.appendChild(h('span', { text: ' sélectionnée' + (n > 1 ? 's' : '') }));
      counter.classList.toggle('is-over', n >= 15);
    }
    function rowFor(p) {
      var cb = h('input', { type: 'checkbox', checked: !!o.selected[p.url] });
      cb.addEventListener('change', function () {
        if (cb.checked) {
          if (Object.keys(o.selected).length >= 15) { cb.checked = false; A.setNotice('Maximum 15 pages. Décochez-en une d’abord.', 'warn'); return; }
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
        p.is_front ? h('span', { class: 'cbo-onb-tag', text: 'Accueil' })
          : (p.relevant ? h('span', { class: 'cbo-onb-tag cbo-onb-tag-rel', text: 'Recommandé' }) : null)
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
      if (o.pagesLoading) { listHost.appendChild(loadingNote('Lecture de vos pages…')); return; }
      if (o.error) { listHost.appendChild(h('p', { class: 'cbo-error', text: o.error })); return; }
      var pages = mergedPages();
      if (!pages.length) { listHost.appendChild(h('p', { class: 'cbo-muted', text: 'Aucune page trouvée.' })); return; }
      pages.forEach(function (p) { listHost.appendChild(rowFor(p)); });
    }
    function addManual(url) {
      url = (url || '').trim();
      if (!url) return;
      if (url.indexOf('//') === -1) url = (CFG.homeUrl || '').replace(/\/+$/, '') + (url.charAt(0) === '/' ? '' : '/') + url;
      if (!sameHost(url)) { A.setNotice('L’URL doit appartenir à votre site (' + (CFG.siteHost || '') + ').', 'warn'); return; }
      if (Object.keys(o.selected).length >= 15) { A.setNotice('Maximum 15 pages.', 'warn'); return; }
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
          else o.error = apiMsg(res, 'Recherche impossible.');
          renderList();
        });
      }, 300);
    });

    card.appendChild(h('div', { class: 'cbo-onb-pickbar' }, search, counter));
    card.appendChild(listHost);

    var manual = h('input', { type: 'url', class: 'regular-text', placeholder: 'https://' + (CFG.siteHost || 'mon-site') + '/page', 'aria-label': 'Ajouter une URL de votre site' });
    manual.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addManual(manual.value); manual.value = ''; } });
    card.appendChild(h('div', { class: 'cbo-onb-manual' },
      h('label', { class: 'cbo-onb-manual-l', text: 'Ajouter une page manuellement (même domaine)' }),
      h('div', { class: 'cbo-onb-manual-row' }, manual,
        h('button', { type: 'button', class: 'button', onClick: function () { addManual(manual.value); manual.value = ''; } }, 'Ajouter'))
    ));

    var role = h('textarea', { rows: 2, class: 'large-text', maxlength: 600,
      placeholder: 'ex. Répondre aux questions des clients sur nos prestations et orienter vers la prise de rendez-vous.' });
    role.value = o.role || '';
    role.addEventListener('input', function () { o.role = role.value; });
    card.appendChild(fieldFor('Quel sera le rôle de votre assistant ? (optionnel)', role));

    var vis = h('select', { 'aria-label': 'Visiteurs par mois' },
      h('option', { value: '', selected: !o.visitors }, 'Je ne sais pas'),
      h('option', { value: '1000', selected: o.visitors === '1000' }, 'Moins de 1 000 / mois'),
      h('option', { value: '5000', selected: o.visitors === '5000' }, '1 000 à 10 000 / mois'),
      h('option', { value: '30000', selected: o.visitors === '30000' }, '10 000 à 50 000 / mois'),
      h('option', { value: '100000', selected: o.visitors === '100000' }, 'Plus de 50 000 / mois')
    );
    vis.addEventListener('change', function () { o.visitors = vis.value; });
    card.appendChild(fieldFor('Combien de visiteurs par mois ? (optionnel)', vis));

    var genBtn = h('button', { class: 'button button-primary button-hero', onClick: function () { submitGenerate(genBtn); } }, 'Générer mon chatbot');
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
        } else { o.error = apiMsg(res, 'Impossible de lister vos pages.'); }
        updateCounter(); renderList();
      });
    } else { renderList(); }
  }

  function submitGenerate(btn) {
    var o = O();
    var urls = Object.keys(o.selected);
    if (!urls.length) { A.setNotice('Sélectionnez au moins une page.', 'warn'); return; }
    if (urls.length > 15) { A.setNotice('Maximum 15 pages.', 'warn'); return; }
    btn.disabled = true;
    var body = { urls: urls };
    if (o.botId) body.bot_id = o.botId;
    if (CFG.siteName) body.name = CFG.siteName;
    if (o.role) body.description = o.role;
    if (o.visitors) body.visitors_per_month = parseInt(o.visitors, 10) || 0;
    call('POST', '/site/generate', body).then(function (res) {
      btn.disabled = false;
      if (!res.ok || !res.data) { A.setNotice(apiMsg(res, 'Génération impossible.'), 'warn'); return; }
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
    card.appendChild(h('h2', { text: 'Personnalisez l’apparence' }));
    card.appendChild(h('p', { class: 'cbo-muted', text:
      'Couleurs, message d’accueil, position… Les changements sont enregistrés automatiquement. Pendant ce temps, votre assistant se construit en arrière-plan.' }));
    var host = h('div', { class: 'cbo-onb-embed' });
    card.appendChild(host);
    card.appendChild(actions(backBtn('pick'),
      h('button', { class: 'button button-primary button-hero', onClick: function () { goTo('waiting'); } }, 'Continuer')));
    mountAppearance(host);
  }

  function mountAppearance(host) {
    var o = O();
    stopEditorSync(); // pas de double écoute si on revient sur cette étape
    clear(host); host.appendChild(loadingNote('Ouverture de l’éditeur d’apparence…'));
    call('POST', '/bots/' + encodeURIComponent(o.botId) + '/embed-token').then(function (res) {
      if (!res.ok || !res.data || !res.data.embed_token) {
        clear(host); host.appendChild(h('p', { class: 'cbo-error', text: apiMsg(res, 'Éditeur d’apparence indisponible.') }));
        return;
      }
      var nonce = randNonce();
      o.editorNonce = nonce;
      var url = (CFG.appBase || '') + '/embed/appearance' + embedFrag(res.data.embed_token, nonce);
      clear(host);
      host.appendChild(h('iframe', { class: 'cbo-onb-iframe', src: url, title: 'Apparence du chatbot', allow: 'clipboard-write' }));
      o.unlisten = listenEmbed(nonce, function () {}); // saved/dirty informatifs
    });
  }

  /* --------------------------------------------------------- 6. waiting */

  function renderWaiting(card) {
    var o = O();
    if (!o.botId) { defer(function () { goTo('choose'); }); return; }
    card.appendChild(h('h2', { text: 'Votre assistant se construit…' }));
    var bar = h('div', { class: 'cbo-onb-bar' });
    var fill = h('div', { class: 'cbo-onb-bar-fill', style: 'width:6%' });
    bar.appendChild(fill);
    var stage = h('p', { class: 'cbo-muted', role: 'status', 'aria-live': 'polite', text: 'Initialisation…' });
    card.appendChild(bar);
    card.appendChild(stage);
    card.appendChild(h('p', { class: 'cbo-muted', text: 'Cela prend généralement moins d’une minute.' }));
    var act = h('div', { class: 'cbo-onb-actions' });
    card.appendChild(act);

    if (!o.jobId) { defer(function () { goTo('tree'); }); return; } // chemin vierge / repris
    pollJob(o, stage, fill, act);
  }

  function stageLabel(stage) {
    var M = {
      queued: 'En file d’attente…', fetch: 'Lecture de vos pages…', scrape: 'Lecture de vos pages…',
      analyze: 'Analyse du contenu…', plan: 'Conception de l’arbre…', generate: 'Rédaction des réponses…',
      build: 'Assemblage…', finalize: 'Finalisation…'
    };
    return M[stage] || 'Construction en cours…';
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
        if (st === 'error' || st === 'failed') { jobError(act, d.error || 'La génération a échoué.'); return; }
        if (tries < MAX) setTimeout(loop, 2500);
        else jobError(act, 'La génération prend plus de temps que prévu. Réessayez dans un instant.');
      });
    })();
  }
  function jobError(act, msg) {
    clear(act);
    act.appendChild(h('p', { class: 'cbo-error', text: msg }));
    act.appendChild(h('button', { class: 'button', onClick: function () { goTo('pick'); } }, 'Revenir aux pages'));
  }

  /* ------------------------------------------------------------ 7. tree */

  function renderTree(card) {
    var o = O();
    if (!o.botId) { defer(function () { goTo('choose'); }); return; }
    card.appendChild(h('h2', { text: 'Votre arbre de conversation' }));
    card.appendChild(h('p', { class: 'cbo-muted', text:
      'Voici la structure générée. Ouvrez l’éditeur pour ajuster questions et réponses ; vos modifications se synchronisent ici automatiquement.' }));
    var treeHost = h('div', { class: 'cbo-onb-tree' });
    card.appendChild(treeHost);
    card.appendChild(actions(
      backBtn('waiting'),
      h('button', { class: 'button button-primary', onClick: function (e) { openEditor(e.currentTarget, treeHost); } }, 'Ouvrir l’éditeur'),
      h('button', { class: 'button button-primary button-hero', onClick: function () { if (o.editorWin && !o.editorWin.closed) postToEditor('request-save'); goTo('preview'); } }, 'Continuer')
    ));
    loadBotTree(treeHost);
  }

  function loadBotTree(treeHost) {
    var o = O();
    clear(treeHost); treeHost.appendChild(loadingNote('Chargement de l’arbre…'));
    call('GET', '/bots/' + encodeURIComponent(o.botId)).then(function (res) {
      if (!res.ok || !res.data) { clear(treeHost); treeHost.appendChild(h('p', { class: 'cbo-error', text: apiMsg(res, 'Impossible de charger l’arbre.') })); return; }
      o.bot = res.data;
      o.tree = res.data.tree_json || o.tree;
      o.updatedAt = res.data.updated_at || o.updatedAt;
      o.quickReplies = deriveQuickReplies(o.tree);
      renderTreeView(treeHost);
    });
  }
  function renderTreeView(treeHost) {
    var o = O();
    clear(treeHost);
    var nodes = treeNodes(o.tree);
    if (!nodes.length) { treeHost.appendChild(h('p', { class: 'cbo-muted', text: 'Arbre encore vide — ouvrez l’éditeur pour le compléter.' })); return; }
    treeHost.appendChild(h('p', { class: 'cbo-onb-treecount', text: nodes.length + ' étape' + (nodes.length > 1 ? 's' : '') + ' de conversation' }));
    var qr = o.quickReplies || [];
    if (qr.length) {
      var chips = h('div', { class: 'cbo-onb-chips' });
      qr.forEach(function (t) { chips.appendChild(h('span', { class: 'cbo-onb-chip', text: t })); });
      treeHost.appendChild(h('div', { class: 'cbo-onb-block' },
        h('span', { class: 'cbo-onb-block-l', text: 'Premières propositions au visiteur' }), chips));
    }
    var list = h('ul', { class: 'cbo-onb-nodes' });
    nodes.slice(0, 40).forEach(function (n) { list.appendChild(h('li', null, h('span', { text: nodeLabel(n) }))); });
    treeHost.appendChild(list);
  }

  function openEditor(btn, treeHost) {
    var o = O();
    if (btn) btn.disabled = true;
    call('POST', '/bots/' + encodeURIComponent(o.botId) + '/embed-token').then(function (res) {
      if (btn) btn.disabled = false;
      if (!res.ok || !res.data || !res.data.embed_token) { A.setNotice(apiMsg(res, 'Éditeur indisponible.'), 'warn'); return; }
      var nonce = randNonce();
      o.editorNonce = nonce;
      var url = (CFG.appBase || '') + '/embed/tree-editor' + embedFrag(res.data.embed_token, nonce, o.jobId);
      var win = window.open(url, 'chapote_editor', 'width=1200,height=820');
      if (!win) { A.setNotice('Autorisez les fenêtres pop-up pour ouvrir l’éditeur.', 'warn'); return; }
      o.editorWin = win;
      startEditorSync(nonce, win, treeHost);
    });
  }

  // Synchronisation éditeur : postMessage (saved/error) + POLLING updated_at tant
  // que la fenêtre est ouverte (SSE via proxy non fiable). À la fermeture : ultime
  // rechargement, puis arrêt.
  function startEditorSync(nonce, win, treeHost) {
    var o = O();
    stopEditorSync();
    o.unlisten = listenEmbed(nonce, function (msg) {
      if (msg.type === 'saved') { A.setNotice('Modifications enregistrées.', 'ok'); loadBotTree(treeHost); }
      else if (msg.type === 'error') { A.setNotice('Une erreur est survenue dans l’éditeur.', 'warn'); }
    });
    o.syncTimer = setInterval(function () {
      var cur = O();
      if (!cur || cur.editorWin !== win) { clearInterval(o.syncTimer); return; }
      if (!win || win.closed) { stopEditorSync(); cur.editorWin = null; loadBotTree(treeHost); return; }
      call('GET', '/bots/' + encodeURIComponent(cur.botId)).then(function (res) {
        if (res.ok && res.data && res.data.updated_at && res.data.updated_at !== cur.updatedAt) {
          cur.updatedAt = res.data.updated_at;
          cur.bot = res.data; cur.tree = res.data.tree_json || cur.tree;
          cur.quickReplies = deriveQuickReplies(cur.tree);
          if (O() === cur && cur.step === 'tree') renderTreeView(treeHost);
        }
      });
    }, 4000);
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
    card.appendChild(h('h2', { text: 'Aperçu de votre chatbot' }));
    card.appendChild(h('p', { class: 'cbo-muted', text: 'Testez votre assistant comme le verront vos visiteurs. Cet aperçu est privé.' }));
    var host = h('div', { class: 'cbo-onb-preview' });
    card.appendChild(host);
    card.appendChild(actions(backBtn('tree'),
      h('button', { class: 'button button-primary button-hero', onClick: function () { goTo('offer'); } }, 'Voir mon offre')));
    clear(host); host.appendChild(loadingNote('Préparation de l’aperçu…'));
    call('POST', '/bots/' + encodeURIComponent(o.botId) + '/preview-token').then(function (res) {
      if (!res.ok || !res.data || !res.data.preview_token) { clear(host); host.appendChild(h('p', { class: 'cbo-error', text: apiMsg(res, 'Aperçu indisponible.') })); return; }
      var url = (CFG.apiBase || '') + '/widget-frame?preview_token=' + encodeURIComponent(res.data.preview_token);
      clear(host);
      host.appendChild(h('iframe', { class: 'cbo-onb-widgetframe', src: url, title: 'Aperçu du chatbot',
        sandbox: 'allow-scripts allow-forms allow-same-origin allow-popups' }));
    });
  }

  /* ----------------------------------------------------------- 9. offer */

  function renderOffer(card) {
    var o = O();
    if (!o.botId) { defer(function () { goTo('choose'); }); return; }
    card.appendChild(h('h2', { text: 'Votre offre recommandée' }));
    var pane = h('div', { class: 'cbo-onb-offer' });
    card.appendChild(pane);
    pane.appendChild(loadingNote('Calcul de la meilleure offre…'));
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
        pane.appendChild(h('p', { class: 'cbo-error', text: 'Catalogue indisponible — réessayez dans un instant.' }));
        pane.appendChild(actions(backBtn('preview')));
        return;
      }
      buildOffer(pane, bot, live, rec);
    });
  }
  function recoBody(o) {
    var b = {};
    if (o.role) b.description = o.role;
    if (o.visitors) b.visitors_per_month = parseInt(o.visitors, 10) || 0;
    if (o.tree) b.tree_json = o.tree;
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
      h('strong', { text: 'D’après votre arbre et vos réponses, voici l’offre conseillée.' }));
    if (rec && rec.reason) banner.appendChild(h('p', { class: 'cbo-muted', text: rec.reason }));
    if (rec && rec.expected_replies) banner.appendChild(h('p', { class: 'cbo-muted',
      text: 'Volume estimé : environ ' + Number(rec.expected_replies).toLocaleString('fr-FR') + ' réponses / mois.' }));

    A.buildPaymentForm(pane, sBot, catalog, {
      banner: banner,
      required: (rec && Array.isArray(rec.required_modules)) ? rec.required_modules : [],
      submitLabel: 'Souscrire et activer',
      onSubscribe: function (config, consent, btn) { offerSubscribe(config, consent, btn); },
      secondary: { label: 'Activer en version gratuite', onClick: function (btn) { freeActivate(btn); } }
    });
    pane.appendChild(h('div', { class: 'cbo-onb-actions cbo-onb-actions-back' }, backBtn('preview')));
  }

  function offerSubscribe(config, consent, btn) {
    var o = O();
    if (!consent) { A.setNotice('Cochez le consentement à l’exécution immédiate pour souscrire.', 'warn'); return; }
    if (btn) btn.disabled = true;
    pruneIfNeeded(config.modules).then(function () {
      persist({ step: 'activation', bot_id: o.botId });
      // doCheckout cible CBOAdmin.state.botId : on l'aligne sur le bot d'onboarding.
      A.state.botId = o.botId;
      A.doCheckout(btn || document.createElement('button'), config, true); // redirige vers Stripe
    });
  }
  // Élague l'arbre aux modules conservés si un module REQUIS a été retiré.
  function pruneIfNeeded(keptModules) {
    var o = O();
    var rec = o.recommendation;
    if (!rec || !Array.isArray(rec.required_modules)) return Promise.resolve();
    var kept = {}; (keptModules || []).forEach(function (k) { kept[k] = 1; });
    var dropped = rec.required_modules.filter(function (k) { return !kept[k]; });
    if (!dropped.length) return Promise.resolve();
    return call('POST', '/bots/' + encodeURIComponent(o.botId) + '/tree-prune', { kept_modules: keptModules || [] });
  }
  function freeActivate(btn) {
    if (btn) btn.disabled = true;
    var o = O();
    o.stripe = '';
    persist({ step: 'activation', bot_id: o.botId });
    goTo('activation');
  }

  /* ------------------------------------------------------ 10. activation */

  function renderActivation(card) {
    var o = O();
    if (!o.botId) { defer(function () { goTo('choose'); }); return; }
    card.appendChild(h('h2', { text: 'Activation sur votre site' }));
    var status = h('p', { class: 'cbo-muted', role: 'status', 'aria-live': 'polite' });
    var body = h('div', { class: 'cbo-onb-activate' });
    card.appendChild(status);
    card.appendChild(body);

    if (o.done) { renderDone(status, body); return; }
    if (o.error) {
      body.appendChild(h('p', { class: 'cbo-error', text: o.error }));
      body.appendChild(h('button', { class: 'button button-primary', onClick: function () { o.error = ''; o.activating = false; kickoffActivation(status, body); } }, 'Réessayer'));
      return;
    }
    if (o.stripe === 'cancel' && !o.activating) {
      status.textContent = 'Paiement annulé.';
      body.appendChild(h('p', { class: 'cbo-muted', text: 'Vous pouvez revoir l’offre ou activer la version gratuite.' }));
      body.appendChild(actions(
        h('button', { class: 'button', onClick: function () { o.stripe = ''; goTo('offer'); } }, 'Revoir l’offre'),
        h('button', { class: 'button button-primary', onClick: function () { o.stripe = ''; kickoffActivation(status, body); } }, 'Activer en version gratuite')
      ));
      return;
    }
    status.textContent = 'Mise en ligne de votre assistant…';
    if (!o.activating) kickoffActivation(status, body);
  }

  function kickoffActivation(status, body) {
    var o = O();
    o.activating = true;
    if (o.stripe === 'success') {
      status.textContent = 'Paiement reçu. Vérification de l’abonnement…';
      waitBillingThenEnable(status, body);
    } else {
      enableWidget(status, body);
    }
  }
  // Borné comme pollBillingActive du back-office (12 essais / 3 s) ; à l'échéance
  // on active quand même (le widget sert tous les bots servables, même gratuits).
  function waitBillingThenEnable(status, body) {
    var o = O(); var tries = 0, MAX = 12;
    (function loop() {
      if (O() !== o || o.step !== 'activation') return;
      tries++;
      call('GET', '/bots/' + encodeURIComponent(o.botId)).then(function (res) {
        var bs = (res.ok && res.data) ? res.data.billing_status : '';
        if (bs === 'active' || bs === 'trialing') { enableWidget(status, body); return; }
        if (tries < MAX) { setTimeout(loop, 3000); return; }
        status.textContent = 'Abonnement en cours de validation — on active déjà votre widget.';
        enableWidget(status, body);
      });
    })();
  }
  function enableWidget(status, body) {
    var o = O();
    if (status) status.textContent = 'Activation du widget sur votre site…';
    call('POST', '/bots/' + encodeURIComponent(o.botId) + '/local', { enabled: true, targeting: defaultTargeting() }).then(function (res) {
      var cur = O(); if (!cur) return;
      if (!res.ok) {
        cur.activating = false; cur.error = apiMsg(res, 'Activation impossible. Réessayez.');
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
      h('h3', { text: 'Votre chatbot est en ligne !' }),
      h('p', { class: 'cbo-muted', text: 'Il répond désormais à vos visiteurs. Vous pouvez tout ajuster depuis « Mes bots ».' }),
      actions(
        h('button', { class: 'button button-primary button-hero', onClick: function () { A.exitOnboarding('Bienvenue dans votre tableau de bord Chapote.', 'ok'); } }, 'Aller au tableau de bord'),
        CFG.homeUrl ? h('a', { class: 'button', href: CFG.homeUrl, target: '_blank', rel: 'noopener' }, 'Voir mon site') : null
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
      var a = new Uint8Array(16); (window.crypto || window.msCrypto).getRandomValues(a);
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
  function nodeLabel(n) {
    if (!n) return 'Étape';
    return String(n.title || n.label || n.name || n.prompt || n.message || n.text || n.id || 'Étape');
  }

  /* --------------------------------------------------------- expose */

  window.CBOOnboarding = { init: init, view: view, afterConnect: afterConnect };
})();
