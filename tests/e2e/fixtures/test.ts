import { test as base, expect, type Page } from '@playwright/test';
import { Api, type TestMember } from './api.js';
import { AdjusterPage } from '../pages/adjuster-page.js';
import { MemberPage } from '../pages/member-page.js';
import { SignInPage } from '../pages/sign-in-page.js';

// The seeded adjuster. The password follows SEED_PASSWORD so a changed seed changes one place.
export const ADJUSTER = {
  email: 'adjuster@claimpay.test',
  password: process.env.SEED_PASSWORD ?? 'claimpay-demo',
};

export interface Fixtures {
  api: Api;
  member: TestMember;
  goldMember: TestMember;
  signInPage: SignInPage;
  memberPage: MemberPage;
  adjusterPage: AdjusterPage;
  correlationIds: string[];
}

export const test = base.extend<Fixtures>({
  api: async ({ request }, use) => {
    const token = await Api.signIn(request, ADJUSTER);
    await use(new Api(request, token));
  },

  member: async ({ api }, use, testInfo) => {
    await use(await api.createMember(testInfo.workerIndex, 'SILVER'));
  },

  goldMember: async ({ api }, use, testInfo) => {
    await use(await api.createMember(testInfo.workerIndex, 'GOLD'));
  },

  signInPage: async ({ page }, use) => use(new SignInPage(page)),
  memberPage: async ({ page }, use) => use(new MemberPage(page)),
  adjusterPage: async ({ page }, use) => use(new AdjusterPage(page)),

  // Every API response the page received, by correlation ID. On failure the list is attached
  // to the report, so the failing step can be followed into the server log and the database.
  correlationIds: [
    async ({ page }, use, testInfo) => {
      const seen: string[] = [];
      page.on('response', (response) => {
        const id = response.headers()['x-correlation-id'];
        if (id)
          seen.push(`${response.status()} ${response.request().method()} ${response.url()} ${id}`);
      });
      await use(seen);
      if (testInfo.status !== testInfo.expectedStatus && seen.length > 0) {
        await testInfo.attach('api-calls-with-correlation-ids', {
          body: seen.join('\n'),
          contentType: 'text/plain',
        });
      }
    },
    { auto: true },
  ],
});

export { expect };
export type { Page };
