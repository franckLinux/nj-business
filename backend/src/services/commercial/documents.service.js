'use strict';
// NJ COMMERCIAL — pièces jointes (justificatifs de demande ; proformas en livraison C).
// Même stockage privé que les PV (jamais servi par /uploads) ; type contrôlé sur le
// CONTENU réel du fichier ; empreinte SHA-256 conservée ; un fichier n'est jamais effacé :
// un retrait est tracé et le masque.
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { PV_DIR } = require('../pv_storage.service');

const MAX = parseInt(process.env.COM_DOC_MAX_FILE_SIZE, 10) || 5 * 1024 * 1024;   // 5 Mo
const EXT = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

class ErreurDocument extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Signature réelle → type. Les formats bureautiques (docx / xlsx) sont des archives
// ZIP : on vérifie la signature ET la présence du dossier propre au format.
const typeReel = (buf, nom) => {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    const contenu = buf.toString('latin1');
    const ext = String(nom || '').toLowerCase().split('.').pop();
    if (ext === 'docx' && contenu.includes('word/')) return EXT_INV.docx;
    if (ext === 'xlsx' && contenu.includes('xl/')) return EXT_INV.xlsx;
  }
  return null;
};
const EXT_INV = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]));

const nomPropre = (nom, mime) => {
  const base = String(nom || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f"<>|*?:]/g, '').trim().slice(0, 150);
  return base || `piece.${EXT[mime]}`;
};

const preparer = ({ nom_fichier, data_base64 }) => {
  const b64 = String(data_base64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!b64) throw new ErreurDocument(400, 'Joignez un fichier (PDF, image, Word ou Excel).');
  const buffer = Buffer.from(b64, 'base64');
  if (!buffer.length) throw new ErreurDocument(400, 'Fichier vide.');
  if (buffer.length > MAX) throw new ErreurDocument(400, `Fichier trop volumineux (${Math.round(MAX / 1024 / 1024)} Mo au plus).`);
  const mime = typeReel(buffer, nom_fichier);
  if (!mime) throw new ErreurDocument(400, 'Format refusé : PDF, JPG, PNG, WEBP, Word (.docx) ou Excel (.xlsx) uniquement.');
  return { buffer, mime, nom: nomPropre(nom_fichier, mime), taille: buffer.length, sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
};

const seg = (v) => String(v).replace(/[^a-zA-Z0-9_-]/g, '');
const resoudre = (rel) => {
  const full = path.resolve(PV_DIR, rel);
  if (!full.startsWith(PV_DIR + path.sep)) throw new ErreurDocument(400, 'Chemin de fichier invalide.');
  return full;
};

const ecrire = async (tenantId, objet, objetId, { buffer, mime }) => {
  const rel = path.posix.join(seg(tenantId), 'commercial', seg(objet), seg(objetId),
    `${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${EXT[mime]}`);
  const full = resoudre(rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buffer, { flag: 'wx' });
  return rel;
};

// Document produit par le serveur (PDF du bon de commande émis) : jamais réécrit.
const ecrireBrut = async (tenantId, objet, objetId, buffer, ext) => {
  const rel = path.posix.join(seg(tenantId), 'commercial', seg(objet), seg(objetId),
    `${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${seg(ext)}`);
  const full = resoudre(rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buffer, { flag: 'wx' });
  return rel;
};

module.exports = { ErreurDocument, preparer, ecrire, ecrireBrut, resoudre, MAX };
