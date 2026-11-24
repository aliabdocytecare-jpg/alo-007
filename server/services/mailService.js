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
  try {
    await db.from('notification_log').insert({
      event_type: 'STAFF_INVITATION',
      recipient_type: 'staff',
      channel: 'email',
      template_id: 'STAFF_ACTIVATION',
      delivery_status: 'sent',
      detail: { to, fullName, role, messageId: info.messageId }
    });
  } catch (logErr) {
    console.error('[MailService] Failed to log notification_log:', logErr.message);
  }

  return info;
}

// DEC-068: Send password reset email for staff
export async function sendStaffPasswordResetEmail({ to, fullName, token }) {
  const origin = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',')[0].trim();
  const resetUrl = `${origin}/reset-password?token=${encodeURIComponent(token)}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your AloDoc Password</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f7f9fb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f7f9fb; padding: 40px 15px;">
    <tr>
      <td align="center">
        <table width="100%" max-width="580" style="max-width: 580px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 36px 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
          <!-- Header -->
          <tr>
            <td style="padding-bottom: 24px; border-bottom: 2px solid #0f172a;">
              <span style="font-size: 22px; font-weight: 800; letter-spacing: 1px; color: #0f172a;">ALODOC</span>
              <span style="font-size: 13px; color: #64748b; margin-left: 10px;">Security Services</span>
            </td>
          </tr>

          <!-- Body English -->
          <tr>
            <td style="padding-top: 24px; padding-bottom: 20px;">
              <h1 style="margin: 0 0 16px; font-size: 19px; color: #0f172a; font-weight: 700;">Password Reset Request</h1>
              <p style="margin: 0 0 14px; font-size: 14px; line-height: 1.6; color: #334155;">
                Hello <strong>${fullName}</strong>,
              </p>
              <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.6; color: #334155;">
                We received a request to reset the password for your AloDoc staff account (<strong>${to}</strong>).
                Click the button below to choose a new password:
              </p>
              <div style="margin: 24px 0;">
                <a href="${resetUrl}" target="_blank" rel="noopener noreferrer" style="background-color: #0f172a; color: #ffffff; display: inline-block; padding: 13px 28px; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 4px; letter-spacing: 0.2px;">Reset Password</a>
              </div>
              <p style="margin: 0 0 12px; font-size: 12px; line-height: 1.5; color: #64748b;">
                <strong>Security Notice:</strong> This reset link is valid for <strong>1 hour</strong> and can only be used once. If you did not request a password reset, please ignore this email; your account remains secure.
              </p>
              <p style="margin: 0 0 20px; font-size: 12px; line-height: 1.5; color: #64748b;">
                Direct Link: <a href="${resetUrl}" style="color: #0f172a; word-break: break-all;">${resetUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Arabic Section (RTL) -->
          <tr>
            <td dir="rtl" style="padding-top: 20px; border-top: 1px solid #e2e8f0; text-align: right; font-family: 'Segoe UI', Tahoma, Arial, sans-serif;">
              <h2 style="margin: 0 0 12px; font-size: 17px; color: #0f172a; font-weight: 700;">طلب إعادة تعيين كلمة المرور</h2>
              <p style="margin: 0 0 12px; font-size: 13px; line-height: 1.6; color: #334155;">
                مرحبًا <strong>${fullName}</strong>،
              </p>
              <p style="margin: 0 0 16px; font-size: 13px; line-height: 1.6; color: #334155;">
                تلقينا طلبًا لإعادة تعيين كلمة المرور الخاصة بحسابك في منصة ألودوك الطبية. يمكنك استخدام الرابط أعلاه لتعيين كلمة مرور جديدة.
              </p>
              <p style="margin: 0; font-size: 12px; color: #64748b;">
                هذا الرابط صالح لمدة <strong>ساعة واحدة فقط</strong>. إذا لم تكن قد طلبت ذلك، يمكنك تجاهل هذه الرسالة.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top: 24px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center;">
              AloDoc Healthcare Platform · Confidential Medical System · <a href="https://alodoc.online" style="color: #64748b;">alodoc.online</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `AloDoc Healthcare Platform - Password Reset

Hello ${fullName},

We received a request to reset the password for your AloDoc staff account (${to}).
To set a new password, open the link below:

${resetUrl}

This link is valid for 1 hour and can only be used once.
If you did not make this request, you can safely ignore this email.

---
طلب إعادة تعيين كلمة المرور - منصة AloDoc
مرحبًا ${fullName}، الرابط أعلاه صالح لمدة ساعة واحدة فقط.
`;

  const mailer = getMailTransporter();
  const info = await mailer.sendMail({
    from: defaultFrom,
    to,
    subject: `AloDoc Staff: Password Reset Request (${fullName})`,
    text,
    html
  });

  try {
    await db.from('notification_log').insert({
      event_type: 'STAFF_PASSWORD_RESET_REQUESTED',
      recipient_type: 'staff',
      channel: 'email',
      template_id: 'STAFF_PASSWORD_RESET',
      delivery_status: 'sent',
      detail: { to, fullName, messageId: info.messageId }
    });
  } catch (logErr) {
    console.error('[MailService] Failed to log notification_log:', logErr.message);
  }

  return info;
}
