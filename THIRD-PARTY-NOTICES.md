# Third-party code and replaceable HEIC decoder

The extension bundles PDF.js (Apache-2.0), docx-preview (Apache-2.0),
DOMPurify (Apache-2.0 OR MPL-2.0), JSZip (MIT OR GPL-3.0), pako (MIT/Zlib),
and fflate 0.8.3 (MIT). Their license texts are in `vendor/`.

PowerPoint parsing and static SVG rendering use @web-ppt/core 0.4.5
(MIT, unStone/web-ppt). Its license is `vendor/web-ppt-core-LICENSE.txt`.
The library and worker are bundled locally; no Office Online service is used.

HEIC decoding uses heic-to 1.6.5 (LGPL-3.0), which includes libheif and
libde265. The upstream license is `vendor/heic-to-LICENSE.txt`.
`vendor/heic.worker.js` is a separately loaded, replaceable decoder file.
You may replace it with a compatible modified decoder; no integrity check
or signature prevents replacement. The extension's wrapper sends
`{id, buffer}` and expects `{id, imageData}` or `{id, error}`.

The exact upstream CSP distribution used for extraction is included as
`vendor/heic-to-upstream-source.txt`. Our extraction and pixel limit
modification are in `scripts/heic-worker.mjs` in the source package.
`vendor/heic-to-source.zip` includes the upstream JavaScript source and
build script, plus our extraction helper. Corresponding C/C++ sources are
provided as `vendor/libheif-1.23.5-source.tar.gz` and
`vendor/libde265-1.0.16-source.tar.gz`; the upstream README gives the
Emscripten build commands. The tarballs retain their own license notices.
Install the locked dependencies with `npm ci --ignore-scripts`, then run
`npm run build` to recreate the decoder and extension. No Blob code worker,
`eval`, or `new Function` is used to load this decoder.

Upstream source, included decoder source, and build instructions:

- https://github.com/hoppergee/heic-to (the pinned npm 1.6.5 distribution is authoritative)
- https://github.com/strukturag/libheif (libheif, LGPL-3.0)
- https://github.com/strukturag/libde265 (libde265, LGPL-3.0)
- https://github.com/catdad-experiments/libheif-js (JavaScript decoder build instructions)

The LGPL permits modification and redistribution subject to its conditions.
The source package includes the wrapper/build changes. Keep these notices
and the upstream license when redistributing, and supply the corresponding
decoder sources for any changed decoder you distribute.
