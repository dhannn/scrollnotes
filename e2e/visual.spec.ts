import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Visual regression pass (Slice 7 Â§10.6).
 *
 * Each test is BOTH a screenshot and an assertion. The screenshots are for a human
 * to eyeball; the assertions are what fails a build. A screenshot alone would let
 * the same class of regression ship again, which is exactly what happened four times
 * in Slice 7.
 *
 * Flows are driven through the real UI â€” including the onboarding wizard, which
 * gates the entire app â€” so the captures reflect a genuine first-run state.
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
 * meant the annotation cockpit â€” the layout that regressed most â€” was never
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

  // Step 2 â€” scale. Defaults are valid, so continue straight through.
  await expect(page.getByText('Scale and identity')).toBeVisible();
  await page.getByRole('button', { name: /Continue/ }).click();

  // Step 3 â€” ingest plan. Choose images so the gallery is the landing view.
  await expect(page.getByText('How will you capture encounters?')).toBeVisible();
  await page.getByRole('button', { name: /Drop pre-extracted images/ }).click();
  await page.getByRole('button', { name: /Continue/ }).click();

  // Step 4 â€” review, then create.
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
      }px â€” they overlap`
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
 * Every earlier capture showed an EMPTY app, so the cockpit's stacked layout â€”
 * the single most-changed CSS in Slice 7 â€” had never actually been rendered by a
 * real browser. This test drives the real UI into it (seeded batch -> Annotate)
 * and asserts the things that only fail once there is real content:
 *
 *  - the frame stays pinned while the form scrolls (Â§38: the transcription loop
 *    must survive without a second pane);
 *  - the bottom of the form is REACHABLE (the bug the stacked-pane inversion
 *    was written to fix â€” a clipped form is invisible to an overflow check);
 *  - tap targets are finger-sized on coarse pointers (Â§10.3);
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
    `cockpit scrollport has no overflow (scrollHeight ${scrollport.scrollH} === clientHeight ${scrollport.clientH}) â€” it cannot scroll, so every scroll-based check below is meaningless`
  ).toBeGreaterThan(scrollport.clientH);

  // --- The frame must stay pinned while the form scrolls below it -------------
  const stageBefore = await page.locator('.visual-stage').boundingBox();
  await cockpit.evaluate((el) => el.scrollTo(0, 400));
  await page.waitForTimeout(250);
  const stageAfter = await page.locator('.visual-stage').boundingBox();

  expect(
    stageBefore && stageAfter ? Math.abs(stageAfter.y - stageBefore.y) : 999,
    'the visual stage moved while the form scrolled â€” it is not sticky'
  ).toBeLessThanOrEqual(2);

  // It must be pinned INSIDE the visible viewport, not merely stationary at a
  // negative offset (which is what it was doing before the scrollport fix).
  const stageVisible = await page.locator('.visual-stage').isVisible();
  const stageY = stageAfter?.y ?? -1;
  expect(
    stageVisible && stageY >= 0 && stageY < 844,
    `the sticky frame sits at y=${Math.round(stageY)} â€” off-screen, so the researcher cannot see the frame while transcribing (Â§38)`
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
    `form still has ${Math.round(remaining)}px below the fold â€” clipped, not merely scrollable`
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
    'no tap targets matched â€” this check would pass while measuring nothing'
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
    `provenance badge wrapped to ${Math.round(badgeLines?.h ?? 99)} lines for "${badgeLines?.text}" â€” the ID is unreadable (Â§21)`
  ).not.toBeNull();
  expect(
    badgeLines!.h,
    `provenance badge wrapped to ${Math.round(badgeLines!.h)} lines for "${badgeLines!.text}" â€” the ID is unreadable (Â§21)`
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
    `status chrome is ${chrome.sum}px of a ${chrome.vh}px viewport â€” it must leave the majority of the screen for the frame and the form`
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
    `the frame occupies only ${(stageShare * 100).toFixed(1)}% of the viewport â€” too small to read the UGC being transcribed`
  ).toBeGreaterThan(0.25);

  // The action bar must be fully on screen â€” it was clipping at the edge.
  const barBox = await page.locator('.touch-action-bar').boundingBox();
  expect(
    barBox && barBox.y + barBox.height <= (page.viewportSize()?.height ?? 0) + 2,
    `the touch action bar extends to ${Math.round((barBox?.y ?? 0) + (barBox?.height ?? 0))}px, past the ${page.viewportSize()?.height}px viewport`
  ).toBe(true);
});

/**
 * The populated gallery on a touch viewport.
 *
 * Added after a phone screenshot showed a toolbar consuming ~91% of the viewport:
 * ~24 filter pills wrapped into a wall, the distribution strip restating platform
 * counts a third time, and the "Annotate Session" CTA clipped at the viewport edge.
 * The gallery is a triage surface â€” the CARDS are the content. This pins the
 * chrome budget so the fix cannot silently regress.
 */
test('the gallery chrome leaves room for the cards', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  await page.goto('/');
  await completeOnboarding(page);
  await seedCorpus(page);

  // --- Preconditions: a vacuous pass is worse than no check --------------------
  // Every bug in this file was a green test measuring nothing. Prove the elements
  // exist and are actually rendered before trusting any measurement of them.
  await expect(page.locator('.gallery-toolbar'), 'the gallery toolbar renders').toBeVisible();
  expect(await page.locator('.encounter-card').count(),
    'no gallery cards rendered â€” the budget below would be meaningless').toBeGreaterThan(0);
  await expect(page.locator('.gallery-grid-scroll'), 'the frame grid renders').toBeVisible();

  // --- Chrome budget: the cards get the majority of the screen -----------------
  const budget = await page.evaluate(() => {
    const t = document.querySelector('.gallery-toolbar');
    const g = document.querySelector('.gallery-grid-scroll');
    if (!t || !g) return null;
    const h = (sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return 0;
      return getComputedStyle(el).display === 'none'
        ? 0
        : Math.round(el.getBoundingClientRect().height);
    };
    return {
      toolbar: Math.round(t.getBoundingClientRect().height),
      grid: Math.round(g.getBoundingClientRect().height),
      vh: window.innerHeight,
      header: h('.app-header'),
      lifecycle: h('.lifecycle-bar'),
    };
  });

  expect(budget, 'could not measure toolbar/grid heights').not.toBeNull();
  // Log BEFORE the assertions below so a failure still reports the breakdown.
  console.log(
    `[budget] vh=${budget!.vh} header=${budget!.header} lifecycle=${budget!.lifecycle} toolbar=${budget!.toolbar} grid=${budget!.grid}`
  );
  const pct = (n: number) => `${((n / budget!.vh) * 100).toFixed(1)}%`;
  expect(budget!.toolbar / budget!.vh,
    `the gallery toolbar is ${budget!.toolbar}px of a ${budget!.vh}px viewport (${pct(budget!.toolbar)}) â€” the cards are the content, the toolbar is chrome`
  ).toBeLessThan(0.35);
  // The grid share is bounded by whatever chrome sits above it, so one flat
  // threshold cannot hold everywhere. A 390px-tall landscape phone cannot give
  // 40% to the cards AND keep 44px touch targets; demanding both would mean
  // shaving touch targets, which is the wrong trade. Short viewports get a
  // lower (still meaningful) bar; tall ones keep the stricter one.
  const gridFloor = budget!.vh < 500 ? 0.3 : 0.4;
  expect(
    budget!.grid / budget!.vh,
    `the frame grid gets only ${budget!.grid}px of a ${budget!.vh}px viewport (${pct(budget!.grid)}) - it needs at least ${pct(gridFloor * budget!.vh)}`
  ).toBeGreaterThan(gridFloor);

  // --- Intra-container clipping -----------------------------------------------
  // `assertNoOverflow` only reads `documentElement.scrollWidth`, so "Annotate
  // Session" was clipped inside a flex row while the document reported no
  // overflow. Measure each control's own box against the viewport instead.
  const clipped = await page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll('.gallery-toolbar button, .gallery-toolbar select, .gallery-toolbar input').forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      const r = el.getBoundingClientRect();
      if (r.width === 0) return; // not laid out
      const label = (el.getAttribute('aria-label') ?? el.textContent ?? el.getAttribute('placeholder') ?? '?')
        .trim().slice(0, 32);
      if (r.right > window.innerWidth + 1 || r.left < -1) {
        out.push(`"${label}" spans ${Math.round(r.left)}pxâ†’${Math.round(r.right)}px in a ${window.innerWidth}px viewport`);
      }
    });
    return out;
  });
  expect(clipped, `gallery controls clipped at the viewport edge:\n${clipped.join('\n')}`)
    .toHaveLength(0);

  // --- The disclosure behaviour ----------------------------------------------
  const toggle = page.locator('.gallery-filter-toggle');
  const groups = page.locator('.gallery-filter-groups');

  if (testInfo.project.use?.hasTouch) {
    await expect(toggle,
      'on a touch viewport the pill wall collapses behind a disclosure, so the toggle must be visible')
      .toBeVisible();
    await expect(toggle, 'the disclosure must expose its expanded state to assistive tech')
      .toHaveAttribute('aria-expanded', /true|false/);

    // Closed by default â€” the pills must be out of the tap order entirely.
    await expect(groups, 'the filter panel starts collapsed on touch').toHaveAttribute(
      'data-open', 'false'
    );
    const hidden = await page.locator('.gallery-filter-groups .filter-btn:visible').count();
    expect(hidden,
      `${hidden} filter pills are visible with the panel collapsed â€” the chrome fix did not take effect`)
      .toBe(0);

    // Opening must reveal real pills, not an empty shell (guards a refactor that
    // keeps the toggle but drops the content).
    await toggle.click();
    const open = await page.locator('.gallery-filter-groups .filter-btn:visible').count();
    expect(open, 'opening the disclosure revealed no filter pills').toBeGreaterThan(3);
    await page.screenshot({ path: shotPath(project, 'gallery-filters-open') });

    const small: string[] = [];
    for (const t of await page.locator('.gallery-filter-groups .filter-btn:visible, .gallery-filter-groups .platform-pill:visible').all()) {
      const box = await t.boundingBox();
      if (box && box.height < 44) small.push(`${((await t.textContent()) ?? '?').trim()} is ${Math.round(box.height)}px tall`);
    }
    expect(small, `gallery filter pills under 44px:\n${small.join('\n')}`).toHaveLength(0);

    // Setting a filter must surface the count so hidden state stays visible.
    await page.locator('.gallery-filter-groups .filter-btn', { hasText: 'Curated' }).first().click();
    await expect(toggle, 'an active filter must be reported on the collapsed disclosure')
      .toContainText('Filters');
  } else {
    // Desktop must be untouched by this mobile affordance.
    await expect(toggle, 'the disclosure is a mobile affordance; it must not appear on desktop')
      .toBeHidden();
    expect(await page.locator('.gallery-filter-groups .filter-btn:visible').count(),
      'the desktop filter bar must stay permanently expanded').toBeGreaterThan(3);
  }

  await page.screenshot({ path: shotPath(project, 'gallery-populated-after') });
});

/**
 * Bulk recording ingestion (Slice 8).
 *
 * The reported bug was "it won't upload multiple recordings": the video input had
 * no `multiple` attribute, so the picker allowed exactly one file.
 *
 * These files are deliberately NOT valid video. That is the point — a browser must
 * report each undecodable file by name and keep going. If the implementation ever
 * swallows failures or aborts the batch on the first error, these assertions fail.
 * A "happy path" test with real .mp4 fixtures would need binary fixtures in the
 * repo; the failure path is what actually breaks silently.
 */
test('multiple recordings can be selected at once and failures are named', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  await page.goto('/');
  await completeOnboarding(page);
  await seedCorpus(page);

  // Open the Field Sessions view. `.view-tab` is used instead of an accessible-name
  // query because on narrow viewports the nav collapses to icon-only buttons, where
  // the visible text is hidden and the accessible name does not match.
  await page.locator('.view-tab', { hasText: /sessions/i }).first().click();
  await expect(page.locator('.sampling-panel'), 'the sessions view opens').toBeVisible();

  const videoInput = page.locator('input[type="file"][accept^="video"]');
  await expect(videoInput, 'the recording input exists').toHaveCount(1);

  // THE REGRESSION: `multiple` is what makes multi-select possible at all.
  // Without it the OS picker silently restricts selection to one file.
  await expect(
    videoInput,
    'the recording input must allow selecting more than one file'
  ).toHaveAttribute('multiple', '');

  // Two files at once. Neither is decodable, so both must be reported BY NAME
  // rather than collapsing into one opaque error.
  await videoInput.setInputFiles([
    { name: 'session_alpha.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not-a-real-mp4-a') },
    { name: 'session_beta.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not-a-real-mp4-b') },
  ]);

  // The researcher must be told WHICH file failed — a generic "could not be
  // imported" with no filename is the failure mode AGENTS §39 warns about.
  const alert = page.locator('.sessions-error, .sessions-warning').first();
  await expect(alert, 'an undecodable batch is surfaced, never swallowed').toBeVisible({
    timeout: 20_000,
  });
  const alertText = (await alert.textContent()) ?? '';

  // EVERY failed file must be named. This previously passed vacuously because
  // the assertion was `cards === 0 || mentioned`, and zero cards short-circuited
  // it while the UI showed one generic, filename-free message.
  for (const filename of ['session_alpha.mp4', 'session_beta.mp4']) {
    expect(
      alertText,
      `"${filename}" failed but the message never names it, so the researcher cannot tell which file to fix`
    ).toContain(filename);
  }

  await page.screenshot({ path: shotPath(project, 'sessions-bulk-failure') });

  // A batch where every file failed must not leave phantom sessions behind.
  expect(
    await page.locator('.session-card').count(),
    'no session may be created for a file the browser could not decode'
  ).toBe(0);

  // And the progress UI must return to idle. A failed probe used to leave the
  // status stuck at 'probing', so the panel kept showing "Reading recording…"
  // with a live Cancel button long after every file had finished failing —
  // making a finished, failed batch look like a running one.
  const stuckSpinner = page.getByText(/Reading recording/);
  await expect(
    stuckSpinner,
    'a finished batch must not still claim to be reading a recording'
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /Cancel/i }),
    'the cancel affordance must disappear once nothing is running'
  ).toHaveCount(0);
});

