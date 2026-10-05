/**
 * Minimal DOM helpers. `html` escapes every interpolated value unless it is
 * wrapped in `raw()`, so user-entered CRM data can't inject markup.
 */
const RAW = Symbol('raw');

export function raw(value) {
  return { [RAW]: true, value: String(value) };
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function render(value) {
  if (value === null || value === undefined || value === false) return '';
  if (Array.isArray(value)) return value.map(render).join('');
  if (typeof value === 'object' && value[RAW]) return value.value;
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => {
    out += render(v) + strings[i + 1];
  });
  return raw(out);
}

/** Renders the help-article markdown subset: paragraphs, numbered steps, bullets and **bold**. */
export function markdown(md) {
  const inline = (text) => escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const blocks = md.trim().split(/\n\s*\n/);
  return raw(
    blocks
      .map((block) => {
        const lines = block.split('\n');
        if (lines.every((l) => /^\s*\d+\.\s/.test(l))) {
          return `<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+\.\s/, ''))}</li>`).join('')}</ol>`;
        }
        if (lines.every((l) => /^\s*-\s/.test(l))) {
          return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*-\s/, ''))}</li>`).join('')}</ul>`;
        }
        return `<p>${inline(lines.join(' '))}</p>`;
      })
      .join(''),
  );
}

export function mount(element, content) {
  element.innerHTML = render(content);
}

export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}
