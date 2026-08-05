// src/controllers/notifications.controller.js
// Cloche in-app : chaque utilisateur voit SES notifications (destinataire_id = lui).
const { query } = require('../config/database');

// GET /api/notifications?limit=&only_unread=
const list = async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 30, 100);
  const onlyUnread = req.query.only_unread === 'true';
  try {
    const { rows } = await query(
      `SELECT id, type, titre, message, ref_type, ref_id, lu, created_at
         FROM notifications
        WHERE tenant_id=$1 AND destinataire_id=$2
          ${onlyUnread ? 'AND lu=false' : ''}
        ORDER BY created_at DESC
        LIMIT ${limit}`,
      [req.tenantId, req.user.id]
    );
    const { rows: cnt } = await query(
      `SELECT COUNT(*)::int AS nb FROM notifications
        WHERE tenant_id=$1 AND destinataire_id=$2 AND lu=false`,
      [req.tenantId, req.user.id]
    );
    res.json({ notifications: rows, non_lus: cnt[0].nb });
  } catch (err) {
    console.error('[Notifications] list :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// GET /api/notifications/count
const count = async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS nb FROM notifications
        WHERE tenant_id=$1 AND destinataire_id=$2 AND lu=false`,
      [req.tenantId, req.user.id]
    );
    res.json({ nb: rows[0].nb });
  } catch (err) {
    console.error('[Notifications] count :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// PATCH /api/notifications/:id/lu
const markRead = async (req, res) => {
  try {
    await query(
      `UPDATE notifications SET lu=true
        WHERE id=$1 AND tenant_id=$2 AND destinataire_id=$3`,
      [parseInt(req.params.id), req.tenantId, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// PATCH /api/notifications/lu-tout
const markAllRead = async (req, res) => {
  try {
    await query(
      `UPDATE notifications SET lu=true
        WHERE tenant_id=$1 AND destinataire_id=$2 AND lu=false`,
      [req.tenantId, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = { list, count, markRead, markAllRead };
