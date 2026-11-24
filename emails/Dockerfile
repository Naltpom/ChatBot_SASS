# Site emails.chapote.fr : bundle statique servi par nginx, qui relaie aussi l'API d'administration,
# l'authentification, le serveur MCP (/mcp) et l'OAuth (/oauth/, /.well-known/oauth-*) vers `api`.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
# modèle : ${EMAILS_PROXY_KEY} remplacé au démarrage (entrypoint de l'image nginx)
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
