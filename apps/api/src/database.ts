import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { InitialSchema1790870400000 } from './migrations/1790870400000-initial-schema.js';

export const database = new DataSource({
  type: 'postgres', host: 'database', port: 5432,
  username: process.env.POSTGRES_USER ?? 'app',
  database: process.env.POSTGRES_DB ?? 'app',
  password: process.env.POSTGRES_PASSWORD,
  synchronize: false, migrationsRun: false, logging: false,
  migrations: [InitialSchema1790870400000],
  extra: { max: 8, connectionTimeoutMillis: 5000, statement_timeout: 15000 },
});
