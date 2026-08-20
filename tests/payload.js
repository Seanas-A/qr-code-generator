/**
 * Tests du contenu encodé : normalisation des URLs et format Wi-Fi.
 *
 * Le format Wi-Fi est celui décrit par le wiki ZXing, lu par iOS 11+ et Android :
 *   WIFI:T:<WPA|WEP|nopass>;S:<ssid>;P:<clé>;H:true;;
 * Les caractères \ ; , : " sont échappés par un antislash, et une valeur
 * entièrement hexadécimale est mise entre guillemets pour ne pas être prise
 * pour une suite d'octets.
 *
 * Usage : node tests/payload.js
 */
'use strict';

const path = require('path');
require(path.join(__dirname, '..', 'payload.js'));
const Payload = globalThis.Payload;

let run = 0;
let failed = 0;

function equal(label, actual, expected) {
  run++;
  if (actual !== expected) {
    failed++;
    console.log('ÉCHEC  ' + label + '\n       obtenu  : ' + JSON.stringify(actual) +
                '\n       attendu : ' + JSON.stringify(expected));
  }
}

function deepEqual(label, actual, expected) {
  equal(label, JSON.stringify(actual), JSON.stringify(expected));
}

// --- Normalisation des URLs --------------------------------------------------

equal('schéma ajouté', Payload.url('exemple.com'), 'https://exemple.com');
equal('schéma conservé', Payload.url('http://exemple.com'), 'http://exemple.com');
equal('https conservé', Payload.url('https://exemple.com/a?b=c#d'), 'https://exemple.com/a?b=c#d');
equal('espaces ignorés', Payload.url('  exemple.com  '), 'https://exemple.com');
equal('mailto conservé', Payload.url('mailto:a@b.com'), 'mailto:a@b.com');
equal('tel conservé', Payload.url('tel:+377123456'), 'tel:+377123456');
equal('chaîne vide', Payload.url(''), '');
equal('espaces seuls', Payload.url('   '), '');
// Un chemin sans schéma reste traité comme un domaine, pas comme un schéma.
equal('deux-points dans le chemin', Payload.url('exemple.com/a:b'), 'https://exemple.com/a:b');

// --- Format Wi-Fi : cas nominaux --------------------------------------------

equal('WPA simple',
  Payload.wifi({ ssid: 'MonReseau', security: 'WPA', password: 'motdepasse' }),
  'WIFI:T:WPA;S:MonReseau;P:motdepasse;;');

equal('réseau caché',
  Payload.wifi({ ssid: 'MonReseau', security: 'WPA', password: 'motdepasse', hidden: true }),
  'WIFI:T:WPA;S:MonReseau;P:motdepasse;H:true;;');

equal('réseau ouvert : pas de champ P',
  Payload.wifi({ ssid: 'WifiInvites', security: 'nopass' }),
  'WIFI:T:nopass;S:WifiInvites;;');

equal('réseau ouvert : mot de passe ignoré',
  Payload.wifi({ ssid: 'WifiInvites', security: 'nopass', password: 'inutile' }),
  'WIFI:T:nopass;S:WifiInvites;;');

equal('WEP',
  Payload.wifi({ ssid: 'VieuxRouteur', security: 'WEP', password: 'abcde' }),
  'WIFI:T:WEP;S:VieuxRouteur;P:abcde;;');

equal('sécurité inconnue : repli sur WPA',
  Payload.wifi({ ssid: 'X', security: 'WPA4-quantique', password: 'motdepasse' }),
  'WIFI:T:WPA;S:X;P:motdepasse;;');

equal('SSID vide', Payload.wifi({ ssid: '', security: 'WPA', password: 'x' }), '');
equal('SSID espaces seuls', Payload.wifi({ ssid: '  ', security: 'WPA', password: 'x' }), '');
equal('mot de passe vide : champ P omis',
  Payload.wifi({ ssid: 'X', security: 'WPA', password: '' }),
  'WIFI:T:WPA;S:X;;');

// --- Format Wi-Fi : échappement ---------------------------------------------

equal('point-virgule échappé',
  Payload.wifi({ ssid: 'a;b', security: 'WPA', password: 'p;q' }),
  'WIFI:T:WPA;S:a\\;b;P:p\\;q;;');

equal('deux-points échappé',
  Payload.wifi({ ssid: 'a:b', security: 'WPA', password: 'p:q' }),
  'WIFI:T:WPA;S:a\\:b;P:p\\:q;;');

equal('virgule échappée',
  Payload.wifi({ ssid: 'a,b', security: 'WPA', password: 'p,q' }),
  'WIFI:T:WPA;S:a\\,b;P:p\\,q;;');

equal('guillemet échappé',
  Payload.wifi({ ssid: 'a"b', security: 'WPA', password: 'p"q' }),
  'WIFI:T:WPA;S:a\\"b;P:p\\"q;;');

// Un antislash devient \\ — et surtout ne doit pas dégénérer en \\\\.
equal('antislash échappé une seule fois',
  Payload.wifi({ ssid: 'a\\b', security: 'WPA', password: 'p\\q' }),
  'WIFI:T:WPA;S:a\\\\b;P:p\\\\q;;');

// Piège du double échappement : l'antislash inséré pour « ; » ne doit pas être
// réinterprété comme un antislash à échapper.
equal('antislash suivi d\'un point-virgule',
  Payload.wifi({ ssid: 'a\\;b', security: 'WPA', password: 'motdepasse' }),
  'WIFI:T:WPA;S:a\\\\\\;b;P:motdepasse;;');

equal('tous les caractères spéciaux',
  Payload.wifi({ ssid: '\\;,":', security: 'WPA', password: 'motdepasse' }),
  'WIFI:T:WPA;S:\\\\\\;\\,\\"\\:;P:motdepasse;;');

equal('accents conservés tels quels',
  Payload.wifi({ ssid: 'Café Crème', security: 'WPA', password: 'clé-privée' }),
  'WIFI:T:WPA;S:Café Crème;P:clé-privée;;');

// --- Format Wi-Fi : valeurs hexadécimales -----------------------------------

equal('SSID hexadécimal mis entre guillemets',
  Payload.wifi({ ssid: 'ABCD', security: 'WPA', password: 'motdepasse' }),
  'WIFI:T:WPA;S:"ABCD";P:motdepasse;;');

equal('clé hexadécimale mise entre guillemets',
  Payload.wifi({ ssid: 'MonReseau', security: 'WPA', password: '0123456789abcdef' }),
  'WIFI:T:WPA;S:MonReseau;P:"0123456789abcdef";;');

equal('chiffres seuls : traités comme hexadécimal',
  Payload.wifi({ ssid: '12345678', security: 'WPA', password: 'motdepasse' }),
  'WIFI:T:WPA;S:"12345678";P:motdepasse;;');

equal('non hexadécimal : pas de guillemets',
  Payload.wifi({ ssid: 'ABCDZ', security: 'WPA', password: 'motdepasse' }),
  'WIFI:T:WPA;S:ABCDZ;P:motdepasse;;');

// Un nombre impair de chiffres hexadécimaux ne peut pas former des octets :
// la valeur n'est pas ambiguë, on évite d'ajouter des guillemets inutiles.
equal('hexadécimal de longueur impaire : pas de guillemets',
  Payload.wifi({ ssid: 'abcde', security: 'WPA', password: 'motdepasse' }),
  'WIFI:T:WPA;S:abcde;P:motdepasse;;');

// --- Avertissements ----------------------------------------------------------

deepEqual('WPA valide : aucun avertissement',
  Payload.wifiWarnings({ security: 'WPA', password: 'motdepasse' }), []);
deepEqual('WPA trop court',
  Payload.wifiWarnings({ security: 'WPA', password: 'court' }),
  ['une clé WPA doit faire au moins 8 caractères']);
deepEqual('WPA trop long',
  Payload.wifiWarnings({ security: 'WPA', password: 'a'.repeat(64) }),
  ['une clé WPA ne peut pas dépasser 63 caractères']);
deepEqual('WPA sans mot de passe',
  Payload.wifiWarnings({ security: 'WPA', password: '' }), ['mot de passe manquant']);
deepEqual('WEP 5 caractères', Payload.wifiWarnings({ security: 'WEP', password: 'abcde' }), []);
deepEqual('WEP 13 caractères', Payload.wifiWarnings({ security: 'WEP', password: 'a'.repeat(13) }), []);
deepEqual('WEP 10 hexadécimaux', Payload.wifiWarnings({ security: 'WEP', password: '0123456789' }), []);
deepEqual('WEP 26 hexadécimaux', Payload.wifiWarnings({ security: 'WEP', password: 'a1'.repeat(13) }), []);
deepEqual('WEP longueur invalide',
  Payload.wifiWarnings({ security: 'WEP', password: 'abcdefg' }),
  ['une clé WEP fait 5 ou 13 caractères (ou 10 ou 26 en hexadécimal)']);
deepEqual('réseau ouvert : aucun avertissement',
  Payload.wifiWarnings({ security: 'nopass', password: '' }), []);

// --- Texte brut --------------------------------------------------------------

equal('texte inchangé', Payload.text('Bonjour le monde'), 'Bonjour le monde');
equal('texte vide', Payload.text(''), '');
equal('espaces seuls traités comme vide', Payload.text('   '), '');
equal('espaces internes conservés', Payload.text('  a  b  '), '  a  b  ');
equal('retours à la ligne conservés', Payload.text('ligne 1\nligne 2'), 'ligne 1\nligne 2');
equal('caractères spéciaux non échappés', Payload.text('a;b:c,d"e\\f'), 'a;b:c,d"e\\f');
equal('accents conservés', Payload.text('Café crème à 2 €'), 'Café crème à 2 €');

// --- Fiche contact (vCard 3.0) ----------------------------------------------

const CRLF = '\r\n';

equal('fiche complète',
  Payload.vcard({ firstName: 'Alex', lastName: 'Martin', org: 'AS Monaco',
                  phone: '+377 12 34 56 78', email: 'alex@example.com' }),
  ['BEGIN:VCARD', 'VERSION:3.0', 'N:Martin;Alex;;;', 'FN:Alex Martin', 'ORG:AS Monaco',
   'TEL;TYPE=CELL:+377 12 34 56 78', 'EMAIL;TYPE=INTERNET:alex@example.com', 'END:VCARD'].join(CRLF));

equal('champs optionnels omis',
  Payload.vcard({ firstName: 'Alex', lastName: 'Martin' }),
  ['BEGIN:VCARD', 'VERSION:3.0', 'N:Martin;Alex;;;', 'FN:Alex Martin', 'END:VCARD'].join(CRLF));

equal('prénom seul',
  Payload.vcard({ firstName: 'Alex', phone: '0600000000' }),
  ['BEGIN:VCARD', 'VERSION:3.0', 'N:;Alex;;;', 'FN:Alex',
   'TEL;TYPE=CELL:0600000000', 'END:VCARD'].join(CRLF));

equal('nom seul',
  Payload.vcard({ lastName: 'Martin' }),
  ['BEGIN:VCARD', 'VERSION:3.0', 'N:Martin;;;;', 'FN:Martin', 'END:VCARD'].join(CRLF));

equal('sans nom : rien à encoder',
  Payload.vcard({ phone: '0600000000', email: 'a@b.com' }), '');
equal('fiche vide', Payload.vcard({}), '');
equal('espaces seuls : rien à encoder', Payload.vcard({ firstName: '  ', lastName: ' ' }), '');
equal('espaces de bord retirés',
  Payload.vcard({ firstName: '  Alex  ', lastName: ' Martin ' }),
  ['BEGIN:VCARD', 'VERSION:3.0', 'N:Martin;Alex;;;', 'FN:Alex Martin', 'END:VCARD'].join(CRLF));

// Séparateurs de vCard : virgule et point-virgule doivent être échappés, sinon
// « Martin;Dupont » serait lu comme deux composants du champ N.
equal('point-virgule échappé',
  Payload.vcard({ firstName: 'Jean', lastName: 'Martin;Dupont' }),
  ['BEGIN:VCARD', 'VERSION:3.0', 'N:Martin\\;Dupont;Jean;;;', 'FN:Jean Martin\\;Dupont',
   'END:VCARD'].join(CRLF));

equal('virgule échappée',
  Payload.vcard({ firstName: 'Jean', lastName: 'Martin', org: 'AS Monaco, SA' }),
  ['BEGIN:VCARD', 'VERSION:3.0', 'N:Martin;Jean;;;', 'FN:Jean Martin',
   'ORG:AS Monaco\\, SA', 'END:VCARD'].join(CRLF));

equal('antislash échappé une seule fois',
  Payload.vcard({ firstName: 'A\\B', lastName: 'C' }),
  ['BEGIN:VCARD', 'VERSION:3.0', 'N:C;A\\\\B;;;', 'FN:A\\\\B C', 'END:VCARD'].join(CRLF));

// Un vrai retour à la ligne casserait la structure : il devient la séquence \n.
equal('retour à la ligne converti',
  Payload.vcard({ firstName: 'Alex', lastName: 'Martin', org: 'Ligne 1\nLigne 2' }),
  ['BEGIN:VCARD', 'VERSION:3.0', 'N:Martin;Alex;;;', 'FN:Alex Martin',
   'ORG:Ligne 1\\nLigne 2', 'END:VCARD'].join(CRLF));

equal('accents conservés',
  Payload.vcard({ firstName: 'Zoé', lastName: 'Lefèvre' }),
  ['BEGIN:VCARD', 'VERSION:3.0', 'N:Lefèvre;Zoé;;;', 'FN:Zoé Lefèvre', 'END:VCARD'].join(CRLF));

run++;
{
  // Le séparateur de lignes doit être CRLF, comme l'exige la spécification.
  const card = Payload.vcard({ firstName: 'Alex', lastName: 'Martin' });
  if (/[^\r]\n/.test(card)) {
    failed++;
    console.log('ÉCHEC  vCard : saut de ligne sans retour chariot (CRLF attendu)');
  }
}

run++;
{
  const card = Payload.vcard({ firstName: 'Alex', lastName: 'Martin' });
  if (!card.startsWith('BEGIN:VCARD') || !card.endsWith('END:VCARD')) {
    failed++;
    console.log('ÉCHEC  vCard : délimiteurs BEGIN/END manquants');
  }
}

deepEqual('contact complet : aucun avertissement',
  Payload.vcardWarnings({ firstName: 'Alex', phone: '0600000000', email: 'a@b.com' }), []);
deepEqual('contact sans moyen de contact',
  Payload.vcardWarnings({ firstName: 'Alex' }),
  ['ni téléphone ni e-mail : la fiche ne contiendra qu\'un nom']);
deepEqual('e-mail sans arobase',
  Payload.vcardWarnings({ firstName: 'Alex', email: 'pas-un-email' }),
  ['l\'adresse e-mail ne contient pas d\'arobase']);
deepEqual('téléphone seul : aucun avertissement',
  Payload.vcardWarnings({ firstName: 'Alex', phone: '0600000000' }), []);

// --- Structure du format -----------------------------------------------------

run++;
{
  const payload = Payload.wifi({ ssid: 'X', security: 'WPA', password: 'motdepasse' });
  if (!payload.endsWith(';;')) {
    failed++;
    console.log('ÉCHEC  le format doit se terminer par deux points-virgules : ' + JSON.stringify(payload));
  }
}

run++;
{
  // Le champ T doit venir en premier : certains lecteurs anciens l'exigent.
  const payload = Payload.wifi({ ssid: 'X', security: 'WPA', password: 'motdepasse' });
  if (!payload.startsWith('WIFI:T:')) {
    failed++;
    console.log('ÉCHEC  préfixe inattendu : ' + JSON.stringify(payload));
  }
}

console.log((failed === 0 ? 'OK' : 'ÉCHECS') + ' — ' + (run - failed) + '/' + run + ' vérifications passées');
process.exit(failed === 0 ? 0 : 1);
