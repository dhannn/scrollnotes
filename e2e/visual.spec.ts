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

/**
 * Loads the built-in fieldwork batch so the corpus is POPULATED.
 *
 * This is the missing fixture: every capture so far was of an empty app, which
 * meant the annotation cockpit — the layout that regressed most — was never
 * rendered. `loadSampleBatch()` clears the frame/encounter stores but NOT
 * `dataset_info`, so the completed onboarding state survives the seed.
 *
 * Scoped to the header button: the same label also exists on the empty-state
 * Dropzone, and a bare role/name query trips Playwright's strict mode.
 */
async function seedCorpus(page: Page): Promise<void> {
  await page
    .locator('.app-header')
    .getByRole('button', { name: /Load Sample Batch/i })
    .click();
  await expect(
    page.locator('.encounter-card').first(),
    'sample batch produced gallery cards'
  ).toBeVisible({ timeout: 15_000 });
}

/** Completes the four-step onboarding wizard so the workstation actually opens. */
async function completeOnboarding(page: Page): Promise<void> {
  const heading = page.getByRole('heading', { name: 'Define your corpus' });
  await expect(heading).toBeVisible({ timeout: 15_000 });

  // Select by id, not by accessible name: the label text lives in a nested span,
  // and an id selector is unambiguous even if the copy changes.
  await page.locator('#setup-name').fill('Screenshot Corpus');
  await page.locator('#setup-version').fill('v0.1');
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

  // "Scrollnotes" is rendered as a <span class="brand-title">, not a heading, so
  // assert on a stable element that only exists once onboarding has finished.
  await expect(page.locator('.app-header')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.lifecycle-bar')).toBeVisible({ timeout: 15_000 });
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

  // Seed a real corpus, then re-capture the gallery populated: cards, badges and
  // status chips are layout too, and none of them were ever rendered before.
  await seedCorpus(page);
  await capture('gallery-populated');
  await assertNoOverflow('gallery-populated');

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

test('the lifecycle bar does not overlap itself', async ({ page }, testInfo) => {
  const project = testInfo.project.name;

  await page.goto('/');
  await completeOnboarding(page);

  const bar = page.locator('.lifecycle-bar');
  await expect(bar).toBeVisible();
  await page.screenshot({ path: shotPath(project, 'lifecycle-bar') });

  // The `below intended range` note is nowrap, so it overflowed and collided with
  // the CTA on a phone. Every child of the bar must be horizontally disjoint.
  const boxes = await page.evaluate(() => {
    const bar = document.querySelector('.lifecycle-bar');
    if (!bar) return [];
    return Array.from(bar.children).map((el) => {
      const r = el.getBoundingClientRect();
      return { cls: el.className, x: r.x, y: r.y, w: r.width, h: r.height };
    });
  });

  const overlapping: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      // Same-row children share a row; only flag genuine 2D intersections.
      if (overlapX > 1 && overlapY > 1) {
        overlapping.push(`${a.cls} overlaps ${b.cls}`);
      }
    }
  }

  expect(overlapping, `lifecycle bar overlap:\n${overlapping.join('\n')}`).toHaveLength(0);
});

test('the setup wizard opens as a full-screen sheet on small viewports', async ({
  page,
}, testInfo) => {
  const project = testInfo.project.name;
  const width = page.viewportSize()?.width ?? 1280;

  await page.goto('/');
  await completeOnboarding(page);

  // Re-open dataset settings. The clickable control is the header's settings BUTTON
  // (title "Dataset Configuration & Goals"); clicking `.brand-section` is a
  // different element and does nothing.
  await page.getByRole('button', { name: 'Dataset Configuration & Goals' }).click();
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

/**
 * The populated annotation cockpit.
 *
 * Every earlier capture showed an EMPTY app, so the cockpit's stacked layout —
 * the single most-changed CSS in Slice 7 — had never actually been rendered by a
 * real browser. This test drives the real UI into it (seeded batch -> Annotate)
 * and asserts the things that only fail once there is real content:
 *
 *  - the frame stays pinned while the form scrolls (§38: the transcription loop
 *    must survive without a second pane);
 *  - the bottom of the form is REACHABLE (the bug the stacked-pane inversion
 *    was written to fix — a clipped form is invisible to an overflow check);
 *  - tap targets are finger-sized on coarse pointers (§10.3);
 *  - the cockpit does not overflow horizontally.
 */
test('the populated annotation cockpit is usable', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const isTouch = testInfo.project.use?.hasTouch === true;

  await page.goto('/');
  await completeOnboarding(page);
  await seedCorpus(page);

  await page.getByRole('button', { name: /^Annotate$/ }).first().click();

  const cockpit = page.locator('.cockpit-container');
  await expect(cockpit, 'the cockpit renders once a sample is active').toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('.ground-truth-panel')).toBeVisible();
  await page.screenshot({ path: shotPath(project, 'cockpit-top') });

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    scrollWidth,
    `cockpit content ${scrollWidth}px wide vs viewport ${clientWidth}px`
  ).toBeLessThanOrEqual(clientWidth + 1);

  if (!isTouch) return; // the rest is coarse-pointer-specific ergonomics

  // --- Preconditions: these assertions were VACUOUS when omitted --------------
  // An earlier version of this test passed on a broken layout because it
  // scrolled an element that could not scroll and measured a bar that was
  // hidden. Both are silent no-ops, so each is asserted FIRST: if the scrollport
  // does not exist, or the touch bar is not shown, fail here rather than
  // reporting four green checks that proved nothing.
  await expect(
    page.locator('.touch-action-bar'),
    'the touch action bar must be VISIBLE on a coarse pointer'
  ).toBeVisible();

  const scrollport = await cockpit.evaluate((el) => ({
    scrollH: el.scrollHeight,
    clientH: el.clientHeight,
  }));
  expect(
    scrollport.scrollH,
    `cockpit scrollport has no overflow (scrollHeight ${scrollport.scrollH} === clientHeight ${scrollport.clientH}) — it cannot scroll, so every scroll-based check below is meaningless`
  ).toBeGreaterThan(scrollport.clientH);

  // --- The frame must stay pinned while the form scrolls below it -------------
  const stageBefore = await page.locator('.visual-stage').boundingBox();
  await cockpit.evaluate((el) => el.scrollTo(0, 400));
  await page.waitForTimeout(250);
  const stageAfter = await page.locator('.visual-stage').boundingBox();

  expect(
    stageBefore && stageAfter ? Math.abs(stageAfter.y - stageBefore.y) : 999,
    'the visual stage moved while the form scrolled — it is not sticky'
  ).toBeLessThanOrEqual(2);

  // It must be pinned INSIDE the visible viewport, not merely stationary at a
  // negative offset (which is what it was doing before the scrollport fix).
  const stageVisible = await page.locator('.visual-stage').isVisible();
  const stageY = stageAfter?.y ?? -1;
  expect(
    stageVisible && stageY >= 0 && stageY < 844,
    `the sticky frame sits at y=${Math.round(stageY)} — off-screen, so the researcher cannot see the frame while transcribing (§38)`
  ).toBe(true);

  await page.screenshot({ path: shotPath(project, 'cockpit-scrolled') });

  // --- The bottom of the form must be reachable -------------------------------
  // The stacked-pane inversion exists precisely because the old fixed-height
  // panes CLIPPED the form with no way to scroll to the rest of it.
  await cockpit.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await page.waitForTimeout(250);

  const remaining = await cockpit.evaluate(
    (el) => el.scrollHeight - el.clientHeight - el.scrollTop
  );
  expect(
    remaining,
    `form still has ${Math.round(remaining)}px below the fold — clipped, not merely scrollable`
  ).toBeLessThanOrEqual(2);

  await page.screenshot({ path: shotPath(project, 'cockpit-bottom') });

  // --- Touch targets must be finger-sized -------------------------------------
  const small: string[] = [];
  const targets = page.locator(
    '.touch-action-bar button:visible, .lifecycle-bar-cta:visible, .view-tab:visible'
  );
  const targetCount = await targets.count();
  expect(
    targetCount,
    'no tap targets matched — this check would pass while measuring nothing'
  ).toBeGreaterThan(3);

  for (const t of await targets.all()) {
    const box = await t.boundingBox();
    const label = (await t.getAttribute('aria-label')) ?? (await t.textContent()) ?? '?';
    if (box && box.height < 44) small.push(`${label.trim()} is ${box.height}px tall`);
  }
  expect(small, `tap targets under 44px:\n${small.join('\n')}`).toHaveLength(0);

  // --- Provenance text must stay readable, not wrap per-character -----------
  // A phone screenshot showed "(1 of 6)" rendered one character per line and the
  // sample ID split mid-token, because the badge shared a row with six icon
  // buttons. Assert the rendered height stays on a sane number of lines.
  const badgeLines = await page.evaluate(() => {
    const el = document.querySelector('.stage-sample-badge');
    if (!el) return null;
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
    return { h: el.getBoundingClientRect().height / lh, text: el.textContent ?? '' };
  });

  expect(
    badgeLines,
    `provenance badge wrapped to ${Math.round(badgeLines?.h ?? 99)} lines for "${badgeLines?.text}" — the ID is unreadable (§21)`
  ).not.toBeNull();
  expect(
    badgeLines!.h,
    `provenance badge wrapped to ${Math.round(badgeLines!.h)} lines for "${badgeLines!.text}" — the ID is unreadable (§21)`
  ).toBeLessThan(2.5);

  // --- The chrome must not squeeze out the work -------------------------------
  // Screenshots showed the header + progress + lifecycle bar + notice consuming
  // ~700px of an 844px screen: nothing was broken, it was simply unusable. This
  // asserts a budget so the content always gets the majority of the viewport.
  const chrome = await page.evaluate(() => {
    const sum = ['.app-header', '.lifecycle-bar', '.cockpit-mobile-notice']
      .map((s) => document.querySelector(s))
      .filter((el): el is Element => !!el)
      .filter((el) => getComputedStyle(el).display !== 'none')
      .reduce((acc, el) => acc + el.getBoundingClientRect().height, 0);
    return { sum: Math.round(sum), vh: window.innerHeight };
  });

  expect(
    chrome.sum / chrome.vh,
    `status chrome is ${chrome.sum}px of a ${chrome.vh}px viewport — it must leave the majority of the screen for the frame and the form`
  ).toBeLessThan(0.45);

  // On a SHORT viewport the frame is what suffers first: at 844x390 the stage
  // collapsed to a ~50px postage stamp. Assert the frame keeps a usable share
  // of the screen wherever there is a coarse pointer.
  const stageShare = await page.evaluate(() => {
    const el = document.querySelector('.visual-stage');
    return el ? el.getBoundingClientRect().height / window.innerHeight : 0;
  });
  expect(
    stageShare,
    `the frame occupies only ${(stageShare * 100).toFixed(1)}% of the viewport — too small to read the UGC being transcribed`
  ).toBeGreaterThan(0.25);

  // The action bar must be fully on screen — it was clipping at the edge.
  const barBox = await page.locator('.touch-action-bar').boundingBox();
  expect(
    barBox && barBox.y + barBox.height <= (page.viewportSize()?.height ?? 0) + 2,
    `the touch action bar extends to ${Math.round((barBox?.y ?? 0) + (barBox?.height ?? 0))}px, past the ${page.viewportSize()?.height}px viewport`
  ).toBe(true);
});
