# Site cm.chapote.fr : bundle statique servi par nginx, qui relaie aussi /api/cm/,
# /api/tiktok/, /api/youtube/ et l'authentification vers le service `api` (même origine).
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
# Assistant Chapote CM (docs/WIDGET_CM.md) : drapeau + clé PUBLIQUE du bot, lus au build par Vite.
ARG VITE_CM_ASSISTANT=""
ARG VITE_CM_ASSISTANT_KEY=""
ENV VITE_CM_ASSISTANT=$VITE_CM_ASSISTANT VITE_CM_ASSISTANT_KEY=$VITE_CM_ASSISTANT_KEY
RUN npm run build

FROM nginx:1.27-alpine
# modèle : ${CM_PROXY_KEY} remplacé au démarrage (entrypoint de l'image nginx)
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
