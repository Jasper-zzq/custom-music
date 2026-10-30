# Third-party source

The five `vendor/*.cjs` files are copies of `Music_Free/*.js` from:

- Repository: https://github.com/Huibq/keep-alive
- Author: Huibq
- Commit: e5db6948c54c6e601393a5209118e531753b60a8
- Retrieved: 2026-10-30
- Change: extension `.js` → `.cjs` only, to preserve CommonJS in an ESM project.

The inspected upstream snapshot does not include a LICENSE file. This local project is for the user's personal study/use; no redistribution rights or project-wide license are asserted. Preserve upstream notices. Other installed dependencies retain their respective licenses.

The upstream checkout is available beside this project at `../keep-alive` for comparison. The app is self-contained and runs from its vendored snapshot.


## Additional allPlugins.json entries

The following snapshots were downloaded on 2026-10-30 from the exact URLs referenced by Huibq's `Music_Free/allPlugins.json`:

`https://gitee.com/maotoumao/MusicFreePlugins/raw/v0.1/dist/{name}/index.js`

Names: audiomack, bilibili, geciwang, geciqianxun, kuaishou, maoerfm, navidrome, yinyuetai, webdav, youtube. Author: 猫头猫 / maotoumao. Local filenames: `vendor/{name}.cjs`. Runtime version fields are shown in the UI; several are newer than the subscription JSON's version labels.

Local compatibility adjustments:
- The loader injects isolated per-plugin `env.getUserVariables()` and suppresses upstream debug output (Navidrome otherwise logs credentials).
- WebDAV propagates directory/authentication failures instead of silently reporting an empty successful result.
- Navidrome treats missing search arrays as empty and exports its existing album-detail function.
- The host implements media-header/Range forwarding and HLS playlist rewriting; no vendored download or payment restrictions are removed.

Source URLs and local snapshot hashes are recorded in `vendor/manifest.json`.
