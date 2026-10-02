'use strict';

module.exports = (sequelize, DataTypes) => {
  const RolePermission = sequelize.define('RolePermission', {
    role_id: { type: DataTypes.INTEGER, primaryKey: true },
    permission_code: { type: DataTypes.TEXT, primaryKey: true },
  }, {
    tableName: 'role_permissions',
    timestamps: false,
  });

  RolePermission.associate = (models) => {
    RolePermission.belongsTo(models.Role, { foreignKey: 'role_id' });
  };

  return RolePermission;
};
