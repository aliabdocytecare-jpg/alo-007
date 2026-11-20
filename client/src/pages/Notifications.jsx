// In-app notification center (F-NOTIF-02 secondary channel, always real).
import { api, fmtDate } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { Msg, useAsync } from '../components/ui';

export default function Notifications() {
  const { t } = useI18n();
  const { data, err, loading, reload } = useAsync(() => api.get('/notifications').then(r => r.data));
  const markRead = async id => { await api.post(`/notifications/${id}/read`); reload(); };
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{t('notifications')}{data ? ` [${data.unread} ${t('unread')}]` : ''}</h1>
        <button onClick={reload}>{t('refresh')}</button>
      </div>
      <Msg err={err} />
      {loading && <p>{t('loading')}</p>}
      {data && !data.items.length && <p className="muted">{t('noItems')}</p>}
      {data?.items.map(n => (
        <section className="box" key={n.id} style={{ fontWeight: n.is_read ? 400 : 700 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>{n.title}</span>
            <span className="muted">{fmtDate(n.created_at)}</span>
          </div>
          <p style={{ fontWeight: 400 }}>{n.body}</p>
          {!n.is_read && <button onClick={() => markRead(n.id)}>{t('markRead')}</button>}
        </section>
      ))}
    </div>
  );
}