import { ApiClient, ApiError } from './api-client.js';
import { formatCents, parseDollars } from './money.js';

const api = new ApiClient();
const $ = (id) => document.getElementById(id);

let procedureNames = new Map();
let currentUser = null;

// ---------- Views ----------

function showView(name) {
  for (const view of document.querySelectorAll('.view')) {
    view.hidden = view.id !== `view-${name}`;
  }
  $('who').hidden = !currentUser;
  if (currentUser) $('who-name').textContent = currentUser.fullName;
}

function announce(message) {
  $('status').textContent = '';
  // A new value is needed for screen readers to repeat the same text twice in a row.
  requestAnimationFrame(() => ($('status').textContent = message));
}

function setFieldError(inputId, message) {
  const input = $(inputId);
  const error = $(`${inputId}-error`);
  error.textContent = message ?? '';
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
  if (message) input.setAttribute('aria-describedby', error.id);
  else input.removeAttribute('aria-describedby');
}

function clearErrors(form) {
  for (const error of form.querySelectorAll('.error')) error.textContent = '';
  for (const input of form.querySelectorAll('[aria-invalid]')) {
    input.setAttribute('aria-invalid', 'false');
    input.removeAttribute('aria-describedby');
  }
}

function showFirstInvalid(form) {
  form.querySelector('[aria-invalid="true"]')?.focus();
}

// ---------- Sign in ----------

$('sign-in-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  clearErrors(form);
  try {
    currentUser = await api.signIn(form.email.value, form.password.value);
    form.reset();
    await loadProcedureCodes();
    if (currentUser.role === 'member') await showMember();
    else await showAdjuster();
  } catch (error) {
    $('sign-in-error').textContent = describe(error);
  }
});

$('sign-out').addEventListener('click', () => {
  api.signOut();
  currentUser = null;
  showView('sign-in');
  $('email').focus();
});

async function loadProcedureCodes() {
  const codes = await api.procedureCodes();
  procedureNames = new Map(codes.map((c) => [c.code, c.description]));
  const select = $('procedure-code');
  select.replaceChildren(
    new Option('Choose a procedure', ''),
    ...codes.map((c) => new Option(`${c.code} ${c.description}`, c.code)),
  );
}

// ---------- Member ----------

async function showMember() {
  showView('member');
  await renderMemberClaims();
}

async function renderMemberClaims() {
  const claims = await api.listClaims();
  const table = $('member-claims');
  $('member-empty').hidden = claims.length > 0;
  table.hidden = claims.length === 0;
  table.tBodies[0].replaceChildren(...claims.map(memberRow));
}

function memberRow(claim) {
  const row = document.createElement('tr');
  row.dataset.claimId = claim.id;
  row.append(
    cell(formatDate(claim.createdAt)),
    cell(procedureNames.get(claim.procedureCode) ?? claim.procedureCode),
    cell(claim.serviceDate),
    cell(formatCents(claim.billedCents), 'amount'),
    statusCell(claim.status),
    cell(outcome(claim), 'amount'),
  );
  if (claim.status === 'PAID') {
    // The list doesn't carry the payment; fetch it so the member can see what was paid.
    api.getPayment(claim.id).then((payment) => {
      row.lastElementChild.textContent = `Paid ${formatCents(payment.amountCents)}`;
    });
  }
  return row;
}

function outcome(claim) {
  switch (claim.status) {
    case 'APPROVED':
      return `Approved ${formatCents(claim.approvedCents)}`;
    case 'DENIED':
      return `Denied: ${humanize(claim.denialReason)}`;
    case 'PAID':
      return 'Paid';
    default:
      return '';
  }
}

$('claim-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  clearErrors(form);

  const billedCents = parseDollars(form.billedAmount.value);
  if (billedCents === null) {
    setFieldError('billed-amount', 'Enter an amount in dollars, like 125.00.');
    showFirstInvalid(form);
    return;
  }

  try {
    const claim = await api.submitClaim({
      procedureCode: form.procedureCode.value,
      serviceDate: form.serviceDate.value,
      billedCents,
    });
    form.reset();
    announce(`Claim submitted for ${formatCents(claim.billedCents)}.`);
    await renderMemberClaims();
  } catch (error) {
    if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
      setFieldError('procedure-code', error.fields.procedureCode);
      setFieldError('service-date', error.fields.serviceDate);
      setFieldError('billed-amount', error.fields.billedCents);
      $('claim-form-error').textContent = error.fields.member ?? '';
      showFirstInvalid(form);
    } else {
      $('claim-form-error').textContent = describe(error);
    }
  }
});

// ---------- Adjuster ----------

let claimBeingDecided = null;

async function showAdjuster() {
  showView('adjuster');
  await renderAdjusterClaims();
}

async function renderAdjusterClaims() {
  const claims = await api.listClaims();
  const table = $('adjuster-claims');
  $('adjuster-empty').hidden = claims.length > 0;
  table.hidden = claims.length === 0;
  table.tBodies[0].replaceChildren(...claims.map(adjusterRow));
}

function adjusterRow(claim) {
  const row = document.createElement('tr');
  row.dataset.claimId = claim.id;
  row.append(
    cell(formatDate(claim.createdAt)),
    cell(claim.memberId.slice(0, 8)),
    cell(procedureNames.get(claim.procedureCode) ?? claim.procedureCode),
    cell(formatCents(claim.billedCents), 'amount'),
    statusCell(claim.status),
    actionCell(claim),
  );
  return row;
}

function actionCell(claim) {
  const td = document.createElement('td');
  if (claim.status === 'SUBMITTED' || claim.status === 'PENDED') {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Decide';
    button.setAttribute('aria-label', `Decide claim for ${formatCents(claim.billedCents)}`);
    button.addEventListener('click', () => openDecision(claim));
    td.append(button);
  } else if (claim.status === 'APPROVED') {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Record payment';
    button.setAttribute(
      'aria-label',
      `Record payment for claim of ${formatCents(claim.billedCents)}`,
    );
    button.addEventListener('click', () => recordPayment(claim, button));
    td.append(button);
  }
  return td;
}

function openDecision(claim) {
  claimBeingDecided = claim;
  const form = $('decision-form');
  form.reset();
  clearErrors(form);
  $('decision-summary').textContent =
    `${procedureNames.get(claim.procedureCode) ?? claim.procedureCode}, ` +
    `billed ${formatCents(claim.billedCents)}, service date ${claim.serviceDate}.`;
  $('approved-amount').value = (claim.billedCents / 100).toFixed(2);
  syncDecisionFields();
  $('decision-dialog').showModal();
}

function syncDecisionFields() {
  const decision = $('decision-form').decision.value;
  $('approved-field').hidden = decision !== 'APPROVE';
  $('reason-field').hidden = decision !== 'DENY';
}

$('decision-form').addEventListener('change', syncDecisionFields);
$('decision-cancel').addEventListener('click', () => $('decision-dialog').close());

$('decision-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  clearErrors(form);
  const decision = form.decision.value;

  const body = { decision };
  if (decision === 'APPROVE') {
    const cents = parseDollars($('approved-amount').value);
    if (cents === null) {
      setFieldError('approved-amount', 'Enter an amount in dollars, like 125.00.');
      showFirstInvalid(form);
      return;
    }
    body.approvedCents = cents;
  }
  if (decision === 'DENY') body.reasonCode = $('reason-code').value;

  try {
    const updated = await api.decideClaim(claimBeingDecided.id, body);
    $('decision-dialog').close();
    announce(`Claim ${humanize(updated.status).toLowerCase()}.`);
    await renderAdjusterClaims();
  } catch (error) {
    if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
      setFieldError('approved-amount', error.fields.approvedCents);
      setFieldError('reason-code', error.fields.reasonCode);
      showFirstInvalid(form);
    } else {
      $('decision-error').textContent = describe(error);
    }
  }
});

async function recordPayment(claim, button) {
  button.disabled = true;
  try {
    // One key per click. A retry of the same click (network blip) reuses it; a new click gets a new one.
    const payment = await api.recordPayment(claim.id, crypto.randomUUID());
    announce(`Payment of ${formatCents(payment.amountCents)} recorded.`);
    await renderAdjusterClaims();
  } catch (error) {
    button.disabled = false;
    announce(describe(error));
  }
}

// ---------- Helpers ----------

function cell(text, className) {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function statusCell(status) {
  const td = document.createElement('td');
  const badge = document.createElement('span');
  badge.className = 'status';
  badge.dataset.status = status;
  badge.textContent = humanize(status);
  td.append(badge);
  return td;
}

function humanize(code) {
  if (!code) return '';
  return code.charAt(0) + code.slice(1).toLowerCase().replaceAll('_', ' ');
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { dateStyle: 'medium' });
}

function describe(error) {
  if (error instanceof ApiError) {
    return error.correlationId
      ? `${error.message} (reference ${error.correlationId})`
      : error.message;
  }
  return 'Something went wrong. Please try again.';
}

showView('sign-in');
