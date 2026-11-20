# Site music.chapote.fr : bundle statique servi par nginx, qui relaie aussi
# /api/music/ vers le service `api` du compose (même origine, pas de CORS).
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
# modèle : ${MUSIC_PROXY_KEY} remplacé au démarrage (entrypoint de l'image nginx)
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
