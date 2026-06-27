# Plugin WordPress « Chapote Chatbot » + banc de test local

Plugin qui pose le widget Chapote sur un site WordPress : le client colle la clé
publique `pk_…` de son bot, active, et le chat est en ligne. Aucune ligne de code
côté client, aucun secret stocké.

## Contenu

| Élément | Commité ? | Rôle |
|---|---|---|
| `chapote-chatbot/` | ✅ | Le plugin (c'est ce qu'on distribue / zippe) |
| `docker-compose.yml` | ✅ | Stack WordPress jetable pour tester en local |
| `setup.sh` | ✅ | Installe WP + active/configure le plugin sans écran d'install |
| `.gitignore` | ✅ | Empêche tout fichier WP local d'arriver dans git |
| Cœur WordPress + base | ❌ | Volumes Docker nommés — **jamais** dans le dépôt |

## Tester en local (réel, sur `localhost`)

Prérequis : Docker. L'API Chapote de dev doit tourner (`http://localhost:8001`)
pour que le bot réponde vraiment ; sinon le plugin injecte quand même la balise.

```bash
# Depuis la racine du dépôt
docker compose -f integrations/wordpress/docker-compose.yml up -d
bash integrations/wordpress/setup.sh           # install + activation + config
```

- Site : http://localhost:8080
- Admin : http://localhost:8080/wp-admin (`admin` / `admin`)
- Réglages du plugin : Réglages → Chapote Chatbot

Pour brancher votre vrai bot :

```bash
CHAPOTE_BOT_KEY=pk_votrevraiecle bash integrations/wordpress/setup.sh
```

> En dev, pensez à autoriser le domaine `localhost:8080` dans l'onglet Sécurité
> de votre bot (sauf si l'environnement de dev whiteliste déjà `localhost`).

## Vérifier que le plugin fait son travail

```bash
curl -s http://localhost:8080/ | grep -o 'data-bot-key="[^"]*"'
# -> data-bot-key="pk_…"   ➜ la balise widget est bien injectée
```

## Tout supprimer (site + base)

```bash
docker compose -f integrations/wordpress/docker-compose.yml down -v
```

## Portée (v1)

Volontairement **basique** : 1 clé = 1 bot sur 1 site, configuré à la main.
Le provisioning automatique multi-sites (revente / éditeurs de sites) relève de
l'API Partenaire (Palier 2) décrite dans `docs/STRATEGIE_REVENDEUR_WHITELABEL.md`
et **n'est pas** dans ce plugin.
