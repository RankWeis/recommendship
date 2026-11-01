// Select and delete: pick a few items, or everything shown, and delete them in one go.
// People left recommending nothing go too, and another device ends up the same.

import { expect, test } from '@playwright/test';
import { onList, openDevice, quickAdd, uniqueEmail } from './helpers';

test('delete a few selected items, then everything shown', async ({ browser }) => {
	const email = uniqueEmail('select');
	const phone = await browser.newContext();
	const page = await openDevice(phone, email);
	page.on('dialog', (d) => void d.accept());
	await quickAdd(page, 'Arrival', 'Sam');
	await quickAdd(page, 'Heat', 'Sam');
	await quickAdd(page, 'Tár', 'Jo');
	await quickAdd(page, 'Barbie', 'Riley');

	// Two of them. Jo recommended only Tár, so Jo goes too; Sam still has Heat.
	await page.getByRole('button', { name: 'Select', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Add a recommendation' })).toHaveCount(0);
	await page.getByRole('checkbox', { name: 'Select “Arrival”' }).check();
	await onList(page, 'Tár').click(); // tapping the row ticks it too
	await expect(page.getByRole('toolbar', { name: 'Selected items' })).toContainText('2 selected');
	await page.getByRole('button', { name: 'Delete', exact: true }).click();
	await expect(page.getByText('Deleted 2 items and 1 person')).toBeVisible();
	await expect(onList(page, 'Arrival')).toHaveCount(0);
	await expect(onList(page, 'Tár')).toHaveCount(0);
	await expect(onList(page, 'Heat')).toBeVisible();

	// Everything that's left.
	await page.getByRole('button', { name: 'Select', exact: true }).click();
	await page.getByRole('button', { name: /^(Select all|All) 2$/ }).click();
	await page.getByRole('button', { name: 'Delete', exact: true }).click();
	await expect(page.getByText('Deleted 2 items and 2 people')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'The Put List is empty' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Add a recommendation' }).first()).toBeVisible();

	// Another device ends up empty too, people included.
	const laptop = await browser.newContext();
	const laptopPage = await openDevice(laptop, email);
	await expect(laptopPage.getByRole('heading', { name: 'The Put List is empty' })).toBeVisible();
	await laptopPage.getByRole('link', { name: 'People' }).click();
	await expect(laptopPage.locator('main')).not.toContainText('Sam');

	await phone.close();
	await laptop.close();
});
