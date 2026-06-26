"""Surface API EXTERNE (intégrations tierces : plugin WordPress).

Distincte du dashboard : authentifiée par un access token de scope 'plugin'
(device flow OAuth, cf. oauth.py) et non par le JWT 'dashboard'. La logique métier
(bots, facturation, entitlements) reste partagée dans services/ — ces routers sont
des couches minces réutilisant l'existant. Conçu pour être extrait en un 2e
déploiement plus tard sans refonte (un entrypoint ne montant que ces routers)."""
