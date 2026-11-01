// Signing out wipes this device's copy of the account. It must never take
// changes the server hasn't accepted yet with it: sign-out uploads them first,
// and if it can't, it stays signed in unless you explicitly discard them.

import { expect, test, type Dialog } from '@playwright/test';
import { onList, openDevice, quickAdd, signIn, uniqueEmail } from './helpers';

test('signing out with unsynced changes keeps them until they have uploaded', async ({ browser }) => {
	const email = uniqueEmail('signout');
	const context = await browser.newContext();
	const page = await openDevice(context, email);
	await quickAdd(page, 'Synced before sign-out', 'Sam');

	// Offline, add something that therefore can't upload yet.
	await context.setOffline(true);
	await quickAdd(page, 'Added offline', 'Jo');

	// Try to sign out: confirm the first prompt, then decline to discard.
	const dialogs: string[] = [];
	const answer = (accept: boolean[]) => (d: Dialog) => {
		dialogs.push(d.message());
		void (accept.shift() ? d.accept() : d.dismiss());
	};
	page.on('dialog', answer([true, false]));
	await page.getByRole('link', { name: /Account and sync/ }).click();
	await page.getByRole('button', { name: 'Sign out' }).click();

	await expect.poll(() => dialogs.length).toBe(2);
	expect(dialogs[1]).toMatch(/Some changes on this device can't be uploaded while you're offline/);
	// Still signed in, with the offline change intact.
	await expect(page.getByText(email)).toBeVisible();
	await page.getByRole('link', { name: 'Put List' }).click();
	await expect(onList(page, 'Added offline')).toBeVisible();

	// Back online: sign-out uploads it first, then signs out.
	page.removeAllListeners('dialog');
	await context.setOffline(false);
	page.on('dialog', (d) => void d.accept());
	await page.getByRole('link', { name: /Account and sync/ }).click();
	await page.getByRole('button', { name: 'Sign out' }).click();
	await expect(page.getByRole('button', { name: 'Sign in or create account' })).toBeVisible({ timeout: 20_000 });

	// Signing back in brings both back from the server.
	await signIn(page, email);
	await page.getByRole('link', { name: 'Put List' }).click();
	await expect(onList(page, 'Synced before sign-out')).toBeVisible();
	await expect(onList(page, 'Added offline')).toBeVisible();

	await context.close();
});
