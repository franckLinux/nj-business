'use strict';

module.exports = (sequelize, DataTypes) => {
  const AuditLog = sequelize.define('AuditLog', {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    tenant_id: DataTypes.UUID,
    user_id: DataTypes.UUID,
    action: { type: DataTypes.TEXT, allowNull: false },
    entite: { type: DataTypes.TEXT, allowNull: false },
    entite_id: DataTypes.TEXT,
    ancienne_valeur: DataTypes.JSONB,
    nouvelle_valeur: DataTypes.JSONB,
    ip_address: DataTypes.STRING,
    user_agent: DataTypes.TEXT,
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    tableName: 'audit_log',
    timestamps: false,
  });

  AuditLog.associate = (models) => {
    AuditLog.belongsTo(models.Tenant, { foreignKey: 'tenant_id' });
    AuditLog.belongsTo(models.User, { foreignKey: 'user_id' });
  };

  return AuditLog;
};
