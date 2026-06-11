# Code signing

By default the release workflow produces **unsigned** installers. On first launch users
will see Windows SmartScreen ("Windows protected your PC" → *More info* → *Run anyway*) or
macOS Gatekeeper (right‑click → *Open*). Signing removes those warnings.

To enable signing in CI, add the secrets below **and** uncomment the matching `env:`
block on the *Build installers* step in `.github/workflows/release.yml`:

```yaml
      - name: Build installers
        run: npm run ${{ matrix.target }}
        env:
          CSC_LINK: ${{ secrets.CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
```

> Only add that `env:` block once the secrets actually exist — passing an empty
> `CSC_LINK` makes electron-builder treat `""` as a certificate path and fail the macOS
> build. With no block (the default), builds are unsigned and always succeed.

## Windows (Authenticode)

1. Obtain a code‑signing certificate (OV or EV) as a `.pfx`/`.p12` file.
2. Base64‑encode it: `base64 -w0 cert.pfx` (or `certutil -encode` on Windows).
3. Add repository secrets (**Settings → Secrets and variables → Actions**):
   - `CSC_LINK` — the base64 string (or an https URL to the cert)
   - `CSC_KEY_PASSWORD` — the certificate password

## macOS (Developer ID + notarization)

1. Export your *Developer ID Application* certificate from Keychain as a `.p12`.
2. Base64‑encode it and add:
   - `CSC_LINK` — base64 of the `.p12`
   - `CSC_KEY_PASSWORD` — its password
3. For notarization, also add:
   - `APPLE_ID` — your Apple ID email
   - `APPLE_APP_SPECIFIC_PASSWORD` — an app‑specific password from appleid.apple.com
   - `APPLE_TEAM_ID` — your 10‑character Team ID

`electron-builder` signs and notarizes automatically when these are present.

## Local signed builds

Set the same variables in your shell before `npm run dist`:

```bash
export CSC_LINK=...      # base64 or path to cert
export CSC_KEY_PASSWORD=...
npm run dist
```

If none are set, `npm run dist` still works and yields unsigned installers.
