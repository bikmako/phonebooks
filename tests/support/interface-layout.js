import { expect } from '@playwright/test';

export const widths = [1920, 1440, 1280, 768, 390, 320];
export const soloRoutes = ['dashboard', 'purchase', 'accessories', 'catalog', 'sales', 'repairs', 'finance', 'history', 'search', 'settings'];
export const teamRoutes = ['dashboard', 'purchase', 'sales', 'repairs', 'finance', 'history', 'search', 'team', 'settings'];

export async function contrast(scope, view) {
  // During a route change engines can briefly expose styles from the preceding frame.
  // Sample until the styles settle without relying on animation callbacks in background WebKit.
  await expect.poll(() => scope.evaluate(root => {
    const readColor = value => {
      const [r, g, b, a = 1] = (value.match(/[\d.]+/g) ?? []).map(Number);
      return [r, g, b, a];
    };
    const composite = ([r, g, b, a], bg) => [
      r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a), 1,
    ];
    const luminance = rgb => rgb.slice(0, 3).reduce((sum, v, i) => {
      const c = v / 255;
      return sum + [0.2126, 0.7152, 0.0722][i] * (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    }, 0);

    const styles = new Map();
    const styleOf = element => {
      if (!styles.has(element)) styles.set(element, getComputedStyle(element));
      return styles.get(element);
    };
    function renderedContrast(element, sample, style, textColor) {
      if (!element.getClientRects().length || style.visibility !== 'visible' || element.closest(':disabled,[aria-hidden=true]')) return null;
      let bg = [255, 255, 255, 1];
      let opacity = 1;
      const surfaces = [];
      for (let node = element; node; node = node.parentElement) {
        const current = styleOf(node);
        opacity *= Number(current.opacity);
        if (current.display === 'none' || opacity === 0) return null;
        const surface = readColor(current.backgroundColor);
        if (surface[3] > 0) surfaces.unshift(surface);
        if (surface[3] === 1) break;
      }
      for (const surface of surfaces) bg = composite(surface, bg);
      const color = readColor(textColor);
      const fg = composite([color[0], color[1], color[2], color[3] * opacity], bg);
      const levels = [luminance(fg), luminance(bg)].sort((a, b) => a - b);
      const ratio = (levels[1] + 0.05) / (levels[0] + 0.05);
      const fontSize = parseFloat(style.fontSize);
      const minimum = fontSize >= 24 || (fontSize >= 18.67 && Number(style.fontWeight) >= 700) ? 3 : 4.5;
      return ratio < minimum ? { sample: sample.slice(0, 65), ratio: Number(ratio.toFixed(2)), foreground: textColor, surface: bg.slice(0, 3), element: element.outerHTML.slice(0, 110) } : null;
    }
    const failures = [];
    for (const element of [root, ...root.querySelectorAll('*')]) {
      if (element.matches('option,script,style,title,desc,svg:not(:has(text)),[hidden]')) continue;
      const sample = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent.trim()).join(' ').trim();
      const style = styleOf(element);
      if (sample) {
        const failure = renderedContrast(element, sample, style, element.matches('svg text') ? style.fill : style.color);
        if (failure) failures.push(failure);
      }
      if (element.matches('input:placeholder-shown,textarea:placeholder-shown') && element.placeholder) {
        const failure = renderedContrast(element, element.placeholder, style, getComputedStyle(element, '::placeholder').color);
        if (failure) failures.push(failure);
      }
    }
    return failures.slice(0, 15);
  }), { message: view }).toEqual([]);
}

async function controlAlignment(group, selector = 'button') {
  await expect(group).toBeVisible();
  const measures = await group.locator(selector).evaluateAll(controls => controls.map(element => {
    const { height, top } = element.getBoundingClientRect();
    const { borderRadius } = getComputedStyle(element);
    return { height, top, borderRadius };
  }).filter(control => control.height > 0));
  expect(measures.length).toBeGreaterThan(1);
  for (const item of measures) {
    expect(item.height).toBeGreaterThanOrEqual(44);
    expect(item.borderRadius).toBe(measures[0].borderRadius);
    for (const neighbor of measures.filter(control => control !== item &&
      control.top < item.top + item.height && item.top < control.top + control.height)) {
      expect(Math.abs(neighbor.top - item.top)).toBeLessThan(1);
      expect(Math.abs(neighbor.height - item.height)).toBeLessThan(1);
    }
  }
}

export async function center(dialog) {
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate(element => {
    const { x, y, width, height } = element.getBoundingClientRect();
    const viewport = window.visualViewport;
    return Math.max(
      Math.abs(x + width / 2 - (viewport.offsetLeft + viewport.width / 2)),
      Math.abs(y + height / 2 - (viewport.offsetTop + viewport.height / 2)),
      viewport.offsetTop - y,
      y + height - (viewport.offsetTop + viewport.height),
    );
  })).toBeLessThanOrEqual(2);
}

export async function interfaceMatrix(page, { url, solo }) {
  const routes = solo ? soloRoutes : teamRoutes;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => localStorage.setItem('phonebooks.theme', value), theme);
    await page.reload();
    await expect(page.locator('html')).toHaveCSS('color-scheme', theme);
    for (const route of routes) {
      await page.goto(url + '#/' + route);
      const main = page.locator('main');
      await expect(main).toBeVisible();
      await expect(main.getByRole('heading', { level: 1 }).first()).toBeVisible();
      const finance = route === 'finance';
      const stock = route === (solo ? 'catalog' : 'purchase');
      if (finance) await expect(main.getByText('Выручка', { exact: true }).first()).toBeVisible();
      if (stock) await expect(main.getByRole('group', { name: 'Действия склада' })).toBeVisible();
      if (route === 'accessories') await expect(main.locator('.accessories-product').first()).toBeVisible();
      if (route === 'repairs' && !solo) await expect(main.getByRole('group', { name: 'Действия ремонта' })).toBeVisible();
      for (const width of widths) {
        await page.setViewportSize({ width, height: width > 768 ? 900 : 780 });
        const view = [theme, route, width].join(' / ');
        const frame = await main.evaluate(element => {
          const content = element.getBoundingClientRect();
          const header = document.querySelector('.pb-topbar-inner').getBoundingClientRect();
          return {
            overflow: document.documentElement.scrollWidth - innerWidth,
            delta: Math.abs(content.left - header.left) + Math.abs(content.right - header.right),
            nav: getComputedStyle(document.querySelector('.pb-sidebar')).display,
          };
        });
        expect(frame.overflow, view).toBeLessThanOrEqual(0);
        expect(frame.delta, view).toBeLessThan(1);
        expect(frame.nav, view).toBe(width >= 900 ? 'flex' : 'none');
        await expect(main).toHaveCSS('font-family', /Manrope/);
        if (finance) {
          await controlAlignment(main.getByRole('group', { name: 'Быстрые действия' }));
          expect(await main.evaluate(element => {
            const heading = element.querySelector('.pb-heading');
            const finance = element.querySelector('.pb-finance-primary');
            const metrics = [...element.querySelectorAll('.pb-metrics, .pb-chart, .pb-report-toolbar')];
            return heading.getBoundingClientRect().bottom <= finance.getBoundingClientRect().top &&
              metrics.length > 0 && metrics.every(item => finance.getBoundingClientRect().bottom <= item.getBoundingClientRect().top);
          }), view).toBe(true);
        }
        if (stock) {
          const actions = main.getByRole('group', { name: 'Действия склада' });
          for (const name of ['Добавить товар', solo ? 'Новая категория' : 'Категории товаров', 'Массовое редактирование']) {
            await expect(actions.getByRole('button', { name, exact: true })).toBeVisible();
          }
          await controlAlignment(actions);
          expect(await actions.evaluate(group => {
            const search = group.previousElementSibling;
            const list = group.nextElementSibling;
            return search.matches('.pb-toolbar') && list.matches('.pb-list, .pb-empty') &&
              search.getBoundingClientRect().bottom <= group.getBoundingClientRect().top &&
              group.getBoundingClientRect().bottom <= list.getBoundingClientRect().top;
          }), view).toBe(true);
        }
        if (route === 'repairs' && !solo) await controlAlignment(main.getByRole('group', { name: 'Действия ремонта' }), 'button, select');
        if (route === 'accessories') {
          const actions = main.locator('.accessories-product-actions').first();
          await expect(actions.getByRole('button', { name: 'Возвраты и бронирования' })).toBeVisible();
          await controlAlignment(actions);
        }
        await contrast(page.locator('.pb-shell'), view);
        if (route === 'dashboard' && solo) {
          const invoker = page.getByRole('button', { name: width >= 900 ? 'Новая операция' : 'Создать операцию', exact: true });
          await invoker.click();
          const dialog = page.getByRole('dialog', { name: 'Новая операция' });
          await center(dialog);
          await contrast(dialog, view + ' / dialog');
          if (width === 320) {
            await page.setViewportSize({ width, height: 360 });
            await center(dialog);
            await page.setViewportSize({ width, height: 780 });
          }
          await dialog.getByRole('button', { name: 'Закрыть' }).click();
          await expect(dialog).toBeHidden();
        }
      }
    }
  }
}
