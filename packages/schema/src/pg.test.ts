import { getTableColumns, getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { syncedTables } from './index';
import { pgSyncedTables } from './pg';

// PowerSync copies rows column by column, so the device schema and the server
// schema must agree on table and column names.
describe('SQLite and Postgres schemas', () => {
	for (const key of Object.keys(syncedTables) as (keyof typeof syncedTables)[]) {
		it(`${key} matches`, () => {
			const lite = syncedTables[key];
			const pg = pgSyncedTables[key];
			expect(getTableName(pg)).toBe(getTableName(lite));
			const names = (t: typeof lite | typeof pg) =>
				Object.values(getTableColumns(t))
					.map((c) => c.name)
					.sort();
			expect(names(pg)).toEqual(names(lite));
		});
	}
});
