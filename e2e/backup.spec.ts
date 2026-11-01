// Backups: download everything from one account, import it into another that
// already has some of it, and check nothing is duplicated and it all syncs.

import { expect, test, type Page } from '@playwright/test';
import { onList, openDevice, quickAdd, uniqueEmail } from './helpers';

async function download(page: Page, button: string) {
	await page.getByRole('link', { name: 'Account' }).click();
	const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: button }).click()]);
	return file;
}

test('export a backup from one account and import it into another', async ({ browser }) => {
	const from = await browser.newContext();
	const fromPage = await openDevice(from, uniqueEmail('export'));
	await quickAdd(fromPage, 'Dune', 'Sam');
	await quickAdd(fromPage, 'Rioja', 'Jo');

	const backup = await download(fromPage, 'Download backup');
	expect(backup.suggestedFilename()).toMatch(/^recommendship-\d{4}-\d{2}-\d{2}\.json$/);
	const backupPath = await backup.path();
	const sheet = await download(fromPage, 'Download spreadsheet');
	expect(sheet.suggestedFilename()).toMatch(/\.csv$/);

	// The other account already has Dune, from someone else.
	const email = uniqueEmail('import');
	const to = await browser.newContext();
	const page = await openDevice(to, email);
	page.on('dialog', (d) => void d.accept());
	await quickAdd(page, 'Dune', 'Alex');

	await page.getByRole('link', { name: 'Account' }).click();
	await page.getByLabel('Backup file to import').setInputFiles(backupPath);
	await expect(page.getByText('Imported 1 item, 2 people, 2 recommendations')).toBeVisible();

	// Importing again adds nothing.
	await page.getByLabel('Backup file to import').setInputFiles(backupPath);
	await expect(page.getByText('Nothing new in that backup')).toBeVisible();

	// One Dune, now from Alex and Sam; Rioja is new. A second device sees the same.
	const laptop = await browser.newContext();
	const laptopPage = await openDevice(laptop, email);
	for (const p of [page, laptopPage]) {
		await p.getByRole('link', { name: 'Put List' }).click();
		await expect(onList(p, 'Dune')).toHaveCount(1);
		await expect(p.locator('.row', { hasText: 'Dune' })).toContainText(/Alex & Sam|Sam & Alex/);
		await expect(onList(p, 'Rioja')).toBeVisible();
	}

	await from.close();
	await to.close();
	await laptop.close();
});
