/** The fluid, email-safe card used by the paid business publication email. */
export function renderSalentoEmail(content: string) {
  return `<div style="margin:0;padding:32px 16px;background:#f4ede3;color:#243b34;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#fffdf9;border:1px solid #e5d9cc;border-radius:18px;overflow:hidden"><tr><td style="padding:30px 32px 18px;font-family:Georgia,'Times New Roman',serif;font-size:25px;font-weight:bold;color:#243b34">Salento Local</td></tr><tr><td style="padding:10px 32px 34px;font-size:16px;line-height:1.6">${content}</td></tr></table></td></tr></table></div>`;
}

export function escapeEmailHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export function renderSalentoEmailButton(url: string, label: string) {
  return `<a href="${escapeEmailHtml(url)}" style="display:inline-block;background:#2a6257;border-radius:9px;color:#ffffff;padding:13px 20px;text-decoration:none;font-weight:bold">${escapeEmailHtml(label)}</a>`;
}
