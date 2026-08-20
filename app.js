/**
 * Logique de l'interface : saisie (lien ou réseau Wi-Fi) -> rendu du QR code -> export.
 * Le contenu encodé est construit par payload.js, partagé avec la version autonome.
 */
(function () {
  'use strict';

  const QUIET_ZONE = 4; // marge blanche obligatoire, en modules

  const MODES = ['url', 'wifi', 'text', 'contact'];
  const tabs = {};
  const panes = {};
  MODES.forEach(function (mode) {
    tabs[mode] = document.getElementById('tab-' + mode);
    panes[mode] = document.getElementById('pane-' + mode);
  });

  const urlInput = document.getElementById('url-input');
  const ssidInput = document.getElementById('ssid-input');
  const securitySelect = document.getElementById('security-select');
  const passwordInput = document.getElementById('wifi-password');
  const hiddenCheck = document.getElementById('hidden-network');
  const freeText = document.getElementById('free-text');
  const contact = {
    firstName: document.getElementById('contact-first'),
    lastName: document.getElementById('contact-last'),
    org: document.getElementById('contact-org'),
    phone: document.getElementById('contact-phone'),
    email: document.getElementById('contact-email'),
  };

  const eccSelect = document.getElementById('ecc-select');
  const sizeRange = document.getElementById('size-range');
  const sizeOutput = document.getElementById('size-output');

  const canvas = document.getElementById('canvas');
  const preview = document.getElementById('preview');
  const placeholder = document.getElementById('placeholder');
  const status = document.getElementById('status');
  const notice = document.getElementById('notice');
  const downloadPngBtn = document.getElementById('download-png');
  const downloadSvgBtn = document.getElementById('download-svg');
  const copyPngBtn = document.getElementById('copy-png');

  let mode = 'url';
  // Dernier QR code généré, réutilisé par les exports.
  let current = null;

  // Nom lisible, dérivé de ce que contient le code.
  function slug(value) {
    return String(value).trim().replace(/[^a-zA-Z0-9.\-]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function fileBaseName() {
    if (mode === 'wifi') {
      return slug(ssidInput.value) ? 'wifi-' + slug(ssidInput.value) : 'wifi-qr';
    }
    if (mode === 'text') {
      return 'qr-texte';
    }
    if (mode === 'contact') {
      const name = slug(contact.firstName.value + '-' + contact.lastName.value);
      return name ? 'contact-' + name : 'contact';
    }
    let host = '';
    try {
      host = new URL(current.text).hostname;
    } catch (err) {
      host = '';
    }
    const hostSlug = host.replace(/[^a-zA-Z0-9.\-]/g, '');
    return hostSlug ? 'qr-' + hostSlug : 'qr-code';
  }

  function renderToCanvas(qr, targetPx) {
    const total = qr.size + QUIET_ZONE * 2;
    // Échelle entière : chaque module fait un nombre entier de pixels, donc aucun flou.
    const scale = Math.max(1, Math.floor(targetPx / total));
    const pixels = total * scale;

    canvas.width = pixels;
    canvas.height = pixels;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pixels, pixels);
    ctx.fillStyle = '#000000';
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) {
        if (qr.modules[y][x]) {
          ctx.fillRect((x + QUIET_ZONE) * scale, (y + QUIET_ZONE) * scale, scale, scale);
        }
      }
    }
    return pixels;
  }

  function buildSvg(qr, targetPx) {
    const total = qr.size + QUIET_ZONE * 2;
    const parts = [];
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) {
        if (qr.modules[y][x]) {
          parts.push('M' + (x + QUIET_ZONE) + ' ' + (y + QUIET_ZONE) + 'h1v1h-1z');
        }
      }
    }
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + targetPx + '" height="' + targetPx + '"',
      ' viewBox="0 0 ' + total + ' ' + total + '" shape-rendering="crispEdges">',
      '<rect width="' + total + '" height="' + total + '" fill="#ffffff"/>',
      '<path d="' + parts.join('') + '" fill="#000000"/>',
      '</svg>',
      '',
    ].join('\n');
  }

  function setStatus(message, isError) {
    status.textContent = message;
    status.classList.toggle('status--error', Boolean(isError));
  }

  function setNotice(message) {
    notice.textContent = message || '';
    notice.hidden = !message;
  }

  function setExportsEnabled(enabled) {
    downloadPngBtn.disabled = !enabled;
    downloadSvgBtn.disabled = !enabled;
    copyPngBtn.disabled = !enabled || !window.ClipboardItem;
  }

  function clearResult(hint, message, isError) {
    current = null;
    preview.classList.remove('preview--ready');
    placeholder.textContent = hint || 'Le QR code apparaîtra ici.';
    setExportsEnabled(false);
    setStatus(message || '', isError);
    if (!isError) setNotice('');
  }

  // Contenu à encoder selon le mode, et description affichée sous l'aperçu.
  function buildPayload() {
    if (mode === 'wifi') {
      const options = {
        ssid: ssidInput.value,
        security: securitySelect.value,
        password: passwordInput.value,
        hidden: hiddenCheck.checked,
      };
      const text = window.Payload.wifi(options);
      if (text === '') return { text: '', empty: 'Saisissez le nom du réseau.' };

      const labels = { WPA: 'WPA/WPA2/WPA3', WEP: 'WEP', nopass: 'réseau ouvert' };
      const describe = 'Réseau ' + ssidInput.value.trim() + ' · ' + labels[options.security] +
                       (options.hidden ? ' · caché' : '');
      const warnings = window.Payload.wifiWarnings(options);
      const notes = [];
      // Inutile de prévenir sur un réseau déjà ouvert : il n'y a rien à divulguer.
      if (options.security !== 'nopass') {
        notes.push('Ce code contient la clé du réseau : qui le scanne obtient l’accès.');
      }
      if (warnings.length) notes.unshift('À vérifier : ' + warnings.join(', ') + '.');
      return { text: text, describe: describe, notice: notes.join(' ') };
    }

    if (mode === 'text') {
      const raw = window.Payload.text(freeText.value);
      if (raw === '') return { text: '', empty: 'Saisissez le texte à encoder.' };
      const oneLine = raw.replace(/\s+/g, ' ').trim();
      return {
        text: raw,
        describe: oneLine.length > 40 ? oneLine.slice(0, 39) + '…' : oneLine,
        notice: '',
      };
    }

    if (mode === 'contact') {
      const fields = {
        firstName: contact.firstName.value,
        lastName: contact.lastName.value,
        org: contact.org.value,
        phone: contact.phone.value,
        email: contact.email.value,
      };
      const card = window.Payload.vcard(fields);
      if (card === '') return { text: '', empty: 'Saisissez au moins un prénom ou un nom.' };
      const who = [fields.firstName.trim(), fields.lastName.trim()].filter(Boolean).join(' ');
      const cardWarnings = window.Payload.vcardWarnings(fields);
      return {
        text: card,
        describe: 'Fiche contact · ' + who,
        notice: cardWarnings.length ? 'À vérifier : ' + cardWarnings.join(', ') + '.' : '',
      };
    }

    const url = window.Payload.url(urlInput.value);
    if (url === '') return { text: '', empty: 'Collez une adresse pour voir le QR code.' };
    return { text: url, describe: url.length > 46 ? url.slice(0, 45) + '…' : url, notice: '' };
  }

  function generate() {
    const payload = buildPayload();
    if (payload.text === '') {
      clearResult(payload.empty);
      return;
    }

    const targetPx = Number(sizeRange.value);
    let qr;
    try {
      qr = window.QRCode.encode(payload.text, eccSelect.value);
    } catch (err) {
      clearResult(null, err.message, true);
      return;
    }

    const pixels = renderToCanvas(qr, targetPx);
    current = { qr: qr, text: payload.text, targetPx: targetPx };

    preview.classList.add('preview--ready');
    canvas.setAttribute('aria-label', 'QR code : ' + payload.describe);
    setExportsEnabled(true);
    setStatus(
      payload.describe + ' · version ' + qr.version + ' · ' + qr.size + '×' + qr.size + ' modules · ' +
      'correction ' + qr.ecl + ' · ' + qr.byteLength + '/' + qr.maxBytes + ' octets · ' +
      'PNG ' + pixels + '×' + pixels + ' px'
    );
    setNotice(payload.notice);
  }

  function selectMode(next) {
    mode = next;
    Object.keys(tabs).forEach(function (key) {
      tabs[key].setAttribute('aria-selected', String(key === next));
      panes[key].hidden = key !== next;
    });
    const firstField = { url: urlInput, wifi: ssidInput, text: freeText, contact: contact.firstName };
    firstField[next].focus();
    generate();
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Laisse au navigateur le temps de démarrer le téléchargement.
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // Un léger délai évite de recalculer le QR à chaque frappe.
  let debounceTimer = null;
  function scheduleGenerate() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(generate, 120);
  }

  MODES.forEach(function (key) {
    tabs[key].addEventListener('click', function () { selectMode(key); });
  });
  // Navigation clavier entre onglets, comme attendu d'une barre d'onglets.
  document.querySelector('.tabs').addEventListener('keydown', function (event) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const next = (MODES.indexOf(mode) + step + MODES.length) % MODES.length;
    selectMode(MODES[next]);
    tabs[mode].focus();
  });

  [urlInput, ssidInput, passwordInput, freeText, contact.firstName, contact.lastName,
   contact.org, contact.phone, contact.email].forEach(function (el) {
    el.addEventListener('input', scheduleGenerate);
    el.addEventListener('keydown', function (event) {
      // Dans la zone de texte, Entrée sert à passer à la ligne.
      if (event.key === 'Enter' && el !== freeText) {
        clearTimeout(debounceTimer);
        generate();
      }
    });
  });

  hiddenCheck.addEventListener('change', generate);
  securitySelect.addEventListener('change', function () {
    // Un réseau ouvert n'a pas de mot de passe : le champ n'a plus de sens.
    const open = securitySelect.value === 'nopass';
    passwordInput.disabled = open;
    if (open) passwordInput.value = '';
    generate();
  });

  eccSelect.addEventListener('change', generate);
  sizeRange.addEventListener('input', function () {
    sizeOutput.textContent = sizeRange.value + ' px';
    generate();
  });

  downloadPngBtn.addEventListener('click', function () {
    if (!current) return;
    canvas.toBlob(function (blob) {
      triggerDownload(blob, fileBaseName() + '.png');
    }, 'image/png');
  });

  downloadSvgBtn.addEventListener('click', function () {
    if (!current) return;
    const svg = buildSvg(current.qr, current.targetPx);
    triggerDownload(new Blob([svg], { type: 'image/svg+xml' }), fileBaseName() + '.svg');
  });

  copyPngBtn.addEventListener('click', function () {
    if (!current || !window.ClipboardItem) return;
    canvas.toBlob(function (blob) {
      navigator.clipboard
        .write([new ClipboardItem({ 'image/png': blob })])
        .then(function () { setStatus('Image copiée dans le presse-papiers.'); })
        .catch(function () {
          setStatus('Copie refusée par le navigateur : utilisez le téléchargement.', true);
        });
    }, 'image/png');
  });

  sizeOutput.textContent = sizeRange.value + ' px';
  setExportsEnabled(false);
  generate();
})();
