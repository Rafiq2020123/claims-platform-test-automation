import type { Locator, Page } from '@playwright/test';

export class AdjusterPage {
  readonly heading: Locator;
  readonly dialog: Locator;
  readonly status: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Claims queue' });
    this.dialog = page.getByRole('dialog');
    this.status = page.locator('#status');
  }

  row(claimId: string): Locator {
    return this.page.locator(`#adjuster-claims tr[data-claim-id="${claimId}"]`);
  }

  async openDecision(claimId: string): Promise<void> {
    await this.row(claimId)
      .getByRole('button', { name: /^Decide/ })
      .click();
  }

  async approve(claimId: string, amount?: string): Promise<void> {
    await this.openDecision(claimId);
    await this.dialog.getByRole('radio', { name: 'Approve' }).check();
    if (amount !== undefined) await this.dialog.getByLabel('Approved amount (USD)').fill(amount);
    await this.dialog.getByRole('button', { name: 'Save decision' }).click();
  }

  async deny(claimId: string, reason: string): Promise<void> {
    await this.openDecision(claimId);
    await this.dialog.getByRole('radio', { name: 'Deny' }).check();
    await this.dialog.getByLabel('Reason').selectOption(reason);
    await this.dialog.getByRole('button', { name: 'Save decision' }).click();
  }

  async recordPayment(claimId: string): Promise<void> {
    await this.row(claimId)
      .getByRole('button', { name: /^Record payment/ })
      .click();
  }

  dialogError(id: 'approved-amount' | 'reason-code'): Locator {
    return this.page.locator(`#${id}-error`);
  }
}
