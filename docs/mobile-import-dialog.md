# Mobile backup import dialog regression

The `fix/mobile-backup-import-dialog` branch initially pointed at the same commit
as `main` (`c1d5b87`). There were no branch-only fixes to retain.

The shared Modal was rendered inside `.page-enter`. Its animation uses a
transform with `fill-mode: both`, creating a containing block for fixed children
and a stacking context below the mobile navigation. Raising the dialog's z-index
inside that context cannot fix it.

Modal now renders through a body portal. Its overlay follows the visual viewport
(resize and scroll), with vh/dvh fallbacks and safe-area padding. The header and
footer do not shrink; only the middle section scrolls. The application root position is locked
while open and restored, including scroll position, on close. Long download
button labels wrap on narrow screens. Storage and import handlers are unchanged.

Run `npm ci`, `npx playwright install --with-deps`, `npm test`, and
`npm run test:browser`. The configuration includes desktop/mobile Chromium,
Firefox and WebKit plus iPhone 13 WebKit and Pixel 5 Chromium device profiles.

`tests/browser/import-dialog.spec.js` checks:

- Actual action-button bounds and hit testing (including the navigation layer),
  without relying on Playwright automatically scrolling a button into view.
- 320×568, 390×664, 390×844, 844×390 and 1280×900 viewports; resizing while open.
- Independent content scrolling, stationary footer, long text, page lock and
  restored page scroll position, with opening animations enabled.
- Readonly cancellation, exact downloaded pre-import snapshot, mandatory
  download and both checkboxes, revoking consent and resetting it on reopen.
- Confirmed import and an exact automatic recovery snapshot.

Playwright WebKit on Linux emulates the iPhone viewport, touch, scale and user
agent. It does not run iOS Safari's browser chrome or a physical device's home
indicator. Check address-bar expansion/collapse, safe-area and rotation on a real
iPhone before release. Android testing here is Chromium device emulation too.

The Linux WebKit mobile emulator can retain stale fixed-layer hit testing when
setViewportSize resizes a loaded document before the dialog opens. This was
reproduced on plain HTML with a single fixed button, without the application.
The existing static-size cancellation test now reloads at its target viewport.
The separate regression still resizes the open dialog and checks actual hits.
