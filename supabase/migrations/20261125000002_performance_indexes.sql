-- 20261125000002_performance_indexes.sql
-- Composite indexes for live DB query performance (zero caching, pure DB speed)

CREATE INDEX IF NOT EXISTS idx_cases_status_updated ON cases (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_case_active ON documents (case_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_hospital_cases_tenant_arrival ON hospital_cases (hospital_id, arrival_status);
CREATE INDEX IF NOT EXISTS idx_hospital_lab_tests_tenant_status ON hospital_lab_tests (hospital_id, status);
CREATE INDEX IF NOT EXISTS idx_hospital_meds_tenant_status ON hospital_medications (hospital_id, dispense_status);
CREATE INDEX IF NOT EXISTS idx_case_reviews_case_round ON case_reviews (case_id, round_number);
