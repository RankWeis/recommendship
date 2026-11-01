#!/usr/bin/env node
// Writes the sample backups in samples/backups (see the README there): a small,
// realistic friend group to play with, plus files for trying Account → Your data →
// Import a backup with lots of rows, very few, odd text, duplicates and broken files.
//
//   node scripts/sample-backups.mjs [out-dir]     (default: samples/backups)
//
// File names carry what each one adds to an empty account, worked out from the data,
// so they can't drift. Output is deterministic (seeded), so the same files come out
// every run.

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'samples/backups';
mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) if (f.endsWith('.json')) rmSync(join(out, f));

// Small seeded PRNG (mulberry32), so every run writes the same files.
let seed = 42;
const rand = () => {
	seed |= 0;
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(rand() * list.length)];
const chance = (p) => rand() < p;
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-01T12:00:00.000Z');
const daysAgo = (d) => new Date(NOW - d * DAY - int(0, DAY - 1)).toISOString();
const halfStep = () => int(2, 10) / 2;

const SEED_CATS = ['cat-movie', 'cat-tv', 'cat-book', 'cat-restaurant', 'cat-podcast', 'cat-music', 'cat-game', 'cat-other'];
const CHANNELS = ['IN_PERSON', 'TEXT', 'PODCAST', 'SOCIAL', 'OTHER'];

let n = 0;
const id = (prefix) => `${prefix}-${(++n).toString(36).padStart(5, '0')}`;

function backup({ categories = [], people = [], items = [], recommendations = [] }) {
	return { format: 'recommendship-backup', version: 1, exported_at: new Date(NOW).toISOString(), categories, people, items, recommendations };
}

function person(name, extra = {}) {
	return { id: id('p'), name, notes: null, created_at: daysAgo(int(30, 900)), ...extra };
}

function item(title, category_id, extra = {}) {
	const added = int(0, 700);
	const status = extra.status ?? pick(['TO_TRY', 'TO_TRY', 'TO_TRY', 'TRIED', 'TRIED', 'DISMISSED']);
	const tried = status === 'TRIED' ? daysAgo(int(0, added)) : null;
	const rating = status === 'TRIED' ? halfStep() : null;
	return {
		id: id('i'),
		category_id,
		title,
		status,
		rating,
		rated_at: rating == null ? null : tried,
		review: null,
		added_at: daysAgo(added),
		tried_at: tried,
		...extra
	};
}

function rec(itemRow, personRow, extra = {}) {
	return {
		id: id('r'),
		item_id: itemRow.id,
		recommender_id: personRow.id,
		received_at: itemRow.added_at,
		channel: chance(0.5) ? pick(CHANNELS) : null,
		enthusiasm: chance(0.6) ? int(1, 3) : null,
		note: null,
		...extra
	};
}

const plural = (n, one, many = `${one}s`) => `${n}-${n === 1 ? one : many}`;
/** "12-items-3-people", from what's in the file. */
const contents = (b) => `${plural(b.items.length, 'item')}-${plural(b.people.length, 'person', 'people')}`;

const files = {};

// 1. The one to play with: a friend group whose picks have track records you can see.
//    Alice's movies always land; Ben's restaurants are great and his TV isn't; Chris is
//    solid on books; Dana is middling; Fran is all over the place; Eli is new, with
//    nothing tried yet. The Put List then ranks their next picks accordingly.
{
	const friends = Object.fromEntries(['Alice', 'Ben', 'Chris', 'Dana', 'Eli', 'Fran'].map((nm) => [nm, person(nm)]));
	const items = [];
	const recommendations = [];
	/** [title, type, year, creator, rating (null = still on the Put List), who, hype, note] */
	const rows = [
		['Arrival', 'cat-movie', 2016, 'Denis Villeneuve', 5, ['Alice'], 3, 'Bring tissues'],
		['Parasite', 'cat-movie', 2019, 'Bong Joon Ho', 5, ['Alice'], 3],
		['Past Lives', 'cat-movie', 2023, 'Celine Song', 4.5, ['Alice'], 2],
		['The Grand Budapest Hotel', 'cat-movie', 2014, 'Wes Anderson', 4.5, ['Alice'], 2],
		['Mad Max: Fury Road', 'cat-movie', 2015, 'George Miller', 5, ['Alice'], 3],
		['Perfect Days', 'cat-movie', 2023, 'Wim Wenders', null, ['Alice'], 2],
		['Aftersun', 'cat-movie', 2022, 'Charlotte Wells', null, ['Alice'], 3, 'Watch it alone'],
		['The Zone of Interest', 'cat-movie', 2023, 'Jonathan Glazer', null, ['Alice'], 1],
		['Dune: Part Two', 'cat-movie', 2024, 'Denis Villeneuve', null, ['Alice', 'Fran'], 3, 'See it on the biggest screen you can'],
		['The dumpling place on Main St', 'cat-restaurant', null, null, 5, ['Ben'], 3, 'Get the pork and chive'],
		['Corner Thai', 'cat-restaurant', null, null, 4.5, ['Ben'], 2],
		["Nonna's Trattoria", 'cat-restaurant', null, null, 5, ['Ben'], 3],
		['Smoke & Salt BBQ', 'cat-restaurant', null, null, 4, ['Ben'], 2, 'Go hungry'],
		['The new ramen bar', 'cat-restaurant', null, null, null, ['Ben'], 3],
		["Lucia's Bakery", 'cat-restaurant', null, null, null, ['Ben'], 2, 'Morning buns sell out by 10'],
		['Emily in Paris', 'cat-tv', 2020, 'Darren Star', 2, ['Ben'], 3],
		['Love Is Blind', 'cat-tv', 2020, null, 1.5, ['Ben'], 3, "Trust me, you'll be hooked"],
		['The Big Bang Theory', 'cat-tv', 2007, 'Chuck Lorre', 2.5, ['Ben'], 2],
		['Selling Sunset', 'cat-tv', 2019, null, null, ['Ben'], 3],
		['The Bear', 'cat-tv', 2022, 'Christopher Storer', null, ['Ben', 'Eli'], 3],
		['Piranesi', 'cat-book', 2020, 'Susanna Clarke', 4.5, ['Chris'], 3, 'Read it in one sitting'],
		['Project Hail Mary', 'cat-book', 2021, 'Andy Weir', 4, ['Chris'], 2],
		['The Remains of the Day', 'cat-book', 1989, 'Kazuo Ishiguro', 4, ['Chris'], 2],
		['Klara and the Sun', 'cat-book', 2021, 'Kazuo Ishiguro', 3.5, ['Chris'], 1],
		['Tomorrow, and Tomorrow, and Tomorrow', 'cat-book', 2022, 'Gabrielle Zevin', null, ['Chris'], 3],
		['The Overstory', 'cat-book', 2018, 'Richard Powers', null, ['Chris'], 2],
		['Serial', 'cat-podcast', 2014, null, 3.5, ['Dana'], 2],
		['Hardcore History', 'cat-podcast', null, 'Dan Carlin', 3, ['Dana'], 2, 'The episodes are 5 hours long'],
		['Radiolab', 'cat-podcast', null, null, 3, ['Dana'], 1],
		['Severance', 'cat-tv', 2022, 'Dan Erickson', 3.5, ['Dana'], 2],
		['99% Invisible', 'cat-podcast', null, 'Roman Mars', null, ['Dana'], 2],
		['Slow Horses', 'cat-tv', 2022, null, null, ['Dana'], 2],
		['Hades', 'cat-game', 2020, 'Supergiant Games', 5, ['Fran'], 3],
		['Cats', 'cat-movie', 2019, 'Tom Hooper', 1.5, ['Fran'], 3, 'So bad it’s good?'],
		['Dune', 'cat-movie', 2021, 'Denis Villeneuve', 4.5, ['Fran'], 2],
		['The Room', 'cat-movie', 2003, 'Tommy Wiseau', 1, ['Fran'], 3],
		['Stardew Valley', 'cat-game', 2016, 'ConcernedApe', 4.5, ['Fran'], 2],
		["Baldur's Gate 3", 'cat-game', 2023, 'Larian Studios', null, ['Fran'], 3],
		['Outer Wilds', 'cat-game', 2019, 'Mobius Digital', null, ['Fran'], 2, 'Go in knowing nothing'],
		['Shōgun', 'cat-tv', 2024, null, null, ['Eli'], 2],
		['Babel', 'cat-book', 2022, 'R. F. Kuang', null, ['Eli'], 1]
	];
	for (const [title, cat, year, creator, rating, who, hype, note] of rows) {
		const extra = rating == null ? { status: 'TO_TRY' } : { status: 'TRIED', rating };
		const it = item(title, cat, { year, creator, ...extra });
		items.push(it);
		who.forEach((nm, k) => recommendations.push(rec(it, friends[nm], { enthusiasm: hype, note: k === 0 ? (note ?? null) : null })));
	}
	const b = backup({ people: Object.values(friends), items, recommendations });
	files[`01-demo-friend-group-${contents(b)}.json`] = b;
}

// 2. Nothing at all: import should say there's nothing new.
files['02-empty-0-items.json'] = backup({});

// 3. The smallest real list: one thing, one person.
{
	const sam = person('Sam');
	const piranesi = item('Piranesi', 'cat-book', { status: 'TO_TRY', year: 2020, creator: 'Susanna Clarke' });
	const b = backup({ people: [sam], items: [piranesi], recommendations: [rec(piranesi, sam, { enthusiasm: 3, note: 'Read it in one sitting' })] });
	files[`03-tiny-${contents(b)}.json`] = b;
}

// 4. A heavy user: 2,000 items, 250 people, ~3,000 recommendations, every type and
//    status. Takes several upload batches and a few minutes to finish syncing.
{
	const first = ['Sam', 'Jo', 'Alex', 'Riley', 'Pat', 'Morgan', 'Jamie', 'Casey', 'Taylor', 'Jordan', 'Avery', 'Quinn', 'Rowan', 'Sage', 'Drew', 'Kai', 'Noor', 'Ines', 'Mateo', 'Yuki', 'Priya', 'Femi', 'Lena', 'Omar', 'Zoe'];
	const last = ['', ' B.', ' from work', ' (book club)', ' K', ' M.', ' at the gym', ' (cousin)', ' P.', ' R.'];
	const names = new Set();
	while (names.size < 250) names.add(`${pick(first)}${pick(last)}`.trim() + (names.size >= 240 ? ` ${names.size}` : ''));
	const people = [...names].map((nm) => person(nm));
	const words = ['Night', 'River', 'Glass', 'Summer', 'Echo', 'Paper', 'Iron', 'Garden', 'Silent', 'Golden', 'Last', 'Hidden', 'Northern', 'Little', 'Wild', 'Broken', 'Blue', 'Electric', 'Salt', 'Velvet'];
	const nouns = ['House', 'Kingdom', 'Letters', 'Machine', 'Season', 'Harbor', 'Atlas', 'Promise', 'Orchard', 'Station', 'Empire', 'Moon', 'Diaries', 'Engine', 'Archive', 'Forest', 'Hour', 'Signal', 'Table', 'Bridge'];
	const items = [];
	const titles = new Set();
	while (items.length < 2000) {
		const t = `${pick(['The ', '', '', 'A '])}${pick(words)} ${pick(nouns)}${chance(0.15) ? ` ${int(2, 4)}` : ''}${chance(0.08) ? `: ${pick(words)} ${pick(nouns)}` : ''}`;
		const cat = pick(SEED_CATS);
		if (titles.has(`${cat}|${t.toLowerCase()}`)) continue;
		titles.add(`${cat}|${t.toLowerCase()}`);
		items.push(item(t, cat, chance(0.3) ? { year: int(1950, 2026) } : {}));
	}
	const recommendations = [];
	for (const it of items) {
		const who = new Set();
		const count = chance(0.08) ? int(3, 6) : chance(0.35) ? 2 : 1;
		while (who.size < count) who.add(pick(people));
		for (const p of who) recommendations.push(rec(it, p, chance(0.15) ? { note: pick(['trust me', 'the ending!', 'go hungry', 'skip ep 1', 'on Netflix']) } : {}));
	}
	const b = backup({ people, items, recommendations });
	files[`04-heavy-user-${contents(b)}.json`] = b;
}

// 5. Text that breaks layouts and spreadsheets: emoji, right-to-left, CJK, accents,
//    the longest allowed title and note, quotes and commas, newlines, formula-looking
//    and HTML-looking text, names with spaces around them. Plus a broken poster URL.
{
	const people = [
		person('Zoë'),
		person("Seán O'Brien-Ní Mhaoláin"),
		person('👩‍🍳 Chef Mo'),
		person('محمد'),
		person('אבי'),
		person('李小龙'),
		person('   Padded Name   '),
		person('A'.repeat(120)),
		person('<b>Not bold</b>'),
		person('=HYPERLINK("http://example.com","click")')
	];
	const long = 'An Extraordinarily Long Title That Keeps Going '.repeat(7).slice(0, 300).trim();
	const items = [
		item('Amélie', 'cat-movie', { status: 'TRIED', rating: 4.5, review: 'Charming, "whimsical", and — honestly — perfect.\nSecond line of the review.' }),
		item('千と千尋の神隠し', 'cat-movie', { year: 2001, creator: '宮崎駿' }),
		item('مئة عام من العزلة', 'cat-book'),
		item('🍜 Ramen Nagi', 'cat-restaurant'),
		item(long, 'cat-book'),
		item('=1+1', 'cat-other'),
		item('@SUM(A1:A9)', 'cat-other'),
		item('<script>alert("hi")</script>', 'cat-other'),
		item('Title, with, commas', 'cat-tv'),
		item('   Spaces around   ', 'cat-podcast'),
		item('Ünïcödé Çàfé', 'cat-restaurant'),
		item('Poster that 404s', 'cat-movie', { image_url: 'https://image.tmdb.org/t/p/w185/does-not-exist.jpg', external_source: 'TMDB_MOVIE', external_id: '999999999', year: 2099 }),
		item('Rated the lowest', 'cat-game', { status: 'TRIED', rating: 1 }),
		item('Rated the highest', 'cat-game', { status: 'TRIED', rating: 5 }),
		item('Tried but never rated', 'cat-music', { status: 'TRIED', rating: null, rated_at: null }),
		item('Dismissed after rating', 'cat-music', { status: 'DISMISSED', rating: 2.5, rated_at: daysAgo(3) }),
		item('Added in 1999', 'cat-book', { added_at: '1999-12-31T23:59:00.000Z' }),
		item('Added in the future', 'cat-book', { added_at: '2030-01-01T00:00:00.000Z' })
	];
	const recommendations = items.map((it, k) =>
		rec(it, people[k % people.length], {
			note: k === 4 ? 'N'.repeat(2000) : k === 0 ? 'Quote: "see it", comma, and a\nnewline' : null,
			enthusiasm: (k % 4) || null
		})
	);
	const b = backup({ people, items, recommendations });
	files[`05-odd-text-${contents(b)}.json`] = b;
}

// 6. Duplicates and matching: people differing only by case or spaces, the same
//    title twice, a custom type named like a built-in one, your own types, an item in
//    a type the file doesn't define, a person nobody recommended anything with, and
//    recommendations pointing at things that aren't in the file.
{
	const people = [person('Sam'), person('sam'), person(' SAM '), person('Jo'), person('Nobody Recommended Anything')];
	const categories = [
		{ id: 'c-wine', name: 'Wine', icon: '🍷', external_source: 'NONE', sort_order: 100 },
		{ id: 'c-movie-again', name: 'movie', icon: '🎞️', external_source: 'NONE', sort_order: 100 },
		{ id: 'c-board', name: 'Board games', icon: '🎲', external_source: 'NONE', sort_order: 110 }
	];
	const items = [
		item('Severance', 'cat-tv', { status: 'TO_TRY' }),
		item('severance', 'cat-tv', { status: 'TO_TRY' }),
		item('Severance', 'cat-book', { status: 'TO_TRY' }),
		item('Barolo 2016', 'c-wine'),
		item('Heat', 'c-movie-again'),
		item('Wingspan', 'c-board'),
		item('Lost in a type the file never defined', 'c-missing'),
		item('Dune', 'cat-movie', { external_source: 'TMDB_MOVIE', external_id: '438631', year: 2021 }),
		item('Dune (typed differently)', 'cat-movie', { external_source: 'TMDB_MOVIE', external_id: '438631', year: 2021 })
	];
	const [sam, samLower, samShout, jo] = people;
	const recommendations = [
		rec(items[0], sam),
		rec(items[0], samLower),
		rec(items[1], samShout),
		rec(items[2], jo),
		rec(items[3], jo),
		rec(items[4], sam),
		rec(items[5], jo),
		rec(items[6], sam),
		rec(items[7], sam),
		rec(items[8], jo),
		{ ...rec(items[0], jo), item_id: 'i-not-in-file' },
		{ ...rec(items[0], jo), recommender_id: 'p-not-in-file' }
	];
	// Into an empty account, the lookalikes merge: Severance/severance and the two Dunes
	// become one item each, and Sam/sam/SAM one person (checked by scripts/check-sample-backups.ts).
	files['06-duplicates-adds-7-items-3-people.json'] = backup({ categories, people, items, recommendations });
}

// 7. One past the limit: 10,001 items. Import should refuse it up front and write nothing.
{
	const p = person('Bulk');
	const items = Array.from({ length: 10_001 }, (_, k) => ({
		id: `bulk-${k}`,
		category_id: 'cat-other',
		title: `Bulk item ${k + 1}`,
		status: 'TO_TRY',
		added_at: daysAgo(k % 365)
	}));
	files['07-too-big-10001-items-refused.json'] = backup({ people: [p], items });
}

// 8–10. Files import should reject with a clear message.
{
	const bad = backup({ items: [item('Rated 4.3', 'cat-movie', { status: 'TRIED', rating: 4.3 })] });
	files['08-broken-bad-rating-refused.json'] = bad;
	files['09-broken-newer-version-refused.json'] = { ...backup({}), version: 2 };
	files['10-broken-not-a-backup-refused.json'] = { hello: 'this is some other JSON file' };
}

for (const [name, body] of Object.entries(files)) {
	// The big ones are written compactly to keep the repo small.
	const text = JSON.stringify(body, null, body.items?.length > 1000 ? undefined : '\t');
	writeFileSync(join(out, name), text);
	const counts = body.items ? `${body.items.length} items, ${body.people.length} people, ${body.recommendations.length} recommendations` : 'not a backup';
	console.log(`${name.padEnd(36)} ${(text.length / 1024).toFixed(0).padStart(6)} KB  ${counts}`);
}
