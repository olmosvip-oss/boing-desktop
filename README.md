# Boing for Mac

The Boing desktop app. It opens [app.useboing.com](https://app.useboing.com) in its own native window, with a Dock icon, menus, `boing://` links and automatic updates, and it runs the Boing engine that renders from your DAW.

- **The window loads the live app**, so every Publish in Lovable shows up instantly. No new release needed.
- **The engine ships inside the app.** Each release bundles the signed engine zips that `build_and_ship.sh` makes and useboing.com serves (`Boing.zip`, `Boing-intel.zip`). On first launch of a version the app unpacks its engine with `ditto` (which keeps the Apple signature intact) and starts it in the background. The engine keeps its menu-bar icon for status and licence.
- **Updates carry both.** Installed apps check on launch, every 6 hours, and from **Boing → Check for Updates…**.

There are two builds because the engine is built per chip: `Boing-arm64.dmg` (Apple Silicon) and `Boing-x64.dmg` (Intel). Each updates itself with the matching build.

## One-time setup: GitHub secrets

Same five secrets as `noir-desktop` (same Apple developer account). In this repo: **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | What it is |
|---|---|
| `MAC_CERT_P12_BASE64` | Your **Developer ID Application** certificate as a base64 `.p12` |
| `MAC_CERT_PASSWORD` | The `.p12` password |
| `APPLE_API_KEY_P8` | The full text of your App Store Connect API key (`AuthKey_XXXXXXXXXX.p8`) |
| `APPLE_API_KEY_ID` | The key's ID |
| `APPLE_API_ISSUER` | The Issuer ID from the App Store Connect keys page |

If you saved the values from setting up Noir, reuse them. If not, see the noir-desktop README for how to export them again.

## Make a release

1. **If the engine changed:** run `build_and_ship.sh` on your Mac(s) as usual and upload `Boing.zip` / `Boing-intel.zip` to the downloads storage, as you do today. The release picks up whatever is there.
2. Bump `version` in `package.json` (e.g. `1.0.1`).
3. **Actions → Build Boing for Mac → Run workflow**, tick **Publish** (or push a tag like `v1.0.1`).

The workflow checks both engine zips are signed, notarized and built for the right chip before it builds anything, then signs, notarizes and publishes. Installed apps update themselves.

Download links that always point to the newest version:

```
https://github.com/olmosvip-oss/boing-desktop/releases/latest/download/Boing-arm64.dmg
https://github.com/olmosvip-oss/boing-desktop/releases/latest/download/Boing-x64.dmg
```

To test a signed build without publishing: **Actions → Build Boing for Mac → Run workflow** without ticking Publish. The `.dmg` files appear as a download on that run.

## Run locally

```
npm install
npm start
```

`npm start` doesn't start an engine; run the standalone Boing engine as usual.

## Safety

- The engine only listens on this Mac and only answers `https://app.useboing.com`; this app doesn't change that.
- Only Boing, sign-in, checkout and the Box/Dropbox connection pages open inside the window. Every other link opens in your browser.
- Boing pages get notifications, clipboard writes, fullscreen and local-network access (to reach the engine). Nothing else, and nothing for any other site.
