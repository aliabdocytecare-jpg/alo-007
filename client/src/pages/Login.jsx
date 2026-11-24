// US-PAT-001/002 (patient OTP) + F-AUTH-03 (staff). Mock hint shown when enabled.
import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { Msg, Field, PasswordInput } from '../components/ui';

export default function Login() {
  const { t, toggle } = useI18n();
  const { session, refresh } = useAuth();
  const nav = useNavigate();
  const [tab, setTab] = useState('patient');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [exists, setExists] = useState(false);
  const [mock, setMock] = useState(false);
  const [reg, setReg] = useState({ full_name: '', dob: '', gender: '', nationality: '', email: '' });
  const [staff, setStaff] = useState({ email: '', password: '' });
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSuccess, setForgotSuccess] = useState('');
  const [hospPhone, setHospPhone] = useState('');
  const [hospOtp, setHospOtp] = useState('');
  const [hospOtpSent, setHospOtpSent] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (session) {
    const hospId = session.hospital_id || session.profile?.hospital_id || session.hospital?.id;
    return <Navigate to={session.kind === 'patient' ? '/' : hospId ? '/hospital' : session.role === 'admin' ? '/admin' : '/staff'} replace />;
  }

  const sendOtp = async () => {
    setBusy(true); setErr('');
    try {
      const trimmedPhone = phone.trim();
      const { data } = await api.post('/auth/send-otp', { phone: trimmedPhone });
      setOtpSent(true);
      // DEC-071: Robustly resolve patient existence (supports both data.exists and !data.isNew)
      const patientExists = data.exists !== undefined ? Boolean(data.exists) : !data.isNew;
      setExists(patientExists);
      if (data.phone) setPhone(data.phone);
      setMock(data.mock);
    } catch (e) { setErr(errMsg(e)); }
    setBusy(false);
  };

  const finish = async () => {
    setBusy(true); setErr('');
    try {
      const trimmedPhone = phone.trim();
      if (exists) {
        await api.post('/auth/verify-otp', { phone: trimmedPhone, otp });
      } else {
        try {
          await api.post('/auth/register', { phone: trimmedPhone, otp, ...reg });
        } catch (regErr) {
          // DEC-071: Fallback safety net — if account already exists (409), automatically verify OTP and sign in
          if (regErr.response?.status === 409 || regErr.response?.data?.code === 'ACCOUNT_EXISTS') {
            await api.post('/auth/verify-otp', { phone: trimmedPhone, otp });
          } else {
            throw regErr;
          }
        }
      }
      await refresh();
      nav('/', { replace: true });
    } catch (e) { setErr(errMsg(e)); }
    setBusy(false);
  };

  const staffLogin = async () => {
    setBusy(true); setErr('');
    try {
      const { data } = await api.post('/auth/staff-login', staff);
      await refresh();
      nav(data.role === 'admin' ? '/admin' : '/staff', { replace: true });
    } catch (e) {
      if (e.response?.data?.code === 'EMAIL_NOT_VERIFIED') {
        setErr(e.response?.data?.error || 'Email not verified. Please activate your account via the invitation link sent to your email.');
      } else {
        setErr(errMsg(e));
      }
    }
    setBusy(false);
  };

  const sendResetLink = async () => {
    if (!forgotEmail?.trim()) {
      setErr('Please enter your email address.');
      return;
    }
    setBusy(true); setErr(''); setForgotSuccess('');
    try {
      const res = await api.post('/auth/forgot-password', { email: forgotEmail });
      setForgotSuccess(res.data?.message || t('resetLinkSent') || 'Password reset link sent to your email.');
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const sendHospOtp = async () => {
    setBusy(true); setErr('');
    try {
      await api.post('/auth/staff/otp/send', { phone: hospPhone });
      setHospOtpSent(true);
    } catch (e) { setErr(errMsg(e)); }
    setBusy(false);
  };

  const verifyHospOtp = async () => {
    setBusy(true); setErr('');
    try {
      await api.post('/auth/staff/otp/verify', { phone: hospPhone, otp: hospOtp });
      await refresh();
      nav('/hospital', { replace: true });
    } catch (e) { setErr(errMsg(e)); }
    setBusy(false);
  };

  return (
    <div className="wrap" style={{ maxWidth: 560 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{t('app')}</h1>
        <button onClick={toggle}>{t('language')}</button>
      </div>
      <div className="tabs">
        <button className={tab === 'patient' ? 'active' : ''} onClick={() => { setTab('patient'); setErr(''); setForgotMode(false); }}>{t('patientLogin')}</button>
        <button className={tab === 'staff' ? 'active' : ''} onClick={() => { setTab('staff'); setErr(''); setForgotMode(false); }}>{t('staffLogin')}</button>
        <button className={tab === 'hospital' ? 'active' : ''} onClick={() => { setTab('hospital'); setErr(''); }}>Hospital Clinic (OTP)</button>
      </div>
      <Msg err={err} />
      {tab === 'hospital' && (
        <section className="box">
          <h2>Hospital Clinic Staff Sign-In</h2>
          <p className="muted">Saudi day-clinic doctors, receptionists, lab technicians, and pharmacists authenticate via WhatsApp OTP.</p>
          <Field label={t('phone')}>
            <input value={hospPhone} onChange={e => setHospPhone(e.target.value)} placeholder="05XXXXXXXX or +9665XXXXXXXX" dir="ltr" disabled={hospOtpSent} />
          </Field>
          {!hospOtpSent && (
            <div className="row" style={{ marginTop: 12 }}>
              <button disabled={busy || !hospPhone} onClick={sendHospOtp}>
                {busy ? t('loading') : 'Send WhatsApp OTP'}
              </button>
            </div>
          )}
          {hospOtpSent && (
            <>
              <Field label={t('otp')}>
                <input value={hospOtp} onChange={e => setHospOtp(e.target.value)} placeholder="6-digit code" dir="ltr" />
              </Field>
              <div className="row" style={{ marginTop: 12 }}>
                <button disabled={busy || hospOtp.length < 4} onClick={verifyHospOtp}>
                  {busy ? t('loading') : 'Verify & Enter Clinic Portal'}
                </button>
                <button type="button" className="btn" onClick={() => { setHospOtpSent(false); setHospOtp(''); }}>Change Phone</button>
              </div>
            </>
          )}
        </section>
      )}
      {tab === 'patient' && (
        <section className="box">
          <Field label={t('phone')}>
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+9665XXXXXXXX" dir="ltr" disabled={otpSent} />
          </Field>
          {!otpSent && <p className="muted" style={{ marginTop: 4 }}>{t('phoneHint')}</p>}
          {!otpSent && <div className="row" style={{ marginTop: 10 }}><button onClick={sendOtp} disabled={busy || !phone}>{t('sendOtp')}</button></div>}
          {otpSent && (
            <>
              {/* DEC-043: make the register-vs-sign-in state explicit — new patients must register. */}
              <h2>{exists ? t('returningPatientHeading') : t('newPatientHeading')}</h2>
              {!exists && <p className="muted">{t('newPatientHint')}</p>}
              {mock && <p className="muted">{t('mockHint')}</p>}
              <Field label={t('otp')}>
                <input value={otp} onChange={e => setOtp(e.target.value)} dir="ltr" maxLength={6} />
              </Field>
              {!exists && (
                <>
                  <Field label={`${t('fullName')} *`}><input value={reg.full_name} onChange={e => setReg({ ...reg, full_name: e.target.value })} /></Field>
                  <div className="grid2">
                    <Field label={t('dob')}><input type="date" value={reg.dob} onChange={e => setReg({ ...reg, dob: e.target.value })} /></Field>
                    <Field label={t('gender')}>
                      <select value={reg.gender} onChange={e => setReg({ ...reg, gender: e.target.value })}>
                        <option value="">—</option><option value="FEMALE">{t('female')}</option><option value="MALE">{t('male')}</option>
                      </select>
                    </Field>
                  </div>
                  <div className="grid2">
                    <Field label={t('nationality')}><input value={reg.nationality} onChange={e => setReg({ ...reg, nationality: e.target.value })} /></Field>
                    <Field label={t('emailOptional')}><input type="email" value={reg.email} onChange={e => setReg({ ...reg, email: e.target.value })} /></Field>
                  </div>
                </>
              )}
              <div className="row" style={{ marginTop: 10 }}>
                <button onClick={finish} disabled={busy || !otp}>{exists ? t('verify') : t('register')}</button>
                <button onClick={() => { setOtpSent(false); setOtp(''); }}>{t('back')}</button>
              </div>
            </>
          )}
        </section>
      )}
      {tab === 'staff' && !forgotMode && (
        <section className="box">
          <Field label={t('email')}>
            <input
              value={staff.email}
              onChange={e => setStaff({ ...staff, email: e.target.value })}
              dir="ltr"
              placeholder="staff@hospital.com"
            />
          </Field>
          <Field label={t('password')}>
            <PasswordInput
              value={staff.password}
              onChange={e => setStaff({ ...staff, password: e.target.value })}
              dir="ltr"
            />
          </Field>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
            <button
              type="button"
              onClick={() => { setForgotMode(true); setErr(''); setForgotSuccess(''); setForgotEmail(staff.email || ''); }}
              style={{ background: 'none', border: 'none', color: '#0284c7', padding: '4px 0', fontSize: '0.88rem', textDecoration: 'underline', cursor: 'pointer' }}
            >
              {t('forgotPassword')}
            </button>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button onClick={staffLogin} disabled={busy}>{t('login')}</button>
          </div>
        </section>
      )}
      {tab === 'staff' && forgotMode && (
        <section className="box">
          <h2>{t('forgotPassword')}</h2>
          <p className="muted" style={{ fontSize: '0.9rem', marginBottom: '1rem' }}>
            Enter your registered staff email address. We will send you a secure link to reset your password.
          </p>
          {forgotSuccess ? (
            <div>
              <div style={{ background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', borderRadius: 6, padding: '0.85rem', marginBottom: '1.25rem', fontSize: '0.92rem' }}>
                ✓ {forgotSuccess}
              </div>
              <button type="button" onClick={() => { setForgotMode(false); setForgotSuccess(''); setErr(''); }}>
                ← {t('backToSignIn')}
              </button>
            </div>
          ) : (
            <>
              <Field label={t('email')}>
                <input
                  value={forgotEmail}
                  onChange={e => setForgotEmail(e.target.value)}
                  dir="ltr"
                  placeholder="staff@hospital.com"
                  disabled={busy}
                  autoFocus
                />
              </Field>
              <div className="row" style={{ marginTop: 14, gap: 10 }}>
                <button onClick={sendResetLink} disabled={busy || !forgotEmail.trim()}>
                  {busy ? t('loading') : t('sendResetLink')}
                </button>
                <button type="button" className="btn" onClick={() => { setForgotMode(false); setErr(''); }}>
                  {t('backToSignIn')}
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}