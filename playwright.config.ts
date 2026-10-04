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
    {
      name: 'mobile-390',
      use: { ...devices['iPhone 13'], isMobile: true, hasTouch: true },
    },
    {
      name: 'tablet-768',
      use: { ...devices['iPad Mini'], isMobile: true, hasTouch: true },
    },
    {
      name: 'desktop-1280',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: 'npm run preview -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});