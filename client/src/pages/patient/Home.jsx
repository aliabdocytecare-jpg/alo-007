// US-PAT-004: three primary service cards + My Cases access. BR-026 catalog gating.
// DEC-070: Active Case Live Courier Tracking Card at top of home screen
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { useAsync } from '../../components/ui';
import CaseStepper from '../../components/CaseStepper';

export default function Home() {
  const { t, lang } = useI18n();
  const { session } = useAuth();
  const { data: cases } = useAsync(() => api.get('/cases').then(r => r.data || []), []);

  const activeCase = (cases || []).find(c => !['COMPLETED', 'CANCELLED'].includes(c.status));

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>{t('welcome')}, {session?.profile?.full_name}</h1>
        <Link className="btn" to="/cases">{t('myCases')} →</Link>
      </div>

      {/* DEC-070: Live Courier Tracking Card for active case */}
      {activeCase && (
        <section className="box" style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '12px', padding: '1.25rem', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
            <div>
              <span style={{ fontSize: '0.8rem', color: '#0284c7', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {lang === 'ar' ? 'متابعة الحالة الجارية' : 'Active Case Live Tracking'}
              </span>
              <h2 style={{ margin: '2px 0 0', fontSize: '1.25rem' }}>
                {activeCase.case_number} {activeCase.specialty ? `· ${activeCase.specialty}` : ''}
              </h2>
            </div>
            <Link to={`/cases/${activeCase.id}`} className="btn" style={{ padding: '6px 14px', fontSize: '0.88rem' }}>
              {lang === 'ar' ? 'عرض تفاصيل الحالة ←' : 'View Full Case →'}
            </Link>
          </div>

          <CaseStepper workflow={activeCase.workflow} status={activeCase.status} compact={false} />

          {activeCase.status === 'ADDITIONAL_INFO_REQUIRED' && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px', padding: '10px 14px', marginTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <span style={{ color: '#b45309', fontSize: '0.88rem', fontWeight: 600 }}>
                ⚠️ {lang === 'ar' ? 'يوجد مستندات طبية مطلوبة لمتابعة حالتك' : 'Additional medical documents requested by the clinical team'}
              </span>
              <Link to={`/cases/${activeCase.id}`} className="btn" style={{ background: '#d97706', borderColor: '#d97706', color: '#fff', padding: '4px 10px', fontSize: '0.82rem' }}>
                {lang === 'ar' ? 'رفع المستندات الآن' : 'Upload Reports Now'}
              </Link>
            </div>
          )}
        </section>
      )}

      <h2>{lang === 'ar' ? 'الخدمات الطبية' : 'Healthcare Services'}</h2>
      <div className="cards">
        <Link className="card" to="/book?type=CONSULTATION">
          <h2>1. {t('consultation')}</h2>
          <p>{t('consultationDesc')}</p>
        </Link>
        <Link className="card" to="/book?type=GMO">
          <h2>2. {t('gmo')}</h2>
          <p>{t('gmoDesc')}</p>
        </Link>
        <Link className="card" to="/book?type=SERVICE">
          <h2>3. {t('services')}</h2>
          <p>{t('servicesDesc')}</p>
        </Link>
      </div>
    </div>
  );
}