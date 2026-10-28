'use strict';

module.exports = (sequelize, DataTypes) => {
  const BudgetCaisse = sequelize.define('BudgetCaisse', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    tenant_id: { type: DataTypes.UUID, allowNull: false },
    journal_id: { type: DataTypes.INTEGER, allowNull: false },
    mois: { type: DataTypes.TEXT, allowNull: false },
    annee: { type: DataTypes.INTEGER, allowNull: false },
    semaine: DataTypes.SMALLINT,   // migration 040 : NULL = mensuel, 1..6 = semaine du mois
    montant: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0 },
    set_par: DataTypes.UUID,
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  }, {
    tableName: 'budget_caisse',
    timestamps: false,
  });

  BudgetCaisse.associate = (models) => {
    BudgetCaisse.belongsTo(models.Tenant, { foreignKey: 'tenant_id' });
    BudgetCaisse.belongsTo(models.Journal, { foreignKey: 'journal_id' });
    BudgetCaisse.belongsTo(models.User, { foreignKey: 'set_par' });
  };

  return BudgetCaisse;
};
