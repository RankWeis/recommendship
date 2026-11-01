// Deleting your account: it only goes ahead once DELETE is typed, it takes everything
// with it, and the same sign-in afterwards starts a fresh, empty account.

import { expect, test } from '@playwright/test';
import { onList, openDevice, quickAdd, signIn, uniqueEmail } from './helpers';

test('delete your account after typing DELETE', async ({ browser }) => {
	const email = uniqueEmail('delete');
	const page = await openDevice(await browser.newContext(), email);
	await quickAdd(page, 'Arrival', 'Sam');
	await page.goto('/account');
	await expect(page.getByText('Synced')).toBeVisible();

	await page.getByRole('button', { name: 'Delete account…' }).click();
	const sheet = page.getByRole('dialog', { name: 'Delete your account' });
	await expect(sheet).toContainText('This is irreversible.');
	const go = sheet.getByRole('button', { name: 'Delete my account' });
	const typed = sheet.getByLabel('To continue, type DELETE');
	await expect(go).toBeDisabled();
	await typed.fill('delete');
	await expect(go).toBeDisabled();

	// Cancelling leaves everything as it was.
	await sheet.getByRole('button', { name: 'Cancel' }).click();
	await expect(sheet).toHaveCount(0);
	await expect(page.getByText(email)).toBeVisible();

	await page.getByRole('button', { name: 'Delete account…' }).click();
	await typed.fill('DELETE');
	await go.click();
	await expect(page.getByText('Your account and everything in it were deleted')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Sign in or create account' })).toBeVisible();
	await page.getByRole('link', { name: 'Put List' }).click();
	await expect(onList(page, 'Arrival')).toHaveCount(0);

	// Signing in again on a new device makes a new, empty account.
	const fresh = await (await browser.newContext()).newPage();
	await signIn(fresh, email);
	await fresh.getByRole('link', { name: 'Put List' }).click();
	await expect(onList(fresh, 'Arrival')).toHaveCount(0);
});
