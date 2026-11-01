import { describe, expect, it } from 'vitest';
import { buildBackup, importBatches, parseBackup, planImport, toCsv, type Backup, type Existing } from './backup';

const backup: Backup = buildBackup(
	{
		categories: [{ id: 'c-wine', name: 'Wine', icon: '🍷', external_source: 'NONE', sort_order: 100 }],
		people: [
			{ id: 'p-sam', name: 'Sam', notes: null, created_at: '2026-10-01T10:00:00.000Z' },
			{ id: 'p-jo', name: 'Jo', notes: 'neighbour', created_at: '2026-10-02T10:00:00.000Z' }
		],
		items: [
			{
				id: 'i-dune',
				category_id: 'cat-book',
				title: 'Dune',
				status: 'TRIED',
				rating: 4.5,
				rated_at: '2026-10-05T10:00:00.000Z',
				review: 'Long, "worth it"',
				added_at: '2026-10-01T10:00:00.000Z',
				tried_at: '2026-10-05T10:00:00.000Z'
			},
			{ id: 'i-rioja', category_id: 'c-wine', title: 'Rioja', status: 'TO_TRY', added_at: '2026-10-03T10:00:00.000Z' }
		],
		recommendations: [
			{ id: 'r1', item_id: 'i-dune', recommender_id: 'p-sam', received_at: '2026-10-01T10:00:00.000Z', enthusiasm: 3, note: 'read it' },
			{ id: 'r2', item_id: 'i-dune', recommender_id: 'p-jo', received_at: '2026-10-01T10:00:00.000Z' },
			{ id: 'r3', item_id: 'i-rioja', recommender_id: 'p-jo', received_at: '2026-10-03T10:00:00.000Z' }
		]
	},
	new Date('2026-11-01T12:00:00.000Z')
);

const empty: Existing = { categories: [], people: [], items: [], recommendations: [] };
const limits = { rows: 1000, categories: 100 };
const ids = () => {
	let n = 0;
	return () => `new-${++n}`;
};

describe('backup files', () => {
	it('round-trips through JSON, dropping columns it does not know', () => {
		const withExtras = { ...backup, items: backup.items.map((i) => ({ ...i, user_id: 'someone', updated_at: 'x' })) };
		const parsed = parseBackup(JSON.stringify(withExtras));
		expect(parsed).toEqual(backup);
		expect(parsed.items[0]).not.toHaveProperty('user_id');
	});

	it('refuses files that are not backups, or break the rules the server enforces', () => {
		expect(() => parseBackup('not json')).toThrow("isn't a Recommendship backup");
		expect(() => parseBackup('{"items": []}')).toThrow("isn't a Recommendship backup");
		expect(() => parseBackup(JSON.stringify({ ...backup, version: 2 }))).toThrow('newer version');
		const badRating = { ...backup, items: [{ ...backup.items[0], rating: 4.3 }] };
		expect(() => parseBackup(JSON.stringify(badRating))).toThrow('items.0.rating: ratings go in half steps');
	});
});

describe('planning an import', () => {
	it('into an empty account: everything is new, with fresh ids and references rewired', () => {
		const plan = planImport(backup, empty, limits, ids());
		expect(plan.overLimit).toBeNull();
		expect(plan.rows.category.map((c) => c.name)).toEqual(['Wine']);
		expect(plan.rows.recommender.map((p) => p.name)).toEqual(['Sam', 'Jo']);
		const wine = plan.rows.category[0]!.id;
		const [dune, rioja] = plan.rows.item;
		expect(dune).toMatchObject({ title: 'Dune', category_id: 'cat-book', rating: 4.5 });
		expect(rioja).toMatchObject({ title: 'Rioja', category_id: wine });
		expect(plan.rows.recommendation).toHaveLength(3);
		const allIds = Object.values(plan.rows).flat().map((r) => r.id);
		expect(allIds.every((id) => id.startsWith('new-'))).toBe(true);
		const sam = plan.rows.recommender[0]!.id;
		expect(plan.rows.recommendation[0]).toMatchObject({ item_id: dune!.id, recommender_id: sam, enthusiasm: 3 });
	});

	it('matches people by name and items by title and type, adding only missing recommendations', () => {
		const existing: Existing = {
			categories: [{ id: 'mine-wine', name: 'wine' }],
			people: [{ id: 'mine-sam', name: 'sam' }],
			items: [{ id: 'mine-dune', category_id: 'cat-book', title: 'DUNE ' }],
			recommendations: [{ item_id: 'mine-dune', recommender_id: 'mine-sam' }]
		};
		const plan = planImport(backup, existing, limits, ids());
		expect(plan.rows.category).toEqual([]);
		expect(plan.rows.recommender.map((p) => p.name)).toEqual(['Jo']);
		// Dune is already here and stays untouched; Rioja lands in your existing Wine type.
		expect(plan.rows.item.map((i) => [i.title, i.category_id])).toEqual([['Rioja', 'mine-wine']]);
		expect(plan.alreadyHere).toEqual({ items: 1, people: 1 });
		const jo = plan.rows.recommender[0]!.id;
		expect(plan.rows.recommendation.map((r) => [r.item_id, r.recommender_id])).toEqual([
			['mine-dune', jo],
			[plan.rows.item[0]!.id, jo]
		]);
	});

	it('treats the same movie as one item whatever it is called, but keeps different films with the same title apart', () => {
		const dune = (id: string, title: string, external_id: string | null) => ({
			id,
			category_id: 'cat-movie',
			title,
			status: 'TO_TRY' as const,
			added_at: '2026-10-01T10:00:00.000Z',
			external_source: external_id ? ('TMDB_MOVIE' as const) : null,
			external_id
		});
		const file = buildBackup({
			categories: [],
			people: [],
			items: [dune('a', 'Dune', '438631'), dune('b', 'Dune (2021)', '438631'), dune('c', 'Dune', '841'), dune('d', 'Dune: Part Two', '693134')],
			recommendations: []
		});
		// You already have Part Two, typed by hand, and the 1984 film under another title.
		const existing: Existing = {
			...empty,
			items: [
				{ id: 'mine-2', category_id: 'cat-movie', title: 'dune: part two', external_source: 'NONE', external_id: null },
				{ id: 'mine-84', category_id: 'cat-movie', title: 'Dune (Lynch)', external_source: 'TMDB_MOVIE', external_id: '841' }
			]
		};
		const plan = planImport(file, existing, limits, ids());
		// One new 2021 Dune; the 1984 one and Part Two are already here.
		expect(plan.rows.item.map((i) => [i.title, i.external_id])).toEqual([['Dune', '438631']]);
		expect(plan.alreadyHere.items).toBe(2);
	});

	it('adds nothing when imported twice', () => {
		const first = planImport(backup, empty, limits, ids());
		const after: Existing = {
			categories: first.rows.category.map((c) => ({ id: c.id, name: String(c.name) })),
			people: first.rows.recommender.map((p) => ({ id: p.id, name: String(p.name) })),
			items: first.rows.item.map((i) => ({ id: i.id, category_id: String(i.category_id), title: String(i.title) })),
			recommendations: first.rows.recommendation.map((r) => ({ item_id: String(r.item_id), recommender_id: String(r.recommender_id) }))
		};
		const again = planImport(backup, after, limits, ids());
		expect(Object.values(again.rows).flat()).toEqual([]);
		expect(again.alreadyHere).toEqual({ items: 2, people: 2 });
	});

	it('refuses an import that would go past a limit, saying by how much', () => {
		const plan = planImport(backup, { ...empty, items: [{ id: 'x', category_id: 'cat-tv', title: 'X' }] }, { rows: 2, categories: 100 }, ids());
		expect(plan.overLimit).toBe('That would make 3 items, over the limit of 2. You have 1 and the file adds 2.');
	});

	it('writes references before what points at them, in uploadable chunks', () => {
		const plan = planImport(backup, empty, limits, ids());
		const batches = importBatches(plan.rows, 3);
		expect(batches.map((b) => b.length)).toEqual([3, 3, 2]);
		expect(batches.flat().map((op) => op.table)).toEqual([
			'category',
			'recommender',
			'recommender',
			'item',
			'item',
			'recommendation',
			'recommendation',
			'recommendation'
		]);
	});
});

describe('spreadsheet', () => {
	it('has one row per item with who recommended it, quoting where needed', () => {
		const lines = toCsv(backup).replace('﻿', '').trimEnd().split('\r\n');
		expect(lines[0]).toBe('Title,Type,Status,Rating,Recommended by,What they said,Your review,Year,Creator,Added,Tried');
		expect(lines[1]).toBe('Dune,Book,Tried,4.5,Sam (you MUST); Jo,Sam: read it,"Long, ""worth it""",,,2026-10-01,2026-10-05');
		expect(lines[2]).toBe('Rioja,Wine,Put List,,Jo,,,,,2026-10-03,');
	});

	it("doesn't let a title run as a spreadsheet formula", () => {
		const evil = { ...backup, items: [{ ...backup.items[1]!, title: '=HYPERLINK("x")' }], recommendations: [] };
		expect(toCsv(evil).split('\r\n')[1]).toMatch(/^"'=HYPERLINK\(""x""\)"/);
	});
});
