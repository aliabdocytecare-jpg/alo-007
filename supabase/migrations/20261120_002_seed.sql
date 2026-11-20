-- AloDoc seed data — specialties, services, formulary, SLA targets, settings
insert into specialties (name_en, name_ar) values
 ('General Medicine','الطب العام'),
 ('Internal Medicine','الطب الباطني'),
 ('Cardiology','أمراض القلب'),
 ('Oncology','الأورام'),
 ('Orthopedics','العظام'),
 ('Pediatrics','الأطفال'),
 ('Dermatology','الجلدية'),
 ('Neurology','الأعصاب')
on conflict (name_en) do nothing;

insert into services (code, name_en, name_ar) values
 ('PHARMACY','Pharmacy / Medication','الصيدلة / الأدوية'),
 ('PHYSIOTHERAPY','Physiotherapy','العلاج الطبيعي'),
 ('HOME_NURSING','Home Nursing / Home Healthcare','التمريض المنزلي / الرعاية المنزلية'),
 ('HIJAMA','Hijama','الحجامة'),
 ('OTHER','Other Service','خدمة أخرى')
on conflict (code) do nothing;

insert into drug_formulary (generic_name, brand_name, common_dosages, route) values
 ('Paracetamol','Panadol', array['500 mg','1 g'], 'Oral'),
 ('Ibuprofen','Brufen', array['200 mg','400 mg'], 'Oral'),
 ('Amoxicillin','Amoxil', array['250 mg','500 mg'], 'Oral'),
 ('Amoxicillin/Clavulanate','Augmentin', array['625 mg','1 g'], 'Oral'),
 ('Azithromycin','Zithromax', array['250 mg','500 mg'], 'Oral'),
 ('Metformin','Glucophage', array['500 mg','850 mg','1000 mg'], 'Oral'),
 ('Amlodipine','Norvasc', array['5 mg','10 mg'], 'Oral'),
 ('Atorvastatin','Lipitor', array['10 mg','20 mg','40 mg'], 'Oral'),
 ('Omeprazole','Losec', array['20 mg','40 mg'], 'Oral'),
 ('Salbutamol','Ventolin', array['100 mcg/puff'], 'Inhaled'),
 ('Cetirizine','Zyrtec', array['10 mg'], 'Oral'),
 ('Insulin Glargine','Lantus', array['100 IU/mL'], 'Subcutaneous');

-- SLA targets (minutes) per governed status — BR-019, US-ADM-005
insert into sla_config (status, target_minutes) values
 ('SUBMITTED', 60),
 ('INITIAL_REVIEW', 1440),
 ('ADDITIONAL_INFO_REQUIRED', 4320),
 ('READY_FOR_ASSIGNMENT', 480),
 ('SPECIALIST_ASSIGNED', 240),
 ('UNDER_MEDICAL_REVIEW', 4320),
 ('APPOINTMENT_SCHEDULED', 1440),
 ('IN_PROGRESS', 240),
 ('REPORT_SUBMITTED', 480)
on conflict (status) do nothing;

insert into system_settings (key, value) values
 ('meet_visibility_hours', '2'),
 ('payment_instructions_en', 'Manual payment: please transfer the case fee to the AloDoc bank account (details sent via WhatsApp). Your coordinator will confirm receipt and your case will proceed.'),
 ('payment_instructions_ar', 'الدفع اليدوي: يرجى تحويل رسوم الحالة إلى الحساب البنكي لـ الو دوك (التفاصيل عبر واتساب). سيؤكد المنسق الاستلام وستتابع حالتك.')
on conflict (key) do nothing;