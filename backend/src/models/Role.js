'use strict';

module.exports = (sequelize, DataTypes) => {
  const Role = sequelize.define('Role', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    nom: { type: DataTypes.TEXT, allowNull: false },
    code: { type: DataTypes.TEXT, allowNull: false },
    description: DataTypes.TEXT,
    couleur: { type: DataTypes.TEXT, defaultValue: '#6366f1' },
    tenant_id: DataTypes.UUID,
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    tableName: 'roles',
    timestamps: false,
  });

  Role.associate = (models) => {
    Role.belongsTo(models.Tenant, { foreignKey: 'tenant_id' });
    Role.hasMany(models.User, { foreignKey: 'custom_role_id', as: 'utilisateurs' });
    Role.hasMany(models.RolePermission, { foreignKey: 'role_id' });
  };

  return Role;
};
