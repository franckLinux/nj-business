'use strict';

module.exports = (sequelize, DataTypes) => {
  const Notification = sequelize.define('Notification', {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    tenant_id: { type: DataTypes.UUID, allowNull: false },
    destinataire_id: { type: DataTypes.UUID, allowNull: false },
    type: { type: DataTypes.TEXT, allowNull: false },
    titre: { type: DataTypes.TEXT, allowNull: false },
    message: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    ref_type: DataTypes.TEXT,
    ref_id: DataTypes.TEXT,
    lu: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    tableName: 'notifications',
    timestamps: false,
  });

  Notification.associate = (models) => {
    Notification.belongsTo(models.Tenant, { foreignKey: 'tenant_id' });
    Notification.belongsTo(models.User, { foreignKey: 'destinataire_id' });
  };

  return Notification;
};
