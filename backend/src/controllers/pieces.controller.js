// src/controllers/pieces.controller.js
// Gestion pièces justificatives types (config) + upload sur disque local
const { Mouvement, PieceJointe, PieceJustificativeType } = require('../models');
const storage = require('../services/storage.service');

const MAX_FILE_SIZE = storage.MAX_FILE_SIZE;
const ALLOWED_TYPES = storage.ALLOWED_TYPES;

// ── POST /api/pieces/upload/:mouvementId ──────────────────────────────────
// 073 : le type est contrôlé sur le CONTENU du fichier (signature), et la pièce
// est rangée dans le dossier privé ; son adresse est celle de l'API authentifiée.
const upload = async (req, res) => {
  const { mouvementId } = req.params;
  let stored = null;
  try {
    // Vérifier que le mouvement appartient au tenant
    const mouvement = await Mouvement.findOne({ where: { id: parseInt(mouvementId, 10), tenant_id: req.tenantId } });
    if (!mouvement) {
      return res.status(404).json({ error: 'Mouvement introuvable.' });
    }

    // Lire le body (base64 JSON)
    const { nom_fichier, mime_type, data_base64 } = req.body;

    if (!nom_fichier || !mime_type || !data_base64) {
      return res.status(400).json({ error: 'Fichier invalide.' });
    }
    if (!ALLOWED_TYPES.includes(mime_type)) {
      return res.status(400).json({ error: 'Type de fichier non autorisé. (JPG, PNG, WEBP, PDF)' });
    }

    const buffer = Buffer.from(String(data_base64).replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (!buffer.length) {
      return res.status(400).json({ error: 'Fichier vide.' });
    }
    if (buffer.length > MAX_FILE_SIZE) {
      return res.status(400).json({ error: 'Fichier trop volumineux (max 5 Mo).' });
    }
    const typeContenu = storage.typeReel(buffer);
    if (!typeContenu) {
      return res.status(400).json({ error: 'Le contenu du fichier n\'est pas un PDF ni une image JPG, PNG ou WEBP.' });
    }

    stored = await storage.save(req.tenantId, mouvementId, buffer, typeContenu);

    const piece = await PieceJointe.create({
      tenant_id: req.tenantId,
      journal_id_mvt: parseInt(mouvementId, 10),
      nom_fichier: nomPropre(nom_fichier, typeContenu),
      storage_path: stored.path,
      storage_url: 'en-cours',
      type_mime: typeContenu,
      taille_octets: stored.size,
      uploaded_by: req.user.id,
    });
    await piece.update({ storage_url: storage.urlFichier(piece.id) });
    res.status(201).json(piece);
  } catch (err) {
    console.error('[Pieces] upload :', err.message);
    if (stored) await storage.remove(stored.path).catch((e) => console.error('[Pieces] nettoyage après échec :', e.message));
    res.status(500).json({ error: 'L\'envoi de la pièce a échoué. Réessayez ; si le problème persiste, contactez le cabinet.' });
  }
};

// Nom affiché : lisible, sans chemin ni caractère de contrôle.
const nomPropre = (nom, mime) => {
  const base = String(nom || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f"<>|*?:]/g, '').trim().slice(0, 150);
  const ext = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mime];
  return base || `piece.${ext}`;
};

// ── GET /api/pieces/fichier/:pieceId — 073 ────────────────────────────────
// Seule façon de lire une pièce : jeton valide, même client, pieces.view.
// Une pièce d'un autre client répond 404 (on ne révèle pas qu'elle existe).
const fichier = async (req, res) => {
  const id = parseInt(req.params.pieceId, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'Pièce introuvable.' });
  let piece;
  try {
    piece = await PieceJointe.findOne({ where: { id, tenant_id: req.tenantId } });
  } catch (err) {
    console.error('[Pieces] fichier :', err.message);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
  if (!piece) return res.status(404).json({ error: 'Pièce introuvable.' });
  let chemin;
  try {
    chemin = storage.cheminComplet(piece.storage_path);
  } catch (err) {
    console.error(`[Pieces] chemin refusé pour la pièce ${id} :`, err.message);
    return res.status(404).json({ error: 'Pièce introuvable.' });
  }
  const nom = encodeURIComponent(piece.nom_fichier || `piece-${id}`);
  res.set({
    'Content-Type': ALLOWED_TYPES.includes(piece.type_mime) ? piece.type_mime : 'application/octet-stream',
    'Content-Disposition': `inline; filename*=UTF-8''${nom}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.sendFile(chemin, (err) => {
    if (!err) return;
    console.error(`[Pieces] lecture du fichier de la pièce ${id} :`, err.message);
    if (!res.headersSent) {
      res.removeHeader('Content-Disposition');
      res.status(err.code === 'ENOENT' ? 404 : 500).type('application/json')
        .send(JSON.stringify({ error: err.code === 'ENOENT' ? 'Fichier de la pièce introuvable sur le serveur.' : 'Erreur serveur.' }));
    }
  });
};

// ── GET /api/pieces/:mouvementId ──────────────────────────────────────────
const getByMouvement = async (req, res) => {
  try {
    const pieces = await PieceJointe.findAll({
      where: { journal_id_mvt: parseInt(req.params.mouvementId, 10), tenant_id: req.tenantId },
      order: [['created_at', 'ASC']],
    });
    res.json(pieces);
  } catch (err) {
    // Table absente / non migrée → liste vide plutôt qu'une 500 silencieuse
    console.warn('[Pieces] getByMouvement :', err.message);
    res.json([]);
  }
};

// ── DELETE /api/pieces/:pieceId ───────────────────────────────────────────
const deletePiece = async (req, res) => {
  try {
    const piece = await PieceJointe.findOne({ where: { id: req.params.pieceId, tenant_id: req.tenantId } });
    if (!piece) return res.status(404).json({ error: 'Pièce introuvable.' });

    try {
      await storage.remove(piece.storage_path);
    } catch (err) {
      console.warn('[Pieces] suppression fichier :', err.message);
    }
    await PieceJointe.destroy({ where: { id: req.params.pieceId } });
    res.json({ message: 'Pièce supprimée.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── GET /api/pieces/types?rubrique_code= ──────────────────────────────────
const getTypes = async (req, res) => {
  const { rubrique_code } = req.query;
  try {
    const where = { tenant_id: req.tenantId, actif: true };
    if (rubrique_code) where.rubrique_code = rubrique_code;
    const types = await PieceJustificativeType.findAll({
      where,
      order: [['rubrique_code', 'ASC'], ['ordre', 'ASC']],
    });
    res.json(types);
  } catch (err) {
    // Table pas encore migrée → on renvoie une liste vide.
    // Sans ce garde-fou, la requête échouait et l'annotation pièces
    // ne s'affichait jamais après sélection d'une rubrique.
    console.warn('[Pieces] getTypes - table absente :', err.message);
    res.json([]);
  }
};

// ── POST /api/pieces/types ────────────────────────────────────────────────
const createType = async (req, res) => {
  const { rubrique_code, intitule_piece, description, obligatoire, ordre } = req.body;
  if (!rubrique_code || !intitule_piece) {
    return res.status(400).json({ error: 'Rubrique et intitulé obligatoires.' });
  }
  try {
    const type = await PieceJustificativeType.create({
      tenant_id: req.tenantId,
      rubrique_code,
      intitule_piece,
      description: description || '',
      obligatoire: obligatoire || false,
      ordre: ordre || 0,
    });
    res.status(201).json(type);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── PUT /api/pieces/types/:id ─────────────────────────────────────────────
const updateType = async (req, res) => {
  const { intitule_piece, description, obligatoire, ordre, actif } = req.body;
  try {
    const [count, rows] = await PieceJustificativeType.update(
      {
        intitule_piece,
        description: description || '',
        obligatoire: obligatoire || false,
        ordre: ordre || 0,
        actif: actif !== false,
      },
      { where: { id: req.params.id, tenant_id: req.tenantId }, returning: true }
    );
    if (count === 0) return res.status(404).json({ error: 'Type introuvable.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── DELETE /api/pieces/types/:id ──────────────────────────────────────────
const deleteType = async (req, res) => {
  try {
    await PieceJustificativeType.update(
      { actif: false },
      { where: { id: req.params.id, tenant_id: req.tenantId } }
    );
    res.json({ message: 'Type désactivé.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = {
  fichier, upload, getByMouvement, deletePiece, getTypes, createType, updateType, deleteType };
