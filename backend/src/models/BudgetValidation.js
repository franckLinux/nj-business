'use strict';

module.exports = (sequelize, DataTypes) => {
  const BudgetValidation = sequelize.define('BudgetValidation', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    tenant_id: { type: DataTypes.UUID, allowNull: false },
    mois: { type: DataTypes.TEXT, allowNull: false },
    annee: { type: DataTypes.INTEGER, allowNull: false },
    semaine: DataTypes.SMALLINT,   // migration 040 : NULL = mensuel, 1..6 = semaine du mois
    statut: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: 'en_attente',
      validate: { isIn: [['en_attente', 'valide', 'rejete']] },
    },
    commentaire: DataTypes.TEXT,
    validated_by: DataTypes.UUID,
    validated_at: DataTypes.DATE,
  }, {
    tableName: 'budget_validation',
    timestamps: false,
  });

  BudgetValidation.associate = (models) => {
    BudgetValidation.belongsTo(models.Tenant, { foreignKey: 'tenant_id' });
    BudgetValidation.belongsTo(models.User, { foreignKey: 'validated_by', as: 'validateur' });
  };

  return BudgetValidation;
};
