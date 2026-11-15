'use strict';

module.exports = (sequelize, DataTypes) => {
  const Tenant = sequelize.define('Tenant', {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    slug: { type: DataTypes.TEXT, allowNull: false, unique: true },
    nom: { type: DataTypes.TEXT, allowNull: false },
    logo_url: DataTypes.TEXT,
    devise: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'FCFA' },
    exercice_debut: DataTypes.DATEONLY,
    exercice_fin: DataTypes.DATEONLY,
    caissier_nom: DataTypes.TEXT,
    directeur_nom: DataTypes.TEXT,
    sigle: DataTypes.TEXT,
    forme_juridique: DataTypes.TEXT,
    adresse: DataTypes.TEXT,
    registre_commerce: DataTypes.TEXT,
    boite_postale: DataTypes.TEXT,
    nui: DataTypes.TEXT,
    activite: DataTypes.TEXT,
    dirigeant_nom: DataTypes.TEXT,
    telephone: DataTypes.TEXT,   // migration 031
    email: DataTypes.TEXT,       // migration 031
    site_web: DataTypes.TEXT,    // migration 031
    // migration 060 : référentiel du plan comptable (forme juridique ASSOC / ONG → SYCEBNL).
    plan_referentiel: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'SYSCOHADA' },
    actif: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: DataTypes.DATE,
  }, {
    tableName: 'tenants',
    timestamps: false,
  });

  Tenant.associate = (models) => {
    Tenant.hasMany(models.User, { foreignKey: 'tenant_id' });
    Tenant.hasMany(models.Rubrique, { foreignKey: 'tenant_id' });
    Tenant.hasMany(models.Journal, { foreignKey: 'tenant_id' });
    Tenant.hasMany(models.Mouvement, { foreignKey: 'tenant_id' });
    Tenant.hasMany(models.Ran, { foreignKey: 'tenant_id' });
    Tenant.hasMany(models.Budget, { foreignKey: 'tenant_id' });
    Tenant.hasMany(models.BudgetValidation, { foreignKey: 'tenant_id' });
    Tenant.hasMany(models.DepenseAttente, { foreignKey: 'tenant_id' });
    Tenant.hasMany(models.RessourceAttente, { foreignKey: 'tenant_id' });
    Tenant.hasMany(models.Banque, { foreignKey: 'tenant_id' });
    Tenant.hasMany(models.SageEquivalence, { foreignKey: 'tenant_id' });
    Tenant.hasMany(models.ExportSage, { foreignKey: 'tenant_id' });
    Tenant.hasMany(models.AuditLog, { foreignKey: 'tenant_id' });
    Tenant.hasMany(models.AppelFonds, { foreignKey: 'tenant_id' });
    Tenant.hasMany(models.TenantPermission, { foreignKey: 'tenant_id' });
    Tenant.hasMany(models.Role, { foreignKey: 'tenant_id' });
    Tenant.hasMany(models.PieceJustificativeType, { foreignKey: 'tenant_id' });
    Tenant.hasMany(models.PieceJointe, { foreignKey: 'tenant_id' });
    Tenant.hasMany(models.ArretCaisse, { foreignKey: 'tenant_id' });
    Tenant.hasMany(models.BudgetCaisse, { foreignKey: 'tenant_id' });
    Tenant.hasMany(models.DemandeDepassement, { foreignKey: 'tenant_id' });
    Tenant.hasMany(models.MouvementAttente, { foreignKey: 'tenant_id' });
    Tenant.hasMany(models.Notification, { foreignKey: 'tenant_id' });
  };

  return Tenant;
};
