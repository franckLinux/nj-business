'use strict';

module.exports = (sequelize, DataTypes) => {
  const ArretCaisse = sequelize.define('ArretCaisse', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    tenant_id: { type: DataTypes.UUID, allowNull: false },
    journal_id: { type: DataTypes.INTEGER, allowNull: false },
    mois: { type: DataTypes.TEXT, allowNull: false },
    annee: { type: DataTypes.INTEGER, allowNull: false },
    solde_final: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    arrete_le: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    arrete_par: DataTypes.UUID,
    commentaire: DataTypes.TEXT,
  }, {
    tableName: 'arrets_caisse',
    timestamps: false,
  });

  ArretCaisse.associate = (models) => {
    ArretCaisse.belongsTo(models.Tenant, { foreignKey: 'tenant_id' });
    ArretCaisse.belongsTo(models.Journal, { foreignKey: 'journal_id' });
    ArretCaisse.belongsTo(models.User, { foreignKey: 'arrete_par' });
  };

  return ArretCaisse;
};
