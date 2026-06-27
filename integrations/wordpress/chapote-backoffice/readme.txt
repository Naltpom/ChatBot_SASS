=== Chapote Chatbot ===
Contributors: chapote
Tags: chatbot, chat, support, assistant, ai
Requires at least: 5.8
Tested up to: 7.0
Requires PHP: 7.4
Stable tag: 2.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Manage your Chapote chatbots from WordPress: connect, manage bots, edit appearance, pay (Stripe), and enable the widget on your site.

== Description ==

Chapote Chatbot turns your WordPress admin into a lightweight dashboard for your Chapote account. From the "Chapote" menu in wp-admin you can:

* Sign in with Chapote ("Sign in with Chapote", OAuth Authorization Code + PKCE — you are redirected to the Chapote consent screen; no Chapote password is entered or stored in WordPress).
* Manage your bots: list, create, and edit the appearance with a live preview.
* Pay and subscribe through hosted Stripe Checkout (redirect), then manage the plan or cancel.
* Enable the widget per bot and target the pages where it appears (handled entirely in WordPress, in local options).
* Improve SEO with server-rendered output the JavaScript widget cannot provide: an optional "Powered by Chapote" link and a schema.org FAQ (FAQPage, JSON-LD) eligible for rich results.

= External service (required) =

**This plugin requires a Chapote account, a paid third-party service hosted at https://chapote.fr.** Without an active Chapote account the plugin cannot work: it is a thin interface over the Chapote account API and performs no chatbot processing locally.

**Communication with Chapote.** The plugin communicates with chapote.fr (address configurable in the settings) to:

* sign in: an OAuth exchange (Authorization Code + PKCE, S256) opens the Chapote consent screen in your browser, then WordPress exchanges the authorization code for an access token, server to server;
* manage your bots: read the list of your bots, create a bot, update its appearance, open a Stripe Checkout session, and read the billing catalog.

**Data sent to Chapote.**

* On sign-in: the OAuth authorization (no Chapote credentials are entered in WordPress); the email and name of the connected account are then read, only to be displayed in the interface.
* When managing a bot: its configuration (name, appearance, subscription) and your site URL.
* On the public side: on pages where you enable the widget, the **visitor's** browser loads the `/widget.js` script from the configured Chapote domain and sends Chapote the conversation messages and associated technical data (e.g. IP address, user agent) in order to receive the chatbot's answers.

**Data that never leaves WordPress.** The widget activation state and page targeting are stored locally in WordPress and are never sent to Chapote.

Terms of service: https://chapote.fr/legal/cgu — Privacy policy: https://chapote.fr/legal/confidentialite

== Installation ==

1. Upload the plugin to `wp-content/plugins/` and activate it, or install it from the ZIP via Plugins > Add New > Upload Plugin.
2. Open the "Chapote" menu in the WordPress admin.
3. Click "Sign in with Chapote" and approve access on the Chapote consent screen.
4. Manage your bots, then enable the widget on the pages of your choice.

Requires an active Chapote account (https://chapote.fr), PHP 7.4+ with the OpenSSL extension (used to encrypt the access token at rest).

== Frequently Asked Questions ==

= Do I need a Chapote account? =

Yes. This plugin is an interface over the Chapote service (chapote.fr) and requires an active account. All chatbot processing happens on Chapote, not in WordPress.

= Is my access token exposed to the browser? =

No. The token is stored encrypted (AES-256-GCM) on the server and is never sent to the page JavaScript. The browser talks to a WordPress REST proxy (protected by `manage_options` capability and a nonce), which relays calls to Chapote.

= Where does the widget load from? =

On the pages where you enable it, the visitor's browser loads the official widget script (`widget.js`) from your configured Chapote domain.

= Does activating a bot on my site require a paid plan? =

No, the widget serves any usable bot; a free bot works with the free reply quota. Billing and modules are managed on Chapote.

== Screenshots ==

1. "My bots": list of your bots with the "On the site" toggle per bot.
2. Managing a bot: header display toggle and the "Page targeting" tab.
3. SEO tab: optional "Powered by" link and the FAQ editor (schema.org structured data).

== Changelog ==

= 2.1.0 =
* SEO: new "SEO" tab. Optional "Powered by Chapote" link (off by default) and schema.org FAQ structured data (FAQPage, JSON-LD) rendered server-side, eligible for rich results.
* Automatic updates for installations hosted outside WordPress.org (version check and install from the WordPress admin).

= 2.0.0 =
* Full back-office in WordPress, a thin interface over the Chapote account API.
* "Sign in with Chapote" via OAuth Authorization Code + PKCE (S256); token encrypted server-side (AES-256-GCM), never exposed to the browser.
* Bot management: list, create, edit appearance with a live preview.
* Payment and subscription via hosted Stripe Checkout (redirect), with consent to immediate execution; plan change and cancellation.
* Per-bot widget activation and page targeting (entirely in WordPress, local options).
* REST proxy (namespace `chapote-bo/v1`) protected by `manage_options` + nonce; external services disclosure and GDPR privacy content; full cleanup on uninstall.

== Upgrade Notice ==

= 2.1.0 =
Adds the SEO tab (optional link + schema.org FAQ) and automatic updates outside WordPress.org.

= 2.0.0 =
Rebuilt as a full back-office: "Sign in with Chapote", bot management, appearance, hosted Stripe payment, and widget activation/targeting. Requires a Chapote account and PHP 7.4+ with OpenSSL.
