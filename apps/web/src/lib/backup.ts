// Backups: everything you've logged as one JSON file, to keep or to load into
// another account, plus a spreadsheet version for reading. Rows use the database's
// snake_case columns and are checked with the same rules the server applies, so an
// import never writes something the server will later refuse.
//
// Importing adds to what's already here rather than replacing it: people match by
// name, items by title and type, and your own types by name. Anything you already
// have is left as it is; only the recommendations it's missing are added.

import { SEED_CATEGORIES, type ItemStatus } from '@recommendship/schema';
import { columns, MAX_OPS_PER_BATCH, rowId } from '@recommendship/schema/validate';
import { z } from 'zod';

export const BACKUP_FORMAT = 'recommendship-backup';

const MAX_ROWS = 20_000;
const withId = <T extends z.ZodRawShape>(s: z.ZodObject<T>) => z.array(s.extend({ id: rowId })).max(MAX_ROWS);

export const backupSchema = z.object({
	format: z.literal(BACKUP_FORMAT),
	version: z.literal(1),
	exported_at: z.string().max(40),
	categories: withId(columns.category),
	people: withId(columns.recommender),
	items: withId(columns.item),
	recommendations: withId(columns.recommendation)
});
export type Backup = z.infer<typeof backupSchema>;

export function buildBackup(data: Omit<Backup, 'format' | 'version' | 'exported_at'>, now = new Date()): Backup {
	return { format: BACKUP_FORMAT, version: 1, exported_at: now.toISOString(), ...data };
}

export function parseBackup(text: string): Backup {
	let json: { format?: unknown; version?: unknown } | null;
	try {
		json = JSON.parse(text);
	} catch {
		throw new Error("That file isn't a Recommendship backup.");
	}
	if (json?.format !== BACKUP_FORMAT) throw new Error("That file isn't a Recommendship backup.");
	if (json.version !== 1) throw new Error('That backup was made by a newer version of Recommendship. Reload the app and try again.');
	const parsed = backupSchema.safeParse(json);
	if (!parsed.success) {
		const issue = parsed.error.issues[0]!;
		throw new Error(`That backup has a problem at ${issue.path.join('.')}: ${issue.message}`);
	}
	return parsed.data;
}

/** What's already on this device, enough to match against. */
export interface Existing {
	/** Your own types (not the built-in ones). */
	categories: { id: string; name: string }[];
	people: { id: string; name: string }[];
	items: { id: string; category_id: string; title: string; external_source?: string | null; external_id?: string | null }[];
	recommendations: { item_id: string; recommender_id: string }[];
}

export interface Limits {
	/** Items, people and recommendations each. */
	rows: number;
	categories: number;
}

type Row = { id: string } & Record<string, unknown>;
export interface ImportRows {
	category: Row[];
	recommender: Row[];
	item: Row[];
	recommendation: Row[];
}

export interface ImportPlan {
	/** New rows to write, with fresh ids and references pointing at this account's rows. */
	rows: ImportRows;
	/** How much of the file you already had. */
	alreadyHere: { items: number; people: number };
	/** Why nothing should be written, when the import would go past a limit. */
	overLimit: string | null;
}

const key = (s: string) => s.trim().toLowerCase();

export function planImport(backup: Backup, existing: Existing, limits: Limits, newId: () => string): ImportPlan {
	const rows: ImportRows = { category: [], recommender: [], item: [], recommendation: [] };
	const alreadyHere = { items: 0, people: 0 };

	// Your own types, by name; a custom type named like a built-in one becomes the built-in one.
	const seedIds = new Set(SEED_CATEGORIES.map((c) => c.id));
	const categoryByName = new Map([
		...existing.categories.map((c) => [key(c.name), c.id] as const),
		...SEED_CATEGORIES.map((c) => [key(c.name), c.id] as const)
	]);
	const categoryIds = new Map<string, string>();
	for (const c of backup.categories) {
		let id = categoryByName.get(key(c.name));
		if (!id) {
			id = newId();
			categoryByName.set(key(c.name), id);
			rows.category.push({ ...c, id });
		}
		categoryIds.set(c.id, id);
	}
	const categoryFor = (id: string) => (seedIds.has(id) ? id : (categoryIds.get(id) ?? 'cat-other'));

	const hadPerson = new Set(existing.people.map((p) => p.id));
	const personByName = new Map(existing.people.map((p) => [key(p.name), p.id]));
	const personIds = new Map<string, string>();
	for (const p of backup.people) {
		let id = personByName.get(key(p.name));
		if (!id) {
			id = newId();
			personByName.set(key(p.name), id);
			rows.recommender.push({ ...p, id });
		} else if (hadPerson.has(id)) {
			alreadyHere.people++;
		}
		personIds.set(p.id, id);
	}

	// The same movie, show or book (by its TMDB / Open Library id) is one item whatever
	// it's called; otherwise items match by title and type, but a title never joins an
	// item linked to something else (Dune 1984 vs Dune 2021).
	const hadItem = new Set(existing.items.map((i) => i.id));
	const ext = (i: { external_source?: string | null; external_id?: string | null }) =>
		i.external_id && i.external_source && i.external_source !== 'NONE' ? `${i.external_source}|${i.external_id}` : null;
	const itemByExt = new Map<string, string>();
	const itemByTitle = new Map<string, { id: string; linked: boolean }>();
	const remember = (i: { id: string; category_id: string; title: string; external_source?: string | null; external_id?: string | null }) => {
		const e = ext(i);
		if (e && !itemByExt.has(e)) itemByExt.set(e, i.id);
		const t = `${i.category_id}|${key(i.title)}`;
		if (!itemByTitle.has(t)) itemByTitle.set(t, { id: i.id, linked: !!e });
	};
	existing.items.forEach(remember);
	const itemIds = new Map<string, string>();
	for (const i of backup.items) {
		const category_id = categoryFor(i.category_id);
		const e = ext(i);
		const byTitle = itemByTitle.get(`${category_id}|${key(i.title)}`);
		let id = (e && itemByExt.get(e)) || (byTitle && !(e && byTitle.linked) ? byTitle.id : undefined);
		if (!id) {
			id = newId();
			const row = { ...i, id, category_id };
			remember(row);
			rows.item.push(row);
		} else if (hadItem.has(id)) {
			alreadyHere.items++;
		}
		itemIds.set(i.id, id);
	}

	const recKeys = new Set(existing.recommendations.map((r) => `${r.item_id}|${r.recommender_id}`));
	for (const r of backup.recommendations) {
		const item_id = itemIds.get(r.item_id);
		const recommender_id = personIds.get(r.recommender_id);
		if (!item_id || !recommender_id || recKeys.has(`${item_id}|${recommender_id}`)) continue;
		recKeys.add(`${item_id}|${recommender_id}`);
		rows.recommendation.push({ ...r, id: newId(), item_id, recommender_id });
	}

	const checks: [string, number, number, number][] = [
		['items', existing.items.length, rows.item.length, limits.rows],
		['people', existing.people.length, rows.recommender.length, limits.rows],
		['recommendations', existing.recommendations.length, rows.recommendation.length, limits.rows],
		['types', existing.categories.length, rows.category.length, limits.categories]
	];
	const over = checks.find(([, have, adding, limit]) => adding > 0 && have + adding > limit);
	const overLimit = over
		? `That would make ${over[1] + over[2]} ${over[0]}, over the limit of ${over[3]}. You have ${over[1]} and the file adds ${over[2]}.`
		: null;

	return { rows, alreadyHere, overLimit };
}

/**
 * The rows in write order (types, then people, items, recommendations, so every
 * reference is written before what points at it), split into transactions small
 * enough to upload as one request.
 */
export function importBatches(rows: ImportRows, size = MAX_OPS_PER_BATCH - 100) {
	const all = (['category', 'recommender', 'item', 'recommendation'] as const).flatMap((table) => rows[table].map((row) => ({ table, row })));
	const out: (typeof all)[] = [];
	for (let k = 0; k < all.length; k += size) out.push(all.slice(k, k + size));
	return out;
}

const STATUS: Record<ItemStatus, string> = { TO_TRY: 'Put List', TRIED: 'Tried', DISMISSED: 'Dismissed' };
const HYPE = ['', 'might like', 'you should', 'you MUST'];

/** A cell, quoted when needed, and never read as a formula by a spreadsheet. */
function cell(v: string | number | null | undefined): string {
	let s = v == null ? '' : String(v);
	if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
	return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One row per item, for reading in a spreadsheet. Only the JSON backup can be imported. */
export function toCsv(b: Backup): string {
	const typeName = new Map([...SEED_CATEGORIES, ...b.categories].map((c) => [c.id, c.name]));
	const personName = new Map(b.people.map((p) => [p.id, p.name]));
	const recsByItem = new Map<string, Backup['recommendations']>();
	for (const r of b.recommendations) recsByItem.set(r.item_id, [...(recsByItem.get(r.item_id) ?? []), r]);
	const header = ['Title', 'Type', 'Status', 'Rating', 'Recommended by', 'What they said', 'Your review', 'Year', 'Creator', 'Added', 'Tried'];
	const lines = [header.join(',')];
	for (const i of b.items) {
		const recs = (recsByItem.get(i.id) ?? []).map((r) => ({ ...r, name: personName.get(r.recommender_id) ?? '?' }));
		lines.push(
			[
				i.title,
				typeName.get(i.category_id) ?? '',
				STATUS[i.status],
				i.rating,
				recs.map((r) => (r.enthusiasm ? `${r.name} (${HYPE[r.enthusiasm]})` : r.name)).join('; '),
				recs.filter((r) => r.note).map((r) => `${r.name}: ${r.note}`).join('; '),
				i.review,
				i.year,
				i.creator,
				i.added_at.slice(0, 10),
				i.tried_at?.slice(0, 10)
			]
				.map(cell)
				.join(',')
		);
	}
	// The byte-order mark makes Excel read the file as UTF-8.
	return '﻿' + lines.join('\r\n') + '\r\n';
}
