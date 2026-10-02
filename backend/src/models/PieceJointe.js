'use strict';

module.exports = (sequelize, DataTypes) => {
  const PieceJointe = sequelize.define('PieceJointe', {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    tenant_id: { type: DataTypes.UUID, allowNull: false },
    journal_id_mvt: { type: DataTypes.BIGINT, allowNull: false },
    nom_fichier: { type: DataTypes.TEXT, allowNull: false },
    storage_path: { type: DataTypes.TEXT, allowNull: false },
    storage_url: { type: DataTypes.TEXT, allowNull: false },
    type_mime: DataTypes.TEXT,
    taille_octets: DataTypes.BIGINT,
    uploaded_by: DataTypes.UUID,
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    tableName: 'pieces_jointes',
    timestamps: false,
  });

  PieceJointe.associate = (models) => {
    PieceJointe.belongsTo(models.Tenant, { foreignKey: 'tenant_id' });
    PieceJointe.belongsTo(models.Mouvement, { foreignKey: 'journal_id_mvt' });
    PieceJointe.belongsTo(models.User, { foreignKey: 'uploaded_by' });
  };

  return PieceJointe;
};
