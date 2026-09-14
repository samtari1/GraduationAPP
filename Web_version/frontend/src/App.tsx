import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PronunciationTools, { languageDisplayName } from './PronunciationTools'
import { api } from './api'
import type { AuditEvent, Ceremony, CeremonyDetail, DashboardStats, Entry, Student } from './types'

type View = 'dashboard' | 'ceremonies' | 'control'

const navItems: { id: View; label: string; glyph: string }[] = [
  { id: 'dashboard', label: 'Overview', glyph: '▦' },
  { id: 'ceremonies', label: 'Ceremonies', glyph: '◇' },
  { id: 'control', label: 'Stage control', glyph: '▶' },
]

const viewPaths: Record<View, string> = {
  dashboard: '/',
  ceremonies: '/ceremonies',
  control: '/stage-control',
}

const viewFromPath = (pathname: string): View => {
  const normalized = pathname.replace(/\/+$/, '') || '/'
  if (normalized === '/students') return 'ceremonies'
  const match = (Object.entries(viewPaths) as [View, string][]).find(([, path]) => path === normalized)
  return match?.[0] ?? 'dashboard'
}

const statusLabel = (value: string) => value.replaceAll('_', ' ')

function App() {
  const [view, setView] = useState<View>(() => viewFromPath(window.location.pathname))
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('gradvoice.sidebarCollapsed') === 'true')
  const [ceremonies, setCeremonies] = useState<Ceremony[]>([])
  const [selectedCeremonyId, setSelectedCeremonyId] = useState<number | null>(null)
  const [notice, setNotice] = useState<string>('')

  const loadCore = async () => {
    const ceremonyData = await api.get<Ceremony[]>('/api/ceremonies')
    setCeremonies(ceremonyData)
    setSelectedCeremonyId((current) => current ?? ceremonyData[0]?.id ?? null)
  }

  useEffect(() => {
    loadCore().catch((error) => setNotice(error.message))
  }, [])

  useEffect(() => {
    const handleHistoryNavigation = () => {
      setView(viewFromPath(window.location.pathname))
      setNotice('')
    }
    window.addEventListener('popstate', handleHistoryNavigation)
    return () => window.removeEventListener('popstate', handleHistoryNavigation)
  }, [])

  useEffect(() => {
    const label = navItems.find((item) => item.id === view)?.label ?? 'GradVoice'
    document.title = `${label} | GradVoice`
  }, [view])

  useEffect(() => {
    localStorage.setItem('gradvoice.sidebarCollapsed', String(sidebarCollapsed))
  }, [sidebarCollapsed])

  const navigate = (target: View) => {
    const path = viewPaths[target]
    if (window.location.pathname !== path) window.history.pushState({ view: target }, '', path)
    setView(target)
    setNotice('')
  }

  return (
    <div className={sidebarCollapsed ? 'app-shell sidebar-collapsed' : 'app-shell'}>
      <aside className="sidebar" aria-label="Application sidebar">
        <div className="brand">
          <div className="brand-mark">G</div>
          <div className="brand-copy">
            <strong>GradVoice</strong>
            <span>Ceremony studio</span>
          </div>
          <button
            className="sidebar-toggle"
            type="button"
            onClick={() => setSidebarCollapsed((current) => !current)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!sidebarCollapsed}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? '›' : '‹'}
          </button>
        </div>
        <nav aria-label="Main navigation">
          {navItems.map((item) => (
            <button className={view === item.id ? 'nav-item active' : 'nav-item'} onClick={() => navigate(item.id)} key={item.id} title={sidebarCollapsed ? item.label : undefined} aria-label={item.label}>
              <span className="nav-glyph">{item.glyph}</span><span className="nav-label">{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="offline-card">
          <span className="live-dot" />
          <div><strong>Offline ready</strong><small>Local database connected</small></div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <p className="eyebrow">Sandhills Community College</p>
          <div className="top-actions">
            <select
              aria-label="Active ceremony"
              value={selectedCeremonyId ?? ''}
              onChange={(event) => setSelectedCeremonyId(Number(event.target.value))}
            >
              <option value="">Select a ceremony</option>
              {ceremonies.map((ceremony) => <option value={ceremony.id} key={ceremony.id}>{ceremony.name}</option>)}
            </select>
            <button className="avatar" title="Local administrator">AD</button>
          </div>
        </header>
        {notice && <div className="notice" role="alert">{notice}<button onClick={() => setNotice('')}>Dismiss</button></div>}
        <div className="page">
          {view === 'dashboard' && <Dashboard onNavigate={navigate} selectedCeremonyId={selectedCeremonyId} />}
          {view === 'ceremonies' && <Ceremonies ceremonies={ceremonies} selectedCeremonyId={selectedCeremonyId} reload={loadCore} setSelected={setSelectedCeremonyId} setNotice={setNotice} />}
          {view === 'control' && <StageControl ceremonyId={selectedCeremonyId} setNotice={setNotice} />}
        </div>
      </main>
    </div>
  )
}

function Dashboard({ onNavigate, selectedCeremonyId }: { onNavigate: (view: View) => void; selectedCeremonyId: number | null }) {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [audit, setAudit] = useState<AuditEvent[]>([])
  const [readiness, setReadiness] = useState<{ ready: boolean; total: number; issue_count: number } | null>(null)

  useEffect(() => {
    api.get<DashboardStats>('/api/dashboard').then(setStats)
    api.get<AuditEvent[]>('/api/audit?limit=6').then(setAudit)
    if (selectedCeremonyId) api.get(`/api/ceremonies/${selectedCeremonyId}/readiness`).then((value) => setReadiness(value as typeof readiness))
  }, [selectedCeremonyId])

  return <>
    <section className="hero">
      <div>
        <p className="eyebrow light">CEREMONY COMMAND CENTER</p>
        <h2>Every name, spoken with care.</h2>
        <p>Prepare pronunciations, organize the procession, and run graduation confidently—even without internet.</p>
      </div>
      <button className="primary light-button" onClick={() => onNavigate('control')}>Open stage control <span>→</span></button>
    </section>
    <section className="stats-grid">
      <Stat label="Graduating students" value={stats?.students ?? '—'} detail={`${stats?.with_audio ?? 0} have approved audio`} />
      <Stat label="Pronunciations approved" value={stats?.approved ?? '—'} detail={`${stats?.needs_attention ?? 0} need attention`} tone="gold" />
      <Stat label="Active ceremonies" value={stats?.ceremonies ?? '—'} detail="Local ceremony database" />
      <Stat label="Ceremony readiness" value={readiness?.ready ? 'Ready' : readiness ? `${readiness.issue_count} issues` : '—'} detail={readiness ? `${readiness.total} assigned students` : 'Select a ceremony'} tone={readiness?.ready ? 'green' : 'red'} />
    </section>
    <div className="two-column">
      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">WORKFLOW</p><h3>Preparation checklist</h3></div></div>
        <div className="checklist">
          <button onClick={() => onNavigate('ceremonies')}><span>01</span><div><strong>Create or select a ceremony</strong><small>Keep each graduating class in its own ceremony</small></div><b>→</b></button>
          <button onClick={() => onNavigate('ceremonies')}><span>02</span><div><strong>Import and review graduates</strong><small>Manage names, languages, and audio within the ceremony</small></div><b>→</b></button>
          <button onClick={() => onNavigate('ceremonies')}><span>03</span><div><strong>Confirm ceremony order</strong><small>Review the roster and readiness</small></div><b>→</b></button>
          <button onClick={() => onNavigate('control')}><span>04</span><div><strong>Rehearse stage controls</strong><small>Test scanning, queueing, and speaker output</small></div><b>→</b></button>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">AUDIT TRAIL</p><h3>Recent activity</h3></div></div>
        <div className="activity-list">
          {audit.length === 0 && <p className="empty">Activity will appear here.</p>}
          {audit.map((event) => <div className="activity" key={event.id}><span className="activity-icon">✓</span><div><strong>{event.message}</strong><small>{new Date(event.created_at).toLocaleString()}</small></div></div>)}
        </div>
      </section>
    </div>
  </>
}

function Stat({ label, value, detail, tone = '' }: { label: string; value: string | number; detail: string; tone?: string }) {
  return <article className={`stat-card ${tone}`}><p>{label}</p><strong>{value}</strong><small>{detail}</small></article>
}

function Students({ ceremonyId, students, reload, setNotice }: { ceremonyId: number; students: Student[]; reload: () => Promise<void>; setNotice: (value: string) => void }) {
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Student | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)
  const filtered = useMemo(() => students.filter((student) => `${student.display_name} ${student.student_id} ${student.program}`.toLowerCase().includes(search.toLowerCase())), [students, search])

  const importCsv = async (file?: File) => {
    if (!file) return
    const form = new FormData(); form.append('file', file)
    try {
      const result = await api.post<{ created: number; updated: number; skipped: number }>(`/api/ceremonies/${ceremonyId}/students/import`, form)
      setNotice(`Import complete: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped.`)
      await reload()
    } catch (error) { setNotice((error as Error).message) }
    if (importRef.current) importRef.current.value = ''
  }

  const exportCsv = () => {
    const headers = ['student_id', 'display_name', 'native_name', 'language', 'phonetic_spelling', 'program', 'announcement_text']
    const escapeCsv = (value: string | null) => `"${(value ?? '').replaceAll('"', '""')}"`
    const rows = students.map((student) => [student.student_id, student.display_name, student.native_name, student.language, student.phonetic_spelling, student.program, student.announcement_text].map(escapeCsv).join(','))
    const csv = `\uFEFF${headers.join(',')}\n${rows.join('\n')}\n`
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `ceremony-${ceremonyId}-students.csv`
    link.click()
    URL.revokeObjectURL(url)
    setNotice(`Exported ${students.length} student${students.length === 1 ? '' : 's'} to CSV.`)
  }

  return <>
    <div className="page-heading ceremony-students-heading"><div><p className="eyebrow">CEREMONY GRADUATES</p><h2>Student pronunciation records</h2><p>These students belong only to this ceremony.</p><small className="csv-format-note">CSV headers can be in any order. Required: <strong>student_id</strong>, <strong>display_name</strong>. Optional: <strong>native_name</strong>, <strong>language</strong>, <strong>phonetic_spelling</strong>, <strong>program</strong>, <strong>announcement_text</strong>.</small></div><div className="heading-actions"><input ref={importRef} type="file" accept=".csv" hidden onChange={(e) => importCsv(e.target.files?.[0])} /><button className="secondary" onClick={exportCsv}>Export Students to CSV</button><button className="secondary" onClick={() => importRef.current?.click()}>Import CSV</button><button className="primary" onClick={() => setShowAdd(true)}>+ Add student</button></div></div>
    <section className="panel table-panel">
      <div className="table-tools"><label className="search"><span>⌕</span><input placeholder="Search by name, ID, or program" value={search} onChange={(e) => setSearch(e.target.value)} /></label><span>{filtered.length} students</span></div>
      <div className="table-wrap"><table><thead><tr><th>Student</th><th>Program</th><th>Pronunciation</th><th>Audio</th><th></th></tr></thead><tbody>
        {filtered.map((student) => <tr key={student.id}><td><div className="student-cell"><span className="initials">{student.display_name.split(' ').slice(0,2).map((part) => part[0]).join('')}</span><div><strong>{student.display_name}</strong>{student.native_name && <small dir="auto">{student.native_name}</small>}<small>ID {student.student_id}</small></div></div></td><td>{student.program || <span className="muted">Not set</span>}</td><td><span className={`badge ${student.pronunciation_status}`}>{statusLabel(student.pronunciation_status)}</span>{student.phonetic_spelling && <small className="block">{student.phonetic_spelling}</small>}</td><td>{student.active_audio ? <button className="play-mini" onClick={() => new Audio(student.active_audio!.url).play()}>▶ Play</button> : <span className="muted">Missing</span>}</td><td><button className="text-button" onClick={() => setEditing(student)}>Review</button></td></tr>)}
      </tbody></table></div>
    </section>
    {(editing || showAdd) && <StudentModal ceremonyId={ceremonyId} student={editing} close={() => { setEditing(null); setShowAdd(false) }} reload={reload} setNotice={setNotice} />}
  </>
}

function StudentModal({ ceremonyId, student, close, reload, setNotice }: { ceremonyId: number; student: Student | null; close: () => void; reload: () => Promise<void>; setNotice: (value: string) => void }) {
  const [form, setForm] = useState({ student_id: student?.student_id ?? '', display_name: student?.display_name ?? '', native_name: student?.native_name ?? '', language: student?.language ?? '', phonetic_spelling: student?.phonetic_spelling ?? '', program: student?.program ?? '', announcement_text: student?.announcement_text ?? '', pronunciation_status: student?.pronunciation_status ?? 'pending', notes: student?.notes ?? '' })
  const [supportedLanguages, setSupportedLanguages] = useState<string[]>([])
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const dirty = !!student && Object.entries(form).some(([key, value]) => value !== (student[key as keyof Student] ?? ''))
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }))
  useEffect(() => {
    let active = true
    api.get<string[]>('/api/speech/languages').then(result => {
      if (!active) return
      const sorted = result.slice().sort((a, b) => languageDisplayName(a).localeCompare(languageDisplayName(b)))
      setSupportedLanguages(sorted)
    }).catch(error => setNotice((error as Error).message))
    return () => { active = false }
  }, [student?.id])
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    try {
      const saved = student ? await api.patch<Student>(`/api/students/${student.id}`, form) : await api.post<Student>(`/api/ceremonies/${ceremonyId}/students/new`, form)
      if (audioFile) {
        const data = new FormData(); data.append('file', audioFile); data.append('source', 'upload'); data.append('approve', 'true')
        await api.post(`/api/students/${saved.id}/audio`, data)
      }
      await reload(); setNotice(`${form.display_name} saved.`); close()
    } catch (error) { setNotice((error as Error).message) }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}><form className="modal" onSubmit={submit}><div className="modal-heading"><div><p className="eyebrow">PRONUNCIATION RECORD</p><h2>{student ? 'Review student' : 'Add student'}</h2></div><button type="button" className="close" onClick={close}>×</button></div><div className="form-grid">
    <label>Student ID<input required value={form.student_id} onChange={(e) => update('student_id', e.target.value)} /></label>
    <label>Display name<input required value={form.display_name} onChange={(e) => update('display_name', e.target.value)} /></label>
    <label>Native-language name<input dir="auto" value={form.native_name} onChange={(e) => update('native_name', e.target.value)} /></label>
    <label>Language or regional variety<select value={form.language} onChange={(e) => update('language', e.target.value)}><option value="">Select a language</option>{form.language && !supportedLanguages.includes(form.language) && <option value={form.language}>{form.language} (existing value)</option>}{supportedLanguages.map(code => <option value={code} key={code}>{languageDisplayName(code)} · {code}</option>)}</select></label>
    <label className="wide">Phonetic guide<input value={form.phonetic_spelling} placeholder="e.g. ngwin meen ahn" onChange={(e) => update('phonetic_spelling', e.target.value)} /></label>
    <label>Program<input value={form.program} onChange={(e) => update('program', e.target.value)} /></label>
    <label>Status<select value={form.pronunciation_status} onChange={(e) => update('pronunciation_status', e.target.value)}><option value="pending">Pending</option><option value="needs_review">Needs review</option><option value="approved">Approved</option></select></label>
    <label className="wide">Exact ceremony announcement<input value={form.announcement_text} placeholder={form.display_name || 'Name to announce'} onChange={(e) => update('announcement_text', e.target.value)} /></label>
    <label className="wide upload-zone">Approved pronunciation audio<input type="file" accept="audio/*" onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)} /><span>{audioFile?.name ?? (student?.active_audio ? `Current: ${student.active_audio.original_filename}` : 'Choose an MP3, WAV, M4A, OGG, or WebM file')}</span></label>
    <label className="wide">Reviewer notes<textarea rows={3} value={form.notes} onChange={(e) => update('notes', e.target.value)} /></label>
  </div>
  {student && <PronunciationTools student={student} dirty={dirty || !!audioFile} onChanged={async (updated, message) => { setForm(current => ({ ...current, pronunciation_status: updated.pronunciation_status })); await reload(); setNotice(message) }} />}
  <div className="modal-actions"><button type="button" className="secondary" onClick={close}>Cancel</button><button className="primary">Save record</button></div></form></div>
}

function Ceremonies({ ceremonies, selectedCeremonyId, reload, setSelected, setNotice }: { ceremonies: Ceremony[]; selectedCeremonyId: number | null; reload: () => Promise<void>; setSelected: (id: number | null) => void; setNotice: (value: string) => void }) {
  const [detail, setDetail] = useState<CeremonyDetail | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [editingCeremony, setEditingCeremony] = useState<Ceremony | null>(null)
  const [form, setForm] = useState({ name: '', event_date: '', location: '' })
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)
  const loadDetail = (id: number) => api.get<CeremonyDetail>(`/api/ceremonies/${id}`).then(setDetail).catch((e) => setNotice(e.message))
  useEffect(() => { if (selectedCeremonyId) void loadDetail(selectedCeremonyId); else setDetail(null) }, [selectedCeremonyId])
  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setCreateError('')
    if (!form.name.trim()) { setCreateError('Enter a ceremony name.'); return }
    if (!form.event_date) { setCreateError('Choose a ceremony date.'); return }
    setCreating(true)
    try {
      const ceremony = editingCeremony
        ? await api.patch<Ceremony>(`/api/ceremonies/${editingCeremony.id}`, { ...form, name: form.name.trim(), location: form.location.trim() })
        : await api.post<Ceremony>('/api/ceremonies', { ...form, name: form.name.trim(), location: form.location.trim() })
      await reload(); setSelected(ceremony.id); await loadDetail(ceremony.id)
      setForm({ name: '', event_date: '', location: '' }); setShowCreate(false); setEditingCeremony(null)
      setNotice(`${ceremony.name} ${editingCeremony ? 'updated' : 'created'}.`)
    } catch (e) {
      setCreateError((e as Error).message)
    } finally { setCreating(false) }
  }
  const editCeremony = () => {
    if (!detail) return
    setCreateError('')
    setForm({ name: detail.name, event_date: detail.event_date, location: detail.location })
    setEditingCeremony(detail)
  }
  const deleteCeremony = async () => {
    if (!detail || !window.confirm(`Delete ${detail.name}? This will remove its roster assignments.`)) return
    setCreateError('')
    setCreating(true)
    try {
      await api.delete(`/api/ceremonies/${detail.id}`)
      await reload()
      setSelected(null)
      setDetail(null)
      setShowCreate(false)
      setEditingCeremony(null)
      setForm({ name: '', event_date: '', location: '' })
      setNotice(`${detail.name} deleted.`)
    } catch (e) {
      setCreateError((e as Error).message)
    } finally { setCreating(false) }
  }
  const closeCeremonyModal = () => { if (!creating) { setShowCreate(false); setEditingCeremony(null); setCreateError(''); setForm({ name: '', event_date: '', location: '' }) } }
  const reloadCeremony = async () => { await reload(); if (detail) await loadDetail(detail.id) }
  return <>
    <div className="page-heading"><div><p className="eyebrow">EVENT PLANNING</p><h2>Ceremonies</h2><p>Organize graduates and confirm every announcement is ready.</p></div><button className="primary" onClick={() => { setCreateError(''); setShowCreate(true) }}>+ New ceremony</button></div>
    {detail && <p><a href={`/api/ceremonies/${detail.id}/qr-cards`} target="_blank" rel="noreferrer">Open printable QR cards for {detail.name}</a></p>}
    <div className="ceremony-grid">
      <section className="ceremony-list">{ceremonies.map((ceremony) => <button key={ceremony.id} className={detail?.id === ceremony.id ? 'ceremony-card selected' : 'ceremony-card'} onClick={() => { loadDetail(ceremony.id); setSelected(ceremony.id) }}><span className="date-tile"><b>{new Date(`${ceremony.event_date}T12:00:00`).toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}</b><strong>{new Date(`${ceremony.event_date}T12:00:00`).getDate()}</strong></span><div><strong>{ceremony.name}</strong><small>{ceremony.location || 'Location not set'}</small><small>{ceremony.student_count} students</small></div><span>→</span></button>)}</section>
      <section className="panel ceremony-detail">{detail ? <><div className="panel-heading"><div><p className="eyebrow">CEREMONY ROSTER</p><h3>{detail.name}</h3></div><div className="panel-heading-actions"><button className="secondary" onClick={editCeremony}>Edit ceremony</button></div></div><div className="roster">{detail.entries.map((entry) => <div className="roster-row" key={entry.id}><span>{entry.position}</span><div><strong>{entry.student.display_name}</strong><small>{entry.student.program}</small></div><span className={entry.student.active_audio ? 'ready-mark' : 'missing-mark'}>{entry.student.active_audio ? '✓ Audio ready' : '! Audio missing'}</span></div>)}{detail.entries.length === 0 && <p className="empty">Add or import students below to build this ceremony.</p>}</div></> : <div className="empty-state"><span>◇</span><h3>Select a ceremony</h3><p>Choose an event to manage its graduating class.</p></div>}</section>
    </div>
    {detail && <Students ceremonyId={detail.id} students={detail.entries.map(entry => entry.student)} reload={reloadCeremony} setNotice={setNotice} />}
    {(showCreate || editingCeremony) && <div className="modal-backdrop"><form className="modal small-modal" onSubmit={create} noValidate><div className="modal-heading"><h2>{editingCeremony ? 'Edit ceremony' : 'New ceremony'}</h2><button type="button" className="close" disabled={creating} onClick={closeCeremonyModal}>×</button></div><div className="form-grid single"><label>Ceremony name<input autoFocus required value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} /></label><label>Date<input required type="date" value={form.event_date} onChange={(e) => setForm({...form, event_date: e.target.value})} /></label><label>Location <small>(optional)</small><input value={form.location} onChange={(e) => setForm({...form, location: e.target.value})} /></label></div>{createError && <p className="modal-error" role="alert">{createError}</p>}<div className="modal-actions">{editingCeremony && <button type="button" className="danger-button" disabled={creating} onClick={deleteCeremony}>Delete ceremony</button>}<button type="button" className="secondary" disabled={creating} onClick={closeCeremonyModal}>Cancel</button><button className="primary" disabled={creating}>{creating ? 'Saving…' : editingCeremony ? 'Save ceremony' : 'Create ceremony'}</button></div></form></div>}
  </>
}

function StageControl({ ceremonyId, setNotice }: { ceremonyId: number | null; setNotice: (value: string) => void }) {
  const [ceremony, setCeremony] = useState<CeremonyDetail | null>(null)
  const [scan, setScan] = useState('')
  const [rosterSearch, setRosterSearch] = useState('')
  const [draggedEntryId, setDraggedEntryId] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [connected, setConnected] = useState(false)
  const load = useCallback(() => ceremonyId ? api.get<CeremonyDetail>(`/api/ceremonies/${ceremonyId}`).then(value => { setCeremony(value); setConnected(true) }).catch((e) => { setConnected(false); setNotice(e.message) }) : Promise.resolve(), [ceremonyId, setNotice])
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => { await load(); if (!stopped) timer = setTimeout(poll, 2000) }
    void poll()
    return () => { stopped = true; clearTimeout(timer) }
  }, [load])
  const activeQueue = ceremony?.entries.filter((entry) => ['checked_in', 'queued'].includes(entry.status)).sort((a,b) => a.position - b.position) ?? []
  const current = activeQueue[0]
  const nextExpected = ceremony?.entries.slice().sort((a,b) => a.position - b.position).find((entry) => entry.status === 'expected')
  const visibleRoster = ceremony?.entries.filter((entry) => {
    const query = rosterSearch.trim().toLocaleLowerCase()
    return !query || entry.student.display_name.toLocaleLowerCase().includes(query) || entry.student.student_id.toLocaleLowerCase().includes(query) || entry.student.program.toLocaleLowerCase().includes(query)
  }).sort((a,b) => a.position - b.position) ?? []
  const scanned = async (event: React.FormEvent) => { event.preventDefault(); if (!ceremonyId || !scan.trim()) return; try { await api.post(`/api/ceremonies/${ceremonyId}/scan`, { token: scan }); setScan(''); await load() } catch (e) { setNotice((e as Error).message) } }
  const manualCheckIn = async (entry: Entry) => {
    if (!ceremonyId) return
    try {
      await api.post(`/api/ceremonies/${ceremonyId}/scan`, { token: entry.student.student_id })
      await load()
    } catch (e) { setNotice((e as Error).message) }
  }
  const undoCheckIn = async (entry: Entry) => action(entry, 'reset')
  const reorderQueue = async (sourceId: number, targetId: number) => {
    if (!ceremonyId || sourceId === targetId) return
    const entryIds = activeQueue.map((entry) => entry.id)
    const sourceIndex = entryIds.indexOf(sourceId)
    const targetIndex = entryIds.indexOf(targetId)
    if (sourceIndex < 1 || targetIndex < 1) return
    const [moved] = entryIds.splice(sourceIndex, 1)
    entryIds.splice(targetIndex, 0, moved)
    setDraggedEntryId(null)
    try {
      const updated = await api.post<CeremonyDetail>(`/api/ceremonies/${ceremonyId}/queue/reorder`, { entry_ids: entryIds })
      setCeremony(updated)
    } catch (e) { setNotice((e as Error).message); await load() }
  }
  const moveQueueEntry = (entryId: number, offset: number) => {
    const index = activeQueue.findIndex((entry) => entry.id === entryId)
    const target = activeQueue[index + offset]
    if (index < 1 || !target || index + offset < 1) return
    void reorderQueue(entryId, target.id)
  }
  const action = async (entry: Entry, value: string) => {
    try {
      if (['announce', 'replay'].includes(value)) {
        if (audioRef.current && !audioRef.current.paused) throw new Error('Wait for the current announcement to finish.')
        const latest = await api.get<CeremonyDetail>(`/api/ceremonies/${entry.ceremony_id}`)
        const fresh = latest.entries.find(item => item.id === entry.id)
        if (!fresh?.student.active_audio?.approved || fresh.student.pronunciation_status !== 'approved') throw new Error('Audio is missing or needs review. Approve a pronunciation first.')
        if (value === 'announce' && fresh.status === 'announced') throw new Error('Student has already been announced.')
        audioRef.current = new Audio(fresh.student.active_audio.url)
        await audioRef.current.play()
      }
      await api.post(`/api/entries/${entry.id}/action`, { action: value })
      await load()
    } catch (e) { setNotice((e as Error).message) }
  }
  if (!ceremonyId) return <div className="empty-state tall"><span>▶</span><h2>Select a ceremony first</h2><p>Use the ceremony selector in the upper-right corner.</p></div>
  return <>
    <div className="stage-heading"><div><p className="eyebrow">LIVE CEREMONY MODE · CEREMONY ID {ceremonyId}</p><h2>{ceremony?.name ?? 'Loading…'}</h2></div><div className="stage-status">{connected ? 'Local server connected' : 'Local server disconnected'}</div></div>
    <div className="stage-checkin-tools"><form className="scan-bar" onSubmit={scanned}><label><span>SCAN</span><input autoFocus value={scan} onChange={(e) => setScan(e.target.value)} placeholder="Scan QR code, swipe card, or enter student ID" /></label><button className="primary">Check in</button></form><button className="secondary next-student-button" disabled={!nextExpected} onClick={() => nextExpected && manualCheckIn(nextExpected)}>Next student{nextExpected ? `: ${nextExpected.student.display_name}` : ''}</button></div>
    <div className="stage-grid">
      <section className="now-card">
        <p className="eyebrow light">NOW AT THE STAGE</p>
        {current ? <><span className="queue-number">#{current.position}</span><h3>{current.student.announcement_text || current.student.display_name}</h3>{current.student.native_name && <p className="native" dir="auto">{current.student.native_name}</p>}<p className="program">{current.student.program}</p><div className="phonetic"><small>PRONUNCIATION GUIDE</small><strong>{current.student.phonetic_spelling || 'No phonetic guide provided'}</strong></div><div className="stage-buttons"><button className="announce" disabled={!current.student.active_audio} onClick={() => action(current, 'announce')}>▶ Announce name</button><button onClick={() => action(current, 'skip')}>Skip</button><button onClick={() => undoCheckIn(current)}>Undo check-in</button></div>{!current.student.active_audio && <p className="audio-warning">Approved audio is missing. Use the pronunciation guide.</p>}</> : <div className="stage-empty"><span>✓</span><h3>Waiting for the next graduate</h3><p>Scan a student ID or choose someone from the roster.</p></div>}
      </section>
      <section className="panel queue-panel"><div className="panel-heading"><div><p className="eyebrow">UP NEXT</p><h3>Announcement queue</h3><small>Drag waiting students or use the arrow buttons.</small></div><span>{activeQueue.length} waiting</span></div><div className="queue-list">{activeQueue.slice(1).map((entry, index) => <div className={`queue-row draggable${draggedEntryId === entry.id ? ' dragging' : ''}`} draggable key={entry.id} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(entry.id)); setDraggedEntryId(entry.id) }} onDragEnd={() => setDraggedEntryId(null)} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }} onDrop={(event) => { event.preventDefault(); const sourceId = Number(event.dataTransfer.getData('text/plain')) || draggedEntryId; if (sourceId) void reorderQueue(sourceId, entry.id) }}><span className="drag-handle" title="Drag to reorder">⠿</span><span>{index + 1}</span><div><strong>{entry.student.display_name}</strong><small>{entry.student.program}</small></div><span className={entry.student.active_audio ? 'ready-dot' : 'warning-dot'} /><span className="queue-move-buttons"><button className="text-button" disabled={index === 0} onClick={() => moveQueueEntry(entry.id, -1)} aria-label={`Move ${entry.student.display_name} earlier`}>↑</button><button className="text-button" disabled={index === activeQueue.length - 2} onClick={() => moveQueueEntry(entry.id, 1)} aria-label={`Move ${entry.student.display_name} later`}>↓</button></span><button className="text-button" onClick={() => undoCheckIn(entry)}>Undo</button></div>)}{activeQueue.length <= 1 && <p className="empty">Checked-in students will appear here.</p>}</div><div className="all-status"><strong>Processional progress</strong><div className="progress"><span style={{ width: `${ceremony?.entries.length ? ((ceremony.entries.filter(e => e.status === 'announced').length / ceremony.entries.length) * 100) : 0}%` }} /></div><small>{ceremony?.entries.filter(e => e.status === 'announced').length ?? 0} of {ceremony?.entries.length ?? 0} announced</small></div></section>
    </div>
    <section className="panel stage-roster-panel">
      <div className="panel-heading"><div><p className="eyebrow">MANUAL FALLBACK</p><h3>Check in from ceremony roster</h3></div><label className="roster-search"><span>Search roster</span><input value={rosterSearch} onChange={(event) => setRosterSearch(event.target.value)} placeholder="Name, student ID, or program" /></label></div>
      <div className="stage-roster-list">
        {visibleRoster.map((entry) => <div className="stage-roster-row" key={entry.id}><span className="roster-position">{entry.position}</span><div><strong>{entry.student.display_name}</strong><small>ID {entry.student.student_id} · {entry.student.program}</small></div><span className={`roster-status ${entry.status}`}>{entry.status.replace('_', ' ')}</span>{['checked_in', 'queued', 'announced'].includes(entry.status) ? <button className="secondary" onClick={() => undoCheckIn(entry)}>{entry.status === 'announced' ? 'Undo announcement' : 'Undo check-in'}</button> : <button className="secondary" disabled={!['expected', 'skipped'].includes(entry.status)} onClick={() => manualCheckIn(entry)}>{entry.status === 'skipped' ? 'Check in again' : 'Check in'}</button>}</div>)}
        {!visibleRoster.length && <p className="empty">No roster entries match your search.</p>}
      </div>
    </section>
  </>
}

export default App
