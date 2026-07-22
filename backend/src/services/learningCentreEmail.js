import nodemailer from 'nodemailer';

const escapeHtml = (value = '') => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const baseUrl = () => (process.env.FRONTEND_URL || 'https://snuggleup.co.za').replace(/\/+$/, '');

export async function sendLearningCentreReportEmail({ article, action = 'draft created', notes = '' }) {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  if (!user || !pass) return { skipped: true, reason: 'Email not configured' };
  const port = Number(process.env.EMAIL_PORT || 465);
  const transporter = nodemailer.createTransport({ host: process.env.EMAIL_HOST || 'smtpout.secureserver.net', port, secure: port === 465, auth: { user, pass }, tls: { rejectUnauthorized: false } });
  const to = process.env.LEARNING_CENTRE_REPORT_EMAIL || 'support@snuggleup.co.za';
  const logo = process.env.SNUGGLEUP_LOGO_URL || `${baseUrl()}/images/SnuggleUp%20Logo%20-%20Smaller.png`;
  const adminUrl = `${baseUrl()}/#/admin`;
  const subject = `Learning Centre: ${action} - ${article.title}`;
  const html = `<div style="background:#f7fbfa;padding:28px 16px;font-family:Arial,sans-serif;color:#1f2933"><div style="max-width:620px;margin:auto;background:#fff;border:1px solid #dbe8e4;border-radius:10px;overflow:hidden"><div style="text-align:center;padding:25px 25px 8px"><img src="${escapeHtml(logo)}" alt="SnuggleUp Baby Store" style="max-width:210px;width:70%"></div><div style="padding:8px 32px 30px"><h1 style="color:#126f71;text-align:center;font-size:24px">Learning Centre update</h1><p>A Learning Centre article has been ${escapeHtml(action)}.</p><div style="background:#f7fbfa;border:1px solid #dbe8e4;border-radius:8px;padding:18px"><p style="font-size:13px;color:#607276;margin:0 0 5px">Article</p><p style="color:#126f71;font-weight:700;font-size:19px;margin:0">${escapeHtml(article.title)}</p><p style="margin:15px 0 0">Status: <strong>${escapeHtml(article.status || 'draft')}</strong></p>${notes ? `<p>${escapeHtml(notes)}</p>` : ''}</div><p style="text-align:center;margin:25px 0 4px"><a href="${escapeHtml(adminUrl)}" style="background:#126f71;color:#fff;text-decoration:none;padding:13px 24px;border-radius:999px;font-weight:bold">Open Learning Centre</a></p></div></div></div>`;
  const info = await transporter.sendMail({ from: process.env.EMAIL_FROM || 'SnuggleUp <support@snuggleup.co.za>', to, subject, text: `${subject}\nOpen your SnuggleUp superuser dashboard: ${adminUrl}`, html });
  return { success: true, messageId: info.messageId };
}
