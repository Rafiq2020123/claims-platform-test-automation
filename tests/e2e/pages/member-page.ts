import type { Locator, Page } from '@playwright/test';

export class MemberPage {
  readonly heading: Locator;
  readonly form: Locator;
  readonly formError: Locator;
  readonly emptyMessage: Locator;
  readonly status: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'My claims' });
    this.form = page.locator('#claim-form');
    this.formError = page.locator('#claim-form-error');
    this.emptyMessage = page.locator('#member-empty');
    this.status = page.locator('#status');
  }

  async submitClaim(input: {
    procedureCode: string;
    serviceDate: string;
    billedAmount: string;
  }): Promise<void> {
    await this.page.getByLabel('Procedure').selectOption(input.procedureCode);
    await this.page.getByLabel('Service date').fill(input.serviceDate);
    await this.page.getByLabel('Billed amount (USD)').fill(input.billedAmount);
    await this.page.getByRole('button', { name: 'Submit claim' }).click();
  }

  field(label: 'Procedure' | 'Service date' | 'Billed amount (USD)'): Locator {
    return this.page.getByLabel(label);
  }

  fieldError(id: 'procedure-code' | 'service-date' | 'billed-amount'): Locator {
    return this.page.locator(`#${id}-error`);
  }

  get rows(): Locator {
    return this.page.locator('#member-claims tbody tr');
  }

  row(claimId: string): Locator {
    return this.page.locator(`#member-claims tr[data-claim-id="${claimId}"]`);
  }

  async signOut(): Promise<void> {
    await this.page.getByRole('button', { name: 'Sign out' }).click();
  }
}
