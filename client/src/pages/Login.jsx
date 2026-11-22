// US-PAT-001/002 (patient OTP) + F-AUTH-03 (staff). Mock hint shown when enabled.
import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { Msg, Field } from '../components/ui';

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
  const [hospPhone, setHospPhone] = useState('');
  const [hospOtp, setHospOtp] = useState('');
  const [hospOtpSent, setHospOtpSent] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (session) {
    return <Navigate to={session.kind === 'patient' ? '/' : session.hospital_id ? '/hospital' : session.role === 'admin' ? '/admin' : '/staff'} replace />;
  }

  const sendOtp = async () => {
    setBusy(true); setErr('');
    try {
      const { data } = await api.post('/auth/send-otp', { phone });
      setOtpSent(true); setExists(data.exists); setMock(data.mock);
    } catch (e) { setErr(errMsg(e)); }
    setBusy(false);
  };

  const finish = async () => {
    setBusy(true); setErr('');
    try {
      if (exists) await api.post('/auth/verify-otp', { phone, otp });
      else await api.post('/auth/register', { phone, otp, ...reg });
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
    } catch (e) { setErr(errMsg(e)); }
    setBusy(false);
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
        <button className={tab === 'patient' ? 'active' : ''} onClick={() => { setTab('patient'); setErr(''); }}>{t('patientLogin')}</button>
        <button className={tab === 'staff' ? 'active' : ''} onClick={() => { setTab('staff'); setErr(''); }}>{t('staffLogin')}</button>
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
                    <Field label={t('email')}><input type="email" value={reg.email} onChange={e => setReg({ ...reg, email: e.target.value })} /></Field>
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
      {tab === 'staff' && (
        <section className="box">
          <Field label={t('email')}><input value={staff.email} onChange={e => setStaff({ ...staff, email: e.target.value })} dir="ltr" /></Field>
          <Field label={t('password')}><input type="password" value={staff.password} onChange={e => setStaff({ ...staff, password: e.target.value })} dir="ltr" /></Field>
          <div className="row" style={{ marginTop: 10 }}><button onClick={staffLogin} disabled={busy}>{t('login')}</button></div>
        </section>
      )}
    </div>
  );
}