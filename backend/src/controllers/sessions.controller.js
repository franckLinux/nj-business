// src/controllers/sessions.controller.js — sessions ouvertes (067, lot D).
//   GET    /api/sessions           directeur : son client (users.edit : adresses IP, appareils) ; super_admin : tout, ou le client choisi
//   DELETE /api/sessions/:id       fermer une session (users.edit), motif facultatif
//   GET/PUT /api/plateforme/sessions  réglages d'expiration (super_admin)
const { query } = require('../config/database');
const sessions = require('../services/sessions.service');

const erreur = (res, err, ctx) => {
  if (err instanceof sessions.ErreurSession) return res.status(err.status).json({ error: err.message, code: err.code });
  console.error(`[Sessions] ${ctx} :`, err.message);
  return res.status(500).json({ error: 'Erreur serveur.' });
};

const lister = async (req, res) => {
  try {
    if (!req.tenantId && req.user.role !== 'super_admin') return res.status(403).json({ error: 'Choisissez un client.' });
    const liste = await sessions.lister({ tenantId: req.tenantId || null, actives: req.query.toutes !== '1' });
    res.json({ sessions: liste.map((s) => ({ ...s, courante: s.id === req.user.sessionId })), reglages: await sessions.reglages() });
  } catch (err) { erreur(res, err, 'lister'); }
};

const fermer = async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Session invalide.' });
  try {
    const { rows: [s] } = await query('SELECT id, user_id, tenant_id, statut FROM sessions WHERE id = $1', [id]);
    // Hors de son client : comme si la session n'existait pas.
    if (!s || (req.tenantId && s.tenant_id !== req.tenantId) || (!req.tenantId && req.user.role !== 'super_admin')) {
      return res.status(404).json({ error: 'Session introuvable.' });
    }
    if (s.statut !== 'active') return res.status(409).json({ error: 'Cette session est déjà fermée.' });
    if (s.id === req.user.sessionId) return res.status(400).json({ error: 'C\'est votre session actuelle : utilisez « Se déconnecter ».' });
    const motif = String(req.body?.motif || '').trim().slice(0, 300) || 'Fermée par un administrateur';
    await sessions.terminer({ sessionId: id, statut: 'revoquee', par: req.user.id, motif, tenantId: s.tenant_id, action: 'SESSION_REVOCATION' });
    res.json({ message: 'Session fermée : la personne devra se reconnecter.' });
  } catch (err) { erreur(res, err, 'fermer'); }
};

const lireReglages = async (req, res) => {
  try { res.json({ reglages: await sessions.reglages(), mode: sessions.mode() }); } catch (err) { erreur(res, err, 'reglages'); }
};

const ecrireReglages = async (req, res) => {
  try {
    const r = await sessions.definirReglages({ ...req.body, par: req.user.id });
    res.json({ reglages: r, mode: sessions.mode() });
  } catch (err) { erreur(res, err, 'definirReglages'); }
};

module.exports = { lister, fermer, lireReglages, ecrireReglages };
