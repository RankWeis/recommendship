// The files in samples/backups say in their names what they add to an empty account
// (or that they're refused). Import each one the way the app does and hold them to it.

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBackup, planImport } from './backup';

const dir = new URL('../../../../samples/backups/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
const limits = { rows: 10_000, categories: 100 };

function importIntoEmpty(file: string) {
	let n = 0;
	const backup = parseBackup(readFileSync(new URL(file, dir), 'utf8'));
	return planImport(backup, { categories: [], people: [], items: [], recommendations: [] }, limits, () => `new-${++n}`);
}

describe('sample backups', () => {
	it('are all there', () => {
		expect(files.length).toBeGreaterThanOrEqual(10);
	});

	for (const file of files) {
		it(file, () => {
			if (file.includes('-refused')) {
				let plan: ReturnType<typeof importIntoEmpty> | null = null;
				try {
					plan = importIntoEmpty(file);
				} catch (e) {
					expect((e as Error).message).toBeTruthy();
					return;
				}
				expect(plan.overLimit).toBeTruthy();
				return;
			}
			const plan = importIntoEmpty(file);
			expect(plan.overLimit).toBeNull();
			const items = Number(file.match(/(\d+)-items?\b/)?.[1]);
			expect(plan.rows.item).toHaveLength(items);
			const people = file.match(/(\d+)-(person|people)\b/)?.[1];
			if (people) expect(plan.rows.recommender).toHaveLength(Number(people));
		});
	}
});
