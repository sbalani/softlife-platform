# More Ice Theme Builder

Vendored from `https://github.com/sbalani/more-ice-theme-builder` at commit
`ffc31d2`.

SoftLife integration changes:

- Added a restrictive Content Security Policy for the embedded app.
- Added early file type, per-file size, and aggregate package size checks.
- Reused and revoked preview object URLs to avoid leaking browser memory.
- Improved small-screen layout and status-message accessibility.

The builder runs locally in the browser. It does not upload theme data or media.
