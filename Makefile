.PHONY: up down build logs logs-api logs-app ps demo

up:
	docker compose up -d

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
