// src/controllers/pieces.controller.js
// Gestion pièces justificatives types (config) + upload sur disque local
const { Mouvement, PieceJointe, PieceJustificativeType } = require('../models');
const storage = require('../services/storage.service');

const MAX_FILE_SIZE = storage.MAX_FILE_SIZE;
const ALLOWED_TYPES = storage.ALLOWED_TYPES;

// ── POST /api/pieces/upload/:mouvementId ──────────────────────────────────
const upload = async (req, res) => {
  const { mouvementId } = req.params;
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

    const buffer = Buffer.from(data_base64, 'base64');
    if (buffer.length > MAX_FILE_SIZE) {
      return res.status(400).json({ error: 'Fichier trop volumineux (max 5 Mo).' });
    }

    const stored = await storage.save(req.tenantId, mouvementId, buffer, mime_type);

    const piece = await PieceJointe.create({
      tenant_id: req.tenantId,
      journal_id_mvt: parseInt(mouvementId, 10),
      nom_fichier,
      storage_path: stored.path,
      storage_url: stored.url,
      type_mime: mime_type,
      taille_octets: stored.size,
      uploaded_by: req.user.id,
    });
    res.status(201).json(piece);
  } catch (err) {
    console.error('[Pieces] upload :', err.message);
    res.status(500).json({ error: `Erreur upload : ${err.message}` });
  }
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

module.exports = { upload, getByMouvement, deletePiece, getTypes, createType, updateType, deleteType };
