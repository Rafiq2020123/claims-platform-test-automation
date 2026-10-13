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
