// Two "devices" (separate browser contexts: separate storage and cookies) on
// one account. Proves the core promise of the local-first design: capture works
// with no signal, and it reaches your other devices once you're back online.

import { expect, test } from '@playwright/test';
import { onList, openDevice as open, quickAdd, uniqueEmail } from './helpers';

const email = uniqueEmail('sync');
const openDevice = (context: Parameters<typeof open>[0]) => open(context, email);

test('a recommendation captured offline reaches the other device once back online', async ({ browser }) => {
	// Sign up on the first device (local dev auto-approves) and add something.
	const phone = await browser.newContext();
	const phonePage = await openDevice(phone);
	await quickAdd(phonePage, 'Past Lives', 'Sam');

	// The second device signs in and receives it.
	const laptop = await browser.newContext();
	const laptopPage = await openDevice(laptop);
	await expect(onList(laptopPage, 'Past Lives')).toBeVisible();

	// The phone loses signal mid-conversation and logs a recommendation anyway.
	await phone.setOffline(true);
	await quickAdd(phonePage, 'Piranesi', 'Jo');
	await expect(onList(phonePage, 'Piranesi')).toBeVisible();
	await expect(phonePage.getByRole('link', { name: /Account and sync: Offline/ })).toBeVisible();
	// Nothing has left the phone yet.
	await laptopPage.waitForTimeout(2_000);
	await expect(onList(laptopPage, 'Piranesi')).toHaveCount(0);

	// Signal comes back: it uploads, and the laptop gets it without a reload.
	await phone.setOffline(false);
	await expect(onList(laptopPage, 'Piranesi')).toBeVisible();
	await expect(laptopPage.locator('.row', { hasText: 'Piranesi' })).toContainText('from Jo');

	// Ratings sync the other way too.
	await laptopPage.locator('.row', { hasText: 'Past Lives' }).getByRole('button', { name: /Mark .* as tried/ }).click();
	await laptopPage.getByRole('button', { name: 'Save rating' }).click();
	await phonePage.getByRole('link', { name: 'Tried' }).click();
	await expect(onList(phonePage, 'Past Lives')).toBeVisible();

	await phone.close();
	await laptop.close();
});

test('sync credentials need a session', async ({ request }) => {
	// The invite gate itself is covered by apps/server/test/app.test.ts (locally the API auto-approves).
	expect((await request.get('/api/sync/credentials')).status()).toBe(401);
});
