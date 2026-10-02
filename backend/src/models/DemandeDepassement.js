'use strict';

module.exports = (sequelize, DataTypes) => {
  const DemandeDepassement = sequelize.define('DemandeDepassement', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    tenant_id: { type: DataTypes.UUID, allowNull: false },
    journal_id: { type: DataTypes.INTEGER, allowNull: false },
    mois: { type: DataTypes.TEXT, allowNull: false },
    annee: { type: DataTypes.INTEGER, allowNull: false },
    date_mvt: { type: DataTypes.DATEONLY, allowNull: false },
    rubrique_code: { type: DataTypes.TEXT, allowNull: false },
    intitule: { type: DataTypes.TEXT, allowNull: false },
    objet: DataTypes.TEXT,
    beneficiaire: DataTypes.TEXT,
    piece_identite: DataTypes.TEXT,
    telephone: DataTypes.TEXT,
    sortie: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0 },
    budget_montant: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0 },
    sorties_actuelles: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0 },
    depassement: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0 },
    statut: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'en_attente' },
    type_depassement: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'journal' },
    demande_par: DataTypes.UUID,
    demandeur_nom: DataTypes.TEXT,
    valide_par: DataTypes.UUID,
    valide_le: DataTypes.DATE,
    commentaire_dir: DataTypes.TEXT,
    created_at: DataTypes.DATE,
  }, {
    tableName: 'demandes_depassement',
    timestamps: false,
  });

  DemandeDepassement.associate = (models) => {
    DemandeDepassement.belongsTo(models.Tenant, { foreignKey: 'tenant_id' });
    DemandeDepassement.belongsTo(models.Journal, { foreignKey: 'journal_id' });
    DemandeDepassement.belongsTo(models.User, { foreignKey: 'demande_par', as: 'demandeur' });
    DemandeDepassement.belongsTo(models.User, { foreignKey: 'valide_par', as: 'validateur' });
  };

  return DemandeDepassement;
};
