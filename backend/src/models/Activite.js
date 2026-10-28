'use strict';

// Activité / projet de rattachement des opérations (migration 034).
module.exports = (sequelize, DataTypes) => {
  const Activite = sequelize.define('Activite', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    tenant_id: { type: DataTypes.UUID, allowNull: false },
    code: { type: DataTypes.STRING(20), allowNull: false, defaultValue: '' },
    nom: { type: DataTypes.STRING(120), allowNull: false },
    type: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'activite', validate: { isIn: [['activite', 'projet']] } },
    description: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    budget: DataTypes.DECIMAL(15, 2),
    date_debut: DataTypes.DATEONLY,
    date_fin: DataTypes.DATEONLY,
    actif: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, {
    tableName: 'activites',
    timestamps: false,
  });
  return Activite;
};
