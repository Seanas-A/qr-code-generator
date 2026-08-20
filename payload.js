/**
 * Construction du contenu encodé dans le QR code, selon le mode choisi.
 *
 * Quatre modes :
 *   - « url »     : une adresse web, normalisée pour être ouvrable.
 *   - « wifi »    : une configuration de réseau, que les téléphones reconnaissent
 *                   pour se connecter sans saisir la clé (format ZXing, lu par
 *                   iOS 11+ et Android).
 *   - « text »    : du texte brut, encodé tel quel.
 *   - « contact » : une fiche vCard 3.0, que les téléphones proposent d'ajouter
 *                   au répertoire.
 *
 * API :
 *   Payload.url(texte)                        -> 'https://...'
 *   Payload.wifi({ ssid, security, password, hidden }) -> 'WIFI:T:WPA;S:...;P:...;;'
 *   Payload.wifiWarnings({ ... })             -> [messages] (problèmes probables côté téléphone)
 *   Payload.text(texte)                       -> le texte inchangé
 *   Payload.vcard({ firstName, lastName, org, title, phone, workPhone, email,
 *                  links, street, postalCode, city, country, note }) -> 'BEGIN:VCARD...'
 *   Payload.vcardWarnings({ ... })            -> [messages]
 */
(function (global) {
  'use strict';

  // Ajoute https:// quand le schéma est absent, pour que le QR pointe vers un lien cliquable.
  function url(raw) {
    const text = String(raw).trim();
    if (text === '') return '';
    return /^[a-zA-Z][a-zA-Z0-9+.\-]*:/.test(text) ? text : 'https://' + text;
  }

  // Dans le format Wi-Fi, ces caractères délimitent les champs : ils doivent être
  // précédés d'un antislash. Une seule passe de remplacement évite le piège
  // classique du double échappement (un antislash déjà inséré re-échappé ensuite).
  function escapeValue(value) {
    return String(value).replace(/([\\;,":])/g, '\\$1');
  }

  // Une valeur entièrement hexadécimale serait prise pour une suite d'octets :
  // les guillemets forcent son interprétation comme texte. La longueur paire
  // fait partie de la condition, car un nombre impair de chiffres ne peut pas
  // former des octets : « abcde » n'est pas ambigu, inutile de le guillemeter.
  function isAmbiguousHex(text) {
    return text !== '' && text.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(text);
  }

  function encodeField(value) {
    const text = String(value);
    const escaped = escapeValue(text);
    return isAmbiguousHex(text) ? '"' + escaped + '"' : escaped;
  }

  const SECURITY_TYPES = {
    // « WPA » couvre WPA, WPA2 et WPA3 : les téléphones le traitent comme un
    // joker et négocient le protocole réellement offert par la box. Le type
    // « SAE », pourtant propre au WPA3, est mal géré par beaucoup de lecteurs.
    WPA: { tag: 'WPA', needsPassword: true },
    WEP: { tag: 'WEP', needsPassword: true },
    nopass: { tag: 'nopass', needsPassword: false },
  };

  function wifi(options) {
    const opts = options || {};
    const ssid = String(opts.ssid == null ? '' : opts.ssid);
    const security = SECURITY_TYPES[opts.security] ? opts.security : 'WPA';
    const password = String(opts.password == null ? '' : opts.password);
    const type = SECURITY_TYPES[security];

    if (ssid.trim() === '') return '';

    const parts = ['WIFI:', 'T:' + type.tag + ';', 'S:' + encodeField(ssid) + ';'];
    if (type.needsPassword && password !== '') {
      parts.push('P:' + encodeField(password) + ';');
    }
    if (opts.hidden) {
      parts.push('H:true;');
    }
    parts.push(';'); // le format se termine par deux points-virgules
    return parts.join('');
  }

  // Problèmes qui feraient échouer la connexion sur le téléphone, sans empêcher
  // la génération du code : l'utilisateur reste libre de passer outre.
  function wifiWarnings(options) {
    const opts = options || {};
    const security = SECURITY_TYPES[opts.security] ? opts.security : 'WPA';
    const password = String(opts.password == null ? '' : opts.password);
    const warnings = [];

    if (security === 'WPA') {
      if (password.length > 0 && password.length < 8) {
        warnings.push('une clé WPA doit faire au moins 8 caractères');
      }
      if (password.length > 63) {
        warnings.push('une clé WPA ne peut pas dépasser 63 caractères');
      }
    } else if (security === 'WEP') {
      const hexLengths = [10, 26];
      const asciiLengths = [5, 13];
      const isHex = /^[0-9a-fA-F]+$/.test(password);
      const validLengths = isHex ? hexLengths.concat(asciiLengths) : asciiLengths;
      if (password.length > 0 && validLengths.indexOf(password.length) === -1) {
        warnings.push('une clé WEP fait 5 ou 13 caractères (ou 10 ou 26 en hexadécimal)');
      }
    }

    if (security !== 'nopass' && password === '') {
      warnings.push('mot de passe manquant');
    }

    return warnings;
  }

  // --- Texte brut ------------------------------------------------------------

  // Encodé tel quel : ni normalisation ni découpage, c'est le mode « fourre-tout ».
  function text(raw) {
    const value = String(raw == null ? '' : raw);
    return value.trim() === '' ? '' : value;
  }

  // --- Fiche contact (vCard 3.0) ---------------------------------------------

  // vCard a ses propres règles : la virgule et le point-virgule séparent les
  // valeurs et les composants d'un champ, et un retour à la ligne doit devenir
  // la séquence littérale « \n » pour ne pas casser la structure ligne par ligne.
  function escapeVCard(value) {
    return String(value)
      .replace(/([\\,;])/g, '\\$1')
      .replace(/\r\n|\r|\n/g, '\\n');
  }

  function vcardFields(options) {
    const opts = options || {};
    const get = (key) => String(opts[key] == null ? '' : opts[key]).trim();
    // Les liens arrivent en liste : les entrées vides sont ignorées.
    const links = Array.isArray(opts.links) ? opts.links : (opts.links ? [opts.links] : []);
    return {
      firstName: get('firstName'),
      lastName: get('lastName'),
      org: get('org'),
      title: get('title'),
      phone: get('phone'),
      workPhone: get('workPhone'),
      email: get('email'),
      links: links.map((l) => String(l == null ? '' : l).trim()).filter(Boolean),
      street: get('street'),
      postalCode: get('postalCode'),
      city: get('city'),
      country: get('country'),
      note: get('note'),
    };
  }

  function vcard(options) {
    const f = vcardFields(options);

    // Sans nom, le téléphone afficherait une fiche anonyme : rien à encoder.
    if (f.firstName === '' && f.lastName === '') return '';

    const fullName = [f.firstName, f.lastName].filter(Boolean).join(' ');
    const lines = ['BEGIN:VCARD', 'VERSION:3.0'];

    // N est structuré : Nom;Prénom;Autres;Préfixe;Suffixe. FN est le nom affiché,
    // obligatoire en vCard 3.0.
    lines.push('N:' + escapeVCard(f.lastName) + ';' + escapeVCard(f.firstName) + ';;;');
    lines.push('FN:' + escapeVCard(fullName));
    if (f.org !== '') lines.push('ORG:' + escapeVCard(f.org));
    if (f.title !== '') lines.push('TITLE:' + escapeVCard(f.title));
    // CELL et WORK évitent qu'un numéro de bureau s'affiche comme mobile.
    if (f.phone !== '') lines.push('TEL;TYPE=CELL:' + escapeVCard(f.phone));
    if (f.workPhone !== '') lines.push('TEL;TYPE=WORK:' + escapeVCard(f.workPhone));
    if (f.email !== '') lines.push('EMAIL;TYPE=INTERNET:' + escapeVCard(f.email));
    // Un profil LinkedIn est une URL comme une autre : le champ standard passe
    // partout, là où l'extension X-SOCIALPROFILE n'est lue que par iOS.
    for (const link of f.links) {
      lines.push('URL:' + escapeVCard(url(link)));
    }
    // ADR compte sept composants : boîte postale, complément, rue, ville,
    // région, code postal, pays. Les inutilisés restent vides mais présents.
    if (f.street || f.city || f.postalCode || f.country) {
      lines.push('ADR;TYPE=WORK:;;' + escapeVCard(f.street) + ';' + escapeVCard(f.city) +
                 ';;' + escapeVCard(f.postalCode) + ';' + escapeVCard(f.country));
    }
    if (f.note !== '') lines.push('NOTE:' + escapeVCard(f.note));
    lines.push('END:VCARD');

    // La spécification impose CRLF comme séparateur de lignes.
    return lines.join('\r\n');
  }

  function vcardWarnings(options) {
    const f = vcardFields(options);
    const warnings = [];
    if (f.phone === '' && f.email === '') {
      warnings.push('ni téléphone ni e-mail : la fiche ne contiendra qu\'un nom');
    }
    if (f.email !== '' && f.email.indexOf('@') === -1) {
      warnings.push('l\'adresse e-mail ne contient pas d\'arobase');
    }
    return warnings;
  }

  global.Payload = {
    url,
    wifi,
    wifiWarnings,
    text,
    vcard,
    vcardWarnings,
    escapeValue,
    escapeVCard,
    SECURITY_TYPES,
  };
})(typeof window !== 'undefined' ? window : globalThis);
