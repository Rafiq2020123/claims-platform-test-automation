import { ADJUSTER, expect, test, type Fixtures } from '../fixtures/test.js';

// The adjuster journey: decide, then pay. Amounts come from the worked examples in
// docs/business-rules.md, not from reading what the app shows and writing it down.
// Claims are created through the API first, then the adjuster signs in and sees them.

test.describe('adjuster queue', () => {
  async function signInAsAdjuster({
    signInPage,
    adjusterPage,
  }: Pick<Fixtures, 'signInPage' | 'adjusterPage'>) {
    await signInPage.goto();
    await signInPage.signIn(ADJUSTER.email, ADJUSTER.password);
    await expect(adjusterPage.heading).toBeVisible();
  }

  test('approve, then record a payment, and see the computed amount', async ({
    api,
    goldMember,
    signInPage,
    adjusterPage,
  }) => {
    // Row 9 of the worked examples: GOLD, 2505 approved -> 2255 paid. The .5 cent case.
    const claim = await api.submitClaim(goldMember, 2505);
    await signInAsAdjuster({ signInPage, adjusterPage });

    await adjusterPage.approve(claim.id, '25.05');
    await expect(adjusterPage.status).toHaveText('Claim approved.');
    await expect(adjusterPage.row(claim.id)).toContainText('Approved');

    await adjusterPage.recordPayment(claim.id);
    await expect(adjusterPage.status).toHaveText('Payment of $22.55 recorded.');
    await expect(adjusterPage.row(claim.id)).toContainText('Paid');
    await expect(adjusterPage.row(claim.id).getByRole('button')).toHaveCount(0);
  });

  test('an approved amount above the billed amount is refused in the dialog', async ({
    api,
    member,
    signInPage,
    adjusterPage,
  }) => {
    const claim = await api.submitClaim(member, 12500);
    await signInAsAdjuster({ signInPage, adjusterPage });

    await adjusterPage.approve(claim.id, '125.01');
    await expect(adjusterPage.dialogError('approved-amount')).toHaveText(/no more than the billed/);
    await expect(adjusterPage.dialog).toBeVisible();
    await expect(adjusterPage.dialog.getByLabel('Approved amount (USD)')).toBeFocused();
  });

  test('denying needs a reason, and the reason is shown', async ({
    api,
    member,
    signInPage,
    adjusterPage,
  }) => {
    const claim = await api.submitClaim(member, 5000);
    await signInAsAdjuster({ signInPage, adjusterPage });

    await adjusterPage.deny(claim.id, '');
    await expect(adjusterPage.dialogError('reason-code')).toHaveText(/Reason must be one of/);

    await adjusterPage.dialog.getByLabel('Reason').selectOption('DUPLICATE_CLAIM');
    await adjusterPage.dialog.getByRole('button', { name: 'Save decision' }).click();
    await expect(adjusterPage.status).toHaveText('Claim denied.');
    await expect(adjusterPage.row(claim.id)).toContainText('Denied');
    await expect(adjusterPage.row(claim.id).getByRole('button')).toHaveCount(0);
  });

  test('a pended claim can still be decided later', async ({
    api,
    member,
    signInPage,
    adjusterPage,
  }) => {
    const claim = await api.submitClaim(member, 5000);
    await signInAsAdjuster({ signInPage, adjusterPage });

    await adjusterPage.openDecision(claim.id);
    await adjusterPage.dialog.getByRole('radio', { name: 'Pend' }).check();
    await adjusterPage.dialog.getByRole('button', { name: 'Save decision' }).click();
    await expect(adjusterPage.row(claim.id)).toContainText('Pended');

    await adjusterPage.approve(claim.id);
    await expect(adjusterPage.row(claim.id)).toContainText('Approved');
  });
});
