-- RLF KB CORE SCHEMA V1
-- Canonical unit: evidenced Fred Perry production variant.
-- Policy: APPEND_ONLY_FAIL_CLOSED. Unknowns stay NULL with explicit assertions/reasons.
-- Scope: all evidenced Fred Perry products, 1940s through 2026-08-31.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE kb_evidence_grade AS ENUM ('A','B','C','X');
CREATE TYPE kb_record_state AS ENUM (
  'URL_ONLY','IDENTITY_PARTIAL','GENERIC_IMAGE_SET','FORENSIC_PARTIAL',
  'FORENSIC_COMPLETE','KB_COMPLETE_A','KB_COMPLETE_B','REJECTED'
);
CREATE TYPE kb_source_status AS ENUM (
  'active','out_of_stock','archived','sitemap_only','removed','blocked','unknown'
);
CREATE TYPE kb_assertion_status AS ENUM ('proposed','supported','conflicted','rejected');
CREATE TYPE kb_image_role AS ENUM (
  'GEN_FRONT_FULL','GEN_BACK_FULL','GEN_SIDE_OR_INTERIOR','GEN_CONTEXT_DETAIL',
  'MACRO_BRAND_LABEL_FRONT','MACRO_BRAND_LABEL_BACK_OR_STITCHING',
  'MACRO_CARE_LABEL_FRONT','MACRO_CARE_LABEL_REVERSE',
  'MACRO_STYLE_SIZE_COLOUR_CODE','MACRO_FACTORY_OR_CONSTRUCTION','OTHER_EVIDENCE'
);

CREATE TABLE kb_manufacturer (
  manufacturer_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name text NOT NULL,
  normalized_name citext NOT NULL,
  country_code char(2),
  company_registration text,
  valid_from date,
  valid_to date,
  evidence_grade kb_evidence_grade NOT NULL DEFAULT 'C',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (normalized_name, country_code, company_registration)
);

CREATE TABLE kb_factory (
  factory_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manufacturer_id uuid REFERENCES kb_manufacturer(manufacturer_id),
  factory_name text,
  normalized_name citext,
  country_code char(2) NOT NULL,
  locality text,
  address_text text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  valid_from date,
  valid_to date,
  evidence_grade kb_evidence_grade NOT NULL DEFAULT 'C',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX kb_factory_identity_uq ON kb_factory
  (COALESCE(normalized_name,''), country_code, COALESCE(locality,''), COALESCE(address_text,''));

CREATE TABLE kb_model (
  fp_model_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand text NOT NULL DEFAULT 'Fred Perry' CHECK (brand = 'Fred Perry'),
  model_name_normalized text,
  model_family text,
  category text NOT NULL,
  subcategory text,
  first_known_year smallint CHECK (first_known_year BETWEEN 1940 AND 2026),
  last_known_year smallint CHECK (last_known_year BETWEEN 1940 AND 2026),
  identity_fingerprint char(64) NOT NULL UNIQUE,
  record_state kb_record_state NOT NULL DEFAULT 'IDENTITY_PARTIAL',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kb_commercial_variant (
  fp_commercial_variant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fp_model_id uuid NOT NULL REFERENCES kb_model(fp_model_id),
  style_code text,
  style_code_normalized citext,
  colour_name_official text,
  colour_code text,
  colour_visual_normalized text,
  market_or_line text,
  collaboration_name text,
  season text,
  year_exact smallint CHECK (year_exact BETWEEN 1940 AND 2026),
  year_from smallint CHECK (year_from BETWEEN 1940 AND 2026),
  year_to smallint CHECK (year_to BETWEEN 1940 AND 2026),
  identity_fingerprint char(64) NOT NULL UNIQUE,
  record_state kb_record_state NOT NULL DEFAULT 'IDENTITY_PARTIAL',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (year_from IS NULL OR year_to IS NULL OR year_from <= year_to)
);
CREATE INDEX kb_commercial_variant_style_idx ON kb_commercial_variant(style_code_normalized);
CREATE INDEX kb_commercial_variant_colour_idx ON kb_commercial_variant(colour_code, colour_name_official);

CREATE TABLE kb_production_variant (
  fp_production_variant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fp_commercial_variant_id uuid NOT NULL REFERENCES kb_commercial_variant(fp_commercial_variant_id),
  factory_id uuid REFERENCES kb_factory(factory_id),
  manufacturer_id uuid REFERENCES kb_manufacturer(manufacturer_id),
  country_of_manufacture char(2),
  label_system_code text,
  construction_revision text,
  production_year_exact smallint CHECK (production_year_exact BETWEEN 1940 AND 2026),
  production_year_from smallint CHECK (production_year_from BETWEEN 1940 AND 2026),
  production_year_to smallint CHECK (production_year_to BETWEEN 1940 AND 2026),
  identity_fingerprint char(64) NOT NULL UNIQUE,
  record_state kb_record_state NOT NULL DEFAULT 'IDENTITY_PARTIAL',
  evidence_grade kb_evidence_grade NOT NULL DEFAULT 'C',
  completeness_score numeric(5,2) NOT NULL DEFAULT 0 CHECK (completeness_score BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (production_year_from IS NULL OR production_year_to IS NULL OR production_year_from <= production_year_to)
);
CREATE INDEX kb_production_variant_factory_idx ON kb_production_variant(factory_id);
CREATE INDEX kb_production_variant_country_idx ON kb_production_variant(country_of_manufacture);

CREATE TABLE kb_material_component (
  material_component_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fp_production_variant_id uuid NOT NULL REFERENCES kb_production_variant(fp_production_variant_id),
  component_role text NOT NULL CHECK (component_role IN ('outer','lining','trim','rib','sole','upper','filling','other')),
  material_name text NOT NULL,
  percentage numeric(5,2) CHECK (percentage > 0 AND percentage <= 100),
  raw_text text,
  evidence_grade kb_evidence_grade NOT NULL DEFAULT 'C',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kb_evidence_instance (
  fp_evidence_instance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fp_production_variant_id uuid REFERENCES kb_production_variant(fp_production_variant_id),
  evidence_type text NOT NULL,
  title text,
  owner_or_archive text,
  observed_size text,
  observed_condition text,
  observed_at date,
  provenance_text text,
  evidence_grade kb_evidence_grade NOT NULL DEFAULT 'C',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kb_source_url (
  source_url_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fp_evidence_instance_id uuid REFERENCES kb_evidence_instance(fp_evidence_instance_id),
  fp_production_variant_id uuid REFERENCES kb_production_variant(fp_production_variant_id),
  url text NOT NULL,
  canonical_url text,
  domain citext NOT NULL,
  source_status kb_source_status NOT NULL DEFAULT 'unknown',
  source_kind text NOT NULL,
  http_status smallint,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  captured_at timestamptz NOT NULL DEFAULT now(),
  url_sha256 char(64) NOT NULL,
  UNIQUE (url_sha256)
);
CREATE INDEX kb_source_url_variant_idx ON kb_source_url(fp_production_variant_id);
CREATE INDEX kb_source_url_domain_idx ON kb_source_url(domain);

CREATE TABLE kb_image_asset (
  image_asset_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fp_evidence_instance_id uuid REFERENCES kb_evidence_instance(fp_evidence_instance_id),
  fp_production_variant_id uuid REFERENCES kb_production_variant(fp_production_variant_id),
  source_url_id uuid REFERENCES kb_source_url(source_url_id),
  original_url text,
  original_path text,
  normalized_path text,
  mime_type text,
  width_px integer CHECK (width_px IS NULL OR width_px > 0),
  height_px integer CHECK (height_px IS NULL OR height_px > 0),
  byte_size bigint CHECK (byte_size IS NULL OR byte_size >= 0),
  sha256 char(64) NOT NULL,
  perceptual_hash text,
  is_original boolean NOT NULL DEFAULT true,
  is_near_duplicate boolean NOT NULL DEFAULT false,
  capture_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sha256)
);

CREATE TABLE kb_image_assignment (
  image_assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_asset_id uuid NOT NULL REFERENCES kb_image_asset(image_asset_id),
  fp_production_variant_id uuid NOT NULL REFERENCES kb_production_variant(fp_production_variant_id),
  role kb_image_role NOT NULL,
  role_confidence numeric(5,2) CHECK (role_confidence BETWEEN 0 AND 100),
  forensic_usable boolean NOT NULL DEFAULT false,
  native_detail_sufficient boolean NOT NULL DEFAULT false,
  reviewer_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fp_production_variant_id, role, image_asset_id)
);
CREATE INDEX kb_image_assignment_variant_role_idx ON kb_image_assignment(fp_production_variant_id, role);

CREATE TABLE kb_assertion (
  assertion_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  predicate text NOT NULL,
  value_json jsonb NOT NULL,
  status kb_assertion_status NOT NULL DEFAULT 'proposed',
  evidence_grade kb_evidence_grade NOT NULL DEFAULT 'C',
  confidence numeric(5,2) CHECK (confidence BETWEEN 0 AND 100),
  rationale text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kb_assertion_subject_idx ON kb_assertion(subject_type, subject_id, predicate);

CREATE TABLE kb_assertion_evidence (
  assertion_id uuid NOT NULL REFERENCES kb_assertion(assertion_id),
  fp_evidence_instance_id uuid NOT NULL REFERENCES kb_evidence_instance(fp_evidence_instance_id),
  PRIMARY KEY (assertion_id, fp_evidence_instance_id)
);

CREATE TABLE kb_identity_relationship (
  relationship_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  left_entity_type text NOT NULL,
  left_entity_id uuid NOT NULL,
  relation text NOT NULL CHECK (relation IN ('same_as','variant_of','supersedes','possible_same_as','conflicts_with','derived_from')),
  right_entity_type text NOT NULL,
  right_entity_id uuid NOT NULL,
  evidence_grade kb_evidence_grade NOT NULL DEFAULT 'C',
  status kb_assertion_status NOT NULL DEFAULT 'proposed',
  rationale text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (left_entity_type, left_entity_id, relation, right_entity_type, right_entity_id)
);

CREATE TABLE kb_ingestion_event (
  ingestion_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id text NOT NULL,
  lane_id text NOT NULL,
  source_type text NOT NULL,
  source_locator text NOT NULL,
  payload_sha256 char(64),
  outcome text NOT NULL,
  records_observed integer NOT NULL DEFAULT 0,
  records_created integer NOT NULL DEFAULT 0,
  records_linked integer NOT NULL DEFAULT 0,
  records_rejected integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (run_id, lane_id, source_locator)
);

-- Ten required documentary roles. The sixth forensic macro is required when origin/manufacturing
-- is not independently visible in MACRO_STYLE_SIZE_COLOUR_CODE.
CREATE VIEW kb_variant_image_completeness AS
SELECT
  pv.fp_production_variant_id,
  COUNT(DISTINCT ia.role) FILTER (WHERE ia.role::text LIKE 'GEN_%') AS generic_roles,
  COUNT(DISTINCT ia.role) FILTER (WHERE ia.role::text LIKE 'MACRO_%') AS forensic_roles,
  BOOL_OR(ia.role = 'MACRO_FACTORY_OR_CONSTRUCTION' AND ia.forensic_usable) AS has_factory_macro,
  COUNT(DISTINCT img.sha256) AS unique_images
FROM kb_production_variant pv
LEFT JOIN kb_image_assignment ia ON ia.fp_production_variant_id = pv.fp_production_variant_id
LEFT JOIN kb_image_asset img ON img.image_asset_id = ia.image_asset_id AND NOT img.is_near_duplicate
GROUP BY pv.fp_production_variant_id;

-- Promotion is deliberately not automatic. This view only reports eligibility.
CREATE VIEW kb_promotion_eligibility AS
SELECT
  pv.fp_production_variant_id,
  pv.evidence_grade,
  pv.record_state,
  COALESCE(ic.generic_roles,0) AS generic_roles,
  COALESCE(ic.forensic_roles,0) AS forensic_roles,
  COALESCE(ic.unique_images,0) AS unique_images,
  (COALESCE(ic.generic_roles,0) >= 4 AND COALESCE(ic.forensic_roles,0) >= 5) AS image_set_complete,
  (pv.country_of_manufacture IS NOT NULL) AS has_country,
  (pv.factory_id IS NOT NULL OR pv.manufacturer_id IS NOT NULL) AS has_factory_or_manufacturer,
  EXISTS (SELECT 1 FROM kb_material_component mc WHERE mc.fp_production_variant_id = pv.fp_production_variant_id) AS has_materials
FROM kb_production_variant pv
LEFT JOIN kb_variant_image_completeness ic USING (fp_production_variant_id);
