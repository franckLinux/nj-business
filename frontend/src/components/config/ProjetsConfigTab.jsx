// Configuration → Activités / projets (ONG et associations) — 083.
// Décision de Franck : le projet, son chef de projet, ses activités et leurs
// responsables se déclarent ici, une fois pour toutes. Les demandes de fonds de
// la rubrique « Gestion des activités » s'appuient sur ces désignations.
// API existantes : /projets, /projets/:id, /projets/:id/activites, /projets/utilisateurs.
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { Tiroir, Champ } from '@/components/commercial/ui';
import { Erreur, fmtDate } from '@/pages/comptabilite/commun';

const vide = { nom: '', code: '', date_debut: '', date_fin: '', chef_projet_id: '', description: '' };

export default function ProjetsConfigTab() {
  const toast = useToast();
  const [liste, setListe] = useState(null);
  const [details, setDetails] = useState({});     // id → activités
  const [users, setUsers] = useState([]);
  const [erreur, setErreur] = useState('');
  const [form, setForm] = useState(null);        // { type: 'projet' | 'activite', projet?, valeurs, id? }
  const [enCours, setEnCours] = useState(false);

  const charger = useCallback(async () => {
    const r = await api.get('/projets');
    if (r?.error) { setErreur(r.error); return; }
    setListe(r);
    const det = {};
    await Promise.all(r.projets.map(async (p) => {
      const x = await api.get(`/projets/${p.id}`);
      det[p.id] = x?.error ? [] : (x.activites || []);
    }));
    setDetails(det);
  }, []);
  useEffect(() => {
    charger();
    api.get('/projets/utilisateurs').then((u) => !u?.error && setUsers(u));
  }, [charger]);

  if (erreur) return <Erreur message={erreur} />;
  if (!liste) return <div className="loading-msg">Chargement…</div>;
  const gerer = liste.droits?.gerer;
  const set = (k) => (e) => setForm((f) => ({ ...f, valeurs: { ...f.valeurs, [k]: e.target.value } }));
  const enregistrer = async () => {
    setEnCours(true);
    const v = form.valeurs;
    const r = form.type === 'projet'
      ? (form.id ? await api.put(`/projets/${form.id}`, v) : await api.post('/projets', v))
      : (form.id ? await api.put(`/projets/${form.projet.id}/activites/${form.id}`, v) : await api.post(`/projets/${form.projet.id}/activites`, v));
    setEnCours(false);
    if (r?.error) { toast(r.error, 'error'); return; }
    toast(form.type === 'projet' ? 'Projet enregistré.' : 'Activité enregistrée.', 'success');
    setForm(null); charger();
  };
  const basculer = async (p, a) => {
    const r = a ? await api.put(`/projets/${p.id}/activites/${a.id}`, { actif: !a.actif }) : await api.put(`/projets/${p.id}`, { actif: !p.actif });
    if (r?.error) { toast(r.error, 'error'); return; }
    charger();
  };
  const choixUsers = (valeur, onChange, id, libelle) => (
    <select id={id} value={valeur || ''} onChange={onChange}>
      <option value="">— {libelle} —</option>
      {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
    </select>
  );

  return (
    <div>
      <div className="cm-entete">
        <div>
          <h3>Projets et activités</h3>
          <p className="cm-sous">Déclarez chaque projet avec son <b>chef de projet</b>, puis ses activités avec leur <b>responsable</b>.
            Le responsable fait les demandes de fonds de son activité ; le chef de projet les valide avant le directeur.</p>
        </div>
        {gerer && <button type="button" className="cm-btn cm-primaire" onClick={() => setForm({ type: 'projet', valeurs: { ...vide } })}>+ Nouveau projet</button>}
      </div>
      {liste.projets.length === 0 && <div className="fin-vide"><h3>Aucun projet</h3><p>{gerer ? 'Créez le premier projet.' : 'Aucun projet déclaré.'}</p></div>}
      {liste.projets.map((p) => (
        <section key={p.id} className={`fin-carte${p.actif ? '' : ' fin-inactif'}`}>
          <div className="fin-fiche-tete">
            <div>
              <h4 style={{ margin: 0 }}>{p.nom}{p.code ? <span className="cm-sous"> · {p.code}</span> : null}{!p.actif && <span className="fin-pastille fin-pastille-gris" style={{ marginLeft: 8 }}>Désactivé</span>}</h4>
              <p className="cm-sous">Chef de projet : <b>{p.chef_nom || 'non désigné'}</b>
                {p.date_debut ? ` · du ${fmtDate(p.date_debut)}${p.date_fin ? ` au ${fmtDate(p.date_fin)}` : ''}` : ''}</p>
            </div>
            {gerer && (
              <div className="fin-actions">
                <button type="button" className="cm-btn cm-secondaire cm-petit" onClick={() => setForm({ type: 'projet', id: p.id, valeurs: {
                  nom: p.nom, code: p.code || '', date_debut: p.date_debut?.slice(0, 10) || '', date_fin: p.date_fin?.slice(0, 10) || '',
                  chef_projet_id: p.chef_projet_id || '', description: p.description || '' } })}>Modifier</button>
                <button type="button" className="cm-btn cm-secondaire cm-petit" onClick={() => basculer(p)}>{p.actif ? 'Désactiver' : 'Réactiver'}</button>
                <button type="button" className="cm-btn cm-primaire cm-petit" onClick={() => setForm({ type: 'activite', projet: p, valeurs: { nom: '', code: '', responsable_id: '', description: '' } })}>+ Activité</button>
              </div>
            )}
          </div>
          <table className="cm-table fin-table">
            <thead><tr><th>Activité</th><th>Responsable d'activité</th><th>État</th>{gerer && <th aria-label="Actions" />}</tr></thead>
            <tbody>
              {(details[p.id] || []).length === 0 && <tr><td colSpan={gerer ? 4 : 3} className="cm-sous">Aucune activité.</td></tr>}
              {(details[p.id] || []).map((a) => (
                <tr key={a.id} className={a.actif ? undefined : 'fin-annule'}>
                  <td><b>{a.nom}</b>{a.code ? <span className="cm-sous"> · {a.code}</span> : null}</td>
                  <td>{a.responsable_nom || <span className="cm-sous">non désigné</span>}</td>
                  <td>{a.actif ? 'Active' : 'Désactivée'}</td>
                  {gerer && (
                    <td className="fin-actions-ligne">
                      <button type="button" className="cm-btn cm-secondaire cm-petit" onClick={() => setForm({ type: 'activite', projet: p, id: a.id,
                        valeurs: { nom: a.nom, code: a.code || '', responsable_id: a.responsable_id || '' } })}>Modifier</button>
                      <button type="button" className="cm-btn cm-secondaire cm-petit" onClick={() => basculer(p, a)}>{a.actif ? 'Désactiver' : 'Réactiver'}</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {form && (
        <Tiroir titre={form.type === 'projet' ? (form.id ? 'Modifier le projet' : 'Nouveau projet') : (form.id ? 'Modifier l\'activité' : `Nouvelle activité — ${form.projet.nom}`)}
          onFermer={() => setForm(null)} pied={<>
            <button type="button" className="cm-btn cm-secondaire" onClick={() => setForm(null)}>Annuler</button>
            <button type="button" className="cm-btn cm-primaire" disabled={enCours || !form.valeurs.nom.trim()} onClick={enregistrer}>Enregistrer</button>
          </>}>
          <div className="cm-grille">
            <Champ label="Nom" requis pleine id="pc-nom"><input id="pc-nom" value={form.valeurs.nom} maxLength={120} onChange={set('nom')} /></Champ>
            <Champ label="Code" id="pc-code"><input id="pc-code" value={form.valeurs.code} maxLength={20} onChange={set('code')} /></Champ>
            {form.type === 'projet' ? (<>
              <Champ label="Chef de projet" id="pc-chef" aide="Valide les demandes de fonds avant le directeur">
                {choixUsers(form.valeurs.chef_projet_id, set('chef_projet_id'), 'pc-chef', 'Choisir')}</Champ>
              <Champ label="Début" id="pc-dd"><input id="pc-dd" type="date" value={form.valeurs.date_debut} onChange={set('date_debut')} /></Champ>
              <Champ label="Fin" id="pc-df"><input id="pc-df" type="date" value={form.valeurs.date_fin} onChange={set('date_fin')} /></Champ>
              <Champ label="Description" pleine id="pc-desc"><textarea id="pc-desc" rows={3} maxLength={500} value={form.valeurs.description} onChange={set('description')} /></Champ>
            </>) : (
              <Champ label="Responsable d'activité" id="pc-resp" aide="Fait les demandes de fonds et déclare les dépenses">
                {choixUsers(form.valeurs.responsable_id, set('responsable_id'), 'pc-resp', 'Choisir')}</Champ>
            )}
          </div>
        </Tiroir>
      )}
    </div>
  );
}
