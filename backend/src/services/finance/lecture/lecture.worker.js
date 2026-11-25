'use strict';
// NJ FINANCE — lot F7 : lecture d'une pièce, dans un fil d'exécution séparé
// (worker_threads) pour ne jamais bloquer le serveur. Un fil par pièce : il est
// arrêté à la fin (ou au délai maximal), la mémoire de l'OCR est rendue.
//
// Entrée (workerData) : { contenu: Buffer, mime }
// Sortie (postMessage) : { ok: true, moteur, texte, confiance, pages } | { ok: false, message }
//
//  • PDF numérique : texte de pdf.js, lignes reconstituées par position verticale.
//  • PDF scanné (pas de texte) : les images de chaque page sont extraites, mises
//    en PNG, puis lues par OCR.
//  • Photo (JPEG, PNG, WebP) : OCR direct.
// OCR : tesseract.js, modèle français « best_int » installé avec l'application.
// Aucune donnée ne quitte le serveur.
const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const zlib = require('zlib');

const PAGES_MAX = 3;
const TEXTE_MIN = 40;            // en dessous : le PDF est tenu pour scanné

// ── PNG minimal (pour donner à l'OCR les images extraites d'un PDF) ─────────
const TABLE_CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const x of buf) c = TABLE_CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const bloc = (type, donnees) => {
  const lg = Buffer.alloc(4); lg.writeUInt32BE(donnees.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), donnees]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
  return Buffer.concat([lg, td, c]);
};
// Image pdf.js { width, height, data, kind } → PNG. kind 1 : 1 bit/pixel ; 2 : RVB ; 3 : RVBA.
const versPng = ({ width: w, height: h, data, kind }) => {
  const canaux = kind === 3 ? 4 : kind === 2 ? 3 : 1;
  const ligne = kind === 1 ? w + 1 : w * canaux + 1;
  const brut = Buffer.alloc(ligne * h);
  if (kind === 1) {
    const octets = (w + 7) >> 3;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) brut[y * ligne + 1 + x] = (data[y * octets + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
    }
  } else {
    for (let y = 0; y < h; y += 1) {
      Buffer.from(data.buffer, data.byteOffset + y * w * canaux, w * canaux).copy(brut, y * ligne + 1);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = canaux === 4 ? 6 : canaux === 3 ? 2 : 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloc('IHDR', ihdr), bloc('IDAT', zlib.deflateSync(brut)), bloc('IEND', Buffer.alloc(0))]);
};

// ── pdf.js ──────────────────────────────────────────────────────────────────
// pdf.js signale (console.log « Warning: ») qu'il ne peut pas DESSINER sans le
// module natif « canvas ». On ne dessine rien (texte et images brutes seulement) :
// ces seuls messages sont écartés, dans ce fil uniquement ; tout autre passe.
const CANVAS = /Cannot (polyfill|find module 'canvas')|module 'canvas'/;
for (const k of ['log', 'warn']) {
  const origine = console[k];
  console[k] = (...args) => { if (!CANVAS.test(String(args[0]))) origine(...args); };
}

const ouvrirPdf = async (contenu) => {
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(contenu), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0,
  }).promise;
  return { pdfjs, doc };
};

const textePage = async (page) => {
  const { items } = await page.getTextContent();
  let texte = ''; let y = null;
  for (const it of items) {
    if (!it.str) continue;
    const yi = it.transform[5];
    if (y !== null) texte += Math.abs(yi - y) > 2 ? '\n' : ' ';
    texte += it.str; y = yi;
  }
  return texte;
};

const imagesPage = async (pdfjs, page) => {
  const ops = await page.getOperatorList();
  const images = [];
  for (let i = 0; i < ops.fnArray.length; i += 1) {
    const fn = ops.fnArray[i];
    if (fn === pdfjs.OPS.paintImageXObject) {
      const nom = ops.argsArray[i][0];
      const img = await new Promise((ok) => (page.objs.has(nom) ? ok(page.objs.get(nom)) : page.objs.get(nom, ok)));
      if (img?.data) images.push(img);
    } else if (fn === pdfjs.OPS.paintInlineImageXObject) {
      const img = ops.argsArray[i][0];
      if (img?.data) images.push(img);
    }
  }
  // Les petites images (logos, cachets) ne portent pas la facture : on garde la plus grande.
  return images.filter((m) => m.width >= 300 && m.height >= 300).sort((a, b) => b.width * b.height - a.width * a.height).slice(0, 1);
};

// ── OCR ─────────────────────────────────────────────────────────────────────
let ocr = null;
const ocriser = async (image) => {
  if (!ocr) {
    const { createWorker } = require('tesseract.js');
    const langPath = path.join(path.dirname(require.resolve('@tesseract.js-data/fra')), '4.0.0_best_int');
    ocr = await createWorker(['fra'], 1, { langPath, gzip: true, cacheMethod: 'none' });
  }
  const { data } = await ocr.recognize(image);
  return { texte: data.text || '', confiance: Number(data.confidence) || 0 };
};

const lire = async ({ contenu, mime }) => {
  const buf = Buffer.from(contenu);
  if (mime !== 'application/pdf') {
    const r = await ocriser(buf);
    return { moteur: 'ocr_image', texte: r.texte, confiance: r.confiance, pages: 1 };
  }
  const { pdfjs, doc } = await ouvrirPdf(buf);
  const pages = Math.min(doc.numPages, PAGES_MAX);
  let texte = '';
  for (let p = 1; p <= pages; p += 1) texte += `${await textePage(await doc.getPage(p))}\n`;
  if (texte.replace(/\s+/g, '').length >= TEXTE_MIN) return { moteur: 'texte_pdf', texte, confiance: null, pages };
  // PDF scanné : OCR des images de page.
  texte = ''; let somme = 0; let lues = 0;
  for (let p = 1; p <= pages; p += 1) {
    for (const img of await imagesPage(pdfjs, await doc.getPage(p))) {
      const r = await ocriser(versPng(img));
      texte += `${r.texte}\n`; somme += r.confiance; lues += 1;
    }
  }
  if (!lues) throw new Error('Ce PDF ne contient ni texte ni image de page lisible.');
  return { moteur: 'ocr_pdf', texte, confiance: somme / lues, pages };
};

lire(workerData)
  .then(async (r) => { if (ocr) await ocr.terminate(); parentPort.postMessage({ ok: true, ...r }); })
  .catch(async (err) => {
    // Le fil est arrêté juste après : l'erreur d'arrêt est journalisée, l'erreur d'origine est rendue.
    if (ocr) await ocr.terminate().catch((e) => console.error('[NJ FINANCE] arrêt OCR :', e.message));
    parentPort.postMessage({ ok: false, message: String(err?.message || err).slice(0, 300) });
  });
