'use strict';

module.exports = (sequelize, DataTypes) => {
  const ExportSage = sequelize.define('ExportSage', {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    tenant_id: { type: DataTypes.UUID, allowNull: false },
    periode_debut: { type: DataTypes.DATEONLY, allowNull: false },
    periode_fin: { type: DataTypes.DATEONLY, allowNull: false },
    type_caisse: DataTypes.TEXT,
    journal_sage: DataTypes.TEXT,
    nb_ecritures: { type: DataTypes.INTEGER, defaultValue: 0 },
    checksum: DataTypes.TEXT,
    fichier_ecr: DataTypes.TEXT,
    created_by: DataTypes.UUID,
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    tableName: 'exports_sage',
    timestamps: false,
  });

  ExportSage.associate = (models) => {
    ExportSage.belongsTo(models.Tenant, { foreignKey: 'tenant_id' });
    ExportSage.belongsTo(models.User, { foreignKey: 'created_by' });
  };

  return ExportSage;
};
