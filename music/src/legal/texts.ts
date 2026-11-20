// Textes légaux de music.chapote.fr. Version française = version qui fait foi ; EN, ES et RU en sont des traductions.
// Syntaxe : « ## » titre de section, « - » élément de liste, ligne vide = paragraphe.
// Seules des informations connues et exactes y figurent.
import type { Lang } from '../i18n'

export type DocKey = 'terms' | 'use' | 'privacy' | 'notice'

export const UPDATED: Record<Lang, string> = {
  fr: 'Dernière mise à jour : 20 novembre 2026.',
  en: 'Last updated: 20 November 2026.',
  es: 'Última actualización: 20 de noviembre de 2026.',
  ru: 'Последнее обновление: 20 ноября 2026 г.',
}

const STRIPE_FR = 'Stripe Payments Europe, Ltd. (1 Grand Canal Street Lower, Grand Canal Dock, Dublin, Irlande)'
const STRIPE_EN = 'Stripe Payments Europe, Ltd. (1 Grand Canal Street Lower, Grand Canal Dock, Dublin, Ireland)'
const STRIPE_ES = 'Stripe Payments Europe, Ltd. (1 Grand Canal Street Lower, Grand Canal Dock, Dublín, Irlanda)'
const STRIPE_RU = 'Stripe Payments Europe, Ltd. (1 Grand Canal Street Lower, Grand Canal Dock, Дублин, Ирландия)'

type Docs = Record<DocKey, { title: string; body: string }>

const FR: Docs = {
  notice: {
    title: 'Mentions légales',
    body: `## Éditeur
Le site **music.chapote.fr** (« Ghost Hands Sheets ») est un service de Chapote, édité par :
- **Éditeur :** Nathan Provost, personne physique
- **TVA :** TVA non applicable, art. 293 B du CGI (franchise en base)
- **Contact :** music@chapote.fr

## Directeur de la publication
Nathan Provost

## Hébergement
- **Hébergeur :** OVH SAS — serveurs situés en France (Gravelines)
- **Adresse :** 2 rue Kellermann, 59100 Roubaix, France
- **Téléphone :** +33 9 72 10 10 07 — www.ovhcloud.com

## Paiements
Les paiements sont traités par ${STRIPE_FR}. Aucune donnée de carte bancaire n'est stockée sur les serveurs du site.

## Propriété intellectuelle
Les partitions vendues sont gravées d'après les notes jouées dans les vidéos du compte Instagram @ghosthands.music. Le site, ses textes, son design, les aperçus et les fichiers PDF sont protégés par le droit de la propriété intellectuelle ; toute reproduction non autorisée est interdite.

## Signalement et données personnelles
Signaler un contenu illicite ou un abus : abuse@chapote.fr. Exercer un droit sur vos données personnelles : rgpd@chapote.fr.`,
  },
  terms: {
    title: 'Conditions générales de vente',
    body: `## 1. Objet
Les présentes conditions générales de vente (CGV) régissent la vente de partitions numériques (fichiers PDF) sur le site music.chapote.fr par Nathan Provost, personne physique, éditeur du service Chapote (ci-après « le Vendeur »), à toute personne qui passe commande (ci-après « l'Acheteur »). Passer commande implique leur acceptation.

## 2. Produits
Chaque partition correspond à un morceau joué sur un instrument dans une vidéo du compte Instagram @ghosthands.music ; elle est gravée d'après les notes jouées dans cette vidéo. La fiche du morceau indique l'instrument, le nombre de pages et le prix. La première page et un extrait du lecteur sont consultables gratuitement avant l'achat ; les pages suivantes sont présentées floutées. Le nombre de « j'aime » affiché est celui de la vidéo sur Instagram.

## 3. Prix
- Les prix sont indiqués en euros, toutes taxes comprises. TVA non applicable, art. 293 B du CGI.
- Lorsque plusieurs instruments d'un même morceau sont commandés ensemble, un prix de lot peut s'appliquer ; il est affiché sur la fiche du morceau et dans le récapitulatif.
- Un code promo s'applique selon ses conditions (montant ou pourcentage, durée, nombre d'utilisations). Un seul code par commande.
- Le prix dû est celui affiché dans le récapitulatif au moment de la validation de la commande.

## 4. Commande
L'Acheteur choisit une ou plusieurs partitions, vérifie le récapitulatif (partitions, remises, total), coche la case par laquelle il demande la fourniture immédiate du contenu et accepte les présentes CGV, puis paie. La commande est conclue au paiement. Une commande dont le total est nul (code promo de 100 %) est conclue dès sa validation. Un compte n'est pas nécessaire pour commander.

## 5. Paiement
Le paiement s'effectue sur la page de paiement sécurisée de ${STRIPE_FR}, par les moyens qui y sont proposés. Le Vendeur n'a jamais accès aux données de carte bancaire.

## 6. Livraison
Dès la confirmation du paiement, les partitions sont téléchargeables sur la page de confirmation de commande, et les liens de téléchargement sont envoyés à l'adresse e-mail indiquée. Les liens restent valables 365 jours à compter du paiement. Avec un compte, les partitions achetées avec la même adresse e-mail sont aussi disponibles dans « Mes partitions ». Si l'Acheteur indique son pseudo Instagram et qu'il a demandé la partition au compte @ghosthands.music en message privé dans les 24 heures précédentes, les partitions lui sont aussi envoyées dans cette conversation ; cet envoi est un complément, la livraison reste celle décrite ci-dessus.

## 7. Droit de rétractation
Conformément à l'article L221-28, 13° du Code de la consommation, le droit de rétractation ne peut être exercé pour la fourniture d'un contenu numérique non fourni sur un support matériel dont l'exécution a commencé après accord préalable exprès du consommateur et renoncement exprès à son droit de rétractation. En cochant la case prévue avant le paiement, l'Acheteur demande la fourniture immédiate des partitions et reconnaît perdre son droit de rétractation ; ce consentement est horodaté et conservé avec la commande.

## 8. Licence d'utilisation
L'achat confère à l'Acheteur un droit d'usage personnel et non exclusif de la partition : la consulter, l'imprimer pour son propre usage, la travailler et jouer le morceau. Il est interdit de revendre, partager, diffuser, mettre en ligne ou reproduire la partition ou le fichier PDF, en tout ou partie, au bénéfice de tiers.

## 9. Conformité et réclamations
Le Vendeur répond des défauts de conformité du contenu numérique dans les conditions des articles L224-25-12 et suivants du Code de la consommation. Fichier illisible, incomplet ou ne correspondant pas à la fiche : écrivez à music@chapote.fr ; le Vendeur fournit un fichier conforme ou, à défaut, rembourse la partition concernée.

## 10. Responsabilité
Le Vendeur met en œuvre les moyens raisonnables pour assurer l'accès au site et aux téléchargements, sans garantir une disponibilité permanente. Il n'est pas responsable des interruptions dues aux prestataires tiers (hébergeur, Stripe, fournisseur de messagerie, Instagram) ni d'un usage des partitions contraire à l'article 8.

## 11. Données personnelles
Les données nécessaires à la commande sont traitées conformément à la politique de confidentialité du site.

## 12. Droit applicable
Les présentes CGV sont soumises au droit français. En cas de litige, l'Acheteur est invité à écrire d'abord à music@chapote.fr afin de rechercher une solution amiable. À défaut, les tribunaux compétents sont ceux désignés par la loi ; le consommateur peut saisir la juridiction du lieu où il demeurait au moment de la commande.`,
  },
  use: {
    title: 'Conditions générales d’utilisation',
    body: `## 1. Objet
Les présentes conditions générales d'utilisation (CGU) encadrent l'accès au site music.chapote.fr, édité par Nathan Provost, personne physique, éditeur du service Chapote. Naviguer sur le site implique leur acceptation. Les achats sont régis par les conditions générales de vente.

## 2. Accès au site
Le site est accessible librement. L'éditeur peut suspendre l'accès, notamment pour maintenance, sans que sa responsabilité soit engagée.

## 3. Compte
- La création d'un compte est facultative. Elle se fait avec une adresse e-mail et un mot de passe, ou avec Google.
- Le même compte donne accès à music.chapote.fr et à chapote.fr ; le service par lequel le compte a été créé est enregistré.
- L'utilisateur garde ses identifiants confidentiels et peut demander la suppression de son compte à rgpd@chapote.fr.

## 4. Avis
- Seule une personne connectée qui a acheté une partition peut la noter (de 1 à 5 étoiles, avec un commentaire facultatif). Un avis par partition et par compte ; il peut être modifié.
- Les avis sont publiés avec le prénom ou le nom affiché du compte et la mention « Achat vérifié ».
- Sont interdits les avis injurieux, diffamatoires, hors sujet ou contenant des données personnelles de tiers. L'éditeur peut retirer un avis contraire à ces règles ; il ne modifie jamais le contenu ou la note d'un avis.

## 5. Contenus
Les aperçus (première page de chaque partition, pages suivantes floutées, extrait du lecteur), les textes et le design du site sont protégés. Il est interdit de les extraire, les reproduire ou les réutiliser en dehors de la consultation normale du site, ou de chercher à obtenir les pages floutées autrement que par l'achat.

## 6. Usage du site
Il est interdit de perturber le fonctionnement du site (requêtes en masse, extraction automatisée, contournement des mesures de sécurité) ou de l'utiliser à des fins illicites.

## 7. Liens externes
Le site renvoie vers des services tiers (Instagram, page de paiement Stripe, connexion Google). L'éditeur n'est pas responsable de leur contenu ni de leur fonctionnement.

## 8. Évolution
Les présentes CGU peuvent évoluer ; la version applicable est celle publiée sur le site au moment de la consultation.

## 9. Contact
music@chapote.fr`,
  },
  privacy: {
    title: 'Politique de confidentialité',
    body: `## Responsable du traitement
Nathan Provost, personne physique, éditeur du service Chapote. Contact : rgpd@chapote.fr.

## Données traitées
- **Commande :** partitions achetées, montants, code promo, dates, horodatage du consentement à la fourniture immédiate, statut du paiement.
- **Adresse e-mail :** celle que vous saisissez sur le site ou sur la page de paiement Stripe, pour vous envoyer vos liens de téléchargement.
- **Pseudo Instagram (facultatif) :** pour vous envoyer aussi vos partitions dans la conversation Instagram où vous les avez demandées.
- **Compte (facultatif) :** nom, adresse e-mail, mot de passe (conservé sous forme chiffrée irréversible) ou identifiant Google, service par lequel le compte a été créé et services utilisés (music.chapote.fr, chapote.fr).
- **Avis :** note, commentaire et date, publiés avec le nom affiché du compte.
- **Paiement :** traité par Stripe ; le site ne reçoit ni ne stocke vos données de carte bancaire.
- **Données techniques :** journaux du serveur (dont l'adresse IP), pour la sécurité et le bon fonctionnement du site ; cookie de session si vous vous connectez.

Le site n'utilise ni cookie publicitaire, ni outil de mesure d'audience, ni police ou script hébergé par un tiers. Votre navigateur garde votre langue et votre panier (stockage local), qui ne nous sont pas transmis.

## Finalités et bases légales
- Exécution de la commande et livraison des partitions (dont l'envoi Instagram si vous l'avez demandé) : exécution du contrat.
- Compte et avis : exécution du contrat (conditions d'utilisation), à votre demande.
- Conservation des pièces de la vente : obligation légale (comptabilité, art. L123-22 du Code de commerce).
- Sécurité du site et prévention des abus : intérêt légitime.

## Destinataires
- **${STRIPE_FR}** : paiement. Stripe peut traiter certaines données hors de l'Union européenne dans le cadre de garanties appropriées (clauses contractuelles types).
- **OVH SAS** : hébergement (serveurs en France) et envoi des e-mails (serveurs dans l'Union européenne).
- **Meta Platforms (Instagram)** : seulement si vous indiquez votre pseudo Instagram, pour l'envoi dans votre conversation.
- **Google** : seulement si vous choisissez « Continuer avec Google ».

## Durées de conservation
- Données de commande : 10 ans (obligation comptable).
- Liens de téléchargement : actifs 365 jours après le paiement.
- Compte et avis : jusqu'à la suppression du compte.

## Vos droits
Vous disposez d'un droit d'accès, de rectification, d'effacement, de limitation, d'opposition et de portabilité, dans les limites prévues par le RGPD (les données de vente doivent être conservées pendant la durée légale). Écrivez à rgpd@chapote.fr. Vous pouvez aussi adresser une réclamation à la CNIL (www.cnil.fr).`,
  },
}

const EN: Docs = {
  notice: {
    title: 'Legal notice',
    body: `The French version of this notice prevails.

## Publisher
The website **music.chapote.fr** ("Ghost Hands Sheets") is a service of Chapote, published by:
- **Publisher:** Nathan Provost, individual
- **VAT:** VAT not applicable, art. 293 B of the French General Tax Code (franchise en base)
- **Contact:** music@chapote.fr

## Publication director
Nathan Provost

## Hosting
- **Host:** OVH SAS — servers located in France (Gravelines)
- **Address:** 2 rue Kellermann, 59100 Roubaix, France
- **Phone:** +33 9 72 10 10 07 — www.ovhcloud.com

## Payments
Payments are processed by ${STRIPE_EN}. No card data is stored on the website's servers.

## Intellectual property
The sheets sold are engraved from the notes played in the videos of the Instagram account @ghosthands.music. The website, its texts, its design, the previews and the PDF files are protected by intellectual property law; any unauthorised reproduction is prohibited.

## Reports and personal data
Report illegal content or abuse: abuse@chapote.fr. Exercise a right over your personal data: rgpd@chapote.fr.`,
  },
  terms: {
    title: 'Terms of sale',
    body: `These terms are a translation; the French version prevails.

## 1. Purpose
These terms govern the sale of digital sheet music (PDF files) on music.chapote.fr by Nathan Provost, individual, publisher of the Chapote service ("the Seller"), to any person placing an order ("the Buyer"). Placing an order means accepting them.

## 2. Products
Each sheet matches a piece played on one instrument in a video of the Instagram account @ghosthands.music; it is engraved from the notes played in that video. The piece page shows the instrument, the number of pages and the price. The first page and an excerpt of the player can be viewed for free before buying; the following pages are shown blurred. The number of likes shown is the video's count on Instagram.

## 3. Prices
- Prices are in euros, all taxes included. VAT not applicable, art. 293 B of the French General Tax Code.
- When several instruments of the same piece are ordered together, a bundle price may apply; it is shown on the piece page and in the summary.
- A promo code applies under its own conditions (amount or percentage, period, number of uses). One code per order.
- The price due is the one shown in the summary when the order is confirmed.

## 4. Order
The Buyer picks one or more sheets, checks the summary (sheets, discounts, total), ticks the box requesting immediate supply of the content and accepting these terms, then pays. The order is concluded upon payment. An order with a total of zero (100 % promo code) is concluded when confirmed. No account is needed to order.

## 5. Payment
Payment is made on the secure payment page of ${STRIPE_EN}, using the methods offered there. The Seller never has access to card data.

## 6. Delivery
As soon as payment is confirmed, the sheets can be downloaded from the order confirmation page, and the download links are sent to the e-mail address provided. The links remain valid for 365 days after payment. With an account, sheets bought with the same e-mail address also appear in "My sheets". If the Buyer gives their Instagram username and asked the @ghosthands.music account for the sheet by direct message within the previous 24 hours, the sheets are also sent in that conversation; this is an extra, delivery remains as described above.

## 7. Right of withdrawal
Under article L221-28, 13° of the French Consumer Code, the right of withdrawal cannot be exercised for the supply of digital content not supplied on a tangible medium where performance has begun with the consumer's prior express consent and express waiver of the right of withdrawal. By ticking the box before payment, the Buyer requests immediate supply of the sheets and acknowledges losing the right of withdrawal; this consent is timestamped and kept with the order.

## 8. Licence
The purchase grants the Buyer a personal, non-exclusive right to use the sheet: view it, print it for their own use, practise and play the piece. Reselling, sharing, distributing, uploading or reproducing the sheet or the PDF file, in whole or in part, for third parties is prohibited.

## 9. Conformity and complaints
The Seller is liable for lack of conformity of digital content under articles L224-25-12 and following of the French Consumer Code. Unreadable or incomplete file, or one that does not match the piece page: write to music@chapote.fr; the Seller supplies a conforming file or, failing that, refunds the sheet concerned.

## 10. Liability
The Seller uses reasonable means to keep the website and downloads available, without guaranteeing permanent availability. The Seller is not liable for interruptions caused by third-party providers (host, Stripe, e-mail provider, Instagram) or for use of the sheets contrary to article 8.

## 11. Personal data
Data needed for the order is processed as described in the privacy policy.

## 12. Governing law
These terms are governed by French law. In case of dispute, the Buyer is invited to first write to music@chapote.fr to seek an amicable solution. Failing that, the competent courts are those designated by law; a consumer may bring the case before the court of the place where they lived when ordering.`,
  },
  use: {
    title: 'Terms of use',
    body: `These terms are a translation; the French version prevails.

## 1. Purpose
These terms of use govern access to music.chapote.fr, published by Nathan Provost, individual, publisher of the Chapote service. Browsing the website means accepting them. Purchases are governed by the terms of sale.

## 2. Access
The website is freely accessible. The publisher may suspend access, in particular for maintenance, without liability.

## 3. Account
- Creating an account is optional. It uses an e-mail address and a password, or Google.
- The same account gives access to music.chapote.fr and chapote.fr; the service where the account was created is recorded.
- Users keep their credentials confidential and can ask for their account to be deleted at rgpd@chapote.fr.

## 4. Reviews
- Only a signed-in person who bought a sheet can rate it (1 to 5 stars, with an optional comment). One review per sheet and per account; it can be edited.
- Reviews are published with the account's display name and the label "Verified buyer".
- Abusive, defamatory or off-topic reviews, or reviews containing third parties' personal data, are prohibited. The publisher may remove a review that breaks these rules; it never edits the content or rating of a review.

## 5. Content
The previews (first page of each sheet, following pages blurred, player excerpt), the texts and the design of the website are protected. Extracting, reproducing or reusing them beyond normal browsing, or trying to obtain the blurred pages other than by buying, is prohibited.

## 6. Use of the website
Disrupting the website (mass requests, automated extraction, bypassing security measures) or using it for unlawful purposes is prohibited.

## 7. External links
The website links to third-party services (Instagram, Stripe payment page, Google sign-in). The publisher is not responsible for their content or operation.

## 8. Changes
These terms may change; the applicable version is the one published on the website when it is consulted.

## 9. Contact
music@chapote.fr`,
  },
  privacy: {
    title: 'Privacy policy',
    body: `This policy is a translation; the French version prevails.

## Controller
Nathan Provost, individual, publisher of the Chapote service. Contact: rgpd@chapote.fr.

## Data processed
- **Order:** sheets bought, amounts, promo code, dates, timestamp of the consent to immediate supply, payment status.
- **E-mail address:** the one you enter on the website or on the Stripe payment page, to send your download links.
- **Instagram username (optional):** to also send your sheets in the Instagram conversation where you asked for them.
- **Account (optional):** name, e-mail address, password (stored as an irreversible hash) or Google identifier, service where the account was created and services used (music.chapote.fr, chapote.fr).
- **Reviews:** rating, comment and date, published with the account's display name.
- **Payment:** processed by Stripe; the website neither receives nor stores your card data.
- **Technical data:** server logs (including IP address), for security and proper operation; a session cookie if you sign in.

The website uses no advertising cookie, no audience measurement tool, and no font or script hosted by a third party. Your browser keeps your language and your cart (local storage), which are not sent to us.

## Purposes and legal bases
- Performing the order and delivering the sheets (including the Instagram delivery if you asked for it): performance of the contract.
- Account and reviews: performance of the contract (terms of use), at your request.
- Keeping sales records: legal obligation (accounting, art. L123-22 of the French Commercial Code).
- Website security and abuse prevention: legitimate interest.

## Recipients
- **${STRIPE_EN}**: payment. Stripe may process some data outside the European Union under appropriate safeguards (standard contractual clauses).
- **OVH SAS**: hosting (servers in France) and e-mail sending (servers in the European Union).
- **Meta Platforms (Instagram)**: only if you give your Instagram username, for delivery in your conversation.
- **Google**: only if you choose "Continue with Google".

## Retention
- Order data: 10 years (accounting obligation).
- Download links: active for 365 days after payment.
- Account and reviews: until the account is deleted.

## Your rights
You have the rights of access, rectification, erasure, restriction, objection and portability, within the limits of the GDPR (sales records must be kept for the legal period). Write to rgpd@chapote.fr. You may also lodge a complaint with the CNIL (www.cnil.fr).`,
  },
}

const ES: Docs = {
  notice: {
    title: 'Aviso legal',
    body: `Este aviso es una traducción; prevalece la versión francesa.

## Editor
El sitio **music.chapote.fr** («Ghost Hands Sheets») es un servicio de Chapote, editado por:
- **Editor:** Nathan Provost, persona física
- **IVA:** IVA no aplicable, art. 293 B del Código General Tributario francés (franchise en base)
- **Contacto:** music@chapote.fr

## Director de la publicación
Nathan Provost

## Alojamiento
- **Proveedor:** OVH SAS — servidores ubicados en Francia (Gravelines)
- **Dirección:** 2 rue Kellermann, 59100 Roubaix, Francia
- **Teléfono:** +33 9 72 10 10 07 — www.ovhcloud.com

## Pagos
Los pagos los procesa ${STRIPE_ES}. Ningún dato de tarjeta se almacena en los servidores del sitio.

## Propiedad intelectual
Las partituras vendidas se graban a partir de las notas tocadas en los vídeos de la cuenta de Instagram @ghosthands.music. El sitio, sus textos, su diseño, las vistas previas y los archivos PDF están protegidos por la propiedad intelectual; queda prohibida toda reproducción no autorizada.

## Denuncias y datos personales
Para denunciar un contenido ilícito o un abuso: abuse@chapote.fr. Para ejercer un derecho sobre tus datos personales: rgpd@chapote.fr.`,
  },
  terms: {
    title: 'Condiciones de venta',
    body: `Estas condiciones son una traducción; prevalece la versión francesa.

## 1. Objeto
Estas condiciones generales de venta regulan la venta de partituras digitales (archivos PDF) en music.chapote.fr por Nathan Provost, persona física, editor del servicio Chapote («el Vendedor»), a cualquier persona que haga un pedido («el Comprador»). Hacer un pedido implica aceptarlas.

## 2. Productos
Cada partitura corresponde a una pieza tocada con un instrumento en un vídeo de la cuenta de Instagram @ghosthands.music; se graba a partir de las notas tocadas en ese vídeo. La ficha de la pieza indica el instrumento, el número de páginas y el precio. La primera página y un fragmento del reproductor pueden verse gratis antes de comprar; las páginas siguientes se muestran difuminadas. El número de «me gusta» mostrado es el del vídeo en Instagram.

## 3. Precios
- Los precios se indican en euros, impuestos incluidos. IVA no aplicable, art. 293 B del Código General Tributario francés.
- Cuando se piden juntos varios instrumentos de una misma pieza, puede aplicarse un precio de lote; se muestra en la ficha de la pieza y en el resumen.
- Un código promocional se aplica según sus condiciones (importe o porcentaje, periodo, número de usos). Un solo código por pedido.
- El precio a pagar es el que aparece en el resumen al confirmar el pedido.

## 4. Pedido
El Comprador elige una o varias partituras, revisa el resumen (partituras, descuentos, total), marca la casilla con la que pide el suministro inmediato del contenido y acepta estas condiciones, y paga. El pedido se cierra con el pago. Un pedido con total cero (código del 100 %) se cierra al confirmarlo. No hace falta una cuenta para comprar.

## 5. Pago
El pago se realiza en la página de pago segura de ${STRIPE_ES}, con los medios que allí se ofrecen. El Vendedor nunca accede a los datos de la tarjeta.

## 6. Entrega
En cuanto se confirma el pago, las partituras pueden descargarse desde la página de confirmación del pedido y los enlaces de descarga se envían a la dirección de e-mail indicada. Los enlaces son válidos durante 365 días desde el pago. Con una cuenta, las partituras compradas con el mismo e-mail también aparecen en «Mis partituras». Si el Comprador indica su usuario de Instagram y pidió la partitura a la cuenta @ghosthands.music por mensaje privado en las 24 horas anteriores, las partituras también se le envían en esa conversación; es un complemento y la entrega sigue siendo la descrita arriba.

## 7. Derecho de desistimiento
Según el artículo L221-28, 13.º del Código de Consumo francés, no puede ejercerse el derecho de desistimiento en el suministro de contenido digital que no se presta en soporte material cuya ejecución ha comenzado con el consentimiento previo y expreso del consumidor y su renuncia expresa a ese derecho. Al marcar la casilla prevista antes del pago, el Comprador pide el suministro inmediato de las partituras y reconoce que pierde su derecho de desistimiento; este consentimiento queda registrado con fecha y hora junto al pedido.

## 8. Licencia de uso
La compra otorga al Comprador un derecho de uso personal y no exclusivo de la partitura: consultarla, imprimirla para su propio uso, estudiarla y tocar la pieza. Queda prohibido revender, compartir, difundir, publicar en línea o reproducir la partitura o el archivo PDF, total o parcialmente, en beneficio de terceros.

## 9. Conformidad y reclamaciones
El Vendedor responde de la falta de conformidad del contenido digital en las condiciones de los artículos L224-25-12 y siguientes del Código de Consumo francés. Si el archivo es ilegible, está incompleto o no corresponde a la ficha, escribe a music@chapote.fr; el Vendedor proporciona un archivo conforme o, en su defecto, reembolsa la partitura afectada.

## 10. Responsabilidad
El Vendedor pone los medios razonables para mantener el acceso al sitio y a las descargas, sin garantizar una disponibilidad permanente. No es responsable de las interrupciones debidas a proveedores terceros (alojamiento, Stripe, proveedor de e-mail, Instagram) ni de un uso de las partituras contrario al artículo 8.

## 11. Datos personales
Los datos necesarios para el pedido se tratan conforme a la política de privacidad del sitio.

## 12. Ley aplicable
Estas condiciones se rigen por la ley francesa. En caso de litigio, se invita al Comprador a escribir primero a music@chapote.fr para buscar una solución amistosa. En su defecto, son competentes los tribunales que designe la ley; el consumidor puede acudir al tribunal del lugar donde residía en el momento del pedido.`,
  },
  use: {
    title: 'Condiciones de uso',
    body: `Estas condiciones son una traducción; prevalece la versión francesa.

## 1. Objeto
Estas condiciones generales de uso regulan el acceso a music.chapote.fr, editado por Nathan Provost, persona física, editor del servicio Chapote. Navegar por el sitio implica aceptarlas. Las compras se rigen por las condiciones de venta.

## 2. Acceso
El acceso al sitio es libre. El editor puede suspenderlo, en particular por mantenimiento, sin incurrir en responsabilidad.

## 3. Cuenta
- Crear una cuenta es opcional. Se hace con un e-mail y una contraseña, o con Google.
- La misma cuenta da acceso a music.chapote.fr y a chapote.fr; se registra el servicio desde el que se creó.
- El usuario mantiene sus credenciales en secreto y puede pedir la eliminación de su cuenta en rgpd@chapote.fr.

## 4. Opiniones
- Solo una persona que ha iniciado sesión y ha comprado una partitura puede valorarla (de 1 a 5 estrellas, con un comentario opcional). Una opinión por partitura y por cuenta; puede modificarse.
- Las opiniones se publican con el nombre visible de la cuenta y la mención «Compra verificada».
- Se prohíben las opiniones injuriosas, difamatorias, fuera de tema o que contengan datos personales de terceros. El editor puede retirar una opinión contraria a estas reglas; nunca modifica su contenido ni su nota.

## 5. Contenidos
Las vistas previas (primera página de cada partitura, páginas siguientes difuminadas, fragmento del reproductor), los textos y el diseño del sitio están protegidos. Queda prohibido extraerlos, reproducirlos o reutilizarlos fuera de la consulta normal del sitio, o intentar obtener las páginas difuminadas de otro modo que comprándolas.

## 6. Uso del sitio
Queda prohibido perturbar el funcionamiento del sitio (peticiones masivas, extracción automatizada, eludir las medidas de seguridad) o usarlo con fines ilícitos.

## 7. Enlaces externos
El sitio enlaza con servicios de terceros (Instagram, página de pago de Stripe, inicio de sesión con Google). El editor no es responsable de su contenido ni de su funcionamiento.

## 8. Cambios
Estas condiciones pueden cambiar; la versión aplicable es la publicada en el sitio en el momento de la consulta.

## 9. Contacto
music@chapote.fr`,
  },
  privacy: {
    title: 'Política de privacidad',
    body: `Esta política es una traducción; prevalece la versión francesa.

## Responsable del tratamiento
Nathan Provost, persona física, editor del servicio Chapote. Contacto: rgpd@chapote.fr.

## Datos tratados
- **Pedido:** partituras compradas, importes, código promocional, fechas, fecha y hora del consentimiento al suministro inmediato, estado del pago.
- **E-mail:** el que indicas en el sitio o en la página de pago de Stripe, para enviarte los enlaces de descarga.
- **Usuario de Instagram (opcional):** para enviarte también las partituras en la conversación de Instagram donde las pediste.
- **Cuenta (opcional):** nombre, e-mail, contraseña (guardada como hash irreversible) o identificador de Google, servicio desde el que se creó la cuenta y servicios usados (music.chapote.fr, chapote.fr).
- **Opiniones:** nota, comentario y fecha, publicados con el nombre visible de la cuenta.
- **Pago:** lo procesa Stripe; el sitio no recibe ni guarda los datos de tu tarjeta.
- **Datos técnicos:** registros del servidor (incluida la dirección IP), para la seguridad y el buen funcionamiento del sitio; una cookie de sesión si inicias sesión.

El sitio no usa cookies publicitarias, ni herramientas de medición de audiencia, ni fuentes o scripts alojados por terceros. Tu navegador guarda tu idioma y tu carrito (almacenamiento local), que no se nos envían.

## Finalidades y bases legales
- Ejecución del pedido y entrega de las partituras (incluido el envío por Instagram si lo pediste): ejecución del contrato.
- Cuenta y opiniones: ejecución del contrato (condiciones de uso), a petición tuya.
- Conservación de los justificantes de venta: obligación legal (contabilidad, art. L123-22 del Código de Comercio francés).
- Seguridad del sitio y prevención de abusos: interés legítimo.

## Destinatarios
- **${STRIPE_ES}**: pago. Stripe puede tratar algunos datos fuera de la Unión Europea con garantías adecuadas (cláusulas contractuales tipo).
- **OVH SAS**: alojamiento (servidores en Francia) y envío de e-mails (servidores en la Unión Europea).
- **Meta Platforms (Instagram)**: solo si indicas tu usuario de Instagram, para el envío en tu conversación.
- **Google**: solo si eliges «Continuar con Google».

## Plazos de conservación
- Datos del pedido: 10 años (obligación contable).
- Enlaces de descarga: activos 365 días después del pago.
- Cuenta y opiniones: hasta que se elimine la cuenta.

## Tus derechos
Tienes derecho de acceso, rectificación, supresión, limitación, oposición y portabilidad, dentro de los límites del RGPD (los datos de venta deben conservarse durante el plazo legal). Escribe a rgpd@chapote.fr. También puedes presentar una reclamación ante la CNIL (www.cnil.fr).`,
  },
}

const RU: Docs = {
  notice: {
    title: 'Правовая информация',
    body: `Это перевод; юридическую силу имеет французская версия.

## Издатель
Сайт **music.chapote.fr** («Ghost Hands Sheets») — сервис Chapote. Издатель:
- **Издатель:** Натан Прово (Nathan Provost), физическое лицо
- **НДС:** НДС не применяется, ст. 293 B Налогового кодекса Франции (franchise en base)
- **Контакты:** music@chapote.fr

## Ответственный за публикацию
Натан Прово (Nathan Provost)

## Хостинг
- **Хостинг-провайдер:** OVH SAS — серверы во Франции (Гравлин)
- **Адрес:** 2 rue Kellermann, 59100 Roubaix, Франция
- **Телефон:** +33 9 72 10 10 07 — www.ovhcloud.com

## Платежи
Платежи обрабатывает ${STRIPE_RU}. Данные банковских карт на серверах сайта не хранятся.

## Интеллектуальная собственность
Продаваемые ноты записаны по нотам, сыгранным в видео аккаунта Instagram @ghosthands.music. Сайт, его тексты, дизайн, превью и PDF-файлы защищены правом интеллектуальной собственности; любое несанкционированное воспроизведение запрещено.

## Жалобы и персональные данные
Сообщить о незаконном содержании или злоупотреблении: abuse@chapote.fr. Воспользоваться правами в отношении персональных данных: rgpd@chapote.fr.`,
  },
  terms: {
    title: 'Условия продажи',
    body: `Это перевод; юридическую силу имеет французская версия.

## 1. Предмет
Настоящие условия регулируют продажу цифровых нот (PDF-файлов) на сайте music.chapote.fr Натаном Прово (Nathan Provost), физическим лицом, издателем сервиса Chapote («Продавец»), любому лицу, оформляющему заказ («Покупатель»). Оформление заказа означает их принятие.

## 2. Товары
Каждые ноты соответствуют произведению, сыгранному на одном инструменте в видео аккаунта Instagram @ghosthands.music, и записаны по нотам, сыгранным в этом видео. На странице произведения указаны инструмент, число страниц и цена. Первую страницу и фрагмент плеера можно посмотреть бесплатно до покупки; остальные страницы показаны размытыми. Указанное число отметок «Нравится» — это число отметок у видео в Instagram.

## 3. Цены
- Цены указаны в евро, все налоги включены. НДС не применяется, ст. 293 B Налогового кодекса Франции.
- При заказе нескольких инструментов одного произведения может действовать цена комплекта; она указана на странице произведения и в сводке заказа.
- Промокод действует на своих условиях (сумма или процент, срок, число использований). Один код на заказ.
- К оплате — сумма, указанная в сводке в момент подтверждения заказа.

## 4. Заказ
Покупатель выбирает одни или несколько нот, проверяет сводку (ноты, скидки, итог), отмечает галочку, которой просит немедленно предоставить контент и принимает настоящие условия, и оплачивает. Заказ заключается в момент оплаты. Заказ с нулевой суммой (промокод на 100 %) заключается в момент подтверждения. Аккаунт для заказа не нужен.

## 5. Оплата
Оплата производится на защищённой странице оплаты ${STRIPE_RU} доступными там способами. Продавец никогда не получает доступа к данным карты.

## 6. Доставка
Сразу после подтверждения оплаты ноты можно скачать на странице подтверждения заказа, а ссылки для скачивания отправляются на указанный e-mail. Ссылки действуют 365 дней с момента оплаты. При наличии аккаунта ноты, купленные с тем же e-mail, также доступны в разделе «Мои ноты». Если Покупатель указал свой ник в Instagram и в течение предыдущих 24 часов просил эти ноты у аккаунта @ghosthands.music в личных сообщениях, ноты также отправляются в этот диалог; это дополнение, основная доставка остаётся описанной выше.

## 7. Право на отказ
Согласно статье L221-28, п. 13 Кодекса потребителя Франции, право на отказ не применяется к предоставлению цифрового контента не на материальном носителе, исполнение которого началось с предварительного явного согласия потребителя и его явного отказа от права на отказ. Отмечая галочку перед оплатой, Покупатель просит немедленно предоставить ноты и признаёт утрату права на отказ; это согласие фиксируется с датой и временем и хранится вместе с заказом.

## 8. Лицензия
Покупка даёт Покупателю личное неисключительное право пользования нотами: просматривать их, печатать для собственного использования, разучивать и исполнять произведение. Запрещено перепродавать, передавать, распространять, публиковать в интернете или воспроизводить ноты или PDF-файл, полностью или частично, в интересах третьих лиц.

## 9. Соответствие и претензии
Продавец отвечает за несоответствие цифрового контента в соответствии со статьями L224-25-12 и далее Кодекса потребителя Франции. Если файл не открывается, неполон или не соответствует странице произведения, напишите на music@chapote.fr: Продавец предоставит исправный файл или, если это невозможно, вернёт деньги за эти ноты.

## 10. Ответственность
Продавец принимает разумные меры для доступности сайта и загрузок, не гарантируя постоянной доступности. Продавец не отвечает за перебои по вине сторонних поставщиков (хостинг, Stripe, почтовый сервис, Instagram) и за использование нот в нарушение статьи 8.

## 11. Персональные данные
Данные, необходимые для заказа, обрабатываются в соответствии с политикой конфиденциальности сайта.

## 12. Применимое право
Настоящие условия регулируются правом Франции. В случае спора Покупателю предлагается сначала написать на music@chapote.fr для мирного урегулирования. В противном случае компетентны суды, определённые законом; потребитель может обратиться в суд по месту своего проживания на момент заказа.`,
  },
  use: {
    title: 'Условия использования',
    body: `Это перевод; юридическую силу имеет французская версия.

## 1. Предмет
Настоящие условия регулируют доступ к сайту music.chapote.fr, издаваемому Натаном Прово (Nathan Provost), физическим лицом, издателем сервиса Chapote. Пользование сайтом означает их принятие. Покупки регулируются условиями продажи.

## 2. Доступ
Доступ к сайту свободный. Издатель может приостановить доступ, в частности для технического обслуживания, без какой-либо ответственности.

## 3. Аккаунт
- Создание аккаунта необязательно. Используется e-mail и пароль либо вход через Google.
- Один и тот же аккаунт даёт доступ к music.chapote.fr и chapote.fr; сохраняется сервис, через который аккаунт был создан.
- Пользователь хранит свои учётные данные в тайне и может запросить удаление аккаунта по адресу rgpd@chapote.fr.

## 4. Отзывы
- Оценить ноты (от 1 до 5 звёзд, с необязательным комментарием) может только вошедший в аккаунт пользователь, который их купил. Один отзыв на ноты от одного аккаунта; его можно изменить.
- Отзывы публикуются с отображаемым именем аккаунта и отметкой «Подтверждённая покупка».
- Запрещены оскорбительные, клеветнические, не относящиеся к делу отзывы и отзывы с персональными данными третьих лиц. Издатель может удалить отзыв, нарушающий эти правила; он никогда не изменяет текст или оценку отзыва.

## 5. Материалы
Превью (первая страница нот, размытые следующие страницы, фрагмент плеера), тексты и дизайн сайта защищены. Запрещено извлекать, воспроизводить или повторно использовать их вне обычного просмотра сайта, а также пытаться получить размытые страницы иначе, чем купив ноты.

## 6. Пользование сайтом
Запрещено нарушать работу сайта (массовые запросы, автоматическое извлечение данных, обход мер безопасности) или использовать его в незаконных целях.

## 7. Внешние ссылки
Сайт содержит ссылки на сторонние сервисы (Instagram, страница оплаты Stripe, вход через Google). Издатель не отвечает за их содержание и работу.

## 8. Изменения
Настоящие условия могут меняться; действует версия, опубликованная на сайте в момент обращения.

## 9. Контакты
music@chapote.fr`,
  },
  privacy: {
    title: 'Политика конфиденциальности',
    body: `Это перевод; юридическую силу имеет французская версия.

## Оператор данных
Натан Прово (Nathan Provost), физическое лицо, издатель сервиса Chapote. Контакт: rgpd@chapote.fr.

## Обрабатываемые данные
- **Заказ:** купленные ноты, суммы, промокод, даты, время согласия на немедленное предоставление, статус оплаты.
- **E-mail:** адрес, указанный на сайте или на странице оплаты Stripe, для отправки ссылок на скачивание.
- **Ник в Instagram (необязательно):** чтобы также отправить ноты в диалог Instagram, где вы их просили.
- **Аккаунт (необязательно):** имя, e-mail, пароль (хранится в виде необратимого хеша) или идентификатор Google, сервис, через который создан аккаунт, и используемые сервисы (music.chapote.fr, chapote.fr).
- **Отзывы:** оценка, комментарий и дата, публикуются с отображаемым именем аккаунта.
- **Оплата:** обрабатывается Stripe; сайт не получает и не хранит данные вашей карты.
- **Технические данные:** журналы сервера (включая IP-адрес) для безопасности и нормальной работы сайта; cookie сеанса, если вы входите в аккаунт.

Сайт не использует рекламные cookie, инструменты веб-аналитики, а также шрифты и скрипты сторонних серверов. Ваш браузер хранит язык и корзину (локальное хранилище); эти данные нам не передаются.

## Цели и правовые основания
- Исполнение заказа и доставка нот (включая отправку в Instagram, если вы её запросили): исполнение договора.
- Аккаунт и отзывы: исполнение договора (условия использования) по вашему запросу.
- Хранение документов о продаже: требование закона (бухгалтерский учёт, ст. L123-22 Торгового кодекса Франции).
- Безопасность сайта и предотвращение злоупотреблений: законный интерес.

## Получатели
- **${STRIPE_RU}**: оплата. Stripe может обрабатывать часть данных за пределами Европейского союза при надлежащих гарантиях (типовые договорные условия).
- **OVH SAS**: хостинг (серверы во Франции) и отправка писем (серверы в Европейском союзе).
- **Meta Platforms (Instagram)**: только если вы укажете ник в Instagram — для отправки в ваш диалог.
- **Google**: только если вы выберете «Продолжить с Google».

## Сроки хранения
- Данные заказов: 10 лет (бухгалтерское требование).
- Ссылки на скачивание: действуют 365 дней после оплаты.
- Аккаунт и отзывы: до удаления аккаунта.

## Ваши права
Вы имеете право на доступ, исправление, удаление, ограничение обработки, возражение и переносимость данных в пределах GDPR (данные о продажах хранятся в течение установленного законом срока). Пишите на rgpd@chapote.fr. Вы также можете подать жалобу в CNIL (www.cnil.fr).`,
  },
}

export const DOCS: Record<Lang, Docs> = { fr: FR, en: EN, es: ES, ru: RU }
