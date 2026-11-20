// US-PAT-008: all patient cases, most recently updated first.
import { Link } from 'react-router-dom';
import { api, fmtDay } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { Msg, StatusBadge, useAsync } from '../../components/ui';

const TYPE_KEYS = { CONSULTATION: 'consultation', GMO: 'gmo', SERVICE: 'services' };

export default function MyCases() {
  const { t } = useI18n();
  const { data, err, loading, reload } = useAsync(() => api.get('/cases').then(r => r.data));
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{t('myCases')}</h1>
        <button onClick={reload}>{t('refresh')}</button>
      </div>
      <Msg err={err} />
      {loading && <p>{t('loading')}</p>}
      {data && !data.length && <p className="muted">{t('noItems')}</p>}
      {!!data?.length && (
        <table>
          <thead><tr><th>{t('caseId')}</th><th>{t('type')}</th><th>{t('created')}</th><th>{t('status')}</th><th></th></tr></thead>
          <tbody>
            {data.map(c => (
              <tr key={c.id}>
                <td>{c.case_number}</td>
                <td>{t(TYPE_KEYS[c.service_type])}{c.service_subtype ? ` / ${t(c.service_subtype === 'IN_PERSON' ? 'inPerson' : c.service_subtype === 'FOLLOW_UP' ? 'followUp' : 'online')}` : ''}</td>
                <td>{fmtDay(c.created_at)}</td>
                <td><StatusBadge status={c.status} /></td>
                <td><Link className="btn" to={`/cases/${c.id}`}>{t('view')}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}