-- 20261125000001_deidentification_and_fk_fix.sql
-- 1. Fix case_reviews.specialist_id FK to reference international_specialists(id) instead of staff_users(id)
ALTER TABLE case_reviews DROP CONSTRAINT IF EXISTS case_reviews_specialist_id_fkey;
UPDATE case_reviews SET specialist_id = NULL WHERE specialist_id IS NOT NULL AND specialist_id NOT IN (SELECT id FROM international_specialists);
ALTER TABLE case_reviews ADD CONSTRAINT case_reviews_specialist_id_fkey FOREIGN KEY (specialist_id) REFERENCES international_specialists(id) ON DELETE SET NULL;

-- 2. Add is_deidentified flag to documents for Saudi PDPL/MOH compliance
ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_deidentified boolean NOT NULL DEFAULT false;
