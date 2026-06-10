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
  var INLINE = script.getAttribute("data-inline") === "true";
  var API = script.src.replace(/\/widget\.js.*$/, "");

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

  var state = { config: null, token: null, open: false, busy: false, aiMode: false, degraded: false, unread: 1 };

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
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src; s.async = true;
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
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

  function css(d) {
    var brand = d.primaryColor || "#0d9488";
    var bg = d.secondaryColor ? "linear-gradient(135deg," + brand + "," + d.secondaryColor + ")" : brand;
    var side = d.position === "left" ? "left" : "right";
    var bubble = SIZES[d.size] || SIZES.md;
    var R = typeof d.borderRadius === "number" ? d.borderRadius : 16;
    var r14 = Math.min(R, 14);
    var panelPos = INLINE
      ? "position:fixed;inset:0;width:100%;height:100%;max-height:none;border-radius:0;"
      : "position:fixed;bottom:" + (bubble + 30) + "px;" + side + ":18px;width:338px;max-width:calc(100vw - 36px);height:460px;max-height:70vh;border-radius:" + R + "px;";
    return [
      ".kc-root{font-family:'Public Sans',-apple-system,sans-serif}",
      ".kc-bubble{position:fixed;bottom:18px;" + side + ":18px;width:" + bubble + "px;height:" + bubble + "px;border-radius:50%;",
      "border:" + (d.bordered ? "3px solid rgba(255,255,255,.95)" : "none") + ";cursor:pointer;background:" + bg + ";color:#fff;",
      "box-shadow:0 8px 26px rgba(10,30,25,.3);display:grid;place-items:center;z-index:2147483000;",
      "transition:transform .18s ease;padding:0}",
      ".kc-bubble:hover{transform:scale(1.07)}.kc-bubble.open{transform:scale(.92)}",
      ".kc-bubble svg{width:" + Math.round(bubble * .44) + "px;height:" + Math.round(bubble * .44) + "px}",
      ".kc-badge{position:absolute;top:-2px;right:-2px;width:19px;height:19px;border-radius:99px;background:#e74c3c;",
      "color:#fff;font-size:11px;font-weight:800;display:grid;place-items:center;border:2px solid #fff}",
      ".kc-panel{" + panelPos + "background:#fff;box-shadow:0 18px 60px rgba(10,30,25,.22),0 2px 8px rgba(10,30,25,.08);",
      "display:none;flex-direction:column;overflow:hidden;z-index:2147483000;border:1px solid rgba(0,0,0,.06)}",
      ".kc-panel.open{display:flex}",
      ".kc-head{background:" + bg + ";color:#fff;padding:13px 15px;display:flex;align-items:center;gap:10px}",
      ".kc-head-ico{width:34px;height:34px;border-radius:10px;background:rgba(255,255,255,.18);display:grid;place-items:center;overflow:hidden;flex-shrink:0}",
      ".kc-head-ico svg{width:19px;height:19px}",
      ".kc-head-name{font-weight:700;font-size:14.5px;line-height:1.2}",
      ".kc-head-sub{font-size:11px;opacity:.85;display:flex;align-items:center;gap:5px}",
      ".kc-dot{width:7px;height:7px;border-radius:9px;background:#7CF5C8;display:inline-block}",
      ".kc-mode{font-size:9.5px;font-weight:800;letter-spacing:.6px;padding:3px 8px;border-radius:99px;background:rgba(255,255,255,.2);text-transform:uppercase}",
      ".kc-x{background:none;border:none;color:#fff;cursor:pointer;font-size:18px;line-height:1;padding:4px;opacity:.85}",
      ".kc-degraded{background:#fdf3e0;border-bottom:1px solid #ecd6a8;color:#8a5a0a;font-size:11.5px;padding:7px 13px;display:flex;gap:7px;align-items:center}",
      ".kc-msgs{flex:1;overflow-y:auto;padding:14px 13px;display:flex;flex-direction:column;gap:9px;background:#fafbfb}",
      ".kc-row{display:flex}.kc-row.user{justify-content:flex-end}",
      ".kc-msg{max-width:82%;padding:9px 12px;font-size:13.5px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word}",
      ".kc-row.bot .kc-msg{border-radius:4px " + r14 + "px " + r14 + "px " + r14 + "px;background:#fff;color:#1d2b27;border:1px solid #e6eae8;box-shadow:0 1px 2px rgba(0,0,0,.04)}",
      ".kc-row.user .kc-msg{border-radius:" + r14 + "px " + r14 + "px 4px " + r14 + "px;background:" + brand + ";color:#fff}",
      ".kc-ai-tag{font-size:9.5px;font-weight:800;letter-spacing:.5px;color:" + brand + ";margin-bottom:3px}",
      ".kc-opts{display:flex;flex-wrap:wrap;gap:7px;margin-top:2px}",
      ".kc-opt{font-family:inherit;font-size:12.5px;font-weight:600;padding:8px 12px;white-space:nowrap;border-radius:99px;",
      "border:1.5px solid " + brand + ";background:#fff;color:" + brand + ";cursor:pointer;transition:background .15s,color .15s}",
      ".kc-opt:hover{background:" + brand + ";color:#fff}",
      ".kc-back{align-self:flex-start;font-family:inherit;font-size:11.5px;font-weight:600;padding:5px 10px;border-radius:99px;",
      "border:1px solid #d8dedc;background:#fff;color:#5f7873;cursor:pointer}",
      ".kc-typing{display:flex}.kc-typing>div{padding:10px 14px;border-radius:4px 14px 14px 14px;background:#fff;border:1px solid #e6eae8;display:flex;gap:4px;align-items:center}",
      ".kc-td{width:6px;height:6px;border-radius:9px;background:#b9c4c0;display:inline-block;animation:kcBlink 1.2s infinite}",
      ".kc-td:nth-child(2){animation-delay:.18s}.kc-td:nth-child(3){animation-delay:.36s}",
      ".kc-typing.wave .kc-td{background:" + brand + ";animation:kcWave 1s infinite ease-in-out}",
      ".kc-typing.wave .kc-td:nth-child(2){animation-delay:.14s}.kc-typing.wave .kc-td:nth-child(3){animation-delay:.28s}",
      ".kc-typing.pulse .kc-td{width:10px;height:10px;background:" + brand + ";animation:kcPulse 1s infinite ease-in-out}",
      ".kc-typing.pulse .kc-td:nth-child(2),.kc-typing.pulse .kc-td:nth-child(3){display:none}",
      "@keyframes kcBlink{0%,80%,100%{opacity:.35}40%{opacity:1}}",
      "@keyframes kcWave{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-5px)}}",
      "@keyframes kcPulse{0%,100%{transform:scale(.7);opacity:.5}50%{transform:scale(1.15);opacity:1}}",
      ".kc-inputrow{border-top:1px solid #e9edec;padding:10px;display:flex;gap:8px;background:#fff}",
      ".kc-input{flex:1;font-family:inherit;font-size:13.5px;padding:10px 13px;border-radius:99px;border:1px solid #dde3e1;",
      "outline:none;background:#fff;color:#1d2b27;min-width:0}",
      ".kc-input:disabled{background:#f4f6f5}",
      ".kc-send{width:40px;height:40px;border-radius:99px;border:none;cursor:pointer;background:" + brand + ";color:#fff;",
      "display:grid;place-items:center;flex-shrink:0;transition:background .15s}",
      ".kc-send:disabled{background:#e3e8e6;cursor:default}",
      ".kc-powered{text-align:center;font-size:10px;color:#9aa7a3;padding:0 0 7px;background:#fff}",
      ".kc-powered b{font-weight:700;color:#0d9488}",
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
    ui.headSubText = el("span", null, "En ligne · Menu guidé");
    ui.headSub.appendChild(ui.headSubText);
    hMid.appendChild(ui.headSub);
    head.appendChild(hMid);
    ui.modeBadge = el("span", "kc-mode", "TREE");
    head.appendChild(ui.modeBadge);
    if (!INLINE) {
      var x = el("button", "kc-x", "×");
      x.setAttribute("aria-label", "Fermer");
      x.addEventListener("click", toggle);
      head.appendChild(x);
    }
    ui.panel.appendChild(head);

    ui.degradedBanner = el("div", "kc-degraded");
    // Contenu 100% statique (constantes SVG + texte), pas de donnée externe
    ui.degradedBanner.innerHTML = SVG.alert + " Assistant IA momentanément indisponible — le menu guidé reste actif.";
    ui.degradedBanner.style.display = "none";
    ui.panel.appendChild(ui.degradedBanner);

    ui.msgs = el("div", "kc-msgs");
    ui.panel.appendChild(ui.msgs);

    var inputRow = el("div", "kc-inputrow");
    ui.input = document.createElement("input");
    ui.input.className = "kc-input";
    ui.input.maxLength = 4000;
    ui.input.placeholder = d.placeholder || "Écrivez votre message…";
    ui.input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") sendText();
    });
    ui.send = el("button", "kc-send");
    ui.send.innerHTML = SVG.send;
    ui.send.setAttribute("aria-label", "Envoyer");
    ui.send.addEventListener("click", sendText);
    inputRow.appendChild(ui.input);
    inputRow.appendChild(ui.send);
    ui.panel.appendChild(inputRow);
    ui.inputRow = inputRow;

    if (d.poweredBy !== false) {
      var powered = el("div", "kc-powered");
      powered.innerHTML = "Propulsé par <b>Kertios Chat</b>";
      ui.panel.appendChild(powered);
    }
    root.appendChild(ui.panel);

    // Bulle
    if (!INLINE) {
      ui.bubble = el("button", "kc-bubble");
      ui.bubble.setAttribute("aria-label", "Ouvrir le chat");
      ui.bubbleIcon = el("span");
      setIcon(ui.bubbleIcon, d, d.icon === "image" && d.avatarImage ? Math.round((SIZES[d.size] || 58) * .58) : Math.round((SIZES[d.size] || 58) * .44));
      ui.bubble.appendChild(ui.bubbleIcon);
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
    var ai = state.aiMode && !state.degraded;
    ui.headSubText.textContent = "En ligne · " + (ai ? "Mode IA" : "Menu guidé");
    ui.modeBadge.textContent = ai ? "IA" : "TREE";
    var canType = ai && state.config.mode !== "tree";
    ui.input.disabled = !canType;
    ui.input.placeholder = canType ? (state.config.design.placeholder || "Écrivez votre message…") : "Choisissez une option ci-dessus";
    ui.send.disabled = !canType;
    ui.degradedBanner.style.display = state.degraded ? "flex" : "none";
    if (state.config.mode === "tree") ui.inputRow.style.display = "none";
  }

  function addMsg(role, text, isAI) {
    var row = el("div", "kc-row " + role);
    var m = el("div", "kc-msg");
    if (isAI) {
      var tag = el("div", "kc-ai-tag");
      tag.innerHTML = SVG.sparkSmall + " IA"; // constantes statiques
      m.appendChild(tag);
    }
    m.appendChild(document.createTextNode(text));
    row.appendChild(m);
    ui.msgs.appendChild(row);
    ui.msgs.scrollTop = ui.msgs.scrollHeight;
  }

  function clearOptions() {
    var olds = ui.msgs.querySelectorAll(".kc-opts,.kc-back");
    for (var i = 0; i < olds.length; i++) olds[i].remove();
  }

  function addOptions(options) {
    clearOptions();
    if (options && options.length) {
      var wrap = el("div", "kc-opts");
      options.forEach(function (o) {
        var b = el("button", "kc-opt", o.label);
        b.addEventListener("click", function () { sendNode(o.next, o.label); });
        wrap.appendChild(b);
      });
      ui.msgs.appendChild(wrap);
    }
    // Lien retour au menu en mode IA (hybride uniquement)
    if (state.aiMode && !state.degraded && state.config.mode === "hybrid") {
      var back = el("button", "kc-back", "↩ Revenir au menu");
      back.addEventListener("click", backToTree);
      ui.msgs.appendChild(back);
    }
    ui.msgs.scrollTop = ui.msgs.scrollHeight;
  }

  function setTyping(on) {
    var t = ui.msgs.querySelector(".kc-typing");
    if (on && !t) {
      var anim = (state.config.design || {}).loadingAnimation || "dots";
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

  function renderResponse(resp) {
    if (resp.degraded) {
      state.degraded = true;
      state.aiMode = false;
    }
    addMsg("bot", resp.message, resp.source === "ai");
    addOptions(resp.options);
    updateModeUI();
  }

  // --- Envoi ---
  function postMessage(body, retried) {
    return api("/api/widget/message", { method: "POST", auth: true, body: body })
      .catch(function (err) {
        if (err.status === 401 && !retried) {
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
        addMsg("bot", "Les réponses IA sont indisponibles pour le moment. Utilisez le menu ou le formulaire de contact.");
        sendNodeSilent("__root__");
        return;
      }
      state.aiMode = true;
      addMsg("bot", "Je vous écoute ! Posez votre question librement, je réponds grâce à l'IA.");
      addOptions([]);
      updateModeUI();
      ui.input.focus();
      return;
    }

    setTyping(true);
    postMessage({ node: next, page_url: pageUrl() })
      .then(renderResponse)
      .catch(function () { addMsg("bot", "Oups, une erreur est survenue. Réessayez."); })
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
    addMsg("user", "Revenir au menu");
    clearOptions();
    setTyping(true);
    postMessage({ node: "__root__", page_url: pageUrl() })
      .then(renderResponse)
      .catch(function () { addMsg("bot", "Oups, une erreur est survenue."); })
      .finally(function () { setTyping(false); state.busy = false; updateModeUI(); });
  }

  function sendText() {
    var text = ui.input.value.trim();
    if (!text || state.busy || ui.input.disabled) return;
    state.busy = true;
    addMsg("user", text);
    ui.input.value = "";
    clearOptions();
    setTyping(true);

    postMessage({ text: text, page_url: pageUrl() })
      .then(renderResponse)
      .catch(function (err) {
        addMsg("bot", err.status === 429
          ? "Vous envoyez des messages trop vite, patientez un instant."
          : "Oups, une erreur est survenue. Réessayez.");
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
          addMsg("bot", first.message || "Je vous écoute ! Posez votre question librement.");
          updateModeUI();
        } else {
          renderResponse(first);
        }
      })
      .catch(function () { addMsg("bot", "Le chat est momentanément indisponible."); })
      .finally(function () { setTyping(false); state.busy = false; });
  }

  function toggle() {
    state.open = !state.open;
    ui.panel.classList.toggle("open", state.open);
    if (ui.bubble) {
      ui.bubble.classList.toggle("open", state.open);
      var dsg = state.config.design;
      if (state.open) {
        ui.bubbleIcon.innerHTML = SVG.close; // constante statique
      } else {
        setIcon(ui.bubbleIcon, dsg, dsg.icon === "image" && dsg.avatarImage
          ? Math.round((SIZES[dsg.size] || 58) * .58)
          : Math.round((SIZES[dsg.size] || 58) * .44));
      }
      if (state.open && ui.badge) { ui.badge.style.display = "none"; }
    }
    if (state.open) startSession();
  }

  // --- Init ---
  api("/api/widget/bootstrap?key=" + encodeURIComponent(BOT_KEY))
    .then(function (config) {
      state.config = config;
      config.design = config.design || {};
      build(config.design);
    })
    .catch(function (err) {
      console.warn("[kertios-chat]", err.message);
    });
})();
