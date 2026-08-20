/**
 * Construction du contenu encodé dans le QR code, selon le mode choisi.
 *
 * Deux modes :
 *   - « url »  : une adresse web, normalisée pour être ouvrable.
 *   - « wifi » : une configuration de réseau, que les téléphones reconnaissent
 *                pour se connecter sans saisir la clé (format ZXing, lu par
 *                iOS 11+ et Android).
 *
 * API :
 *   Payload.url(texte)                        -> 'https://...'
 *   Payload.wifi({ ssid, security, password, hidden }) -> 'WIFI:T:WPA;S:...;P:...;;'
 *   Payload.wifiWarnings({ ... })             -> [messages] (problèmes probables côté téléphone)
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

  global.Payload = { url, wifi, wifiWarnings, escapeValue, SECURITY_TYPES };
})(typeof window !== 'undefined' ? window : globalThis);
