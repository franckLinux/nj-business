'use strict';

module.exports = (sequelize, DataTypes) => {
  const MouvementAttente = sequelize.define('MouvementAttente', {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    tenant_id: { type: DataTypes.UUID, allowNull: false },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    mois: { type: DataTypes.TEXT, allowNull: false },
    annee: { type: DataTypes.INTEGER, allowNull: false },
    journal_id: DataTypes.INTEGER,
    type_caisse: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'especes' },
    rubrique_code: { type: DataTypes.TEXT, allowNull: false },
    intitule: { type: DataTypes.TEXT, allowNull: false },
    objet: DataTypes.TEXT,
    beneficiaire: DataTypes.TEXT,
    piece_identite: DataTypes.TEXT,
    telephone: DataTypes.TEXT,
    sortie: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0 },
    motif_attente: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: { isIn: [['mois_non_valide', 'rubrique_non_approuvee', 'depassement_journal', 'depassement_rubrique']] },
    },
    montant_prevu: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    cumul_sorties: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    statut: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: 'en_attente',
      validate: { isIn: [['en_attente', 'approuve', 'rejete']] },
    },
    commentaire_dir: DataTypes.TEXT,
    client_uuid: DataTypes.TEXT,
    created_by: DataTypes.UUID,
    decided_by: DataTypes.UUID,
    decided_at: DataTypes.DATE,
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    tableName: 'mouvements_attente',
    timestamps: false,
  });

  MouvementAttente.associate = (models) => {
    MouvementAttente.belongsTo(models.Tenant, { foreignKey: 'tenant_id' });
    MouvementAttente.belongsTo(models.Journal, { foreignKey: 'journal_id' });
    MouvementAttente.belongsTo(models.User, { foreignKey: 'created_by', as: 'auteur' });
    MouvementAttente.belongsTo(models.User, { foreignKey: 'decided_by', as: 'decideur' });
  };

  return MouvementAttente;
};
