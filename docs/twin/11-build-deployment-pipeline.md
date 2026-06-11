# AionUi Twin Technical Reconstruction Notes

These notes are source-grounded documentation for `/Users/Antman/Desktop/AionUi_TWIN/AionUi-Twin-main`. They are written for another AI or engineer that needs to reconstruct, audit, optimize, or refactor the project without rereading every source file. Secrets and private credentials are intentionally excluded.

## Build Pipeline

Desktop scripts call `scripts/build-with-builder.js` for macOS, Windows, Linux, and auto arch builds. `electron-vite build` emits main/preload/renderer output into `out/`; electron-builder packages installers under `out/`.

Build plugins: externalizeDepsPlugin, custom MCP server builder, viteStaticCopy for skills/assistants/logos, Icon Park transform plugin, Sentry Vite plugin, UnoCSS.

Builder targets: macOS DMG/ZIP with hardened runtime and entitlements; Windows NSIS/ZIP; Linux DEB. Extra resources include public assets, app icon, bundled Bun, bundled aionrs, and hub resources. Native modules and helper packages are explicitly included/unpacked.

## macOS DMG Recreation

For local unsigned/ad-hoc packaging:

```bash
cd /Users/Antman/Desktop/AionUi_TWIN/AionUi-Twin-main
CSC_IDENTITY_AUTO_DISCOVERY=false bun run build-mac:arm64
cp -f out/AionUi-1.9.22-mac-arm64.dmg ~/Downloads/
shasum -a 256 ~/Downloads/AionUi-1.9.22-mac-arm64.dmg
```

`llama-server` is intentionally not in `electron-builder.yml`; the installed
app resolves it at runtime. This avoids shipping platform-specific llama.cpp
binaries and keeps the app's local model behavior under user control.

Server scripts build `dist-server/server.mjs` and run `server:start:*`. Mobile build scripts wrap Expo local/production profiles.

## Areas for Review

- Publish checksums/SBOMs in CI.
- Test package manifests against actual runtime imports.
- Make server deployment a first-class release artifact.
- Add a package smoke test that opens the built app, loads a local model, and sends a short answer prompt.
