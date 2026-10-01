import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

test('create, upload, preview, edit and delete an album under a URL prefix', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const name = `A weekend away · ${testInfo.project.name}`;
  let albumId: string | undefined;
  try {
    await page.goto('./');
    await expect(page.getByRole('heading', { name: 'Small moments. Worth keeping.' })).toBeVisible();
    await page.screenshot({ path: `.local/home-${testInfo.project.name}.png`, fullPage: true });
    await page.getByRole('link', { name: 'Create an album', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Create an album.' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create album', exact: true })).toBeDisabled();
    await page.getByLabel('Album name').fill(name);
    await page.getByLabel('Description').fill('Salt in the air, nowhere to rush.');
    await page.getByRole('button', { name: 'Create album', exact: true }).click();
    await expect(page).toHaveURL(/\/gallery\/albums\/[a-f0-9-]+\/edit$/);
    albumId = new URL(page.url()).pathname.split('/').at(-2);
    await expect(page.getByRole('heading', { name: 'Add your photos' })).toBeVisible();
    const png = await sharp({ create: { width: 900, height: 650, channels: 3, background: '#77a6b6' } }).png().toBuffer();
    const jpg = await sharp({ create: { width: 850, height: 1000, channels: 3, background: '#b3d89c' } }).jpeg().toBuffer();
    await page.locator('input[type=file]').setInputFiles(Array.from({ length: 21 }, (_, i) => ({ name: `${i}.png`, mimeType: 'image/png', buffer: png })));
    await expect(page.getByRole('alert')).toContainText('Choose up to 20 images');
    await page.locator('input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a photo') });
    await expect(page.locator('.upload-error')).toHaveText('Use JPEG, PNG or WebP.');
    let rejectedOnce = false;
    await page.route('**/api/albums/*/photos', async route => {
      if (!rejectedOnce) { rejectedOnce = true; await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Temporary upload failure. Please retry."}' }); }
      else await route.continue();
    });
    await page.locator('input[type=file]').setInputFiles({ name: 'Retry.png', mimeType: 'image/png', buffer: png });
    await expect(page.locator('.upload-error')).toContainText('Temporary upload failure');
    await page.getByRole('button', { name: 'Retry failed uploads' }).click();
    await expect(page.getByRole('status')).toContainText('All images added');
    await page.unroute('**/api/albums/*/photos');
    await page.getByRole('button', { name: 'Delete Retry.png' }).click();
    await page.getByRole('button', { name: 'Yes, delete' }).click();
    await expect(page.locator('.photo-card')).toHaveCount(0);
    await page.locator('input[type=file]').setInputFiles([
      { name: 'The coast.png', mimeType: 'image/png', buffer: png },
      { name: 'Slow mornings.jpg', mimeType: 'image/jpeg', buffer: jpg },
    ]);
    await expect(page.getByRole('status')).toContainText('All images added');
    await expect(page.locator('.photo-card')).toHaveCount(2);
    await page.screenshot({ path: `.local/edit-${testInfo.project.name}.png`, fullPage: true });
    await page.getByRole('link', { name: 'Back to album' }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await page.reload(); // deep-link routing must work without first visiting home
    await expect(page.locator('.photo-card')).toHaveCount(2);
    await page.getByRole('button', { name: 'View The coast.png' }).click();
    const dialog = page.getByRole('dialog', { name: 'Photo viewer' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('img')).toHaveAttribute('alt', 'The coast.png');
    await page.keyboard.press('ArrowRight');
    await expect(dialog.getByRole('img')).toHaveAttribute('alt', 'Slow mornings.jpg');
    await page.keyboard.press('ArrowLeft');
    await expect(dialog.getByRole('img')).toHaveAttribute('alt', 'The coast.png');
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'View The coast.png' })).toBeFocused();
    await page.screenshot({ path: `.local/album-${testInfo.project.name}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('link', { name: 'Edit album', exact: true }).click();
    await page.getByLabel('Album name').fill(`${name} — saved`);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status')).toContainText('Album details saved');
    await page.getByRole('button', { name: 'Delete The coast.png' }).click();
    await page.getByRole('button', { name: 'Keep it' }).click();
    await expect(page.locator('.photo-card')).toHaveCount(2);
    await page.getByRole('button', { name: 'Delete The coast.png' }).click();
    await page.getByRole('button', { name: 'Yes, delete' }).click();
    await expect(page.locator('.photo-card')).toHaveCount(1);
    await expect(page.locator('.photo-card .cover-label')).toHaveText('COVER');
    await page.getByRole('button', { name: 'Delete album', exact: true }).click();
    await page.getByRole('button', { name: 'Yes, delete' }).click();
    await expect(page).toHaveURL(/\/gallery\/$/);
    await expect(page.getByRole('heading', { name: 'Your collection' })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    if (albumId) await page.request.delete(`api/albums/${albumId}`);
  }
});

test('invalid selections, dirty forms and error states are understandable', async ({ page }) => {
  await page.goto('albums/new');
  await page.getByLabel('Album name').fill('Unsaved moments');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('link', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(/albums\/new$/);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('link', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(/\/gallery\/$/);
  await page.goto('albums/00000000-0000-4000-8000-000000000000');
  await expect(page.getByRole('alert')).toContainText('Album not found');
  await page.route('**/api/albums', route => route.abort());
  await page.goto('./');
  await expect(page.getByRole('heading', { name: "We couldn't load your albums." })).toBeVisible();
  await page.unroute('**/api/albums');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: "We couldn't load your albums." })).not.toBeVisible();
});

test('root installation loads without a prefix', async ({ page }) => {
  const runtime = JSON.parse(readFileSync('.local/runtime.json', 'utf8'));
  await page.goto(runtime.albumcheckb.base);
  await expect(page.getByRole('heading', { name: 'Small moments. Worth keeping.' })).toBeVisible();
  await page.getByRole('link', { name: 'Create an album', exact: true }).click();
  await expect(page).toHaveURL(/\/albums\/new$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Create an album.' })).toBeVisible();
});
