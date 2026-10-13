import type { Locator, Page } from '@playwright/test';

export class SignInPage {
  readonly heading: Locator;
  readonly error: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Sign in' });
    this.error = page.locator('#sign-in-error');
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
  }

  async signIn(email: string, password: string): Promise<void> {
    await this.page.getByLabel('Email').fill(email);
    await this.page.getByLabel('Password').fill(password);
    await this.page.getByRole('button', { name: 'Sign in' }).click();
  }
}
