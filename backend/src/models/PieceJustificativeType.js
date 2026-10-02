'use strict';

module.exports = (sequelize, DataTypes) => {
  const PieceJustificativeType = sequelize.define('PieceJustificativeType', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    tenant_id: { type: DataTypes.UUID, allowNull: false },
    rubrique_code: { type: DataTypes.TEXT, allowNull: false },
    intitule_piece: { type: DataTypes.TEXT, allowNull: false },
    description: DataTypes.TEXT,
    obligatoire: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    ordre: DataTypes.INTEGER,
    actif: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    tableName: 'pieces_justificatives_types',
    timestamps: false,
  });

  PieceJustificativeType.associate = (models) => {
    PieceJustificativeType.belongsTo(models.Tenant, { foreignKey: 'tenant_id' });
  };

  return PieceJustificativeType;
};
