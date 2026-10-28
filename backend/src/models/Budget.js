'use strict';

module.exports = (sequelize, DataTypes) => {
  const Budget = sequelize.define('Budget', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    tenant_id: { type: DataTypes.UUID, allowNull: false },
    mois: { type: DataTypes.TEXT, allowNull: false },
    annee: { type: DataTypes.INTEGER, allowNull: false },
    rubrique_code: { type: DataTypes.TEXT, allowNull: false },
    intitule: { type: DataTypes.TEXT, allowNull: false },
    montant: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    mois_applic: DataTypes.TEXT,
    annee_applic: DataTypes.INTEGER,
    semaine: DataTypes.SMALLINT,   // migration 040 : NULL = mensuel, 1..6 = semaine du mois
  }, {
    tableName: 'budget',
    timestamps: false,
  });

  Budget.associate = (models) => {
    Budget.belongsTo(models.Tenant, { foreignKey: 'tenant_id' });
  };

  return Budget;
};
