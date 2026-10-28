'use strict';

module.exports = (sequelize, DataTypes) => {
  const RessourceAttente = sequelize.define('RessourceAttente', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    tenant_id: { type: DataTypes.UUID, allowNull: false },
    mois: { type: DataTypes.TEXT, allowNull: false },
    annee: { type: DataTypes.INTEGER, allowNull: false },
    semaine: DataTypes.SMALLINT,   // migration 040 : NULL = mensuel, 1..6 = semaine du mois
    rubrique_code: { type: DataTypes.TEXT, allowNull: false },
    intitule: { type: DataTypes.TEXT, allowNull: false },
    montant: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    tableName: 'ressources_attente',
    timestamps: false,
  });

  RessourceAttente.associate = (models) => {
    RessourceAttente.belongsTo(models.Tenant, { foreignKey: 'tenant_id' });
  };

  return RessourceAttente;
};
