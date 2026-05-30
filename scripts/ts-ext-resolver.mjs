// Module resolution hook for the Node built-in test runner under
// `--experimental-strip-types`. Node's type stripping does NOT auto-append a
// `.ts` extension to relative imports, but app source (e.g. src/lib/order-totals.ts
// importing "./money" / "./freight") uses extensionless imports that Next's
// bundler resolves at build time. This hook lets a test import such modules
// directly by retrying an extensionless relative specifier with a `.ts`
// extension. Test-only; never part of the app build.
export async function resolve(specifier, context, next) {
  const isRelative =
    specifier.startsWith("./") || specifier.startsWith("../");
  const hasExt = /\.[mc]?[jt]s$/.test(specifier);
  if (isRelative && !hasExt) {
    try {
      return await next(specifier + ".ts", context);
    } catch {
      // fall through to the default resolution below
    }
  }
  return next(specifier, context);
}
