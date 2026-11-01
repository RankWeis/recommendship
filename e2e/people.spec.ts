// Fixing up people: merge a typo into the right person, delete someone, and
// check another device ends up with the same result (so the server accepted it).

import { expect, test, type Page } from '@playwright/test';
import { onList, openDevice, quickAdd, setWho, uniqueEmail } from './helpers';

const openPerson = async (page: Page, name: string) => {
	await page.getByRole('link', { name: 'People' }).click();
	await page.locator('.name', { hasText: new RegExp(`^${name}$`) }).click();
	await expect(page.getByRole('heading', { name })).toBeVisible();
};
const peopleNames = async (page: Page) => {
	await page.getByRole('link', { name: 'People' }).click();
	return page.locator('.name');
};

test('merge a mistyped person into the right one, and delete a person', async ({ browser }) => {
	const email = uniqueEmail('people');
	const phone = await browser.newContext();
	const page = await openDevice(phone, email);
	page.on('dialog', (d) => void d.accept());

	await quickAdd(page, 'Past Lives', 'Sam');
	await quickAdd(page, 'Aftersun', 'Sma');
	// Sma also "recommended" Past Lives: attached to the same item, so the merge has a duplicate to fold.
	await page.getByTitle('Add (n)').click();
	await page.getByPlaceholder('Piranesi, Severance').fill('Past Lives');
	await setWho(page, 'Sma');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByText('Sma also recommended this ✓')).toBeVisible();
	await quickAdd(page, 'Piranesi', 'Jo');

	// Merge Sma into Sam.
	await openPerson(page, 'Sma');
	await page.getByRole('button', { name: 'Merge', exact: true }).click();
	await page.getByLabel('Merge Sma into').fill('Sa');
	await page.getByRole('option', { name: 'Sam', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Sam' })).toBeVisible();
	await expect(page.locator('main .title', { hasText: 'Aftersun' })).toBeVisible();
	await expect(page.locator('main .title', { hasText: 'Past Lives' })).toHaveCount(1);

	// Delete Jo; Piranesi stays on the Put List.
	await openPerson(page, 'Jo');
	await page.getByRole('button', { name: 'Delete' }).click();
	await expect(page.getByText('Deleted Jo')).toBeVisible();
	await expect(await peopleNames(page)).toHaveText(['Sam']);
	await page.getByRole('link', { name: 'Put List' }).click();
	await expect(onList(page, 'Piranesi')).toBeVisible();
	await expect(page.locator('.row', { hasText: 'Piranesi' })).toContainText('no recommender');

	// Another device gets the same result from the server.
	const laptop = await browser.newContext();
	const laptopPage = await openDevice(laptop, email);
	await expect(onList(laptopPage, 'Piranesi')).toBeVisible();
	await expect(await peopleNames(laptopPage)).toHaveText(['Sam']);
	await openPerson(laptopPage, 'Sam');
	await expect(laptopPage.locator('main .title', { hasText: 'Aftersun' })).toBeVisible();

	await phone.close();
	await laptop.close();
});
