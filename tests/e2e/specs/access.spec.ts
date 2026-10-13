import { expect, test } from '../fixtures/test.js';

// R1 at the UI level: the API tests cover the 404 rule; this checks what a person sees.

test('a member sees only their own claims, before and after switching accounts', async ({
  api,
  member,
  goldMember,
  signInPage,
  memberPage,
}) => {
  const mine = await api.submitClaim(member, 1000);
  const theirs = await api.submitClaim(goldMember, 2000);

  await signInPage.goto();
  await signInPage.signIn(member.email, member.password);
  await expect(memberPage.row(mine.id)).toBeVisible();
  await expect(memberPage.row(theirs.id)).toHaveCount(0);
  await expect(memberPage.rows).toHaveCount(1);

  await memberPage.signOut();
  await expect(signInPage.heading).toBeVisible();
  // Nothing from the previous account is left on the page while signed out.
  await expect(memberPage.rows).toHaveCount(0);

  await signInPage.signIn(goldMember.email, goldMember.password);
  await expect(memberPage.row(theirs.id)).toBeVisible();
  await expect(memberPage.row(mine.id)).toHaveCount(0);
  await expect(memberPage.rows).toHaveCount(1);
});

test('a wrong password is refused with a message, not a hint', async ({
  member,
  signInPage,
  memberPage,
}) => {
  await signInPage.goto();
  await signInPage.signIn(member.email, 'not-the-password');
  await expect(signInPage.error).toHaveText(/Email or password is incorrect/);
  await expect(memberPage.heading).toBeHidden();
});

test('a response that arrives after switching accounts is ignored', async ({
  page,
  api,
  member,
  goldMember,
  signInPage,
  memberPage,
}) => {
  // Hold the first claim submission until the test says so. Everything else goes through.
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  let holds = 0;
  await page.route('**/api/claims', async (route) => {
    if (route.request().method() === 'POST' && holds++ === 0) await held;
    await route.continue();
  });

  await signInPage.goto();
  await signInPage.signIn(member.email, member.password);
  await memberPage.submitClaim({
    procedureCode: 'PC-1001',
    serviceDate: await api.today(),
    billedAmount: '10.00',
  });

  // The request is in flight. Switch accounts and start typing as the new one.
  await memberPage.signOut();
  await signInPage.signIn(goldMember.email, goldMember.password);
  await expect(memberPage.heading).toBeVisible();
  await memberPage.field('Billed amount (USD)').fill('77.00');

  release();

  // The old account's answer must not reset this form or announce its result here. The
  // claim itself was saved under the first account, which is correct.
  await expect.poll(async () => (await api.listClaims(member)).length, { timeout: 5_000 }).toBe(1);
  await expect(memberPage.field('Billed amount (USD)')).toHaveValue('77.00');
  await expect(memberPage.status).not.toHaveText(/Claim submitted/);
  await expect(memberPage.rows).toHaveCount(0);
});
