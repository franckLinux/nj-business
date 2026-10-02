'use strict';

module.exports = (sequelize, DataTypes) => {
  const PlanComptableSyscohada = sequelize.define('PlanComptableSyscohada', {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    compte: { type: DataTypes.TEXT, allowNull: false },
    intitule: { type: DataTypes.TEXT, allowNull: false },
    classe: DataTypes.INTEGER,
    nature: DataTypes.TEXT,
    source: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'syscohada', validate: { isIn: [['syscohada', 'custom']] } },
    actif: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_by: DataTypes.UUID,
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    tableName: 'plan_comptable_syscohada',
    timestamps: false,
  });

  PlanComptableSyscohada.associate = (models) => {
    PlanComptableSyscohada.belongsTo(models.User, { foreignKey: 'created_by' });
  };

  return PlanComptableSyscohada;
};
