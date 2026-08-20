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
equal('tel conservé', Payload.url('tel:+33612345678'), 'tel:+33612345678');
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
  Payload.vcard({ firstName: 'John', lastName: 'Doe', org: 'Ma société',
                  phone: '+33 6 12 34 56 78', email: 'john.doe@exemple.com' }),
  ['BEGIN:VCARD', 'VERSION:3.0', 'N:Doe;John;;;', 'FN:John Doe', 'ORG:Ma société',
   'TEL;TYPE=CELL:+33 6 12 34 56 78', 'EMAIL;TYPE=INTERNET:john.doe@exemple.com', 'END:VCARD'].join(CRLF));

equal('champs optionnels omis',
  Payload.vcard({ firstName: 'John', lastName: 'Doe' }),
  ['BEGIN:VCARD', 'VERSION:3.0', 'N:Doe;John;;;', 'FN:John Doe', 'END:VCARD'].join(CRLF));

equal('prénom seul',
  Payload.vcard({ firstName: 'John', phone: '0600000000' }),
  ['BEGIN:VCARD', 'VERSION:3.0', 'N:;John;;;', 'FN:John',
   'TEL;TYPE=CELL:0600000000', 'END:VCARD'].join(CRLF));

equal('nom seul',
  Payload.vcard({ lastName: 'Doe' }),
  ['BEGIN:VCARD', 'VERSION:3.0', 'N:Doe;;;;', 'FN:Doe', 'END:VCARD'].join(CRLF));

equal('sans nom : rien à encoder',
  Payload.vcard({ phone: '0600000000', email: 'a@b.com' }), '');
equal('fiche vide', Payload.vcard({}), '');
equal('espaces seuls : rien à encoder', Payload.vcard({ firstName: '  ', lastName: ' ' }), '');
equal('espaces de bord retirés',
  Payload.vcard({ firstName: '  John  ', lastName: ' Doe ' }),
  ['BEGIN:VCARD', 'VERSION:3.0', 'N:Doe;John;;;', 'FN:John Doe', 'END:VCARD'].join(CRLF));

// Séparateurs de vCard : virgule et point-virgule doivent être échappés, sinon
// « Doe;Dupont » serait lu comme deux composants du champ N.
equal('point-virgule échappé',
  Payload.vcard({ firstName: 'Jean', lastName: 'Doe;Dupont' }),
  ['BEGIN:VCARD', 'VERSION:3.0', 'N:Doe\\;Dupont;Jean;;;', 'FN:Jean Doe\\;Dupont',
   'END:VCARD'].join(CRLF));

equal('virgule échappée',
  Payload.vcard({ firstName: 'Jean', lastName: 'Doe', org: 'Ma société, SA' }),
  ['BEGIN:VCARD', 'VERSION:3.0', 'N:Doe;Jean;;;', 'FN:Jean Doe',
   'ORG:Ma société\\, SA', 'END:VCARD'].join(CRLF));

equal('antislash échappé une seule fois',
  Payload.vcard({ firstName: 'A\\B', lastName: 'C' }),
  ['BEGIN:VCARD', 'VERSION:3.0', 'N:C;A\\\\B;;;', 'FN:A\\\\B C', 'END:VCARD'].join(CRLF));

// Un vrai retour à la ligne casserait la structure : il devient la séquence \n.
equal('retour à la ligne converti',
  Payload.vcard({ firstName: 'John', lastName: 'Doe', org: 'Ligne 1\nLigne 2' }),
  ['BEGIN:VCARD', 'VERSION:3.0', 'N:Doe;John;;;', 'FN:John Doe',
   'ORG:Ligne 1\\nLigne 2', 'END:VCARD'].join(CRLF));

equal('accents conservés',
  Payload.vcard({ firstName: 'Zoé', lastName: 'Lefèvre' }),
  ['BEGIN:VCARD', 'VERSION:3.0', 'N:Lefèvre;Zoé;;;', 'FN:Zoé Lefèvre', 'END:VCARD'].join(CRLF));

run++;
{
  // Le séparateur de lignes doit être CRLF, comme l'exige la spécification.
  const card = Payload.vcard({ firstName: 'John', lastName: 'Doe' });
  if (/[^\r]\n/.test(card)) {
    failed++;
    console.log('ÉCHEC  vCard : saut de ligne sans retour chariot (CRLF attendu)');
  }
}

run++;
{
  const card = Payload.vcard({ firstName: 'John', lastName: 'Doe' });
  if (!card.startsWith('BEGIN:VCARD') || !card.endsWith('END:VCARD')) {
    failed++;
    console.log('ÉCHEC  vCard : délimiteurs BEGIN/END manquants');
  }
}

deepEqual('contact complet : aucun avertissement',
  Payload.vcardWarnings({ firstName: 'John', phone: '0600000000', email: 'a@b.com' }), []);
deepEqual('contact sans moyen de contact',
  Payload.vcardWarnings({ firstName: 'John' }),
  ['ni téléphone ni e-mail : la fiche ne contiendra qu\'un nom']);
deepEqual('e-mail sans arobase',
  Payload.vcardWarnings({ firstName: 'John', email: 'pas-un-email' }),
  ['l\'adresse e-mail ne contient pas d\'arobase']);
deepEqual('téléphone seul : aucun avertissement',
  Payload.vcardWarnings({ firstName: 'John', phone: '0600000000' }), []);

// --- Fiche contact : champs étendus -----------------------------------------

equal('fonction',
  Payload.vcard({ firstName: 'John', lastName: 'Doe', title: 'Directeur technique' }),
  ['BEGIN:VCARD', 'VERSION:3.0', 'N:Doe;John;;;', 'FN:John Doe',
   'TITLE:Directeur technique', 'END:VCARD'].join(CRLF));

// Deux types distincts, pour qu'un fixe ne s'affiche pas comme mobile.
equal('mobile et bureau distingués',
  Payload.vcard({ firstName: 'John', lastName: 'Doe', phone: '0600000000', workPhone: '0100000000' }),
  ['BEGIN:VCARD', 'VERSION:3.0', 'N:Doe;John;;;', 'FN:John Doe',
   'TEL;TYPE=CELL:0600000000', 'TEL;TYPE=WORK:0100000000', 'END:VCARD'].join(CRLF));

equal('bureau seul',
  Payload.vcard({ firstName: 'John', lastName: 'Doe', workPhone: '0100000000' }),
  ['BEGIN:VCARD', 'VERSION:3.0', 'N:Doe;John;;;', 'FN:John Doe',
   'TEL;TYPE=WORK:0100000000', 'END:VCARD'].join(CRLF));

// Les liens sont normalisés comme les URLs du mode « site web ».
equal('liens multiples, schéma ajouté',
  Payload.vcard({ firstName: 'John', lastName: 'Doe',
                  links: ['linkedin.com/in/john-doe', 'https://exemple.com'] }),
  ['BEGIN:VCARD', 'VERSION:3.0', 'N:Doe;John;;;', 'FN:John Doe',
   'URL:https://linkedin.com/in/john-doe', 'URL:https://exemple.com', 'END:VCARD'].join(CRLF));

equal('liens vides ignorés',
  Payload.vcard({ firstName: 'John', lastName: 'Doe', links: ['', '   ', 'exemple.com', null] }),
  ['BEGIN:VCARD', 'VERSION:3.0', 'N:Doe;John;;;', 'FN:John Doe',
   'URL:https://exemple.com', 'END:VCARD'].join(CRLF));

equal('lien unique accepté hors tableau',
  Payload.vcard({ firstName: 'John', lastName: 'Doe', links: 'exemple.com' }),
  ['BEGIN:VCARD', 'VERSION:3.0', 'N:Doe;John;;;', 'FN:John Doe',
   'URL:https://exemple.com', 'END:VCARD'].join(CRLF));

equal('aucun lien : pas de champ URL',
  Payload.vcard({ firstName: 'John', lastName: 'Doe', links: [] }),
  ['BEGIN:VCARD', 'VERSION:3.0', 'N:Doe;John;;;', 'FN:John Doe', 'END:VCARD'].join(CRLF));

// ADR a sept composants : boîte postale;complément;rue;ville;région;code postal;pays
equal('adresse complète',
  Payload.vcard({ firstName: 'John', lastName: 'Doe', street: '12 rue des Fleurs',
                  city: 'Paris', postalCode: '75001', country: 'France' }),
  ['BEGIN:VCARD', 'VERSION:3.0', 'N:Doe;John;;;', 'FN:John Doe',
   'ADR;TYPE=WORK:;;12 rue des Fleurs;Paris;;75001;France', 'END:VCARD'].join(CRLF));

equal('adresse partielle : composants vides conservés',
  Payload.vcard({ firstName: 'John', lastName: 'Doe', city: 'Monaco' }),
  ['BEGIN:VCARD', 'VERSION:3.0', 'N:Doe;John;;;', 'FN:John Doe',
   'ADR;TYPE=WORK:;;;Monaco;;;', 'END:VCARD'].join(CRLF));

equal('aucune adresse : pas de champ ADR',
  Payload.vcard({ firstName: 'John', lastName: 'Doe', street: '  ' }),
  ['BEGIN:VCARD', 'VERSION:3.0', 'N:Doe;John;;;', 'FN:John Doe', 'END:VCARD'].join(CRLF));

equal('note',
  Payload.vcard({ firstName: 'John', lastName: 'Doe', note: 'Rencontré au salon' }),
  ['BEGIN:VCARD', 'VERSION:3.0', 'N:Doe;John;;;', 'FN:John Doe',
   'NOTE:Rencontré au salon', 'END:VCARD'].join(CRLF));

// Une virgule dans une adresse ou une note doit être échappée comme ailleurs.
equal('virgule échappée dans l\'adresse et la note',
  Payload.vcard({ firstName: 'John', lastName: 'Doe', street: '12, rue des Fleurs',
                  note: 'Bureau 3, étage 2' }),
  ['BEGIN:VCARD', 'VERSION:3.0', 'N:Doe;John;;;', 'FN:John Doe',
   'ADR;TYPE=WORK:;;12\\, rue des Fleurs;;;;', 'NOTE:Bureau 3\\, étage 2', 'END:VCARD'].join(CRLF));

// L'ordre des champs doit rester stable : il conditionne la lisibilité du VCF.
run++;
{
  const carte = Payload.vcard({
    firstName: 'John', lastName: 'Doe', org: 'Ma société', title: 'Directeur',
    phone: '06', workPhone: '01', email: 'a@b.com', links: ['exemple.com'],
    street: 'Rue', city: 'Paris', postalCode: '75001', country: 'France', note: 'Note',
  });
  const attendu = ['BEGIN:VCARD', 'VERSION:3.0', 'N:', 'FN:', 'ORG:', 'TITLE:',
                   'TEL;TYPE=CELL:', 'TEL;TYPE=WORK:', 'EMAIL', 'URL:', 'ADR', 'NOTE:', 'END:VCARD'];
  const lignes = carte.split(CRLF);
  const ordreOk = lignes.length === attendu.length &&
                  attendu.every((prefixe, i) => lignes[i].startsWith(prefixe));
  if (!ordreOk) {
    failed++;
    console.log('ÉCHEC  ordre des champs de la vCard inattendu :\n       ' + lignes.join(' | '));
  }
}

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
