import { useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';

// Reprend loadTabEntite()/saveConfig()/changePassword() de legacy/js/app.js (l. 5166-5322).
const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: .4, color: 'var(--text-muted)', marginBottom: 5 };
const inputStyle = { width: '100%', padding: '9px 12px', border: '1.5px solid var(--border)', borderRadius: 7, fontSize: 13 };
const roStyle = { ...inputStyle, background: '#f8fafc', cursor: 'not-allowed' };
const cardStyle = { background: 'white', border: '1px solid var(--border)', borderRadius: 12, padding: 24, marginBottom: 16 };
const cardTitleStyle = { fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 16 };

export default function EntiteTab() {
  const { can, setDevise } = useApp();
  const toast = useToast();
  const canEdit = can('config.edit');
  // Props communs à injecter sur chaque champ éditable de ce formulaire.
  const field = { style: canEdit ? inputStyle : roStyle, ...(canEdit ? {} : { readOnly: true, disabled: true }) };

  const [formes, setFormes] = useState([]);
  const [erreur, setErreur] = useState('');
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const [pwd, setPwd] = useState({ ancien: '', nouveau: '', confirm: '' });
  const [pwdErr, setPwdErr] = useState('');
  const [pwdSaving, setPwdSaving] = useState(false);

  useEffect(() => {
    let annule = false;
    Promise.all([
      api.get('/config'),
      api.get('/config/referentiel').catch(() => ({ formes_juridiques: [] })),
    ]).then(([d, ref]) => {
      if (annule) return;
      if (d.error) { setErreur(d.error); return; }
      setForm({
        nom: d.nom || '', sigle: d.sigle || '', forme_juridique: d.forme_juridique || '',
        activite: d.activite || '', dirigeant_nom: d.dirigeant_nom || '',
        adresse: d.adresse || '', boite_postale: d.boite_postale || '',
        registre_commerce: d.registre_commerce || '', nui: d.nui || '', devise: d.devise || 'FCFA',
      });
      setFormes(ref.formes_juridiques || []);
    });
    return () => { annule = true; };
  }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const onSave = async () => {
    if (!form.nom.trim()) { toast("Le nom de l'entité est obligatoire.", 'error'); return; }
    setSaving(true);
    const res = await api.put('/config', form);
    setSaving(false);
    if (res.error) { toast(res.error, 'error'); return; }
    setDevise(res.config?.devise || 'FCFA');
    toast('Configuration enregistrée ✓', 'success');
  };

  const onChangePassword = async () => {
    if (!pwd.ancien || !pwd.nouveau || pwd.nouveau.length < 6) { setPwdErr('Minimum 6 caractères.'); return; }
    if (pwd.nouveau !== pwd.confirm) { setPwdErr('Mots de passe différents.'); return; }
    setPwdSaving(true);
    const res = await api.post('/auth/change-password', { ancienPassword: pwd.ancien, nouveauPassword: pwd.nouveau });
    setPwdSaving(false);
    if (res.error) { setPwdErr(res.error); return; }
    setPwdErr('');
    setPwd({ ancien: '', nouveau: '', confirm: '' });
    toast('Mot de passe modifié ✓', 'success');
  };

  if (erreur) return <div className="alert-err">{erreur}</div>;
  if (!form) return <div className="loading-msg">Chargement…</div>;

  return (
    <div style={{ maxWidth: 760 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 20 }}>Informations de l'entité</h3>

      <div style={cardStyle}>
        <h4 style={cardTitleStyle}>📛 Identité</h4>
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Nom de l'entité *</label>
          <input type="text" value={form.nom} onChange={set('nom')} {...field} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>Sigle</label>
            <input type="text" maxLength={20} value={form.sigle} onChange={set('sigle')} {...field} />
          </div>
          <div>
            <label style={labelStyle}>Forme juridique</label>
            <select value={form.forme_juridique} onChange={set('forme_juridique')} {...field}>
              <option value="">— Sélectionner —</option>
              {formes.map((f) => <option key={f.code} value={f.code}>{f.label}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Activité principale</label>
          <input type="text" placeholder="Ex : Commerce général de produits divers" value={form.activite} onChange={set('activite')} {...field} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Nom du dirigeant</label>
          <input type="text" value={form.dirigeant_nom} onChange={set('dirigeant_nom')} {...field} />
        </div>
      </div>

      <div style={cardStyle}>
        <h4 style={cardTitleStyle}>📍 Coordonnées</h4>
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Adresse</label>
          <input type="text" placeholder="Ex : Avenue Kennedy, Yaoundé" value={form.adresse} onChange={set('adresse')} {...field} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Boîte postale</label>
          <input type="text" placeholder="Ex : BP 1234" value={form.boite_postale} onChange={set('boite_postale')} {...field} />
        </div>
      </div>

      <div style={cardStyle}>
        <h4 style={cardTitleStyle}>🏛️ Identifiants légaux</h4>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>Registre de commerce (RCCM)</label>
            <input type="text" placeholder="Ex : RC/YDE/2024/B/123" value={form.registre_commerce} onChange={set('registre_commerce')} {...field} />
          </div>
          <div>
            <label style={labelStyle}>NUI (Numéro Identifiant Unique)</label>
            <input type="text" maxLength={20} placeholder="Ex : M050000123456P" value={form.nui} onChange={set('nui')} {...field} />
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <h4 style={cardTitleStyle}>💰 Paramètres</h4>
        <label style={labelStyle}>Devise</label>
        <select value={form.devise} onChange={set('devise')} {...field}>
          <option value="FCFA">FCFA (XAF)</option>
          <option value="EUR">Euro (€)</option>
          <option value="USD">Dollar ($)</option>
        </select>
        {canEdit && (
          <div style={{ marginTop: 18 }}>
            <button className="btn-add" onClick={onSave} disabled={saving}>💾 Enregistrer la configuration</button>
          </div>
        )}
      </div>

      <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 12, padding: 24 }}>
        <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>🔑 Changer mon mot de passe</h4>
        <label style={labelStyle}>Ancien mot de passe</label>
        <input type="password" value={pwd.ancien} onChange={(e) => setPwd((p) => ({ ...p, ancien: e.target.value }))} style={{ ...inputStyle, marginBottom: 10 }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>Nouveau</label>
            <input type="password" value={pwd.nouveau} onChange={(e) => setPwd((p) => ({ ...p, nouveau: e.target.value }))} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Confirmer</label>
            <input type="password" value={pwd.confirm} onChange={(e) => setPwd((p) => ({ ...p, confirm: e.target.value }))} style={inputStyle} />
          </div>
        </div>
        {pwdErr && <div className="alert-err" style={{ marginBottom: 10 }}>{pwdErr}</div>}
        <button className="btn-add" style={{ background: 'var(--accent-purple)' }} onClick={onChangePassword} disabled={pwdSaving}>🔑 Modifier</button>
      </div>
    </div>
  );
}
