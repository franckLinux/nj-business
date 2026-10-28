'use strict';
// src/services/pv_storage.service.js — PV scannés (arrêtés de caisse, inventaires).
//
// Les PV attestent des soldes : ils ne doivent PAS être servis par le dossier
// public /uploads (express.static). Ils vivent dans un dossier privé et ne
// sortent que par l'API authentifiée (GET /api/controle/pv/:objet/:id).
//
//   PV_DIR  chemin absolu ou relatif au dossier backend (défaut ./prive/pv)
//
// Type contrôlé sur le CONTENU (signature du fichier), pas seulement sur le
// type MIME déclaré par le navigateur. Empreinte SHA-256 conservée en base.
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const PV_DIR = path.isAbsolute(process.env.PV_DIR || '')
  ? process.env.PV_DIR
  : path.resolve(__dirname, '..', '..', process.env.PV_DIR || path.join('prive', 'pv'));

const MAX_PV_SIZE = parseInt(process.env.PV_MAX_FILE_SIZE, 10) || 5 * 1024 * 1024; // 5 Mo
const EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// Signature réelle du fichier → type MIME (null si non reconnu).
const typeReel = (buf) => {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
};

const resolveSafe = (rel) => {
  const full = path.resolve(PV_DIR, rel);
  if (!full.startsWith(PV_DIR + path.sep)) throw new Error('Chemin de PV invalide.');
  return full;
};
const seg = (v) => String(v).replace(/[^a-zA-Z0-9_-]/g, '');

// Nom affiché : on garde un nom lisible, sans chemin ni caractère de contrôle.
const nomPropre = (nom, mime) => {
  const base = String(nom || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f"<>|*?:]/g, '').trim().slice(0, 150);
  return base || `pv.${EXT[mime]}`;
};

/**
 * Décode et contrôle un PV reçu en base64. Lève { status, message } si refusé.
 * Renvoie { buffer, mime, nom, taille, sha256 }.
 */
const preparer = ({ nom_fichier, data_base64 }) => {
  const b64 = String(data_base64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!b64) throw Object.assign(new Error('Joignez le PV scanné (PDF, JPG, PNG ou WEBP).'), { status: 400 });
  const buffer = Buffer.from(b64, 'base64');
  if (!buffer.length) throw Object.assign(new Error('Fichier vide.'), { status: 400 });
  if (buffer.length > MAX_PV_SIZE) {
    throw Object.assign(new Error(`PV trop volumineux (${Math.round(MAX_PV_SIZE / 1024 / 1024)} Mo au plus). Scannez en 150-200 dpi ou en PDF.`), { status: 400 });
  }
  const mime = typeReel(buffer);
  if (!mime) throw Object.assign(new Error('Format non reconnu : le PV doit être un PDF ou une image JPG, PNG ou WEBP.'), { status: 400 });
  return { buffer, mime, nom: nomPropre(nom_fichier, mime), taille: buffer.length, sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
};

/** Écrit le PV ; renvoie le chemin relatif à stocker en base. Les anciens PV ne sont jamais effacés. */
const enregistrer = async (tenantId, objet, objetId, { buffer, mime }) => {
  const rel = path.posix.join(seg(tenantId), seg(objet), seg(objetId),
    `${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${EXT[mime]}`);
  const full = resolveSafe(rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buffer, { flag: 'wx' });
  return rel;
};

const cheminComplet = (rel) => resolveSafe(rel);

module.exports = { preparer, enregistrer, cheminComplet, PV_DIR, MAX_PV_SIZE };
