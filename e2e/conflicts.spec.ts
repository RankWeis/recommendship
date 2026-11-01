// Two devices change the same thing: the newest edit wins, even when the older one
// uploads last (the phone was offline when you rated on it).

import { expect, test, type Page } from '@playwright/test';
import { onList, openDevice, quickAdd, uniqueEmail } from './helpers';

async function rate(page: Page, title: string, rating: number) {
	await page.getByRole('link', { name: 'Put List' }).click();
	await page.locator('.row', { hasText: title }).getByRole('button', { name: /Mark .* as tried/ }).click();
	await page.locator('input[type=range]').fill(String(rating));
	await page.getByRole('button', { name: 'Save rating' }).click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
}

const ratingOn = async (page: Page, title: string) => {
	await page.getByRole('link', { name: 'Tried' }).click();
	return page.locator('.row', { hasText: title }).locator('.rated b');
};

test('a rating made later on another device wins over an older offline one', async ({ browser }) => {
	const email = uniqueEmail('conflict');
	const phone = await browser.newContext();
	const phonePage = await openDevice(phone, email);
	await quickAdd(phonePage, 'Past Lives', 'Sam');

	const laptop = await browser.newContext();
	const laptopPage = await openDevice(laptop, email);
	await expect(onList(laptopPage, 'Past Lives')).toBeVisible();

	// 10:00 on the phone, with no signal: rate it 4.
	await phone.setOffline(true);
	await rate(phonePage, 'Past Lives', 4);

	// 10:05 on the laptop, online: change your mind, rate it 3. It uploads first.
	await laptopPage.waitForTimeout(1_500);
	await rate(laptopPage, 'Past Lives', 3);
	await expect(await ratingOn(laptopPage, 'Past Lives')).toHaveText('3.0');

	// The phone reconnects and uploads its older 4: the newer 3 stays, on both devices.
	await phone.setOffline(false);
	await expect(await ratingOn(phonePage, 'Past Lives')).toHaveText('3.0', { timeout: 30_000 });
	await laptopPage.waitForTimeout(2_000);
	await expect(await ratingOn(laptopPage, 'Past Lives')).toHaveText('3.0');

	await phone.close();
	await laptop.close();
});
