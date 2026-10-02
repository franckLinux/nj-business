require('dotenv').config();

const sslConfig = process.env.PG_SSL === 'true'
  ? { require: true, rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED !== 'false' }
  : false;

const common = {
  dialect: 'postgres',
  use_env_variable: 'DATABASE_URL',
  logging: process.env.NODE_ENV === 'development' ? console.log : false,
  dialectOptions: sslConfig ? { ssl: sslConfig } : {},
  pool: {
    max: parseInt(process.env.PG_POOL_MAX, 10) || 20,
    idle: 30000,
    acquire: 5000,
  },
};

module.exports = {
  development: common,
  test: common,
  production: common,
};
