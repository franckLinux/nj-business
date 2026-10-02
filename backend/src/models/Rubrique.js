'use strict';

module.exports = (sequelize, DataTypes) => {
  const Rubrique = sequelize.define('Rubrique', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    tenant_id: { type: DataTypes.UUID, allowNull: false },
    code: { type: DataTypes.TEXT, allowNull: false },
    intitule: { type: DataTypes.TEXT, allowNull: false },
    type: { type: DataTypes.TEXT, allowNull: false, validate: { isIn: [['entree', 'depense']] } },
    est_virement_interne: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    code_comptable: DataTypes.TEXT,
    actif: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    ordre: DataTypes.INTEGER,
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    tableName: 'rubriques',
    timestamps: false,
  });

  Rubrique.associate = (models) => {
    Rubrique.belongsTo(models.Tenant, { foreignKey: 'tenant_id' });
  };

  return Rubrique;
};
