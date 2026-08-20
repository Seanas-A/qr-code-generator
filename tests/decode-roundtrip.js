/**
 * Test aller-retour : encode un texte, puis relit la matrice produite comme le
 * ferait un lecteur (démasquage, lecture zigzag, dé-entrelacement) et vérifie :
 *   - la cohérence des deux copies des « format bits » (niveau + masque) ;
 *   - un syndrome Reed-Solomon nul sur chaque bloc (mot de code valide) ;
 *   - que les données relues redonnent exactement le texte d'origine.
 *
 * Usage : node tests/decode-roundtrip.js
 */
'use strict';

const path = require('path');

require(path.join(__dirname, '..', 'qrcode.js'));
const QRCode = globalThis.QRCode;
const I = QRCode._internals;

const QUIET = 0; // la matrice renvoyée est sans marge

// --- Reconstruction de la carte des modules de fonction -----------------------

function buildFunctionMap(version) {
  const size = version * 4 + 17;
  const isFunction = [];
  for (let i = 0; i < size; i++) isFunction.push(new Array(size).fill(false));

  const mark = (x, y) => {
    if (x >= 0 && x < size && y >= 0 && y < size) isFunction[y][x] = true;
  };

  // Motifs de synchronisation.
  for (let i = 0; i < size; i++) {
    mark(6, i);
    mark(i, 6);
  }

  // Motifs de recherche + séparateurs (bloc 9x9 aux trois coins).
  const finders = [[3, 3], [size - 4, 3], [3, size - 4]];
  for (const [cx, cy] of finders) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) mark(cx + dx, cy + dy);
    }
  }

  // Motifs d'alignement.
  const pos = I.getAlignmentPatternPositions(version);
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      const corner =
        (i === 0 && j === 0) ||
        (i === 0 && j === pos.length - 1) ||
        (i === pos.length - 1 && j === 0);
      if (corner) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) mark(pos[i] + dx, pos[j] + dy);
      }
    }
  }

  // Zones des format bits.
  for (let i = 0; i <= 5; i++) mark(8, i);
  mark(8, 7); mark(8, 8); mark(7, 8);
  for (let i = 9; i < 15; i++) mark(14 - i, 8);
  for (let i = 0; i < 8; i++) mark(size - 1 - i, 8);
  for (let i = 8; i < 15; i++) mark(8, size - 15 + i);
  mark(8, size - 8);

  // Zones de la version info.
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      mark(a, b);
      mark(b, a);
    }
  }

  return isFunction;
}

// --- Lecture des format bits -------------------------------------------------

function expectedFormatBits(eclFormatBits, mask) {
  const data = (eclFormatBits << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function readFormatCopies(modules) {
  const size = modules.length;
  const bit = (x, y) => (modules[y][x] ? 1 : 0);

  let copy1 = 0;
  const put1 = (i, v) => { copy1 |= v << i; };
  for (let i = 0; i <= 5; i++) put1(i, bit(8, i));
  put1(6, bit(8, 7));
  put1(7, bit(8, 8));
  put1(8, bit(7, 8));
  for (let i = 9; i < 15; i++) put1(i, bit(14 - i, 8));

  let copy2 = 0;
  const put2 = (i, v) => { copy2 |= v << i; };
  for (let i = 0; i < 8; i++) put2(i, bit(size - 1 - i, 8));
  for (let i = 8; i < 15; i++) put2(i, bit(8, size - 15 + i));

  return { copy1, copy2 };
}

// --- Lecture des données -----------------------------------------------------

function unmask(modules, isFunction, mask) {
  const size = modules.length;
  const out = modules.map((row) => row.slice());
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (isFunction[y][x]) continue;
      let invert;
      switch (mask) {
        case 0: invert = (x + y) % 2 === 0; break;
        case 1: invert = y % 2 === 0; break;
        case 2: invert = x % 3 === 0; break;
        case 3: invert = (x + y) % 3 === 0; break;
        case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        case 7: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        default: throw new Error('masque invalide');
      }
      if (invert) out[y][x] = !out[y][x];
    }
  }
  return out;
}

function readCodewords(modules, isFunction, numCodewords) {
  const size = modules.length;
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && bits.length < numCodewords * 8) {
          bits.push(modules[y][x] ? 1 : 0);
        }
      }
    }
  }
  const out = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    out.push(b);
  }
  return out;
}

// Inverse de l'entrelacement : reconstitue les blocs, puis les données.
function deinterleave(all, version, ecl) {
  const numBlocks = I.NUM_ERROR_CORRECTION_BLOCKS[ecl.index][version];
  const blockEccLen = I.ECC_CODEWORDS_PER_BLOCK[ecl.index][version];
  const rawCodewords = Math.floor(I.getNumRawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);

  const blocks = [];
  for (let i = 0; i < numBlocks; i++) {
    const dataLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
    blocks.push({ dataLen, cells: new Array(shortBlockLen + (i < numShortBlocks ? 0 : 1)).fill(null) });
  }

  // Même ordre de parcours que l'entrelacement, en sens inverse.
  // À l'encodage, les blocs courts reçoivent un octet de remplissage à
  // l'index padIndex : il n'est pas émis, et décale d'un cran leurs codewords
  // de correction dans le flux.
  const padIndex = shortBlockLen - blockEccLen;
  let k = 0;
  for (let i = 0; i < shortBlockLen + 1; i++) {
    for (let j = 0; j < numBlocks; j++) {
      const isShort = j < numShortBlocks;
      if (i === padIndex && isShort) continue; // remplissage absent du flux
      const idx = i > padIndex && isShort ? i - 1 : i;
      if (idx >= blocks[j].cells.length) continue;
      blocks[j].cells[idx] = all[k++];
    }
  }

  return { blocks, blockEccLen };
}

// --- Décodage du segment « byte » -------------------------------------------

function decodeByteSegment(dataCodewords, version) {
  const bits = [];
  for (const b of dataCodewords) {
    for (let i = 7; i >= 0; i--) bits.push((b >>> i) & 1);
  }
  let p = 0;
  const take = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | bits[p++];
    return v;
  };
  const mode = take(4);
  if (mode !== 0b0100) throw new Error('mode inattendu : ' + mode.toString(2));
  const len = take(I.charCountBits(version));
  const bytes = [];
  for (let i = 0; i < len; i++) bytes.push(take(8));
  return Buffer.from(bytes).toString('utf8');
}

// --- Vérification complète ---------------------------------------------------

function verify(text, level) {
  const qr = QRCode.encode(text, level);
  const ecl = I.ECC_LEVELS[level];
  const problems = [];

  // 1. Format bits : les deux copies doivent coder (niveau, masque) annoncés.
  const expected = expectedFormatBits(ecl.formatBits, qr.mask);
  const { copy1, copy2 } = readFormatCopies(qr.modules);
  if (copy1 !== expected) problems.push('format bits copie 1 = ' + copy1 + ' au lieu de ' + expected);
  if (copy2 !== expected) problems.push('format bits copie 2 = ' + copy2 + ' au lieu de ' + expected);

  // 2. Relecture des codewords.
  const isFunction = buildFunctionMap(qr.version);
  const clean = unmask(qr.modules, isFunction, qr.mask);
  const rawCodewords = Math.floor(I.getNumRawDataModules(qr.version) / 8);
  const all = readCodewords(clean, isFunction, rawCodewords);
  const { blocks, blockEccLen } = deinterleave(all, qr.version, ecl);

  // 3. Syndrome Reed-Solomon nul sur chaque bloc.
  const divisor = I.reedSolomonComputeDivisor(blockEccLen);
  blocks.forEach((block, idx) => {
    if (block.cells.some((c) => c === null)) {
      problems.push('bloc ' + idx + ' incomplet après dé-entrelacement');
      return;
    }
    const rem = I.reedSolomonComputeRemainder(block.cells, divisor);
    if (rem.some((v) => v !== 0)) problems.push('syndrome RS non nul sur le bloc ' + idx);
  });

  // 4. Données relues == texte d'origine.
  const dataCodewords = [];
  for (const block of blocks) dataCodewords.push(...block.cells.slice(0, block.dataLen));
  let decoded = null;
  try {
    decoded = decodeByteSegment(dataCodewords, qr.version);
  } catch (err) {
    problems.push('décodage impossible : ' + err.message);
  }
  if (decoded !== null && decoded !== text) {
    problems.push('texte relu différent (longueur ' + decoded.length + ' vs ' + text.length + ')');
  }

  return { qr, problems };
}

// --- Jeu de tests ------------------------------------------------------------

const LEVELS = ['L', 'M', 'Q', 'H'];
let run = 0;
let failed = 0;

function check(label, text, level) {
  run++;
  let result;
  try {
    result = verify(text, level);
  } catch (err) {
    failed++;
    console.log('ÉCHEC  ' + label + ' [' + level + '] : exception ' + err.message);
    return;
  }
  if (result.problems.length > 0) {
    failed++;
    console.log('ÉCHEC  ' + label + ' [' + level + ', v' + result.qr.version + '] : ' + result.problems.join(' ; '));
  }
}

// URLs réalistes, dont UTF-8 et caractères réservés.
const urls = [
  'https://a.co',
  'https://exemple.com/ma-page',
  'https://www.exemple.com/fr/billetterie?ref=affiche&utm_source=qr',
  'https://example.com/recherche?q=caf%C3%A9+cr%C3%A8me&page=2#résultats',
  'https://sub.domaine.example.org/très/long/chemin/avec-accents-éàü/et_underscores',
  'mailto:contact@example.com?subject=Bonjour',
  'tel:+33612345678',
];
for (const url of urls) {
  for (const level of LEVELS) check('url ' + url.slice(0, 32), url, level);
}

// Toutes les versions, remplies à ras bord puis à la capacité - 1.
for (const level of LEVELS) {
  let n = 1;
  const seen = new Set();
  while (true) {
    const probe = QRCode.encode('A'.repeat(n), level);
    const cap = probe.maxBytes;
    const full = QRCode.encode('A'.repeat(cap), level);
    if (seen.has(full.version)) break; // sécurité anti-boucle
    seen.add(full.version);
    check('capacité pleine v' + full.version, 'A'.repeat(cap), level);
    if (cap > 1) check('capacité -1 v' + full.version, 'A'.repeat(cap - 1), level);
    if (full.version >= QRCode.MAX_VERSION) break;
    n = cap + 1;
  }
  if (seen.size !== 40) {
    failed++;
    console.log('ÉCHEC  niveau ' + level + ' : ' + seen.size + ' versions atteintes au lieu de 40');
  }
  run++;
}

// Dépassement de capacité : doit lever une erreur explicite.
run++;
try {
  QRCode.encode('A'.repeat(2954), 'L');
  failed++;
  console.log('ÉCHEC  dépassement de capacité : aucune erreur levée');
} catch (err) {
  if (!/trop long/.test(err.message)) {
    failed++;
    console.log('ÉCHEC  dépassement de capacité : message inattendu « ' + err.message + ' »');
  }
}

// Le fichier autonome doit embarquer la version courante de chaque source injectée.
{
  const fs = require('fs');
  const single = path.join(__dirname, '..', 'qr-code-generator.html');
  run++;
  if (!fs.existsSync(single)) {
    failed++;
    console.log('ÉCHEC  qr-code-generator.html absent : lancer « node build-standalone.js »');
  } else {
    const html = fs.readFileSync(single, 'utf8');
    for (const source of ['qrcode.js', 'payload.js']) {
      run++;
      const code = fs.readFileSync(path.join(__dirname, '..', source), 'utf8').trimEnd();
      if (!html.includes(code)) {
        failed++;
        console.log('ÉCHEC  qr-code-generator.html ne contient pas la version courante de ' +
                    source + ' : relancer « node build-standalone.js »');
      }
    }
  }
}

console.log((failed === 0 ? 'OK' : 'ÉCHECS') + ' — ' + (run - failed) + '/' + run + ' vérifications passées');
process.exit(failed === 0 ? 0 : 1);
