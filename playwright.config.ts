import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright visual harness (Slice 7 §10.6)
 * ----------------------------------------
 * The three shipped defects that the whole test suite could not see were all
 * visual: a fixed-height header spilling onto the lifecycle bar, a notice leaking
 * across views, and `width:100vw` forcing horizontal overflow. Asserting that CSS
 * text exists proves nothing about layout — only rendering does.
 *
 * This harness renders the real app at the three widths that matter and writes
 * PNGs to `screenshots/`, so a regression is a visible diff rather than something
 * a researcher notices hours later.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './node_modules/.playwright',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    // Deterministic rendering: fixed viewport, no animation, no font flakiness.
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  },
  projects: [
    // Chromium for ALL projects: the iPhone/iPad device presets default to WebKit,
    // which would require a second browser download. The viewport, device scale and
    // `isMobile`/`hasTouch` flags are what drive the responsive CSS, not the engine.
    {
      name: 'mobile-390',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'tablet-768',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium',
        viewport: { width: 768, height: 1024 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    // Landscape phone: the stacked cockpit has almost no vertical room here, which
    // is a layout nobody had tested.
    {
      name: 'landscape-844',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium',
        viewport: { width: 844, height: 390 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'desktop-1280',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium',
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
      },
    },
  ],
  webServer: {
    command: 'npm run preview -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});