import { PGlite } from '@electric-sql/pglite';
import * as schema from '@recommendship/schema/pg';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyWrites, editTime, quotas, type WriteOp } from '../src/write';

const now = '2026-11-01T10:00:00.000Z';
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(async () => {
	db = drizzle(new PGlite(), { schema });
	await migrate(db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });
});

const putItem = (id: string, extra: Record<string, unknown> = {}): WriteOp => ({
	op: 'PUT',
	table: 'item',
	id,
	data: { user_id: 'local', category_id: 'cat-movie', title: 'Past Lives', status: 'TO_TRY', added_at: now, ...extra }
});
const putRecommender = (id: string, name = 'Sam'): WriteOp => ({
	op: 'PUT',
	table: 'recommender',
	id,
	data: { user_id: 'local', name, created_at: now }
});
const putRec = (id: string, itemId: string, recommenderId: string): WriteOp => ({
	op: 'PUT',
	table: 'recommendation',
	id,
	data: { user_id: 'local', item_id: itemId, recommender_id: recommenderId, received_at: now }
});

describe('applyWrites', () => {
	it('stores a capture batch under the session user, ignoring the client user_id', async () => {
		const r = await applyWrites(db, 'alice', [putItem('i1'), putRecommender('r1'), putRec('x1', 'i1', 'r1')]);
		expect(r).toEqual({ applied: 3, rejected: [] });
		const [item] = await db.select().from(schema.item);
		expect(item).toMatchObject({ id: 'i1', userId: 'alice', title: 'Past Lives' });
	});

	it('applies a rating as a PATCH', async () => {
		await applyWrites(db, 'alice', [putItem('i1')]);
		const r = await applyWrites(db, 'alice', [
			{ op: 'PATCH', table: 'item', id: 'i1', data: { status: 'TRIED', rating: 4.5, rated_at: now } }
		]);
		expect(r.rejected).toEqual([]);
		const [item] = await db.select().from(schema.item);
		expect(item).toMatchObject({ status: 'TRIED', rating: 4.5 });
	});

	it("won't let one user overwrite, edit or delete another user's row", async () => {
		await applyWrites(db, 'alice', [putItem('i1')]);
		const r = await applyWrites(db, 'mallory', [
			putItem('i1', { title: 'pwned' }),
			{ op: 'PATCH', table: 'item', id: 'i1', data: { title: 'pwned' } },
			{ op: 'DELETE', table: 'item', id: 'i1' }
		]);
		expect(r.rejected.map((x) => x.reason)).toEqual(['id belongs to another user', 'not found']);
		const [item] = await db.select().from(schema.item);
		expect(item).toMatchObject({ userId: 'alice', title: 'Past Lives' });
	});

	it("rejects references to someone else's rows", async () => {
		await applyWrites(db, 'alice', [putItem('i1'), putRecommender('r1'), { op: 'PUT', table: 'category', id: 'c1', data: { name: 'Wine', icon: '🍷' } }]);
		const r = await applyWrites(db, 'mallory', [
			putRecommender('r2'),
			putRec('x1', 'i1', 'r2'),
			putItem('i2', { category_id: 'c1' })
		]);
		expect(r.rejected.map((x) => x.reason)).toEqual(['unknown item', 'unknown category']);
	});

	it('validates columns and drops unknown ones', async () => {
		const r = await applyWrites(db, 'alice', [
			putItem('i1', { rating: 4.3 }),
			putItem('i2', { status: 'LOVED' }),
			putItem('i3', { title: '' }),
			putItem('i4', { added_at: 'yesterday' }),
			putItem('i5', { is_admin: true })
		]);
		expect(r.applied).toBe(1);
		expect(r.rejected.map((x) => x.id)).toEqual(['i1', 'i2', 'i3', 'i4']);
	});

	it("doesn't let clients write app_user or invite rows", async () => {
		const r = await applyWrites(db, 'alice', [
			{ op: 'PATCH', table: 'app_user', id: 'alice', data: { approved_at: now } },
			{ op: 'PUT', table: 'invite', id: 'x', data: {} }
		]);
		expect(r.rejected).toHaveLength(2);
	});

	it('keeps going after a bad op in the middle of a batch', async () => {
		const r = await applyWrites(db, 'alice', [putItem('i1'), putRec('x1', 'missing', 'r1'), putItem('i2', { title: 'Aftersun' })]);
		expect(r.applied).toBe(2);
		expect(await db.select().from(schema.item)).toHaveLength(2);
	});

	it('rejects a second recommendation for the same item and person as a duplicate', async () => {
		await applyWrites(db, 'alice', [putItem('i1'), putRecommender('r1'), putRec('x1', 'i1', 'r1')]);
		const r = await applyWrites(db, 'alice', [putRec('x2', 'i1', 'r1')]);
		expect(r.rejected).toEqual([{ index: 0, table: 'recommendation', id: 'x2', reason: 'duplicate' }]);
	});

	it('deletes cascade from an item to its recommendations', async () => {
		await applyWrites(db, 'alice', [putItem('i1'), putRecommender('r1'), putRec('x1', 'i1', 'r1')]);
		await applyWrites(db, 'alice', [{ op: 'DELETE', table: 'item', id: 'i1' }]);
		expect(await db.select().from(schema.recommendation).where(eq(schema.recommendation.itemId, 'i1'))).toEqual([]);
	});

	it('applies a person merge as the client sends it (duplicate first, then move, then delete)', async () => {
		// "Sma" is a typo for Sam. Both recommended i1; only Sma recommended i2.
		await applyWrites(db, 'alice', [
			putItem('i1'),
			putItem('i2', { title: 'Aftersun' }),
			putRecommender('sam', 'Sam'),
			putRecommender('sma', 'Sma'),
			putRec('x1', 'i1', 'sam'),
			putRec('x2', 'i1', 'sma'),
			putRec('x3', 'i2', 'sma')
		]);
		const r = await applyWrites(db, 'alice', [
			{ op: 'PATCH', table: 'recommendation', id: 'x1', data: { note: 'from Sma' } },
			{ op: 'DELETE', table: 'recommendation', id: 'x2' },
			{ op: 'PATCH', table: 'recommendation', id: 'x3', data: { recommender_id: 'sam' } },
			{ op: 'DELETE', table: 'recommender', id: 'sma' }
		]);
		expect(r).toEqual({ applied: 4, rejected: [] });
		const recs = await db.select().from(schema.recommendation);
		expect(recs.map((x) => [x.id, x.itemId, x.recommenderId]).sort()).toEqual([
			['x1', 'i1', 'sam'],
			['x3', 'i2', 'sam']
		]);
		expect(await db.select().from(schema.recommender)).toHaveLength(1);
	});

	it('applies an item merge as the client sends it', async () => {
		// "Severence" is a duplicate of "Severance": Sam recommended both, Jo only the typo, which is rated.
		await applyWrites(db, 'alice', [
			putItem('keep', { title: 'Severance', category_id: 'cat-tv' }),
			putItem('dup', { title: 'Severence', category_id: 'cat-tv', status: 'TRIED', rating: 5, rated_at: now }),
			putRecommender('sam', 'Sam'),
			putRecommender('jo', 'Jo'),
			putRec('x1', 'keep', 'sam'),
			putRec('x2', 'dup', 'sam'),
			putRec('x3', 'dup', 'jo')
		]);
		const r = await applyWrites(db, 'alice', [
			{ op: 'PATCH', table: 'recommendation', id: 'x1', data: { note: 'from the duplicate' } },
			{ op: 'DELETE', table: 'recommendation', id: 'x2' },
			{ op: 'PATCH', table: 'recommendation', id: 'x3', data: { item_id: 'keep' } },
			{ op: 'PATCH', table: 'item', id: 'keep', data: { status: 'TRIED', rating: 5, rated_at: now } },
			{ op: 'DELETE', table: 'item', id: 'dup' }
		]);
		expect(r).toEqual({ applied: 5, rejected: [] });
		const recs = await db.select().from(schema.recommendation);
		expect(recs.map((x) => [x.id, x.itemId, x.recommenderId]).sort()).toEqual([
			['x1', 'keep', 'sam'],
			['x3', 'keep', 'jo']
		]);
		const items = await db.select().from(schema.item);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ id: 'keep', status: 'TRIED', rating: 5 });
	});

	it("won't move a recommendation onto someone else's item", async () => {
		await applyWrites(db, 'alice', [putItem('i1'), putRecommender('r1'), putRec('x1', 'i1', 'r1')]);
		await applyWrites(db, 'mallory', [putItem('m1')]);
		const r = await applyWrites(db, 'alice', [{ op: 'PATCH', table: 'recommendation', id: 'x1', data: { item_id: 'm1' } }]);
		expect(r.rejected.map((x) => x.reason)).toEqual(['unknown item']);
	});

	it("won't move a recommendation onto someone else's person", async () => {
		await applyWrites(db, 'alice', [putItem('i1'), putRecommender('r1'), putRec('x1', 'i1', 'r1')]);
		await applyWrites(db, 'mallory', [putRecommender('m1', 'Mal')]);
		const r = await applyWrites(db, 'alice', [{ op: 'PATCH', table: 'recommendation', id: 'x1', data: { recommender_id: 'm1' } }]);
		expect(r.rejected.map((x) => x.reason)).toEqual(['unknown recommender']);
	});

	describe('newest edit wins', () => {
		const at = (hhmm: string) => `2026-11-01T${hhmm}:00.000Z`;
		const server = new Date(at('12:00'));
		const patch = (data: Record<string, unknown>, edited?: string): WriteOp => ({
			op: 'PATCH',
			table: 'item',
			id: 'i1',
			data: { ...data, ...(edited ? { updated_at: edited } : {}) }
		});
		const write = (op: WriteOp, now = server) => applyWrites(db, 'alice', [op], quotas(), now);
		const row = async () => (await db.select().from(schema.item))[0]!;

		beforeEach(async () => {
			await applyWrites(db, 'alice', [putItem('i1', { updated_at: at('09:00') })], quotas(), server);
		});

		it('ignores an older edit that uploads after a newer one', async () => {
			// Laptop rates 3 at 10:05; the phone's offline rating of 4 at 10:00 uploads later.
			await write(patch({ rating: 3 }, at('10:05')));
			const late = await write(patch({ rating: 4 }, at('10:00')));
			expect(late).toEqual({ applied: 1, rejected: [] });
			expect(await row()).toMatchObject({ rating: 3, updatedAt: at('10:05') });
		});

		it('still applies an older edit to a different field', async () => {
			await write(patch({ rating: 3 }, at('10:05')));
			await write(patch({ title: 'Past Lives (2023)' }, at('10:00')));
			expect(await row()).toMatchObject({ rating: 3, title: 'Past Lives (2023)', updatedAt: at('10:05') });
		});

		it("won't let a device with a clock in the future win forever", async () => {
			await write(patch({ rating: 2 }, '2099-01-01T00:00:00.000Z'), new Date(at('10:00')));
			await write(patch({ rating: 5 }, at('10:01')), new Date(at('10:01')));
			expect(await row()).toMatchObject({ rating: 5 });
		});

		it('treats an edit without a time (older app versions) as made on arrival', async () => {
			await write(patch({ rating: 3 }, at('10:05')));
			await write(patch({ rating: 4 }), new Date(at('11:00')));
			expect(await row()).toMatchObject({ rating: 4 });
		});

		it('lets a delete win over a later edit', async () => {
			await applyWrites(db, 'alice', [{ op: 'DELETE', table: 'item', id: 'i1' }], quotas(), server);
			const r = await write(patch({ rating: 5 }, at('11:59')));
			expect(r.rejected.map((x) => x.reason)).toEqual(['not found']);
		});

		it('normalises and clamps edit times', () => {
			expect(editTime('2026-11-01T10:00:00Z', server)).toBe(at('10:00'));
			expect(editTime('2099-01-01T00:00:00.000Z', server)).toBe(at('12:00'));
			expect(editTime('yesterday', server)).toBe(at('12:00'));
			expect(editTime(undefined, server)).toBe(at('12:00'));
		});
	});

	it('caps rows per user at the configured quota', async () => {
		const ops = Array.from({ length: 4 }, (_, k) => putItem(`q${k}`, { title: `Book ${k}` }));
		const r = await applyWrites(db, 'alice', ops, quotas(3));
		expect(r.applied).toBe(3);
		expect(r.rejected).toEqual([{ index: 3, table: 'item', id: 'q3', reason: 'limit of 3 items reached' }]);
		// Editing an existing row still works at the limit.
		const edit = await applyWrites(db, 'alice', [{ op: 'PATCH', table: 'item', id: 'q0', data: { title: 'Renamed' } }], quotas(3));
		expect(edit.rejected).toEqual([]);
	});

	it('enforces quotas', async () => {
		const ops = Array.from({ length: 101 }, (_, k): WriteOp => ({ op: 'PUT', table: 'category', id: `c${k}`, data: { name: `C${k}`, icon: '•' } }));
		const r = await applyWrites(db, 'alice', ops);
		expect(r.applied).toBe(100);
		expect(r.rejected[0]?.reason).toMatch(/limit of 100 categories reached/);
	});
});
