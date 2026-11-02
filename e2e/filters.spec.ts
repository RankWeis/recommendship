// Filtering the Put List by who recommended it and how hyped they were, on top of the
// type tabs. Person and hype apply to the same recommendation: "Sam said you MUST".

import { expect, test, type Page } from '@playwright/test';
import { addButton, onList, openDevice, setWho, uniqueEmail } from './helpers';

async function add(page: Page, title: string, who: string, hype?: '★★★ you MUST' | '★★ you should') {
	await addButton(page).click();
	await page.getByPlaceholder('Piranesi, Severance').fill(title);
	// Hype first: once a name is typed, its suggestions cover the hype button.
	if (hype) {
		await page.getByRole('button', { name: /how hyped/ }).click();
		await page.getByRole('button', { name: hype }).click();
	}
	await setWho(page, who);
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByText(`Added “${title}”`)).toBeVisible();
}

test('filter the Put List by person and by hype', async ({ browser }) => {
	const context = await browser.newContext();
	const page = await openDevice(context, uniqueEmail('filters'));
	await add(page, 'Arrival', 'Sam', '★★★ you MUST');
	await add(page, 'Heat', 'Sam');
	await add(page, 'Tár', 'Jo', '★★★ you MUST');
	await add(page, 'Barbie', 'Jo', '★★ you should');

	const person = page.getByLabel('Recommended by');
	const hype = page.getByLabel('How hyped');

	await person.selectOption({ label: 'Sam (2)' });
	await expect(page.locator('.list .title')).toHaveCount(2);
	await expect(onList(page, 'Arrival')).toBeVisible();
	await expect(onList(page, 'Heat')).toBeVisible();
	await expect(onList(page, 'Tár')).toHaveCount(0);

	// Sam and MUST: only what Sam was hyped about.
	await hype.selectOption({ label: '★★★ MUST' });
	await expect(page.locator('.list .title')).toHaveCount(1);
	await expect(onList(page, 'Arrival')).toBeVisible();

	// Anyone, MUST: Arrival and Tár.
	await person.selectOption({ label: 'Anyone' });
	await expect(page.locator('.list .title')).toHaveCount(2);
	await expect(onList(page, 'Tár')).toBeVisible();

	// Nothing matches: say so, and clearing brings everything back.
	await person.selectOption({ label: 'Sam (2)' });
	await hype.selectOption({ label: '★★ should' });
	await expect(page.getByText('Nothing on the Put List matches.')).toBeVisible();
	await page.getByRole('button', { name: 'Clear the filters' }).click();
	await expect(page.locator('.list .title')).toHaveCount(4);

	await context.close();
});
