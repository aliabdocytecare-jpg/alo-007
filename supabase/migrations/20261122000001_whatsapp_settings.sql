-- DEC-051/053: WhatsApp Cloud API settings — both channels OFF by default.
-- No schema change: system_settings already exists (20261120000001_schema.sql).
-- Values are edited from Admin > WhatsApp; the admin save path upserts on demand,
-- so this migration only guarantees the defaults exist on a clean install.
-- Login OTP and status updates are switched independently: OTP can be live while
-- updates stay off, so testing a case flow never bills a message per transition.
-- otp_verification (AUTHENTICATION, en_US + ar) is already APPROVED on the WABA.
insert into system_settings (key, value) values
 ('whatsapp_otp_enabled', 'false'),
 ('whatsapp_notify_enabled', 'false'),
 ('whatsapp_api_version', 'v27.0'),
 ('whatsapp_otp_template', 'otp_verification'),
 ('whatsapp_otp_template_lang', 'en_US'),
 ('whatsapp_otp_profile_lang', 'true'),
 ('whatsapp_notify_template', ''),
 ('whatsapp_notify_template_lang', 'en_US'),
 ('whatsapp_waba_id', ''),
 ('whatsapp_phone_number_id', ''),
 ('whatsapp_token', '')
on conflict (key) do nothing;
