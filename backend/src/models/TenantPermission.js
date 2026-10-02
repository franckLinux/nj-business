'use strict';

module.exports = (sequelize, DataTypes) => {
  const TenantPermission = sequelize.define('TenantPermission', {
    tenant_id: { type: DataTypes.UUID, primaryKey: true },
    permission_code: { type: DataTypes.STRING(100), primaryKey: true },
    granted_at: DataTypes.DATE,
  }, {
    tableName: 'tenant_permissions',
    timestamps: false,
  });

  TenantPermission.associate = (models) => {
    TenantPermission.belongsTo(models.Tenant, { foreignKey: 'tenant_id' });
    TenantPermission.belongsTo(models.Permission, { foreignKey: 'permission_code', targetKey: 'code' });
  };

  return TenantPermission;
};
