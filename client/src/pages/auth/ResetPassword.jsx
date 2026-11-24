import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { api, errMsg } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { Msg, Field, PasswordInput } from '../../components/ui';

export default function ResetPassword() {
  const { t, toggle } = useI18n();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [loading, setLoading] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [staffInfo, setStaffInfo] = useState(null);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setErr('No reset token provided. Please use the password reset link from your email.');
      setLoading(false);
      return;
    }

    let active = true;
    api.get(`/auth/reset-validate?token=${encodeURIComponent(token)}`)
      .then(res => {
        if (!active) return;
        setTokenValid(true);
        setStaffInfo(res.data.staff);
        setLoading(false);
      })
      .catch(e => {
        if (!active) return;
        setTokenValid(false);
        setErr(errMsg(e));
        setLoading(false);
      });

    return () => { active = false; };
  }, [token]);

  // Real-time password criteria
  const hasMinLength = password.length >= 10;
  const hasUppercase = /[A-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const isFormValid = hasMinLength && hasUppercase && hasNumber && hasSpecial && passwordsMatch;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isFormValid) {
      setErr('Please ensure your password meets all complexity requirements and matches the confirmation.');
      return;
    }

    setSubmitting(true);
    setErr('');
    try {
      const res = await api.post('/auth/reset-complete', {
        token,
        password,
        confirm_password: confirmPassword
      });

      setOkMsg(res.data?.message || 'Password reset successfully! Redirecting to sign in...');
      setTimeout(() => {
        nav('/login', { replace: true });
      }, 1500);
    } catch (e) {
      setErr(errMsg(e));
      setSubmitting(false);
    }
  };

  return (
    <div className="wrap" style={{ maxWidth: 540, margin: '2rem auto', padding: '0 1rem' }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.6rem' }}>{t('app')}</h1>
        <button type="button" onClick={toggle} style={{ padding: '4px 10px' }}>{t('language')}</button>
      </div>

      <div className="box" style={{ background: '#ffffff', borderRadius: '8px', padding: '1.5rem', boxShadow: '0 2px 10px rgba(0,0,0,0.06)' }}>
        <h2 style={{ marginTop: 0, marginBottom: '0.5rem' }}>{t('resetPassword')}</h2>

        <Msg err={err} ok={okMsg} />

        {loading ? (
          <p style={{ color: '#64748b' }}>{t('loading') || 'Validating reset token...'}</p>
        ) : !tokenValid ? (
          <div style={{ marginTop: '1rem' }}>
            <p style={{ color: '#dc2626', marginBottom: '1.5rem' }}>
              The password reset link is invalid or has expired. Please request a new password reset link from the sign-in page.
            </p>
            <Link to="/login" className="btn" style={{ display: 'inline-block', textDecoration: 'none', padding: '8px 16px', background: '#0284c7', color: '#fff', borderRadius: '4px' }}>
              {t('backToSignIn')}
            </Link>
          </div>
        ) : (
          <div>
            {staffInfo && (
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '0.85rem', marginBottom: '1.25rem' }}>
                <div style={{ fontWeight: 600, fontSize: '1rem', color: '#0f172a' }}>{staffInfo.full_name}</div>
                <div style={{ color: '#64748b', fontSize: '0.9rem', marginTop: '2px' }} dir="ltr">{staffInfo.email}</div>
              </div>
            )}

            <p style={{ color: '#475569', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
              {t('setYourPassword')}
            </p>

            <form onSubmit={handleSubmit}>
              <Field label={t('newPassword')}>
                <PasswordInput
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter new password"
                  dir="ltr"
                  required
                  autoComplete="new-password"
                />
              </Field>

              <Field label={t('confirmPassword')} style={{ marginTop: '0.75rem' }}>
                <PasswordInput
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password to confirm"
                  dir="ltr"
                  required
                  autoComplete="new-password"
                />
              </Field>

              {/* Real-time complexity check */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '0.75rem 1rem', margin: '1rem 0', fontSize: '0.82rem' }}>
                <div style={{ fontWeight: 600, marginBottom: '6px', color: '#334155' }}>Password Requirements:</div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <li style={{ color: hasMinLength ? '#059669' : '#94a3b8' }}>
                    {hasMinLength ? '✓' : '○'} At least 10 characters
                  </li>
                  <li style={{ color: hasUppercase ? '#059669' : '#94a3b8' }}>
                    {hasUppercase ? '✓' : '○'} At least 1 uppercase letter (A-Z)
                  </li>
                  <li style={{ color: hasNumber ? '#059669' : '#94a3b8' }}>
                    {hasNumber ? '✓' : '○'} At least 1 number (0-9)
                  </li>
                  <li style={{ color: hasSpecial ? '#059669' : '#94a3b8' }}>
                    {hasSpecial ? '✓' : '○'} At least 1 special character (!@#$%^&*...)
                  </li>
                  <li style={{ color: passwordsMatch ? '#059669' : '#94a3b8' }}>
                    {passwordsMatch ? '✓' : '○'} Passwords match
                  </li>
                </ul>
              </div>

              <div style={{ marginTop: '1.25rem' }}>
                <button
                  type="submit"
                  disabled={!isFormValid || submitting}
                  style={{
                    width: '100%',
                    padding: '10px 16px',
                    fontSize: '1rem',
                    fontWeight: 600,
                    opacity: isFormValid && !submitting ? 1 : 0.65,
                    cursor: isFormValid && !submitting ? 'pointer' : 'not-allowed'
                  }}
                >
                  {submitting ? 'Updating...' : t('resetPassword')}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
