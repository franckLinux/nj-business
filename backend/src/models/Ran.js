'use strict';

module.exports = (sequelize, DataTypes) => {
  const Ran = sequelize.define('Ran', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    tenant_id: { type: DataTypes.UUID, allowNull: false },
    mois: { type: DataTypes.TEXT, allowNull: false },
    annee: { type: DataTypes.INTEGER, allowNull: false },
    journal_id: DataTypes.INTEGER,
    type_caisse: { type: DataTypes.TEXT, allowNull: false, validate: { isIn: [['especes', 'om']] } },
    montant: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
  }, {
    tableName: 'ran',
    timestamps: false,
  });

  Ran.associate = (models) => {
    Ran.belongsTo(models.Tenant, { foreignKey: 'tenant_id' });
    Ran.belongsTo(models.Journal, { foreignKey: 'journal_id' });
  };

  return Ran;
};
