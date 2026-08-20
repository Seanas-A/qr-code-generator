/**
 * Encodeur QR Code (ISO/IEC 18004) en JavaScript pur, sans dépendance.
 *
 * Mode d'encodage : byte (UTF-8) — adapté aux URLs.
 * Versions 1 à 40, niveaux de correction L / M / Q / H.
 *
 * API :
 *   QRCode.encode(texte, niveau) -> { size, version, ecl, mask, modules }
 *   modules : tableau [y][x] de booléens (true = module noir)
 */
(function (global) {
  'use strict';

  // Bits d'identification du niveau de correction dans les format bits.
  const ECC_LEVELS = {
    L: { name: 'L', formatBits: 1, index: 0 },
    M: { name: 'M', formatBits: 0, index: 1 },
    Q: { name: 'Q', formatBits: 3, index: 2 },
    H: { name: 'H', formatBits: 2, index: 3 },
  };

  // Nombre de codewords de correction par bloc, indexé [niveau][version].
  const ECC_CODEWORDS_PER_BLOCK = [
    // version : 0 (inutilisé), 1, 2, 3, ...
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // L
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28], // M
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // Q
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // H
  ];

  // Nombre de blocs de correction, indexé [niveau][version].
  const NUM_ERROR_CORRECTION_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25], // L
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49], // M
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68], // Q
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81], // H
  ];

  const PENALTY_N1 = 3;
  const PENALTY_N2 = 3;
  const PENALTY_N3 = 40;
  const PENALTY_N4 = 10;

  const MIN_VERSION = 1;
  const MAX_VERSION = 40;

  function getBit(x, i) {
    return ((x >>> i) & 1) !== 0;
  }

  // Nombre total de modules de données (hors motifs de fonction) pour une version.
  function getNumRawDataModules(ver) {
    let result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }

  // Nombre de codewords de données disponibles pour une version et un niveau.
  function getNumDataCodewords(ver, ecl) {
    return (
      Math.floor(getNumRawDataModules(ver) / 8) -
      ECC_CODEWORDS_PER_BLOCK[ecl.index][ver] * NUM_ERROR_CORRECTION_BLOCKS[ecl.index][ver]
    );
  }

  // Positions des centres des motifs d'alignement.
  function getAlignmentPatternPositions(ver) {
    if (ver === 1) return [];
    const numAlign = Math.floor(ver / 7) + 2;
    const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
    const result = [6];
    for (let pos = ver * 4 + 10; result.length < numAlign; pos -= step) {
      result.splice(1, 0, pos);
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Arithmétique dans GF(256) et Reed-Solomon
  // ---------------------------------------------------------------------------

  function reedSolomonMultiply(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
  }

  function reedSolomonComputeDivisor(degree) {
    const result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < result.length; j++) {
        result[j] = reedSolomonMultiply(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = reedSolomonMultiply(root, 0x02);
    }
    return result;
  }

  function reedSolomonComputeRemainder(data, divisor) {
    const result = divisor.map(() => 0);
    for (const b of data) {
      const factor = b ^ result.shift();
      result.push(0);
      divisor.forEach((coef, i) => {
        result[i] ^= reedSolomonMultiply(coef, factor);
      });
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Construction du flux binaire
  // ---------------------------------------------------------------------------

  function toUtf8Bytes(text) {
    if (typeof TextEncoder !== 'undefined') {
      return Array.from(new TextEncoder().encode(text));
    }
    // Repli pour les environnements sans TextEncoder.
    return Array.from(unescape(encodeURIComponent(text)), (c) => c.charCodeAt(0));
  }

  function appendBits(bitBuffer, value, len) {
    for (let i = len - 1; i >= 0; i--) {
      bitBuffer.push((value >>> i) & 1);
    }
  }

  function charCountBits(ver) {
    return ver <= 9 ? 8 : 16;
  }

  // Plus petite version capable de contenir les données.
  function chooseVersion(numBytes, ecl) {
    for (let ver = MIN_VERSION; ver <= MAX_VERSION; ver++) {
      const capacityBits = getNumDataCodewords(ver, ecl) * 8;
      const neededBits = 4 + charCountBits(ver) + numBytes * 8;
      if (neededBits <= capacityBits) return ver;
    }
    return null;
  }

  function buildCodewords(bytes, ver, ecl) {
    const bb = [];
    appendBits(bb, 0b0100, 4); // indicateur de mode « byte »
    appendBits(bb, bytes.length, charCountBits(ver));
    for (const b of bytes) appendBits(bb, b, 8);

    const dataCapacityBits = getNumDataCodewords(ver, ecl) * 8;

    // Terminateur, puis alignement sur l'octet.
    appendBits(bb, 0, Math.min(4, dataCapacityBits - bb.length));
    appendBits(bb, 0, (8 - (bb.length % 8)) % 8);

    // Octets de remplissage alternés.
    for (let padByte = 0xec; bb.length < dataCapacityBits; padByte ^= 0xec ^ 0x11) {
      appendBits(bb, padByte, 8);
    }

    const codewords = [];
    for (let i = 0; i < bb.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | bb[i + j];
      codewords.push(byte);
    }
    return codewords;
  }

  // Ajout de la correction d'erreur et entrelacement des blocs.
  function addEccAndInterleave(data, ver, ecl) {
    const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl.index][ver];
    const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl.index][ver];
    const rawCodewords = Math.floor(getNumRawDataModules(ver) / 8);
    const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    const shortBlockLen = Math.floor(rawCodewords / numBlocks);

    const blocks = [];
    const rsDiv = reedSolomonComputeDivisor(blockEccLen);
    for (let i = 0, k = 0; i < numBlocks; i++) {
      const len = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
      const dat = data.slice(k, k + len);
      k += len;
      const ecc = reedSolomonComputeRemainder(dat, rsDiv);
      if (i < numShortBlocks) dat.push(0); // remplissage pour l'entrelacement
      blocks.push(dat.concat(ecc));
    }

    const result = [];
    for (let i = 0; i < blocks[0].length; i++) {
      blocks.forEach((block, j) => {
        // On saute le remplissage ajouté aux blocs courts.
        if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) {
          result.push(block[i]);
        }
      });
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Dessin de la matrice
  // ---------------------------------------------------------------------------

  function QrMatrix(ver, ecl) {
    this.version = ver;
    this.ecl = ecl;
    this.size = ver * 4 + 17;
    this.modules = [];
    this.isFunction = [];
    for (let y = 0; y < this.size; y++) {
      this.modules.push(new Array(this.size).fill(false));
      this.isFunction.push(new Array(this.size).fill(false));
    }
  }

  QrMatrix.prototype.setFunctionModule = function (x, y, isDark) {
    this.modules[y][x] = isDark;
    this.isFunction[y][x] = true;
  };

  QrMatrix.prototype.drawFinderPattern = function (x, y) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) {
          this.setFunctionModule(xx, yy, dist !== 2 && dist !== 4);
        }
      }
    }
  };

  QrMatrix.prototype.drawAlignmentPattern = function (x, y) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  };

  QrMatrix.prototype.drawFormatBits = function (mask) {
    const data = (this.ecl.formatBits << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;

    // Première copie, autour du motif de recherche supérieur gauche.
    for (let i = 0; i <= 5; i++) this.setFunctionModule(8, i, getBit(bits, i));
    this.setFunctionModule(8, 7, getBit(bits, 6));
    this.setFunctionModule(8, 8, getBit(bits, 7));
    this.setFunctionModule(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) this.setFunctionModule(14 - i, 8, getBit(bits, i));

    // Seconde copie, en bas à gauche et en haut à droite.
    for (let i = 0; i < 8; i++) this.setFunctionModule(this.size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i++) this.setFunctionModule(8, this.size - 15 + i, getBit(bits, i));
    this.setFunctionModule(8, this.size - 8, true); // module toujours noir
  };

  QrMatrix.prototype.drawVersion = function () {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const isDark = getBit(bits, i);
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunctionModule(a, b, isDark);
      this.setFunctionModule(b, a, isDark);
    }
  };

  QrMatrix.prototype.drawFunctionPatterns = function () {
    // Motifs de synchronisation.
    for (let i = 0; i < this.size; i++) {
      this.setFunctionModule(6, i, i % 2 === 0);
      this.setFunctionModule(i, 6, i % 2 === 0);
    }

    this.drawFinderPattern(3, 3);
    this.drawFinderPattern(this.size - 4, 3);
    this.drawFinderPattern(3, this.size - 4);

    const alignPatPos = getAlignmentPatternPositions(this.version);
    const numAlign = alignPatPos.length;
    for (let i = 0; i < numAlign; i++) {
      for (let j = 0; j < numAlign; j++) {
        const isFinderCorner =
          (i === 0 && j === 0) ||
          (i === 0 && j === numAlign - 1) ||
          (i === numAlign - 1 && j === 0);
        if (!isFinderCorner) this.drawAlignmentPattern(alignPatPos[i], alignPatPos[j]);
      }
    }

    this.drawFormatBits(0); // valeurs provisoires, réécrites après le choix du masque
    this.drawVersion();
  };

  // Placement des codewords en zigzag.
  QrMatrix.prototype.drawCodewords = function (data) {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // on saute la colonne de synchronisation
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
  };

  QrMatrix.prototype.applyMask = function (mask) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
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
          default: throw new Error('Masque invalide');
        }
        if (!this.isFunction[y][x] && invert) {
          this.modules[y][x] = !this.modules[y][x];
        }
      }
    }
  };

  QrMatrix.prototype.finderPenaltyAddHistory = function (currentRunLength, runHistory) {
    if (runHistory[0] === 0) currentRunLength += this.size; // bordure claire virtuelle
    runHistory.pop();
    runHistory.unshift(currentRunLength);
  };

  QrMatrix.prototype.finderPenaltyCountPatterns = function (runHistory) {
    const n = runHistory[1];
    const core =
      n > 0 &&
      runHistory[2] === n &&
      runHistory[3] === n * 3 &&
      runHistory[4] === n &&
      runHistory[5] === n;
    return (
      (core && runHistory[0] >= n * 4 && runHistory[6] >= n ? 1 : 0) +
      (core && runHistory[6] >= n * 4 && runHistory[0] >= n ? 1 : 0)
    );
  };

  QrMatrix.prototype.finderPenaltyTerminateAndCount = function (runColor, runLength, runHistory) {
    if (runColor) {
      this.finderPenaltyAddHistory(runLength, runHistory);
      runLength = 0;
    }
    runLength += this.size; // bordure claire virtuelle
    this.finderPenaltyAddHistory(runLength, runHistory);
    return this.finderPenaltyCountPatterns(runHistory);
  };

  QrMatrix.prototype.getPenaltyScore = function () {
    let result = 0;
    const size = this.size;

    // Suites de modules de même couleur et motifs trompeurs, en lignes.
    for (let y = 0; y < size; y++) {
      let runColor = false;
      let runLen = 0;
      const runHistory = [0, 0, 0, 0, 0, 0, 0];
      for (let x = 0; x < size; x++) {
        if (this.modules[y][x] === runColor) {
          runLen++;
          if (runLen === 5) result += PENALTY_N1;
          else if (runLen > 5) result++;
        } else {
          this.finderPenaltyAddHistory(runLen, runHistory);
          if (!runColor) result += this.finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
          runColor = this.modules[y][x];
          runLen = 1;
        }
      }
      result += this.finderPenaltyTerminateAndCount(runColor, runLen, runHistory) * PENALTY_N3;
    }

    // Idem, en colonnes.
    for (let x = 0; x < size; x++) {
      let runColor = false;
      let runLen = 0;
      const runHistory = [0, 0, 0, 0, 0, 0, 0];
      for (let y = 0; y < size; y++) {
        if (this.modules[y][x] === runColor) {
          runLen++;
          if (runLen === 5) result += PENALTY_N1;
          else if (runLen > 5) result++;
        } else {
          this.finderPenaltyAddHistory(runLen, runHistory);
          if (!runColor) result += this.finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
          runColor = this.modules[y][x];
          runLen = 1;
        }
      }
      result += this.finderPenaltyTerminateAndCount(runColor, runLen, runHistory) * PENALTY_N3;
    }

    // Blocs 2x2 de même couleur.
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const color = this.modules[y][x];
        if (
          color === this.modules[y][x + 1] &&
          color === this.modules[y + 1][x] &&
          color === this.modules[y + 1][x + 1]
        ) {
          result += PENALTY_N2;
        }
      }
    }

    // Déséquilibre entre modules clairs et sombres.
    let dark = 0;
    for (const row of this.modules) {
      for (const cell of row) if (cell) dark++;
    }
    const total = size * size;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += k * PENALTY_N4;

    return result;
  };

  // ---------------------------------------------------------------------------
  // API publique
  // ---------------------------------------------------------------------------

  function encode(text, level) {
    if (typeof text !== 'string' || text.length === 0) {
      throw new Error('Texte à encoder vide');
    }
    const ecl = ECC_LEVELS[(level || 'M').toUpperCase()];
    if (!ecl) throw new Error('Niveau de correction inconnu : ' + level);

    const bytes = toUtf8Bytes(text);
    const ver = chooseVersion(bytes.length, ecl);
    if (ver === null) {
      throw new Error(
        'Texte trop long pour un QR code (' + bytes.length + ' octets au niveau ' + ecl.name + ')'
      );
    }

    const dataCodewords = buildCodewords(bytes, ver, ecl);
    const allCodewords = addEccAndInterleave(dataCodewords, ver, ecl);

    const qr = new QrMatrix(ver, ecl);
    qr.drawFunctionPatterns();
    qr.drawCodewords(allCodewords);

    // Sélection du masque minimisant le score de pénalité.
    let bestMask = 0;
    let minPenalty = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      qr.applyMask(mask);
      qr.drawFormatBits(mask);
      const penalty = qr.getPenaltyScore();
      if (penalty < minPenalty) {
        minPenalty = penalty;
        bestMask = mask;
      }
      qr.applyMask(mask); // le masquage est involutif : on l'annule
    }
    qr.applyMask(bestMask);
    qr.drawFormatBits(bestMask);

    return {
      size: qr.size,
      version: qr.version,
      ecl: ecl.name,
      mask: bestMask,
      modules: qr.modules,
      byteLength: bytes.length,
      maxBytes: getNumDataCodewords(ver, ecl) - (charCountBits(ver) === 8 ? 2 : 3),
    };
  }

  global.QRCode = {
    encode,
    MAX_VERSION,
    // Exposé pour les tests (tests/decode-roundtrip.js), pas pour l'usage courant.
    _internals: {
      ECC_LEVELS,
      ECC_CODEWORDS_PER_BLOCK,
      NUM_ERROR_CORRECTION_BLOCKS,
      getNumRawDataModules,
      getNumDataCodewords,
      getAlignmentPatternPositions,
      reedSolomonComputeDivisor,
      reedSolomonComputeRemainder,
      charCountBits,
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
