// US-PAT-004: three primary service cards + My Cases access. BR-026 catalog gating.
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';

export default function Home() {
  const { t } = useI18n();
  const { session } = useAuth();
  return (
    <div>
      <h1>{t('welcome')}, {session?.profile?.full_name}</h1>
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
      <p><Link className="btn" to="/cases">{t('myCases')} →</Link></p>
    </div>
  );
}