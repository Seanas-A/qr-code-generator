/**
 * Génère qr-code-generator.html : un fichier unique et autonome, obtenu en
 * injectant qrcode.js et payload.js dans standalone-template.html.
 *
 * Passer par ce script évite d'entretenir deux copies de ce code : le fichier
 * livré contient toujours exactement les sources couvertes par les tests.
 *
 * Usage : node build-standalone.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const OUTPUT = 'qr-code-generator.html';
const SOURCES = ['qrcode.js', 'payload.js'];

let html = fs.readFileSync(path.join(root, 'standalone-template.html'), 'utf8');

for (const source of SOURCES) {
  const marker = '/* <!-- INJECT:' + source + ' --> */';
  if (!html.includes(marker)) {
    console.error('Marqueur « ' + marker + ' » absent de standalone-template.html');
    process.exit(1);
  }

  const code = fs.readFileSync(path.join(root, source), 'utf8');

  // Un </script> à l'intérieur du code injecté fermerait la balise trop tôt.
  if (/<\/script/i.test(code)) {
    console.error(source + ' contient une balise </script> : injection impossible en l\'état');
    process.exit(1);
  }

  const header =
    '/* Copie de ' + source + ', intégrée par build-standalone.js.\n' +
    '   Ne pas modifier ici : éditer ' + source + ' puis relancer « node build-standalone.js ». */\n';

  html = html.replace(marker, header + code.trimEnd());
}

fs.writeFileSync(path.join(root, OUTPUT), html);

const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
console.log(OUTPUT + ' généré (' + kb + ' Ko, aucune dépendance externe) — sources : ' + SOURCES.join(', '));
