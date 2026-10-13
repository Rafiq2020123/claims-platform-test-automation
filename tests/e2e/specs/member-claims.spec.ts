import { expect, test } from '../fixtures/test.js';

// R7: the main member journey. Data the member didn't create through the UI (decisions,
// payments) is set up through the API; the UI is tested for what the member sees and does.

test.describe('member claims', () => {
  test.beforeEach(async ({ signInPage, member, memberPage }) => {
    await signInPage.goto();
    await signInPage.signIn(member.email, member.password);
    await expect(memberPage.heading).toBeVisible();
  });

  test('a new member sees an empty history', async ({ memberPage }) => {
    await expect(memberPage.emptyMessage).toBeVisible();
    await expect(memberPage.rows).toHaveCount(0);
  });

  test('submitting a valid claim adds it to the history as Submitted', async ({
    memberPage,
    api,
  }) => {
    await memberPage.submitClaim({
      procedureCode: 'PC-2001',
      serviceDate: await api.today(),
      billedAmount: '125.50',
    });

    await expect(memberPage.status).toHaveText('Claim submitted for $125.50.');
    await expect(memberPage.rows).toHaveCount(1);
    await expect(memberPage.rows.first()).toContainText('Blood panel');
    await expect(memberPage.rows.first()).toContainText('$125.50');
    await expect(memberPage.rows.first()).toContainText('Submitted');
    // The form is ready for the next claim.
    await expect(memberPage.field('Billed amount (USD)')).toHaveValue('');
  });

  test('a malformed amount is rejected before anything is sent', async ({ memberPage, api }) => {
    await memberPage.submitClaim({
      procedureCode: 'PC-1001',
      serviceDate: await api.today(),
      billedAmount: '12.345',
    });

    const amount = memberPage.field('Billed amount (USD)');
    await expect(memberPage.fieldError('billed-amount')).toHaveText(/amount in dollars/);
    await expect(amount).toHaveAttribute('aria-invalid', 'true');
    await expect(amount).toHaveAttribute('aria-describedby', 'billed-amount-error');
    await expect(amount).toBeFocused();
    await expect(memberPage.rows).toHaveCount(0);
  });

  test('server-side validation errors land on the right fields', async ({ memberPage }) => {
    await memberPage.submitClaim({
      procedureCode: 'PC-1001',
      serviceDate: '2099-01-01',
      billedAmount: '100000.01',
    });

    await expect(memberPage.fieldError('service-date')).toHaveText(/cannot be in the future/);
    await expect(memberPage.fieldError('billed-amount')).toHaveText(/\$0\.01 and \$100,000\.00/);
    await expect(memberPage.field('Service date')).toBeFocused();
    await expect(memberPage.rows).toHaveCount(0);
  });

  test('an inactive member is told their coverage is not active', async ({
    api,
    signInPage,
    memberPage,
  }, testInfo) => {
    const inactive = await api.createMember(testInfo.workerIndex, 'SILVER', false);
    await memberPage.signOut();
    await signInPage.signIn(inactive.email, inactive.password);

    await memberPage.submitClaim({
      procedureCode: 'PC-1001',
      serviceDate: await api.today(),
      billedAmount: '50',
    });
    await expect(memberPage.formError).toHaveText(/coverage is not active/);
  });

  test('decisions and payments made elsewhere show up in the history', async ({
    api,
    member,
    signInPage,
    memberPage,
  }) => {
    // Three claims, three outcomes, all arranged through the API. The member then signs in
    // again (the session lives in memory, so a reload would land on the sign-in page).
    const approved = await api.submitClaim(member, 3337);
    await api.approve(approved.id, 3337);
    const denied = await api.submitClaim(member, 5000);
    await api.deny(denied.id, 'OUT_OF_NETWORK');
    const paid = await api.submitClaim(member, 3337);
    await api.approve(paid.id, 3337);
    await api.pay(paid.id);

    await memberPage.signOut();
    await signInPage.signIn(member.email, member.password);
    await expect(memberPage.rows).toHaveCount(3);
    await expect(memberPage.row(approved.id)).toContainText('Approved $33.37');
    await expect(memberPage.row(denied.id)).toContainText('Denied: Out of network');
    // Row 3 of the worked examples: SILVER, 3337 approved -> 670 paid.
    await expect(memberPage.row(paid.id)).toContainText('Paid $6.70');
  });
});
