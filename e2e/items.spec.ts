// Fixing up items: merge a duplicate into the one you keep (recommenders and
// rating carry over), delete an item, and check another device sees the result.

import { expect, test, type Page } from '@playwright/test';
import { onList, openDevice, quickAdd, uniqueEmail } from './helpers';

async function openItem(page: Page, list: 'Put List' | 'Tried', title: string) {
	await page.getByRole('link', { name: list }).click();
	await page.locator('.title', { hasText: new RegExp(`^${title}$`) }).click();
	await expect(page.getByRole('heading', { name: title })).toBeVisible();
}

test('merge a duplicate item into the original, and delete an item', async ({ browser }) => {
	const email = uniqueEmail('items');
	const phone = await browser.newContext();
	const page = await openDevice(phone, email);
	page.on('dialog', (d) => void d.accept());

	await quickAdd(page, 'Severance', 'Sam');
	await quickAdd(page, 'Severence', 'Jo');
	await quickAdd(page, 'Piranesi', 'Jo');
	// Only the duplicate gets rated.
	await page.locator('.row', { hasText: 'Severence' }).getByRole('button', { name: /Mark .* as tried/ }).click();
	await page.locator('input[type=range]').fill('5');
	await page.getByRole('button', { name: 'Save rating' }).click();

	// Merge the typo into the original: the search starts from the first letters.
	await openItem(page, 'Tried', 'Severence');
	await page.getByRole('button', { name: 'Merge' }).click();
	await page.locator('.candidate', { hasText: 'Severance' }).click();
	await expect(page.getByRole('heading', { name: 'Severance' })).toBeVisible();
	await expect(page.locator('.recs')).toContainText('Sam');
	await expect(page.locator('.recs')).toContainText('Jo');
	await expect(page.locator('.rating b').first()).toHaveText('5.0');

	// Delete Piranesi.
	await openItem(page, 'Put List', 'Piranesi');
	await page.getByRole('button', { name: 'Delete' }).click();
	await expect(page.getByText('Deleted “Piranesi”')).toBeVisible();
	await expect(onList(page, 'Piranesi')).toHaveCount(0);

	// Another device sees one Severance (rated 5, both recommenders) and no Piranesi.
	const laptop = await browser.newContext();
	const laptopPage = await openDevice(laptop, email);
	await laptopPage.getByRole('link', { name: 'Tried' }).click();
	await expect(laptopPage.locator('.title', { hasText: 'Severance' })).toHaveCount(1);
	await expect(laptopPage.locator('.row', { hasText: 'Severance' })).toContainText('Sam & Jo');
	await expect(laptopPage.locator('.title', { hasText: 'Severence' })).toHaveCount(0);
	await laptopPage.getByRole('link', { name: 'Put List' }).click();
	await expect(onList(laptopPage, 'Piranesi')).toHaveCount(0);

	await phone.close();
	await laptop.close();
});

test("edit who recommended an item, their hype level and note, synced to another device", async ({ browser }) => {
	const email = uniqueEmail('item-people');
	const phone = await browser.newContext();
	const page = await openDevice(phone, email);
	await quickAdd(page, 'Shōgun', 'Sam');
	await quickAdd(page, 'Dune', 'Jo'); // so Jo already exists to be found by search
	await openItem(page, 'Put List', 'Shōgun');

	// Add Jo (existing, found by search) and Riley (new).
	await page.getByRole('button', { name: '＋ Add person' }).click();
	await page.getByLabel('Add who recommended it').fill('j');
	await page.getByRole('option', { name: 'Jo', exact: true }).click();
	await expect(page.getByText('Added Jo')).toBeVisible();
	await page.getByRole('button', { name: '＋ Add person' }).click();
	await page.getByLabel('Add who recommended it').fill('Riley');
	await page.getByLabel('Add who recommended it').press('Enter');
	await expect(page.locator('.recs')).toContainText('Riley');

	// It was actually Alex, not Sam.
	await page.getByRole('button', { name: 'Change Sam' }).click();
	await page.getByLabel('Who recommended it instead of Sam?').fill('Alex');
	await page.getByLabel('Who recommended it instead of Sam?').press('Enter');
	await expect(page.locator('.recs')).not.toContainText('Sam');

	// Alex was very hyped, and said something.
	await page.getByRole('button', { name: 'Alex: you MUST' }).click();
	const alex = page.locator('.recs li', { hasText: 'Alex' });
	await alex.getByRole('button', { name: 'Note' }).click();
	await page.getByLabel('Note from Alex').fill('Watch it without subtitles');
	await page.getByRole('button', { name: 'Save note' }).click();
	await expect(alex).toContainText('you MUST');
	await expect(alex).toContainText('Watch it without subtitles');

	// The laptop sees the same people, hype and note.
	const laptop = await browser.newContext();
	const laptopPage = await openDevice(laptop, email);
	await openItem(laptopPage, 'Put List', 'Shōgun');
	const recs = laptopPage.locator('.recs');
	await expect(recs).toContainText('Jo');
	await expect(recs).toContainText('Riley');
	await expect(recs).not.toContainText('Sam');
	await expect(laptopPage.locator('.recs li', { hasText: 'Alex' })).toContainText('you MUST');
	await expect(laptopPage.locator('.recs li', { hasText: 'Alex' })).toContainText('Watch it without subtitles');

	await phone.close();
	await laptop.close();
});
