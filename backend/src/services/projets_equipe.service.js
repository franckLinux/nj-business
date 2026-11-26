'use strict';
// Gestion des activités — équipe des projets (26/11/2026).
// Décision de Franck : pouvoir créer de nouveaux utilisateurs « chef de projet »
// et « responsable d'activité », possibilité réservée aux clients qui ont la
// gestion des activités (ONG et associations).
//
// Un tel compte est un « collaborateur » (rôle de base sans caisse) doté d'un
// profil métier du client « Chef de projet » ou « Responsable d'activité »
// (créé à la première utilisation), rattaché au module NJ FINANCE. Ses droits
// sur les projets viennent de sa DÉSIGNATION (chef d'un projet, responsable
// d'une activité), posée dans la foulée si un projet / une activité est choisi.
const bcrypt = require('bcryptjs');
const { sequelize, User } = require('../models');
const { ErreurProjet, estOng } = require('./projets.service');
const rolesClient = require('./roles_client.service');

const T = sequelize.QueryTypes;
const Q = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: T.SELECT, transaction });
const X = (sql, replacements, transaction) => sequelize.query(sql, { replacements, transaction });
const err = (status, message, code) => new ErreurProjet(status, message, code);

const FONCTIONS = {
  chef_projet: { code: 'CHEF_PROJET', nom: 'Chef de projet', couleur: '#7c3aed',
    description: 'Valide les demandes de fonds de ses projets avant le directeur (gestion des activités).' },
  responsable_activite: { code: 'RESP_ACTIVITE', nom: 'Responsable d\'activité', couleur: '#0891b2',
    description: 'Demande les fonds de ses activités et déclare les dépenses avec les pièces (gestion des activités).' },
};

const exigerOng = async (tenantId) => {
  if (!(await estOng(tenantId))) {
    throw err(403, 'Les chefs de projet et responsables d\'activité sont réservés aux ONG et associations (gestion des activités).', 'PROJETS_RESERVES_ONG');
  }
};

/** Profil métier du client pour une fonction (créé s'il n'existe pas). */
const profil = async (tenantId, fonction, transaction) => {
  const f = FONCTIONS[fonction];
  const [r] = await Q('SELECT id FROM roles WHERE tenant_id = :t AND code = :c', { t: tenantId, c: f.code }, transaction);
  if (r) return r.id;
  const [[n]] = await X(`INSERT INTO roles (nom, code, description, couleur, tenant_id, is_system) VALUES (:nom, :code, :d, :couleur, :t, false) RETURNING id`,
    { nom: f.nom, code: f.code, d: f.description, couleur: f.couleur, t: tenantId }, transaction);
  return n.id;
};

const lister = async (req) => {
  await exigerOng(req.tenantId);
  const rows = await Q(
    `SELECT u.id, u.username, u.email, u.actif, u.role, r.code AS profil, r.nom AS profil_nom,
            coalesce((SELECT json_agg(json_build_object('id', p.id, 'nom', p.nom) ORDER BY p.nom) FROM activites p
                       WHERE p.tenant_id = u.tenant_id AND p.type = 'projet' AND p.chef_projet_id = u.id), '[]') AS projets,
            coalesce((SELECT json_agg(json_build_object('id', a.id, 'nom', a.nom, 'projet', pr.nom) ORDER BY pr.nom, a.nom) FROM activites a
                       JOIN activites pr ON pr.id = a.projet_id WHERE a.tenant_id = u.tenant_id AND a.responsable_id = u.id), '[]') AS activites
       FROM users u LEFT JOIN roles r ON r.id = u.custom_role_id
      WHERE u.tenant_id = :t
        AND (r.code IN ('CHEF_PROJET', 'RESP_ACTIVITE')
             OR EXISTS (SELECT 1 FROM activites x WHERE x.tenant_id = u.tenant_id AND (x.chef_projet_id = u.id OR x.responsable_id = u.id)))
      ORDER BY lower(u.username)`, { t: req.tenantId });
  return rows.map((u) => ({ ...u, fonction: u.profil === 'CHEF_PROJET' ? 'chef_projet' : u.profil === 'RESP_ACTIVITE' ? 'responsable_activite' : null }));
};

const creer = async (req) => {
  await exigerOng(req.tenantId);
  const b = req.body || {};
  const fonction = FONCTIONS[b.fonction] ? b.fonction : null;
  if (!fonction) throw err(400, 'Fonction : chef de projet ou responsable d\'activité.', 'SAISIE');
  const username = String(b.username || '').trim();
  if (!/^[A-Za-z0-9._@-]{3,60}$/.test(username)) throw err(400, 'Identifiant : 3 à 60 caractères (lettres, chiffres, point, tiret, @).', 'SAISIE');
  const email = String(b.email || '').trim() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw err(400, 'Adresse e-mail invalide.', 'SAISIE');
  const password = String(b.password || '');
  if (password.length < 8) throw err(400, 'Mot de passe : 8 caractères au moins.', 'SAISIE');
  try { await rolesClient.verifierRole(req.tenantId, 'collaborateur'); } catch (e) {
    if (e instanceof rolesClient.ErreurMetier) throw err(e.status, `${e.message} (un chef de projet ou un responsable d'activité est un compte « Collaborateur »).`, 'ROLE_NON_AUTORISE');
    throw e;
  }
  const projetId = b.projet_id ? Number(b.projet_id) : null;
  const activiteId = b.activite_id ? Number(b.activite_id) : null;
  const hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS, 10) || 12);
  try {
    return await sequelize.transaction(async (t) => {
      const roleId = await profil(req.tenantId, fonction, t);
      const u = await User.create({ tenant_id: req.tenantId, username, email, password_hash: hash, role: 'collaborateur', custom_role_id: roleId }, { transaction: t });
      const db = require('./modules.service').clientSequelize(sequelize, t);
      await require('./utilisateurs_modules.service').affecter({ tenantId: req.tenantId, code: 'caisse', cibleId: u.id, roleId: null, par: req.user.id, origine: 'creation', db });
      // Désignation immédiate (facultative).
      if (fonction === 'chef_projet' && projetId) {
        const [, r] = await X(`UPDATE activites SET chef_projet_id = :u WHERE id = :p AND tenant_id = :t AND type = 'projet'`, { u: u.id, p: projetId, t: req.tenantId }, t);
        if (!r?.rowCount) throw err(400, 'Projet introuvable.', 'PROJET_INTROUVABLE');
      }
      if (fonction === 'responsable_activite' && activiteId) {
        const [, r] = await X(`UPDATE activites SET responsable_id = :u WHERE id = :a AND tenant_id = :t AND projet_id IS NOT NULL`, { u: u.id, a: activiteId, t: req.tenantId }, t);
        if (!r?.rowCount) throw err(400, 'Activité introuvable.', 'ACTIVITE_INTROUVABLE');
      }
      await X(`INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, nouvelle_valeur)
               VALUES (:t, :par, 'CREATION_EQUIPE_PROJET', 'user', :u, CAST(:v AS jsonb))`,
      { t: req.tenantId, par: req.user.id, u: u.id, v: JSON.stringify({ username, fonction, projet_id: projetId, activite_id: activiteId }) }, t);
      return { id: u.id, username, fonction };
    });
  } catch (e) {
    if (e.name === 'SequelizeUniqueConstraintError') throw err(409, 'Cet identifiant existe déjà.', 'DOUBLON');
    throw e;
  }
};

module.exports = { lister, creer, FONCTIONS };
