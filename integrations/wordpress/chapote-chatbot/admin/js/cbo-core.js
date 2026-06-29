/**
 * Chapote Chatbot — primitives partagées (window.CBOCore).
 *
 * EXTRAIT d'admin.js : ces helpers sont réellement génériques et consommés à la
 * fois par le back-office (admin.js) ET le wizard d'onboarding (onboarding.js).
 * Aucune étape de build : ES5/ES2015 prudent, servi tel quel.
 *
 * IMPORTANT — point de régression unique de l'extraction : les signatures sont
 * IDENTIQUES à l'ancienne version interne d'admin.js. Le seul couplage retiré est
 * la réaction à une session morte (401) : elle est déléguée au hook
 * CBOCore.onAuthLost, posé par admin.js (sinon no-op). Tout le HTML est construit
 * via createElement (textNode) pour neutraliser toute injection.
 */
(function () {
  'use strict';

  var CFG = window.CHAPOTE_BO || {};

  /* ------------------------------------------------------------------ DOM */

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

  // Identifiant unique stable pour associer <label for> / id et lier ARIA.
  var _uid = 0;
  function uid(p) { _uid += 1; return (p || 'cbo') + '-' + _uid; }

  // Champ « label + contrôle unique » : associe explicitement <label for> à l'id.
  function fieldFor(labelText, control) {
    var id = control.id || uid('cbo-f');
    control.id = id;
    return h('div', { class: 'cbo-field' }, h('label', { for: id, text: labelText }), control);
  }
  // Champ « label + groupe de cases/radios » : role group/radiogroup nommé.
  function fieldGroup(labelText, groupNode, role) {
    var id = uid('cbo-lg');
    groupNode.setAttribute('role', role || 'group');
    groupNode.setAttribute('aria-labelledby', id);
    return h('div', { class: 'cbo-field' }, h('label', { id: id, text: labelText }), groupNode);
  }
  // Message d'état/chargement annoncé aux lecteurs d'écran (région live polie).
  function loadingNote(text) {
    return h('p', { class: 'cbo-muted', role: 'status', 'aria-live': 'polite', text: text || 'Chargement…' });
  }
  // Synchronise aria-checked d'un interrupteur (role=switch) sur l'état réel.
  function syncSwitch(el) { el.setAttribute('aria-checked', el.checked ? 'true' : 'false'); }

  /* -------------------------------------------------------------- format */

  function euros(cents) {
    try { return (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }); }
    catch (e) { return (cents / 100).toFixed(2) + ' €'; }
  }

  // Couleur HEX sûre (#abc ou #aabbcc) avant injection en style inline : toute
  // valeur non conforme retombe sur la couleur par défaut.
  var HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  function hexColor(v, fallback) {
    return (typeof v === 'string' && HEX_RE.test(v)) ? v : fallback;
  }

  // Extrait un message d'erreur AFFICHABLE d'une réponse {status, data} en
  // propageant la cause réelle (contrat {detail, code, message}). On ne retient
  // que des CHAÎNES (jamais un objet/stack) ; un `error` machine est mappé en FR.
  function apiMsg(res, fallback) {
    var d = (res && res.data) || {};
    if (typeof d.message === 'string' && d.message) return d.message;
    if (typeof d.detail === 'string' && d.detail) return d.detail;
    if (typeof d.error === 'string' && d.error) {
      var FR = {
        rate_limited: 'Trop de requêtes. Patientez quelques instants, puis réessayez.',
        not_connected: 'Vous n’êtes pas connecté à Chapote.',
        session_expired: 'Session expirée. Reconnectez-vous.',
        network_error: 'Connexion à Chapote impossible. Réessayez dans un instant.',
        invalid_grant: 'Lien de connexion expiré ou déjà utilisé. Relancez la connexion.',
        crypto_unavailable: 'Stockage chiffré indisponible sur ce serveur (OpenSSL requis).'
      };
      return FR[d.error] || fallback;
    }
    return fallback;
  }

  /* --------------------------------------------------------------- proxy */

  // Appel du proxy REST WordPress (jamais Chapote en direct). Le token reste
  // côté serveur. Une session morte (401) déclenche le hook onAuthLost (admin.js
  // y bascule en « déconnecté ») sans coupler ce module à l'état du back-office.
  function call(method, path, body) {
    return fetch(CFG.restBase + path, {
      method: method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': CFG.nonce },
      body: body != null ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401 && data && (data.error === 'session_expired' || data.error === 'not_connected')) {
          if (typeof CBOCore.onAuthLost === 'function') { try { CBOCore.onAuthLost(); } catch (e) {} }
        }
        return { status: res.status, ok: res.ok, data: data || {} };
      });
    }).catch(function () {
      // Échec réseau (hors-ligne, DNS, CORS, timeout) ou JSON illisible : on ne
      // laisse JAMAIS la promesse pendre — chaque appelant reçoit une réponse
      // synthétique non-ok et retombe dans sa branche d'échec.
      return { status: 0, ok: false, data: { error: 'network_error' } };
    });
  }

  /* ---------------------------------------------------- aperçu du widget */

  // Icônes SVG du vrai widget (tracés repris de widget.js) construites sans
  // innerHTML (createElementNS) -> aucune surface d'injection.
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
  // widget.js). Toutes les couleurs passent par hexColor() avant injection inline.
  // Affiche la fenêtre OUVERTE + le lanceur fermé (comme sur le site).
  function renderPreview(node, d, botName) {
    clear(node);
    var primary = hexColor(d.primaryColor, '#0d9488');
    var secondary = hexColor(d.secondaryColor, primary);
    var brandBg = (d.secondaryColor && secondary !== primary)
      ? 'linear-gradient(135deg,' + primary + ',' + secondary + ')'
      : primary;
    var dark = d.darkMode === true;
    var pos = (d.position === 'left') ? 'left' : 'right';
    var size = (d.size === 'sm' || d.size === 'lg') ? d.size : 'md';

    var panel = h('div', { class: 'cbo-wp cbo-pos-' + pos + ' cbo-size-' + size + (dark ? ' cbo-wp-dark' : '') });

    panel.appendChild(h('div', { class: 'cbo-wp-head', style: 'background:' + brandBg },
      avatarNode(d, 'cbo-wp-avatar'),
      h('div', { class: 'cbo-wp-headmid' },
        h('span', { class: 'cbo-wp-title', text: d.title || botName || 'Assistant' }),
        h('span', { class: 'cbo-wp-status' }, h('span', { class: 'cbo-wp-dot' }), h('span', { text: 'En ligne' }))
      ),
      h('span', { class: 'cbo-wp-close', text: '×' })
    ));

    panel.appendChild(h('div', { class: 'cbo-wp-body' },
      h('div', { class: 'cbo-wp-msg cbo-wp-bot', text: d.welcomeMessage || 'Bonjour ! Comment puis-je vous aider ?' }),
      h('div', { class: 'cbo-wp-msg cbo-wp-user', style: 'background:' + primary, text: 'Bonjour, j’ai une question.' })
    ));

    var send = h('span', { class: 'cbo-wp-send', style: 'background:' + primary });
    send.appendChild(svgIcon(ICON_SEND));
    panel.appendChild(h('div', { class: 'cbo-wp-inputrow' },
      h('span', { class: 'cbo-wp-input', text: d.placeholder || 'Écrivez votre message…' }),
      send
    ));

    if (d.poweredBy !== false) {
      panel.appendChild(h('div', { class: 'cbo-wp-powered' }, 'Propulsé par ', h('b', { text: 'Chapote' })));
    }
    node.appendChild(panel);

    if (d.greeting === true) {
      node.appendChild(h('div', { class: 'cbo-wp-greeting cbo-pos-' + pos,
        text: d.greetingText || d.launcherText || d.title || botName || 'Une question ?' }));
    }

    var launcher = h('div', { class: 'cbo-wp-launcher cbo-pos-' + pos + (d.launcherText ? ' cbo-wp-launcher-pill' : ''),
      style: 'background:' + brandBg });
    launcher.appendChild(avatarNode(d, 'cbo-wp-launcher-ico'));
    if (d.launcherText) launcher.appendChild(h('span', { class: 'cbo-wp-launcher-txt', text: d.launcherText }));
    node.appendChild(launcher);
  }

  /* --------------------------------------------------------------- expose */

  var CBOCore = {
    h: h, append: append, clear: clear, uid: uid,
    fieldFor: fieldFor, fieldGroup: fieldGroup, loadingNote: loadingNote, syncSwitch: syncSwitch,
    euros: euros, hexColor: hexColor, apiMsg: apiMsg, call: call,
    renderPreview: renderPreview, svgIcon: svgIcon,
    // Hook posé par admin.js : réaction à une session morte (401). No-op sinon.
    onAuthLost: null
  };
  window.CBOCore = CBOCore;
})();
