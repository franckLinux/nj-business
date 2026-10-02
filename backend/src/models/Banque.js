'use strict';

module.exports = (sequelize, DataTypes) => {
  const Banque = sequelize.define('Banque', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    tenant_id: { type: DataTypes.UUID, allowNull: false },
    mois: { type: DataTypes.TEXT, allowNull: false },
    annee: { type: DataTypes.INTEGER, allowNull: false },
    solde_initial: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    fonds_recus: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    solde_final: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
  }, {
    tableName: 'banque',
    timestamps: false,
  });

  Banque.associate = (models) => {
    Banque.belongsTo(models.Tenant, { foreignKey: 'tenant_id' });
  };

  return Banque;
};
