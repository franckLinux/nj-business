// NJ BUSINESS — Sessions ouvertes (067, lot D).
//
//  • <SessionsOuvertes /> : qui est connecté maintenant, sur quel appareil,
//    depuis quand ; « Fermer » déconnecte la personne immédiatement (motif
//    facultatif, tracé). Directeur : son entreprise ; super_admin sans client
//    choisi : toute la plateforme.
//  • <ReglagesSessions /> (super_admin) : délai d'inactivité et durée maximale.
//  • <MesAppareils /> (Mon compte) : sa session et « Déconnecter tous mes appareils ».
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import '@/styles/utilisateurs-module.css';

const dateHeure = (d) => (d ? new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const depuis = (d) => {
  if (!d) return '—';
  const min = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000));
  if (min < 1) return 'à l\'instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `il y a ${h} h ${String(min % 60).padStart(2, '0')}` : dateHeure(d);
};
const TYPES = { ordinateur: '💻 Ordinateur', mobile: '📱 Téléphone / tablette' };
const STATUTS = { active: 'Active', fermee: 'Déconnectée', expiree: 'Expirée', remplacee: 'Remplacée', revoquee: 'Fermée par un administrateur' };

export function SessionsOuvertes({ plateforme = false }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState('');
  const [cible, setCible] = useState(null);
  const [motif, setMotif] = useState('');
  const [enCours, setEnCours] = useState(false);
  const charger = useCallback(async () => {
    const r = await api.get('/sessions');
    if (r?.error) { setErreur(r.error); return; }
    setErreur(''); setD(r);
  }, []);
  useEffect(() => { charger(); }, [charger]);

  const fermer = async (e) => {
    e.preventDefault();
    setEnCours(true);
    const r = await api.delete(`/sessions/${cible.id}`, { motif });
    setEnCours(false);
    if (r?.error) { toast(r.error, 'error', 7000); return; }
    toast(`${cible.username} est déconnecté(e).`, 'success');
    setCible(null); setMotif('');
    charger();
  };

  if (erreur) return /pas encore disponible/i.test(erreur) ? null : <div className="alert-err">{erreur}</div>;
  if (!d) return <div className="loading-msg">Chargement…</div>;
  return (
    <section className="um-autres" aria-labelledby="se-titre">
      <div className="se-entete">
        <h3 id="se-titre" className="se-titre">Connectés maintenant ({d.sessions.length})</h3>
        <button type="button" className="um-btn" onClick={charger}>Actualiser</button>
      </div>
      <p className="um-texte">
        {d.reglages.par_type_appareil !== false
          ? 'Une session par compte et par type d\'appareil : un ordinateur et un téléphone au plus.'
          : 'Une seule session par compte, tous appareils confondus.'} Une session sans activité pendant {d.reglages.inactivite_min} min se ferme seule ;
        aucune ne dure plus de {Math.round(d.reglages.duree_max_min / 60)} h.
      </p>
      {d.sessions.length === 0 ? <p className="um-texte">Personne n'est connecté.</p> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Utilisateur</th>{plateforme && <th>Client</th>}<th>Appareil</th><th>Connecté</th><th>Dernière activité</th><th aria-label="Action" /></tr>
            </thead>
            <tbody>
              {d.sessions.map((s) => (
                <tr key={s.id}>
                  <td><b style={{ fontSize: 13 }}>{s.username}</b>{s.courante && <span className="um-module" style={{ marginLeft: 6 }}>vous</span>}</td>
                  {plateforme && <td style={{ fontSize: 12.5 }}>{s.client || 'Cabinet'}</td>}
                  <td style={{ fontSize: 12.5 }}>{TYPES[s.type_appareil] && <span className="um-sous" style={{ marginTop: 0 }}>{TYPES[s.type_appareil]}</span>}{s.appareil || '—'}{s.ip && <span className="um-sous">{s.ip}</span>}</td>
                  <td style={{ fontSize: 12.5 }}>{dateHeure(s.cree_le)}</td>
                  <td style={{ fontSize: 12.5 }}>{depuis(s.derniere_activite)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {!s.courante && <button type="button" className="um-btn um-retirer" onClick={() => { setCible(s); setMotif(''); }}>Fermer</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cible && (
        <div className="modal-overlay" style={{ display: 'flex' }} onMouseDown={(e) => { if (e.target === e.currentTarget && !enCours) setCible(null); }}>
          <form className="modal-box um-modale" onSubmit={fermer} role="dialog" aria-modal="true" aria-labelledby="se-fermer-titre">
            <div className="modal-head">
              <h3 id="se-fermer-titre">Fermer la session de {cible.username}</h3>
              <button type="button" className="modal-close" onClick={() => setCible(null)} aria-label="Fermer">✕</button>
            </div>
            <div className="modal-body">
              <p className="um-texte">{cible.appareil || 'Appareil non identifié'}, connecté le {dateHeure(cible.cree_le)}. La personne est déconnectée immédiatement ; une saisie hors ligne en attente n'est pas perdue, elle partira à sa reconnexion.</p>
              <label className="um-label" htmlFor="se-motif">Motif (facultatif)</label>
              <input id="se-motif" className="um-select um-select-large" value={motif} onChange={(e) => setMotif(e.target.value)} maxLength={300}
                placeholder="Ex : poste laissé ouvert" autoFocus />
            </div>
            <div className="modal-foot" style={{ gap: 10 }}>
              <button type="button" className="btn-ghost" onClick={() => setCible(null)} disabled={enCours}>Annuler</button>
              <button type="submit" className="btn-danger" disabled={enCours}>{enCours ? 'Fermeture…' : 'Fermer la session'}</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

export function ReglagesSessions() {
  const toast = useToast();
  const [r, setR] = useState(null);
  const [f, setF] = useState({ inactivite_min: '', duree_max_min: '', par_type_appareil: true });
  const [enCours, setEnCours] = useState(false);
  useEffect(() => {
    api.get('/plateforme/sessions').then((x) => {
      if (x?.error) return;
      setR(x); setF({ inactivite_min: String(x.reglages.inactivite_min), duree_max_min: String(x.reglages.duree_max_min), par_type_appareil: x.reglages.par_type_appareil !== false });
    });
  }, []);
  if (!r) return null;
  const enregistrer = async (e) => {
    e.preventDefault();
    setEnCours(true);
    const x = await api.put('/plateforme/sessions', { inactivite_min: Number(f.inactivite_min), duree_max_min: Number(f.duree_max_min), par_type_appareil: f.par_type_appareil });
    setEnCours(false);
    if (x?.error) { toast(x.error, 'error', 7000); return; }
    setR(x);
    toast('Réglages des sessions enregistrés. Ils valent pour les prochaines connexions.', 'success');
  };
  return (
    <form className="se-reglages" onSubmit={enregistrer}>
      <div>
        <label className="um-label" htmlFor="se-inac">Inactivité avant déconnexion (min)</label>
        <input id="se-inac" type="number" min="5" max="1440" className="um-select um-select-large" value={f.inactivite_min}
          onChange={(e) => setF({ ...f, inactivite_min: e.target.value })} />
      </div>
      <div>
        <label className="um-label" htmlFor="se-max">Durée maximale d'une session (min)</label>
        <input id="se-max" type="number" min="30" max="10080" className="um-select um-select-large" value={f.duree_max_min}
          onChange={(e) => setF({ ...f, duree_max_min: e.target.value })} />
      </div>
      <label className="se-case">
        <input type="checkbox" checked={f.par_type_appareil} onChange={(e) => setF({ ...f, par_type_appareil: e.target.checked })} />
        <span><b>Ordinateur et téléphone en même temps</b>Une session sur un ordinateur et une sur un téléphone ou une tablette. Décoché : une seule session par compte.</span>
      </label>
      <button type="submit" className="btn-add" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</button>
      {r.mode !== 'appliquer' && <p className="um-note" style={{ gridColumn: '1 / -1' }}>Contrôle des sessions en <b>observation</b> sur ce serveur (SESSIONS_CONTROLE) : rien n'est refusé.</p>}
    </form>
  );
}

export function MesAppareils() {
  const { logout } = useApp();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [enCours, setEnCours] = useState(false);
  useEffect(() => { api.get('/auth/sessions').then((x) => { if (!x?.error) setD(x); }); }, []);
  if (!d) return null;
  const courante = d.sessions.find((s) => s.courante);
  const recentes = d.sessions.filter((s) => !s.courante).slice(0, 4);
  const toutFermer = async () => {
    if (!window.confirm('Déconnecter tous vos appareils, y compris celui-ci ?')) return;
    setEnCours(true);
    const r = await api.post('/auth/deconnexion-globale', {});
    setEnCours(false);
    if (r?.error) { toast(r.error, 'error'); return; }
    try { sessionStorage.setItem('login_message', 'Tous vos appareils ont été déconnectés.'); } catch { /* indisponible */ }
    logout();
  };
  return (
    <div style={{ marginTop: 18 }}>
      <div className="form-section">Session</div>
      {courante && <p className="um-texte" style={{ margin: '0 0 6px' }}>Cet appareil : <b>{courante.appareil}</b>, connecté le {dateHeure(courante.cree_le)}.</p>}
      {recentes.length > 0 && (
        <ul className="se-recentes">
          {recentes.map((s) => <li key={s.id}>{TYPES[s.type_appareil] ? `${TYPES[s.type_appareil]} — ` : ''}{s.appareil} · {dateHeure(s.cree_le)} · {STATUTS[s.statut] || s.statut}</li>)}
        </ul>
      )}
      <button type="button" className="um-btn um-retirer" onClick={toutFermer} disabled={enCours}>Déconnecter tous mes appareils</button>
    </div>
  );
}
