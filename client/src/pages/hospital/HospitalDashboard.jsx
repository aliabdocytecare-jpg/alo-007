// DEC-056: Unified Day-Clinic Hospital Operations Portal
// Reception, Doctor Consultation, Lab Workbench, Pharmacy Dispensing & Admin Desk
import { useState, useEffect } from 'react';
import { api, errMsg, fmtDate } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { Msg, Field, StatusBadge, ActionButton } from '../../components/ui';

export default function HospitalDashboard() {
  const { session } = useAuth();
  const { t } = useI18n();

  // Role auto-selection & tab isolation (DEC-066)
  const userRole = session?.role || 'hospital_admin';
  const roleTabsMap = {
    doctor: ['doctor'],
    reception: ['reception'],
    lab: ['lab'],
    pharmacy: ['pharmacy'],
    hospital_admin: ['reception', 'doctor', 'lab', 'pharmacy', 'hospital_admin'],
    admin: ['reception', 'doctor', 'lab', 'pharmacy', 'hospital_admin']
  };
  const allowedTabs = roleTabsMap[userRole] || ['reception'];
  const defaultTab = userRole === 'hospital_admin' ? 'hospital_admin' : (allowedTabs.includes(userRole) ? userRole : allowedTabs[0]);

  const [tab, setTab] = useState(defaultTab);
  const [specialtiesList, setSpecialtiesList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  // 1. Reception State
  const [queue, setQueue] = useState({ scheduled: [], arrived: [], in_clinic: [], done: [] });
  const [checkinCode, setCheckinCode] = useState('');
  const [newPatient, setNewPatient] = useState({ mrn: '', full_name: '', phone: '', dob: '', gender: 'MALE' });
  const [showNewPatient, setShowNewPatient] = useState(false);

  // 2. Doctor Desk State
  const [activeCase, setActiveCase] = useState(null);
  const [doctorOpinion, setDoctorOpinion] = useState('');
  const [testCatalogue, setTestCatalogue] = useState([]);
  const [selectedTestId, setSelectedTestId] = useState('');
  const [newMed, setNewMed] = useState({ drug_name: '', dosage: '', frequency: 'Once daily', duration_days: 7 });
  const [intlOpinionForm, setIntlOpinionForm] = useState({ specialty: '', clinical_question: '', consented_by_name: '', patient_consent: false, urgency: 'routine' });
  const [showIntlModal, setShowIntlModal] = useState(false);

  // 3. Lab State
  const [labTests, setLabTests] = useState([]);
  const [selectedLabTest, setSelectedLabTest] = useState(null);
  const [labResultData, setLabResultData] = useState('');
  const [isAbnormal, setIsAbnormal] = useState(false);
  const [isCritical, setIsCritical] = useState(false);
  const [amendReason, setAmendReason] = useState('');
  const [newTest, setNewTest] = useState({ name: '', category: 'Hematology', specimen_type: 'Blood', description: '' });

  // 4. Pharmacy State
  const [rxQueue, setRxQueue] = useState([]);
  const [dispenseNote, setDispenseNote] = useState('');

  // 5. Admin State
  const [staffList, setStaffList] = useState([]);
  const [slotTemplates, setSlotTemplates] = useState([]);
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [newStaff, setNewStaff] = useState({
    full_name: '',
    role: 'doctor',
    specialty: 'General Practice',
    phone: '',
    preferred_lang: 'en'
  });

  // Search & Print Enhancements (DEC-063)
  const [receptionSearch, setReceptionSearch] = useState('');
  const [doctorSearch, setDoctorSearch] = useState('');
  const [tubeLabelTest, setTubeLabelTest] = useState(null);
  const [receptionCases, setReceptionCases] = useState([]);
  const [selectedReceptionCase, setSelectedReceptionCase] = useState(null);

  const reloadData = async () => {
    setErr('');
    try {
      api.get('/specialties').then(r => setSpecialtiesList(r.data || [])).catch(() => {});
      if (tab === 'reception' || tab === 'doctor') {
        const [qRes, cRes] = await Promise.all([
          api.get('/hospital/reception/queue'),
          tab === 'reception' ? api.get('/hospital/cases').catch(() => ({ data: { cases: [] } })) : Promise.resolve(null)
        ]);
        setQueue(qRes.data.queue || {});
        if (cRes) setReceptionCases(cRes.data.cases || []);
      }
      if (tab === 'doctor' || tab === 'lab' || tab === 'hospital_admin') {
        const catRes = await api.get('/hospital/test-catalogue').catch(() => ({ data: { catalogue: [] } }));
        setTestCatalogue(catRes.data.catalogue || []);
      }
      if (tab === 'lab') {
        const labRes = await api.get('/hospital/lab/tests');
        setLabTests(labRes.data.tests || []);
      }
      if (tab === 'pharmacy') {
        const rxRes = await api.get('/hospital/pharmacy/queue');
        setRxQueue(rxRes.data.queue || []);
      }
      if (tab === 'hospital_admin') {
        const sRes = await api.get('/hospital/staff').catch(() => ({ data: { staff: [] } }));
        setStaffList(sRes.data.staff || []);
        const tRes = await api.get('/hospital/slot-templates').catch(() => ({ data: { templates: [] } }));
        setSlotTemplates(tRes.data.templates || []);
      }
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reloadData();
  }, [tab]);

  // Reception check-in handler
  const doCheckin = async (e, overrideCode) => {
    e?.preventDefault();
    const code = (overrideCode || checkinCode || '').trim().toUpperCase();
    if (!code) return;
    setErr(''); setOk('');
    try {
      const { data } = await api.post('/hospital/reception/checkin', { checkin_code: code });
      setOk(`Patient checked in! Queue Number: ${data.queue_number}`);
      setCheckinCode('');
      reloadData();
    } catch (e) { setErr(errMsg(e)); }
  };

  // Lab / Hospital Admin: Add Lab Test to Hospital Catalogue
  const addLabTest = async (e) => {
    e?.preventDefault();
    if (!newTest.name.trim()) return;
    setErr(''); setOk('');
    try {
      await api.post('/hospital/test-catalogue', {
        name: newTest.name.trim(),
        category: newTest.category.trim() || 'General',
        specimen_type: newTest.specimen_type.trim() || 'Blood',
        description: newTest.description.trim() || null
      });
      setOk(`Lab test "${newTest.name.trim()}" added to hospital catalogue.`);
      setNewTest({ name: '', category: 'Hematology', specimen_type: 'Blood', description: '' });
      reloadData();
    } catch (e) { setErr(errMsg(e)); }
  };

  // Create walk-in patient
  const createPatient = async (e) => {
    e?.preventDefault();
    setErr(''); setOk('');
    try {
      const { data } = await api.post('/hospital/patients', newPatient);
      // Automatically create a clinic case for them
      await api.post('/hospital/cases', {
        hospital_patient_id: data.patient.id,
        service_type: 'in_person',
        case_summary: 'Clinic Walk-in Consultation',
        general_consent: true
      });
      setOk(`Patient registered: ${data.patient.full_name} (${data.patient.mrn})`);
      setShowNewPatient(false);
      setNewPatient({ mrn: '', full_name: '', phone: '', dob: '', gender: 'MALE' });
      reloadData();
    } catch (e) { setErr(errMsg(e)); }
  };

  // Doctor: call patient in
  const callPatient = async (caseId) => {
    setErr('');
    try {
      await api.post('/hospital/reception/arrival', { case_id: caseId, arrival_status: 'in_clinic' });
      const cRes = await api.get(`/hospital/cases/${caseId}`);
      setActiveCase(cRes.data.case);
      setDoctorOpinion(cRes.data.case?.doctor_opinion || '');
      reloadData();
    } catch (e) { setErr(errMsg(e)); }
  };

  // Doctor: save opinion & complete case
  const saveOpinion = async () => {
    if (!activeCase) return;
    setErr(''); setOk('');
    try {
      const { data } = await api.post(`/hospital/cases/${activeCase.id}/opinion`, {
        doctor_opinion: doctorOpinion.trim() || 'Consultation completed.',
        completed: true
      });
      setOk(`Consultation saved (Status: ${data.case?.status || 'completed'}).`);
      setActiveCase(null);
      reloadData();
    } catch (e) { setErr(errMsg(e)); throw e; }
  };

  // Doctor: Order Lab Test
  const orderLab = async () => {
    if (!activeCase || !selectedTestId) return;
    setErr(''); setOk('');
    try {
      const { data } = await api.post('/hospital/lab/tests', {
        hospital_case_id: activeCase.id,
        test_catalogue_id: selectedTestId,
        priority: 'routine'
      });
      setOk(`Lab test ordered. Specimen ID: ${data.test.specimen_id}`);
      setSelectedTestId('');
      const cRes = await api.get(`/hospital/cases/${activeCase.id}`);
      setActiveCase(cRes.data.case);
    } catch (e) { setErr(errMsg(e)); throw e; }
  };

  // Doctor: Prescribe Medication
  const addPrescription = async (e) => {
    e?.preventDefault();
    if (!activeCase || !newMed.drug_name) return;
    setErr(''); setOk('');
    try {
      await api.post(`/hospital/cases/${activeCase.id}/medications`, newMed);
      setOk(`Prescribed: ${newMed.drug_name}`);
      setNewMed({ drug_name: '', dosage: '', frequency: 'Once daily', duration_days: 7 });
      const cRes = await api.get(`/hospital/cases/${activeCase.id}`);
      setActiveCase(cRes.data.case);
    } catch (e) { setErr(errMsg(e)); }
  };

  const openReceptionCase = async (caseId) => {
    setErr('');
    try {
      const { data } = await api.get(`/hospital/cases/${caseId}`);
      setSelectedReceptionCase(data.case);
    } catch (e) { setErr(errMsg(e)); }
  };

  // Bridge 2: Request Global Second Opinion
  const requestBridge2Opinion = async (e) => {
    e?.preventDefault();
    if (!activeCase) return;
    setErr(''); setOk('');
    try {
      await api.post(`/hospital/cases/${activeCase.id}/intl-opinion`, intlOpinionForm);
      setOk('Global Second Opinion requested! Routed to ALO Nurse desk.');
      setShowIntlModal(false);
      setIntlOpinionForm({ specialty: '', clinical_question: '', consented_by_name: '', patient_consent: false, urgency: 'routine' });
    } catch (e) { setErr(errMsg(e)); }
  };

  // Lab: submit results
  const submitResult = async () => {
    if (!selectedLabTest) return;
    setErr(''); setOk('');
    try {
      let parsed = {};
      try { parsed = JSON.parse(labResultData); } catch { parsed = { text_result: labResultData }; }

      await api.post(`/hospital/lab/tests/${selectedLabTest.id}/results`, {
        results: parsed,
        result_status: isCritical ? 'critical' : isAbnormal ? 'abnormal' : 'normal',
        has_abnormal: isAbnormal || isCritical,
        critical_result: isCritical,
        amendment_reason: amendReason || null
      });
      setOk('Lab results submitted and verified.');
      setSelectedLabTest(null);
      setLabResultData('');
      setAmendReason('');
      reloadData();
    } catch (e) { setErr(errMsg(e)); }
  };

  // Pharmacy: dispense
  const dispenseMedication = async (medId) => {
    setErr(''); setOk('');
    try {
      await api.post(`/hospital/pharmacy/medications/${medId}/dispense`, {
        dispense_status: 'dispensed',
        dispense_note: dispenseNote,
      });
      setOk('Prescription dispensed.');
      setDispenseNote('');
      reloadData();
    } catch (e) {
      setErr(errMsg(e));
      throw e;
    }
  };

  // Admin: Create staff member (doctor, reception, lab, pharmacy)
  const createStaff = async (e) => {
    e?.preventDefault();
    setErr(''); setOk('');
    try {
      const chosenSpecialty = newStaff.specialty.trim() || specialtiesList[0]?.name_en || 'General Medicine';
      const payload = {
        full_name: newStaff.full_name.trim(),
        role: newStaff.role,
        specialty: newStaff.role === 'doctor' ? chosenSpecialty : null,
        phone: newStaff.phone.trim(),
        preferred_lang: newStaff.preferred_lang
      };
      await api.post('/hospital/staff', payload);
      setOk(`Staff member ${newStaff.full_name} (${newStaff.role}) created successfully!`);
      setShowAddStaff(false);
      setNewStaff({ full_name: '', role: 'doctor', specialty: 'General Practice', phone: '', preferred_lang: 'en' });
      reloadData();
    } catch (e) { setErr(errMsg(e)); }
  };

  // Admin: Toggle staff active/inactive
  const toggleStaffActive = async (s) => {
    setErr(''); setOk('');
    try {
      await api.patch(`/hospital/staff/${s.id}/active`, { is_active: !s.is_active });
      setOk(`Staff member ${s.full_name} is now ${!s.is_active ? 'active' : 'inactive'}.`);
      reloadData();
    } catch (e) { setErr(errMsg(e)); }
  };

  const matchesFilter = (item, query) => {
    if (!query || !query.trim()) return true;
    const q = query.trim().toLowerCase();
    const name = (item.patient?.full_name || '').toLowerCase();
    const mrn = (item.patient?.mrn || '').toLowerCase();
    const num = (item.queue_number || '').toLowerCase();
    const code = (item.checkin_code || '').toLowerCase();
    return name.includes(q) || mrn.includes(q) || num.includes(q) || code.includes(q);
  };

  return (
    <div className="wrap">
      <div className="row" style={{ justifyContent: 'space-between', borderBottom: '2px solid #000', paddingBottom: 10 }}>
        <div>
          <h1 style={{ margin: 0, border: 'none', padding: 0 }}>
            {session?.tenant?.name || 'Saudi Clinic'} · Day-Clinic Operations
          </h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Logged in as <strong>{session?.staff?.full_name || session?.email}</strong> ({userRole})
          </p>
        </div>
        <button onClick={reloadData}>{t('refresh')}</button>
      </div>

      {/* Role Navigation Tabs (DEC-066: isolated by staff role) */}
      {allowedTabs.length > 1 && (
        <div className="tabs" style={{ marginTop: 16 }}>
          {allowedTabs.includes('reception') && <button className={tab === 'reception' ? 'active' : ''} onClick={() => setTab('reception')}>{t('hospitalReception')}</button>}
          {allowedTabs.includes('doctor') && <button className={tab === 'doctor' ? 'active' : ''} onClick={() => setTab('doctor')}>{t('hospitalDoctor')}</button>}
          {allowedTabs.includes('lab') && <button className={tab === 'lab' ? 'active' : ''} onClick={() => setTab('lab')}>{t('hospitalLab')}</button>}
          {allowedTabs.includes('pharmacy') && <button className={tab === 'pharmacy' ? 'active' : ''} onClick={() => setTab('pharmacy')}>{t('hospitalPharmacy')}</button>}
          {allowedTabs.includes('hospital_admin') && <button className={tab === 'hospital_admin' ? 'active' : ''} onClick={() => setTab('hospital_admin')}>{t('hospitalAdmin')}</button>}
        </div>
      )}

      <Msg err={err} ok={ok} />

      {/* TAB 1: RECEPTION DESK */}
      {tab === 'reception' && allowedTabs.includes('reception') && (
        <div>
          <section className="box">
            <h2>Fast Patient Check-In</h2>
            <div className="row">
              <input
                type="text"
                placeholder="Enter 6-char code (e.g. ABC789)"
                value={checkinCode}
                onChange={e => setCheckinCode(e.target.value.toUpperCase())}
                style={{ maxWidth: 300 }}
              />
              <ActionButton onClick={doCheckin} disabled={!checkinCode.trim()} okText="Checked In">{t('checkinBtn')}</ActionButton>
              <button onClick={() => setShowNewPatient(!showNewPatient)}>+ New Walk-in Patient</button>
            </div>

            {showNewPatient && (
              <form onSubmit={createPatient} style={{ marginTop: 16, borderTop: '1px solid #ccc', paddingTop: 12 }}>
                <h3>Register Walk-in Patient</h3>
                <div className="grid2">
                  <Field label="MRN (Medical Record Number)"><input required value={newPatient.mrn} onChange={e => setNewPatient({ ...newPatient, mrn: e.target.value })} /></Field>
                  <Field label="Full Name"><input required value={newPatient.full_name} onChange={e => setNewPatient({ ...newPatient, full_name: e.target.value })} /></Field>
                  <Field label="Phone (+966...)"><input required value={newPatient.phone} onChange={e => setNewPatient({ ...newPatient, phone: e.target.value })} /></Field>
                  <Field label="Date of Birth"><input type="date" value={newPatient.dob} onChange={e => setNewPatient({ ...newPatient, dob: e.target.value })} /></Field>
                </div>
                <button type="submit" style={{ marginTop: 12 }}>Register & Create Clinic Case</button>
              </form>
            )}
          </section>

          <section className="box">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>Today's Live Queue Board</h2>
              <input
                type="text"
                placeholder="🔍 Search patient, MRN, queue # or code..."
                value={receptionSearch}
                onChange={e => setReceptionSearch(e.target.value)}
                style={{ maxWidth: 300 }}
              />
            </div>
            <div className="cards" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 12 }}>
              <div className="card">
                <h3>Scheduled ({(queue.scheduled || []).filter(c => matchesFilter(c, receptionSearch)).length})</h3>
                {(queue.scheduled || []).filter(c => matchesFilter(c, receptionSearch)).map(c => (
                  <div key={c.id} style={{ borderBottom: '1px solid #ddd', padding: '6px 0' }}>
                    <strong>{c.patient?.full_name}</strong>
                    <div className="muted">{c.appointment_time || 'No time'} · Code: {c.checkin_code}</div>
                    <button style={{ marginTop: 4, padding: '2px 8px', fontSize: 11 }} onClick={() => doCheckin(null, c.checkin_code)}>Check-in</button>
                  </div>
                ))}
              </div>

              <div className="card" style={{ background: '#f9f9f9' }}>
                <h3>Arrived / Waiting ({(queue.arrived || []).filter(c => matchesFilter(c, receptionSearch)).length})</h3>
                {(queue.arrived || []).filter(c => matchesFilter(c, receptionSearch)).map(c => (
                  <div key={c.id} style={{ borderBottom: '1px solid #ddd', padding: '6px 0' }}>
                    <span className="badge" style={{ fontSize: 16 }}>{c.queue_number}</span>
                    <div><strong>{c.patient?.full_name}</strong></div>
                    <div className="muted">{c.requested_specialty}</div>
                  </div>
                ))}
              </div>

              <div className="card" style={{ border: '2px solid #000' }}>
                <h3>In Clinic ({(queue.in_clinic || []).filter(c => matchesFilter(c, receptionSearch)).length})</h3>
                {(queue.in_clinic || []).filter(c => matchesFilter(c, receptionSearch)).map(c => (
                  <div key={c.id} style={{ borderBottom: '1px solid #ddd', padding: '6px 0' }}>
                    <span className="badge" style={{ background: '#000', color: '#fff' }}>{c.queue_number}</span>
                    <div><strong>{c.patient?.full_name}</strong></div>
                    <div className="muted">with {c.doctor?.full_name || 'Doctor'}</div>
                  </div>
                ))}
              </div>

              <div className="card">
                <h3>Done / Completed ({(queue.done || []).filter(c => matchesFilter(c, receptionSearch)).length})</h3>
                {(queue.done || []).filter(c => matchesFilter(c, receptionSearch)).map(c => (
                  <div key={c.id} style={{ borderBottom: '1px solid #ddd', padding: '6px 0' }}>
                    <div><strong>{c.queue_number}</strong> · {c.patient?.full_name}</div>
                    <div className="row" style={{ gap: 6, marginTop: 4 }}>
                      <button style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => openReceptionCase(c.id)}>View History</button>
                      <a className="btn" href={`/api/v1/hospital/cases/${c.id}/report/pdf`} download={`Clinic_Visit_${c.case_number}.pdf`} style={{ padding: '2px 8px', fontSize: 11, textDecoration: 'none' }}>📄 PDF</a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="box" style={{ marginTop: 14 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>Clinic Case History (Walk-in & Referred) ({receptionCases.filter(c => matchesFilter(c, receptionSearch)).length})</h2>
              <button onClick={reloadData}>Refresh</button>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Case #</th>
                  <th>Queue / Code</th>
                  <th>Patient (MRN)</th>
                  <th>Doctor</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {receptionCases.filter(c => matchesFilter(c, receptionSearch)).map(c => (
                  <tr key={c.id}>
                    <td><strong>{c.case_number}</strong></td>
                    <td>{c.queue_number || '—'} · <span className="muted">{c.checkin_code}</span></td>
                    <td>{c.patient?.full_name || '—'}<br /><span className="muted">{c.patient?.mrn || ''}</span></td>
                    <td>{c.doctor?.full_name || 'Unassigned'}</td>
                    <td><span className="muted">{c.source === 'hospital' ? 'Walk-in' : c.source}</span></td>
                    <td><span className="badge">{c.status}</span></td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <button style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => openReceptionCase(c.id)}>View Details</button>
                        <a
                          className="btn"
                          href={`/api/v1/hospital/cases/${c.id}/report/pdf`}
                          download={`Clinic_Visit_${c.case_number}.pdf`}
                          style={{ padding: '3px 8px', fontSize: 12, textDecoration: 'none' }}
                        >
                          📄 PDF
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
                {receptionCases.filter(c => matchesFilter(c, receptionSearch)).length === 0 && (
                  <tr><td colSpan={7} className="muted">No clinic cases found.</td></tr>
                )}
              </tbody>
            </table>
          </section>

          {selectedReceptionCase && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
              <div className="box" style={{ background: '#fff', maxWidth: 720, width: '92%', maxHeight: '90vh', overflowY: 'auto' }}>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <h2 style={{ margin: 0 }}>Case History: {selectedReceptionCase.case_number}</h2>
                  <button onClick={() => setSelectedReceptionCase(null)}>Close</button>
                </div>
                <p className="muted" style={{ marginTop: 6 }}>
                  Patient: <strong>{selectedReceptionCase.patient?.full_name}</strong> (MRN: {selectedReceptionCase.patient?.mrn}) ·
                  Doctor: <strong>{selectedReceptionCase.doctor?.full_name || '—'}</strong> ·
                  Status: <span className="badge">{selectedReceptionCase.status}</span>
                </p>

                <div style={{ marginTop: 10 }}>
                  <h4>Doctor Consultation Notes & Diagnosis</h4>
                  <pre className="report" style={{ background: '#f8fafc', padding: 10, borderRadius: 6, whiteSpace: 'pre-wrap' }}>
                    {selectedReceptionCase.doctor_opinion || 'No consultation notes recorded yet.'}
                  </pre>
                </div>

                <div style={{ marginTop: 12 }}>
                  <h4>Laboratory Tests & Results ({(selectedReceptionCase.lab_tests || []).length})</h4>
                  {(selectedReceptionCase.lab_tests || []).length === 0 ? (
                    <p className="muted">No lab tests ordered.</p>
                  ) : (
                    <table>
                      <thead><tr><th>Specimen</th><th>Test</th><th>Status</th><th>Result</th></tr></thead>
                      <tbody>
                        {selectedReceptionCase.lab_tests.map(lt => (
                          <tr key={lt.id}>
                            <td>{lt.specimen_id}</td>
                            <td>{lt.test_name}</td>
                            <td><span className="badge">{lt.status}</span></td>
                            <td>{lt.results ? (typeof lt.results === 'object' ? (lt.results.text_result || JSON.stringify(lt.results)) : String(lt.results)) : 'Pending'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                <div style={{ marginTop: 12 }}>
                  <h4>Prescribed Medications & Dispensing ({(selectedReceptionCase.medications || []).length})</h4>
                  {(selectedReceptionCase.medications || []).length === 0 ? (
                    <p className="muted">No medications prescribed.</p>
                  ) : (
                    <table>
                      <thead><tr><th>Drug</th><th>Dosage / Duration</th><th>Dispense Status</th></tr></thead>
                      <tbody>
                        {selectedReceptionCase.medications.map(m => (
                          <tr key={m.id}>
                            <td><strong>{m.drug_name}</strong></td>
                            <td>{m.dosage} · {m.frequency} · {m.duration_days} days</td>
                            <td><span className="badge">{m.dispense_status || m.status || 'prescribed'}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                <div className="row" style={{ marginTop: 16, gap: 10 }}>
                  <a
                    className="btn"
                    href={`/api/v1/hospital/cases/${selectedReceptionCase.id}/report/pdf`}
                    download={`Clinic_Visit_${selectedReceptionCase.case_number}.pdf`}
                    style={{ textDecoration: 'none' }}
                  >
                    📄 Download Visit Summary (PDF)
                  </a>
                  <button onClick={() => setSelectedReceptionCase(null)}>Close</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: DOCTOR CONSULTATION DESK */}
      {tab === 'doctor' && allowedTabs.includes('doctor') && (
        <div>
          {!activeCase ? (
            <section className="box">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <h2>Waiting Patient Queue</h2>
                <input
                  type="text"
                  placeholder="🔍 Search patient name, MRN or queue #..."
                  value={doctorSearch}
                  onChange={e => setDoctorSearch(e.target.value)}
                  style={{ maxWidth: 300 }}
                />
              </div>
              {!(queue.arrived?.length || queue.in_clinic?.length) && <p className="muted" style={{ marginTop: 12 }}>No patients currently waiting.</p>}
              <table style={{ marginTop: 12 }}>
                <thead>
                  <tr><th>Queue #</th><th>Patient Name</th><th>MRN</th><th>Specialty</th><th>Action</th></tr>
                </thead>
                <tbody>
                  {[...(queue.in_clinic || []), ...(queue.arrived || [])]
                    .filter(c => matchesFilter(c, doctorSearch))
                    .map(c => (
                      <tr key={c.id}>
                        <td><strong>{c.queue_number}</strong></td>
                        <td>{c.patient?.full_name}</td>
                        <td>{c.patient?.mrn}</td>
                        <td>{c.requested_specialty || 'General'}</td>
                        <td>
                          <button onClick={() => callPatient(c.id)}>
                            {c.arrival_status === 'in_clinic' ? 'Open Case' : 'Call into Clinic'}
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </section>
          ) : (
            <div>
              <section className="box">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <h2>Consulting: {activeCase.patient?.full_name} ({activeCase.queue_number})</h2>
                  <button onClick={() => setActiveCase(null)}>← Back to Queue</button>
                </div>
                <p className="muted">MRN: {activeCase.patient?.mrn} · Case: {activeCase.case_number} · Complaint: {activeCase.case_summary}</p>

                <Field label="Clinical Consultation Notes & Diagnosis">
                  <textarea
                    value={doctorOpinion}
                    onChange={e => setDoctorOpinion(e.target.value)}
                    placeholder="Document clinical examination, vital signs, diagnosis, and care plan..."
                    style={{ minHeight: 120 }}
                  />
                </Field>

                <div className="row" style={{ marginTop: 12, gap: 10 }}>
                  <ActionButton
                    onClick={saveOpinion}
                    disabled={!doctorOpinion.trim() && !(activeCase.lab_tests?.length || activeCase.medications?.length)}
                    okText="Saved"
                  >
                    Complete Consultation & Save
                  </ActionButton>
                  <button onClick={() => setShowIntlModal(true)}>🌐 Request Global Second Opinion (Bridge 2)</button>
                  <a
                    className="btn"
                    href={`/api/v1/hospital/cases/${activeCase.id}/report/pdf`}
                    download={`Clinic_Visit_${activeCase.case_number}.pdf`}
                    style={{ textDecoration: 'none' }}
                  >
                    📄 Download Visit Summary (PDF)
                  </a>
                </div>

                {(activeCase.lab_tests?.length > 0 || activeCase.medications?.length > 0) && (
                  <div style={{ marginTop: 14, borderTop: '1px solid #e2e8f0', paddingTop: 10 }}>
                    {activeCase.lab_tests?.length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <strong>Ordered Lab Tests ({activeCase.lab_tests.length}):</strong>
                        <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
                          {activeCase.lab_tests.map(lt => (
                            <li key={lt.id}>
                              {lt.test_name} ({lt.specimen_id}) — <strong>{lt.status}</strong>
                              {lt.results ? `: ${typeof lt.results === 'object' ? (lt.results.text_result || JSON.stringify(lt.results)) : String(lt.results)}` : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {activeCase.medications?.length > 0 && (
                      <div>
                        <strong>Prescribed Medications ({activeCase.medications.length}):</strong>
                        <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
                          {activeCase.medications.map(m => (
                            <li key={m.id}>
                              {m.drug_name} ({m.dosage}) — <strong>{m.dispense_status || m.status || 'prescribed'}</strong>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* Order Lab & Rx */}
              <div className="grid2">
                <section className="box">
                  <h3>Order Laboratory Test</h3>
                  <Field label="Select Test from Hospital Catalogue">
                    <select value={selectedTestId} onChange={e => setSelectedTestId(e.target.value)}>
                      <option value="">-- Choose Catalogue Item --</option>
                      {testCatalogue.map(t => (
                        <option key={t.id} value={t.id}>{t.name} ({t.category} - {t.specimen_type})</option>
                      ))}
                    </select>
                  </Field>
                  <ActionButton onClick={orderLab} disabled={!selectedTestId} style={{ marginTop: 8 }} okText="Ordered">Place Lab Order</ActionButton>
                </section>

                <section className="box">
                  <h3>Prescribe Medication</h3>
                  <form onSubmit={addPrescription}>
                    <Field label="Drug Name"><input required value={newMed.drug_name} onChange={e => setNewMed({ ...newMed, drug_name: e.target.value })} placeholder="e.g. Atorvastatin 20mg" /></Field>
                    <Field label="Dosage"><input required value={newMed.dosage} onChange={e => setNewMed({ ...newMed, dosage: e.target.value })} placeholder="e.g. 20mg" /></Field>
                    <div className="grid2">
                      <Field label="Frequency"><input value={newMed.frequency} onChange={e => setNewMed({ ...newMed, frequency: e.target.value })} /></Field>
                      <Field label="Duration (days)"><input type="number" value={newMed.duration_days} onChange={e => setNewMed({ ...newMed, duration_days: e.target.value })} /></Field>
                    </div>
                    <button type="submit" style={{ marginTop: 8 }}>Send to Pharmacy</button>
                  </form>
                </section>
              </div>
            </div>
          )}

          {/* Bridge 2 Modal */}
          {showIntlModal && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
              <div className="box" style={{ background: '#fff', maxWidth: 600, width: '90%', maxHeight: '90vh', overflowY: 'auto' }}>
                <h2>Request International Second Opinion</h2>
                <p className="muted">Route this case to the ALO Nurse desk for review by an accredited global specialist.</p>
                <form onSubmit={requestBridge2Opinion}>
                  <Field label="Requested Global Specialty">
                    <input required value={intlOpinionForm.specialty} onChange={e => setIntlOpinionForm({ ...intlOpinionForm, specialty: e.target.value })} placeholder="e.g. Cardiothoracic Surgery" />
                  </Field>
                  <Field label="Specific Clinical Question for Global Specialist">
                    <textarea required value={intlOpinionForm.clinical_question} onChange={e => setIntlOpinionForm({ ...intlOpinionForm, clinical_question: e.target.value })} placeholder="Formulate clinical controversy or specific management question..." />
                  </Field>
                  <Field label="Consenting Person Full Name">
                    <input required value={intlOpinionForm.consented_by_name} onChange={e => setIntlOpinionForm({ ...intlOpinionForm, consented_by_name: e.target.value })} placeholder="Patient or legal guardian full name" />
                  </Field>
                  <div style={{ margin: '12px 0' }}>
                    <label>
                      <input type="checkbox" checked={intlOpinionForm.patient_consent} onChange={e => setIntlOpinionForm({ ...intlOpinionForm, patient_consent: e.target.checked })} />
                      {' '}<strong>Patient Explicit Consent Verified:</strong> Patient authorizes sharing anonymized medical records with global specialists.
                    </label>
                  </div>
                  <div className="row" style={{ marginTop: 16 }}>
                    <button type="submit" disabled={!intlOpinionForm.patient_consent}>Submit Opinion Request</button>
                    <button type="button" onClick={() => setShowIntlModal(false)}>Cancel</button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: LABORATORY WORKBENCH */}
      {tab === 'lab' && allowedTabs.includes('lab') && (
        <div>
          <section className="box">
            <h2>Hospital Lab Order Queue</h2>
            {!labTests.length && <p className="muted">No laboratory tests currently pending.</p>}
            <table>
              <thead>
                <tr><th>Specimen ID</th><th>Test Name</th><th>Priority</th><th>Status</th><th>Results</th><th>Action</th></tr>
              </thead>
              <tbody>
                {labTests.map(t => (
                  <tr key={t.id}>
                    <td><code>{t.specimen_id}</code></td>
                    <td><strong>{t.test_name}</strong> ({t.specimen_type})</td>
                    <td><span className="badge">{t.priority}</span></td>
                    <td>{t.status}</td>
                    <td>
                      {t.has_abnormal && <span className="badge" style={{ background: '#000', color: '#fff' }}>ABNORMAL</span>}
                      {t.critical_result && <span className="badge" style={{ border: '2px solid red' }}>CRITICAL</span>}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <button onClick={() => { setSelectedLabTest(t); setLabResultData(JSON.stringify(t.results || {}, null, 2)); }}>
                          {t.status === 'resulted' ? 'Amend Result' : 'Enter Result'}
                        </button>
                        <button onClick={() => setTubeLabelTest(t)}>
                          🏷️ Tube Label
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {selectedLabTest && (
            <section className="box">
              <h3>Enter / Amend Result: {selectedLabTest.test_name} ({selectedLabTest.specimen_id})</h3>
              <Field label="Result Data (JSON or Text)">
                <textarea
                  value={labResultData}
                  onChange={e => setLabResultData(e.target.value)}
                  placeholder='e.g. {"cholesterol_total": 240, "unit": "mg/dL", "flag": "HIGH"}'
                  style={{ minHeight: 90 }}
                />
              </Field>
              <div className="row" style={{ margin: '10px 0', gap: 16 }}>
                <label><input type="checkbox" checked={isAbnormal} onChange={e => setIsAbnormal(e.target.checked)} /> Abnormal Flag</label>
                <label><input type="checkbox" checked={isCritical} onChange={e => setIsCritical(e.target.checked)} /> Critical Alert</label>
              </div>
              {['resulted', 'verified', 'amended'].includes(selectedLabTest.status) && (
                <Field label="Amendment Reason (Audit Log)">
                  <input value={amendReason} onChange={e => setAmendReason(e.target.value)} placeholder="Reason for result amendment" />
                </Field>
              )}
              <div className="row" style={{ marginTop: 12 }}>
                <ActionButton onClick={submitResult} okText="Verified">Save & Verify Result</ActionButton>
                <button onClick={() => setSelectedLabTest(null)}>Cancel</button>
              </div>
            </section>
          )}
          <section className="box" style={{ marginTop: 14 }}>
            <h2>Lab Test Catalogue ({testCatalogue.length})</h2>
            <p className="muted" style={{ marginTop: -4 }}>Add laboratory tests available at this hospital so Doctors can order them during consultation.</p>
            {testCatalogue.length > 0 && (
              <table style={{ marginBottom: 14 }}>
                <thead><tr><th>Test Name</th><th>Category</th><th>Specimen</th></tr></thead>
                <tbody>
                  {testCatalogue.map(item => (
                    <tr key={item.id}><td><strong>{item.name}</strong></td><td>{item.category}</td><td>{item.specimen_type}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
            <form onSubmit={addLabTest}>
              <div className="grid2">
                <Field label="Test Name *"><input required value={newTest.name} onChange={e => setNewTest({ ...newTest, name: e.target.value })} placeholder="e.g. Complete Blood Count (CBC)" /></Field>
                <Field label="Category *"><input required value={newTest.category} onChange={e => setNewTest({ ...newTest, category: e.target.value })} placeholder="e.g. Hematology, Biochemistry" /></Field>
                <Field label="Specimen Type *">
                  <select value={newTest.specimen_type} onChange={e => setNewTest({ ...newTest, specimen_type: e.target.value })}>
                    <option value="Blood">Blood</option>
                    <option value="Urine">Urine</option>
                    <option value="Swab">Swab</option>
                    <option value="Stool">Stool</option>
                    <option value="Imaging">Imaging / Radiology</option>
                    <option value="Other">Other</option>
                  </select>
                </Field>
                <Field label="Description (Optional)"><input value={newTest.description} onChange={e => setNewTest({ ...newTest, description: e.target.value })} placeholder="Fasting required, etc." /></Field>
              </div>
              <button type="submit" style={{ marginTop: 10 }}>+ Add Lab Test</button>
            </form>
          </section>
        </div>
      )}

      {/* TAB 4: PHARMACY DISPENSING */}
      {tab === 'pharmacy' && allowedTabs.includes('pharmacy') && (
        <section className="box">
          <h2>Hospital Pharmacy Dispensing Desk</h2>
          {!rxQueue.length && <p className="muted">No pending prescriptions in queue.</p>}
          <table>
            <thead>
              <tr><th>Case #</th><th>Patient</th><th>MRN</th><th>Prescription</th><th>Dosage / Instructions</th><th>Action</th></tr>
            </thead>
            <tbody>
              {rxQueue.map(m => (
                <tr key={m.id}>
                  <td><strong>{m.case_number}</strong></td>
                  <td>{m.patient_name}</td>
                  <td>{m.patient_mrn}</td>
                  <td><strong>{m.drug_name}</strong></td>
                  <td>{m.dosage} · {m.frequency} for {m.duration_days} days</td>
                  <td>
                    <ActionButton onClick={() => dispenseMedication(m.id)} okText="Dispensed">Dispense Medication</ActionButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* TAB 5: ADMIN / SLOTS */}
      {tab === 'hospital_admin' && allowedTabs.includes('hospital_admin') && (
        <div>
          <section className="box">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>Hospital Staff Members ({staffList.length})</h2>
              <button className="btn" onClick={() => setShowAddStaff(true)}>
                + {t('addStaffMember')}
              </button>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Full Name</th>
                  <th>Role</th>
                  <th>Phone (E.164)</th>
                  <th>Specialty</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {staffList.map(s => (
                  <tr key={s.id}>
                    <td><strong>{s.full_name}</strong></td>
                    <td>{s.role}</td>
                    <td>{s.phone_e164 || s.phone}</td>
                    <td>{s.specialty || '—'}</td>
                    <td><span className="badge">{s.is_active ? 'Active' : 'Inactive'}</span></td>
                    <td>
                      {s.id !== session?.staff?.id ? (
                        <button
                          style={{ fontSize: 11, padding: '2px 8px' }}
                          onClick={() => toggleStaffActive(s)}
                        >
                          {s.is_active ? t('deactivate') : t('activate')}
                        </button>
                      ) : (
                        <span className="muted" style={{ fontSize: 12 }}>Current User</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Add Staff Modal */}
          {showAddStaff && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200 }}>
              <div className="box" style={{ background: '#fff', maxWidth: 480, width: '90%', padding: 24 }}>
                <h3 style={{ marginTop: 0 }}>{t('addStaffMember')}</h3>
                <form onSubmit={createStaff}>
                  <Field label="Full Name">
                    <input
                      required
                      placeholder="e.g. Dr. Marcus Vance"
                      value={newStaff.full_name}
                      onChange={e => setNewStaff({ ...newStaff, full_name: e.target.value })}
                    />
                  </Field>
                  <Field label="Staff Role">
                    <select
                      value={newStaff.role}
                      onChange={e => setNewStaff({ ...newStaff, role: e.target.value })}
                    >
                      <option value="doctor">{t('roleDoctor')}</option>
                      <option value="reception">{t('roleReception')}</option>
                      <option value="lab">{t('roleLab')}</option>
                      <option value="pharmacy">{t('rolePharmacy')}</option>
                    </select>
                  </Field>
                  {newStaff.role === 'doctor' && (
                    <Field label={t('selectSpecialty') || 'Clinical Specialty'}>
                      <select
                        required
                        value={newStaff.specialty || (specialtiesList[0]?.name_en || '')}
                        onChange={e => setNewStaff({ ...newStaff, specialty: e.target.value })}
                      >
                        {specialtiesList.map(s => (
                          <option key={s.id} value={s.name_en}>
                            {s.name_en} {s.name_ar ? `(${s.name_ar})` : ''}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  <Field label="WhatsApp Mobile (+CountryCode...)">
                    <input
                      required
                      dir="ltr"
                      placeholder="e.g. +966501112244"
                      value={newStaff.phone}
                      onChange={e => setNewStaff({ ...newStaff, phone: e.target.value })}
                    />
                  </Field>
                  <Field label="Preferred Language">
                    <select
                      value={newStaff.preferred_lang}
                      onChange={e => setNewStaff({ ...newStaff, preferred_lang: e.target.value })}
                    >
                      <option value="en">English (en)</option>
                      <option value="ar">العربية (ar)</option>
                    </select>
                  </Field>
                  <div className="row" style={{ marginTop: 16 }}>
                    <button type="submit" className="btn">{t('addStaffMember')}</button>
                    <button type="button" onClick={() => setShowAddStaff(false)}>Cancel</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          <section className="box">
            <h2>Doctor Slot Templates ({slotTemplates.length})</h2>
            <table>
              <thead>
                <tr><th>Doctor</th><th>Weekdays</th><th>Times</th><th>Duration</th><th>Active</th></tr>
              </thead>
              <tbody>
                {slotTemplates.map(t => (
                  <tr key={t.id}>
                    <td>{t.doctor?.full_name || t.doctor_id}</td>
                    <td>{t.weekdays?.join(', ')}</td>
                    <td>{t.times?.join(', ')}</td>
                    <td>{t.duration_min} min</td>
                    <td>{t.active ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="box">
            <h2>Lab Test Catalogue ({testCatalogue.length})</h2>
            <p className="muted" style={{ marginTop: -4 }}>Add laboratory tests available at this hospital so Doctors can order them during consultation.</p>
            {testCatalogue.length > 0 && (
              <table style={{ marginBottom: 14 }}>
                <thead><tr><th>Test Name</th><th>Category</th><th>Specimen</th></tr></thead>
                <tbody>
                  {testCatalogue.map(item => (
                    <tr key={item.id}><td><strong>{item.name}</strong></td><td>{item.category}</td><td>{item.specimen_type}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
            <form onSubmit={addLabTest}>
              <div className="grid2">
                <Field label="Test Name *"><input required value={newTest.name} onChange={e => setNewTest({ ...newTest, name: e.target.value })} placeholder="e.g. Complete Blood Count (CBC)" /></Field>
                <Field label="Category *"><input required value={newTest.category} onChange={e => setNewTest({ ...newTest, category: e.target.value })} placeholder="e.g. Hematology, Biochemistry" /></Field>
                <Field label="Specimen Type *">
                  <select value={newTest.specimen_type} onChange={e => setNewTest({ ...newTest, specimen_type: e.target.value })}>
                    <option value="Blood">Blood</option>
                    <option value="Urine">Urine</option>
                    <option value="Swab">Swab</option>
                    <option value="Stool">Stool</option>
                    <option value="Imaging">Imaging / Radiology</option>
                    <option value="Other">Other</option>
                  </select>
                </Field>
                <Field label="Description (Optional)"><input value={newTest.description} onChange={e => setNewTest({ ...newTest, description: e.target.value })} placeholder="Fasting required, etc." /></Field>
              </div>
              <button type="submit" style={{ marginTop: 10 }}>+ Add Lab Test</button>
            </form>
          </section>
        </div>
      )}

      {/* Tube Barcode Label Printable Modal (DEC-063) */}
      {tubeLabelTest && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
          <div className="box" style={{ background: '#fff', maxWidth: 420, width: '90%', textAlign: 'center', padding: 24 }}>
            <h3>Specimen Tube Label</h3>
            <p className="muted" style={{ fontSize: 13 }}>Standard 50mm x 25mm Thermal Label Preview</p>
            
            <div style={{ border: '2px dashed #000', padding: 16, margin: '16px auto', maxWidth: 300, background: '#fff' }}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>{session?.tenant?.name || 'HOSPITAL CLINIC'}</div>
              <div style={{ fontSize: 13, fontWeight: 800, margin: '4px 0' }}>{tubeLabelTest.test_name}</div>
              {tubeLabelTest.barcode_svg ? (
                <div dangerouslySetInnerHTML={{ __html: tubeLabelTest.barcode_svg }} style={{ margin: '8px 0', display: 'flex', justifyContent: 'center' }} />
              ) : (
                <div style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 900, letterSpacing: 2, margin: '8px 0' }}>
                  {tubeLabelTest.specimen_id}
                </div>
              )}
              <div style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700 }}>{tubeLabelTest.specimen_id}</div>
              <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>
                {tubeLabelTest.specimen_type || 'Blood'} · {new Date(tubeLabelTest.created_at || Date.now()).toLocaleDateString('en-GB')}
              </div>
            </div>

            <div className="row" style={{ justifyContent: 'center', gap: 10, marginTop: 16 }}>
              <button className="btn" onClick={() => window.print()}>Print Label</button>
              <button onClick={() => setTubeLabelTest(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
