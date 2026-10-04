import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Visual regression pass (Slice 7 §10.6).
 *
 * Each test is BOTH a screenshot and an assertion. The screenshots are for a human
 * to eyeball; the assertions are what fails a build. A screenshot alone would let
 * the same class of regression ship again, which is exactly what happened four times
 * in Slice 7.
 *
 * Flows are driven through the real UI — including the onboarding wizard, which
 * gates the entire app — so the captures reflect a genuine first-run state.
 */

const OUT_DIR = resolve(process.cwd(), 'screenshots');

function shotPath(project: string, name: string): string {
  mkdirSync(OUT_DIR, { recursive: true });
  return resolve(OUT_DIR, `${project}-${name}.png`);
}

/** Completes the four-step onboarding wizard so the workstation actually opens. */
async function completeOnboarding(page: Page): Promise<void> {
  const heading = page.getByRole('heading', { name: 'Define your corpus' });
  await expect(heading).toBeVisible({ timeout: 15_000 });

  await page.getByLabel('Dataset name').fill('Screenshot Corpus');
  await page.getByLabel('Version').fill('v0.1');
  await page.getByRole('button', { name: /Continue/ }).click();

  // Step 2 — scale. Defaults are valid, so continue straight through.
  await expect(page.getByText('Scale and identity')).toBeVisible();
  await page.getByRole('button', { name: /Continue/ }).click();

  // Step 3 — ingest plan. Choose images so the gallery is the landing view.
  await expect(page.getByText('How will you capture encounters?')).toBeVisible();
  await page.getByRole('button', { name: /Drop pre-extracted images/ }).click();
  await page.getByRole('button', { name: /Continue/ }).click();

  // Step 4 — review, then create.
  await expect(page.getByText('Ready to create this corpus')).toBeVisible();
  await page.getByRole('button', { name: /Create corpus/ }).click();

  await expect(page.getByRole('heading', { name: 'Scrollnotes' })).toBeVisible();
}

test('renders every view without horizontal overflow', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const overflows: string[] = [];

  const capture = async (name: string) => {
    await page.waitForTimeout(250); // let fonts/layout settle
    await page.screenshot({ path: shotPath(project, name), fullPage: false });
  };

  // Assert on every view that the document is not wider than the viewport. This is
  // the assertion that would have caught the `width:100vw` bug automatically.
  const assertNoOverflow = async (where: string) => {
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    // 1px tolerance for sub-pixel rounding.
    if (scrollWidth > clientWidth + 1) {
      overflows.push(`${where}: content ${scrollWidth}px wide vs viewport ${clientWidth}px`);
    }
  };

  await page.goto('/');
  await completeOnboarding(page);

  await capture('gallery');
  await assertNoOverflow('gallery');

  // The cockpit is the layout that actually regressed, so it gets its own capture.
  const annotateTab = page.getByRole('button', { name: /^Annotate$/ });
  if (await annotateTab.count()) {
    await annotateTab.first().click();
    await page.waitForTimeout(300);
    await capture('cockpit');
    await assertNoOverflow('cockpit');
  }

  const sessionsTab = page.getByRole('button', { name: /^Sessions$/ });
  if (await sessionsTab.count()) {
    await sessionsTab.first().click();
    await page.waitForTimeout(300);
    await capture('sessions');
    await assertNoOverflow('sessions');
  }

  expect(overflows, `horizontal overflow:\n${overflows.join('\n')}`).toHaveLength(0);
});

test('the header does not overlap the lifecycle bar', async ({ page }, testInfo) => {
  const project = testInfo.project.name;

  await page.goto('/');
  await completeOnboarding(page);

  const header = page.locator('.app-header');
  const bar = page.locator('.lifecycle-bar');

  await expect(header).toBeVisible();
  await expect(bar).toBeVisible();
  await page.screenshot({ path: shotPath(project, 'header-bar') });

  const headerBox = await header.boundingBox();
  const barBox = await bar.boundingBox();

  // The fixed-height header used to wrap and spill over the bar beneath it.
  expect(
    headerBox,
    'header has no layout box'
  ).not.toBeNull();
  expect(
    barBox,
    'lifecycle bar has no layout box'
  ).not.toBeNull();

  if (headerBox && barBox) {
    expect(
      barBox.y,
      `lifecycle bar starts at ${barBox.y}px but the header ends at ${
        headerBox.y + headerBox.height
      }px — they overlap`
    ).toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 1);
  }
});

test('the setup wizard opens as a full-screen sheet on small viewports', async ({
  page,
}, testInfo) => {
  const project = testInfo.project.name;
  const width = page.viewportSize()?.width ?? 1280;

  await page.goto('/');
  await completeOnboarding(page);

  // Re-open dataset settings from the header.
  await page.locator('.brand-section').click();
  await expect(page.getByRole('heading', { name: 'Dataset Settings' })).toBeVisible();
  await page.screenshot({ path: shotPath(project, 'dataset-settings') });

  const dialog = page.locator('.setup-dialog');
  const box = await dialog.boundingBox();
  expect(box, 'wizard dialog has no layout box').not.toBeNull();

  if (box) {
    // Below 620px the sheet must fill the width; above it, the fixed max-width holds.
    if (width <= 620) {
      expect(Math.abs(box.width - width), 'sheet should fill the viewport width').toBeLessThan(2);
    } else {
      expect(box.width, 'dialog should keep its desktop max-width').toBeLessThanOrEqual(640);
    }
  }
});