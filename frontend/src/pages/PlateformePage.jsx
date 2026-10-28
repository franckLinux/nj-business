import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import { ModulesClient, ModulesMatrice } from '@/components/ModulesClients';
import SuppressionClient from '@/components/SuppressionClient';

// Administration PLATEFORME (réforme, étape 8) — super_admin.
// Vue administrative et technique des clients : aucune donnée de transaction.
// L'accès aux écrans de caisse d'un client passe par un accès support
// temporaire et tracé (composant SupportAcces).
const dateFr = (d, h = false) => (d ? (h ? new Date(d).toLocaleString('fr-FR') : new Date(d).toLocaleDateString('fr-FR')) : '—');
const ROLES = { directeur: 'Directeur', caissier: 'Caissier(ère)', auditeur: 'Comptable', comptable_cabinet: 'Comptable cabinet' };
const ACTIONS = {
  CREATION_CLIENT: 'Création du client', MODIF_CLIENT: 'Modification des informations',
  SUSPENSION_CLIENT: 'Suspension', REACTIVATION_CLIENT: 'Réactivation',
  SUPPORT_OUVERT: 'Accès support ouvert', SUPPORT_FERME: 'Accès support fermé',
  ROLES_CLIENT: 'Rôles autorisés modifiés',
  MODULE_ACTIVATION: 'Module activé', MODULE_DESACTIVATION: 'Module désactivé',
  INIT_PLAN_COMPTABLE: 'Initialisation du plan comptable', SYNC_PLAN_COMPTABLE: 'Synchronisation du plan comptable',
  SUPPRESSION_CLIENT: 'Client supprimé',
};
const resume = (v) => (v ? Object.entries(v).filter(([, x]) => x !== undefined && x !== null && x !== '').map(([k, x]) => `${k} : ${typeof x === 'object' ? JSON.stringify(x) : x}`).join(' · ') : '');

function Tuile({ label, valeur, couleur }) {
  return (
    <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 18px', minWidth: 160 }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: couleur || 'var(--text)' }}>{valeur}</div>
    </div>
  );
}

function AuditListe({ lignes }) {
  if (!lignes) return <div className="loading-msg">Chargement…</div>;
  if (lignes.length === 0) return <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Aucune action enregistrée.</p>;
  return (
    <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
      <table>
        <thead><tr><th>Date</th><th>Client</th><th>Action</th><th>Par</th><th>Détail</th></tr></thead>
        <tbody>
          {lignes.map((a, i) => (
            <tr key={i}>
              <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{dateFr(a.created_at, true)}</td>
              <td>{a.client || '—'}</td>
              <td style={{ fontWeight: 600, fontSize: 13 }}>{ACTIONS[a.action] || a.action}</td>
              <td>{a.username || 'système'}</td>
              <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{resume(a.nouvelle_valeur)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Rôles autorisés du client (migration 038). Par défaut : démonstration →
// Directeur + Caissier ; client → tous. Le choix du super_admin est prioritaire.
const ROLES_CLIENT = [
  ['directeur', 'Directeur', 'Encadrement : validation, paramétrage, utilisateurs'],
  ['caissier', 'Caissier(ère)', 'Saisie quotidienne des mouvements'],
  ['auditeur', 'Comptable', 'Contrôle comptable : imputations et observations'],
];

function RolesClient({ id, utilisateurs }) {
  const toast = useToast();
  const [info, setInfo] = useState(null);
  const [choix, setChoix] = useState([]);
  const [erreur, setErreur] = useState('');
  const [saving, setSaving] = useState(false);

  const charger = useCallback(async () => {
    const r = await api.get(`/plateforme/clients/${id}/roles`);
    if (r.error) { setErreur(r.error); return; }
    setInfo(r); setChoix(r.roles); setErreur('');
  }, [id]);
  useEffect(() => { charger(); }, [charger]);

  const enregistrer = async (roles) => {
    setSaving(true);
    const r = await api.put(`/plateforme/clients/${id}/roles`, { roles });
    setSaving(false);
    if (r.error) { setErreur(r.error); return; }
    toast(roles === null ? 'Rôles remis à la valeur par défaut.' : 'Rôles autorisés enregistrés.', 'success');
    setInfo(r); setChoix(r.roles); setErreur('');
  };

  if (!info) return erreur ? <div className="alert-err">{erreur}</div> : <div className="loading-msg">Chargement…</div>;
  const actifsParRole = (r) => utilisateurs.filter((u) => u.actif && u.role === r).length;
  const modifie = choix.length !== info.roles.length || choix.some((r) => !info.roles.includes(r));
  const demo = info.type_compte === 'demo';
  return (
    <>
      <p style={{ fontSize: 13, marginBottom: 10 }}>
        Rôles que ce client peut attribuer à ses utilisateurs (nombre d'utilisateurs illimité).{' '}
        {info.personnalise
          ? <strong>Réglage personnalisé.</strong>
          : <span style={{ color: 'var(--text-muted)' }}>Valeur par défaut {demo ? 'd\'une démonstration (Directeur + Caissier)' : 'd\'un client (tous les rôles)'}.</span>}
      </p>
      <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
        {ROLES_CLIENT.map(([code, nom, desc]) => {
          const n = actifsParRole(code);
          const coche = choix.includes(code);
          const verrou = coche && n > 0;
          return (
            <label key={code} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, background: coche ? '#eff6ff' : 'white', cursor: verrou ? 'not-allowed' : 'pointer', textTransform: 'none', letterSpacing: 0, fontSize: 13, color: 'var(--text)', fontWeight: 400, margin: 0 }}
              title={verrou ? `${n} utilisateur(s) actif(s) ont ce rôle : changez leur rôle ou désactivez-les avant de le retirer.` : ''}>
              <input type="checkbox" checked={coche} disabled={verrou || saving} style={{ appearance: 'auto', WebkitAppearance: 'auto', width: 16, height: 16, padding: 0, marginTop: 2, flexShrink: 0, accentColor: 'var(--accent)' }}
                onChange={(e) => setChoix((c) => (e.target.checked ? [...c, code] : c.filter((x) => x !== code)))} />
              <span>
                <strong>{nom}</strong> <span style={{ color: 'var(--text-muted)' }}>— {desc}</span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)' }}>{n} utilisateur(s) actif(s)</span>
              </span>
            </label>
          );
        })}
      </div>
      {erreur && <div className="alert-err" style={{ marginBottom: 10 }}>{erreur}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn-add" disabled={!modifie || saving || choix.length === 0} onClick={() => enregistrer(choix)}>Enregistrer</button>
        {info.personnalise && <button className="btn-secondary" disabled={saving} onClick={() => enregistrer(null)}>Revenir à la valeur par défaut</button>}
      </div>
      {demo && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
          À la conversion en client, le nouvel espace reçoit tous les rôles (réglage modifiable ensuite ici).
        </p>
      )}
    </>
  );
}

function DetailClient({ id, onClose, onChange }) {
  const toast = useToast();
  const { selectTenant } = useApp();
  const [d, setD] = useState(null);
  const [audit, setAudit] = useState(null);
  const [f, setF] = useState(null);
  const [erreur, setErreur] = useState('');
  const [onglet, setOnglet] = useState('infos');
  const [suppression, setSuppression] = useState(false);

  const charger = useCallback(async () => {
    const [r, a] = await Promise.all([api.get(`/plateforme/clients/${id}`), api.get(`/plateforme/audit?tenant=${id}`)]);
    if (r.error) { setErreur(r.error); return; }
    setD(r); setAudit(Array.isArray(a) ? a : []);
    const c = r.client;
    setF({ nom: c.nom, contact_nom: c.contact_nom || '', contact_email: c.contact_email || '', contact_telephone: c.contact_telephone || '', pays: c.pays || '', ville: c.ville || '', devise: c.devise || 'FCFA' });
  }, [id]);
  useEffect(() => { charger(); }, [charger]);

  const enregistrer = async () => {
    const r = await api.put(`/plateforme/clients/${id}`, f);
    if (r.error) { setErreur(r.error); return; }
    toast('Informations du client enregistrées.', 'success'); setErreur(''); charger(); onChange();
  };
  const basculerActif = async () => {
    const c = d.client;
    let motif = '';
    if (c.actif) {
      motif = window.prompt(`Suspendre « ${c.nom} » ?\nSes utilisateurs n'auront plus accès à leurs données.\n\nMotif de la suspension :`) || '';
      if (!motif.trim()) return;
    } else if (!window.confirm(`Réactiver « ${c.nom} » ?`)) return;
    const r = await api.patch(`/plateforme/clients/${id}/actif`, { actif: !c.actif, motif });
    if (r.error) { toast(r.error, 'error'); return; }
    toast(c.actif ? 'Client suspendu.' : 'Client réactivé.', 'success'); charger(); onChange();
  };
  const ouvrirClient = () => {
    selectTenant(d.client.id, d.client.nom, d.client.devise);
    onClose();
  };

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 820 }}>
        <div className="modal-head"><h3>🏢 {d?.client.nom || 'Client'}</h3><button className="modal-close" onClick={onClose}>✕</button></div>
        <div className="modal-body" style={{ maxHeight: '72vh', overflowY: 'auto' }}>
          {erreur && <div className="alert-err" style={{ marginBottom: 10 }}>{erreur}</div>}
          {!d ? <div className="loading-msg">Chargement…</div> : (
            <>
              {d.client.alertes.length > 0 && (
                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#92400e', marginBottom: 12 }}>
                  ⚠ {d.client.alertes.join(' · ')}{d.client.suspension_motif ? ` — motif : ${d.client.suspension_motif}` : ''}
                </div>
              )}
              <div className="tabs-header" style={{ marginBottom: 12 }}>
                {[['infos', 'Informations'], ['users', `Utilisateurs (${d.utilisateurs.length})`], ['roles', 'Rôles autorisés'], ['modules', '▦ Modules'], ['plan', 'Plan comptable'], ['audit', 'Journal d\'audit']].map(([k, l]) => (
                  <button key={k} className={'tab-btn' + (onglet === k ? ' active' : '')} onClick={() => setOnglet(k)}>{l}</button>
                ))}
              </div>
              {onglet === 'infos' && f && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div className="form-section"><label>Nom de l'entreprise</label><input value={f.nom} onChange={set('nom')} /></div>
                    <div className="form-section"><label>Responsable</label><input value={f.contact_nom} onChange={set('contact_nom')} placeholder={d.client.responsable || ''} /></div>
                    <div className="form-section"><label>E-mail</label><input value={f.contact_email} onChange={set('contact_email')} /></div>
                    <div className="form-section"><label>Téléphone</label><input value={f.contact_telephone} onChange={set('contact_telephone')} /></div>
                    <div className="form-section"><label>Pays</label><input value={f.pays} onChange={set('pays')} /></div>
                    <div className="form-section"><label>Ville</label><input value={f.ville} onChange={set('ville')} /></div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Créé le {dateFr(d.client.created_at)} · dernier accès {dateFr(d.client.dernier_acces, true)} · {d.client.nb_journaux} caisse(s)/journal(aux) actif(s)
                  </div>
                </>
              )}
              {onglet === 'users' && (
                <>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Identifiant</th><th>E-mail</th><th>Rôle</th><th>Profil</th><th>Statut</th><th>Dernière connexion</th></tr></thead>
                      <tbody>
                        {d.utilisateurs.map((u) => (
                          <tr key={u.id}>
                            <td>{u.username}</td><td>{u.email || '—'}</td><td>{ROLES[u.role] || u.role}</td><td>{u.profil || '—'}</td>
                            <td>{u.actif ? 'Actif' : 'Désactivé'}</td><td style={{ fontSize: 12 }}>{dateFr(u.derniere_connexion, true)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Profils métier du client : {d.profils.length ? d.profils.map((p) => `${p.nom} (${p.nb_utilisateurs})`).join(', ') : 'aucun'}.
                    Pour inviter ou gérer un utilisateur : bouton « Gérer dans Configuration » ci-dessous (procédure habituelle).
                  </p>
                </>
              )}
              {onglet === 'plan' && (
                <>
                  <p style={{ fontSize: 13 }}>
                    Version du modèle : <strong>{d.client.plan_version || 'non initialisé'}</strong> · initialisé le {dateFr(d.client.plan_initialise_le)} ·
                    dernière synchronisation {dateFr(d.client.plan_derniere_synchro, true)} · dernière modification {dateFr(d.client.plan_derniere_modif, true)}
                  </p>
                  {d.synchronisations.length > 0 && (
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>Date</th><th>Versions</th><th>Appliqués</th></tr></thead>
                        <tbody>{d.synchronisations.map((s, i) => <tr key={i}><td>{dateFr(s.created_at, true)}</td><td>{s.version_source || '—'} → {s.version_cible}</td><td>{s.nb_appliques} / {s.nb_proposes}</td></tr>)}</tbody>
                      </table>
                    </div>
                  )}
                  <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Aperçu et synchronisation : page « Modèle comptable » → onglet Synchronisation.</p>
                </>
              )}
              {onglet === 'roles' && <RolesClient id={id} utilisateurs={d.utilisateurs} />}
              {onglet === 'modules' && <ModulesClient id={id} />}
              {onglet === 'audit' && <AuditListe lignes={audit} />}
            </>
          )}
        </div>
        {d && (
          <div className="modal-foot" style={{ gap: 10, justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-secondary" onClick={basculerActif}>{d.client.actif ? '⏸ Suspendre' : '↺ Réactiver'}</button>
              {d.client.actif && <button className="btn-secondary" onClick={ouvrirClient} title="Sélectionne ce client (utilisateurs, configuration, plan comptable)">Gérer dans Configuration</button>}
              <button className="btn-secondary" onClick={() => setSuppression(true)} style={{ color: '#b91c1c', borderColor: '#fecaca' }}
                title="Réservé à un client ajouté manuellement et jamais utilisé">🗑 Supprimer</button>
            </div>
            {onglet === 'infos' && <button className="btn-add" onClick={enregistrer}>Enregistrer</button>}
          </div>
        )}
      </div>
      {suppression && <SuppressionClient id={id} onAnnuler={() => setSuppression(false)} onSupprime={() => { setSuppression(false); onClose(); onChange(); }} />}
    </div>
  );
}

export default function PlateformePage() {
  const [data, setData] = useState(null);
  const [audit, setAudit] = useState(null);
  const [erreur, setErreur] = useState('');
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState(null);

  const charger = useCallback(async () => {
    const [c, a] = await Promise.all([api.get('/plateforme/clients'), api.get('/plateforme/audit')]);
    if (c.error) { setErreur(c.error); return; }
    setData(c); setAudit(Array.isArray(a) ? a : []);
  }, []);
  useEffect(() => { charger(); }, [charger]);

  if (erreur) return <div className="alert-err">{erreur}</div>;
  if (!data) return <div className="loading-msg">Chargement…</div>;

  const s = q.trim().toLowerCase();
  const clients = data.clients.filter((c) => !s || [c.nom, c.responsable, c.contact_email, c.ville].some((x) => (x || '').toLowerCase().includes(s)));

  return (
    <>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>Administration plateforme</h2>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0 }}>
        Gestion administrative des clients. Les écrans de caisse d'un client ne sont accessibles qu'avec un accès support temporaire et tracé.
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <Tuile label="Clients" valeur={data.stats.clients} />
        <Tuile label="Clients actifs" valeur={data.stats.actifs} couleur="#15803d" />
        <Tuile label="Utilisateurs" valeur={data.stats.utilisateurs} />
        <Tuile label="Clients avec alerte" valeur={data.stats.avec_alertes} couleur={data.stats.avec_alertes ? '#c2410c' : undefined} />
      </div>
      <input type="search" placeholder="🔍 Client, responsable, e-mail, ville…" value={q} onChange={(e) => setQ(e.target.value)}
        style={{ padding: '8px 12px', border: '1.5px solid var(--border)', borderRadius: 7, fontSize: 13, minWidth: 280, marginBottom: 10 }} />
      <div className="table-wrap" style={{ marginBottom: 24 }}>
        <table>
          <thead><tr><th>Client</th><th>Responsable / contact</th><th>Lieu</th><th>Créé le</th><th>Statut</th><th>Dernier accès</th><th>Utilisateurs</th><th>Caisses</th><th>Plan comptable</th><th>Alertes</th></tr></thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id} onClick={() => setDetail(c.id)} style={{ cursor: 'pointer' }} title="Voir le détail">
                <td style={{ fontWeight: 700 }}>{c.nom}{c.type_compte === 'demo' && <span style={{ marginLeft: 6, background: '#fefce8', color: '#a16207', fontSize: 10, padding: '2px 6px', borderRadius: 10 }}>DÉMO · fin {dateFr(c.demo_expire_le)}</span>}</td>
                <td style={{ fontSize: 12 }}>{c.responsable || '—'}<div style={{ color: 'var(--text-muted)' }}>{[c.contact_email, c.contact_telephone].filter(Boolean).join(' · ')}</div></td>
                <td style={{ fontSize: 12 }}>{[c.ville, c.pays].filter(Boolean).join(', ') || '—'}</td>
                <td style={{ fontSize: 12 }}>{dateFr(c.created_at)}</td>
                <td>{c.actif ? <span style={{ color: '#15803d', fontWeight: 700, fontSize: 12 }}>Actif</span> : <span style={{ color: '#b91c1c', fontWeight: 700, fontSize: 12 }}>Suspendu</span>}</td>
                <td style={{ fontSize: 12 }}>{dateFr(c.dernier_acces, true)}</td>
                <td>{c.nb_utilisateurs_actifs}/{c.nb_utilisateurs}<div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{(c.roles || []).map((r) => ROLES[r] || r).join(', ')}</div></td>
                <td>{c.nb_journaux}</td>
                <td style={{ fontSize: 12 }}><code>{c.plan_version || '—'}</code><div style={{ color: 'var(--text-muted)' }}>synchro {dateFr(c.plan_derniere_synchro)}</div></td>
                <td style={{ fontSize: 11, color: '#c2410c' }}>{c.alertes.join(' · ') || <span style={{ color: '#15803d' }}>✓</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 style={{ fontSize: 15, margin: '0 0 4px' }}>▦ Modules NJ BUSINESS par client</h3>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0 }}>Un module désactivé n'est plus accessible aux utilisateurs du client (contrôle serveur). Ses données sont conservées et retrouvées à la réactivation.</p>
      <div style={{ marginBottom: 24 }}><ModulesMatrice /></div>
      <h3 style={{ fontSize: 15, margin: '0 0 8px' }}>Journal des actions administratives</h3>
      <AuditListe lignes={audit} />
      {detail && <DetailClient id={detail} onClose={() => setDetail(null)} onChange={charger} />}
    </>
  );
}
