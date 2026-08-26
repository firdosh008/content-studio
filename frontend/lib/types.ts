// Mirrors the backend Pydantic schemas field for field (see ../backend/PLAN.md).
// String enums are literal unions so a typo is a compile error.

export type Role = 'admin' | 'member'

export type ArtifactType = 'social_post' | 'carousel' | 'deck' | 'single_pager' | 'image'

export type GenerationMode = 'code' | 'image'

export type ArtifactStatus =
  | 'queued'
  | 'generating'
  | 'ready'
  | 'qa_failed'
  | 'in_review'
  | 'approved'
  | 'failed'

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed'
export type CopyStatus = 'draft' | 'approved'
export type ReferenceScope = 'social' | 'presentation' | 'both'
export type ReferenceRole = 'layout' | 'typography' | 'colour_gradient' | 'overall_vibe'
export type AssetType = 'logo' | 'font' | 'headshot' | 'screenshot' | 'icon'
export type ProviderType = 'coding_agent' | 'image_provider'

export interface Me {
  id: string
  email: string
  role: Role
}

export interface Brand {
  id: string
  name: string
  slug: string
  created_at: string
}

export interface Contract {
  content: string
  version: number
  updated_at: string | null
}

export interface Reference {
  id: string
  brand_id: string
  file_ref: string
  file_type: 'image' | 'pptx'
  scope: ReferenceScope
  role: ReferenceRole
  extracted_layout_spec: string | null
  url: string | null
  created_at: string
}

export interface Asset {
  id: string
  brand_id: string
  asset_type: AssetType
  file_ref: string
  label: string
  url: string | null
  created_at: string
}

export interface Brief {
  id: string
  brand_id: string
  content: string
  source: 'manual' | 'research_agent'
  research_run_id: string | null
  created_at: string
}

// POST /briefs/from-research returns a NON-persisted prefill (FRONTEND_BUILD_PROMPT Phase 5
// amendment): the only persisted brief comes from POST /briefs. One pull -> at most one brief row.
export interface ResearchPrefill {
  content: string
  research_run_id: string
}

export interface Copy {
  id: string
  brief_id: string
  brand_id: string
  content: string
  status: CopyStatus
  version: number
  generated_by_model_id: string | null
  approved_by: string | null
  created_at: string
}

export interface QaFinding {
  check: string
  severity: 'error' | 'warning'
  detail: string
  page: number | null
}

export interface QaReport {
  passed: boolean
  findings: QaFinding[]
  checks_run: string[]
  skipped: string[]
}

export interface Artifact {
  id: string
  brand_id: string
  brief_id: string
  copy_id: string | null
  artifact_type: ArtifactType
  generation_mode: GenerationMode
  model_provider_id: string
  status: ArtifactStatus
  version: number
  parent_artifact_id: string | null
  variant_group_id: string | null
  open_design_project_ref: string | null
  export_urls: Record<string, string>
  qa_report: QaReport | Record<string, never>
  created_at: string
  // Optional, coordinated with the backend (FRONTEND_BUILD_PROMPT Phase 8):
  // per-page raster URLs for carousels/decks so human QA reviews every page,
  // and the actions the backend currently allows so the UI need not keep a map.
  pages?: string[]
  allowed_actions?: ArtifactAction[]
}

export type ArtifactAction = 'qa' | 'submit' | 'approve' | 'reject' | 'iterate'

export interface JobSnapshot {
  job_id: string
  state: JobState
  attempts: number
  progress: { stage?: string; percent?: number; detail?: string; at?: string }
  error: string | null
}

export interface Provider {
  id: string
  type: ProviderType
  name: string
  enabled: boolean
  created_at: string
}

export interface Skill {
  id: string
  name: string
  storage_ref: string
  applies_to: ArtifactType[]
  enabled: boolean
  created_at: string
}
