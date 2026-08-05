// src/services/storage.service.js
// Stockage des pièces jointes sur le disque local du serveur.
// Aucune dépendance externe : les fichiers vivent sur le serveur applicatif.
//
//   STORAGE_DIR      chemin absolu ou relatif du dossier de stockage (défaut ./uploads)
//   STORAGE_BASE_URL préfixe public servi par Express          (défaut /uploads)
const fs   = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const STORAGE_DIR = path.isAbsolute(process.env.STORAGE_DIR || '')
  ? process.env.STORAGE_DIR
  : path.resolve(__dirname, '..', '..', process.env.STORAGE_DIR || 'uploads');

const BASE_URL = (process.env.STORAGE_BASE_URL || '/uploads').replace(/\/+$/, '');

const MAX_FILE_SIZE = parseInt(process.env.STORAGE_MAX_FILE_SIZE, 10) || 5 * 1024 * 1024; // 5 Mo
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/** Empêche toute remontée hors du dossier de stockage (path traversal). */
const resolveSafe = (relativePath) => {
  const full = path.resolve(STORAGE_DIR, relativePath);
  if (full !== STORAGE_DIR && !full.startsWith(STORAGE_DIR + path.sep)) {
    throw new Error('Chemin de fichier invalide.');
  }
  return full;
};

/** Segment de chemin sûr (UUID de tenant, id de mouvement…). */
const safeSegment = (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, '');

/** Nom de fichier unique, extension déduite du type MIME (jamais du nom fourni). */
const buildFileName = (mimeType) =>
  `${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${EXT_BY_MIME[mimeType] || 'bin'}`;

/**
 * Écrit un fichier et renvoie { path, url, size }.
 * `path` est relatif au dossier de stockage — c'est lui qu'on met en base.
 */
const save = async (tenantId, mouvementId, buffer, mimeType) => {
  const relDir  = path.posix.join(safeSegment(tenantId), safeSegment(mouvementId));
  const relPath = path.posix.join(relDir, buildFileName(mimeType));

  const fullPath = resolveSafe(relPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, buffer);

  return { path: relPath, url: `${BASE_URL}/${relPath}`, size: buffer.length };
};

/** Supprime un fichier. Ne lève pas si le fichier a déjà disparu. */
const remove = async (relativePath) => {
  try {
    await fs.unlink(resolveSafe(relativePath));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
};

/** Crée le dossier racine au démarrage du serveur. */
const init = async () => {
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  return STORAGE_DIR;
};

module.exports = {
  save,
  remove,
  init,
  STORAGE_DIR,
  BASE_URL,
  MAX_FILE_SIZE,
  ALLOWED_TYPES,
};
