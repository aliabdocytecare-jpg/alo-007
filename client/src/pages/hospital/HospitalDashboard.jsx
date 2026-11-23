// DEC-056: Unified Day-Clinic Hospital Operations Portal
// Reception, Doctor Consultation, Lab Workbench, Pharmacy Dispensing & Admin Desk
import { useState, useEffect } from 'react';
import { api, errMsg, fmtDate } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { Msg, Field, StatusBadge } from '../../components/ui';

export default function HospitalDashboard() {
  const { session } = useAuth();
  const { t } = useI18n();

  // Role auto-selection
  const userRole = session?.role || 'hospital_admin';
  const defaultTab = ['reception', 'doctor', 'lab', 'pharmacy', 'hospital_admin'].includes(userRole)
    ? (userRole === 'hospital_admin' ? 'hospital_admin' : userRole)
    : 'reception';

  const [tab, setTab] = useState(defaultTab);
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

  const reloadData = async () => {
    setErr('');
    try {
      if (tab === 'reception' || tab === 'doctor') {
        const qRes = await api.get('/hospital/reception/queue');
        setQueue(qRes.data.queue || {});
      }
      if (tab === 'doctor') {
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
  const doCheckin = async (e) => {
    e?.preventDefault();
    if (!checkinCode) return;
    setErr(''); setOk('');
    try {
      const { data } = await api.post('/hospital/reception/checkin', { checkin_code: checkinCode.trim().toUpperCase() });
      setOk(`Patient checked in! Queue Number: ${data.queue_number}`);
      setCheckinCode('');
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
      await api.post(`/hospital/cases/${activeCase.id}/opinion`, {
        doctor_opinion: doctorOpinion,
        status: 'completed'
      });
      setOk('Consultation completed and saved to chart.');
      setActiveCase(null);
      reloadData();
    } catch (e) { setErr(errMsg(e)); }
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
    } catch (e) { setErr(errMsg(e)); }
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
    } catch (e) { setErr(errMsg(e)); }
  };

  // Bridge 2: Request Global Second Opinion
  const requestBridge2Opinion = async (e) => {
    e?.preventDefault();
    if (!activeCase) return;
    setErr(''); setOk('');
    try {
      await api.post(`/hospital/cases/${activeCase.id}/intl-opinion`, intlOpinionForm);
      setOk('Global Second Opinion requested! Routed to ALO platform coordinators.');
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
      await api.post(`/hospital/pharmacy/medications/${medId}/dispense`, { dispense_note: dispenseNote });
      setOk('Prescription dispensed.');
      setDispenseNote('');
      reloadData();
    } catch (e) { setErr(errMsg(e)); }
  };

  // Admin: Create staff member (doctor, reception, lab, pharmacy)
  const createStaff = async (e) => {
    e?.preventDefault();
    setErr(''); setOk('');
    try {
      const payload = {
        full_name: newStaff.full_name.trim(),
        role: newStaff.role,
        specialty: newStaff.role === 'doctor' ? (newStaff.specialty.trim() || 'General Practice') : null,
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

      {/* Role Navigation Tabs */}
      <div className="tabs" style={{ marginTop: 16 }}>
        <button className={tab === 'reception' ? 'active' : ''} onClick={() => setTab('reception')}>{t('hospitalReception')}</button>
        <button className={tab === 'doctor' ? 'active' : ''} onClick={() => setTab('doctor')}>{t('hospitalDoctor')}</button>
        <button className={tab === 'lab' ? 'active' : ''} onClick={() => setTab('lab')}>{t('hospitalLab')}</button>
        <button className={tab === 'pharmacy' ? 'active' : ''} onClick={() => setTab('pharmacy')}>{t('hospitalPharmacy')}</button>
        <button className={tab === 'hospital_admin' ? 'active' : ''} onClick={() => setTab('hospital_admin')}>{t('hospitalAdmin')}</button>
      </div>

      <Msg err={err} ok={ok} />

      {/* TAB 1: RECEPTION DESK */}
      {tab === 'reception' && (
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
              <button onClick={doCheckin} disabled={!checkinCode.trim()}>{t('checkinBtn')}</button>
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
                    <button style={{ marginTop: 4, padding: '2px 8px', fontSize: 11 }} onClick={() => { setCheckinCode(c.checkin_code); }}>Check-in</button>
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
                  <div key={c.id} style={{ borderBottom: '1px solid #ddd', padding: '6px 0', opacity: 0.6 }}>
                    <span>{c.queue_number} · {c.patient?.full_name}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}

      {/* TAB 2: DOCTOR CONSULTATION DESK */}
      {tab === 'doctor' && (
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
                  <button onClick={saveOpinion} disabled={!doctorOpinion.trim()}>Complete Consultation & Save</button>
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
                  <button onClick={orderLab} disabled={!selectedTestId} style={{ marginTop: 8 }}>Place Lab Order</button>
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
                <p className="muted">Route this case to ALO platform coordinators for review by an accredited global specialist.</p>
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
      {tab === 'lab' && (
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
              {selectedLabTest.status === 'resulted' && (
                <Field label="Amendment Reason (Audit Log)">
                  <input value={amendReason} onChange={e => setAmendReason(e.target.value)} placeholder="Reason for result amendment" />
                </Field>
              )}
              <div className="row" style={{ marginTop: 12 }}>
                <button onClick={submitResult}>Save & Verify Result</button>
                <button onClick={() => setSelectedLabTest(null)}>Cancel</button>
              </div>
            </section>
          )}
        </div>
      )}

      {/* TAB 4: PHARMACY DISPENSING */}
      {tab === 'pharmacy' && (
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
                    <button onClick={() => dispenseMedication(m.id)}>Dispense Medication</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* TAB 5: ADMIN / SLOTS */}
      {tab === 'hospital_admin' && (
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
                    <Field label="Clinical Specialty">
                      <input
                        placeholder="e.g. Cardiology, Internal Medicine"
                        value={newStaff.specialty}
                        onChange={e => setNewStaff({ ...newStaff, specialty: e.target.value })}
                      />
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
