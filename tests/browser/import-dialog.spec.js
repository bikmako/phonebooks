import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { exportFile, upload, snapshot, commitAndReload } from './helpers.js';

// Exercise the real opening animations as well as viewport resizing.
test.use({ reducedMotion: 'no-preference' });

async function visibleActions(page) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Visibility alone passes for offscreen elements. Check geometry and hit testing
  // without click()/scrollIntoView(), which could hide the original regression.
  await expect.poll(() => dialog.evaluate(node => {
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop || 0, left = viewport?.offsetLeft || 0;
    const bottom = top + (viewport?.height || innerHeight);
    const right = left + (viewport?.width || innerWidth);
    if (node.getAnimations().some(animation => animation.playState === 'running')) return false;
    const overlay = node.parentElement.getBoundingClientRect();
    if (Math.abs(overlay.height - (bottom - top)) > 1 || Math.abs(overlay.width - (right - left)) > 1) return false;
    const buttons = [...node.querySelectorAll('button')].filter(button => ['Отмена без записи', 'Подтвердить импорт'].includes(button.textContent));
    return buttons.length === 2 && buttons.every(button => {
      const r = button.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      // Disabled buttons have pointer-events:none, so their footer receives hits.
      return r.top >= top && r.bottom <= bottom + 1 && r.left >= left && r.right <= right + 1 && node.contains(hit);
    });
  })).toBe(true);
}

test('preview stays in viewport, body is locked, content scrolls and cancellation is readonly', async ({ page }) => {
  await page.goto('./#/settings');
  const file = await exportFile(page), before = await snapshot(page);
  // Force wrapping as well as vertical overflow, using a valid imported field.
  file.snapshot.indexedDB.state[0].value.settings.businessName = 'ОченьДлинноеНазвание'.repeat(40);
  const originalSize = page.viewportSize();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const scrollBefore = await page.evaluate(() => scrollY);
  await upload(page, file);
  const dialog = page.getByRole('dialog'), content = dialog.locator('.modal-content');
  for (const size of [{ width: 320, height: 568 }, { width: 390, height: 664 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(size);
    await visibleActions(page);
    await content.evaluate(node => { node.scrollTop = 0; });
    const footerBefore = await dialog.locator('.modal-footer').boundingBox();
    await content.evaluate(node => { node.scrollTop = node.scrollHeight; });
    await expect.poll(() => content.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    await visibleActions(page);
    expect((await dialog.locator('.modal-footer').boundingBox()).y).toBeCloseTo(footerBefore.y, 0);
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('root')).position)).toBe('fixed');
    expect(await content.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  }
  expect(await snapshot(page)).toEqual(before);
  await page.setViewportSize(originalSize);
  await visibleActions(page);
  await page.getByRole('button', { name: 'Отмена без записи' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
  // WebKit rounds the document scroll limit by a CSS pixel after resize.
  expect(Math.abs(await page.evaluate(() => scrollY) - scrollBefore)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.getElementById('root').style.position)).toBe('');
});

test('download and both explicit confirmations are required; reopening resets consent', async ({ page }) => {
  await page.goto('./#/settings');
  const original = await exportFile(page), before = await snapshot(page);
  const incoming = structuredClone(original);
  incoming.snapshot.indexedDB.state[0].value.settings.businessName = 'Подтверждённый импорт';
  await upload(page, incoming);
  const confirm = page.getByRole('button', { name: 'Подтвердить импорт', exact: true });
  const saved = page.getByLabel('Я сохранил предварительную копию и подтверждаю импорт');
  const overwrite = page.getByLabel('Отдельно разрешаю заменить существующие данные, тему и черновики');
  await visibleActions(page);
  await expect(saved).toBeDisabled();
  await overwrite.check(); await expect(confirm).toBeDisabled();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать предварительную полную копию' }).click();
  const download = await downloadPromise;
  expect(JSON.parse(await fs.readFile(await download.path(), 'utf8')).snapshot).toEqual(original.snapshot);
  await expect(confirm).toBeDisabled();
  await saved.check(); await expect(confirm).toBeEnabled();
  await overwrite.uncheck(); await expect(confirm).toBeDisabled();
  await overwrite.check(); await saved.uncheck(); await expect(confirm).toBeDisabled();
  expect(await snapshot(page)).toEqual(before);
  await page.getByRole('button', { name: 'Отмена без записи' }).click();
  await upload(page, incoming);
  await expect(saved).not.toBeChecked(); await expect(saved).toBeDisabled();
  await expect(overwrite).not.toBeChecked(); await expect(confirm).toBeDisabled();
  await page.getByRole('button', { name: 'Скачать предварительную полную копию' }).click();
  await saved.check(); await overwrite.check();
  await visibleActions(page);
  await commitAndReload(page);
  await expect(page.getByLabel('Название бизнеса')).toHaveValue('Подтверждённый импорт');
  const after = await snapshot(page);
  expect(after.state[0].settings.businessName).toBe('Подтверждённый импорт');
  // Automatic recovery copy must retain the exact pre-import snapshot.
  const exported = await exportFile(page);
  const recovery = exported.snapshot.indexedDB.meta.find(entry => entry.key.startsWith('recovery:'));
  expect(recovery.value).toEqual(original.snapshot);
});
