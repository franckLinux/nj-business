'use strict';

module.exports = (sequelize, DataTypes) => {
  const Mouvement = sequelize.define('Mouvement', {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    tenant_id: { type: DataTypes.UUID, allowNull: false },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    mois: { type: DataTypes.TEXT, allowNull: false },
    annee: { type: DataTypes.INTEGER, allowNull: false },
    journal_id: DataTypes.INTEGER,
    type_caisse: { type: DataTypes.TEXT, allowNull: false, validate: { isIn: [['especes', 'om']] } },
    rubrique_code: { type: DataTypes.TEXT, allowNull: false },
    intitule: { type: DataTypes.TEXT, allowNull: false },
    objet: DataTypes.TEXT,
    beneficiaire: DataTypes.TEXT,
    piece_identite: DataTypes.TEXT,
    telephone: DataTypes.TEXT,
    entree: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    sortie: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    exporte_sage: { type: DataTypes.BOOLEAN, defaultValue: false },
    // Migration 027 : numéro de séquence (attribué par la base) et annulation.
    numero: DataTypes.INTEGER,
    annule: { type: DataTypes.BOOLEAN, defaultValue: false },
    nb_impressions: { type: DataTypes.INTEGER, defaultValue: 0 },
    derniere_impression_le: DataTypes.DATE,
    annule_par_id: DataTypes.BIGINT,
    annulation_de_id: DataTypes.BIGINT,
    motif_annulation: { type: DataTypes.TEXT, defaultValue: '' },
    created_by: DataTypes.UUID,
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: DataTypes.DATE,
  }, {
    tableName: 'journal',
    timestamps: false,
  });

  Mouvement.associate = (models) => {
    Mouvement.belongsTo(models.Tenant, { foreignKey: 'tenant_id' });
    Mouvement.belongsTo(models.Journal, { foreignKey: 'journal_id' });
    Mouvement.belongsTo(models.User, { foreignKey: 'created_by', as: 'auteur' });
    Mouvement.hasMany(models.PieceJointe, { foreignKey: 'journal_id_mvt' });
  };

  return Mouvement;
};
