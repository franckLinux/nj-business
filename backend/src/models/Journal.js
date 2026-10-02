'use strict';

module.exports = (sequelize, DataTypes) => {
  const Journal = sequelize.define('Journal', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    tenant_id: { type: DataTypes.UUID, allowNull: false },
    code: { type: DataTypes.TEXT, allowNull: false },
    nom: { type: DataTypes.TEXT, allowNull: false },
    type: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: { isIn: [['caisse', 'banque', 'om', 'momo', 'carte_prepayee', 'autre']] },
    },
    devise: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'FCFA' },
    responsable_saisie: DataTypes.UUID,
    responsable_arret: DataTypes.UUID,
    ordre: DataTypes.INTEGER,
    actif: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    tableName: 'journaux',
    timestamps: false,
  });

  Journal.associate = (models) => {
    Journal.belongsTo(models.Tenant, { foreignKey: 'tenant_id' });
    Journal.belongsTo(models.User, { foreignKey: 'responsable_saisie', as: 'responsableSaisie' });
    Journal.belongsTo(models.User, { foreignKey: 'responsable_arret', as: 'responsableArret' });
    Journal.hasMany(models.Mouvement, { foreignKey: 'journal_id' });
    Journal.hasMany(models.Ran, { foreignKey: 'journal_id' });
    Journal.hasMany(models.AppelFonds, { foreignKey: 'journal_id' });
    Journal.hasMany(models.ArretCaisse, { foreignKey: 'journal_id' });
    Journal.hasMany(models.BudgetCaisse, { foreignKey: 'journal_id' });
    Journal.hasMany(models.DemandeDepassement, { foreignKey: 'journal_id' });
    Journal.hasMany(models.MouvementAttente, { foreignKey: 'journal_id' });
  };

  return Journal;
};
