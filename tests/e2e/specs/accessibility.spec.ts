import { AxeBuilder } from '@axe-core/playwright';
import { ADJUSTER, expect, test, type Page } from '../fixtures/test.js';

// R8, automated part. Each page state gets an axe scan at WCAG 2.1 A/AA. Zero violations is
// the gate. It is not a claim of full conformance: the manual checks and what they didn't
// cover are in docs/accessibility.md.

async function scan(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return result.violations.map((v) => `${v.id} (${v.impact}) on ${v.nodes.length} node(s)`);
}

test.describe('accessibility', () => {
  test('sign-in page', async ({ page, signInPage }) => {
    await signInPage.goto();
    expect(await scan(page)).toEqual([]);
  });

  test('member page, with and without field errors', async ({
    page,
    signInPage,
    member,
    memberPage,
  }) => {
    await signInPage.goto();
    await signInPage.signIn(member.email, member.password);
    await expect(memberPage.heading).toBeVisible();
    expect(await scan(page)).toEqual([]);

    await memberPage.submitClaim({
      procedureCode: 'PC-1001',
      serviceDate: '2099-01-01',
      billedAmount: 'abc',
    });
    await expect(memberPage.fieldError('billed-amount')).not.toBeEmpty();
    expect(await scan(page)).toEqual([]);
  });

  test('adjuster queue and the decision dialog', async ({
    page,
    signInPage,
    adjusterPage,
    api,
    member,
  }) => {
    const claim = await api.submitClaim(member, 5000);
    await signInPage.goto();
    await signInPage.signIn(ADJUSTER.email, ADJUSTER.password);
    await expect(adjusterPage.row(claim.id)).toBeVisible();
    expect(await scan(page)).toEqual([]);

    await adjusterPage.openDecision(claim.id);
    await expect(adjusterPage.dialog).toBeVisible();
    expect(await scan(page)).toEqual([]);
  });

  test('keyboard: skip link first, then the form, nothing hidden in between', async ({
    page,
    signInPage,
  }) => {
    await signInPage.goto();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Email')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Password')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeFocused();
  });

  test('reflows at 320px without horizontal scrolling', async ({
    page,
    signInPage,
    member,
    memberPage,
    api,
  }) => {
    await api.submitClaim(member, 12500);
    await page.setViewportSize({ width: 320, height: 720 });
    await signInPage.goto();
    await signInPage.signIn(member.email, member.password);
    await expect(memberPage.rows).toHaveCount(1);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
