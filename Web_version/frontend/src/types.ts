export type AudioAsset = {
  id: number
  filename: string
  original_filename: string
  source: string
  voice?: string | null
  generation_input?: string | null
  approved: boolean
  url: string
}

export type Student = {
  id: number
  student_id: string
  qr_token: string
  display_name: string
  native_name: string | null
  language: string | null
  phonetic_spelling: string | null
  program: string
  announcement_text: string
  pronunciation_status: string
  notes: string | null
  active_audio_id: number | null
  active_audio: AudioAsset | null
}

export type Ceremony = {
  id: number
  name: string
  event_date: string
  location: string
  status: string
  student_count: number
}

export type Entry = {
  id: number
  ceremony_id: number
  position: number
  status: string
  checked_in_at: string | null
  announced_at: string | null
  play_count: number
  student: Student
}

export type CeremonyDetail = Ceremony & { entries: Entry[] }

export type DashboardStats = {
  students: number
  approved: number
  with_audio: number
  ceremonies: number
  needs_attention: number
}

export type AuditEvent = {
  id: number
  event_type: string
  message: string
  created_at: string
}
