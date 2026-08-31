export type UserRole = "candidate" | "admin";
export type JobStatus = "active" | "frozen";
export type ParseStatus = "pending" | "parsing" | "parsed" | "failed";
export type ResumeSource = "application" | "admin_upload";
export type ApplicationStatus = "applied" | "withdrawn";
export type PipelineKind = "parse" | "shortlist";
export type PipelineStatus = "queued" | "running" | "succeeded" | "failed";

export const SUPER_ADMIN_EMAIL = "rk26.ftw@gmail.com";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  role: UserRole;
  roles_of_interest: string[];
  created_at: string;
  updated_at: string;
}

export interface Job {
  id: string;
  created_by: string;
  company_name: string;
  recruiter_name: string;
  recruiter_email: string;
  description: string;
  description_file_path: string | null;
  tags: string[];
  status: JobStatus;
  jd_version: number;
  pool_version: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentRow {
  id: string;
  content_hash: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  parsed_text: string | null;
  extracted_email: string | null;
  status: ParseStatus;
  error: string | null;
  parsed_at: string | null;
  created_at: string;
}

export interface Resume {
  id: string;
  job_id: string;
  document_id: string;
  candidate_id: string | null;
  source: ResumeSource;
  created_at: string;
}

export interface Application {
  id: string;
  job_id: string;
  candidate_id: string;
  resume_id: string | null;
  status: ApplicationStatus;
  created_at: string;
  updated_at: string;
}

export interface Explanation {
  id: string;
  resume_id: string;
  jd_version: number;
  pros: string[];
  cons: string[];
  created_at: string;
}

export interface PipelineJob {
  id: string;
  job_id: string;
  kind: PipelineKind;
  status: PipelineStatus;
  payload: Record<string, unknown>;
  progress_done: number;
  progress_total: number;
  message: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface NotificationRow {
  id: string;
  recipient_id: string;
  job_id: string | null;
  company_name: string;
  recruiter_name: string;
  recruiter_email: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

/** One row of the shortlist the admin sees, assembled from several tables. */
export interface ShortlistEntry {
  rank: number;
  score: number;
  resumeId: string;
  documentId: string;
  fileName: string;
  candidateEmail: string | null;
  pros: string[];
  cons: string[];
  shortlisted: boolean;
}
