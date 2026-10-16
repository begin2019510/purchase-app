'use strict';
const mysql = require('mysql2/promise');
const cfg = require('./config');

const pool = mysql.createPool({
  host: cfg.DB.host,
  port: cfg.DB.port,
  user: cfg.DB.user,
  password: cfg.DB.password,
  database: cfg.DB.database,
  waitForConnections: true,
  connectionLimit: 8,          // 1.6G 内存机器，够用且克制
  queueLimit: 32,
  namedPlaceholders: true,
  charset: 'utf8mb4_unicode_ci',
  enableKeepAlive: true,
  keepAliveInitialDelay: 30000,
});

async function query(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows;
}
async function one(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows[0] || null;
}
async function exec(sql, params) {
  const [result] = await pool.query(sql, params);
  return result;
}

module.exports = { pool, query, one, exec };
