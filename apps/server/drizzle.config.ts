import { defineConfig } from 'drizzle-kit';

// App tables only. Better Auth creates and migrates its own tables (see src/migrate.ts).
export default defineConfig({
	dialect: 'postgresql',
	schema: '../../packages/schema/src/pg.ts',
	out: './drizzle'
});
