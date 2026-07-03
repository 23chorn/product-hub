/** Strip a leading YAML frontmatter block (`--- ... ---`) from raw markdown content. */
export function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

/**
 * Open a clean print window from the rendered HTML of a content element.
 * The new window uses simple element-targeted CSS so output looks clean
 * regardless of the Tailwind classes that won't transfer.
 */
export function printArtifact(contentEl: HTMLElement, title: string): void {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${title.replace(/</g, '&lt;')}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;line-height:1.6;color:#111;max-width:820px;margin:0 auto;padding:40px 32px}
  h1{font-size:1.45em;font-weight:700;margin:1.6em 0 .5em;border-bottom:1px solid #e0e0e0;padding-bottom:.3em}
  h1:first-child{margin-top:0}
  h2{font-size:1.2em;font-weight:700;margin:1.4em 0 .4em;border-bottom:1px solid #ececec;padding-bottom:.2em}
  h3{font-size:1em;font-weight:600;margin:1.2em 0 .35em}
  h4{font-size:.82em;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#666;margin:1em 0 .3em}
  p{margin:.55em 0}
  ul,ol{margin:.5em 0;padding-left:1.6em}
  li{margin:.2em 0}
  table{width:100%;border-collapse:collapse;margin:.8em 0;font-size:.9em}
  th{background:#f4f4f4;font-weight:600;text-align:left;padding:6px 10px;border:1px solid #ccc}
  td{padding:5px 10px;border:1px solid #d5d5d5;vertical-align:top}
  code{font-family:'Menlo','Consolas',monospace;font-size:.85em;background:#f3f3f3;padding:1px 4px;border-radius:3px;color:#c7254e}
  pre{background:#f8f8f8;border:1px solid #e0e0e0;border-radius:4px;padding:12px;margin:.8em 0;overflow-x:auto}
  pre code{background:none;padding:0;color:inherit;font-size:.9em}
  blockquote{margin:.8em 0;padding:3px 0 3px 14px;border-left:3px solid #ccc;color:#555;font-style:italic}
  hr{border:none;border-top:1px solid #e5e5e5;margin:1.5em 0}
  a{color:#2563eb}
  strong{font-weight:600}
  img{max-width:100%}
  @media print{body{padding:16px}a{color:#000;text-decoration:none}}
</style>
</head>
<body>${contentEl.innerHTML}</body>
</html>`);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 250);
}

/** Copy text to clipboard, with a textarea fallback for non-secure contexts (e.g. HTTP production). */
export function copyToClipboard(text: string): void {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text);
    return;
  }
  const el = document.createElement('textarea');
  el.value = text;
  el.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
}
