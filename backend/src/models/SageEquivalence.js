'use strict';

module.exports = (sequelize, DataTypes) => {
  const SageEquivalence = sequelize.define('SageEquivalence', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    tenant_id: { type: DataTypes.UUID, allowNull: false },
    rubrique_code: { type: DataTypes.TEXT, allowNull: false },
    sens: { type: DataTypes.TEXT, allowNull: false, validate: { isIn: [['entree', 'sortie']] } },
    journal_sage: { type: DataTypes.TEXT, allowNull: false },
    compte_debit: { type: DataTypes.TEXT, allowNull: false },
    compte_credit: { type: DataTypes.TEXT, allowNull: false },
    libelle_compta: { type: DataTypes.TEXT, allowNull: false },
    taux_tva: { type: DataTypes.DECIMAL(5, 2), defaultValue: 0 },
    compte_tva: DataTypes.TEXT,
    actif: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    created_by: DataTypes.UUID,
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    tableName: 'sage_equivalences',
    timestamps: false,
  });

  SageEquivalence.associate = (models) => {
    SageEquivalence.belongsTo(models.Tenant, { foreignKey: 'tenant_id' });
    SageEquivalence.belongsTo(models.User, { foreignKey: 'created_by' });
  };

  return SageEquivalence;
};
