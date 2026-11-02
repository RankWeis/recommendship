// Someone arriving from a shared link can try the app before making an account.

import { expect, test } from '@playwright/test';
import { quickAdd } from './helpers';

test('the empty Put List says no account is needed, and adding works signed out', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'The Put List is empty' })).toBeVisible();
	await expect(page.getByText('No account needed to try it')).toBeVisible();

	await quickAdd(page, 'Piranesi', 'Jo');
	await expect(page.getByText('No account needed to try it')).toBeHidden();
});
