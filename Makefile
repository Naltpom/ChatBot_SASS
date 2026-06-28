.PHONY: up down build logs logs-api logs-app ps demo migrate

up:
	docker compose up -d

# Migration dédiée (hors boot de l'app). `docker compose up` la joue déjà via le
# service one-shot `migrate` ; cette cible permet de la rejouer à la demande
# (idempotent : base déjà à head -> aucun DDL).
migrate:
	docker compose run --rm migrate

down:
	docker compose down

build:
	docker compose up -d --build

logs:
	docker compose logs -f

logs-api:
	docker compose logs -f api

logs-app:
	docker compose logs -f app

ps:
	docker compose ps

# Page de demo du widget (a ouvrir apres avoir cree un bot et whiteliste localhost)
demo:
	@echo "Ouvrir demo/index.html dans un navigateur (servir via: python -m http.server 8080 -d demo)"

stripe-webhook:
	@echo "Lancer le webhook stripe (pour tester les events de facturation)"
	@echo "Exemple: stripe listen --forward-to localhost:8000/api/stripe/webhook"
	stripe listen --forward-to localhost:8001/api/billing/webhook