import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: {
    timeout: 5000
  },
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 }
      }
    },
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 390, height: 844 }
      }
    }
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000
  }
});
