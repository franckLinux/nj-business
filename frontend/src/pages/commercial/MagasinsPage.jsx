// NJ COMMERCIAL — Magasins (lieux de stockage). Désactiver ne supprime aucun historique.
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { Entete, Statut, Tiroir, Section, Champ, Bascule, useListe, useDiffere, enregistrer } from '@/components/commercial/ui';

const VIDE = { code: '', nom: '', description: '', localisation: '', responsable_id: '', agence_id: '', actif: true };

function FicheMagasin({ magasin, onFermer, onEnregistre, modifiable }) {
  const [f, setF] = useState(magasin ? { ...VIDE, ...magasin, responsable_id: magasin.responsable_id || '', agence_id: String(magasin.agence_id || '') } : VIDE);
  const [users, setUsers] = useState([]);
  const [agences, setAgences] = useState(null);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  useEffect(() => {
    api.get('/commercial/utilisateurs').then((r) => { if (!r?.error) setUsers(r.utilisateurs.filter((u) => u.actif)); });
    api.get('/commercial/agences').then((r) => {
      const l = r?.error ? [] : r;
      setAgences(l);
      if (!magasin && l.filter((a) => a.actif).length === 1) setF((x) => ({ ...x, agence_id: String(l.find((a) => a.actif).id) }));
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const valider = async () => {
    setEnCours(true);
    const r = await enregistrer('/commercial/magasins', magasin?.id, { ...f, responsable_id: f.responsable_id || null, agence_id: f.agence_id || null });
    setEnCours(false);
    if (!r.ok) { setErreur(r.error); return; }
    onEnregistre(magasin ? 'Magasin modifié.' : 'Magasin créé.');
  };
  return (
    <Tiroir titre={magasin ? `Magasin ${magasin.code}` : 'Nouveau magasin'} sousTitre={magasin ? magasin.nom : 'Lieu de stockage de l\'entreprise'} onFermer={onFermer}
      pied={<>
        <button type="button" className="cm-btn cm-secondaire" onClick={onFermer}>Annuler</button>
        {modifiable && <button type="button" className="cm-btn cm-primaire" onClick={valider} disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</button>}
      </>}>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      <Section titre="Identification">
        <div className="cm-grille">
          <Champ label="Code" requis id="mc" aide="Ex. MAG01 — unique.">
            <input id="mc" value={f.code} onChange={set('code')} maxLength={20} disabled={!modifiable} style={{ textTransform: 'uppercase' }} />
          </Champ>
          <Champ label="Nom" requis id="mn"><input id="mn" value={f.nom} onChange={set('nom')} maxLength={120} disabled={!modifiable} /></Champ>
          <Champ label="Agence de rattachement" requis id="mag" pleine
            aide={agences && agences.length === 0 ? 'Aucune agence : l\'agence « Siège » sera créée avec ce magasin.' : 'Un magasin appartient à une seule agence. Il n\'en change plus dès qu\'il a servi.'}>
            <select id="mag" value={f.agence_id} onChange={set('agence_id')} disabled={!modifiable || !agences || agences.length === 0}>
              {agences && agences.length > 0 && <option value="">— Choisir —</option>}
              {(agences || []).filter((a) => a.actif || String(a.id) === f.agence_id).map((a) => <option key={a.id} value={a.id}>{a.code} — {a.nom}</option>)}
            </select>
          </Champ>
          <Champ label="Adresse ou localisation" id="ml" pleine><input id="ml" value={f.localisation} onChange={set('localisation')} maxLength={300} disabled={!modifiable} /></Champ>
          <Champ label="Description" id="md" pleine><textarea id="md" value={f.description} onChange={set('description')} maxLength={1000} disabled={!modifiable} /></Champ>
        </div>
      </Section>
      <Section titre="Responsabilité et statut">
        <div className="cm-grille">
          <Champ label="Responsable du magasin" id="mr">
            <select id="mr" value={f.responsable_id} onChange={set('responsable_id')} disabled={!modifiable}>
              <option value="">— Aucun —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
              {f.responsable_id && !users.some((u) => u.id === f.responsable_id) && <option value={f.responsable_id}>{magasin?.responsable_nom || 'Responsable actuel'}</option>}
            </select>
          </Champ>
          <div className="cm-champ">
            <span className="cm-etiquette">Statut</span>
            <Bascule label="Statut du magasin" oui="Actif" non="Inactif" valeur={f.actif} onChange={(v) => modifiable && setF((x) => ({ ...x, actif: v }))} />
            {magasin && !f.actif && magasin.actif && <span className="cm-aide">Le stock et l'historique du magasin restent consultables.</span>}
          </div>
        </div>
      </Section>
    </Tiroir>
  );
}

export default function MagasinsPage() {
  const { can } = useApp();
  const toast = useToast();
  const modifiable = can('com.parametrage.modifier');
  const [q, setQ] = useState('');
  const [statut, setStatut] = useState('');
  const qd = useDiffere(q);
  const { donnees, erreur, recharger } = useListe(`/commercial/magasins?q=${encodeURIComponent(qd)}&actifs=${statut === 'actifs' ? '1' : ''}`);
  const [fiche, setFiche] = useState(null);
  const liste = (donnees || []).filter((m) => statut !== 'inactifs' || !m.actif);

  return (
    <div className="cm-page">
      <Entete titre="Magasins" description="Les lieux de stockage, chacun rattaché à une agence. Le stock de chaque article est suivi magasin par magasin.">
        {modifiable && <button type="button" className="cm-btn cm-primaire" onClick={() => setFiche('nouveau')}>+ Nouveau magasin</button>}
      </Entete>
      <div className="cm-outils">
        <input className="cm-recherche" type="search" placeholder="Rechercher un code, un nom, un lieu…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher un magasin" />
        <select className="cm-select" value={statut} onChange={(e) => setStatut(e.target.value)} aria-label="Statut">
          <option value="">Tous les statuts</option><option value="actifs">Actifs</option><option value="inactifs">Inactifs</option>
        </select>
        <span className="cm-compteur">{donnees ? `${liste.length} magasin${liste.length > 1 ? 's' : ''}` : ''}</span>
      </div>
      {erreur && <div className="cm-erreur">{erreur}</div>}
      <div className="cm-table-wrap">
        <table className="cm-table">
          <thead><tr><th>Code</th><th>Nom</th><th>Agence</th><th>Localisation</th><th>Responsable</th><th className="cm-num">Articles en stock</th><th>Statut</th></tr></thead>
          <tbody>
            {!donnees ? <tr><td colSpan={7} className="cm-vide">Chargement…</td></tr>
              : liste.length === 0 ? <tr><td colSpan={7} className="cm-vide"><strong>Aucun magasin</strong>{modifiable ? 'Créez le premier lieu de stockage.' : ''}</td></tr>
                : liste.map((m) => (
                  <tr key={m.id} className={'cm-cliquable' + (m.actif ? '' : ' cm-inactif')} onClick={() => setFiche(m)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setFiche(m); }}>
                    <td><span className="cm-code">{m.code}</span></td>
                    <td><strong>{m.nom}</strong>{m.description && <span className="cm-sous">{m.description.slice(0, 80)}</span>}</td>
                    <td>{m.agence_code}<span className="cm-sous">{m.agence_nom}</span></td>
                    <td>{m.localisation || '—'}</td>
                    <td>{m.responsable_nom || '—'}</td>
                    <td className="cm-num">{m.nb_articles_stock}</td>
                    <td><Statut actif={m.actif} /></td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      {fiche && <FicheMagasin magasin={fiche === 'nouveau' ? null : fiche} modifiable={modifiable} onFermer={() => setFiche(null)}
        onEnregistre={(msg) => { setFiche(null); toast(msg, 'success'); recharger(); }} />}
    </div>
  );
}
