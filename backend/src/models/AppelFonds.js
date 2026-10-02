'use strict';

module.exports = (sequelize, DataTypes) => {
  const AppelFonds = sequelize.define('AppelFonds', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    tenant_id: { type: DataTypes.UUID, allowNull: false },
    journal_id: DataTypes.INTEGER,
    mois_cible: { type: DataTypes.TEXT, allowNull: false },
    annee_cible: { type: DataTypes.INTEGER, allowNull: false },
    rubrique_code: { type: DataTypes.TEXT, allowNull: false },
    intitule: { type: DataTypes.TEXT, allowNull: false },
    montant_prevu: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    montant_approuve: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    statut: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: 'en_attente',
      validate: { isIn: [['en_attente', 'approuve', 'rejete', 'partiellement_approuve']] },
    },
    justification: DataTypes.TEXT,
    commentaire_approbation: DataTypes.TEXT,
    created_by: DataTypes.UUID,
    approved_by: DataTypes.UUID,
    approved_at: DataTypes.DATE,
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    tableName: 'appel_fonds',
    timestamps: false,
  });

  AppelFonds.associate = (models) => {
    AppelFonds.belongsTo(models.Tenant, { foreignKey: 'tenant_id' });
    AppelFonds.belongsTo(models.Journal, { foreignKey: 'journal_id' });
    AppelFonds.belongsTo(models.User, { foreignKey: 'created_by', as: 'auteur' });
    AppelFonds.belongsTo(models.User, { foreignKey: 'approved_by', as: 'approbateur' });
  };

  return AppelFonds;
};
