'use strict';

module.exports = (sequelize, DataTypes) => {
  const DepenseAttente = sequelize.define('DepenseAttente', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    tenant_id: { type: DataTypes.UUID, allowNull: false },
    mois: { type: DataTypes.TEXT, allowNull: false },
    annee: { type: DataTypes.INTEGER, allowNull: false },
    rubrique_code: { type: DataTypes.TEXT, allowNull: false },
    intitule: { type: DataTypes.TEXT, allowNull: false },
    montant: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    tableName: 'depenses_attente',
    timestamps: false,
  });

  DepenseAttente.associate = (models) => {
    DepenseAttente.belongsTo(models.Tenant, { foreignKey: 'tenant_id' });
  };

  return DepenseAttente;
};
