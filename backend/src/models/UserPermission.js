'use strict';

module.exports = (sequelize, DataTypes) => {
  const UserPermission = sequelize.define('UserPermission', {
    user_id: { type: DataTypes.UUID, primaryKey: true },
    permission_code: { type: DataTypes.STRING(100), primaryKey: true },
    // 'grant' = ajoutée au rôle, 'deny' = retirée du rôle (migration 014).
    effet: { type: DataTypes.STRING(5), allowNull: false, defaultValue: 'grant', validate: { isIn: [['grant', 'deny']] } },
    granted_at: DataTypes.DATE,
  }, {
    tableName: 'user_permissions',
    timestamps: false,
  });

  UserPermission.associate = (models) => {
    UserPermission.belongsTo(models.User, { foreignKey: 'user_id' });
    UserPermission.belongsTo(models.Permission, { foreignKey: 'permission_code', targetKey: 'code' });
  };

  return UserPermission;
};
