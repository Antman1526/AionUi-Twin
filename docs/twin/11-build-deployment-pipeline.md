# AionUi Twin Technical Reconstruction Notes

These notes are source-grounded documentation for `/Users/Antman/Desktop/AionUi_TWIN/AionUi-Twin-main`. They are written for another AI or engineer that needs to reconstruct, audit, optimize, or refactor the project without rereading every source file. Secrets and private credentials are intentionally excluded.

## Build Pipeline

Desktop scripts call `scripts/build-with-builder.js` for macOS, Windows, Linux, and auto arch builds. `electron-vite build` emits main/preload/renderer output into `out/`; electron-builder packages installers under `out/`.

Build plugins: externalizeDepsPlugin, custom MCP server builder, viteStaticCopy for skills/assistants/logos, Icon Park transform plugin, Sentry Vite plugin, UnoCSS.

Builder targets: macOS DMG/ZIP with hardened runtime and entitlements; Windows NSIS/ZIP; Linux DEB. Extra resources include public assets, app icon, bundled Bun, bundled aionrs, and hub resources. Native modules and helper packages are explicitly included/unpacked.

Server scripts build `dist-server/server.mjs` and run `server:start:*`. Mobile build scripts wrap Expo local/production profiles.

## Areas for Review

- Publish checksums/SBOMs in CI.
- Test package manifests against actual runtime imports.
- Make server deployment a first-class release artifact.
