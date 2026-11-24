import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, Link, useNavigate } from 'react-router-dom';
import { api } from './lib/api';
import { useAuth } from './lib/auth';
import { useI18n } from './lib/i18n';
import Login from './pages/Login';
import ActivateAccount from './pages/auth/ActivateAccount';
import Home from './pages/patient/Home';
import Book from './pages/patient/Book';
import MyCases from './pages/patient/MyCases';
import CaseView from './pages/patient/CaseView';
import StaffDashboard from './pages/staff/Dashboard';
import CaseOps from './pages/staff/CaseOps';
import Admin from './pages/admin/Admin';
import Review from './pages/Review';
import Notifications from './pages/Notifications';
import Kiosk from './pages/public/Kiosk';
import WaitingScreen from './pages/public/WaitingScreen';
import PatientTracker from './pages/public/PatientTracker';
import ReportsUpload from './pages/public/ReportsUpload';
import IntlReview from './pages/public/IntlReview';
import HospitalDashboard from './pages/hospital/HospitalDashboard';
import IntlOpinionsQueue from './pages/staff/IntlOpinionsQueue';
import { ErrorBoundary } from './components/ui';

function Layout({ children }) {
  const { session, logout } = useAuth();
  const { t, toggle } = useI18n();
  const nav = useNavigate();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!session) return;
    let live = true;
    const poll = () => api.get('/notifications').then(r => { if (live) setUnread(r.data.unread); }).catch(() => {});
    poll();
    const iv = setInterval(poll, 30_000);
    return () => { live = false; clearInterval(iv); };
  }, [session]);

  const doLogout = async () => { await logout(); nav('/login'); };
  const hospId = session?.hospital_id || session?.profile?.hospital_id || session?.hospital?.id;
  const tenantName = session?.tenant?.name || session?.hospital?.name || 'Hospital Clinic';

  return (
    <>
      <header className="top">
        <Link className="brand" to={session?.kind === 'patient' ? '/' : hospId ? '/hospital' : '/staff'}>
          {t('app')}
        </Link>
        <nav>
          {session?.kind === 'patient' && (<><Link to="/">{t('home')}</Link><Link to="/cases">{t('myCases')}</Link></>)}
          {session?.kind === 'staff' && !hospId && session.role !== 'admin' && (
            <>
              <Link to="/staff">{t('dashboard')}</Link>
              {session.role === 'coordinator' && <Link to="/staff/intl-opinions">{t('intlQueue')}</Link>}
            </>
          )}
          {session?.role === 'admin' && (
            <>
              <Link to="/staff">{t('dashboard')}</Link>
              <Link to="/staff/intl-opinions">{t('intlQueue')}</Link>
              <Link to="/admin">{t('admin')}</Link>
            </>
          )}
          {hospId && (
            <Link to="/hospital">{tenantName}</Link>
          )}
          {session && <Link to="/notifications">{t('notifications')}{unread > 0 ? ` [${unread}]` : ''}</Link>}
        </nav>
        <span className="spacer" />
        <button onClick={toggle}>{t('language')}</button>
        {session && <span className="muted">{session.profile?.full_name || session.email}</span>}
        {session && <button onClick={doLogout}>{t('logout')}</button>}
      </header>
      <main className="wrap">{children}</main>
    </>
  );
}

function Guard({ roles, children }) {
  const { session } = useAuth();
  const { t } = useI18n();
  if (session === undefined) return <Layout><p>{t('loading')}</p></Layout>;
  if (!session) return <Navigate to="/login" replace />;
  const hospId = session.hospital_id || session.profile?.hospital_id || session.hospital?.id;
  if (roles && !roles.includes(session.role) && !roles.includes(session.kind)) {
    const dest = session.kind === 'patient'
      ? '/'
      : hospId
        ? '/hospital'
        : session.role === 'admin'
          ? '/admin'
          : '/staff';
    return <Navigate to={dest} replace />;
  }
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        {/* Public & Specialist Routes (No Auth Required) */}
        <Route path="/login" element={<Login />} />
        <Route path="/activate-account" element={<ActivateAccount />} />
        <Route path="/kiosk" element={<Kiosk />} />
        <Route path="/screen" element={<WaitingScreen />} />
        <Route path="/screen/:pin" element={<WaitingScreen />} />
        <Route path="/p/:code" element={<PatientTracker />} />
        <Route path="/upload-reports/:token" element={<ReportsUpload />} />
        <Route path="/review/:token" element={<Review />} />
        <Route path="/review/intl/:token" element={<IntlReview />} />

        {/* Patient Portal */}
        <Route path="/" element={<Guard roles={['patient']}><Home /></Guard>} />
        <Route path="/book" element={<Guard roles={['patient']}><Book /></Guard>} />
        <Route path="/cases" element={<Guard roles={['patient']}><MyCases /></Guard>} />
        <Route path="/cases/:id" element={<Guard roles={['patient']}><CaseView /></Guard>} />

        {/* Staff & Admin Portals */}
        <Route path="/notifications" element={<Guard><Notifications /></Guard>} />
        <Route path="/staff" element={<Guard roles={['nurse', 'coordinator', 'doctor', 'admin']}><StaffDashboard /></Guard>} />
        <Route path="/staff/cases/:id" element={<Guard roles={['nurse', 'coordinator', 'doctor', 'admin']}><CaseOps /></Guard>} />
        <Route path="/staff/intl-opinions" element={<Guard roles={['coordinator', 'admin']}><IntlOpinionsQueue /></Guard>} />
        <Route path="/admin" element={<Guard roles={['admin']}><Admin /></Guard>} />

        {/* Hospital Clinic Portal */}
        <Route path="/hospital" element={<Guard roles={['hospital_admin', 'doctor', 'reception', 'lab', 'pharmacy']}><HospitalDashboard /></Guard>} />
        <Route path="/hospital/*" element={<Guard roles={['hospital_admin', 'doctor', 'reception', 'lab', 'pharmacy']}><HospitalDashboard /></Guard>} />

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
