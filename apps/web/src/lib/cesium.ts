/**
 * Cesium runtime accessor.
 *
 * Cesium is loaded as a UMD global from `/cesium/Cesium.js` by a
 * `<Script id="cesium-umd" strategy="beforeInteractive">` tag in
 * `app/layout.tsx`. Webpack treats `import "cesium"` as that global
 * (see `next.config.mjs` externals). This helper resolves once the
 * global is present and sets the base URL Cesium reads internally.
 *
 * Why: Cesium 1.140's bundled chunks embed draco/ktx2 WebAssembly as
 * template literals containing `\00` legacy octal escapes, which V8
 * refuses to parse ("Octal escape sequences are not allowed in
 * template strings"). Loading the prebuilt UMD sidesteps the parse.
 */
export async function loadCesium(timeoutMs = 15_000): Promise<any> {
  if (typeof window === "undefined") {
    throw new Error("loadCesium called on the server; gate with a client component");
  }
  const w = window as any;
  // Cesium reads CESIUM_BASE_URL internally to locate Workers/Assets/Widgets.
  w.CESIUM_BASE_URL = "/cesium/";
  if (w.Cesium) return w.Cesium;
  const start = Date.now();
  return await new Promise((resolve, reject) => {
    const tick = () => {
      if (w.Cesium) return resolve(w.Cesium);
      if (Date.now() - start > timeoutMs) {
        return reject(
          new Error(
            "Cesium UMD failed to load from /cesium/Cesium.js. Verify the " +
              '<Script id="cesium-umd"> tag in app/layout.tsx and that ' +
              "scripts/copy-cesium-assets.mjs has populated public/cesium/.",
          ),
        );
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}
