'use strict';

const ROLES = ['super_admin', 'comptable_cabinet', 'directeur', 'caissier', 'auditeur', 'commercial'];
const CANAUX_NOTIF = ['email', 'plateforme', 'les_deux', 'aucun'];

module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define('User', {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    tenant_id: DataTypes.UUID,
    username: { type: DataTypes.TEXT, allowNull: false },
    email: DataTypes.TEXT,
    password_hash: { type: DataTypes.TEXT, allowNull: false },
    role: { type: DataTypes.TEXT, allowNull: false, validate: { isIn: [ROLES] } },
    custom_role_id: DataTypes.INTEGER,
    canal_notif: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'email', validate: { isIn: [CANAUX_NOTIF] } },
    actif: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    derniere_connexion: DataTypes.DATE,
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    tableName: 'users',
    timestamps: false,
  });

  User.ROLES = ROLES;
  User.CANAUX_NOTIF = CANAUX_NOTIF;

  User.associate = (models) => {
    User.belongsTo(models.Tenant, { foreignKey: 'tenant_id' });
    User.belongsTo(models.Role, { foreignKey: 'custom_role_id', as: 'roleCustom' });
    User.hasMany(models.UserPermission, { foreignKey: 'user_id' });
    User.hasMany(models.RefreshToken, { foreignKey: 'user_id' });
    User.hasMany(models.Mouvement, { foreignKey: 'created_by' });
    User.hasMany(models.Notification, { foreignKey: 'destinataire_id' });
  };

  return User;
};
