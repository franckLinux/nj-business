// NJ COMMERCIAL — Agences (054) : Société → Agences → Magasins.
// Une agence regroupe des magasins ; elle se désactive (jamais supprimée) et son historique reste.
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { Entete, Statut, Tiroir, Section, Champ, Bascule, useListe, enregistrer } from '@/components/commercial/ui';

const VIDE = { code: '', nom: '', adresse: '', responsable_id: '', actif: true };

function FicheAgence({ agence, onFermer, onEnregistre, modifiable }) {
  const [f, setF] = useState(agence ? { ...VIDE, ...agence, responsable_id: agence.responsable_id || '' } : VIDE);
  const [users, setUsers] = useState([]);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  useEffect(() => {
    api.get('/commercial/utilisateurs').then((r) => { if (!r?.error) setUsers(r.utilisateurs.filter((u) => u.actif)); });
  }, []);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const valider = async () => {
    setEnCours(true);
    const r = await enregistrer('/commercial/agences', agence?.id, { ...f, responsable_id: f.responsable_id || null });
    setEnCours(false);
    if (!r.ok) { setErreur(r.error); return; }
    onEnregistre(agence ? 'Agence modifiée.' : 'Agence créée.');
  };
  return (
    <Tiroir titre={agence ? `Agence ${agence.code}` : 'Nouvelle agence'} sousTitre={agence ? agence.nom : 'Site de l\'entreprise qui regroupe des magasins'} onFermer={onFermer}
      pied={<>
        <button type="button" className="cm-btn cm-secondaire" onClick={onFermer}>Annuler</button>
        {modifiable && <button type="button" className="cm-btn cm-primaire" onClick={valider} disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</button>}
      </>}>
      {erreur && <div className="cm-erreur" role="alert">{erreur}</div>}
      <Section titre="Identification">
        <div className="cm-grille">
          <Champ label="Code" requis id="ac" aide="Ex. DLA, YDE — unique.">
            <input id="ac" value={f.code} onChange={set('code')} maxLength={20} disabled={!modifiable} style={{ textTransform: 'uppercase' }} />
          </Champ>
          <Champ label="Nom" requis id="an"><input id="an" value={f.nom} onChange={set('nom')} maxLength={120} disabled={!modifiable} /></Champ>
          <Champ label="Adresse" id="aa" pleine><input id="aa" value={f.adresse} onChange={set('adresse')} maxLength={300} disabled={!modifiable} /></Champ>
          <Champ label="Responsable de l'agence" id="ar">
            <select id="ar" value={f.responsable_id} onChange={set('responsable_id')} disabled={!modifiable}>
              <option value="">— Aucun —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
              {f.responsable_id && !users.some((u) => u.id === f.responsable_id) && <option value={f.responsable_id}>{agence?.responsable_nom || 'Responsable actuel'}</option>}
            </select>
          </Champ>
          <div className="cm-champ">
            <span className="cm-etiquette">Statut</span>
            <Bascule label="Statut de l'agence" oui="Active" non="Inactive" valeur={f.actif} onChange={(v) => modifiable && setF((x) => ({ ...x, actif: v }))} />
            {agence && f.actif !== agence.actif && !f.actif && <span className="cm-aide">Désactivez d'abord ses magasins actifs.</span>}
          </div>
        </div>
      </Section>
      {agence && (
        <Section titre={`Magasins rattachés (${agence.magasins.length})`}>
          {agence.magasins.length === 0 ? <p className="cm-aide">Aucun magasin. Rattachez-en un depuis Configuration → Magasins.</p> : (
            <div className="cm-puces">{agence.magasins.map((m) => <span key={m.id} className="cm-puce" style={m.actif ? {} : { opacity: 0.55 }}>{m.code} — {m.nom}</span>)}</div>
          )}
        </Section>
      )}
    </Tiroir>
  );
}

export default function AgencesPage() {
  const { can } = useApp();
  const toast = useToast();
  const modifiable = can('com.parametrage.modifier');
  const { donnees, erreur, recharger } = useListe('/commercial/agences');
  const [fiche, setFiche] = useState(null);
  const liste = donnees || [];
  return (
    <div className="cm-page">
      <Entete titre="Agences" description="Société → agences → magasins. Chaque magasin appartient à une seule agence ; les états et le périmètre des utilisateurs se règlent par agence.">
        {modifiable && <button type="button" className="cm-btn cm-primaire" onClick={() => setFiche('nouveau')}>+ Nouvelle agence</button>}
      </Entete>
      {erreur && <div className="cm-erreur">{erreur}</div>}
      <div className="cm-table-wrap">
        <table className="cm-table">
          <thead><tr><th>Code</th><th>Nom</th><th>Adresse</th><th>Responsable</th><th>Magasins</th><th>Statut</th></tr></thead>
          <tbody>
            {!donnees ? <tr><td colSpan={6} className="cm-vide">Chargement…</td></tr>
              : liste.length === 0 ? <tr><td colSpan={6} className="cm-vide"><strong>Aucune agence</strong>L'agence « Siège » est créée d'office avec le premier magasin.</td></tr>
                : liste.map((a) => (
                  <tr key={a.id} className={'cm-cliquable' + (a.actif ? '' : ' cm-inactif')} onClick={() => setFiche(a)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setFiche(a); }}>
                    <td><span className="cm-code">{a.code}</span></td>
                    <td><strong>{a.nom}</strong></td>
                    <td>{a.adresse || '—'}</td>
                    <td>{a.responsable_nom || '—'}</td>
                    <td>{a.magasins.length ? <div className="cm-puces">{a.magasins.slice(0, 4).map((m) => <span key={m.id} className="cm-puce">{m.code}</span>)}{a.magasins.length > 4 && <span className="cm-puce">+{a.magasins.length - 4}</span>}</div> : <span className="cm-sous" style={{ marginTop: 0 }}>Aucun</span>}</td>
                    <td><Statut actif={a.actif} oui="Active" non="Inactive" /></td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      {fiche && <FicheAgence agence={fiche === 'nouveau' ? null : fiche} modifiable={modifiable} onFermer={() => setFiche(null)}
        onEnregistre={(msg) => { setFiche(null); toast(msg, 'success'); recharger(); }} />}
    </div>
  );
}
