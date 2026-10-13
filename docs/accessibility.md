# Accessibility: what was checked, and what wasn't

Automated checks are a floor, not a certificate. This records the manual checks done on the
ClaimPay UI, with the date and build, so a reader knows exactly what "accessible" means here.

## Automated (in the gate)

`tests/e2e/specs/accessibility.spec.ts` runs axe-core (WCAG 2.1 A and AA rules) on the sign-in
page, the member page with and without field errors, the adjuster queue, and the open decision
dialog. Zero violations is required for a merge. It also checks the tab order on the sign-in page
and that the member page reflows at 320px without horizontal scrolling.

## Manual, 2026-10-13, commit of PR 7, Chromium

| Check | Result |
|---|---|
| Every control reachable and operable by keyboard alone (Tab, Shift+Tab, Enter, Space, arrow keys in radio groups) | Pass. Skip link is the first stop. The decision dialog traps focus while open and returns focus to the page on close. |
| Visible focus indicator on every focusable element | **Found and fixed.** The original amber outline (`#e8a317`) was 2.2:1 against white, under the 3:1 non-text minimum, and axe does not check focus indicators. Changed to `#b45309` (5.0:1 on white, 4.7:1 on the grey band). The 2px offset keeps the outline on the page background rather than on the control. |
| Form errors: announced, tied to their field, focus moved to the first problem | Pass. `aria-invalid` and `aria-describedby` are set; the field receives focus. |
| Results announced without a page change (claim submitted, decision saved, payment recorded) | Pass, via the polite live region. |
| 200% browser zoom | Pass. No clipped text, no overlap; tables scroll inside their own labelled region. |
| 320px viewport (WCAG 1.4.10 reflow) | Pass, same mechanism as zoom. |
| Colour contrast of text and controls | Pass. Body text 14.8:1, muted text 6.5:1 (6.0:1 on the grey band), button text on blue 7.3:1, error red 7.4:1, link/accent text 7.3:1. Calculated from the CSS values, not estimated. |
| Status conveyed by more than colour | Pass. Status badges carry the word, not only a colour. |
| Page title, landmarks, heading order | Pass. One `h1` per view, `main` landmark, labelled table regions. |

## Not checked

- Screen reader testing with NVDA, JAWS or VoiceOver. The markup is written for it, but no
  session with a screen reader has been run yet.
- Windows High Contrast / forced-colours mode.
- Firefox and WebKit. They can be run locally (`npx playwright test --project=firefox`) but
  aren't in the gate.
- The `<dialog>` element's behaviour in browsers older than 2022.

Until the first two are done, this app should be described as "built to WCAG 2.1 AA and
automatically checked", not as "WCAG 2.1 AA conformant".
