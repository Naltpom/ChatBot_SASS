// Textes légaux de music.chapote.fr. Version française = version qui fait foi.
// Syntaxe : « ## » titre de section, « - » élément de liste, ligne vide = paragraphe.
// Seules des informations connues et exactes y figurent.

export type DocKey = 'terms' | 'use' | 'privacy' | 'notice'

export const UPDATED = { fr: 'Dernière mise à jour : 20 novembre 2026.', en: 'Last updated: 20 November 2026.' }

const STRIPE = 'Stripe Payments Europe, Ltd. (1 Grand Canal Street Lower, Grand Canal Dock, Dublin, Irlande)'
const STRIPE_EN = 'Stripe Payments Europe, Ltd. (1 Grand Canal Street Lower, Grand Canal Dock, Dublin, Ireland)'

export const DOCS: Record<'fr' | 'en', Record<DocKey, { title: string; body: string }>> = {
  fr: {
    notice: {
      title: 'Mentions légales',
      body: `## Éditeur
Le site **music.chapote.fr** (« Ghost Hands Sheets ») est un service de Chapote, édité par :
- **Éditeur :** Nathan Provost, personne physique
- **TVA :** TVA non applicable, art. 293 B du CGI (franchise en base)
- **Contact :** contact@chapote.fr

## Directeur de la publication
Nathan Provost

## Hébergement
- **Hébergeur :** OVH SAS — serveurs situés en France (Gravelines)
- **Adresse :** 2 rue Kellermann, 59100 Roubaix, France
- **Téléphone :** +33 9 72 10 10 07 — www.ovhcloud.com

## Paiements
Les paiements sont traités par ${STRIPE}. Aucune donnée de carte bancaire n'est stockée sur les serveurs du site.

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
Chaque partition correspond à un morceau joué sur un instrument dans une vidéo du compte Instagram @ghosthands.music ; elle est gravée d'après les notes jouées dans cette vidéo. La fiche du morceau indique l'instrument, le nombre de pages et le prix. La première page est consultable gratuitement avant l'achat ; les pages suivantes sont présentées floutées.

## 3. Prix
- Les prix sont indiqués en euros, toutes taxes comprises. TVA non applicable, art. 293 B du CGI.
- Lorsque plusieurs instruments d'un même morceau sont commandés ensemble, un prix de lot peut s'appliquer ; il est affiché sur la fiche du morceau et dans le récapitulatif.
- Un code promo s'applique selon ses conditions (montant ou pourcentage, durée, nombre d'utilisations). Un seul code par commande.
- Le prix dû est celui affiché dans le récapitulatif au moment de la validation de la commande.

## 4. Commande
L'Acheteur choisit une ou plusieurs partitions, vérifie le récapitulatif (partitions, remises, total), coche la case par laquelle il demande la fourniture immédiate du contenu et accepte les présentes CGV, puis paie. La commande est conclue au paiement. Une commande dont le total est nul (code promo de 100 %) est conclue dès sa validation.

## 5. Paiement
Le paiement s'effectue sur la page de paiement sécurisée de ${STRIPE}, par les moyens qui y sont proposés. Le Vendeur n'a jamais accès aux données de carte bancaire.

## 6. Livraison
Dès la confirmation du paiement, les partitions sont téléchargeables sur la page de confirmation de commande, et les liens de téléchargement sont envoyés à l'adresse e-mail indiquée. Les liens restent valables 365 jours à compter du paiement.

## 7. Droit de rétractation
Conformément à l'article L221-28, 13° du Code de la consommation, le droit de rétractation ne peut être exercé pour la fourniture d'un contenu numérique non fourni sur un support matériel dont l'exécution a commencé après accord préalable exprès du consommateur et renoncement exprès à son droit de rétractation. En cochant la case prévue avant le paiement, l'Acheteur demande la fourniture immédiate des partitions et reconnaît perdre son droit de rétractation ; ce consentement est horodaté et conservé avec la commande.

## 8. Licence d'utilisation
L'achat confère à l'Acheteur un droit d'usage personnel et non exclusif de la partition : la consulter, l'imprimer pour son propre usage, la travailler et jouer le morceau. Il est interdit de revendre, partager, diffuser, mettre en ligne ou reproduire la partition ou le fichier PDF, en tout ou partie, au bénéfice de tiers.

## 9. Conformité et réclamations
Le Vendeur répond des défauts de conformité du contenu numérique dans les conditions des articles L224-25-12 et suivants du Code de la consommation. Fichier illisible, incomplet ou ne correspondant pas à la fiche : écrivez à support@chapote.fr ; le Vendeur fournit un fichier conforme ou, à défaut, rembourse la partition concernée.

## 10. Responsabilité
Le Vendeur met en œuvre les moyens raisonnables pour assurer l'accès au site et aux téléchargements, sans garantir une disponibilité permanente. Il n'est pas responsable des interruptions dues aux prestataires tiers (hébergeur, Stripe, fournisseur de messagerie) ni d'un usage des partitions contraire à l'article 8.

## 11. Données personnelles
Les données nécessaires à la commande sont traitées conformément à la politique de confidentialité du site.

## 12. Droit applicable
Les présentes CGV sont soumises au droit français. En cas de litige, l'Acheteur est invité à écrire d'abord à support@chapote.fr afin de rechercher une solution amiable. À défaut, les tribunaux compétents sont ceux désignés par la loi ; le consommateur peut saisir la juridiction du lieu où il demeurait au moment de la commande.`,
    },
    use: {
      title: 'Conditions générales d’utilisation',
      body: `## 1. Objet
Les présentes conditions générales d'utilisation (CGU) encadrent l'accès au site music.chapote.fr, édité par Nathan Provost, personne physique, éditeur du service Chapote. Naviguer sur le site implique leur acceptation. Les achats sont régis par les conditions générales de vente.

## 2. Accès au site
Le site est accessible librement, sans création de compte. L'éditeur peut suspendre l'accès, notamment pour maintenance, sans que sa responsabilité soit engagée.

## 3. Contenus
Les aperçus (première page de chaque partition, pages suivantes floutées), les textes et le design du site sont protégés. Il est interdit de les extraire, les reproduire ou les réutiliser en dehors de la consultation normale du site, ou de chercher à obtenir les pages floutées autrement que par l'achat.

## 4. Usage du site
Il est interdit de perturber le fonctionnement du site (requêtes en masse, extraction automatisée, contournement des mesures de sécurité) ou de l'utiliser à des fins illicites.

## 5. Liens externes
Le site renvoie vers des services tiers (Instagram, page de paiement Stripe). L'éditeur n'est pas responsable de leur contenu ni de leur fonctionnement.

## 6. Évolution
Les présentes CGU peuvent évoluer ; la version applicable est celle publiée sur le site au moment de la consultation.

## 7. Contact
contact@chapote.fr`,
    },
    privacy: {
      title: 'Politique de confidentialité',
      body: `## Responsable du traitement
Nathan Provost, personne physique, éditeur du service Chapote. Contact : rgpd@chapote.fr.

## Données traitées
- **Commande :** partitions achetées, montants, code promo, dates, horodatage du consentement à la fourniture immédiate, statut du paiement.
- **Adresse e-mail :** celle que vous saisissez sur le site ou sur la page de paiement Stripe, pour vous envoyer vos liens de téléchargement.
- **Paiement :** traité par Stripe ; le site ne reçoit ni ne stocke vos données de carte bancaire.
- **Données techniques :** journaux du serveur (dont l'adresse IP), pour la sécurité et le bon fonctionnement du site.

Le site n'utilise ni cookie publicitaire, ni outil de mesure d'audience, ni police ou script hébergé par un tiers. Votre navigateur garde seulement votre langue et votre panier (stockage local), qui ne nous sont pas transmis.

## Finalités et bases légales
- Exécution de la commande et livraison des partitions : exécution du contrat.
- Conservation des pièces de la vente : obligation légale (comptabilité, art. L123-22 du Code de commerce).
- Sécurité du site et prévention des abus : intérêt légitime.

## Destinataires
- **${STRIPE}** : paiement. Stripe peut traiter certaines données hors de l'Union européenne dans le cadre de garanties appropriées (clauses contractuelles types).
- **OVH SAS** : hébergement (serveurs en France) et envoi des e-mails (serveurs dans l'Union européenne).

## Durées de conservation
- Données de commande : 10 ans (obligation comptable).
- Liens de téléchargement : actifs 365 jours après le paiement.

## Vos droits
Vous disposez d'un droit d'accès, de rectification, d'effacement, de limitation, d'opposition et de portabilité, dans les limites prévues par le RGPD (les données de vente doivent être conservées pendant la durée légale). Écrivez à rgpd@chapote.fr. Vous pouvez aussi adresser une réclamation à la CNIL (www.cnil.fr).`,
    },
  },
  en: {
    notice: {
      title: 'Legal notice',
      body: `## Publisher
The website **music.chapote.fr** ("Ghost Hands Sheets") is a service of Chapote, published by:
- **Publisher:** Nathan Provost, individual
- **VAT:** VAT not applicable, art. 293 B of the French General Tax Code (franchise en base)
- **Contact:** contact@chapote.fr

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
Report illegal content or abuse: abuse@chapote.fr. Exercise a right over your personal data: rgpd@chapote.fr.

The French version of this notice prevails.`,
    },
    terms: {
      title: 'Terms of sale',
      body: `These terms are a translation; the French version prevails.

## 1. Purpose
These terms govern the sale of digital sheet music (PDF files) on music.chapote.fr by Nathan Provost, individual, publisher of the Chapote service ("the Seller"), to any person placing an order ("the Buyer"). Placing an order means accepting them.

## 2. Products
Each sheet matches a piece played on one instrument in a video of the Instagram account @ghosthands.music; it is engraved from the notes played in that video. The piece page shows the instrument, the number of pages and the price. The first page can be viewed for free before buying; the following pages are shown blurred.

## 3. Prices
- Prices are in euros, all taxes included. VAT not applicable, art. 293 B of the French General Tax Code.
- When several instruments of the same piece are ordered together, a bundle price may apply; it is shown on the piece page and in the summary.
- A promo code applies under its own conditions (amount or percentage, period, number of uses). One code per order.
- The price due is the one shown in the summary when the order is confirmed.

## 4. Order
The Buyer picks one or more sheets, checks the summary (sheets, discounts, total), ticks the box requesting immediate supply of the content and accepting these terms, then pays. The order is concluded upon payment. An order with a total of zero (100 % promo code) is concluded when confirmed.

## 5. Payment
Payment is made on the secure payment page of ${STRIPE_EN}, using the methods offered there. The Seller never has access to card data.

## 6. Delivery
As soon as payment is confirmed, the sheets can be downloaded from the order confirmation page, and the download links are sent to the e-mail address provided. The links remain valid for 365 days after payment.

## 7. Right of withdrawal
Under article L221-28, 13° of the French Consumer Code, the right of withdrawal cannot be exercised for the supply of digital content not supplied on a tangible medium where performance has begun with the consumer's prior express consent and express waiver of the right of withdrawal. By ticking the box before payment, the Buyer requests immediate supply of the sheets and acknowledges losing the right of withdrawal; this consent is timestamped and kept with the order.

## 8. Licence
The purchase grants the Buyer a personal, non-exclusive right to use the sheet: view it, print it for their own use, practise and play the piece. Reselling, sharing, distributing, uploading or reproducing the sheet or the PDF file, in whole or in part, for third parties is prohibited.

## 9. Conformity and complaints
The Seller is liable for lack of conformity of digital content under articles L224-25-12 and following of the French Consumer Code. Unreadable or incomplete file, or one that does not match the piece page: write to support@chapote.fr; the Seller supplies a conforming file or, failing that, refunds the sheet concerned.

## 10. Liability
The Seller uses reasonable means to keep the website and downloads available, without guaranteeing permanent availability. The Seller is not liable for interruptions caused by third-party providers (host, Stripe, e-mail provider) or for use of the sheets contrary to article 8.

## 11. Personal data
Data needed for the order is processed as described in the privacy policy.

## 12. Governing law
These terms are governed by French law. In case of dispute, the Buyer is invited to first write to support@chapote.fr to seek an amicable solution. Failing that, the competent courts are those designated by law; a consumer may bring the case before the court of the place where they lived when ordering.`,
    },
    use: {
      title: 'Terms of use',
      body: `These terms are a translation; the French version prevails.

## 1. Purpose
These terms of use govern access to music.chapote.fr, published by Nathan Provost, individual, publisher of the Chapote service. Browsing the website means accepting them. Purchases are governed by the terms of sale.

## 2. Access
The website is freely accessible, with no account. The publisher may suspend access, in particular for maintenance, without liability.

## 3. Content
The previews (first page of each sheet, following pages blurred), the texts and the design of the website are protected. Extracting, reproducing or reusing them beyond normal browsing, or trying to obtain the blurred pages other than by buying, is prohibited.

## 4. Use of the website
Disrupting the website (mass requests, automated extraction, bypassing security measures) or using it for unlawful purposes is prohibited.

## 5. External links
The website links to third-party services (Instagram, Stripe payment page). The publisher is not responsible for their content or operation.

## 6. Changes
These terms may change; the applicable version is the one published on the website when it is consulted.

## 7. Contact
contact@chapote.fr`,
    },
    privacy: {
      title: 'Privacy policy',
      body: `This policy is a translation; the French version prevails.

## Controller
Nathan Provost, individual, publisher of the Chapote service. Contact: rgpd@chapote.fr.

## Data processed
- **Order:** sheets bought, amounts, promo code, dates, timestamp of the consent to immediate supply, payment status.
- **E-mail address:** the one you enter on the website or on the Stripe payment page, to send your download links.
- **Payment:** processed by Stripe; the website neither receives nor stores your card data.
- **Technical data:** server logs (including IP address), for security and proper operation.

The website uses no advertising cookie, no audience measurement tool, and no font or script hosted by a third party. Your browser only keeps your language and your cart (local storage), which are not sent to us.

## Purposes and legal bases
- Performing the order and delivering the sheets: performance of the contract.
- Keeping sales records: legal obligation (accounting, art. L123-22 of the French Commercial Code).
- Website security and abuse prevention: legitimate interest.

## Recipients
- **${STRIPE_EN}**: payment. Stripe may process some data outside the European Union under appropriate safeguards (standard contractual clauses).
- **OVH SAS**: hosting (servers in France) and e-mail sending (servers in the European Union).

## Retention
- Order data: 10 years (accounting obligation).
- Download links: active for 365 days after payment.

## Your rights
You have the rights of access, rectification, erasure, restriction, objection and portability, within the limits of the GDPR (sales records must be kept for the legal period). Write to rgpd@chapote.fr. You may also lodge a complaint with the CNIL (www.cnil.fr).`,
    },
  },
}
