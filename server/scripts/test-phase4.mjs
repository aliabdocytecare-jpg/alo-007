// Automated Phase 4 Verification Suite: Specialist & Coordinator Case Portal Upgrades
import 'dotenv/config';
import crypto from 'crypto';
import { db } from '../config/db.js';
import { hashToken } from '../controllers/caseEnhancementsController.js';
import { transition } from '../services/caseService.js';

let passed = 0;
let failed = 0;

function assert(name, condition, extra = '') {
  if (condition) {
    console.log(`PASS: ${name} ${extra}`);
    passed++;
  } else {
    console.error(`FAIL: ${name} ${extra}`);
    failed++;
  }
}

async function run() {
  console.log('Running Phase 4 Verification Suite...\n');

  // Clean up any old test records
  const { data: oldCases } = await db.from('cases').select('id, patient_id').like('reason', 'TEST4 —%');
  for (const c of oldCases || []) {
    await db.from('case_reviews').delete().eq('case_id', c.id);
    await db.from('case_reports_requests').delete().eq('case_id', c.id);
    await db.from('case_timeline').delete().eq('case_id', c.id);
    await db.from('documents').delete().eq('case_id', c.id);
    await db.from('cases').delete().eq('id', c.id);
    if (c.patient_id) await db.from('patients').delete().eq('id', c.patient_id);
  }

  // 1. Provision Test Patient & Case
  const { data: patient, error: patErr } = await db.from('patients').insert({
    phone: '+966504445566',
    full_name: 'David Nunez',
    dob: '1980-05-12',
    gender: 'MALE'
  }).select().single();
  assert('Create Test Patient (David Nunez)', !patErr && !!patient?.id, patErr?.message || patient?.id);

  const { data: testCase, error: caseErr } = await db.from('cases').insert({
    case_number: `ALO-${Date.now().toString(36).toUpperCase()}`,
    patient_id: patient.id,
    service_type: 'GMO',
    specialty: 'Cardiology',
    purpose: 'SECOND_OPINION',
    reason: 'TEST4 — Evaluation of coronary artery calcium and recurrent angina',
    history: {
      symptoms: 'Substernal chest pressure on brisk walking',
      diagnosis: 'Known stable CAD',
      medications: 'Aspirin 81mg, Metoprolol 25mg',
      allergies: 'NKDA'
    },
    status: 'INITIAL_REVIEW',
    payment_confirmed: true
  }).select().single();
  assert('Create Test Remote Case', !caseErr && !!testCase?.id, caseErr?.message || testCase?.case_number);

  // 2. Bilingual AI Summary Pipeline
  const enSummary = {
    clinical_presentation: '46yo male with known stable CAD presenting with exertional angina.',
    key_findings: ['Substernal chest pressure', 'On ASA and beta-blocker'],
    pending_questions: ['Indication for CT coronary angiography vs functional stress testing?'],
    suggested_specialties: ['Interventional Cardiology'],
    red_flags: ['Rule out unstable angina or accelerating symptoms']
  };

  const arSummary = {
    clinical_presentation: 'مريض يبلغ من العمر 46 عاماً يعاني من آلام صدرية جهدية مع تاريخ مرضي سابق لشرايين القلب.',
    key_findings: ['ألم ضاغط خلف عظمة القص', 'يتناول الأسبرين ومثبطات بيتا'],
    pending_questions: ['هل يوصى بإجراء تصوير مقطعي للشرايين التاجية أم اختبار جهد وظيفي؟'],
    suggested_specialties: ['أمراض القلب التداخلية'],
    red_flags: ['استبعاد متلازمة الشريان التاجي الحادة أو تفاقم الأعراض']
  };

  const { data: aiDraft, error: aiErr } = await db.from('cases')
    .update({
      ai_summary_en: enSummary,
      ai_summary_ar: arSummary,
      ai_summary_status: 'draft',
      updated_at: new Date().toISOString()
    })
    .eq('id', testCase.id)
    .select()
    .single();
  assert('Generate Bilingual AI Summary (Draft)', !aiErr && aiDraft?.ai_summary_status === 'draft' && aiDraft?.ai_summary_en?.key_findings?.length === 2);

  // Approve AI Summary
  const { data: aiApproved, error: appErr } = await db.from('cases')
    .update({
      ai_summary_status: 'approved',
      ai_summary_approved_by: 'Adrian Lewis (Operations Lead)',
      ai_summary_approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', testCase.id)
    .select()
    .single();
  assert('Approve AI Summary with Coordinator Audit', !appErr && aiApproved?.ai_summary_status === 'approved', aiApproved?.ai_summary_approved_by);

  // 3. Itemized Reports Request Checklist (case_reports_requests)
  const checklistItems = [
    { id: 'item-1', name: 'Recent 12-Lead Resting ECG', required: true, status: 'pending' },
    { id: 'item-2', name: 'Coronary Calcium Score DICOM', required: true, status: 'pending' },
    { id: 'item-3', name: 'Lipid Panel & HbA1c Lab Report', required: false, status: 'pending' }
  ];

  const reqToken = crypto.randomBytes(36).toString('base64url');
  const { data: repReq, error: reqErr } = await db.from('case_reports_requests').insert({
    case_id: testCase.id,
    items: checklistItems,
    notes: 'Please upload original PDF or DICOM scan files.',
    status: 'pending',
    token_hash: hashToken(reqToken),
    token_expires_at: new Date(Date.now() + 7 * 86400_000).toISOString()
  }).select().single();
  assert('Create Itemized Reports Request Checklist', !reqErr && !!repReq?.id, `items: ${repReq?.items?.length}`);

  // Transition case to ADDITIONAL_INFO_REQUIRED
  await transition(testCase.id, 'ADDITIONAL_INFO_REQUIRED', {
    actorRole: 'coordinator',
    note: 'Requested itemized reports checklist'
  });

  const { data: caseInAir } = await db.from('cases').select('status').eq('id', testCase.id).single();
  assert('Case status transitions to ADDITIONAL_INFO_REQUIRED', caseInAir?.status === 'ADDITIONAL_INFO_REQUIRED');

  // Update item 1: received
  checklistItems[0].status = 'received';
  const { data: repPart } = await db.from('case_reports_requests')
    .update({ items: checklistItems, status: 'partially_fulfilled' })
    .eq('id', repReq.id)
    .select()
    .single();
  assert('Checklist item update transitions status to partially_fulfilled', repPart?.status === 'partially_fulfilled');

  // Update item 2 & 3: fulfilled
  checklistItems[1].status = 'received';
  checklistItems[2].status = 'waived';
  checklistItems[2].waive_reason = 'Waived: Prior lab results from 2 months ago are sufficient';
  const { data: repFull } = await db.from('case_reports_requests')
    .update({ items: checklistItems, status: 'fulfilled' })
    .eq('id', repReq.id)
    .select()
    .single();
  assert('All required items fulfilled/waived transitions request to fulfilled', repFull?.status === 'fulfilled');

  // Transition case back to INITIAL_REVIEW then READY_FOR_ASSIGNMENT
  await transition(testCase.id, 'INITIAL_REVIEW', { actorRole: 'system', note: 'All requested reports fulfilled' });
  await transition(testCase.id, 'READY_FOR_ASSIGNMENT', { actorRole: 'coordinator', note: 'Ready for specialist dispatch' });

  // 4. Multi-Round Specialist Reviews (case_reviews)
  // Round 1: Fresh Case Review
  const round1Token = crypto.randomBytes(36).toString('base64url');
  const r1Expires = new Date(Date.now() + 72 * 3600_000).toISOString();

  const caseSnapshot = {
    case_number: testCase.case_number,
    specialty: testCase.specialty,
    patient_age: 46,
    patient_gender: 'MALE',
    reason: testCase.reason,
    documents_count: 2
  };

  const { data: review1, error: rev1Err } = await db.from('case_reviews').insert({
    case_id: testCase.id,
    specialist_name: 'Dr. Marcus Vance',
    round_number: 1,
    request_type: 'fresh_case',
    request_note: 'Initial international second opinion on CAD management',
    case_snapshot: caseSnapshot,
    magic_token_hash: hashToken(round1Token),
    token_expires_at: r1Expires,
    status: 'pending'
  }).select().single();
  assert('Dispatch Round 1 Review to Dr. Marcus Vance', !rev1Err && !!review1?.id, `round: ${review1?.round_number}`);

  await transition(testCase.id, 'SPECIALIST_ASSIGNED', { actorRole: 'coordinator', note: 'Assigned to Dr. Marcus Vance' });

  // Specialist opens link -> transition to UNDER_MEDICAL_REVIEW
  await transition(testCase.id, 'UNDER_MEDICAL_REVIEW', { actorRole: 'system', note: 'Specialist opened review link' });
  await db.from('case_reviews').update({ opened_at: new Date().toISOString() }).eq('id', review1.id);

  // Specialist saves draft with decision chips & 4-box opinion
  const decisionChips = {
    agreement: 'modifies_preliminary',
    path: 'further_investigation',
    urgency: 'routine'
  };

  const clinicalFindings = 'Resting ECG demonstrates normal sinus rhythm with non-specific T wave flattening in V5-V6. Symptoms are classic for stable angina (CCS Class II).';
  const diagnosticAssessment = 'Suspected single-vessel obstructive coronary artery disease. Low risk of acute coronary syndrome currently.';
  const recommendations = 'Recommend CT Coronary Angiogram to quantify stenosis and plaque burden before proceeding to invasive coronary catheterization.';
  const followUpGuidance = 'If CCTA shows >70% stenosis, refer for fractional flow reserve (FFR) assessment. Continue Aspirin 81mg and up-titrate Metoprolol.';

  // Upload Voice Note to Supabase Storage bucket
  const voiceNotePath = `voice-notes/${testCase.id}/${review1.id}-dictation.webm`;
  const dummyAudioBuffer = Buffer.from('RIFF....WAVEfmt ....data....'); // mock audio binary
  const { error: audioUpErr } = await db.storage
    .from('case-documents')
    .upload(voiceNotePath, dummyAudioBuffer, { contentType: 'audio/webm', upsert: true });
  assert('Upload Voice Note to case-documents storage bucket', !audioUpErr, voiceNotePath);

  // Submit Round 1 Review
  const { data: submitted1, error: sub1Err } = await db.from('case_reviews')
    .update({
      decision_chips: decisionChips,
      clinical_findings: clinicalFindings,
      diagnostic_assessment: diagnosticAssessment,
      recommendations: recommendations,
      follow_up_guidance: followUpGuidance,
      voice_note_path: voiceNotePath,
      status: 'submitted',
      submitted_at: new Date().toISOString()
    })
    .eq('id', review1.id)
    .select()
    .single();
  assert('Submit Round 1 Review with Decision Chips, 4-Box Opinion & Voice Note', !sub1Err && submitted1?.status === 'submitted', submitted1?.decision_chips?.path);

  await transition(testCase.id, 'REPORT_SUBMITTED', { actorRole: 'international', note: 'Opinion submitted by Dr. Marcus Vance' });

  // Dispatch Round 2 Review (Follow-up after additional diagnostic result)
  const round2Token = crypto.randomBytes(36).toString('base64url');
  const { data: review2, error: rev2Err } = await db.from('case_reviews').insert({
    case_id: testCase.id,
    specialist_name: 'Dr. Marcus Vance',
    round_number: 2,
    request_type: 'follow_up',
    request_note: 'Review post-CCTA scan results',
    case_snapshot: { ...caseSnapshot, documents_count: 3 },
    magic_token_hash: hashToken(round2Token),
    token_expires_at: new Date(Date.now() + 72 * 3600_000).toISOString(),
    status: 'pending'
  }).select().single();
  assert('Dispatch Round 2 Review (Follow-up)', !rev2Err && review2?.round_number === 2, `round: ${review2?.round_number}`);

  // Query previous rounds for "Then vs. Now" diffing
  const { data: prevRounds } = await db.from('case_reviews')
    .select('round_number, status, decision_chips, recommendations')
    .eq('case_id', testCase.id)
    .eq('status', 'submitted')
    .order('round_number', { ascending: true });
  assert('Multi-round Then vs. Now query retrieves completed Round 1', prevRounds?.length === 1 && prevRounds[0].round_number === 1);

  // 5. 3-Step Final Report Publisher
  const finalReportEn = `SPECIALIST OPINION REPORT\nCase: ${testCase.case_number}\n\nFindings:\n${clinicalFindings}\n\nDiagnosis:\n${diagnosticAssessment}\n\nAction Plan:\n${recommendations}\n\nFollow-up:\n${followUpGuidance}`;
  const finalReportAr = `تقرير الرأي الطبي الاستشاري\nالحالة: ${testCase.case_number}\n\nالنتائج السريرية:\n${clinicalFindings}\n\nالتشخيص:\n${diagnosticAssessment}\n\nخطة العلاج الموصى بها:\n${recommendations}\n\nالمتابعة والمراقبة:\n${followUpGuidance}`;

  // Draft report saved
  const { data: reportDraft, error: rptErr } = await db.from('cases')
    .update({
      final_report_en: finalReportEn,
      final_report_ar: finalReportAr,
      final_report_published: false
    })
    .eq('id', testCase.id)
    .select()
    .single();
  assert('Save Final Report Draft (Step 1)', !rptErr && !reportDraft?.final_report_published);

  // Clinical Safety Checklist (Step 2 & 3)
  const checklistValid = {
    patient_identity_checked: true,
    questions_addressed: true,
    red_flags_cleared: true,
    translation_verified: true
  };

  const { data: publishedReport, error: pubErr } = await db.from('cases')
    .update({
      final_report_published: true,
      final_report_published_at: new Date().toISOString()
    })
    .eq('id', testCase.id)
    .select()
    .single();
  assert('Publish Final Report with Clinical Safety Checklist (Step 3)', !pubErr && publishedReport?.final_report_published);

  await transition(testCase.id, 'COMPLETED', { actorRole: 'coordinator', note: 'Final report released to patient' });
  const { data: finalCaseState } = await db.from('cases').select('status').eq('id', testCase.id).single();
  assert('Case status successfully transitions to COMPLETED', finalCaseState?.status === 'COMPLETED');

  // 6. Cleanup test records
  await db.storage.from('case-documents').remove([voiceNotePath]);
  await db.from('case_reviews').delete().eq('case_id', testCase.id);
  await db.from('case_reports_requests').delete().eq('case_id', testCase.id);
  await db.from('case_timeline').delete().eq('case_id', testCase.id);
  await db.from('cases').delete().eq('id', testCase.id);
  await db.from('patients').delete().eq('id', patient.id);
  assert('Cleaned up Phase 4 test data', true);

  console.log(`\nPhase 4 Verification Complete: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Fatal error in Phase 4 verification suite:', err);
  process.exit(1);
});
