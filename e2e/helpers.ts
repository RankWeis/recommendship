import { expect, type BrowserContext, type Page } from '@playwright/test';

export const password = 'recommendship-e2e';
export const uniqueEmail = (tag: string) => `e2e-${tag}-${Date.now()}@recommendship.test`;

/** Sign in (creating the account the first time) on the Account page and wait for the first sync. */
export async function signIn(page: Page, email: string) {
	await page.goto('/account');
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Sign in or create account' }).click();
	await expect(page.getByText('Synced')).toBeVisible();
}

/** A "device": a fresh browser context signed in to the account, on the Put List. */
export async function openDevice(context: BrowserContext, email: string): Promise<Page> {
	const page = await context.newPage();
	await signIn(page, email);
	await page.getByRole('link', { name: 'Put List' }).click();
	return page;
}

export async function quickAdd(page: Page, title: string, who: string) {
	await page.getByTitle('Add (n)').click();
	await page.getByPlaceholder('Piranesi, Severance').fill(title);
	await setWho(page, who);
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByText(`Added “${title}”`)).toBeVisible();
}

/** Replace Quick Add's people (the last-used ones are pre-filled as chips) with `who`. */
export async function setWho(page: Page, who: string) {
	const sheet = page.getByRole('dialog');
	while ((await sheet.locator('.picker .x').count()) > 0) await sheet.locator('.picker .x').first().click();
	await sheet.getByLabel('Who recommended it').fill(who);
}

export const onList = (page: Page, title: string) => page.locator('.title', { hasText: title });
