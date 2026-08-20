/**
 * Verrouille l'invariant de mise en page des formulaires :
 *
 *   l'espacement vertical entre champs appartient au conteneur (via « gap »),
 *   jamais aux champs eux-mêmes (via une marge).
 *
 * Pourquoi : une marge posée sur un champ s'applique aussi quand deux champs
 * sont placés côte à côte dans une grille. Le second est alors décalé vers le
 * bas et la paire se désaligne — c'est ce qui est arrivé aux paires
 * « Prénom / Nom », « Téléphone / E-mail » et « Sécurité / Mot de passe ».
 * Tant qu'aucun champ ne porte de marge, le désalignement est impossible.
 *
 * Portée : ce test lit les feuilles de style, pas le rendu. Il empêche la
 * régression à sa source ; la vérification visuelle reste utile par ailleurs.
 *
 * Usage : node tests/layout.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

let run = 0;
let failed = 0;

function fail(message) {
  failed++;
  console.log('ÉCHEC  ' + message);
}

// Extrait les règles « sélecteur { déclarations } » d'une feuille de style.
// Analyse volontairement simple : suffisante pour ces fichiers, écrits à la main.
function parseRules(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = re.exec(withoutComments)) !== null) {
    const selector = match[1].trim();
    // On saute les en-têtes de blocs @media / @supports.
    if (selector.startsWith('@')) continue;
    rules.push({ selector: selector, body: match[2] });
  }
  return rules;
}

function stylesOf(file) {
  const content = fs.readFileSync(path.join(root, file), 'utf8');
  if (file.endsWith('.css')) return content;
  // Le fichier autonome porte ses styles dans un bloc <style>.
  const blocks = content.match(/<style>([\s\S]*?)<\/style>/g) || [];
  return blocks.join('\n');
}

// Cible un champ entier (.field, .option, .field--x) mais pas ses parties
// internes (.field__label, .option__control), dont les marges sont sans effet
// sur l'alignement puisqu'elles s'appliquent identiquement aux deux champs.
const FIELD_SELECTOR = /\.(?:field|option)\b/;
const VERTICAL_MARGIN = /margin(?:-top|-bottom)?\s*:/;

const SOURCES = ['styles.css', 'standalone-template.html'];

for (const file of SOURCES) {
  const css = stylesOf(file);
  const rules = parseRules(css);

  run++;
  if (rules.length === 0) {
    fail(file + ' : aucune règle CSS trouvée, le test ne vérifie rien');
    continue;
  }

  // 1. Aucun champ ne doit porter de marge verticale.
  for (const rule of rules) {
    const selector = rule.selector;
    if (!FIELD_SELECTOR.test(selector)) continue;
    // Le dépliant « Options avancées » n'est pas un conteneur de champs :
    // son espacement interne est explicite et sans risque d'alignement.
    if (selector.includes('.advanced')) continue;
    if (selector.includes('__')) continue;

    run++;
    const declarations = rule.body
      .split(';')
      .map((d) => d.trim())
      .filter((d) => VERTICAL_MARGIN.test(d) && !/margin\s*:\s*0/.test(d));
    if (declarations.length > 0) {
      fail(file + ' : « ' + selector + ' » pose une marge (' + declarations.join(' ; ') +
           '). L\'espacement doit venir du gap du conteneur, sinon les paires de ' +
           'champs côte à côte se désalignent.');
    }
  }

  // 2. Aucun sélecteur de frère adjacent entre champs : c'est la forme exacte
  //    qui avait introduit le décalage (.field + .field { margin-top }).
  for (const rule of rules) {
    if (!/\.(?:field|option)\b[^{]*\+/.test(rule.selector)) continue;
    run++;
    if (VERTICAL_MARGIN.test(rule.body)) {
      fail(file + ' : « ' + rule.selector + ' » espace les champs par un sélecteur ' +
           'de frère adjacent ; utiliser le gap du conteneur.');
    }
  }

  // 3. Les conteneurs doivent porter l'espacement.
  run++;
  const panelRule = rules.find((r) => r.selector.includes('[role="tabpanel"]'));
  if (!panelRule) {
    fail(file + ' : aucune règle pour [role="tabpanel"] — le conteneur des champs ' +
         'doit déclarer son propre espacement.');
  } else if (!/gap\s*:/.test(panelRule.body)) {
    fail(file + ' : [role="tabpanel"] ne déclare pas de gap.');
  }

  // 4. Les grilles de paires ne doivent pas étirer leurs cellules, pour que les
  //    champs restent calés en haut quelle que soit leur hauteur.
  for (const name of ['.row', '.options']) {
    const rule = rules.find((r) => r.selector.split(',').map((s) => s.trim()).includes(name));
    if (!rule) continue;
    run++;
    if (/display\s*:\s*grid/.test(rule.body) && !/align-items\s*:\s*start/.test(rule.body)) {
      fail(file + ' : « ' + name + ' » est une grille sans align-items: start ; ' +
           'les cellules pourraient s\'étirer et désaligner les libellés.');
    }
  }
}

console.log((failed === 0 ? 'OK' : 'ÉCHECS') + ' — ' + (run - failed) + '/' + run +
            ' vérifications de mise en page passées');
process.exit(failed === 0 ? 0 : 1);
