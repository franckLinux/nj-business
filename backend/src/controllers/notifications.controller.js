// src/controllers/notifications.controller.js
// Cloche in-app : chaque utilisateur voit SES notifications (destinataire_id = lui).
const { Notification } = require('../models');

// GET /api/notifications?limit=&only_unread=
const list = async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 30, 100);
  const onlyUnread = req.query.only_unread === 'true';
  try {
    const where = { tenant_id: req.tenantId, destinataire_id: req.user.id };
    if (onlyUnread) where.lu = false;
    const notifications = await Notification.findAll({
      where,
      attributes: ['id', 'type', 'titre', 'message', 'ref_type', 'ref_id', 'lu', 'created_at'],
      order: [['created_at', 'DESC']],
      limit,
    });
    const non_lus = await Notification.count({
      where: { tenant_id: req.tenantId, destinataire_id: req.user.id, lu: false },
    });
    res.json({ notifications, non_lus });
  } catch (err) {
    console.error('[Notifications] list :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// GET /api/notifications/count
const count = async (req, res) => {
  try {
    const nb = await Notification.count({
      where: { tenant_id: req.tenantId, destinataire_id: req.user.id, lu: false },
    });
    res.json({ nb });
  } catch (err) {
    console.error('[Notifications] count :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// PATCH /api/notifications/:id/lu
const markRead = async (req, res) => {
  try {
    await Notification.update(
      { lu: true },
      { where: { id: parseInt(req.params.id, 10), tenant_id: req.tenantId, destinataire_id: req.user.id } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// PATCH /api/notifications/lu-tout
const markAllRead = async (req, res) => {
  try {
    await Notification.update(
      { lu: true },
      { where: { tenant_id: req.tenantId, destinataire_id: req.user.id, lu: false } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = { list, count, markRead, markAllRead };
