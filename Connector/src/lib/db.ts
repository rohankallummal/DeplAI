import mysql, { type RowDataPacket } from 'mysql2/promise';

// Shared row type for SELECT results: a plain record with string-keyed columns.
// (mysql2's RowDataPacket carries an `any` index signature internally, so column
// access stays loose without writing `any` in our own source.)
export type Row = RowDataPacket;

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'DeplaiDB',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

export async function query<T = unknown>(
  sql: string,
  params?: unknown[]
): Promise<T> {
  const [results] = await pool.execute(sql, params as Parameters<typeof pool.execute>[1]);
  return results as T;
}

export default pool;