// Title lookup in Quick Add and on an item, with TMDB stood in for: our API's
// /api/lookup answers are faked in the browser, so the test needs no TMDB token
// and never calls TMDB. Saving, de-duplicating and syncing the details are real.

import { expect, test, type BrowserContext } from '@playwright/test';
import { onList, openDevice, quickAdd, setWho, uniqueEmail } from './helpers';

const FILMS = [
	{ source: 'TMDB_MOVIE', id: '693134', title: 'Dune: Part Two', year: 2024, creator: null, imageUrl: 'https://image.tmdb.org/t/p/w185/dune2.jpg' },
	{ source: 'TMDB_MOVIE', id: '438631', title: 'Dune', year: 2021, creator: null, imageUrl: null },
	{ source: 'TMDB_MOVIE', id: '329865', title: 'Arrival', year: 2016, creator: null, imageUrl: null }
];
const DIRECTORS: Record<string, string> = { '693134': 'Denis Villeneuve', '329865': 'Denis Villeneuve' };
// A 1×1 PNG, standing in for posters.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function fakeTmdb(context: BrowserContext) {
	// Lookup is on, as it is once the TMDB token is set.
	await context.route('**/api/public/config', async (route) => {
		const config = await (await route.fetch()).json();
		await route.fulfill({ json: { ...config, lookup: { movie: true, tv: true, book: true } } });
	});
	await context.route('**/api/lookup?*', (route) => {
		const q = new URL(route.request().url()).searchParams.get('q')!.toLowerCase().replace(/[^a-z]/g, '');
		const results = FILMS.filter((f) => f.title.toLowerCase().replace(/[^a-z]/g, '').startsWith(q.slice(0, 2)));
		return route.fulfill({ json: { results } });
	});
	await context.route('**/api/lookup/details?*', (route) => {
		const id = new URL(route.request().url()).searchParams.get('id')!;
		return route.fulfill({ json: { creator: DIRECTORS[id] ?? null } });
	});
	await context.route('https://image.tmdb.org/**', (route) => route.fulfill({ body: PNG, contentType: 'image/png' }));
}

test('pick the real title in Quick Add, add to it again, and link an item typed by hand', async ({ browser }) => {
	const email = uniqueEmail('lookup');
	const phone = await browser.newContext();
	await fakeTmdb(phone);
	const page = await openDevice(phone, email);

	// "dune" → pick Dune: Part Two; the director arrives after saving.
	await page.getByTitle('Add (n)').click();
	await page.getByPlaceholder('Piranesi, Severance').fill('dune');
	await page.getByRole('button', { name: /^Dune: Part Two\s+2024/ }).click();
	await expect(page.getByText('✓ Dune: Part Two · 2024')).toBeVisible();
	await setWho(page, 'Sam');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByText('Added “Dune: Part Two”')).toBeVisible();
	await expect(onList(page, 'Dune: Part Two').locator('xpath=../..').locator('img.poster')).toBeVisible();

	// Typed differently, matched to the same film: it's the same item, now from Jo too.
	await page.getByTitle('Add (n)').click();
	await page.getByPlaceholder('Piranesi, Severance').fill('dune pt 2');
	await page.getByRole('button', { name: /^Dune: Part Two\s+2024/ }).click();
	await setWho(page, 'Jo');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByText('Jo also recommended this ✓')).toBeVisible();
	await expect(onList(page, 'Dune: Part Two')).toHaveCount(1);

	await onList(page, 'Dune: Part Two').click();
	await expect(page.locator('.made')).toHaveText('2024 · Denis Villeneuve');

	// Typed by hand with a typo, then linked from the item page: the title is fixed.
	await page.getByRole('link', { name: 'Put List' }).click();
	await quickAdd(page, 'Arival', 'Riley');
	await onList(page, 'Arival').click();
	await page.getByRole('button', { name: 'Find a match' }).click();
	await page.getByRole('button', { name: /^Arrival\s+2016/ }).click();
	await expect(page.getByRole('heading', { name: 'Arrival' })).toBeVisible();
	await expect(page.locator('.made')).toHaveText('2016 · Denis Villeneuve');

	// Another device gets the details through sync (the server accepted them).
	const laptop = await browser.newContext();
	const laptopPage = await openDevice(laptop, email);
	await onList(laptopPage, 'Arrival').click();
	await expect(laptopPage.locator('.made')).toHaveText('2016 · Denis Villeneuve');

	await phone.close();
	await laptop.close();
});
