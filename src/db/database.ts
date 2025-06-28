import { drizzle } from 'drizzle-orm/libsql/node';
import { createClient } from '@libsql/client';
import env from '@/config/env.ts';

// Configure SQLite client
const client = createClient({ 
  url: `file:${env.DB_FILE_NAME!}`,
  syncUrl: undefined, // Disable sync for local SQLite
});

const db = drizzle({ client, casing: 'snake_case' });

export default db;
