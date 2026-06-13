/**
 * Kertios Chat — widget embarquable.
 *
 * Usage flottant :
 *   <script src="https://api.exemple.com/widget.js" data-bot-key="pk_xxx" defer></script>
 * Usage iframe (via /widget-frame) :
 *   <script src=".../widget.js" data-bot-key="pk_xxx" data-inline="true" defer></script>
 *
 * Vanilla JS, zéro dépendance. La clé data-bot-key est PUBLIQUE : elle ne
 * permet que d'initialiser une session (vérifiée côté serveur : domaine
 * whitelisté + captcha + rate limits). Aucune clé IA ne transite ici.
 *
 * Design : prototype "Kertios Chat" (claude.ai/design) — widget.jsx.
 */
(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) {
    var scripts = document.querySelectorAll("script[data-bot-key]");
    script = scripts[scripts.length - 1];
  }
  if (!script) return;
  var BOT_KEY = script.getAttribute("data-bot-key");
  if (!BOT_KEY) return;
  // Anti double-initialisation : un seul widget par clé même si le script est inclus deux fois
  window.__kertiosChat = window.__kertiosChat || {};
  if (window.__kertiosChat[BOT_KEY]) return;
  window.__kertiosChat[BOT_KEY] = true;
  var INLINE = script.getAttribute("data-inline") === "true";
  var API = script.src.replace(/\/widget\.js.*$/, "");

  // Garde-fous anti-injection : le design_json vient du serveur mais le widget
  // se défend seul — seules des valeurs sûres entrent dans la feuille de style.
  function safeColor(c, fallback) { return /^#[0-9a-fA-F]{3,8}$/.test(c || "") ? c : fallback; }
  function safeInt(n, min, max, fallback) { n = parseInt(n, 10); return isNaN(n) ? fallback : Math.min(max, Math.max(min, n)); }

  function pageUrl() {
    return INLINE ? (document.referrer || location.href) : location.href;
  }

  function visitorId() {
    try {
      var id = localStorage.getItem("kc_vid");
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
  // parente — la page parente n'est connue que via document.referrer (même
  // mécanisme que parent_url), et le parcours s'accumule dans le
  // sessionStorage de la frame (même onglet). Referrer absent/illisible
  // (Referrer-Policy stricte) → on n'enregistre rien : journey restera null.
  function currentPath() {
    if (!INLINE) return location.pathname || "/";
    if (!document.referrer) return null;
    try { return new URL(document.referrer).pathname || "/"; } catch (e) { return null; }
  }

  function recordJourney() {
    var path = currentPath();
    if (!path) return;
    try {
      var list = JSON.parse(sessionStorage.getItem("kc_journey") || "[]");
      if (!Array.isArray(list)) list = [];
      var last = list[list.length - 1];
      if (last && last.p === path) return;
      list.push({ p: path, t: Math.floor(Date.now() / 1000) });
      if (list.length > 10) list = list.slice(-10);
      sessionStorage.setItem("kc_journey", JSON.stringify(list));
    } catch (e) { /* sessionStorage indisponible (navigation privée…) */ }
  }

  function getJourney() {
    try {
      var list = JSON.parse(sessionStorage.getItem("kc_journey") || "null");
      return Array.isArray(list) && list.length ? list : null;
    } catch (e) {
      return null;
    }
  }

  // chatStatus : statut SERVEUR autoritaire du live chat (ai | human_requested
  // | human) — aiMode/degraded restent des sous-états du mode ai. Le token vit
  // en mémoire seule : un reload de page = nouvelle conversation (limitation
  // documentée, couverte par le timeout 15 min serveur + la clôture staff).
  var state = { config: null, token: null, open: false, busy: false, aiMode: false, degraded: false, unread: 1,
    chatStatus: "ai", lastMsgId: 0, pollTimer: null,
    // Triggers proactifs : interacted = le visiteur a déjà touché au widget
    // (plus aucun tir possible) ; pendingTriggerMsg = bulle locale à afficher
    // après l'accueil de la session ouverte par un trigger.
    interacted: false, pendingTriggerMsg: null };

  function isHuman() {
    return state.chatStatus === "human" || state.chatStatus === "human_requested";
  }

  // --- HTTP ---
  function api(path, opts) {
    opts = opts || {};
    var headers = { "Content-Type": "application/json" };
    if (opts.auth && state.token) headers["Authorization"] = "Bearer " + state.token;
    return fetch(API + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (d) {
        var err = new Error(d.detail || "HTTP " + r.status);
        err.status = r.status;
        throw err;
      });
      return r.json();
    });
  }

  // --- Captcha (au handshake uniquement, invisible) ---
  // Pas de SRI : Turnstile/reCAPTCHA sont des scripts mutables mis à jour par
  // Cloudflare/Google (leurs docs officielles chargent sans integrity).
  var loadedScripts = {}; // src -> Promise, évite la double injection au re-handshake
  function loadScript(src) {
    if (loadedScripts[src]) return loadedScripts[src];
    loadedScripts[src] = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src; s.async = true;
      s.onload = resolve;
      s.onerror = function (e) { delete loadedScripts[src]; reject(e); };
      document.head.appendChild(s);
    });
    return loadedScripts[src];
  }

  function getCaptchaToken() {
    var cfg = state.config.captcha || {};
    if (cfg.provider === "disabled" || !cfg.site_key) return Promise.resolve(null);
    if (cfg.provider === "turnstile") {
      return loadScript("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit")
        .then(function () {
          return new Promise(function (resolve) {
            var holder = document.createElement("div");
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
      return api("/api/widget/session", {
        method: "POST",
        body: {
          public_key: BOT_KEY,
          visitor_id: visitorId(),
          page_url: pageUrl(),
          parent_url: INLINE ? document.referrer : null,
          captcha_token: token,
          journey: getJourney(),
        },
      });
    }).then(function (data) {
      state.token = data.token;
      return data.first;
    });
  }

  // --- Icônes (SVG du design) ---
  var SVG = {
    chat: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3C7 3 3 6.6 3 11c0 2.2 1 4.2 2.7 5.6-.1 1-.5 2.1-1.4 3 1.7-.1 3.1-.7 4.1-1.4 1.1.4 2.3.7 3.6.7 5 0 9-3.6 9-7.9S17 3 12 3z"></path></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"></path><circle cx="19" cy="5" r="1.6"></circle></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9.2"></circle><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.9c-.8.35-1 .9-1 1.7"></path><circle cx="12" cy="16.8" r="1.15" fill="currentColor" stroke="none"></circle></svg>',
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
      var img = document.createElement("img");
      img.src = String(d.avatarImage);
      img.alt = "";
      img.style.cssText = "width:" + size + "px;height:" + size + "px;border-radius:35%;object-fit:cover;display:block";
      return img;
    }
    var span = document.createElement("span");
    span.style.cssText = "width:" + size + "px;height:" + size + "px;display:block";
    span.innerHTML = SVG[d.icon] || SVG.chat;
    return span;
  }

  function setIcon(container, d, size) {
    container.textContent = "";
    container.appendChild(iconNode(d, size));
  }

  // --- UI ---
  var ui = {};
  var SIZES = { sm: 48, md: 58, lg: 68 };

  // Polices SANS chargement externe (perf/RGPD) : stacks système uniquement.
  var FONTS = {
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
  var I18N = {
    fr: {
      online_tree: "En ligne · Menu guidé",
      online_ai: "En ligne · Mode IA",
      advisor_online: "Conseiller en ligne",
      advisor_wait: "En attente d'un conseiller…",
      close: "Fermer",
      send: "Envoyer",
      open_chat: "Ouvrir le chat",
      degraded_banner: " Assistant IA momentanément indisponible — le menu guidé reste actif.",
      placeholder: "Écrivez votre message…",
      placeholder_advisor: "Écrivez au conseiller…",
      placeholder_degraded: "Réessayez un peu plus tard",
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
    },
    en: {
      online_tree: "Online · Guided menu",
      online_ai: "Online · AI mode",
      advisor_online: "Advisor online",
      advisor_wait: "Waiting for an advisor…",
      close: "Close",
      send: "Send",
      open_chat: "Open chat",
      degraded_banner: " AI assistant temporarily unavailable — the guided menu is still active.",
      placeholder: "Type your message…",
      placeholder_advisor: "Write to the advisor…",
      placeholder_degraded: "Please try again later",
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
    },
  };
  var LOCALE = "fr"; // résolu au bootstrap (avant build) depuis design.locale
  function t(key) {
    return (I18N[LOCALE] && I18N[LOCALE][key]) || I18N.fr[key] || "";
  }

  function css(d) {
    var brand = safeColor(d.primaryColor, "#0d9488");
    var color2 = d.secondaryColor ? safeColor(d.secondaryColor, brand) : null;
    var bg = color2 ? "linear-gradient(135deg," + brand + "," + color2 + ")" : brand;
    var side = d.position === "left" ? "left" : "right";
    var bubble = SIZES[d.size] || SIZES.md;
    var R = safeInt(d.borderRadius, 0, 40, 16);
    var r14 = Math.min(R, 14);
    // Personnalisation étendue — whitelists/bornes LOCALES (défense en
    // profondeur : le widget ne fait jamais confiance au serveur). Les
    // défauts reproduisent le rendu historique à l'identique.
    var font = FONTS[d.font] || FONTS.system;
    var ox = safeInt(d.offsetX, 0, 120, 18);
    var oy = safeInt(d.offsetY, 0, 120, 18);
    var dark = d.darkMode === true;
    var soft = d.headerStyle === "soft";
    var square = d.bubbleStyle === "square";
    var compact = d.density === "compact";
    // Surfaces du panneau : palette sombre si darkMode, littéraux actuels sinon.
    // Bulle user et options : brand inchangé (contraste OK sur les deux fonds).
    var panelBg = dark ? "#101816" : "#fff";
    var msgsBg = dark ? "#0c1311" : "#fafbfb";
    var botBg = dark ? "#1b2624" : "#fff";
    var botBorder = dark ? "#233330" : "#e6eae8";
    var botText = dark ? "#e8efed" : "#1d2b27";
    var lineBorder = dark ? "#233330" : "#e9edec";
    var inputBg = dark ? "#18221f" : "#fff";
    var inputBorder = dark ? "#233330" : "#dde3e1";
    var mutedText = dark ? "#9fb0ab" : "#5f7873";
    // En-tête : solid = couleur de marque (actuel) ; soft = clair (surface)
    var headText = soft ? (dark ? "#e8efed" : "#1d2b27") : "#fff";
    var panelPos = INLINE
      ? "position:fixed;inset:0;width:100%;height:100%;max-height:none;border-radius:0;"
      : "position:fixed;bottom:" + (bubble + oy + 12) + "px;" + side + ":" + ox + "px;width:338px;max-width:calc(100vw - 36px);height:" + (compact ? 420 : 460) + "px;max-height:70vh;border-radius:" + R + "px;";
    return [
      ".kc-root{font-family:" + font + "}",
      ".kc-bubble{position:fixed;bottom:" + oy + "px;" + side + ":" + ox + "px;width:" + bubble + "px;height:" + bubble + "px;border-radius:50%;",
      "border:" + (d.bordered ? "3px solid rgba(255,255,255,.95)" : "none") + ";cursor:pointer;background:" + bg + ";color:#fff;",
      "box-shadow:0 8px 26px rgba(10,30,25,.3);display:grid;place-items:center;z-index:2147483000;",
      "transition:transform .18s ease;padding:0}",
      ".kc-bubble:hover{transform:scale(1.07)}.kc-bubble.open{transform:scale(.92)}",
      ".kc-bubble svg{width:" + Math.round(bubble * .44) + "px;height:" + Math.round(bubble * .44) + "px}",
      // Pilule du lanceur (launcherText non vide, mode flottant uniquement)
      ".kc-bubble-pill{width:auto;border-radius:99px;padding:0 16px 0 12px;display:flex;align-items:center;gap:8px}",
      ".kc-bubble-label{font-size:13px;font-weight:700;white-space:nowrap}",
      ".kc-badge{position:absolute;top:-2px;right:-2px;width:19px;height:19px;border-radius:99px;background:#e74c3c;",
      "color:#fff;font-size:11px;font-weight:800;display:grid;place-items:center;border:2px solid #fff}",
      ".kc-panel{" + panelPos + "background:" + panelBg + ";box-shadow:0 18px 60px rgba(10,30,25,.22),0 2px 8px rgba(10,30,25,.08);",
      "display:none;flex-direction:column;overflow:hidden;z-index:2147483000;border:1px solid " + (dark ? "#233330" : "rgba(0,0,0,.06)") + "}",
      ".kc-panel.open{display:flex}",
      ".kc-head{background:" + (soft ? panelBg : bg) + ";color:" + headText + ";padding:13px 15px;display:flex;align-items:center;gap:10px" + (soft ? ";border-bottom:1px solid " + lineBorder : "") + "}",
      ".kc-head-ico{width:34px;height:34px;border-radius:10px;background:" + (soft ? bg : "rgba(255,255,255,.18)") + ";color:#fff;display:grid;place-items:center;overflow:hidden;flex-shrink:0}",
      ".kc-head-ico svg{width:19px;height:19px}",
      ".kc-head-name{font-weight:700;font-size:14.5px;line-height:1.2}",
      ".kc-head-sub{font-size:11px;opacity:.85;display:flex;align-items:center;gap:5px}",
      ".kc-dot{width:7px;height:7px;border-radius:9px;background:#7CF5C8;display:inline-block}",
      ".kc-mode{font-size:9.5px;font-weight:800;letter-spacing:.6px;padding:3px 8px;border-radius:99px;text-transform:uppercase;"
        + (soft ? "border:1.5px solid " + brand + ";color:" + brand + ";background:transparent" : "background:rgba(255,255,255,.2)") + "}",
      ".kc-x{background:none;border:none;color:" + headText + ";cursor:pointer;font-size:18px;line-height:1;padding:4px;opacity:.85}",
      ".kc-degraded{background:#fdf3e0;border-bottom:1px solid #ecd6a8;color:#8a5a0a;font-size:11.5px;padding:7px 13px;display:flex;gap:7px;align-items:center}",
      ".kc-msgs{flex:1;overflow-y:auto;padding:" + (compact ? "10px" : "14px 13px") + ";display:flex;flex-direction:column;gap:" + (compact ? 6 : 9) + "px;background:" + msgsBg + "}",
      ".kc-row{display:flex}.kc-row.user{justify-content:flex-end}",
      ".kc-msg{max-width:82%;padding:" + (compact ? "7px 10px" : "9px 12px") + ";font-size:" + (compact ? "12.5" : "13.5") + "px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word}",
      ".kc-row.bot .kc-msg{border-radius:" + (square ? "8px" : "4px " + r14 + "px " + r14 + "px " + r14 + "px") + ";background:" + botBg + ";color:" + botText + ";border:1px solid " + botBorder + ";box-shadow:0 1px 2px rgba(0,0,0,.04)}",
      ".kc-row.user .kc-msg{border-radius:" + (square ? "8px" : r14 + "px " + r14 + "px 4px " + r14 + "px") + ";background:" + brand + ";color:#fff}",
      ".kc-ai-tag{font-size:9.5px;font-weight:800;letter-spacing:.5px;color:" + brand + ";margin-bottom:3px}",
      // Tag « Conseiller » (live chat) : même gabarit que le tag IA
      ".kc-human-tag{font-size:9.5px;font-weight:800;letter-spacing:.5px;color:" + brand + ";margin-bottom:3px}",
      // CSAT : pouces discrets SOUS la bulle assistant (élément séparé de
      // .kc-msg — aucun texte ajouté aux bulles, contrat e2e)
      ".kc-rate{display:flex;gap:2px;margin:-5px 0 0 4px}",
      ".kc-rate button{background:none;border:none;cursor:pointer;color:" + mutedText + ";padding:2px;line-height:0;opacity:.7}",
      ".kc-rate button:hover{opacity:1}",
      ".kc-rate button svg{width:13px;height:13px}",
      ".kc-rate button.kc-on{color:" + brand + ";opacity:1}",
      ".kc-opts{display:flex;flex-wrap:wrap;gap:7px;margin-top:2px}",
      ".kc-opt{font-family:inherit;font-size:" + (compact ? "11.5" : "12.5") + "px;font-weight:600;padding:" + (compact ? "6px 10px" : "8px 12px") + ";white-space:nowrap;border-radius:" + (square ? "10px" : "99px") + ";",
      "border:1.5px solid " + brand + ";background:#fff;color:" + brand + ";cursor:pointer;transition:background .15s,color .15s}",
      ".kc-opt:hover{background:" + brand + ";color:#fff}",
      ".kc-back{align-self:flex-start;font-family:inherit;font-size:11.5px;font-weight:600;padding:5px 10px;border-radius:99px;",
      "border:1px solid #d8dedc;background:#fff;color:#5f7873;cursor:pointer}",
      ".kc-typing{display:flex}.kc-typing>div{padding:10px 14px;border-radius:4px 14px 14px 14px;background:" + botBg + ";border:1px solid " + botBorder + ";display:flex;gap:4px;align-items:center}",
      ".kc-td{width:6px;height:6px;border-radius:9px;background:#b9c4c0;display:inline-block;animation:kertiosBlink 1.2s infinite}",
      ".kc-td:nth-child(2){animation-delay:.18s}.kc-td:nth-child(3){animation-delay:.36s}",
      ".kc-typing.wave .kc-td{background:" + brand + ";animation:kertiosWave 1s infinite ease-in-out}",
      ".kc-typing.wave .kc-td:nth-child(2){animation-delay:.14s}.kc-typing.wave .kc-td:nth-child(3){animation-delay:.28s}",
      ".kc-typing.pulse .kc-td{width:10px;height:10px;background:" + brand + ";animation:kertiosPulse 1s infinite ease-in-out}",
      ".kc-typing.pulse .kc-td:nth-child(2),.kc-typing.pulse .kc-td:nth-child(3){display:none}",
      "@keyframes kertiosBlink{0%,80%,100%{opacity:.35}40%{opacity:1}}",
      "@keyframes kertiosWave{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-5px)}}",
      "@keyframes kertiosPulse{0%,100%{transform:scale(.7);opacity:.5}50%{transform:scale(1.15);opacity:1}}",
      ".kc-inputrow{border-top:1px solid " + lineBorder + ";padding:10px;display:flex;gap:8px;background:" + panelBg + "}",
      ".kc-input{flex:1;font-family:inherit;font-size:13.5px;padding:10px 13px;border-radius:99px;border:1px solid " + inputBorder + ";",
      "outline:none;background:" + inputBg + ";color:" + botText + ";min-width:0}",
      ".kc-input:disabled{background:" + (dark ? "#0c1311" : "#f4f6f5") + "}",
      ".kc-send{width:40px;height:40px;border-radius:99px;border:none;cursor:pointer;background:" + brand + ";color:#fff;",
      "display:grid;place-items:center;flex-shrink:0;transition:background .15s}",
      ".kc-send:disabled{background:#e3e8e6;cursor:default}",
      ".kc-powered{text-align:center;font-size:10px;color:" + (dark ? "#6b7a76" : "#9aa7a3") + ";padding:0 0 7px;background:" + panelBg + "}",
      ".kc-powered b{font-weight:700;color:#0d9488}",
      // Formulaire de contact (noeud d'arbre type "lead")
      ".kc-lead{background:" + botBg + ";border:1px solid " + botBorder + ";border-radius:" + (square ? 10 : r14) + "px;padding:12px;display:flex;flex-direction:column;gap:6px;max-width:86%;box-shadow:0 1px 2px rgba(0,0,0,.04)}",
      ".kc-lead-label{font-size:11px;font-weight:700;color:" + mutedText + "}",
      ".kc-lead-input{font-family:inherit;font-size:13px;padding:8px 11px;border-radius:10px;border:1px solid " + inputBorder + ";outline:none;background:" + inputBg + ";color:" + botText + ";resize:vertical}",
      ".kc-lead-input:focus{border-color:" + brand + "}",
      ".kc-lead-send{font-family:inherit;font-size:13px;font-weight:700;padding:9px;border-radius:99px;border:none;cursor:pointer;background:" + brand + ";color:#fff;margin-top:4px}",
      ".kc-lead-send:disabled{background:#e3e8e6;cursor:default}",
      ".kc-lead-err{font-size:11.5px;color:#c0392b}",
      // Overlay rendez-vous (noeud d'arbre type "appointment")
      ".kc-overlay{position:absolute;inset:0;background:" + panelBg + ";z-index:5;display:flex;flex-direction:column}",
      ".kc-overlay-head{display:flex;align-items:center;justify-content:space-between;padding:10px 13px;border-bottom:1px solid " + lineBorder + ";font-size:13px;font-weight:700;color:" + botText + "}",
      ".kc-overlay-x{background:none;border:none;cursor:pointer;color:" + mutedText + ";padding:2px;width:24px;height:24px;display:grid;place-items:center}",
      ".kc-overlay-x svg{width:14px;height:14px}",
      ".kc-overlay iframe{flex:1;border:none;width:100%}",
      ".kc-overlay-link{display:block;text-align:center;font-size:12px;font-weight:600;color:" + brand + ";padding:9px;text-decoration:underline}",
    ].join("");
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function build(d) {
    var style = document.createElement("style");
    style.textContent = css(d);
    document.head.appendChild(style);

    var root = el("div", "kc-root");
    document.body.appendChild(root);
    ui.root = root;

    // Panneau
    ui.panel = el("div", "kc-panel");
    var head = el("div", "kc-head");
    var hIco = el("div", "kc-head-ico");
    setIcon(hIco, d, d.icon === "image" && d.avatarImage ? 34 : 19);
    head.appendChild(hIco);
    var hMid = el("div");
    hMid.style.cssText = "flex:1;min-width:0";
    hMid.appendChild(el("div", "kc-head-name", d.title || "Assistant"));
    ui.headSub = el("div", "kc-head-sub");
    ui.headSub.appendChild(el("span", "kc-dot"));
    ui.headSubText = el("span", null, t("online_tree"));
    ui.headSub.appendChild(ui.headSubText);
    hMid.appendChild(ui.headSub);
    head.appendChild(hMid);
    ui.modeBadge = el("span", "kc-mode", "TREE");
    head.appendChild(ui.modeBadge);
    if (!INLINE) {
      var x = el("button", "kc-x", "×");
      x.setAttribute("aria-label", t("close"));
      x.addEventListener("click", toggle);
      head.appendChild(x);
    }
    ui.panel.appendChild(head);

    ui.degradedBanner = el("div", "kc-degraded");
    // Contenu 100% statique (constantes SVG + dictionnaire I18N du script)
    ui.degradedBanner.innerHTML = SVG.alert + t("degraded_banner");
    ui.degradedBanner.style.display = "none";
    ui.panel.appendChild(ui.degradedBanner);

    ui.msgs = el("div", "kc-msgs");
    ui.panel.appendChild(ui.msgs);

    var inputRow = el("div", "kc-inputrow");
    ui.input = document.createElement("input");
    ui.input.className = "kc-input";
    ui.input.maxLength = 4000;
    ui.input.placeholder = d.placeholder || t("placeholder");
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
      var powered = el("div", "kc-powered");
      powered.innerHTML = t("powered_by") + " <b>Kertios Chat</b>";
      ui.panel.appendChild(powered);
    }
    root.appendChild(ui.panel);

    // Bulle
    if (!INLINE) {
      ui.bubble = el("button", "kc-bubble");
      ui.bubble.setAttribute("aria-label", t("open_chat"));
      ui.bubbleIcon = el("span");
      setIcon(ui.bubbleIcon, d, d.icon === "image" && d.avatarImage ? Math.round((SIZES[d.size] || 58) * .58) : Math.round((SIZES[d.size] || 58) * .44));
      ui.bubble.appendChild(ui.bubbleIcon);
      // launcherText : bulle -> pilule [icône + libellé] (textContent, anti-XSS)
      var lt = (typeof d.launcherText === "string" ? d.launcherText : "").slice(0, 40);
      if (lt.trim()) {
        ui.bubble.classList.add("kc-bubble-pill");
        ui.bubbleLabel = el("span", "kc-bubble-label", lt);
        ui.bubble.appendChild(ui.bubbleLabel);
      }
      ui.badge = el("span", "kc-badge", "1");
      ui.bubble.appendChild(ui.badge);
      ui.bubble.addEventListener("click", toggle);
      root.appendChild(ui.bubble);
    } else {
      state.open = true;
      ui.panel.classList.add("open");
      startSession();
    }

    updateModeUI();
  }

  function updateModeUI() {
    var human = isHuman();
    var ai = state.aiMode && !state.degraded;
    ui.headSubText.textContent = human
      ? (state.chatStatus === "human" ? t("advisor_online") : t("advisor_wait"))
      : (ai ? t("online_ai") : t("online_tree"));
    ui.modeBadge.textContent = human ? "LIVE" : (ai ? "IA" : "TREE");
    // Mode humain : saisie toujours active, même sur un bot tree/dégradé
    var canType = human || (ai && state.config.mode !== "tree");
    ui.input.disabled = !canType;
    // Bot IA pur dégradé : pas d'options à choisir, on invite à patienter
    ui.input.placeholder = human
      ? t("placeholder_advisor")
      : (canType
        ? (state.config.design.placeholder || t("placeholder"))
        : (state.degraded && state.config.mode === "ai" ? t("placeholder_degraded") : t("placeholder_pick")));
    ui.send.disabled = !canType;
    ui.degradedBanner.style.display = state.degraded ? "flex" : "none";
    // Bot tree : la rangée de saisie reste cachée au bootstrap et ne
    // s'affiche qu'APRÈS un handoff effectif (réévalué à chaque appel)
    ui.inputRow.style.display = (state.config.mode === "tree" && !human) ? "none" : "";
  }

  // tag : "ai" | "human" | null — libellé constant « Conseiller » (le serveur
  // n'expose jamais l'identité du staff).
  // msgId (optionnel) : id serveur du message assistant ai|tree -> rangée CSAT
  // (pouces) appendée SÉPARÉMENT après la row, JAMAIS dans .kc-msg (les
  // sélecteurs e2e font des toHaveText exacts sur les bulles : zéro texte
  // ajouté, SVG + title localisé uniquement). Jamais de msgId pour les
  // messages human/system (poll), locaux, d'erreur ou de trigger.
  function addMsg(role, text, tag, msgId) {
    var row = el("div", "kc-row " + role);
    var m = el("div", "kc-msg");
    if (tag === "ai") {
      var tg = el("div", "kc-ai-tag");
      tg.innerHTML = SVG.sparkSmall + t("tag_ai"); // constantes statiques
      m.appendChild(tg);
    } else if (tag === "human") {
      var th = el("div", "kc-human-tag");
      th.innerHTML = SVG.userSmall + t("tag_advisor"); // constantes statiques
      m.appendChild(th);
    }
    m.appendChild(document.createTextNode(text));
    row.appendChild(m);
    ui.msgs.appendChild(row);
    if (msgId) ui.msgs.appendChild(rateRow(msgId));
    ui.msgs.scrollTop = ui.msgs.scrollHeight;
  }

  // --- CSAT (pouce haut/bas sous les réponses assistant ai|tree) ---
  function rateRow(msgId) {
    var rate = el("div", "kc-rate");
    var current = null; // "up" | "down" (état local, le serveur écrase)
    var pending = false; // garde anti double-envoi pendant le POST
    var up, down;
    function paint() {
      up.classList.toggle("kc-on", current === "up");
      down.classList.toggle("kc-on", current === "down");
    }
    function mkBtn(kind) {
      var b = el("button");
      b.type = "button";
      b.innerHTML = SVG[kind === "up" ? "thumbUp" : "thumbDown"]; // constantes statiques
      b.title = kind === "up" ? t("rate_up") : t("rate_down");
      b.setAttribute("aria-label", b.title);
      b.addEventListener("click", function () {
        if (pending) return;
        var prev = current;
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
    var olds = ui.msgs.querySelectorAll(".kc-opts,.kc-back,.kc-lead");
    for (var i = 0; i < olds.length; i++) olds[i].remove();
  }

  function addOptions(options, apptUrl) {
    clearOptions();
    if ((options && options.length) || apptUrl) {
      var wrap = el("div", "kc-opts");
      if (apptUrl) {
        // Bouton rendez-vous : ouvre l'overlay calendrier (URL https validée)
        var rdv = el("button", "kc-opt", t("appointment"));
        rdv.addEventListener("click", function () { openAppointmentOverlay(apptUrl); });
        wrap.appendChild(rdv);
      }
      (options || []).forEach(function (o) {
        var b = el("button", "kc-opt", o.label);
        b.addEventListener("click", function () { sendNode(o.next, o.label); });
        wrap.appendChild(b);
      });
      ui.msgs.appendChild(wrap);
    }
    // Lien retour au menu en mode IA (hybride uniquement, jamais en mode humain)
    if (state.aiMode && !state.degraded && state.config.mode === "hybrid" && !isHuman()) {
      var back = el("button", "kc-back", t("back_to_menu"));
      back.addEventListener("click", backToTree);
      ui.msgs.appendChild(back);
    }
    ui.msgs.scrollTop = ui.msgs.scrollHeight;
  }

  function setTyping(on) {
    var t = ui.msgs.querySelector(".kc-typing");
    if (on && !t) {
      var anim = (state.config.design || {}).loadingAnimation || "dots";
      if (anim !== "wave" && anim !== "pulse") anim = "dots"; // whitelist (valeur libre -> className)
      var wrap = el("div", "kc-typing" + (anim !== "dots" ? " " + anim : ""));
      var inner = el("div");
      inner.appendChild(el("span", "kc-td"));
      inner.appendChild(el("span", "kc-td"));
      inner.appendChild(el("span", "kc-td"));
      wrap.appendChild(inner);
      ui.msgs.appendChild(wrap);
      ui.msgs.scrollTop = ui.msgs.scrollHeight;
    } else if (!on && t) t.remove();
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
        if (resp.refresh_token) { state.token = resp.refresh_token; delete resp.refresh_token; }
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
          // inactive) : retour SILENCIEUX au mode normal — JAMAIS le
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
    var s = resp && resp.status;
    if (!s) return;
    var wasHuman = isHuman();
    if (s === "human" || s === "human_requested") {
      state.chatStatus = s;
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
  }

  // Demande de mise en relation (enchaînée après un nœud d'arbre type
  // "handoff", ou re-demande après clôture). retry-401 UNE fois autorisé ICI :
  // la demande INITIE la relation, un re-handshake propre est acceptable.
  function requestHandoff(retried) {
    return api("/api/widget/handoff", { method: "POST", auth: true })
      .then(function (resp) {
        if (resp.refresh_token) { state.token = resp.refresh_token; delete resp.refresh_token; }
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
    if (resp.degraded) {
      state.degraded = true;
      state.aiMode = false;
    }
    // CSAT : uniquement les réponses assistant ai|tree porteuses d'un id
    // serveur (jamais human/system, jamais les bulles locales/erreurs)
    var msgId = (resp.source === "ai" || resp.source === "tree") && resp.message_id
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
      var h = new URL(url).hostname;
      return h === "calendly.com" || h.endsWith(".calendly.com")
        || h === "cal.com" || h.endsWith(".cal.com");
    } catch (e) { return false; }
  }

  function openAppointmentOverlay(url) {
    if (!/^https:\/\//.test(url)) return;
    var old = ui.panel.querySelector(".kc-overlay");
    if (old) old.remove();
    var overlay = el("div", "kc-overlay");
    var head = el("div", "kc-overlay-head");
    head.appendChild(el("span", null, t("appointment")));
    var x = el("button", "kc-overlay-x");
    x.innerHTML = SVG.close; // constante statique
    x.setAttribute("aria-label", t("close"));
    x.addEventListener("click", function () { overlay.remove(); });
    head.appendChild(x);
    overlay.appendChild(head);
    if (embeddableCalendarHost(url)) {
      var frame = document.createElement("iframe");
      frame.src = url; // posé en PROPRIÉTÉ après validation, jamais en HTML
      frame.title = t("appointment_title");
      overlay.appendChild(frame);
    }
    var link = document.createElement("a");
    link.href = url; // propriété
    link.target = "_blank";
    link.rel = "noopener";
    link.className = "kc-overlay-link";
    link.textContent = t("open_new_tab");
    overlay.appendChild(link);
    ui.panel.appendChild(overlay);
  }

  // --- Formulaire de contact (noeud "lead") ---
  var LEAD_LABELS = { email: "Email", name: "Nom", phone: "Téléphone", message: "Message" };
  var LEAD_MAXLEN = { email: 254, name: 120, phone: 40, message: 2000 }; // alignés serveur

  // CSAT : POST du pouce. SANS retry-401 (contrat « jamais de re-handshake »
  // hors envoi de message : un re-handshake créerait une NOUVELLE conversation
  // et le message_id renverrait un 404 garanti — même philosophie que le
  // poll). Échec = rejet de la promesse, revert visuel silencieux côté bouton.
  function postFeedback(messageId, rating) {
    return api("/api/widget/feedback", {
      method: "POST", auth: true,
      body: { message_id: messageId, rating: rating },
    }).then(function (resp) {
      if (resp.refresh_token) { state.token = resp.refresh_token; delete resp.refresh_token; }
      return resp;
    });
  }

  // Miroir de postMessage : même retry-401 + refresh_token
  function postLead(body, retried) {
    return api("/api/widget/lead", { method: "POST", auth: true, body: body })
      .then(function (resp) {
        if (resp.refresh_token) { state.token = resp.refresh_token; delete resp.refresh_token; }
        return resp;
      })
      .catch(function (err) {
        if (err.status === 401 && !retried) {
          return openSession().then(function () { return postLead(body, true); });
        }
        throw err;
      });
  }

  function addLeadForm(fields, options) {
    clearOptions();
    fields = (fields || ["email", "message"]).filter(function (f) { return LEAD_LABELS[f]; });
    if (fields.indexOf("email") === -1) fields.unshift("email");
    var form = el("div", "kc-lead");
    var inputs = {};
    fields.forEach(function (f) {
      form.appendChild(el("label", "kc-lead-label", t("lead_" + f)));
      var input;
      if (f === "message") {
        input = document.createElement("textarea");
        input.rows = 3;
      } else {
        input = document.createElement("input");
        input.type = f === "email" ? "email" : "text";
      }
      input.className = "kc-lead-input";
      input.maxLength = LEAD_MAXLEN[f];
      if (f === "email") input.required = true;
      inputs[f] = input;
      form.appendChild(input);
    });
    var err = el("div", "kc-lead-err");
    err.style.display = "none";
    form.appendChild(err);
    var submit = el("button", "kc-lead-send", t("send"));
    submit.addEventListener("click", function () {
      if (state.busy) return;
      var email = (inputs.email.value || "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        err.textContent = t("lead_invalid_email");
        err.style.display = "block";
        return;
      }
      err.style.display = "none";
      var body = { email: email };
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
    return api("/api/widget/message", { method: "POST", auth: true, body: body })
      .then(function (resp) {
        // Sliding session : le serveur renouvelle le JWT quand l'expiration approche
        if (resp.refresh_token) { state.token = resp.refresh_token; delete resp.refresh_token; }
        return resp;
      })
      .catch(function (err) {
        if (err.status === 401 && !retried) {
          // Re-handshake silencieux : on ignore le message d'accueil (first)
          // pour ne pas l'empiler sur la conversation, et on rejoue la requête.
          return openSession().then(function () { return postMessage(body, true); });
        }
        throw err;
      });
  }

  function sendNode(next, label) {
    if (state.busy) return;
    state.busy = true;
    addMsg("user", label.replace(/^[^\p{L}\p{N}↩]*\s*/u, ""));
    clearOptions();

    if (next === "__ai__") {
      state.busy = false;
      if (state.config.mode === "tree" || state.degraded) {
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
      .catch(function () { });
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
    var text = ui.input.value.trim();
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

  function startSession() {
    if (state.token || state.busy) return;
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

  function toggle() {
    // Toute interaction avec le widget (ouverture OU fermeture) désarme
    // définitivement les triggers proactifs de la page
    state.interacted = true;
    state.open = !state.open;
    ui.panel.classList.toggle("open", state.open);
    if (ui.bubble) {
      ui.bubble.classList.toggle("open", state.open);
      var dsg = state.config.design;
      if (state.open) {
        ui.bubbleIcon.innerHTML = SVG.close; // constante statique
        // Pilule (launcherText) : ouvert -> croix seule, redevient un rond
        if (ui.bubbleLabel) {
          ui.bubbleLabel.style.display = "none";
          ui.bubble.classList.remove("kc-bubble-pill");
        }
      } else {
        setIcon(ui.bubbleIcon, dsg, dsg.icon === "image" && dsg.avatarImage
          ? Math.round((SIZES[dsg.size] || 58) * .58)
          : Math.round((SIZES[dsg.size] || 58) * .44));
        if (ui.bubbleLabel) {
          ui.bubbleLabel.style.display = "";
          ui.bubble.classList.add("kc-bubble-pill");
        }
      }
      if (state.open && ui.badge) { ui.badge.style.display = "none"; }
    }
    if (state.open) {
      cancelTriggers(); // panneau ouvert : plus aucun tir possible
      startSession();
      maybeStartPolling(); // reprise du live chat si une demande est en cours
    } else {
      stopPolling(); // panneau fermé : arrêt propre du polling
    }
  }

  // --- Triggers proactifs ---
  // Évalués 100% côté client (timer, profondeur de scroll, intention de
  // sortie, motif d'URL) à partir du bootstrap sanitisé — AUCUN appel serveur
  // au déclenchement : le tir ouvre le panneau (toggle -> startSession) puis
  // affiche le message en bulle locale. UN SEUL tir par chargement de page
  // (le premier annule les autres), jamais si le panneau est ouvert ou si le
  // visiteur a déjà interagi. Dédup once_per_session via sessionStorage
  // kc_triggers (même try/catch que kc_journey). Jamais initialisés en mode
  // INLINE (panneau déjà ouvert, scroll/souris de la page parente invisibles).
  var triggerCleanups = [];

  function firedTriggers() {
    try {
      var list = JSON.parse(sessionStorage.getItem("kc_triggers") || "[]");
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }

  function markTriggerFired(id) {
    try {
      var list = firedTriggers();
      if (list.indexOf(id) === -1) list.push(id);
      sessionStorage.setItem("kc_triggers", JSON.stringify(list));
    } catch (e) { /* sessionStorage indisponible (navigation privée…) */ }
  }

  function cancelTriggers() {
    for (var i = 0; i < triggerCleanups.length; i++) {
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
      var parts = pattern.split("*");
      for (var i = 0; i < parts.length; i++) {
        parts[i] = parts[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
      return new RegExp("^" + parts.join(".*") + "$").test(path);
    } catch (e) { return false; }
  }

  function initTriggers(triggers) {
    if (!triggers || !triggers.length) return;
    var fired = firedTriggers();
    triggers.forEach(function (trg) {
      var id = String(trg.type) + ":" + String(trg.value == null ? "" : trg.value);
      if (trg.once_per_session !== false && fired.indexOf(id) !== -1) return;
      if (trg.type === "time_on_page") {
        var timer = setTimeout(function () { fireTrigger(trg, id); },
          Math.max(1, trg.value | 0) * 1000);
        triggerCleanups.push(function () { clearTimeout(timer); });
      } else if (trg.type === "scroll_depth") {
        var onScroll = function () {
          var h = document.documentElement.scrollHeight || 1;
          if ((window.scrollY + window.innerHeight) / h * 100 >= trg.value) fireTrigger(trg, id);
        };
        window.addEventListener("scroll", onScroll, { passive: true });
        triggerCleanups.push(function () { window.removeEventListener("scroll", onScroll); });
      } else if (trg.type === "exit_intent") {
        // Pas de mouseleave fiable sur mobile (pointeur grossier) : désactivé
        if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) return;
        var onLeave = function (e) { if (e.clientY <= 0) fireTrigger(trg, id); };
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
  api("/api/widget/bootstrap?key=" + encodeURIComponent(BOT_KEY))
    .then(function (config) {
      state.config = config;
      config.design = config.design || {};
      // Locale de l'UI : résolue AVANT build ('auto' = langue du navigateur,
      // anglais sinon français ; toute autre valeur retombe sur fr)
      var loc = config.design.locale;
      if (loc === "auto") {
        loc = (navigator.language || "fr").toLowerCase().indexOf("en") === 0 ? "en" : "fr";
      }
      LOCALE = loc === "en" ? "en" : "fr";
      build(config.design);
      // Triggers proactifs : jamais en INLINE (panneau déjà ouvert, les
      // scroll/mouseleave de la page parente sont invisibles depuis l'iframe)
      if (!INLINE) initTriggers(config.triggers || []);
      // Live chat : onglet caché -> arrêt du polling, visible -> reprise.
      // Enregistré UNE fois après build ; en inline (panneau toujours ouvert)
      // c'est le seul interrupteur du polling.
      document.addEventListener("visibilitychange", function () {
        if (document.hidden) stopPolling();
        else maybeStartPolling();
      });
    })
    .catch(function (err) {
      console.warn("[kertios-chat]", err.message);
    });
})();
