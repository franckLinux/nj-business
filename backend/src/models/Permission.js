'use strict';

module.exports = (sequelize, DataTypes) => {
  const Permission = sequelize.define('Permission', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    code: { type: DataTypes.STRING(100), allowNull: false, unique: true },
    nom: { type: DataTypes.STRING(200), allowNull: false },
    module: { type: DataTypes.STRING(50), allowNull: false },
    description: DataTypes.TEXT,
    created_at: DataTypes.DATE,
  }, {
    tableName: 'permissions',
    timestamps: false,
  });

  Permission.associate = (models) => {
    Permission.hasMany(models.TenantPermission, { foreignKey: 'permission_code', sourceKey: 'code' });
    Permission.hasMany(models.UserPermission, { foreignKey: 'permission_code', sourceKey: 'code' });
  };

  return Permission;
};
