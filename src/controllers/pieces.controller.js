// src/controllers/pieces.controller.js
// Gestion pièces justificatives types (config) + upload sur disque local
const { query }   = require('../config/database');
const storage     = require('../services/storage.service');

const MAX_FILE_SIZE = storage.MAX_FILE_SIZE;
const ALLOWED_TYPES = storage.ALLOWED_TYPES;

// ── POST /api/pieces/upload/:mouvementId ──────────────────────────────────
const upload = async (req, res) => {
  const { mouvementId } = req.params;

  // Vérifier que le mouvement appartient au tenant
  const { rows: mvtRows } = await query(
    'SELECT id FROM journal WHERE id=$1 AND tenant_id=$2',
    [parseInt(mouvementId), req.tenantId]
  );
  if (mvtRows.length === 0) {
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

  const buffer  = Buffer.from(data_base64, 'base64');
  if (buffer.length > MAX_FILE_SIZE) {
    return res.status(400).json({ error: 'Fichier trop volumineux (max 5 Mo).' });
  }

  try {
    const stored = await storage.save(req.tenantId, mouvementId, buffer, mime_type);

    const { rows } = await query(
      `INSERT INTO pieces_jointes(tenant_id, journal_id_mvt, nom_fichier,
         storage_path, storage_url, type_mime, taille_octets, uploaded_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.tenantId, parseInt(mouvementId), nom_fichier,
       stored.path, stored.url, mime_type, stored.size, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[Pieces] upload :', err.message);
    res.status(500).json({ error: `Erreur upload : ${err.message}` });
  }
};

// ── GET /api/pieces/:mouvementId ──────────────────────────────────────────
const getByMouvement = async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT * FROM pieces_jointes
       WHERE journal_id_mvt=$1 AND tenant_id=$2
       ORDER BY created_at`,
      [parseInt(req.params.mouvementId), req.tenantId]
    );
    res.json(rows);
  } catch (err) {
    // Table absente / non migrée → liste vide plutôt qu'une 500 silencieuse
    console.warn('[Pieces] getByMouvement :', err.message);
    res.json([]);
  }
};

// ── DELETE /api/pieces/:pieceId ───────────────────────────────────────────
const deletePiece = async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM pieces_jointes WHERE id=$1 AND tenant_id=$2',
    [req.params.pieceId, req.tenantId]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Pièce introuvable.' });

  try {
    await storage.remove(rows[0].storage_path);
  } catch (err) {
    console.warn('[Pieces] suppression fichier :', err.message);
  }
  await query('DELETE FROM pieces_jointes WHERE id=$1', [req.params.pieceId]);
  res.json({ message: 'Pièce supprimée.' });
};

// ── GET /api/pieces/types?rubrique_code= ──────────────────────────────────
const getTypes = async (req, res) => {
  const { rubrique_code } = req.query;
  try {
    const where = rubrique_code ? 'AND rubrique_code=$2' : '';
    const params = rubrique_code ? [req.tenantId, rubrique_code] : [req.tenantId];
    const { rows } = await query(
      `SELECT * FROM pieces_justificatives_types
       WHERE tenant_id=$1 AND actif=true ${where}
       ORDER BY rubrique_code, ordre`,
      params
    );
    res.json(rows);
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
  if (!['directeur','super_admin','comptable_cabinet'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Accès refusé.' });
  }
  const { rubrique_code, intitule_piece, description, obligatoire, ordre } = req.body;
  if (!rubrique_code || !intitule_piece) {
    return res.status(400).json({ error: 'Rubrique et intitulé obligatoires.' });
  }
  const { rows } = await query(
    `INSERT INTO pieces_justificatives_types
       (tenant_id,rubrique_code,intitule_piece,description,obligatoire,ordre)
     VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.tenantId, rubrique_code, intitule_piece,
     description||'', obligatoire||false, ordre||0]
  );
  res.status(201).json(rows[0]);
};

// ── PUT /api/pieces/types/:id ─────────────────────────────────────────────
const updateType = async (req, res) => {
  if (!['directeur','super_admin','comptable_cabinet'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Accès refusé.' });
  }
  const { intitule_piece, description, obligatoire, ordre, actif } = req.body;
  const { rows } = await query(
    `UPDATE pieces_justificatives_types
     SET intitule_piece=$1, description=$2, obligatoire=$3, ordre=$4, actif=$5
     WHERE id=$6 AND tenant_id=$7 RETURNING *`,
    [intitule_piece, description||'', obligatoire||false,
     ordre||0, actif!==false, req.params.id, req.tenantId]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Type introuvable.' });
  res.json(rows[0]);
};

// ── DELETE /api/pieces/types/:id ──────────────────────────────────────────
const deleteType = async (req, res) => {
  await query(
    'UPDATE pieces_justificatives_types SET actif=false WHERE id=$1 AND tenant_id=$2',
    [req.params.id, req.tenantId]
  );
  res.json({ message: 'Type désactivé.' });
};

module.exports = { upload, getByMouvement, deletePiece, getTypes, createType, updateType, deleteType };
