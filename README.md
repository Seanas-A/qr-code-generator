# Générateur de QR code

Deux modes, un QR code téléchargeable en PNG ou SVG :

- **Site web** — un lien à partager ou à imprimer.
- **Réseau Wi-Fi** — le téléphone lit le réseau et la clé, puis se connecte seul. Plus besoin
  de dicter le mot de passe aux invités.

Tout est calculé dans le navigateur : aucune requête réseau, aucune dépendance, aucun CDN.
L'encodeur QR (ISO/IEC 18004) est écrit à la main dans `qrcode.js`.

Le projet existe sous deux formes, qui partagent le même encodeur et la même construction de
contenu (`payload.js`).

## 1. Fichier unique — `qr-code-generator.html`

**C'est la version à envoyer aux gens.** Un seul fichier de 38 Ko, HTML + CSS + JS compris,
qu'on ouvre par double-clic. Il fonctionne dans un train, sur une clé USB, en pièce jointe :
comme il n'appelle aucun CDN, il n'a rien à télécharger pour s'afficher.

Interface volontairement réduite : deux onglets, les champs utiles, trois boutons. La correction
d'erreur est fixée à M (15 %) et l'image exportée fait environ 1 000 px, ce qui convient à
l'impression.

Ce fichier est **généré**, jamais édité à la main :

```bash
node build-standalone.js
```

Le script injecte `qrcode.js` et `payload.js` dans `standalone-template.html`, pour qu'il
n'existe qu'une seule copie de ce code à maintenir — celle que les tests couvrent. Pour modifier
l'apparence ou l'interface du fichier unique, éditer `standalone-template.html` puis relancer la
commande.

## 2. Application complète — `index.html`

Même chose avec les réglages fins : choix du niveau de correction d'erreur (L 7 % → H 30 %) et
de la taille d'export. S'ouvre aussi par double-clic ; pour la servir :

```bash
python3 -m http.server 8123
```

## Le mode Wi-Fi

Le contenu encodé suit le format reconnu par iOS 11+ et Android :

```
WIFI:T:WPA;S:Livebox-A1B2;P:MaCle2026;H:true;;
```

Trois paramètres suffisent — nom du réseau, type de sécurité, mot de passe — plus une case pour
les réseaux cachés. Trois pièges sont traités, et ce sont eux qui font échouer la plupart des
générateurs approximatifs :

- **WPA3.** Le type déclaré reste `WPA`, jamais `SAE`. Les téléphones traitent `WPA` comme un
  joker et négocient le protocole réellement offert par la box, alors que `SAE` — pourtant le
  nom de la poignée de main WPA3 — est rejeté par beaucoup de lecteurs.
- **Caractères spéciaux.** `\ ; , : "` délimitent les champs et sont échappés par un antislash,
  en une seule passe de remplacement : échapper les antislashs après les points-virgules
  produirait des doubles échappements et une clé erronée.
- **Valeurs hexadécimales.** Une clé comme `0123456789ab` serait prise pour une suite d'octets ;
  elle est donc mise entre guillemets. La longueur paire fait partie de la condition, un nombre
  impair de chiffres ne pouvant pas former des octets.

Le champ « réseau caché » compte : sans lui, un téléphone ne trouvera pas un SSID non diffusé.
L'interface signale aussi les clés qui feront échouer la connexion (moins de 8 caractères en
WPA, longueur invalide en WEP) sans empêcher la génération.

Un rappel affiché sous le code : **il contient la clé en clair**. C'est tout l'intérêt du
procédé, mais un QR Wi-Fi affiché en vitrine ou publié sur une photo donne l'accès au réseau à
qui le scanne — pensez à un réseau invités séparé si l'affichage est public.

## Fonctionnement

- Normalisation de l'URL : `exemple.com` devient `https://exemple.com`, pour que le QR pointe
  vers un lien réellement ouvrable.
- Rendu à échelle entière (un module = un nombre entier de pixels) pour éviter tout flou. La
  taille obtenue est donc le multiple immédiatement inférieur à la taille demandée, et c'est la
  taille réelle qui est affichée sous l'aperçu.
- Export PNG (matriciel) et SVG (vectoriel, net à n'importe quelle taille), plus copie dans le
  presse-papiers. Le nom du fichier reprend le domaine ou le réseau : `qr-asmonaco.com.png`,
  `wifi-Livebox-A1B2.svg`.
- Marge blanche de 4 modules incluse dans les exports, comme l'exige la spécification.
- Thèmes clair et sombre suivant le réglage du système.

## Structure

| Fichier | Rôle |
| --- | --- |
| `qr-code-generator.html` | Version autonome, générée — le livrable à partager |
| `standalone-template.html` | Source de la version autonome (HTML + CSS + interface) |
| `build-standalone.js` | Génère `qr-code-generator.html` en y injectant `qrcode.js` et `payload.js` |
| `qrcode.js` | Encodeur QR : versions 1 à 40, mode byte (UTF-8), Reed-Solomon, choix du masque |
| `payload.js` | Contenu encodé : normalisation des URLs, format Wi-Fi, échappement |
| `index.html`, `styles.css`, `app.js` | Application complète, avec réglages |
| `tests/decode-roundtrip.js` | Tests de l'encodeur QR |
| `tests/payload.js` | Tests des URLs et du format Wi-Fi |

## Tests

```bash
node tests/decode-roundtrip.js && node tests/payload.js
```

Le test relit chaque matrice produite comme le ferait un lecteur — démasquage, lecture en
zigzag, dé-entrelacement des blocs — et vérifie trois choses : la cohérence des deux copies des
*format bits*, un syndrome Reed-Solomon nul sur chaque bloc (mot de code valide), et que les
données relues redonnent exactement le texte d'origine. Couverture : les 40 versions × 4 niveaux
de correction, à capacité pleine et pleine − 1, plus des URLs réalistes (UTF-8, caractères
réservés, `mailto:`, `tel:`) et le dépassement de capacité. Le test échoue aussi si
`qr-code-generator.html` n'a pas été régénéré après une modification de `qrcode.js`.

`tests/payload.js` couvre la normalisation des URLs et le format Wi-Fi : chaque caractère spécial
échappé isolément, le piège du double échappement (`a\;b`), les valeurs hexadécimales, les
réseaux ouverts et cachés, les longueurs de clé invalides.

Les codes ont par ailleurs été décodés avec le lecteur natif du navigateur (`BarcodeDetector`)
jusqu'à la version 28 : aperçu à l'écran, PNG et SVG exportés, et payloads Wi-Fi relus caractère
pour caractère — y compris un SSID contenant `;` et une clé contenant `:` et `,`. Au-delà de la
version 28, ce lecteur échoue sur des matrices aussi denses ; le test de relecture reste
concluant sur toute la plage. En pratique un lien ou un réseau tient dans les versions basses
(une URL de 41 octets donne une version 4), là où tous les lecteurs sont fiables.

## Limites connues

- Encodage en mode *byte* uniquement. Une URL entièrement en majuscules pourrait tenir dans un
  code un peu plus petit via le mode alphanumérique ; ce n'est pas implémenté.
- Capacité maximale : 2 953 octets au niveau L (version 40).
- Wi-Fi d'entreprise (WPA2-EAP, avec identifiant et méthode d'authentification) non pris en
  charge : le format prévoit des champs supplémentaires (`E:`, `I:`, `A:`, `PH2:`) que les
  téléphones interprètent de façon inégale. Les modes proposés couvrent les réseaux
  domestiques et les réseaux invités.
- La connexion réelle d'un téléphone n'a pas pu être testée ici : ce qui est vérifié, c'est que
  le contenu encodé est relu à l'identique et qu'il respecte le format documenté.
- La copie dans le presse-papiers nécessite `ClipboardItem` (le bouton est désactivé sinon) et
  reste soumise à l'autorisation du navigateur ; en cas de refus, un message renvoie vers le
  téléchargement. Contrairement aux exports PNG et SVG, ce bouton n'a pas pu être validé
  automatiquement, l'écriture presse-papiers exigeant un onglet au premier plan.
