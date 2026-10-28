import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';

// Super Admin — « Validation directe des prospects » (migration 035).
// Codes PERSONNELS des commerciaux : création (choisi ou généré ici, dans le
// navigateur), expiration, limite, désactivation, révocation, déblocage ;
// permission associée ; historique des tentatives. Aucun code n'est jamais
// relu depuis le serveur : il n'existe qu'au moment où on le saisit.
const ETATS = {
  aucun:     { label: 'Aucun code',  c: '#64748b', f: '#f1f5f9' },
  actif:     { label: 'Actif',       c: '#15803d', f: '#dcfce7' },
  desactive: { label: 'Désactivé',   c: '#92400e', f: '#fef3c7' },
  expire:    { label: 'Expiré',      c: '#b45309', f: '#ffedd5' },
  epuise:    { label: 'Épuisé',      c: '#b45309', f: '#ffedd5' },
  bloque:    { label: 'Bloqué',      c: '#b91c1c', f: '#fee2e2' },
};
const RESULTATS = {
  SUCCESS: { label: 'Validée', c: '#15803d' }, FAILED: { label: 'Échec', c: '#b91c1c' },
  REQUESTED: { label: 'Demande', c: '#1d4ed8' }, REJECTED: { label: 'Refusée', c: '#92400e' },
};
const MOTIFS = {
  CODE_INCORRECT: 'Code incorrect', CODE_INCORRECT_BLOCAGE: 'Code incorrect — blocage déclenché', BLOQUE: 'Tentative pendant le blocage',
  AUCUN_CODE: 'Aucun code attribué', CODE_INACTIF: 'Code désactivé', CODE_EXPIRE: 'Code expiré', LIMITE_ATTEINTE: 'Limite d\'utilisations atteinte',
  PERMISSION_ABSENTE: 'Sans permission', IDENTIFIANT_INCONNU: 'Identifiant inconnu',
  PROSPECT_EXISTANT: 'Prospect déjà connu (même e-mail)', COMPTE_EXISTANT: 'E-mail déjà utilisé par un compte', TELEPHONE_EXISTANT: 'Téléphone déjà connu',
};
const ROLES = { commercial: 'Commercial', comptable_cabinet: 'Comptable cabinet' };
const dt = (d, h = true) => (d ? new Date(d).toLocaleString('fr-FR', h
  ? { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }
  : { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
const versInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const finJour = (s) => (s ? new Date(`${s}T23:59:59`).toISOString() : null);

// Renouvellement périodique : durées proposées pour un nouveau code.
const DUREES = [
  { v: '7', label: '7 jours' }, { v: '15', label: '15 jours' }, { v: '30', label: '30 jours (recommandé)' },
  { v: '60', label: '60 jours' }, { v: '90', label: '90 jours' },
  { v: 'date', label: 'Jusqu\'à une date précise' }, { v: 'aucune', label: 'Sans expiration (déconseillé)' },
];
const dansJours = (n) => new Date(Date.now() + n * 864e5);
// Durée du code précédent, arrondie à la durée proposée la plus proche.
const dureePrecedente = (m) => {
  if (!m.code_id) return '30';
  if (!m.expire_le) return 'aucune';
  const j = Math.round((new Date(m.expire_le) - new Date(m.code_cree_le)) / 864e5);
  return ['7', '15', '30', '60', '90'].reduce((a, b) => (Math.abs(b - j) < Math.abs(a - j) ? b : a), '30');
};

// Génération dans le navigateur (aléa cryptographique), sans caractères ambigus.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const genererCode = (n = 8) => {
  const t = new Uint32Array(n);
  crypto.getRandomValues(t);
  return Array.from(t, (x) => ALPHABET[x % ALPHABET.length]).join('');
};

function Badge({ e }) {
  const s = ETATS[e] || ETATS.aucun;
  return <span style={{ background: s.f, color: s.c, fontWeight: 700, fontSize: 11, padding: '3px 9px', borderRadius: 20, whiteSpace: 'nowrap' }}>{s.label}</span>;
}

function CodeModal({ membre, onClose, onSaved }) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [voir, setVoir] = useState(true);
  const [duree, setDuree] = useState(dureePrecedente(membre));
  const [exp, setExp] = useState('');
  const [limite, setLimite] = useState('');
  const [note, setNote] = useState(false);
  const expiration = duree === 'aucune' ? null : duree === 'date' ? finJour(exp) : finJour(versInput(dansJours(+duree)));
  const [erreur, setErreur] = useState('');
  const [occupe, setOccupe] = useState(false);

  const enregistrer = async () => {
    if (!/^[A-Za-z0-9]{6,12}$/.test(code)) { setErreur('Le code doit compter 6 à 12 chiffres ou lettres, sans espace.'); return; }
    if (duree === 'date' && !exp) { setErreur('Choisissez la date d\'expiration.'); return; }
    if (!note) { setErreur('Confirmez avoir noté le code : il ne pourra plus être affiché.'); return; }
    setOccupe(true);
    const r = await api.post(`/validation-directe/${membre.id}/code`, { code, expire_le: expiration, limite_utilisations: limite || null });
    setOccupe(false);
    if (r.error) { setErreur(r.error); return; }
    setCode('');
    toast(membre.code_id ? 'Nouveau code enregistré : l\'ancien ne fonctionne plus.' : 'Code enregistré.', 'success');
    onSaved();
  };

  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 500 }}>
        <div className="modal-head"><h3>{membre.code_id ? 'Renouveler le code' : 'Créer un code'} — {membre.username}</h3><button className="modal-close" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          {membre.code_id && <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: 8, padding: '8px 12px', fontSize: 12.5, marginBottom: 10 }}>Le code actuel{membre.age_jours != null ? ` (créé il y a ${membre.age_jours} j)` : ''} cessera de fonctionner dès l'enregistrement. Le nouveau doit être différent.</div>}
          <label>Code personnel</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type={voir ? 'text' : 'password'} value={code} maxLength={12} autoComplete="off"
              onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())}
              style={{ fontFamily: 'Consolas, monospace', fontSize: 18, letterSpacing: 3, flex: 1 }} placeholder="6 à 12 caractères" />
            <button type="button" className="btn-ghost" onClick={() => { setCode(genererCode()); setVoir(true); }}>🎲 Générer</button>
            <button type="button" className="btn-ghost" onClick={() => setVoir((v) => !v)} aria-label={voir ? 'Masquer' : 'Afficher'}>{voir ? '🙈' : '👁'}</button>
          </div>
          <div className="fgrid2" style={{ marginTop: 4 }}>
            <div><label>Durée de validité</label>
              <select value={duree} onChange={(e) => setDuree(e.target.value)}>
                {DUREES.map((d) => <option key={d.v} value={d.v}>{d.label}</option>)}
              </select></div>
            <div><label>Utilisations max. (facultatif)</label><input type="number" min="1" value={limite} onChange={(e) => setLimite(e.target.value)} placeholder="Illimité" /></div>
          </div>
          {duree === 'date' && (<><label>Expire le</label><input type="date" value={exp} min={versInput(dansJours(1))} onChange={(e) => setExp(e.target.value)} /></>)}
          <div className="field-hint">
            {expiration ? <>Valable jusqu'au <b>{dt(expiration, false)}</b> inclus : pensez à le renouveler avant cette date.</>
              : 'Ce code restera valable tant que vous ne le changez pas.'}
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', textTransform: 'none', letterSpacing: 0, fontWeight: 500, fontSize: 13, marginTop: 12, color: 'var(--text)' }}>
            <input type="checkbox" checked={note} onChange={(e) => setNote(e.target.checked)} style={{ width: 'auto', marginTop: 3 }} />
            <span>J'ai noté ce code et je le transmets au commercial en main propre. Il ne sera <b>plus jamais affiché</b> (seule son empreinte est conservée).</span>
          </label>
          {erreur && <div className="alert-err" style={{ marginTop: 10 }}>{erreur}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn-primary" style={{ width: 'auto', marginTop: 0 }} onClick={enregistrer} disabled={occupe}>💾 Enregistrer le code</button>
        </div>
      </div>
    </div>
  );
}

function ReglagesModal({ membre, onClose, onSaved }) {
  const toast = useToast();
  const [exp, setExp] = useState(versInput(membre.expire_le));
  const [limite, setLimite] = useState(membre.limite_utilisations || '');
  const [erreur, setErreur] = useState('');
  const enregistrer = async () => {
    const r = await api.patch(`/validation-directe/codes/${membre.code_id}`, { expire_le: exp ? finJour(exp) : null, limite_utilisations: limite || null });
    if (r.error) { setErreur(r.error); return; }
    toast('Réglages du code enregistrés.', 'success'); onSaved();
  };
  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 440 }}>
        <div className="modal-head"><h3>Expiration et limite — {membre.username}</h3><button className="modal-close" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          <label>Expire le</label>
          <input type="date" value={exp} min={new Date(Date.now() + 864e5).toISOString().slice(0, 10)} onChange={(e) => setExp(e.target.value)} />
          <div className="field-hint">Laissez vide pour un code sans expiration.</div>
          <label>Utilisations max.</label>
          <input type="number" min="1" value={limite} onChange={(e) => setLimite(e.target.value)} placeholder="Illimité" />
          <div className="field-hint">Déjà utilisé {membre.nb_utilisations} fois.</div>
          {erreur && <div className="alert-err" style={{ marginTop: 10 }}>{erreur}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn-primary" style={{ width: 'auto', marginTop: 0 }} onClick={enregistrer}>Enregistrer</button>
        </div>
      </div>
    </div>
  );
}

export default function ValidationDirectePage() {
  const toast = useToast();
  const [liste, setListe] = useState(null);
  const [hist, setHist] = useState([]);
  const [filtreHist, setFiltreHist] = useState({ user_id: '', resultat: '' });
  const [erreur, setErreur] = useState('');
  const [modal, setModal] = useState(null); // { code: membre } | { reglages: membre }

  const charger = useCallback(async () => {
    const r = await api.get('/validation-directe');
    if (r.error) { setErreur(r.error); return; }
    setListe(r);
  }, []);
  const chargerHist = useCallback(async () => {
    const p = new URLSearchParams(Object.entries(filtreHist).filter(([, v]) => v));
    const r = await api.get(`/validation-directe/historique?${p}`);
    if (!r.error) setHist(r);
  }, [filtreHist]);
  useEffect(() => { charger(); }, [charger]);
  useEffect(() => { chargerHist(); }, [chargerHist]);
  const recharger = () => { setModal(null); charger(); chargerHist(); };

  const action = async (promesse, msg) => {
    const r = await promesse;
    if (r.error) { toast(r.error, 'error'); return; }
    toast(msg, 'success'); recharger();
  };
  const basculerPermission = (m) => {
    if (m.permission && !window.confirm(`Retirer à ${m.username} le droit de valider directement une demande de démonstration ?`)) return;
    action(api.put(`/validation-directe/${m.id}/permission`, { autorise: !m.permission }),
      m.permission ? `Permission retirée à ${m.username}.` : `${m.username} peut valider directement (avec son code).`);
  };
  const basculerActif = (m) => action(api.patch(`/validation-directe/codes/${m.code_id}`, { actif: !m.code_actif }),
    m.code_actif ? 'Code désactivé.' : 'Code réactivé.');
  const revoquer = (m) => {
    if (!window.confirm(`Révoquer définitivement le code de ${m.username} ? Il faudra en créer un nouveau.`)) return;
    action(api.post(`/validation-directe/codes/${m.code_id}/revoquer`), 'Code révoqué.');
  };
  const debloquer = (m) => action(api.post(`/validation-directe/codes/${m.code_id}/debloquer`), 'Code débloqué.');

  if (erreur) return <div className="alert-err">{erreur}</div>;
  if (!liste) return <div className="loading-msg">Chargement…</div>;

  const autorises = liste.filter((m) => m.permission).length;
  const actifs = liste.filter((m) => m.etat_code === 'actif').length;
  const echecs = liste.reduce((s, m) => s + (m.echecs_30j || 0), 0);
  const aRenouveler = liste.filter((m) => m.actif && m.a_renouveler);

  return (
    <>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>Validation directe des prospects</h2>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0, maxWidth: 820 }}>
        Un commercial autorisé peut valider sur place une demande de démonstration : en bas du formulaire public « Demander une démonstration », il saisit son identifiant et son <b>code personnel</b>. La démo est ouverte tout de suite et le prospect lui est attribué, sans attendre votre validation.
        Vous seul créez les codes et vous les <b>renouvelez périodiquement</b> (30 jours par défaut) : le nouveau code remplace immédiatement l'ancien.
        Les codes sont conservés sous forme d'empreinte : ni vous ni personne ne peut les relire. Cinq codes faux bloquent la validation directe 15 minutes.
      </p>

      <div className="kpi-grid">
        <div className="kpi-card"><div className="kpi-icon kpi-blue"><svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg></div>
          <div className="kpi-body"><p className="kpi-label">Autorisés</p><p className="kpi-value">{autorises} / {liste.length}</p></div></div>
        <div className="kpi-card"><div className="kpi-icon kpi-green"><svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg></div>
          <div className="kpi-body"><p className="kpi-label">Codes actifs</p><p className="kpi-value">{actifs}</p></div></div>
        <div className="kpi-card"><div className="kpi-icon kpi-red"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg></div>
          <div className="kpi-body"><p className="kpi-label">Échecs (30 jours)</p><p className="kpi-value" style={{ color: echecs ? '#b91c1c' : undefined }}>{echecs}</p></div></div>
        <div className="kpi-card"><div className="kpi-icon" style={{ background: "#ffedd5", color: "#c2410c" }}><svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg></div>
          <div className="kpi-body"><p className="kpi-label">Codes à renouveler</p><p className="kpi-value" style={{ color: aRenouveler.length ? '#c2410c' : undefined }}>{aRenouveler.length}</p></div></div>
      </div>

      {aRenouveler.length > 0 && (
        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>
          🔁 <b>{aRenouveler.length} code{aRenouveler.length > 1 ? 's' : ''} à renouveler</b> (expiré, épuisé ou expirant dans 7 jours) :{' '}
          {aRenouveler.map((m, i) => (
            <span key={m.id}>{i > 0 && ', '}<button type="button" onClick={() => setModal({ code: m })}
              style={{ background: 'none', border: 0, padding: 0, color: '#9a3412', textDecoration: 'underline', cursor: 'pointer', fontWeight: 700, fontFamily: 'inherit', fontSize: 13 }}>{m.username}</button></span>
          ))}.
        </div>
      )}

      <div className="table-wrap" style={{ marginBottom: 24 }}>
        <table>
          <thead><tr><th>Commercial</th><th>Permission</th><th>Code</th><th>Statut</th><th>Expiration</th><th>Dernière utilisation</th><th style={{ textAlign: 'center' }}>Validations / échecs 30 j</th><th>Actions</th></tr></thead>
          <tbody>
            {liste.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>Aucun commercial ni comptable cabinet.</td></tr>}
            {liste.map((m) => (
              <tr key={m.id} style={!m.actif ? { opacity: 0.55 } : undefined}>
                <td><b>{m.username}</b><div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{ROLES[m.role] || m.role}{!m.actif ? ' · compte désactivé' : ''}</div></td>
                <td>
                  <button type="button" onClick={() => basculerPermission(m)} title={m.permission ? 'Retirer la permission' : 'Accorder la permission'}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 20, cursor: 'pointer', fontSize: 11.5, fontWeight: 700,
                      border: `1px solid ${m.permission ? '#16a34a' : 'var(--border)'}`, background: m.permission ? '#f0fdf4' : '#fff', color: m.permission ? '#15803d' : 'var(--text-muted)' }}>
                    <span style={{ width: 24, height: 13, borderRadius: 8, background: m.permission ? '#16a34a' : '#cbd5e1', position: 'relative', display: 'inline-block' }}>
                      <span style={{ position: 'absolute', top: 2, left: m.permission ? 13 : 2, width: 9, height: 9, borderRadius: '50%', background: '#fff' }} />
                    </span>
                    {m.permission ? 'Autorisé' : 'Non autorisé'}
                  </button>
                </td>
                <td style={{ fontFamily: 'Consolas, monospace', letterSpacing: 2, color: 'var(--text-muted)' }}>{m.code_id ? '••••••' : '—'}</td>
                <td><Badge e={m.etat_code} />{m.etat_code === 'bloque' && <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 2 }}>jusqu'à {new Date(m.bloque_jusqu_au).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>}</td>
                <td style={{ fontSize: 12.5 }}>{m.code_id ? (m.expire_le ? dt(m.expire_le, false) : 'Sans expiration') : '—'}
                  {m.code_id && m.jours_restants !== null && m.jours_restants >= 0 && m.etat_code !== 'expire' && (
                    <div style={{ fontSize: 11, fontWeight: m.a_renouveler ? 700 : 400, color: m.a_renouveler ? '#c2410c' : 'var(--text-muted)' }}>
                      {m.a_renouveler ? '⚠ ' : ''}{m.jours_restants === 0 ? 'expire aujourd\'hui' : `dans ${m.jours_restants} j`}</div>)}
                  {m.code_id && <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>créé il y a {m.age_jours} j</div>}
                  {m.limite_utilisations ? <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.nb_utilisations}/{m.limite_utilisations} utilisations</div> : null}</td>
                <td style={{ fontSize: 12.5 }}>{dt(m.derniere_utilisation_le)}</td>
                <td style={{ textAlign: 'center', fontSize: 12.5 }}><b style={{ color: '#15803d' }}>{m.nb_validations}</b> / <span style={{ color: m.echecs_30j ? '#b91c1c' : 'var(--text-muted)' }}>{m.echecs_30j}</span></td>
                <td>
                  <div className="row-actions" style={{ flexWrap: 'wrap' }}>
                    <button className="btn-ghost btn-sm" onClick={() => setModal({ code: m })}>{m.code_id ? '🔁 Renouveler' : '➕ Créer un code'}</button>
                    {m.code_id && (
                      <>
                        <button className="btn-icon" title={m.code_actif ? 'Désactiver' : 'Réactiver'} onClick={() => basculerActif(m)}>{m.code_actif ? '⏸' : '▶️'}</button>
                        <button className="btn-icon" title="Expiration et limite" onClick={() => setModal({ reglages: m })}>📅</button>
                        {m.etat_code === 'bloque' && <button className="btn-icon" title="Débloquer" onClick={() => debloquer(m)}>🔓</button>}
                        <button className="btn-icon danger" title="Révoquer" onClick={() => revoquer(m)}>⛔</button>
                      </>
                    )}
                    <button className="btn-icon" title="Historique" onClick={() => setFiltreHist({ user_id: m.id, resultat: '' })}>🕘</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <h3 style={{ fontSize: 15, margin: 0 }}>Historique des validations et tentatives</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={filtreHist.user_id} onChange={(e) => setFiltreHist((f) => ({ ...f, user_id: e.target.value }))} style={{ padding: '7px 10px', border: '1.5px solid var(--border)', borderRadius: 7 }}>
            <option value="">Tous les commerciaux</option>
            {liste.map((m) => <option key={m.id} value={m.id}>{m.username}</option>)}
          </select>
          <select value={filtreHist.resultat} onChange={(e) => setFiltreHist((f) => ({ ...f, resultat: e.target.value }))} style={{ padding: '7px 10px', border: '1.5px solid var(--border)', borderRadius: 7 }}>
            <option value="">Tous les résultats</option>
            {Object.entries(RESULTATS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Par</th><th>Prospect</th><th>Méthode</th><th>Résultat</th><th>Détail</th><th>Adresse IP</th></tr></thead>
          <tbody>
            {hist.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>Aucune entrée.</td></tr>}
            {hist.map((h) => (
              <tr key={h.id}>
                <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{dt(h.created_at)}</td>
                <td style={{ fontSize: 12.5 }}>{h.username || '—'}</td>
                <td style={{ fontSize: 12.5 }}>{h.entreprise || h.nom_complet || h.prospect_libelle || '—'}</td>
                <td style={{ fontSize: 12 }}>{h.methode === 'DIRECT_CODE' ? '🔐 Code' : h.methode === 'SUPER_ADMIN' ? '👤 Super Admin' : '📨 Demande'}</td>
                <td><b style={{ fontSize: 12, color: RESULTATS[h.resultat]?.c }}>{RESULTATS[h.resultat]?.label || h.resultat}</b></td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{MOTIFS[h.motif] || h.motif || ''}</td>
                <td style={{ fontSize: 11.5, color: 'var(--text-muted)' }} title={h.user_agent}>{h.ip_address || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal?.code && <CodeModal membre={modal.code} onClose={() => setModal(null)} onSaved={recharger} />}
      {modal?.reglages && <ReglagesModal membre={modal.reglages} onClose={() => setModal(null)} onSaved={recharger} />}
    </>
  );
}
