# Site cm.chapote.fr : page statique servie par nginx, qui relaie aussi /api/cm/,
# /api/tiktok/, /api/youtube/ et l'authentification vers le service `api` (même origine).
FROM nginx:1.27-alpine
# modèle : ${CM_PROXY_KEY} remplacé au démarrage (entrypoint de l'image nginx)
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY index.html /usr/share/nginx/html/index.html
EXPOSE 80
