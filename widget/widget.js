/**
 * Chapote, widget embarquable.
 *
 * Usage flottant :
 *   <script src="https://api.exemple.com/widget.js" data-bot-key="pk_xxx" defer></script>
 * Usage iframe (via /widget-frame) :
 *   <script src=".../widget.js" data-bot-key="pk_xxx" data-inline="true" defer></script>
 *
 * Vanilla JS, zéro dépendance. La clé data-bot-key est PUBLIQUE : elle ne
 * permet que d'initialiser une session (vérifiée côté serveur : domaine
 * whitelisté + captcha + rate limits). Aucune clé IA ne transite ici.
 */
(function () {
  "use strict";

  let script = document.currentScript;
  if (!script) {
    const scripts = document.querySelectorAll("script[data-bot-key]");
    script = scripts[scripts.length - 1];
  }
  if (!script) return;
  const BOT_KEY = script.getAttribute("data-bot-key");
  if (!BOT_KEY) return;
  // Anti double-initialisation : un seul widget par clé même si le script est inclus deux fois
  window.__chapoteChat = window.__chapoteChat || {};
  if (window.__chapoteChat[BOT_KEY]) return;
  window.__chapoteChat[BOT_KEY] = true;
  const INLINE = script.getAttribute("data-inline") === "true";
  // Aperçu (onboarding plugin) : jeton signé reflété par /widget-frame en
  // data-preview-token. Joint à bootstrap ET session (query) pour bypasser
  // origine+captcha ; le JWT de session renvoyé est marqué preview (side-effects
  // neutralisés en aval), donc les appels suivants n'ont rien à porter.
  const PREVIEW_TOKEN = script.getAttribute("data-preview-token") || "";
  // Re-skin à chaud (éditeur d'apparence embarqué) : origine + nonce autorisés à
  // pousser un nouveau design via postMessage. Vides -> fonctionnalité inactive
  // (widget public / aperçu normal inchangés).
  const RESKIN_ORIGIN = script.getAttribute("data-reskin-origin") || "";
  const RESKIN_NONCE = script.getAttribute("data-reskin-nonce") || "";
  // Aperçu d'apparence flottant : ouvrir le panneau automatiquement après build
  // (montre le rendu complet — en-tête, fil, lanceur — sans clic du visiteur).
  const PREVIEW_OPEN = script.getAttribute("data-preview-open") === "1";
  const API = script.src.replace(/\/widget\.js.*$/, "");

  // Garde-fous anti-injection : le design_json vient du serveur mais le widget
  // se défend seul, seules des valeurs sûres entrent dans la feuille de style.
  function safeColor(c, fallback) { return /^#[0-9a-fA-F]{3,8}$/.test(c || "") ? c : fallback; }
  function safeInt(n, min, max, fallback) { n = parseInt(n, 10); return isNaN(n) ? fallback : Math.min(max, Math.max(min, n)); }
  // Chaîne sûre bornée : non-string -> '' ; toujours rognée à max (anti-débordement UI/XSS).
  function safeStr(s, max) { return typeof s === "string" ? s.slice(0, max) : ""; }
  // Hex (#rgb / #rrggbb / #rrggbbaa) -> "r,g,b" pour composer une rgba() de teinte.
  // Entrée non valide -> null. La couleur a déjà été validée par safeColor en amont.
  function hexToRgb(hex) {
    let h = (hex || "").replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length < 6) return null;
    const n = parseInt(h.slice(0, 6), 16);
    if (isNaN(n)) return null;
    return ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255);
  }
  // Whitelist d'énumération : valeur hors liste -> défaut (jamais injectée en className brute).
  function safeEnum(v, allowed, fallback) { return allowed.indexOf(v) !== -1 ? v : fallback; }

  // Apparence imposée par la PAGE hôte (facultatif, cosmétique seulement) : un site
  // qui propose plusieurs couleurs ou un mode sombre transmet son choix courant.
  //   data-color="#C93F17"       couleur de marque (bulle, en-tête, bouton d'envoi…)
  //   data-color-text="#ffffff"  texte posé sur cette couleur (contraste)
  //   data-theme="light|dark"    surfaces claires ou sombres
  //   data-open="true"           ouvre le panneau dès qu'il est prêt (chargement au clic)
  // Absents -> design du serveur, rendu strictement inchangé. Valeurs validées
  // (hex / liste fermée) : rien d'autre n'entre dans la feuille de style. Les
  // surfaces (classiques ou neutres) restent un choix du design : surfaceTone.
  const pageLook = {
    color: safeColor(script.getAttribute("data-color"), ""),
    colorText: safeColor(script.getAttribute("data-color-text"), ""),
    theme: safeEnum(script.getAttribute("data-theme"), ["light", "dark"], ""),
  };
  const OPEN_ON_LOAD = script.getAttribute("data-open") === "true";
  // data-url-mode="path" : n'envoie que l'origine + le chemin de la page (jamais les
  // paramètres ni le fragment, qui peuvent porter des identifiants ou des codes de
  // connexion). Absent : adresse complète (comportement historique).
  const PATH_ONLY = script.getAttribute("data-url-mode") === "path";
  function stripUrl(u) {
    if (!PATH_ONLY || !u) return u;
    try { const x = new URL(u); return x.origin + x.pathname; } catch (e) { return ""; }
  }
  function withPageLook(d) {
    if (!pageLook.color && !pageLook.colorText && !pageLook.theme) return d;
    const o = Object.assign({}, d);
    if (pageLook.color) { o.primaryColor = pageLook.color; o.accentColor = pageLook.color; o.secondaryColor = null; }
    if (pageLook.colorText) o.onPrimary = pageLook.colorText;
    if (pageLook.theme) o.darkMode = pageLook.theme === "dark";
    return o;
  }

  function pageUrl() {
    return stripUrl(INLINE ? (document.referrer || location.href) : location.href);
  }

  function visitorId() {
    try {
      let id = localStorage.getItem("kc_vid");
      if (!id) {
        id = "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
        localStorage.setItem("kc_vid", id);
      }
      return id;
    } catch (e) {
      return "v" + Math.random().toString(36).slice(2, 14);
    }
  }

  // --- Parcours visiteur (contexte IA, pas de l'analytics) ---
  // À chaque chargement de page on mémorise le pathname (JAMAIS la query
  // string ni le hash : vie privée) dans sessionStorage, dédupliqué si la
  // page n'a pas changé, plafonné aux 10 plus récents. Envoyé une seule fois,
  // au handshake de session, pour aider l'IA à contextualiser ses réponses.
  // Cas iframe (data-inline) : on ne voit pas le sessionStorage de la page
  // parente, la page parente n'est connue que via document.referrer (même
  // mécanisme que parent_url), et le parcours s'accumule dans le
  // sessionStorage de la frame (même onglet). Referrer absent/illisible
  // (Referrer-Policy stricte) → on n'enregistre rien : journey restera null.
  function currentPath() {
    if (!INLINE) return location.pathname || "/";
    if (!document.referrer) return null;
    try { return new URL(document.referrer).pathname || "/"; } catch (e) { return null; }
  }

  function recordJourney() {
    const path = currentPath();
    if (!path) return;
    try {
      let list = JSON.parse(sessionStorage.getItem("kc_journey") || "[]");
      if (!Array.isArray(list)) list = [];
      const last = list[list.length - 1];
      if (last && last.p === path) return;
      list.push({ p: path, t: Math.floor(Date.now() / 1000) });
      if (list.length > 10) list = list.slice(-10);
      sessionStorage.setItem("kc_journey", JSON.stringify(list));
    } catch (e) { /* sessionStorage indisponible (navigation privée…) */ }
  }

  function getJourney() {
    try {
      const list = JSON.parse(sessionStorage.getItem("kc_journey") || "null");
      return Array.isArray(list) && list.length ? list : null;
    } catch (e) {
      return null;
    }
  }

  // chatStatus : statut SERVEUR autoritaire du live chat (ai | human_requested
  // | human), aiMode est un sous-état du mode ai. La session (token + fil) est
  // PERSISTÉE en localStorage (cf. SESS_KEY) : un reload / une navigation
  // restaure la conversation, rouvrable pendant 2 h après la dernière activité.
  const state = { config: null, token: null, open: false, busy: false, aiMode: false,
    chatStatus: "ai", lastMsgId: 0, pollTimer: null,
    // Triggers proactifs : interacted = le visiteur a déjà touché au widget
    // (plus aucun tir possible) ; pendingTriggerMsg = bulle locale à afficher
    // après l'accueil de la session ouverte par un trigger.
    interacted: false, pendingTriggerMsg: null,
    // Persistance : history = fil mémorisé [{r,t,g}] ; restored/restoredOpen =
    // une session valide a été retrouvée au chargement (à ré-afficher).
    history: [], restored: false, restoredOpen: false };

  // --- Persistance de session (localStorage, fenêtre 2 h) -------------------
  // On mémorise le token de session + l'historique du fil pour que la
  // conversation SURVIVE à un reload / une navigation et reste rouvrable
  // pendant 2 h après la dernière activité (au-delà : on repart de zéro =
  // « cooldown »). Le token est un JWT bas-privilège (30 min, une seule
  // conversation, session glissante), stockage local accepté, comme kc_vid.
  const SESS_KEY = "kc_sess_" + BOT_KEY;
  const SESS_TTL = 2 * 60 * 60 * 1000; // 2 h
  function persistSession() {
    if (PREVIEW_TOKEN) return; // aperçu : éphémère, jamais persisté (reset propre à chaque (re)chargement)
    if (!state.token) return; // rien à mémoriser sans session serveur
    try {
      localStorage.setItem(SESS_KEY, JSON.stringify({
        token: state.token, status: state.chatStatus, lastMsgId: state.lastMsgId,
        aiMode: state.aiMode, open: state.open, ts: Date.now(),
        msgs: (state.history || []).slice(-50), // borne anti-quota
      }));
    } catch (e) { /* quota / navigation privée : abandon silencieux */ }
  }
  function clearSession() {
    state.history = [];
    try { localStorage.removeItem(SESS_KEY); } catch (e) { /* ignore */ }
  }
  function loadSession() {
    try {
      const raw = localStorage.getItem(SESS_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      // Token absent ou fenêtre 2 h dépassée -> on oublie (cooldown écoulé).
      if (!s || !s.token || !s.ts || (Date.now() - s.ts) > SESS_TTL) { clearSession(); return; }
      state.token = s.token;
      state.chatStatus = s.status || "ai";
      state.aiMode = !!s.aiMode;
      state.lastMsgId = s.lastMsgId || 0;
      state.history = Array.isArray(s.msgs) ? s.msgs.slice() : [];
      state.restored = true;
      state.restoredOpen = !!s.open;
    } catch (e) { clearSession(); }
  }

  function isHuman() {
    return state.chatStatus === "human" || state.chatStatus === "human_requested";
  }

  // --- HTTP ---
  function api(path, opts) {
    opts = opts || {};
    const headers = { "Content-Type": "application/json" };
    if (opts.auth && state.token) headers["Authorization"] = "Bearer " + state.token;
    return fetch(API + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (d) {
        const err = new Error(d.detail || "HTTP " + r.status);
        err.status = r.status;
        throw err;
      });
      return r.json();
    });
  }

  // Rotation du JWT widget : le serveur renvoie parfois un refresh_token
  // (session glissante). On l'adopte et on le retire de la réponse pour ne pas
  // le propager aux consommateurs.
  function applyTokenRotation(resp) {
    if (resp && resp.refresh_token) { state.token = resp.refresh_token; delete resp.refresh_token; persistSession(); }
    return resp;
  }

  // Retry-401 commun : sur un 401 non encore réessayé, on rejoue un handshake
  // de session propre puis on relance la requête (flag retried -> une seule
  // fois). Le poll et le feedback n'utilisent PAS ce helper (cf. leurs
  // commentaires : un re-handshake y créerait une nouvelle conversation).
  function retryAfterSession(err, retried, replay) {
    if (err.status === 401 && !retried) {
      return openSession().then(function () { return replay(); });
    }
    throw err;
  }

  // --- Captcha (au handshake uniquement, invisible) ---
  // Pas de SRI : Turnstile/reCAPTCHA sont des scripts mutables mis à jour par
  // Cloudflare/Google (leurs docs officielles chargent sans integrity).
  const loadedScripts = {}; // src -> Promise, évite la double injection au re-handshake
  function loadScript(src) {
    if (loadedScripts[src]) return loadedScripts[src];
    loadedScripts[src] = new Promise(function (resolve, reject) {
      const s = document.createElement("script");
      s.src = src; s.async = true;
      s.onload = resolve;
      s.onerror = function (e) { delete loadedScripts[src]; reject(e); };
      document.head.appendChild(s);
    });
    return loadedScripts[src];
  }

  function getCaptchaToken() {
    const cfg = state.config.captcha || {};
    if (cfg.provider === "disabled" || !cfg.site_key) return Promise.resolve(null);
    if (cfg.provider === "turnstile") {
      return loadScript("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit")
        .then(function () {
          return new Promise(function (resolve) {
            const holder = document.createElement("div");
            holder.style.cssText = "position:fixed;bottom:-9999px;";
            document.body.appendChild(holder);
            window.turnstile.render(holder, {
              sitekey: cfg.site_key,
              callback: function (token) { resolve(token); holder.remove(); },
              "error-callback": function () { resolve(null); holder.remove(); },
            });
          });
        }).catch(function () { return null; });
    }
    if (cfg.provider === "recaptcha_v3") {
      return loadScript("https://www.google.com/recaptcha/api.js?render=" + cfg.site_key)
        .then(function () {
          return new Promise(function (resolve) {
            window.grecaptcha.ready(function () {
              window.grecaptcha.execute(cfg.site_key, { action: "chat_session" })
                .then(resolve, function () { resolve(null); });
            });
          });
        }).catch(function () { return null; });
    }
    return Promise.resolve(null);
  }

  // --- Session ---
  function openSession() {
    return getCaptchaToken().then(function (token) {
      return api("/api/widget/session" + (PREVIEW_TOKEN ? "?preview_token=" + encodeURIComponent(PREVIEW_TOKEN) : ""), {
        method: "POST",
        body: {
          public_key: BOT_KEY,
          visitor_id: visitorId(),
          page_url: pageUrl(),
          parent_url: INLINE ? stripUrl(document.referrer) : null,
          captcha_token: token,
          journey: getJourney(),
        },
      });
    }).then(function (data) {
      state.token = data.token;
      persistSession();
      return data.first;
    });
  }

  // --- Icônes (SVG du design) ---
  const SVG = {
    chat: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3C7 3 3 6.6 3 11c0 2.2 1 4.2 2.7 5.6-.1 1-.5 2.1-1.4 3 1.7-.1 3.1-.7 4.1-1.4 1.1.4 2.3.7 3.6.7 5 0 9-3.6 9-7.9S17 3 12 3z"></path></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"></path><circle cx="19" cy="5" r="1.6"></circle></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9.2"></circle><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.9c-.8.35-1 .9-1 1.7"></path><circle cx="12" cy="16.8" r="1.15" fill="currentColor" stroke="none"></circle></svg>',
    // Icônes étendues (refonte Apparence) : mêmes tracés que ui.tsx BubbleIcon (parité de rendu).
    bot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"></path><rect width="16" height="12" x="4" y="8" rx="2"></rect><path d="M2 14h2M20 14h2M15 13v2M9 13v2"></path></svg>',
    message: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>',
    headset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14v-2a8 8 0 0 1 16 0v2"></path><rect x="2.5" y="13" width="4" height="7" rx="1.6"></rect><rect x="17.5" y="13" width="4" height="7" rx="1.6"></rect></svg>',
    smile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"></circle><path d="M8.5 14.5s1.3 1.8 3.5 1.8 3.5-1.8 3.5-1.8"></path><path d="M9 9.5h.01M15 9.5h.01"></path></svg>',
    zap: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"></path></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>',
    send: '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.6 21.8 12 3.4 3.4l.01 6.6L15 12 3.41 14z"></path></svg>',
    alert: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg>',
    sparkSmall: '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-1px"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"></path></svg>',
    userSmall: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>',
    thumbUp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"></path><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"></path></svg>',
    thumbDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V2"></path><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"></path></svg>',
  };

  // Construit l'icône via le DOM : avatarImage (configurable côté dashboard)
  // est posé en PROPRIÉTÉ img.src, jamais interpolé dans du HTML (anti-XSS).
  // Les SVG sont des constantes statiques du script.
  function iconNode(d, size) {
    if (d.icon === "image" && d.avatarImage) {
      const img = document.createElement("img");
      img.src = String(d.avatarImage);
      img.alt = "";
      img.style.cssText = "width:" + size + "px;height:" + size + "px;border-radius:35%;object-fit:cover;display:block";
      return img;
    }
    const span = document.createElement("span");
    span.style.cssText = "width:" + size + "px;height:" + size + "px;display:block";
    span.innerHTML = SVG[d.icon] || SVG.chat;
    return span;
  }

  function setIcon(container, d, size) {
    container.textContent = "";
    container.appendChild(iconNode(d, size));
  }

  // Taille de l'icône de bulle (lanceur flottant) : avatar image plus grand
  // (.58) que l'icône SVG (.44), proportionnelle à la taille de bulle.
  function bubbleIconSize(d) {
    const bubble = SIZES[d.size] || 58;
    return Math.round(bubble * (d.icon === "image" && d.avatarImage ? .58 : .44));
  }

  // --- UI ---
  const ui = {};
  const SIZES = { sm: 48, md: 58, lg: 68 };

  // Polices SANS chargement externe (perf/RGPD) : stacks système uniquement.
  const FONTS = {
    system: "'Public Sans',-apple-system,sans-serif",
    serif: "Georgia,'Times New Roman',serif",
    mono: "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
  };

  // --- Localisation de l'UI (design.locale : auto | fr | en, défaut fr) ---
  // Les valeurs FR reprennent les chaînes historiques À L'OCTET PRÈS (les
  // tests e2e tournent en défaut fr). Seuls les textes d'INTERFACE sont
  // traduits : les badges (.kc-mode TREE/IA/LIVE, "1", "×"), le contenu
  // d'arbre, les messages serveur (accueil, dégradé, handoff, confirmation
  // lead côté API) et les messages de triggers restent tels quels.
  const I18N = {
    fr: {
      online_tree: "En ligne · Menu guidé",
      online_ai: "En ligne · Mode IA",
      online: "En ligne",
      advisor_online: "Conseiller en ligne",
      advisor_wait: "En attente d'un conseiller…",
      advisor_joined: "Un conseiller a rejoint le chat.",
      reset_chat: "Réinitialiser la conversation",
      close: "Fermer",
      send: "Envoyer",
      open_chat: "Ouvrir le chat",
      placeholder: "Écrivez votre message…",
      placeholder_advisor: "Écrivez au conseiller…",
      placeholder_pick: "Choisissez une option ci-dessus",
      powered_by: "Propulsé par",
      tag_ai: " IA",
      tag_advisor: " Conseiller",
      appointment: "Prendre rendez-vous",
      appointment_title: "Prise de rendez-vous",
      open_new_tab: "Ouvrir dans un nouvel onglet",
      back_to_menu: "↩ Revenir au menu",
      back_to_menu_user: "Revenir au menu",
      lead_email: "Email",
      lead_name: "Nom",
      lead_phone: "Téléphone",
      lead_message: "Message",
      lead_invalid_email: "Merci d'indiquer un email valide.",
      lead_sent: "Merci ! Votre demande a bien été transmise.",
      lead_too_many: "Trop de demandes envoyées, réessayez plus tard.",
      error_generic: "Oups, une erreur est survenue. Réessayez.",
      error_short: "Oups, une erreur est survenue.",
      error_too_fast: "Vous envoyez des messages trop vite, patientez un instant.",
      ai_unavailable: "Les réponses IA sont indisponibles pour le moment. Utilisez le menu ou le formulaire de contact.",
      ai_intro: "Je vous écoute ! Posez votre question librement, je réponds grâce à l'IA.",
      ai_intro_short: "Je vous écoute ! Posez votre question librement.",
      chat_unavailable: "Le chat est momentanément indisponible.",
      rate_up: "Réponse utile",
      rate_down: "Réponse peu utile",
      dialog_label: "Assistant de discussion",
      input_label: "Saisir un message",
    },
    en: {
      online_tree: "Online · Guided menu",
      online_ai: "Online · AI mode",
      online: "Online",
      advisor_online: "Advisor online",
      advisor_wait: "Waiting for an advisor…",
      advisor_joined: "An advisor has joined the chat.",
      reset_chat: "Reset conversation",
      close: "Close",
      send: "Send",
      open_chat: "Open chat",
      placeholder: "Type your message…",
      placeholder_advisor: "Write to the advisor…",
      placeholder_pick: "Pick an option above",
      powered_by: "Powered by",
      tag_ai: " AI",
      tag_advisor: " Advisor",
      appointment: "Book an appointment",
      appointment_title: "Appointment booking",
      open_new_tab: "Open in a new tab",
      back_to_menu: "↩ Back to menu",
      back_to_menu_user: "Back to menu",
      lead_email: "Email",
      lead_name: "Name",
      lead_phone: "Phone",
      lead_message: "Message",
      lead_invalid_email: "Please enter a valid email address.",
      lead_sent: "Thank you! Your request has been sent.",
      lead_too_many: "Too many requests sent, please try again later.",
      error_generic: "Oops, something went wrong. Please try again.",
      error_short: "Oops, something went wrong.",
      error_too_fast: "You are sending messages too fast, please wait a moment.",
      ai_unavailable: "AI answers are unavailable right now. Please use the menu or the contact form.",
      ai_intro: "I'm listening! Ask your question freely, I answer with AI.",
      ai_intro_short: "I'm listening! Ask your question freely.",
      chat_unavailable: "The chat is temporarily unavailable.",
      rate_up: "Helpful",
      rate_down: "Not helpful",
      dialog_label: "Chat assistant",
      input_label: "Type a message",
    },
  };
  let LOCALE = "fr"; // résolu au bootstrap (avant build) depuis design.locale
  function t(key) {
    return (I18N[LOCALE] && I18N[LOCALE][key]) || I18N.fr[key] || "";
  }

  // Surfaces du panneau. light / dark = valeurs historiques (inchangées) ;
  // neutral = sombre neutre (surfaceTone "neutral"), pour les sites aux tons chauds.
  const SURFACES = {
    light: { panel: "#fff", msgs: "#fafbfb", bot: "#fff", botBorder: "#e6eae8", text: "#1d2b27",
      line: "#e9edec", input: "#fff", inputBorder: "#dde3e1", muted: "#5f7873", powered: "#6b7a76" },
    dark: { panel: "#101816", msgs: "#0c1311", bot: "#1b2624", botBorder: "#233330", text: "#e8efed",
      line: "#233330", input: "#18221f", inputBorder: "#233330", muted: "#9fb0ab", powered: "#8a9893" },
    neutral: { panel: "#161514", msgs: "#0f0e0d", bot: "#211f1d", botBorder: "#302d2a", text: "#f2efec",
      line: "#302d2a", input: "#1c1a18", inputBorder: "#3a3632", muted: "#b8b0a8", powered: "#b8b0a8" },
  };

  // Décalage vertical en plus, posé par la page hôte en CSS (--chapote-widget-lift),
  // ex. au-dessus d'une barre d'onglets fixe sur mobile. Absent : 0px (rendu inchangé).
  function lift(px) { return "calc(" + px + "px + var(--chapote-widget-lift, 0px))"; }

  function css(d) {
    const brand = safeColor(d.primaryColor, "#0d9488");
    const color2 = d.secondaryColor ? safeColor(d.secondaryColor, brand) : null;
    const bg = color2 ? "linear-gradient(135deg," + brand + "," + color2 + ")" : brand;
    const side = d.position === "left" ? "left" : "right";
    const bubble = SIZES[d.size] || SIZES.md;
    const R = safeInt(d.borderRadius, 0, 40, 16);
    const r14 = Math.min(R, 14);
    // Personnalisation étendue, whitelists/bornes LOCALES (défense en
    // profondeur : le widget ne fait jamais confiance au serveur). Les
    // défauts reproduisent le rendu historique à l'identique.
    const font = FONTS[d.font] || FONTS.system;
    const ox = safeInt(d.offsetX, 0, 120, 18);
    const oy = safeInt(d.offsetY, 0, 120, 18);
    const dark = d.darkMode === true;
    // Texte posé sur la couleur de marque : onPrimary du design ou data-color-text
    // de la page (ex. texte sombre sur orange clair) ; blanc par défaut (historique).
    const onBrand = safeColor(d.onPrimary, "#fff");
    // surfaceTone : classic (surfaces historiques, sombre teinté vert) | neutral
    // (sombre neutre, réponses rapides sur le fond du panneau, lien « Chapote » à la
    // couleur de marque). Défaut classic = rendu historique au pixel près.
    const neutral = d.surfaceTone === "neutral";
    // En-tête : solid (actuel) | soft (clair) | gradient (dégradé de marque).
    const headerStyle = safeEnum(d.headerStyle, ["solid", "soft", "gradient"], "solid");
    const soft = headerStyle === "soft";
    const gradient = headerStyle === "gradient";
    const square = d.bubbleStyle === "square";
    const compact = d.density === "compact";
    // --- Refonte Apparence : nouvelles clés (défauts = rendu actuel à l'identique) ---
    // Accent : null -> marque (actuel). Si défini, gouverne options/réponses
    // rapides/envoi + focus de saisie. Validé comme une couleur hex.
    const accent = d.accentColor ? safeColor(d.accentColor, brand) : brand;
    // Largeur du panneau : si la clé est absente, on retombe sur la largeur
    // historique (338px) pour ne PAS modifier les widgets existants.
    const winW = safeInt(d.windowWidth, 300, 560, 338);
    // Coins des bulles : ergot (coins asymétriques, actuel) si true ; sinon r14 partout.
    const tail = d.bubbleTail !== false;
    const botR = square ? "8px" : (tail ? "4px " + r14 + "px " + r14 + "px " + r14 + "px" : r14 + "px");
    const userR = square ? "8px" : (tail ? r14 + "px " + r14 + "px 4px " + r14 + "px" : r14 + "px");
    // Échelle du texte des messages (sm≈.92, md=1, lg≈1.1).
    const ts = safeEnum(d.textScale, ["sm", "md", "lg"], "md");
    const tScale = ts === "sm" ? 0.92 : (ts === "lg" ? 1.1 : 1);
    const msgFs = (compact ? 12.5 : 13.5) * tScale;
    const optFs = (compact ? 11.5 : 12.5) * tScale;
    // Ombre de la fenêtre : 0=aucune 1=légère 2=moyenne (actuel) 3=forte.
    const shadowLvl = safeInt(d.shadow, 0, 3, 2);
    const SHADOWS = {
      0: "none",
      1: "0 6px 22px rgba(10,30,25,.12)",
      2: "0 18px 60px rgba(10,30,25,.22),0 2px 8px rgba(10,30,25,.08)",
      3: "0 26px 80px rgba(10,30,25,.34),0 4px 14px rgba(10,30,25,.16)",
    };
    const panelShadow = SHADOWS[shadowLvl];
    // Style des réponses rapides (options) : pill (arrondi 999, actuel) | button (rectangulaire).
    const optBtn = safeEnum(d.quickReplyStyle, ["pill", "button"], "pill") === "button";
    // Forme du lanceur (géométrie icône seule) : round=cercle (actuel).
    const lShape = safeEnum(d.launcherShape, ["round", "pill", "square"], "round");
    const sqR = Math.max(14, Math.round(bubble * 0.3)); // square : ~30% de la taille, min 14px
    const launcherRadius = lShape === "square" ? sqR + "px" : "50%";
    // Animation au repos du lanceur fermé : none (actuel) | float | pulse.
    const lAnim = safeEnum(d.launcherAnimation, ["none", "float", "pulse"], "none");
    // Surfaces du panneau : palette sombre si darkMode, littéraux actuels sinon.
    // Bulle user et options : brand inchangé (contraste OK sur les deux fonds).
    const P = SURFACES[dark ? (neutral ? "neutral" : "dark") : "light"];
    const panelBg = P.panel, msgsSolid = P.msgs, botBg = P.bot, botBorder = P.botBorder,
      botText = P.text, lineBorder = P.line, inputBg = P.input, inputBorder = P.inputBorder,
      mutedText = P.muted;
    // Fond des réponses rapides : blanc (historique) ; surface du panneau en ton neutre.
    const optBg = neutral ? panelBg : "#fff";
    // Fond de la zone de conversation : plain=solide (actuel) | soft=léger dégradé
    // teinté marque | pattern=motif de points discret. Respecte le mode sombre.
    const chatBg = safeEnum(d.chatBg, ["plain", "soft", "pattern"], "plain");
    let msgsBg = msgsSolid;
    if (chatBg === "soft") {
      // Teinte translucide dérivée de la marque (rgba, robuste quelle que soit
      // la longueur du hex — pas de concaténation d'alpha hasardeuse).
      const rgb = hexToRgb(brand);
      const tint = rgb ? "rgba(" + rgb + ",.05)" : (dark ? "#0e1714" : "#f3f6f5");
      msgsBg = "linear-gradient(180deg," + msgsSolid + "," + tint + ")";
    } else if (chatBg === "pattern") {
      const dotCol = dark ? "rgba(255,255,255,.05)" : "rgba(10,30,25,.06)";
      msgsBg = "radial-gradient(" + dotCol + " 1.2px,transparent 1.3px) 0 0/16px 16px," + msgsSolid;
    }
    // En-tête : solid = marque (actuel) ; soft = clair (surface) ; gradient = dégradé.
    const headBg = soft ? panelBg : (gradient ? bg : (color2 ? bg : brand));
    const headText = soft ? botText : onBrand;
    // Hauteur du panneau : windowHeight si défini (borné), sinon AUTO selon la
    // densité (= hauteur historique). max-height:70vh la cape au viewport.
    const winH = safeInt(d.windowHeight, 360, 720, compact ? 420 : 460);
    // openAnimation : zoom (actuel) | fade | slide | pop | flip.
    const oaName = ({ fade: "Fade", slide: "Slide", pop: "Pop", flip: "Flip" })[d.openAnimation] || "Zoom";
    const panelPos = INLINE
      ? "position:fixed;inset:0;width:100%;height:100%;max-height:none;border-radius:0;"
      : "position:fixed;bottom:" + lift(bubble + oy + 12) + ";" + side + ":" + ox + "px;width:" + winW + "px;max-width:calc(100vw - 36px);height:" + winH + "px;max-height:70vh;border-radius:" + R + "px;";
    return [
      ".kc-root{font-family:" + font + "}",
      ".kc-bubble{position:fixed;bottom:" + lift(oy) + ";" + side + ":" + ox + "px;width:" + bubble + "px;height:" + bubble + "px;border-radius:" + launcherRadius + ";",
      "border:" + (d.bordered ? "3px solid rgba(255,255,255,.95)" : "none") + ";cursor:pointer;background:" + bg + ";color:" + onBrand + ";",
      "box-shadow:0 8px 26px rgba(10,30,25,.3);display:grid;place-items:center;z-index:2147483000;",
      "transition:transform .18s ease;padding:0}",
      ".kc-bubble:hover{transform:scale(1.07)}.kc-bubble.open{transform:scale(.92)}",
      ".kc-bubble svg{width:" + Math.round(bubble * .44) + "px;height:" + Math.round(bubble * .44) + "px}",
      // Pilule du lanceur (launcherText non vide, mode flottant uniquement)
      ".kc-bubble-pill{width:auto;border-radius:99px;padding:0 16px 0 12px;display:flex;align-items:center;gap:8px}",
      ".kc-bubble-label{font-size:13px;font-weight:700;white-space:nowrap}",
      // launcherShape=pill : géométrie stade (icône seule, plus large). N'écrase
      // pas la pilule à libellé (.kc-bubble-pill, qui garde son propre gabarit).
      lShape === "pill" ? ".kc-bubble:not(.kc-bubble-pill){width:auto;min-width:" + bubble + "px;border-radius:999px;padding:0 " + Math.round(bubble * .28) + "px}" : "",
      // launcherAnimation (lanceur fermé uniquement, désarmé à l'ouverture via .open)
      lAnim === "float" ? ".kc-bubble:not(.open){animation:chapoteFloat 3s ease-in-out infinite}" : "",
      lAnim === "pulse" ? ".kc-bubble:not(.open){animation:chapoteHalo 2.4s ease-in-out infinite}" : "",
      lAnim === "float" ? "@keyframes chapoteFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}" : "",
      lAnim === "pulse" ? "@keyframes chapoteHalo{0%{box-shadow:0 8px 26px rgba(10,30,25,.3),0 0 0 0 " + brand + "59}70%{box-shadow:0 8px 26px rgba(10,30,25,.3),0 0 0 12px " + brand + "00}100%{box-shadow:0 8px 26px rgba(10,30,25,.3),0 0 0 0 " + brand + "00}}" : "",
      // Bulle d'accroche (greeting) au-dessus du lanceur fermé
      ".kc-greet{position:fixed;bottom:" + lift(bubble + oy + 14) + ";" + side + ":" + ox + "px;max-width:230px;background:" + botBg + ";color:" + botText + ";",
      "border:1px solid " + botBorder + ";border-radius:14px;padding:9px 12px;font-size:13px;line-height:1.4;",
      "box-shadow:0 8px 26px rgba(10,30,25,.18);z-index:2147482999}",
      ".kc-badge{position:absolute;top:-2px;right:-2px;width:19px;height:19px;border-radius:99px;background:#e74c3c;",
      "color:#fff;font-size:11px;font-weight:800;display:grid;place-items:center;border:2px solid #fff}",
      ".kc-panel{" + panelPos + "background:" + panelBg + ";box-shadow:" + panelShadow + ";",
      "display:none;flex-direction:column;overflow:hidden;z-index:2147483000;border:1px solid " + (dark ? lineBorder : "rgba(0,0,0,.06)") + "}",
      // openAnimation : zoom (actuel) | fade | slide | pop (rebond) | flip (bascule).
      ".kc-panel.open{display:flex;transform-origin:bottom " + side + ";animation:chapoteOpen" + oaName + " .26s ease}",
      "@keyframes chapoteOpenZoom{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}",
      "@keyframes chapoteOpenFade{from{opacity:0}to{opacity:1}}",
      "@keyframes chapoteOpenSlide{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}",
      "@keyframes chapoteOpenPop{0%{opacity:0;transform:scale(.8)}60%{opacity:1;transform:scale(1.04)}100%{transform:scale(1)}}",
      "@keyframes chapoteOpenFlip{from{opacity:0;transform:perspective(700px) rotateX(-16deg)}to{opacity:1;transform:perspective(700px) rotateX(0)}}",
      ".kc-head{background:" + headBg + ";color:" + headText + ";padding:13px 15px;display:flex;align-items:center;gap:10px" + (soft ? ";border-bottom:1px solid " + lineBorder : "") + "}",
      ".kc-head-ico{width:34px;height:34px;border-radius:10px;background:" + (soft ? bg : "rgba(255,255,255,.18)") + ";color:" + (soft ? "#fff" : onBrand) + ";display:grid;place-items:center;overflow:hidden;flex-shrink:0}",
      ".kc-head-ico svg{width:19px;height:19px}",
      ".kc-head-name{font-weight:700;font-size:14.5px;line-height:1.2}",
      ".kc-head-sub{font-size:11px;opacity:.85;display:flex;align-items:center;gap:5px}",
      // Ligne de statut « En ligne » (headerStatus) : même gabarit que .kc-head-sub
      ".kc-head-status{font-size:11px;opacity:.85;display:flex;align-items:center;gap:5px;margin-top:2px}",
      ".kc-dot{width:7px;height:7px;border-radius:9px;background:#7CF5C8;display:inline-block}",
      ".kc-mode{font-size:9.5px;font-weight:800;letter-spacing:.6px;padding:3px 8px;border-radius:99px;text-transform:uppercase;"
        + (soft ? "border:1.5px solid " + brand + ";color:" + brand + ";background:transparent" : "background:rgba(255,255,255,.2)") + "}",
      ".kc-x{background:none;border:none;color:" + headText + ";cursor:pointer;font-size:18px;line-height:1;padding:4px;opacity:.85}",
      ".kc-msgs{flex:1;overflow-y:auto;padding:" + (compact ? "10px" : "14px 13px") + ";display:flex;flex-direction:column;gap:" + (compact ? 6 : 9) + "px;background:" + msgsBg + "}",
      ".kc-row{display:flex;flex-direction:column;align-items:flex-start}.kc-row.user{align-items:flex-end}",
      ".kc-msg{max-width:82%;padding:" + (compact ? "7px 10px" : "9px 12px") + ";font-size:" + msgFs + "px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word}",
      ".kc-row.bot .kc-msg{border-radius:" + botR + ";background:" + botBg + ";color:" + botText + ";border:1px solid " + botBorder + ";box-shadow:0 1px 2px rgba(0,0,0,.04)}",
      ".kc-row.user .kc-msg{border-radius:" + userR + ";background:" + brand + ";color:" + onBrand + "}",
      // Horodatage discret sous chaque message (timestamps)
      ".kc-time{font-size:10px;color:" + mutedText + ";margin:2px 4px 0}",
      // Markdown léger rendu dans les bulles (liens cliquables, gras/italique).
      ".kc-msg a{color:inherit;text-decoration:underline;font-weight:600}",
      ".kc-msg strong{font-weight:700}",".kc-msg em{font-style:italic}",
      // Tag « IA » et tag « Conseiller » (live chat) : même gabarit
      ".kc-ai-tag,.kc-human-tag{font-size:9.5px;font-weight:800;letter-spacing:.5px;color:" + brand + ";margin-bottom:3px}",
      // CSAT : pouces discrets SOUS la bulle assistant (élément séparé de
      // .kc-msg, aucun texte ajouté aux bulles, contrat e2e)
      ".kc-rate{display:flex;gap:2px;margin:-5px 0 0 4px}",
      ".kc-rate button{background:none;border:none;cursor:pointer;color:" + mutedText + ";padding:2px;line-height:0;opacity:.7}",
      ".kc-rate button:hover{opacity:1}",
      ".kc-rate button svg{width:13px;height:13px}",
      ".kc-rate button.kc-on{color:" + brand + ";opacity:1}",
      ".kc-opts{display:flex;flex-wrap:wrap;gap:7px;margin-top:2px}",
      ".kc-opt{font-family:inherit;font-size:" + optFs + "px;font-weight:600;padding:" + (compact ? "6px 10px" : "8px 12px") + ";white-space:nowrap;border-radius:" + (square || optBtn ? "10px" : "99px") + ";",
      (optBtn ? "flex:1 1 100%;text-align:center;white-space:normal;" : "") + "border:1.5px solid " + accent + ";background:" + optBg + ";color:" + accent + ";cursor:pointer;transition:background .15s,color .15s}",
      ".kc-opt:hover{background:" + accent + ";color:" + onBrand + "}",
      ".kc-back{align-self:flex-start;font-family:inherit;font-size:11.5px;font-weight:600;padding:5px 10px;border-radius:99px;",
      "border:1px solid " + (neutral ? inputBorder : "#d8dedc") + ";background:" + optBg + ";color:" + (neutral ? mutedText : "#5f7873") + ";cursor:pointer}",
      ".kc-typing{display:flex}.kc-typing>div{padding:10px 14px;border-radius:4px 14px 14px 14px;background:" + botBg + ";border:1px solid " + botBorder + ";display:flex;gap:4px;align-items:center}",
      ".kc-td{width:6px;height:6px;border-radius:9px;background:#b9c4c0;display:inline-block;animation:chapoteBlink 1.2s infinite}",
      ".kc-td:nth-child(2){animation-delay:.18s}.kc-td:nth-child(3){animation-delay:.36s}",
      ".kc-typing.wave .kc-td{background:" + brand + ";animation:chapoteWave 1s infinite ease-in-out}",
      ".kc-typing.wave .kc-td:nth-child(2){animation-delay:.14s}.kc-typing.wave .kc-td:nth-child(3){animation-delay:.28s}",
      ".kc-typing.pulse .kc-td{width:10px;height:10px;background:" + brand + ";animation:chapotePulse 1s infinite ease-in-out}",
      ".kc-typing.pulse .kc-td:nth-child(2),.kc-typing.pulse .kc-td:nth-child(3){display:none}",
      // bars : trois barres verticales qui ondulent en hauteur
      ".kc-typing.bars .kc-td{width:4px;height:14px;border-radius:3px;background:" + brand + ";animation:chapoteBars 1s infinite ease-in-out}",
      ".kc-typing.bars .kc-td:nth-child(2){animation-delay:.16s}.kc-typing.bars .kc-td:nth-child(3){animation-delay:.32s}",
      // ring : un seul anneau qui tourne (les deux autres points masqués)
      ".kc-typing.ring .kc-td{width:14px;height:14px;border-radius:50%;background:none;border:2px solid " + botBorder + ";border-top-color:" + brand + ";animation:chapoteSpin .7s linear infinite}",
      ".kc-typing.ring .kc-td:nth-child(2),.kc-typing.ring .kc-td:nth-child(3){display:none}",
      // typing : trois points qui montent puis redescendent (frappe humaine)
      ".kc-typing.typing .kc-td{background:" + brand + ";animation:chapoteType 1.3s infinite ease-in-out}",
      ".kc-typing.typing .kc-td:nth-child(2){animation-delay:.2s}.kc-typing.typing .kc-td:nth-child(3){animation-delay:.4s}",
      "@keyframes chapoteBlink{0%,80%,100%{opacity:.35}40%{opacity:1}}",
      "@keyframes chapoteWave{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-5px)}}",
      "@keyframes chapotePulse{0%,100%{transform:scale(.7);opacity:.5}50%{transform:scale(1.15);opacity:1}}",
      "@keyframes chapoteBars{0%,100%{transform:scaleY(.45)}50%{transform:scaleY(1)}}",
      "@keyframes chapoteSpin{to{transform:rotate(360deg)}}",
      "@keyframes chapoteType{0%,100%{transform:translateY(0);opacity:.4}40%{transform:translateY(-4px);opacity:1}}",
      ".kc-inputrow{border-top:1px solid " + lineBorder + ";padding:10px;display:flex;gap:8px;background:" + panelBg + "}",
      ".kc-input{flex:1;font-family:inherit;font-size:13.5px;padding:10px 13px;border-radius:99px;border:1px solid " + inputBorder + ";",
      "outline:none;background:" + inputBg + ";color:" + botText + ";min-width:0}",
      ".kc-input:focus{border-color:" + accent + "}",
      ".kc-input:disabled{background:" + (dark ? msgsSolid : "#f4f6f5") + "}",
      // sendStyle=icon (actuel) : bouton plat ; colored : cercle plein teinté accent.
      ".kc-send{width:40px;height:40px;border-radius:99px;border:none;cursor:pointer;background:" + (d.sendStyle === "colored" ? accent : brand) + ";color:" + onBrand + ";",
      "display:grid;place-items:center;flex-shrink:0;transition:background .15s}",
      ".kc-send:disabled{background:#e3e8e6;cursor:default}",
      // Contraste AA (≥4.5:1 sur fond clair) : #6b7a76 au lieu de #9aa7a3.
      ".kc-powered{text-align:center;font-size:10px;color:" + P.powered + ";padding:0 0 7px;background:" + panelBg + "}",
      ".kc-powered a{color:inherit;text-decoration:none}",
      ".kc-powered a:hover{text-decoration:underline}",
      ".kc-powered b{font-weight:700;color:" + (neutral ? brand : "#0d9488") + "}",
      // Formulaire de contact (noeud d'arbre type "lead")
      ".kc-lead{background:" + botBg + ";border:1px solid " + botBorder + ";border-radius:" + (square ? 10 : r14) + "px;padding:12px;display:flex;flex-direction:column;gap:6px;max-width:86%;box-shadow:0 1px 2px rgba(0,0,0,.04)}",
      ".kc-lead-label{font-size:11px;font-weight:700;color:" + mutedText + "}",
      ".kc-lead-input{font-family:inherit;font-size:13px;padding:8px 11px;border-radius:10px;border:1px solid " + inputBorder + ";outline:none;background:" + inputBg + ";color:" + botText + ";resize:vertical}",
      ".kc-lead-input:focus{border-color:" + accent + "}",
      ".kc-lead-send{font-family:inherit;font-size:13px;font-weight:700;padding:9px;border-radius:99px;border:none;cursor:pointer;background:" + accent + ";color:" + onBrand + ";margin-top:4px}",
      ".kc-lead-send:disabled{background:#e3e8e6;cursor:default}",
      ".kc-lead-err{font-size:11.5px;color:#c0392b}",
      // Overlay rendez-vous (noeud d'arbre type "appointment")
      ".kc-overlay{position:absolute;inset:0;background:" + panelBg + ";z-index:5;display:flex;flex-direction:column}",
      ".kc-overlay-head{display:flex;align-items:center;justify-content:space-between;padding:10px 13px;border-bottom:1px solid " + lineBorder + ";font-size:13px;font-weight:700;color:" + botText + "}",
      ".kc-overlay-x{background:none;border:none;cursor:pointer;color:" + mutedText + ";padding:2px;width:24px;height:24px;display:grid;place-items:center}",
      ".kc-overlay-x svg{width:14px;height:14px}",
      ".kc-overlay iframe{flex:1;border:none;width:100%}",
      ".kc-overlay-link{display:block;text-align:center;font-size:12px;font-weight:600;color:" + brand + ";padding:9px;text-decoration:underline}",
      // Accessibilité : si l'OS demande de réduire les animations, on coupe les
      // animations CONTINUES (flottement/halo du lanceur, points de frappe) et
      // l'animation d'ouverture du panneau. Le révélé « machine à écrire » est
      // déjà neutralisé côté JS (prefersReducedMotion). !important prime sur les
      // variantes de loadingAnimation (wave/pulse/bars/ring/typing).
      "@media (prefers-reduced-motion:reduce){",
      ".kc-bubble:not(.open){animation:none!important}",
      ".kc-bubble:hover{transform:none}",
      ".kc-panel.open{animation:none!important}",
      ".kc-td{animation:none!important}",
      "}",
    ].join("");
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function build(d) {
    const style = document.createElement("style");
    style.textContent = css(d);
    document.head.appendChild(style);
    ui.style = style; // référence pour le re-skin à chaud (remplacement live)

    const root = el("div", "kc-root");
    document.body.appendChild(root);
    ui.root = root;

    // Panneau
    ui.panel = el("div", "kc-panel");
    // Accessibilité : le panneau est une boîte de dialogue modale nommée. La
    // prise de focus, le piège de focus (Tab) et la fermeture par Échap sont
    // gérés dans toggle() / onPanelKeydown (additif, non rendu en INLINE).
    ui.panel.setAttribute("role", "dialog");
    ui.panel.setAttribute("aria-modal", "true");
    ui.panel.setAttribute("aria-label", d.title || t("dialog_label"));
    const head = el("div", "kc-head");
    // headerAvatar : avatar/icône dans l'en-tête (actuel) ; false = masqué.
    if (d.headerAvatar !== false) {
      const hIco = el("div", "kc-head-ico");
      setIcon(hIco, d, d.icon === "image" && d.avatarImage ? 34 : 19);
      head.appendChild(hIco);
    }
    const hMid = el("div");
    hMid.style.cssText = "flex:1;min-width:0";
    hMid.appendChild(el("div", "kc-head-name", d.title || "Assistant"));
    ui.headSub = el("div", "kc-head-sub");
    ui.headSub.appendChild(el("span", "kc-dot"));
    ui.headSubText = el("span", null, t("online_tree"));
    ui.headSub.appendChild(ui.headSubText);
    hMid.appendChild(ui.headSub);
    // headerStatus : ligne « En ligne » sous le nom (point + libellé). Le
    // statusLabel est borné et posé en textContent (anti-XSS) ; vide -> localisé.
    if (d.headerStatus === true) {
      const status = el("div", "kc-head-status");
      status.appendChild(el("span", "kc-dot"));
      status.appendChild(el("span", null, safeStr(d.statusLabel, 60).trim() || t("online")));
      hMid.appendChild(status);
    }
    head.appendChild(hMid);
    ui.modeBadge = el("span", "kc-mode", "TREE");
    head.appendChild(ui.modeBadge);
    if (!INLINE) {
      const rst = el("button", "kc-x", "↻");
      rst.style.fontSize = "16px";
      rst.setAttribute("aria-label", t("reset_chat"));
      rst.title = t("reset_chat");
      rst.addEventListener("click", resetChat);
      head.appendChild(rst);
      const x = el("button", "kc-x", "×");
      x.setAttribute("aria-label", t("close"));
      x.addEventListener("click", toggle);
      head.appendChild(x);
    }
    ui.panel.appendChild(head);

    ui.msgs = el("div", "kc-msgs");
    // Accessibilité : le fil de messages est une zone « live » polie : les
    // bulles entrantes (bot / IA / conseiller) sont annoncées par les lecteurs
    // d'écran. aria-atomic=false -> seul l'ajout est lu, pas tout le fil.
    ui.msgs.setAttribute("role", "log");
    ui.msgs.setAttribute("aria-live", "polite");
    ui.msgs.setAttribute("aria-atomic", "false");
    ui.panel.appendChild(ui.msgs);

    const inputRow = el("div", "kc-inputrow");
    ui.input = document.createElement("input");
    ui.input.className = "kc-input";
    ui.input.maxLength = 4000;
    ui.input.placeholder = d.placeholder || t("placeholder");
    // Label accessible stable (le placeholder change selon le mode et n'est pas
    // un nom accessible fiable pour les lecteurs d'écran).
    ui.input.setAttribute("aria-label", t("input_label"));
    ui.input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") sendText();
    });
    ui.send = el("button", "kc-send");
    ui.send.innerHTML = SVG.send;
    ui.send.setAttribute("aria-label", t("send"));
    ui.send.addEventListener("click", sendText);
    inputRow.appendChild(ui.input);
    inputRow.appendChild(ui.send);
    ui.panel.appendChild(inputRow);
    ui.inputRow = inputRow;

    if (d.poweredBy !== false) {
      // Attribution = vrai lien VISIBLE vers le site Chapote (acquisition :
      // trafic de référence + notoriété). utm_source = domaine du site hôte
      // pour mesurer quels clients nous envoient des visiteurs. rel nofollow +
      // noopener : conforme aux consignes Google (lien de widget) et sûr
      // (anti tabnabbing). Le plan gratuit garde ce lien (moteur de croissance).
      const powered = el("div", "kc-powered");
      const a = document.createElement("a");
      a.href = "https://chapote.fr/?utm_source=" + encodeURIComponent(location.hostname || "site")
        + "&utm_medium=widget&utm_campaign=powered_by";
      a.target = "_blank";
      a.rel = "noopener nofollow";
      // Construction DOM (pas d'innerHTML) : "Propulsé par " + <b>Chapote</b>.
      a.appendChild(document.createTextNode(t("powered_by") + " "));
      const brandB = document.createElement("b");
      brandB.textContent = "Chapote";
      a.appendChild(brandB);
      powered.appendChild(a);
      ui.panel.appendChild(powered);
    }
    root.appendChild(ui.panel);

    // Bulle
    if (!INLINE) {
      ui.bubble = el("button", "kc-bubble");
      ui.bubble.setAttribute("aria-label", t("open_chat"));
      ui.bubbleIcon = el("span");
      setIcon(ui.bubbleIcon, d, bubbleIconSize(d));
      ui.bubble.appendChild(ui.bubbleIcon);
      // launcherText : bulle -> pilule [icône + libellé] (textContent, anti-XSS)
      const lt = (typeof d.launcherText === "string" ? d.launcherText : "").slice(0, 40);
      if (lt.trim()) {
        ui.bubble.classList.add("kc-bubble-pill");
        ui.bubbleLabel = el("span", "kc-bubble-label", lt);
        ui.bubble.appendChild(ui.bubbleLabel);
      }
      // launcherBadge : pastille « 1 » sur la bulle fermée (actuel) ; false = sans
      // pastille (bulle discrète, quand le chat est secondaire sur la page).
      if (d.launcherBadge !== false) {
        ui.badge = el("span", "kc-badge", "1");
        ui.bubble.appendChild(ui.badge);
      }
      ui.bubble.addEventListener("click", toggle);
      root.appendChild(ui.bubble);
      // greeting : petite bulle d'accroche au-dessus du lanceur fermé. Texte
      // borné (80) posé en textContent (anti-XSS). Cliquer ouvre le chat ;
      // masquée dès l'ouverture (cf. toggle).
      const gtxt = safeStr(d.greetingText, 80).trim();
      if (d.greeting === true && gtxt) {
        ui.greet = el("div", "kc-greet", gtxt);
        ui.greet.addEventListener("click", toggle);
        root.appendChild(ui.greet);
      }
    } else {
      state.open = true;
      ui.panel.classList.add("open");
      startSession();
    }

    updateModeUI();
  }

  function updateModeUI() {
    const human = isHuman();
    const ai = state.aiMode;
    ui.headSubText.textContent = human
      ? (state.chatStatus === "human" ? t("advisor_online") : t("advisor_wait"))
      : (ai ? t("online_ai") : t("online_tree"));
    ui.modeBadge.textContent = human ? "LIVE" : (ai ? "IA" : "TREE");
    // Mode humain : saisie toujours active, même sur un bot tree
    const canType = human || (ai && state.config.mode !== "tree");
    ui.input.disabled = !canType;
    ui.input.placeholder = human
      ? t("placeholder_advisor")
      : (canType
        ? (state.config.design.placeholder || t("placeholder"))
        : t("placeholder_pick"));
    ui.send.disabled = !canType;
    // Bot tree : la rangée de saisie reste cachée au bootstrap et ne
    // s'affiche qu'APRÈS un handoff effectif (réévalué à chaque appel)
    ui.inputRow.style.display = (state.config.mode === "tree" && !human) ? "none" : "";
  }

  // Re-skin à chaud : applique un design poussé par l'éditeur d'apparence SANS
  // reconstruire le DOM (zéro reset conversation). Cosmétique uniquement —
  // remplace la feuille de style (couleurs, police, rayon, thème, ombres,
  // densité…) + relit les textes dynamiques (placeholder). Les changements
  // STRUCTURELS (position, taille, icône, message d'accueil) ne sont PAS gérés
  // ici : l'éditeur recharge l'iframe pour ceux-là.
  function applyDesignLive(design) {
    if (!design || typeof design !== "object" || !ui.style) return;
    state.config.design = Object.assign({}, state.config.design, design);
    restyle();
    updateModeUI();
  }

  function restyle() { ui.style.textContent = css(withPageLook(state.config.design)); }

  // Apparence imposée par la page, à chaud (changement de couleur ou passage
  // clair/sombre sans recharger) : mêmes validations que les attributs data-*.
  // Cosmétique uniquement, la conversation n'est pas touchée.
  function setAppearance(look) {
    if (!look || typeof look !== "object" || !ui.style) return;
    const next = {
      color: "color" in look ? safeColor(look.color, "") : pageLook.color,
      colorText: "colorText" in look ? safeColor(look.colorText, "") : pageLook.colorText,
      theme: "theme" in look ? safeEnum(look.theme, ["light", "dark"], "") : pageLook.theme,
    };
    if (next.color === pageLook.color && next.colorText === pageLook.colorText && next.theme === pageLook.theme) return;
    Object.assign(pageLook, next);
    restyle();
  }

  // tag : "ai" | "human" | null, libellé constant « Conseiller » (le serveur
  // n'expose jamais l'identité du staff).
  // msgId (optionnel) : id serveur du message assistant ai|tree -> rangée CSAT
  // (pouces) appendée SÉPARÉMENT après la row, JAMAIS dans .kc-msg (les
  // sélecteurs e2e font des toHaveText exacts sur les bulles : zéro texte
  // ajouté, SVG + title localisé uniquement). Jamais de msgId pour les
  // messages human/system (poll), locaux, d'erreur ou de trigger.
  // Markdown LÉGER et SÛR (parité app/.../widget-preview/markdown.tsx) :
  // **gras**, *italique* / _italique_, [libellé](url http/https). Construit des
  // nœuds DOM (JAMAIS innerHTML) -> anti-XSS. Les \n restent en texte (rendus par
  // white-space:pre-wrap). Un texte sans token markdown ressort à l'identique
  // (les sélecteurs e2e toHaveText exact restent valides).
  var MD_RE = /\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_|\[([^\]]+)\]\(([^)\s]+)\)/g;
  function renderMd(parent, text) {
    text = String(text == null ? "" : text);
    MD_RE.lastIndex = 0;
    var last = 0, m;
    while ((m = MD_RE.exec(text)) !== null) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      if (m[1] != null) { var b = document.createElement("strong"); b.textContent = m[1]; parent.appendChild(b); }
      else if (m[2] != null || m[3] != null) { var it = document.createElement("em"); it.textContent = m[2] != null ? m[2] : m[3]; parent.appendChild(it); }
      else if (m[4] != null) {
        if (/^https?:\/\//i.test(m[5])) { var a = document.createElement("a"); a.href = m[5]; a.target = "_blank"; a.rel = "noopener nofollow"; a.textContent = m[4]; parent.appendChild(a); }
        else parent.appendChild(document.createTextNode(m[4]));
      }
      last = MD_RE.lastIndex;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }

  // Accessibilité : si l'OS/navigateur demande de réduire les animations, on
  // n'anime jamais le révélé progressif (rendu direct, instantané).
  function prefersReducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (e) { return false; }
  }

  // Révélé progressif « machine à écrire » : on dévoile le texte par salves de
  // 1 à 5 mots (longueur aléatoire), à cadence BORNÉE (~≤1 s même pour un long
  // message), puis l'état FINAL repasse par renderMd(container, text) -> DOM
  // strictement identique au rendu direct (anti-XSS conservé, sélecteurs e2e
  // toHaveText/contains intacts une fois l'animation terminée). On dévoile dans
  // un conteneur dédié (.kc-msg-body) sans toucher au tag IA/Conseiller.
  function typeInto(container, text) {
    // « mot + espaces suivants » : préserve la ponctuation, les \n et la mise en
    // forme. Un texte mono-bloc (un seul token) ressort direct (aucune animation).
    const chunks = text.match(/\S+\s*/g) || [text];
    if (chunks.length <= 1) { renderMd(container, text); return; }
    // Cadence : ~900 ms répartis sur le nombre estimé de salves (≈3 mots/salve),
    // bornée [16, 55] ms -> jamais d'animation interminable sur un long message.
    const salves = Math.max(1, Math.ceil(chunks.length / 3));
    const base = Math.min(55, Math.max(16, Math.round(900 / salves)));
    let shown = 0;
    function paint(full) {
      container.textContent = "";
      renderMd(container, full ? text : chunks.slice(0, shown).join(""));
      if (ui.msgs) ui.msgs.scrollTop = ui.msgs.scrollHeight;
    }
    function step() {
      // Conteneur détaché (panneau vidé/réinitialisé pendant l'animation) : stop.
      if (!container.isConnected) return;
      shown += 1 + Math.floor(Math.random() * 5); // 1..5 mots par salve
      if (shown >= chunks.length) { paint(true); return; } // état final exact
      paint(false);
      setTimeout(step, base + Math.floor(Math.random() * 22) - 6);
    }
    step(); // première salve visible immédiatement (pas de bulle vide au départ)
  }

  // restore=true : re-rendu d'un message PERSISTÉ au boot -> ne pas le ré-empiler
  // dans l'historique ni re-persister (et pas de CSAT, msgId non rejoué).
  function addMsg(role, text, tag, msgId, restore) {
    const row = el("div", "kc-row " + role);
    const m = el("div", "kc-msg");
    if (tag === "ai") {
      const tg = el("div", "kc-ai-tag");
      tg.innerHTML = SVG.sparkSmall + t("tag_ai"); // constantes statiques
      m.appendChild(tg);
    } else if (tag === "human") {
      const th = el("div", "kc-human-tag");
      th.innerHTML = SVG.userSmall + t("tag_advisor"); // constantes statiques
      m.appendChild(th);
    }
    // Corps du message isolé dans un conteneur dédié : permet le révélé
    // progressif (typeInto) sans jamais effacer le tag IA/Conseiller. Le span
    // hérite de white-space:pre-wrap (.kc-msg) -> \n et markdown rendus pareil.
    const body = el("span", "kc-msg-body");
    m.appendChild(body);
    row.appendChild(m);
    // Horodatage (timestamps) : heure locale courante (HH:MM), placeholder non
    // persisté — aucun stockage. Posé en textContent (anti-XSS).
    const dsg = (state.config && state.config.design) || {};
    if (dsg.timestamps === true) row.appendChild(el("div", "kc-time", nowHM()));
    ui.msgs.appendChild(row);
    if (msgId) ui.msgs.appendChild(rateRow(msgId));
    ui.msgs.scrollTop = ui.msgs.scrollHeight;
    // Son (sound) : court « ping » de synthèse à l'arrivée d'un message bot, hors
    // restauration (pas de boucle au boot). Garde-fous anti-autoplay dans playPing.
    if (role === "bot" && !restore && dsg.sound === true) playPing();
    // Révélé progressif : SEULEMENT les bulles bot fraîches (jamais l'utilisateur,
    // jamais la restauration d'historique), désactivé si l'OS demande moins
    // d'animations. Sinon rendu direct. L'historique persiste le texte COMPLET
    // dès maintenant -> un rechargement en cours d'animation restaure tout.
    if (role === "bot" && !restore && text != null && text !== "" && !prefersReducedMotion()) {
      typeInto(body, String(text));
    } else {
      renderMd(body, text);
    }
    if (!restore) {
      if (!state.history) state.history = [];
      state.history.push({ r: role, t: text, g: tag || null });
      persistSession();
    }
  }

  // Heure locale HH:MM (24h) pour l'horodatage des messages.
  function nowHM() {
    const dt = new Date();
    const h = dt.getHours(), mn = dt.getMinutes();
    return (h < 10 ? "0" + h : h) + ":" + (mn < 10 ? "0" + mn : mn);
  }

  // « Ping » de synthèse (WebAudio, aucun asset) joué à la réception d'un
  // message bot quand design.sound est actif. Tout est encapsulé dans un
  // try/catch : un contexte audio suspendu (autoplay bloqué) ou indisponible
  // ne doit JAMAIS interrompre le rendu.
  let _audioCtx = null;
  function playPing() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!_audioCtx) _audioCtx = new AC();
      const ctx = _audioCtx;
      if (ctx.state === "suspended" && ctx.resume) ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.24);
    } catch (e) { /* autoplay bloqué / WebAudio indisponible : silencieux */ }
  }

  // --- CSAT (pouce haut/bas sous les réponses assistant ai|tree) ---
  function rateRow(msgId) {
    const rate = el("div", "kc-rate");
    let current = null; // "up" | "down" (état local, le serveur écrase)
    let pending = false; // garde anti double-envoi pendant le POST
    let up, down;
    function paint() {
      up.classList.toggle("kc-on", current === "up");
      down.classList.toggle("kc-on", current === "down");
    }
    function mkBtn(kind) {
      const b = el("button");
      b.type = "button";
      b.innerHTML = SVG[kind === "up" ? "thumbUp" : "thumbDown"]; // constantes statiques
      b.title = kind === "up" ? t("rate_up") : t("rate_down");
      b.setAttribute("aria-label", b.title);
      b.addEventListener("click", function () {
        if (pending) return;
        const prev = current;
        if (prev === kind) return; // déjà noté pareil : rien à renvoyer
        pending = true;
        current = kind;
        paint();
        postFeedback(msgId, kind)
          .catch(function () { current = prev; paint(); }) // revert silencieux
          .finally(function () { pending = false; });
      });
      return b;
    }
    up = mkBtn("up");
    down = mkBtn("down");
    rate.appendChild(up);
    rate.appendChild(down);
    return rate;
  }

  function clearOptions() {
    const olds = ui.msgs.querySelectorAll(".kc-opts,.kc-back,.kc-lead");
    for (let i = 0; i < olds.length; i++) olds[i].remove();
  }

  function addOptions(options, apptUrl) {
    clearOptions();
    if ((options && options.length) || apptUrl) {
      const wrap = el("div", "kc-opts");
      if (apptUrl) {
        // Bouton rendez-vous : ouvre l'overlay calendrier (URL https validée)
        const rdv = el("button", "kc-opt", t("appointment"));
        rdv.addEventListener("click", function () { openAppointmentOverlay(apptUrl); });
        wrap.appendChild(rdv);
      }
      (options || []).forEach(function (o) {
        const b = el("button", "kc-opt", o.label);
        b.addEventListener("click", function () { sendNode(o.next, o.label); });
        wrap.appendChild(b);
      });
      ui.msgs.appendChild(wrap);
    }
    // Lien retour au menu en mode IA (hybride uniquement, jamais en mode humain)
    if (state.aiMode && state.config.mode === "hybrid" && !isHuman()) {
      const back = el("button", "kc-back", t("back_to_menu"));
      back.addEventListener("click", backToTree);
      ui.msgs.appendChild(back);
    }
    ui.msgs.scrollTop = ui.msgs.scrollHeight;
  }

  function setTyping(on) {
    const typing = ui.msgs.querySelector(".kc-typing");
    if (on && !typing) {
      // Whitelist (valeur libre -> className) : dots (actuel) + wave/pulse +
      // les trois nouvelles animations bars/ring/typing. Tout le reste -> dots.
      const anim = safeEnum((state.config.design || {}).loadingAnimation,
        ["dots", "wave", "pulse", "bars", "ring", "typing"], "dots");
      const wrap = el("div", "kc-typing" + (anim !== "dots" ? " " + anim : ""));
      const inner = el("div");
      inner.appendChild(el("span", "kc-td"));
      inner.appendChild(el("span", "kc-td"));
      inner.appendChild(el("span", "kc-td"));
      wrap.appendChild(inner);
      ui.msgs.appendChild(wrap);
      ui.msgs.scrollTop = ui.msgs.scrollHeight;
    } else if (!on && typing) typing.remove();
  }

  // --- Live chat (handoff conseiller) : statut serveur + polling ---
  // Pas de WebSocket : chaîne de setTimeout 2,5 s, uniquement panneau ouvert
  // et onglet visible. Pas de state.busy pour le poll (la saisie reste libre),
  // pas de setTyping pendant l'attente humaine.

  function stopPolling() {
    if (state.pollTimer) {
      clearTimeout(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function schedulePoll(ms) {
    stopPolling();
    state.pollTimer = setTimeout(pollTick, ms);
  }

  function maybeStartPolling() {
    if (!isHuman() || !state.open || document.hidden || state.pollTimer) return;
    schedulePoll(2500);
  }

  function pollTick() {
    state.pollTimer = null;
    if (!isHuman() || !state.open || document.hidden) return;
    api("/api/widget/poll?after=" + state.lastMsgId, { auth: true })
      .then(function (resp) {
        // Session glissante : critique pendant l'attente passive
        applyTokenRotation(resp);
        (resp.messages || []).forEach(function (m) {
          // Messages système (clôture, excuse timeout) : bulle bot sans tag
          addMsg("bot", m.content, m.source === "human" ? "human" : null);
          if (m.id > state.lastMsgId) state.lastMsgId = m.id;
        });
        applyStatus(resp);
        maybeStartPolling(); // replanifie si toujours en mode humain
      })
      .catch(function (err) {
        if (err.status === 401 || err.status === 404) {
          // Session expirée (401) ou widget coupé (404 : bot suspendu, org
          // inactive) : retour SILENCIEUX au mode normal, JAMAIS le
          // re-handshake du retry-401 (il créerait une nouvelle conversation)
          stopPolling();
          state.chatStatus = "ai";
          updateModeUI();
          return;
        }
        // 429 : backoff ; autre erreur réseau : nouvel essai plus espacé
        schedulePoll(err.status === 429 ? 10000 : 5000);
      });
  }

  // Le statut serveur est AUTORITAIRE : appelé sur chaque réponse qui le porte
  // (session/message/handoff/poll).
  function applyStatus(resp) {
    const s = resp && resp.status;
    if (!s) return;
    const wasHuman = isHuman();
    if (s === "human" || s === "human_requested") {
      // Transition vers "human" = un conseiller vient de PRENDRE la conversation
      // (depuis "human_requested" en attente, ou directement). Message une fois.
      if (s === "human" && state.chatStatus !== "human") addMsg("bot", t("advisor_joined"));
      state.chatStatus = s;
      persistSession();
      maybeStartPolling();
      updateModeUI();
      return;
    }
    // "ai" ou "closed" -> retour au mode normal
    state.chatStatus = "ai";
    if (wasHuman) {
      stopPolling();
      // Bot tree/hybrid hors mode IA : réaffiche les options racine (les
      // messages de clôture/excuse arrivent dans le batch du poll)
      if (state.config.mode !== "ai" && !state.aiMode) sendNodeSilent("__root__");
      updateModeUI();
    }
    persistSession();
  }

  // Demande de mise en relation (enchaînée après un nœud d'arbre type
  // "handoff", ou re-demande après clôture). retry-401 UNE fois autorisé ICI :
  // la demande INITIE la relation, un re-handshake propre est acceptable.
  function requestHandoff(retried) {
    return api("/api/widget/handoff", { method: "POST", auth: true })
      .then(function (resp) {
        applyTokenRotation(resp);
        clearOptions();
        if (resp.message) addMsg("bot", resp.message);
        // Curseur de polling : jamais de retour en arrière (cas idempotent
        // -> last_message_id null, on conserve le curseur courant)
        if (resp.last_message_id && resp.last_message_id > state.lastMsgId) {
          state.lastMsgId = resp.last_message_id;
        }
        applyStatus(resp);
      })
      .catch(function (err) {
        if (err.status === 401 && !retried) {
          return openSession().then(function () { return requestHandoff(true); });
        }
        addMsg("bot", t("error_generic"));
      });
  }

  function renderResponse(resp) {
    // CSAT : uniquement les réponses assistant ai|tree porteuses d'un id
    // serveur (jamais human/system, jamais les bulles locales/erreurs)
    const msgId = (resp.source === "ai" || resp.source === "tree") && resp.message_id
      ? resp.message_id : null;
    // message null = accusé du mode humain (la réponse arrive par /poll)
    if (resp.message != null) addMsg("bot", resp.message, resp.source === "ai" ? "ai" : null, msgId);
    if (resp.type === "lead") {
      // Formulaire de contact à la place des options (réaffichées après envoi)
      addLeadForm(resp.fields, resp.options);
    } else if (resp.type === "appointment" && /^https:\/\//.test(resp.url || "")) {
      addOptions(resp.options, resp.url);
    } else {
      addOptions(resp.options);
    }
    applyStatus(resp);
    // Nœud d'arbre handoff : le message d'intro du nœud est rendu, puis le
    // widget enchaîne la vraie demande de conseiller
    if (resp.type === "handoff") requestHandoff();
    updateModeUI();
  }

  // --- Rendez-vous (noeud "appointment") ---
  // Hôtes de calendrier embarquables en iframe (whitelist stricte). Hors
  // whitelist : lien seul, jamais d'iframe. Note CSP côté site client (mode
  // script) : frame-src https://calendly.com https://*.calendly.com
  // https://cal.com https://*.cal.com ; le mode /widget-frame n'est pas affecté.
  function embeddableCalendarHost(url) {
    try {
      const h = new URL(url).hostname;
      return h === "calendly.com" || h.endsWith(".calendly.com")
        || h === "cal.com" || h.endsWith(".cal.com");
    } catch (e) { return false; }
  }

  function openAppointmentOverlay(url) {
    if (!/^https:\/\//.test(url)) return;
    const old = ui.panel.querySelector(".kc-overlay");
    if (old) old.remove();
    const overlay = el("div", "kc-overlay");
    const head = el("div", "kc-overlay-head");
    head.appendChild(el("span", null, t("appointment")));
    const x = el("button", "kc-overlay-x");
    x.innerHTML = SVG.close; // constante statique
    x.setAttribute("aria-label", t("close"));
    x.addEventListener("click", function () { overlay.remove(); });
    head.appendChild(x);
    overlay.appendChild(head);
    if (embeddableCalendarHost(url)) {
      const frame = document.createElement("iframe");
      frame.src = url; // posé en PROPRIÉTÉ après validation, jamais en HTML
      frame.title = t("appointment_title");
      overlay.appendChild(frame);
    }
    const link = document.createElement("a");
    link.href = url; // propriété
    link.target = "_blank";
    link.rel = "noopener";
    link.className = "kc-overlay-link";
    link.textContent = t("open_new_tab");
    overlay.appendChild(link);
    ui.panel.appendChild(overlay);
  }

  // --- Formulaire de contact (noeud "lead") ---
  // Seules les CLÉS servent (whitelist des champs autorisés) : les libellés
  // affichés viennent de t("lead_"+f). On garde donc un simple jeu de clés.
  const LEAD_FIELDS = { email: true, name: true, phone: true, message: true };
  const LEAD_MAXLEN = { email: 254, name: 120, phone: 40, message: 2000 }; // alignés serveur
  // Compteur d'ids uniques (un widget peut afficher plusieurs formulaires lead)
  // pour associer programmatiquement <label for> / aria-describedby.
  let LEAD_UID = 0;

  // CSAT : POST du pouce. SANS retry-401 (contrat « jamais de re-handshake »
  // hors envoi de message : un re-handshake créerait une NOUVELLE conversation
  // et le message_id renverrait un 404 garanti, même philosophie que le
  // poll). Échec = rejet de la promesse, revert visuel silencieux côté bouton.
  function postFeedback(messageId, rating) {
    return api("/api/widget/feedback", {
      method: "POST", auth: true,
      body: { message_id: messageId, rating: rating },
    }).then(applyTokenRotation);
  }

  // Miroir de postMessage : même retry-401 + refresh_token
  function postLead(body, retried) {
    return api("/api/widget/lead", { method: "POST", auth: true, body: body })
      .then(applyTokenRotation)
      .catch(function (err) {
        return retryAfterSession(err, retried, function () { return postLead(body, true); });
      });
  }

  function addLeadForm(fields, options) {
    clearOptions();
    fields = (fields || ["email", "message"]).filter(function (f) { return LEAD_FIELDS[f]; });
    if (fields.indexOf("email") === -1) fields.unshift("email");
    const uid = ++LEAD_UID;
    const form = el("div", "kc-lead");
    const inputs = {};
    fields.forEach(function (f) {
      const fid = "kc-lead-" + f + "-" + uid;
      // Label associé programmatiquement (for/id) au champ correspondant.
      const lbl = el("label", "kc-lead-label", t("lead_" + f));
      lbl.setAttribute("for", fid);
      form.appendChild(lbl);
      let input;
      if (f === "message") {
        input = document.createElement("textarea");
        input.rows = 3;
      } else {
        input = document.createElement("input");
        input.type = f === "email" ? "email" : "text";
      }
      input.id = fid;
      input.className = "kc-lead-input";
      input.maxLength = LEAD_MAXLEN[f];
      if (f === "email") input.required = true;
      inputs[f] = input;
      form.appendChild(input);
    });
    const err = el("div", "kc-lead-err");
    err.id = "kc-lead-err-" + uid;
    // role=alert : l'erreur de validation est annoncée dès son affichage.
    err.setAttribute("role", "alert");
    err.style.display = "none";
    // Le champ email est décrit par le message d'erreur (annonce contextuelle).
    if (inputs.email) inputs.email.setAttribute("aria-describedby", err.id);
    form.appendChild(err);
    const submit = el("button", "kc-lead-send", t("send"));
    submit.addEventListener("click", function () {
      if (state.busy) return;
      const email = (inputs.email.value || "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        err.textContent = t("lead_invalid_email");
        err.style.display = "block";
        inputs.email.setAttribute("aria-invalid", "true");
        inputs.email.focus();
        return;
      }
      err.style.display = "none";
      inputs.email.removeAttribute("aria-invalid");
      const body = { email: email };
      ["name", "phone", "message"].forEach(function (f) {
        if (inputs[f] && inputs[f].value.trim()) body[f] = inputs[f].value.trim();
      });
      state.busy = true;
      submit.disabled = true;
      postLead(body)
        .then(function (resp) {
          form.remove();
          addMsg("bot", resp.message || t("lead_sent"));
          addOptions(options);
        })
        .catch(function (e) {
          err.textContent = e.status === 429
            ? t("lead_too_many")
            : t("error_generic");
          err.style.display = "block";
          submit.disabled = false;
        })
        .finally(function () { state.busy = false; });
    });
    form.appendChild(submit);
    ui.msgs.appendChild(form);
    ui.msgs.scrollTop = ui.msgs.scrollHeight;
  }

  // --- Envoi ---
  function postMessage(body, retried) {
    // Aperçu : la session ne persiste aucun message côté serveur -> on joint le
    // fil local pour que l'IA garde le contexte multi-tours. Inclut le message
    // courant (déjà ajouté à state.history). Ignoré par le serveur hors aperçu
    // et pour un clic d'arbre (body.node).
    if (PREVIEW_TOKEN && body && body.text && body.history == null) {
      body.history = (state.history || []).slice(-24).map(function (m) {
        return { role: m.r === "user" ? "user" : "assistant", content: String(m.t == null ? "" : m.t) };
      }).filter(function (m) { return m.content; });
    }
    return api("/api/widget/message", { method: "POST", auth: true, body: body })
      // Sliding session : le serveur renouvelle le JWT quand l'expiration approche
      .then(applyTokenRotation)
      .catch(function (err) {
        // Re-handshake silencieux : on ignore le message d'accueil (first)
        // pour ne pas l'empiler sur la conversation, et on rejoue la requête.
        return retryAfterSession(err, retried, function () { return postMessage(body, true); });
      });
  }

  function sendNode(next, label) {
    if (state.busy) return;
    state.busy = true;
    addMsg("user", label.replace(/^[^\p{L}\p{N}↩]*\s*/u, ""));
    clearOptions();

    if (next === "__ai__") {
      state.busy = false;
      if (state.config.mode === "tree") {
        addMsg("bot", t("ai_unavailable"));
        sendNodeSilent("__root__");
        return;
      }
      state.aiMode = true;
      addMsg("bot", t("ai_intro"));
      addOptions([]);
      updateModeUI();
      ui.input.focus();
      return;
    }

    setTyping(true);
    postMessage({ node: next, page_url: pageUrl() })
      .then(renderResponse)
      .catch(function () { addMsg("bot", t("error_generic")); })
      .finally(function () { setTyping(false); state.busy = false; });
  }

  // Re-affiche les options racine sans message visiteur (apres refus IA)
  function sendNodeSilent(node) {
    postMessage({ node: node, page_url: pageUrl() })
      .then(function (resp) { addOptions(resp.options); })
      .catch(function () { /* best-effort: analytics de nœud, échec ignoré */ });
  }

  function backToTree() {
    if (state.busy) return;
    state.busy = true;
    state.aiMode = false;
    addMsg("user", t("back_to_menu_user"));
    clearOptions();
    setTyping(true);
    postMessage({ node: "__root__", page_url: pageUrl() })
      .then(renderResponse)
      .catch(function () { addMsg("bot", t("error_short")); })
      .finally(function () { setTyping(false); state.busy = false; updateModeUI(); });
  }

  function sendText() {
    const text = ui.input.value.trim();
    if (!text || state.busy || ui.input.disabled) return;
    state.busy = true;
    addMsg("user", text);
    ui.input.value = "";
    clearOptions();
    // Pas d'indicateur de frappe pendant l'attente humaine (simple accusé)
    if (!isHuman()) setTyping(true);

    postMessage({ text: text, page_url: pageUrl() })
      .then(renderResponse)
      .catch(function (err) {
        addMsg("bot", err.status === 429 ? t("error_too_fast") : t("error_generic"));
      })
      .finally(function () { setTyping(false); state.busy = false; });
  }

  // Restaure le fil PERSISTÉ (au lieu d'ouvrir une nouvelle session) : re-rend
  // les bulles mémorisées puis reprend le cours (live chat ou menu d'accueil).
  function renderRestored() {
    state.restored = false;
    (state.history || []).forEach(function (h) { addMsg(h.r, h.t, h.g, null, true); });
    updateModeUI();
    if (isHuman()) {
      maybeStartPolling(); // reprend l'attente / l'échange conseiller en cours
    } else if (state.aiMode || state.config.mode === "ai") {
      if (ui.input) ui.input.focus(); // mode IA : saisie libre, pas de menu
    } else {
      // Bot à menu : ré-affiche les options racine pour CONTINUER. Best-effort,
      // token expiré -> postMessage re-handshake une session serveur fraîche,
      // le fil visible restant préservé.
      sendNodeSilent("__root__");
    }
  }

  function startSession() {
    if (state.busy) return;
    if (state.restored) { renderRestored(); return; }
    if (state.token) return;
    state.busy = true;
    state.aiMode = state.config.mode === "ai";
    updateModeUI();
    setTyping(true);
    openSession()
      .then(function (first) {
        if (state.config.mode === "ai") {
          // Accueil notables (CSAT) : le serveur persiste le message d'accueil
          addMsg("bot", first.message || t("ai_intro_short"), null, first.message_id || null);
          updateModeUI();
        } else {
          renderResponse(first);
        }
      })
      .catch(function () { addMsg("bot", t("chat_unavailable")); })
      .finally(function () {
        setTyping(false); state.busy = false;
        // Trigger proactif : bulle LOCALE du message APRÈS l'accueil (aucun
        // appel serveur, jamais de msgId -> pas de CSAT dessus)
        if (state.pendingTriggerMsg) {
          addMsg("bot", state.pendingTriggerMsg);
          state.pendingTriggerMsg = null;
        }
      });
  }

  // Réinitialise la conversation : coupe le live chat, oublie la session serveur
  // (token + statut), vide le fil et relance une session fraîche (menu d'accueil).
  function resetChat() {
    stopPolling();
    clearSession();
    state.token = null;
    state.chatStatus = "ai";
    state.aiMode = state.config && state.config.mode === "ai";
    state.lastMsgId = 0;
    state.busy = false;
    state.restored = false;
    if (ui.msgs) ui.msgs.textContent = "";
    startSession();
  }

  // Accessibilité — gestion du focus du panneau (boîte de dialogue modale).
  // Liste ORDONNÉE des éléments focusables VISIBLES contenus dans le panneau.
  function focusablesInPanel() {
    const sel = "a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex='-1'])";
    return Array.prototype.slice.call(ui.panel.querySelectorAll(sel))
      .filter(function (e) { return e.offsetWidth > 0 || e.offsetHeight > 0 || e === document.activeElement; });
  }

  // Écouteur clavier posé sur le panneau À L'OUVERTURE, retiré à la fermeture :
  // Échap ferme ; Tab / Shift+Tab bouclent dans le panneau (piège de focus).
  // stopPropagation sur Échap évite de faire fuiter la touche vers le site hôte.
  function onPanelKeydown(e) {
    if (e.key === "Escape" || e.key === "Esc") {
      e.stopPropagation();
      e.preventDefault();
      if (state.open) toggle();
      return;
    }
    if (e.key !== "Tab") return;
    const f = focusablesInPanel();
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || !ui.panel.contains(active)) { e.preventDefault(); last.focus(); }
    } else {
      if (active === last || !ui.panel.contains(active)) { e.preventDefault(); first.focus(); }
    }
  }

  // Déplace le focus DANS le panneau ouvert : champ de saisie si actif/visible,
  // sinon premier élément focusable (en-tête). Différé pour laisser le DOM
  // (options, saisie) se mettre en place après startSession.
  function focusPanel() {
    setTimeout(function () {
      if (!state.open || !ui.panel) return;
      if (ui.input && !ui.input.disabled && (ui.input.offsetWidth > 0 || ui.input.offsetHeight > 0)) {
        ui.input.focus();
        return;
      }
      const f = focusablesInPanel();
      if (f.length) f[0].focus();
    }, 0);
  }

  function toggle() {
    // Toute interaction avec le widget (ouverture OU fermeture) désarme
    // définitivement les triggers proactifs de la page
    state.interacted = true;
    state.open = !state.open;
    ui.panel.classList.toggle("open", state.open);
    if (ui.bubble) {
      ui.bubble.classList.toggle("open", state.open);
      const dsg = state.config.design;
      if (state.open) {
        ui.bubbleIcon.innerHTML = SVG.close; // constante statique
        // Pilule (launcherText) : ouvert -> croix seule, redevient un rond
        if (ui.bubbleLabel) {
          ui.bubbleLabel.style.display = "none";
          ui.bubble.classList.remove("kc-bubble-pill");
        }
      } else {
        setIcon(ui.bubbleIcon, dsg, bubbleIconSize(dsg));
        if (ui.bubbleLabel) {
          ui.bubbleLabel.style.display = "";
          ui.bubble.classList.add("kc-bubble-pill");
        }
      }
      if (state.open && ui.badge) { ui.badge.style.display = "none"; }
      // greeting : l'accroche disparaît dès la première ouverture (définitif)
      if (ui.greet) { ui.greet.style.display = state.open ? "none" : ""; }
    }
    if (state.open) {
      cancelTriggers(); // panneau ouvert : plus aucun tir possible
      startSession();
      maybeStartPolling(); // reprise du live chat si une demande est en cours
      // Accessibilité : arme le piège de focus + Échap, puis place le focus
      // dans la boîte de dialogue.
      ui.panel.addEventListener("keydown", onPanelKeydown);
      focusPanel();
    } else {
      stopPolling(); // panneau fermé : arrêt propre du polling
      // Retire l'écouteur (ne capte plus les Échap globaux du site hôte) et
      // rend le focus au lanceur.
      ui.panel.removeEventListener("keydown", onPanelKeydown);
      if (ui.bubble) ui.bubble.focus();
    }
    persistSession(); // mémorise l'état ouvert/fermé (démarre le cooldown 2 h à la fermeture)
  }

  // --- Triggers proactifs ---
  // Évalués 100% côté client (timer, profondeur de scroll, intention de
  // sortie, motif d'URL) à partir du bootstrap sanitisé, AUCUN appel serveur
  // au déclenchement : le tir ouvre le panneau (toggle -> startSession) puis
  // affiche le message en bulle locale. UN SEUL tir par chargement de page
  // (le premier annule les autres), jamais si le panneau est ouvert ou si le
  // visiteur a déjà interagi. Dédup once_per_session via sessionStorage
  // kc_triggers (même try/catch que kc_journey). Jamais initialisés en mode
  // INLINE (panneau déjà ouvert, scroll/souris de la page parente invisibles).
  let triggerCleanups = [];

  function firedTriggers() {
    try {
      const list = JSON.parse(sessionStorage.getItem("kc_triggers") || "[]");
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }

  function markTriggerFired(id) {
    try {
      const list = firedTriggers();
      if (list.indexOf(id) === -1) list.push(id);
      sessionStorage.setItem("kc_triggers", JSON.stringify(list));
    } catch (e) { /* sessionStorage indisponible (navigation privée…) */ }
  }

  function cancelTriggers() {
    for (let i = 0; i < triggerCleanups.length; i++) {
      try { triggerCleanups[i](); } catch (e) { /* déjà nettoyé */ }
    }
    triggerCleanups = [];
  }

  function fireTrigger(trg, id) {
    if (state.open || state.interacted) return;
    if (trg.once_per_session !== false) markTriggerFired(id);
    cancelTriggers();
    // Bulle locale affichée dans le .finally de startSession, après l'accueil
    state.pendingTriggerMsg = String(trg.message || "");
    toggle(); // pose state.interacted, ouvre le panneau + démarre la session
  }

  function matchUrlPattern(pattern, path) {
    // Sans wildcard : match par sous-chaîne ; avec '*' : wildcard simple
    if (pattern.indexOf("*") === -1) return path.indexOf(pattern) !== -1;
    try {
      const parts = pattern.split("*");
      for (let i = 0; i < parts.length; i++) {
        parts[i] = parts[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
      return new RegExp("^" + parts.join(".*") + "$").test(path);
    } catch (e) { return false; }
  }

  function initTriggers(triggers) {
    if (!triggers || !triggers.length) return;
    const fired = firedTriggers();
    triggers.forEach(function (trg) {
      const id = String(trg.type) + ":" + String(trg.value == null ? "" : trg.value);
      if (trg.once_per_session !== false && fired.indexOf(id) !== -1) return;
      if (trg.type === "time_on_page") {
        const timer = setTimeout(function () { fireTrigger(trg, id); },
          Math.max(1, trg.value | 0) * 1000);
        triggerCleanups.push(function () { clearTimeout(timer); });
      } else if (trg.type === "scroll_depth") {
        const onScroll = function () {
          const h = document.documentElement.scrollHeight || 1;
          if ((window.scrollY + window.innerHeight) / h * 100 >= trg.value) fireTrigger(trg, id);
        };
        window.addEventListener("scroll", onScroll, { passive: true });
        triggerCleanups.push(function () { window.removeEventListener("scroll", onScroll); });
      } else if (trg.type === "exit_intent") {
        // Pas de mouseleave fiable sur mobile (pointeur grossier) : désactivé
        if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) return;
        const onLeave = function (e) { if (e.clientY <= 0) fireTrigger(trg, id); };
        document.addEventListener("mouseleave", onLeave);
        triggerCleanups.push(function () { document.removeEventListener("mouseleave", onLeave); });
      } else if (trg.type === "url_pattern") {
        // Testé UNE fois au chargement, contre le pathname courant
        if (typeof trg.value === "string" && matchUrlPattern(trg.value, location.pathname || "/")) {
          fireTrigger(trg, id);
        }
      }
    });
  }

  // --- Init ---
  recordJourney();
  api("/api/widget/bootstrap?key=" + encodeURIComponent(BOT_KEY) + (PREVIEW_TOKEN ? "&preview_token=" + encodeURIComponent(PREVIEW_TOKEN) : ""))
    .then(function (config) {
      state.config = config;
      config.design = config.design || {};
      // Locale de l'UI : résolue AVANT build ('auto' = langue du navigateur,
      // anglais sinon français ; toute autre valeur retombe sur fr)
      let loc = config.design.locale;
      if (loc === "auto") {
        loc = (navigator.language || "fr").toLowerCase().indexOf("en") === 0 ? "en" : "fr";
      }
      LOCALE = loc === "en" ? "en" : "fr";
      // Session persistée (< 2 h) : restaure token + statut + fil AVANT build
      // (l'INLINE ouvre la session immédiatement -> doit voir state.restored).
      if (!PREVIEW_TOKEN) loadSession(); // aperçu : toujours repartir d'une conversation vierge
      build(withPageLook(config.design));
      // Bubble : si la session restaurée était OUVERTE, on rouvre le panneau
      // (toggle -> startSession -> renderRestored). Sinon le fil se restaure au
      // prochain clic. (INLINE : déjà ouvert + startSession appelé dans build.)
      if (!INLINE && state.restored && state.restoredOpen) toggle();
      // Aperçu d'apparence : ouvre le panneau d'office (rendu complet visible).
      if (PREVIEW_OPEN && !state.open) toggle();
      // Chargement au clic (data-open) : le visiteur a déjà demandé le chat.
      if (OPEN_ON_LOAD && !INLINE && !state.open) toggle();
      // Petite API pour la page hôte : ouvrir/fermer, suivre sa couleur et son
      // thème. Une entrée par clé de bot ; aucune donnée de session exposée.
      window.ChapoteWidget = window.ChapoteWidget || {};
      window.ChapoteWidget[BOT_KEY] = {
        open: function () { if (!INLINE && !state.open) toggle(); },
        close: function () { if (!INLINE && state.open) toggle(); },
        setAppearance: setAppearance,
      };
      try { window.dispatchEvent(new CustomEvent("chapote-widget-ready", { detail: { key: BOT_KEY } })); } catch (e) { /* navigateur ancien */ }
      // Triggers proactifs : jamais en INLINE (panneau déjà ouvert, les
      // scroll/mouseleave de la page parente sont invisibles depuis l'iframe)
      if (!INLINE) initTriggers(config.triggers || []);
      // Re-skin à chaud (éditeur d'apparence) : on n'accepte un design poussé que
      // de l'origine ET du nonce reflétés par /widget-frame (validés serveur).
      // Cosmétique seulement, aucune reconstruction du DOM.
      if (RESKIN_ORIGIN && RESKIN_NONCE) {
        window.addEventListener("message", function (e) {
          if (e.origin !== RESKIN_ORIGIN) return;
          var msg = e.data;
          if (!msg || msg.type !== "chapote-apply-design" || msg.nonce !== RESKIN_NONCE) return;
          applyDesignLive(msg.design);
        });
        // Signale au parent (éditeur d'apparence) que l'écouteur est prêt : il
        // peut pousser le design courant (sinon ses 1ers messages seraient perdus).
        try {
          window.parent.postMessage(
            { source: "chapote-widget", type: "reskin-ready", nonce: RESKIN_NONCE }, RESKIN_ORIGIN);
        } catch (e) { /* parent inaccessible : no-op */ }
      }
      // Live chat : onglet caché -> arrêt du polling, visible -> reprise.
      // Enregistré UNE fois après build ; en inline (panneau toujours ouvert)
      // c'est le seul interrupteur du polling.
      document.addEventListener("visibilitychange", function () {
        if (document.hidden) stopPolling();
        else maybeStartPolling();
      });
    })
    .catch(function (err) {
      console.warn("[chapote-chat]", err.message);
      // Bot inconnu, désactivé ou injoignable : la page hôte peut retirer sa bulle d'attente.
      try { window.dispatchEvent(new CustomEvent("chapote-widget-error", { detail: { key: BOT_KEY } })); } catch (e) { /* navigateur ancien */ }
    });
})();
