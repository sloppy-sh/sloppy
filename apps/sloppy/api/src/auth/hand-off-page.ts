/**
 * The one page this API renders, and only for a target no `Location` header
 * reliably reaches: Chrome on Android refuses a scripted cross-scheme
 * navigation without a user gesture, and blocks the redirect too. So the app is
 * offered as an `intent://` link — which Chrome does honour — with a tap as the
 * guaranteed path and an automatic attempt for the browsers that allow one.
 */

const ANDROID_PACKAGE = "sh.sloppy.app";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

export function handOffPage(
  target: string,
  fallbackUrl: string,
  heading: string,
): string {
  const query = new URL(target).search;
  const intent =
    `intent://auth/callback${query}#Intent;scheme=sloppy;package=${ANDROID_PACKAGE};` +
    `S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end`;

  return `<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="0;url=${escapeHtml(target)}">
<title>${escapeHtml(heading)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         font: 16px/1.5 system-ui, sans-serif; padding: 24px; }
  main { max-width: 22rem; text-align: center; }
  h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.5rem; }
  p { margin: 0 0 1.5rem; opacity: 0.7; }
  a { display: inline-block; padding: 0.75rem 1.5rem; border-radius: 999px;
      background: CanvasText; color: Canvas; text-decoration: none; font-weight: 600; }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(heading)}</h1>
<p>Sloppy should open on its own. If it doesn't, open it here.</p>
<a id="open" href="${escapeHtml(target)}">Open Sloppy</a>
</main>
<script>
(function () {
  var link = document.getElementById('open');
  if (/Android/i.test(navigator.userAgent)) link.href = ${JSON.stringify(intent)};
  setTimeout(function () { try { link.click(); } catch (e) {} }, 50);
})();
</script>
</body>
</html>`;
}
