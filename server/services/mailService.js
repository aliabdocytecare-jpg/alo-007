// DEC-067: SMTP Mail Service for Staff Onboarding, Account Activation & Notifications
import nodemailer from 'nodemailer';
import { db } from '../config/db.js';

const host = process.env.SMTP_HOST || 'mail.salemcctv.com';
const port = parseInt(process.env.SMTP_PORT || '465', 10);
const secure = process.env.SMTP_SECURE !== 'false';
const user = process.env.SMTP_USER || 'alo-testing@salemcctv.com';
const pass = process.env.SMTP_PASS || '@Opinion007';
const defaultFrom = process.env.SMTP_FROM || 'AloDoc Verification <verify@alodoc.online>';

let transporter = null;

export function getMailTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      tls: {
        rejectUnauthorized: false
      }
    });
  }
  return transporter;
}

/**
 * Verifies SMTP connection without sending any email.
 */
export async function verifySmtpConnection() {
  const mailer = getMailTransporter();
  return mailer.verify();
}

/**
 * Sends a staff invitation & account activation email.
 */
export async function sendStaffActivationEmail({ to, fullName, role, token }) {
  const origin = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',')[0].trim();
  const activationUrl = `${origin}/activate-account?token=${encodeURIComponent(token)}`;

  const roleLabelsEn = {
    admin: 'Administrator',
    doctor: 'Doctor / Clinician',
    nurse: 'Triage Nurse',
    coordinator: 'Care Coordinator'
  };

  const roleLabelsAr = {
    admin: 'مسؤول النظام',
    doctor: 'طبيب استشاري',
    nurse: 'ممرض فرز',
    coordinator: 'منسق رعاية'
  };

  const roleNameEn = roleLabelsEn[role] || role;
  const roleNameAr = roleLabelsAr[role] || role;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AloDoc Staff Account Activation</title>
</head>
<body style="margin: 0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f7f7f7; color: #111111;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 580px; background: #ffffff; border: 1px solid #e2e2e2; border-radius: 6px; padding: 32px;">
          <!-- Header -->
          <tr>
            <td style="padding-bottom: 24px; border-bottom: 2px solid #111111;">
              <h1 style="margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.5px;">AloDoc Healthcare Platform</h1>
              <p style="margin: 4px 0 0; font-size: 13px; color: #666666;">Medical Coordination & Day-Clinic Operations</p>
            </td>
          </tr>

          <!-- English Section -->
          <tr>
            <td style="padding-top: 24px;">
              <h2 style="margin: 0 0 12px; font-size: 18px; font-weight: 600;">Staff Account Invitation</h2>
              <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.5; color: #222222;">
                Hello <strong>${fullName}</strong>,
              </p>
              <p style="margin: 0 0 16px; font-size: 14px; line-height: 1.6; color: #333333;">
                You have been invited to join the AloDoc healthcare coordination platform as a <strong>${roleNameEn}</strong>.
                To verify your email address and set your private confidential password, click the button below:
              </p>
              <div style="text-align: center; margin: 28px 0;">
                <!--[if mso]>
                <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${activationUrl}" style="height:44px;v-text-anchor:middle;width:260px;" arcsize="10%" strokecolor="#111111" fillcolor="#111111">
                <w:anchorlock/>
                <center style="color:#ffffff;font-family:sans-serif;font-size:14px;font-weight:bold;">Activate Account & Set Password</center>
                </v:roundrect>
                <![endif]-->
                <a href="${activationUrl}" target="_blank" rel="noopener noreferrer" style="background-color: #111111; color: #ffffff; display: inline-block; padding: 13px 28px; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 4px; letter-spacing: 0.2px;">Activate Account & Set Password</a>
              </div>
              <p style="margin: 0 0 12px; font-size: 12px; line-height: 1.5; color: #666666;">
                <strong>Security Notice:</strong> This activation link is valid for <strong>24 hours</strong> and can only be used once. For your privacy, administrators never have access to your password.
              </p>
              <p style="margin: 0 0 20px; font-size: 12px; line-height: 1.5; color: #777777;">
                If the button above does not work, copy and paste this link into your browser:<br>
                <a href="${activationUrl}" style="color: #111111; word-break: break-all;">${activationUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Arabic Section (RTL) -->
          <tr>
            <td dir="rtl" style="text-align: right; padding-top: 20px; border-top: 1px solid #eeeeee;">
              <h2 style="margin: 0 0 12px; font-size: 16px; font-weight: 600;">دعوة تفعيل حساب الموظف</h2>
              <p style="margin: 0 0 12px; font-size: 14px; line-height: 1.6; color: #333333;">
                مرحبًا <strong>${fullName}</strong>،<br>
                تمت دعوتك للانضمام إلى منصة AloDoc الطبية بصفة <strong>${roleNameAr}</strong>.
                لتأكيد بريدك الإلكتروني وتعيين كلمة المرور الخاصة بك، يرجى استخدام الرابط أعلاه.
              </p>
              <p style="margin: 0; font-size: 12px; color: #777777;">
                هذا الرابط صالح لمدة 24 ساعة وصالح للاستخدام لمرة واحدة فقط.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top: 24px; border-top: 1px solid #eeeeee; font-size: 11px; color: #888888; text-align: center;">
              AloDoc Healthcare Platform · Confidential Medical System · <a href="https://alodoc.online" style="color: #666666;">alodoc.online</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `AloDoc Healthcare Platform - Staff Account Invitation

Hello ${fullName},

You have been invited to join AloDoc as a ${roleNameEn}.
To verify your email address and set your confidential password, open the link below:

${activationUrl}

This activation link is valid for 24 hours and can only be used once.
Administrators never have access to your password.

---
دعوة تفعيل حساب الموظف - منصة AloDoc
مرحبًا ${fullName}، تمت دعوتك للانضمام إلى المنصة بصفة ${roleNameAr}.
الرابط أعلاه صالح لمدة 24 ساعة فقط.
`;

  const mailer = getMailTransporter();
  const info = await mailer.sendMail({
    from: defaultFrom,
    to,
    subject: `AloDoc Staff Invitation: Activate your account (${fullName})`,
    text,
    html
  });

  // Log in notification_log
  await db.from('notification_log').insert({
    event_type: 'STAFF_INVITATION',
    recipient_type: 'staff',
    channel: 'email',
    template_id: 'STAFF_ACTIVATION',
    delivery_status: 'sent',
    detail: { to, fullName, role, messageId: info.messageId }
  }).catch(() => {});

  return info;
}
