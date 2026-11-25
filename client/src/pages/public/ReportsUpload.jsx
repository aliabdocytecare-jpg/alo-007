// DEC-056: Patient Itemized Reports Request Upload Portal (/upload-reports/:token)
import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api, errMsg } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { Msg } from '../../components/ui';

export default function ReportsUpload() {
  const { token } = useParams();
  const { t, toggle } = useI18n();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploadingIdx, setUploadingIdx] = useState(null);

  const fetchRequest = () => {
    api.get(`/public/reports-request/${token}`)
      .then(r => setData(r.data))
      .catch(e => setErr(errMsg(e) || 'Invalid or expired upload link'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchRequest();
  }, [token]);

  const handleFileUpload = async (index, file) => {
    if (!file) return;
    setErr('');
    setOk('');
    setUploadingIdx(index);

    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('item_index', index);

      await api.post(`/public/reports-request/${token}/upload`, fd);
      setOk(`Uploaded successfully: ${file.name}`);
      fetchRequest();
    } catch (e) {
      setErr(errMsg(e) || 'File upload failed');
    } finally {
      setUploadingIdx(null);
    }
  };

  const header = (
    <div className="row" style={{ justifyContent: 'space-between', borderBottom: '2px solid #000', paddingBottom: 8, marginBottom: 16 }}>
      <strong style={{ letterSpacing: 2 }}>{t('app')}</strong>
      <button onClick={toggle}>{t('language')}</button>
    </div>
  );

  if (loading) return <div className="wrap" style={{ maxWidth: 640 }}>{header}<p>{t('loading')}</p></div>;

  if (err && !data) {
    return (
      <div className="wrap" style={{ maxWidth: 640 }}>
        {header}
        <section className="box">
          <Msg err={err} />
          <p className="muted">This document upload link may have expired or is invalid. Please contact AloDoc coordination.</p>
        </section>
      </div>
    );
  }

  const items = data?.items || [];
  const caseNumber = data?.case_number;

  return (
    <div className="wrap" style={{ maxWidth: 640 }}>
      {header}
      <section className="box">
        <h1>{t('reportsUpload')}</h1>
        <p className="muted">{t('caseId')}: <strong>{caseNumber}</strong></p>
        <p>{t('reportsUploadHelp')}</p>
        {data?.notes && <p className="muted"><strong>ALO Nurse Note:</strong> {data.notes}</p>}

        <Msg err={err} ok={ok} />

        <div style={{ marginTop: 20 }}>
          <h2>{t('reportsChecklist')} ({items.filter(i => i.status === 'received').length}/{items.length})</h2>
          {items.map((item, idx) => (
            <div key={item.id || idx} style={{ border: '1px solid #000', padding: 14, margin: '12px 0', background: item.status === 'received' ? '#f5f5f5' : '#fff' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>
                  {item.name} {item.required && <span style={{ color: '#000', fontWeight: 'bold' }}>*</span>}
                </strong>
                <span className="badge">
                  {item.status === 'received' ? '✓ Received' : item.status === 'waived' ? 'Waived' : 'Pending Upload'}
                </span>
              </div>
              {item.description && <p className="muted" style={{ margin: '6px 0' }}>{item.description}</p>}

              {item.status !== 'received' && item.status !== 'waived' && (
                <div style={{ marginTop: 10 }}>
                  <input
                    type="file"
                    id={`file-input-${idx}`}
                    style={{ display: 'none' }}
                    onChange={e => handleFileUpload(idx, e.target.files?.[0])}
                    disabled={uploadingIdx === idx}
                  />
                  <label htmlFor={`file-input-${idx}`} className="btn" style={{ cursor: 'pointer' }}>
                    {uploadingIdx === idx ? t('loading') : 'Choose & Upload File'}
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
