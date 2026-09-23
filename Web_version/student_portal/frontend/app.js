const app = document.querySelector('#app')
const savedTokenKey = 'gradvoice.portal.studentToken'
const savedStaffTokenKey = 'gradvoice.portal.staffToken'
let token = sessionStorage.getItem(savedTokenKey) || ''
let staffToken = sessionStorage.getItem(savedStaffTokenKey) || ''

const languageName = (code) => {
  const labels = {
    'cmn-CN': 'Mandarin (China)', 'cmn-TW': 'Mandarin (Taiwan)', 'yue-HK': 'Cantonese (Hong Kong)',
    'en-US': 'English (United States)', 'es-US': 'Spanish (United States)', 'es-MX': 'Spanish (Mexico)',
    'vi-VN': 'Vietnamese (Vietnam)', 'ar-XA': 'Arabic', 'fr-FR': 'French (France)', 'pt-BR': 'Portuguese (Brazil)',
  }
  if (labels[code]) return labels[code]
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code } catch { return code }
}

const languageFamily = (code) => code === 'cmn-CN' || code === 'cmn-TW' || code === 'yue-HK' ? 'Chinese' : languageName(code).split(' (')[0]
const languageLabel = (code) => languageFamily(code) === 'Chinese' ? `Chinese — ${languageName(code)}` : languageName(code)

const request = (path, options = {}) => fetch(path, {
  ...options,
  headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
}).then(async response => {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.detail || response.statusText)
  return body
})

const go = (path) => { history.pushState({}, '', path); render() }

const staffRequest = (path, options = {}) => fetch(path, {
  ...options,
  headers: { ...(options.headers || {}), 'X-Portal-Staff-Token': staffToken },
}).then(async response => {
  if (options.download) return response
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.detail || response.statusText)
  return body
})

const renderStaffLogin = () => {
  app.innerHTML = `<main class="auth-page"><p class="eyebrow">GRADVOICE · STAFF PORTAL</p><h1>Manage student pronunciation records.</h1><p class="intro">Import rosters, review submissions, and export approved updates for the local ceremony app.</p><section class="panel auth-panel"><label>Admin username<input id="staff-username" autocomplete="username"></label><label>Admin password<input id="staff-password" type="password" autocomplete="current-password"></label><button id="staff-login">Sign in</button><p id="staff-message" role="status"></p></section></main>`
  const message = document.querySelector('#staff-message')
  document.querySelector('#staff-login').addEventListener('click', async () => {
    try {
      const result = await fetch('/api/staff/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: document.querySelector('#staff-username').value.trim(), password: document.querySelector('#staff-password').value }) }).then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.detail || response.statusText); return body })
      staffToken = result.token; sessionStorage.setItem(savedStaffTokenKey, staffToken); go('/staff')
    } catch (error) { message.textContent = error.message }
  })
}

const renderStaff = async () => {
  app.innerHTML = `<main><div class="review-header"><div><p class="eyebrow">GRADVOICE · STAFF PORTAL</p><h1>Portal administration.</h1><p class="intro">Move roster updates between the student portal and the offline ceremony app.</p></div><button id="staff-logout" class="quiet-button">Log out</button></div><section class="panel staff-panel"><h2>Student recording uploads</h2><p>Control whether students may submit reference recordings.</p><label class="toggle-row"><input id="recording-toggle" type="checkbox"><span>Allow student recording uploads</span></label><p id="setting-message" role="status"></p></section><section class="panel staff-panel"><h2>Import local roster</h2><p>Upload the ZIP exported by the local ceremony app. This refreshes student records and creates invitation tokens.</p><input id="roster-file" type="file" accept=".zip"><button id="import-roster">Import roster</button><p id="import-message" role="status"></p><pre id="invite-output" class="invite-output"></pre></section><section class="panel staff-panel"><div class="section-heading"><div><h2>Student progress</h2><p>Review profile fields, uploaded recordings, generated candidates, and the selected audio for every student.</p></div><button id="refresh-submissions" class="quiet-button">Refresh</button></div><label class="ceremony-picker">Ceremony<select id="ceremony-select"><option>Loading ceremonies...</option></select></label><div id="submissions"><p>Loading student progress...</p></div></section><section class="panel staff-panel"><h2>Export for local ceremony app</h2><p>The export includes edited profiles and each student&apos;s currently approved audio.</p><button id="export-package">Download approved package</button><p id="export-message" role="status"></p></section><section class="panel staff-panel"><h2>Change admin password</h2><p>Use at least eight characters. The new password is stored as a hash in the portal database.</p><div class="form-grid"><label>Current password<input id="current-password" type="password" autocomplete="current-password"></label><label>New password<input id="new-password" type="password" autocomplete="new-password"></label></div><button id="change-password">Change password</button><p id="password-message" role="status"></p></section></main>`
  try { const settings = await staffRequest('/api/staff/settings'); document.querySelector('#recording-toggle').checked = settings.student_recording_enabled; await loadCeremonies(); await loadStaffSubmissions() } catch (error) { sessionStorage.removeItem(savedStaffTokenKey); staffToken = ''; go('/staff/login'); return }
  document.querySelector('#staff-logout').addEventListener('click', async () => { await staffRequest('/api/staff/logout', { method: 'POST' }).catch(() => {}); sessionStorage.removeItem(savedStaffTokenKey); staffToken = ''; go('/staff/login') })
  document.querySelector('#import-roster').addEventListener('click', async () => { const file = document.querySelector('#roster-file').files[0]; const message = document.querySelector('#import-message'); if (!file) { message.textContent = 'Choose a roster ZIP first.'; return } try { const body = new FormData(); body.append('file', file); const result = await staffRequest('/api/staff/rosters/import', { method: 'POST', body }); message.textContent = `Imported ${result.imported} student records.`; document.querySelector('#invite-output').textContent = result.invites.map(invite => `${invite.student_id}: ${invite.token}`).join('\n'); await loadCeremonies(); await loadStaffSubmissions() } catch (error) { message.textContent = error.message } })
  document.querySelector('#refresh-submissions').addEventListener('click', loadStaffSubmissions)
  document.querySelector('#ceremony-select').addEventListener('change', loadStaffSubmissions)
  document.querySelector('#recording-toggle').addEventListener('change', async () => { const message = document.querySelector('#setting-message'); try { const result = await staffRequest(`/api/staff/settings?student_recording_enabled=${document.querySelector('#recording-toggle').checked}`, { method: 'PATCH' }); message.textContent = result.student_recording_enabled ? 'Student recording uploads enabled.' : 'Student recording uploads disabled.' } catch (error) { document.querySelector('#recording-toggle').checked = !document.querySelector('#recording-toggle').checked; message.textContent = error.message } })
  document.querySelector('#export-package').addEventListener('click', async () => { const message = document.querySelector('#export-message'); try { const ceremonyId = document.querySelector('#ceremony-select').value; const response = await staffRequest(`/api/staff/portal-package/export?ceremony_id=${encodeURIComponent(ceremonyId)}`, { download: true }); if (!response.ok) throw new Error((await response.json()).detail || response.statusText); const blob = await response.blob(); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'gradvoice-portal-approved.zip'; link.click(); URL.revokeObjectURL(link.href); message.textContent = 'Approved package downloaded.' } catch (error) { message.textContent = error.message } })
  document.querySelector('#change-password').addEventListener('click', async () => { const message = document.querySelector('#password-message'); try { await staffRequest('/api/staff/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current_password: document.querySelector('#current-password').value, new_password: document.querySelector('#new-password').value }) }); message.textContent = 'Password changed.'; document.querySelector('#current-password').value = ''; document.querySelector('#new-password').value = '' } catch (error) { message.textContent = error.message } })
}

const loadStaffSubmissions = async () => {
  const container = document.querySelector('#submissions'); if (!container) return
  try { const ceremonyId = document.querySelector('#ceremony-select').value; const students = await staffRequest(`/api/staff/students/progress?ceremony_id=${encodeURIComponent(ceremonyId)}`); container.innerHTML = students.length ? students.map(student => `<article class="student-progress"><div class="student-progress-header"><div><h3>${student.display_name}</h3><span>${student.student_id}</span></div><span class="progress-badge">${student.candidates.length} generated · ${student.submissions.length} uploads</span></div><div class="progress-grid"><div><strong>Profile</strong><ul class="progress-list"><li>Name: ${student.profile.display_name || 'Missing'}</li><li>Native name: ${student.profile.native_name || 'Missing'}</li><li>Language: ${student.profile.language || 'Missing'}</li><li>Phonetic: ${student.profile.phonetic_spelling || 'Missing'}</li><li>Program: ${student.profile.program || 'Missing'}</li><li>Announcement: ${student.profile.announcement_text || 'Missing'}</li></ul><button type="button" class="quiet-button token-button" data-token-student="${student.student_id}">Show login token</button><p class="student-token" data-token-output="${student.student_id}" role="status"></p></div><div><strong>Student-generated audio</strong><div class="admin-audio-list">${student.candidates.map(candidate => `<div><span>${candidate.approved ? 'Selected' : 'Candidate'} · ${candidate.source} · ${candidate.language_code || ''}</span><audio controls preload="none" src="${candidate.url}"></audio></div>`).join('') || '<p>No student-generated audio.</p>'}${student.submissions.map(item => `<div><span>Upload · ${item.status}${item.original_filename ? ` · ${item.original_filename}` : ''}</span>${item.url ? `<audio controls preload="none" src="${item.url}"></audio>` : ''}</div>`).join('')}</div></div></div></article>`).join('') : '<p>No students in this ceremony.</p>'; container.querySelectorAll('[data-token-student]').forEach(button => button.addEventListener('click', async () => { const studentId = button.dataset.tokenStudent; const output = container.querySelector(`[data-token-output="${studentId}"]`); button.disabled = true; try { const result = await staffRequest(`/api/staff/students/${encodeURIComponent(studentId)}/invitation-token`, { method: 'POST' }); output.textContent = `Login token: ${result.token}` } catch (error) { output.textContent = error.message } finally { button.disabled = false } })) } catch (error) { container.textContent = error.message }
}

const loadCeremonies = async () => {
  const ceremonySelect = document.querySelector('#ceremony-select')
  if (!ceremonySelect) return
  const ceremonies = await staffRequest('/api/staff/ceremonies')
  ceremonySelect.innerHTML = ceremonies.length ? ceremonies.map(ceremony => `<option value="${ceremony.id}">${ceremony.name}${ceremony.event_date ? ` · ${ceremony.event_date}` : ''} · ${ceremony.student_count} students</option>`).join('') : '<option value="">No ceremonies imported</option>'
}

const renderLogin = () => {
  app.innerHTML = `<main class="auth-page"><p class="eyebrow">GRADVOICE · STUDENT PORTAL</p><h1>Review your pronunciation.</h1><p class="intro">Use the invitation token provided by the graduation office.</p><section class="panel auth-panel"><label>Invitation token<input id="token" type="password" autocomplete="off"></label><button id="login">Open my profile</button><p id="message" role="status"></p></section></main>`
  const message = document.querySelector('#message')
  if (token) request('/api/student/me').then(() => go('/review')).catch(() => { sessionStorage.removeItem(savedTokenKey); token = '' })
  document.querySelector('#login').addEventListener('click', async () => {
    const enteredToken = document.querySelector('#token').value.trim()
    if (!enteredToken) { message.textContent = 'Enter your invitation token.'; return }
    token = enteredToken
    try {
      await request('/api/student/login', { method: 'POST' })
      sessionStorage.setItem(savedTokenKey, token)
      go('/review')
    } catch (error) { message.textContent = error.message }
  })
}

const renderReview = async () => {
  app.innerHTML = `<main><div class="review-header"><div><p class="eyebrow">PRONUNCIATION RECORD</p><h1>Review your record.</h1><p class="intro">Edit your details, compare pronunciations, and select the version for your ceremony.</p></div><button id="logout" class="quiet-button">Log out</button></div><section id="profile" class="panel"><p>Loading your record...</p></section></main>`
  try {
    const data = await request('/api/student/me')
    renderProfile(data)
  } catch (error) {
    sessionStorage.removeItem(savedTokenKey); token = ''; go('/login'); return
  }
  document.querySelector('#logout').addEventListener('click', () => { sessionStorage.removeItem(savedTokenKey); token = ''; go('/login') })
}

const renderProfile = (data) => {
  const profile = document.querySelector('#profile')
  const recordingSection = data.recording_enabled ? `<hr><h3>Student recording</h3><label>Upload a recording<input id="audio" type="file" accept="audio/*"></label><button id="submit">Submit recording for review</button>` : ''
  profile.innerHTML = `<div class="record-heading"><div><p class="eyebrow">YOUR RECORD</p><h2>${data.display_name}</h2><p class="section-intro">Check the college-provided details, then update the optional pronunciation guidance below.</p></div><span class="autosave-badge">Autosaves changes</span></div><section class="record-section"><div class="section-heading"><div><h3>Student details</h3><p>These details are provided by the college. Only the optional name guidance can be edited.</p></div></div><div class="form-grid"><label>Display name<span class="read-only-value">${data.display_name || 'Not provided'}</span></label><label>Program<span class="read-only-value">${data.program || 'Not provided'}</span></label><label>Native name<input id="native-name" value="${data.native_name || ''}" placeholder="Optional"></label><label>Phonetic spelling<input id="phonetic" value="${data.phonetic_spelling || ''}" placeholder="Optional"></label><label class="wide">Announcement text<span class="read-only-value">${data.announcement_text || 'Not provided'}</span></label></div><p id="profile-message" role="status"></p></section><section class="record-section pronunciation-section"><div class="section-heading"><div><h3>Pronunciation</h3><p>Choose a language and voice, review the text, then generate audio.</p></div><span class="standard-setting">Standard rate · 1.0</span></div><div class="speech-settings"><label>Pronunciation language<select id="speech-language"><option>Loading languages...</option></select></label><label>Voice<select id="speech-voice"><option>Select a language first</option></select></label><label class="wide">Text to pronounce<textarea id="speech-text" rows="2">${data.announcement_text || data.display_name || ''}</textarea></label><div class="wide presets"><button type="button" id="use-ceremony">Display name</button><button type="button" id="use-native">Native name</button><button type="button" id="use-phonetic">Phonetic spelling</button></div></div><button id="generate">Generate pronunciation audio</button><p id="speech-message" role="status"></p></section><section class="record-section candidate-section"><div id="candidates"></div></section>${recordingSection}<section class="record-section submission-section"><h3>Submission history</h3><ul>${data.submissions.map(item => `<li>${item.kind}: ${item.status}${item.note ? ` — ${item.note}` : ''}</li>`).join('') || '<li>No submissions yet.</li>'}</ul></section>`
  const profileMessage = document.querySelector('#profile-message')
  let saveTimer
  const saveProfile = async () => {
    try { await request('/api/student/me/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ native_name: document.querySelector('#native-name').value.trim() || null, phonetic_spelling: document.querySelector('#phonetic').value.trim() || null }) }); profileMessage.textContent = 'Record saved.' } catch (error) { profileMessage.textContent = error.message }
  }
  const scheduleSave = () => { clearTimeout(saveTimer); profileMessage.textContent = 'Saving…'; saveTimer = setTimeout(saveProfile, 450) }
  ;['native-name', 'phonetic'].forEach(id => document.querySelector(`#${id}`).addEventListener('input', scheduleSave))
  if (data.recording_enabled) document.querySelector('#submit').addEventListener('click', async () => { const file = document.querySelector('#audio').files[0]; if (!file) return; try { const body = new FormData(); body.append('file', file); await request('/api/student/me/submissions', { method: 'POST', body }); document.querySelector('#speech-message').textContent = 'Recording submitted for staff review.' } catch (error) { document.querySelector('#speech-message').textContent = error.message } })
  const languageSelect = document.querySelector('#speech-language'); const voiceSelect = document.querySelector('#speech-voice'); let textSource = 'Display name'
  const loadVoices = async (languageCode) => { voiceSelect.innerHTML = '<option>Loading voices...</option>'; try { const voices = await request(`/api/student/speech/voices?language_code=${encodeURIComponent(languageCode)}`); voiceSelect.innerHTML = `<option value="__auto__">Automatic</option>${voices.map(voice => `<option value="${voice.name}">${voice.name} · ${voice.gender}</option>`).join('')}` } catch (error) { voiceSelect.innerHTML = '<option value="">Unavailable</option>'; document.querySelector('#speech-message').textContent = error.message } }
  request('/api/student/speech/languages').then(languages => { const sorted = languages.slice().sort((left, right) => languageFamily(left).localeCompare(languageFamily(right), 'en') || languageLabel(left).localeCompare(languageLabel(right), 'en') || left.localeCompare(right)); languageSelect.innerHTML = sorted.map(code => `<option value="${code}">${languageLabel(code)} · ${code}</option>`).join(''); const defaultLanguage = languages.find(code => code === 'en-US') || languages[0]; languageSelect.value = defaultLanguage; return loadVoices(defaultLanguage) }).catch(error => { languageSelect.innerHTML = '<option value="">Unavailable</option>'; document.querySelector('#speech-message').textContent = error.message })
  languageSelect.addEventListener('change', () => loadVoices(languageSelect.value)); document.querySelector('#use-ceremony').addEventListener('click', () => { textSource = 'Display name / ceremony announcement'; document.querySelector('#speech-text').value = document.querySelector('#announcement').value || document.querySelector('#display-name').value }); document.querySelector('#use-native').addEventListener('click', () => { textSource = 'Native-language name'; document.querySelector('#speech-text').value = document.querySelector('#native-name').value }); document.querySelector('#use-phonetic').addEventListener('click', () => { textSource = 'Phonetic guide'; document.querySelector('#speech-text').value = document.querySelector('#phonetic').value })
  document.querySelector('#generate').addEventListener('click', async () => { const speechMessage = document.querySelector('#speech-message'); try { const candidate = await request('/api/student/me/candidates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: document.querySelector('#speech-text').value, text_source: textSource, language_code: languageSelect.value, voice_name: voiceSelect.value, speaking_rate: 1.0 }) }); data.candidates = [candidate, ...(data.candidates || [])]; renderCandidates(data.candidates); speechMessage.textContent = 'Pronunciation audio generated. Listen before selecting it.' } catch (error) { speechMessage.textContent = error.message } })
  renderCandidates(data.candidates || [])
}

const renderCandidates = (candidates) => { const container = document.querySelector('#candidates'); if (!container) return; container.innerHTML = `<div class="candidate-heading"><div><h3>Saved pronunciation candidates</h3><p>Listen to each version, then choose exactly one for your ceremony record. Unselected candidates can be deleted.</p></div><span class="selection-rule">One selection required</span></div>${candidates.length ? candidates.map(candidate => `<article class="candidate ${candidate.approved ? 'selected' : ''}"><div class="candidate-topline"><strong>${candidate.source} · ${candidate.language_code || ''}</strong><span class="candidate-status">${candidate.approved ? 'Selected for use' : 'Not selected'}</span></div><audio controls preload="none" src="${candidate.url}"></audio><div class="candidate-actions"><button type="button" data-candidate="${candidate.id}" ${candidate.approved ? 'disabled' : ''}>${candidate.approved ? 'Currently selected' : 'Use this pronunciation'}</button><button type="button" class="delete-candidate" data-delete-candidate="${candidate.id}" ${candidate.approved ? 'disabled' : ''}>Delete</button></div></article>`).join('') : '<p class="empty-candidates">No generated candidates yet. Generate one above, listen to it, and select it for use.</p>'}`; container.querySelectorAll('[data-candidate]').forEach(button => button.addEventListener('click', async () => { try { await request(`/api/student/me/candidates/${button.dataset.candidate}/approve`, { method: 'POST' }); const refreshed = await request('/api/student/me'); renderCandidates(refreshed.candidates || []) } catch (error) { alert(error.message) } })); container.querySelectorAll('[data-delete-candidate]').forEach(button => button.addEventListener('click', async () => { const candidate = candidates.find(item => String(item.id) === button.dataset.deleteCandidate); if (!candidate || !window.confirm('Delete this generated pronunciation permanently?')) return; try { await request(`/api/student/me/candidates/${candidate.id}`, { method: 'DELETE' }); renderCandidates(candidates.filter(item => item.id !== candidate.id)) } catch (error) { alert(error.message) } })) }

const render = () => {
  if (window.location.pathname === '/staff' && !staffToken) { history.replaceState({}, '', '/staff/login'); return renderStaffLogin() }
  if (window.location.pathname === '/staff' || window.location.pathname === '/staff/login' && staffToken) return renderStaff()
  if (window.location.pathname === '/staff/login') return renderStaffLogin()
  if (window.location.pathname === '/review' && !token) { history.replaceState({}, '', '/login'); return renderLogin() }
  return window.location.pathname === '/review' ? renderReview() : renderLogin()
}
window.addEventListener('popstate', render)
render()

/*
const languageName = (code) => {
  const labels = {
    'cmn-CN': 'Mandarin (China)',
    'cmn-TW': 'Mandarin (Taiwan)',
    'yue-HK': 'Cantonese (Hong Kong)',
    'en-US': 'English (United States)',
    'es-US': 'Spanish (United States)',
    'es-MX': 'Spanish (Mexico)',
    'vi-VN': 'Vietnamese (Vietnam)',
    'ar-XA': 'Arabic',
    'fr-FR': 'French (France)',
    'pt-BR': 'Portuguese (Brazil)',
  }
  if (labels[code]) return labels[code]
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code } catch { return code }
}

const languageFamily = (code) => {
  if (code === 'cmn-CN' || code === 'cmn-TW' || code === 'yue-HK') return 'Chinese'
  return languageName(code).split(' (')[0]
}

const languageLabel = (code) => {
  const name = languageName(code)
  return languageFamily(code) === 'Chinese' ? `Chinese — ${name}` : name
}

const request = (path, options = {}) => fetch(path, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` } }).then(async response => {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.detail || response.statusText)
  return body
})

document.querySelector('#login').addEventListener('click', async () => {
  token = tokenInput.value.trim()
  if (!token) return
  try {
    const data = await request('/api/student/me')
    profile.classList.remove('hidden')
    renderProfile(data)
  } catch (error) { message.textContent = error.message }
})

const renderProfile = (data) => {
  profile.innerHTML = `<p class="eyebrow">PRONUNCIATION RECORD</p><h2>Review ${data.display_name}</h2>
    <div class="form-grid">
      <label>Display name<input id="display-name" value="${data.display_name || ''}"></label>
      <label>Native name<input id="native-name" value="${data.native_name || ''}"></label>
      <label>Language or regional variety<input id="language" value="${data.language || ''}" placeholder="For example: Vietnamese"></label>
      <label>Phonetic spelling<input id="phonetic" value="${data.phonetic_spelling || ''}"></label>
      <label>Program<input id="program" value="${data.program || ''}"></label>
      <label class="wide">Announcement text<textarea id="announcement" rows="2">${data.announcement_text || ''}</textarea></label>
    </div>
    <button id="save-profile">Save record</button><p id="profile-message" role="status"></p>
    <hr><h3>Google pronunciation studio</h3>
    <p>Generate candidates from your saved name details. Google credentials stay on the portal server.</p>
    <div class="form-grid">
      <label>Pronunciation language<select id="speech-language"><option>Loading languages...</option></select></label>
      <label>Voice<select id="speech-voice"><option>Select a language first</option></select></label>
      <label class="wide">Text to pronounce<textarea id="speech-text" rows="2">${data.announcement_text || data.display_name || ''}</textarea></label>
      <div class="wide presets"><button type="button" id="use-ceremony">Ceremony name</button><button type="button" id="use-native">Native-script name</button><button type="button" id="use-phonetic">Phonetic spelling</button></div>
      <label>Speaking rate<input id="speech-rate" type="number" min="0.25" max="2" step="0.05" value="1"></label>
    </div>
    <button id="generate">Generate new candidate</button><p id="speech-message" role="status"></p>
    <div id="candidates"></div>
    <hr><h3>Student recording</h3><label>Upload a recording<input id="audio" type="file" accept="audio/*"></label><button id="submit">Submit recording for review</button>
    <h3>Submission history</h3><ul>${data.submissions.map(item => `<li>${item.kind}: ${item.status}${item.note ? ` — ${item.note}` : ''}</li>`).join('') || '<li>No submissions yet.</li>'}</ul>`

  const profileMessage = document.querySelector('#profile-message')
  document.querySelector('#save-profile').addEventListener('click', async () => {
    try {
      await request('/api/student/me/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        display_name: document.querySelector('#display-name').value.trim(), native_name: document.querySelector('#native-name').value.trim() || null,
        language: document.querySelector('#language').value.trim() || null, phonetic_spelling: document.querySelector('#phonetic').value.trim() || null,
        program: document.querySelector('#program').value.trim(), announcement_text: document.querySelector('#announcement').value.trim(),
      }) })
      profileMessage.textContent = 'Record saved.'
    } catch (error) { profileMessage.textContent = error.message }
  })

  document.querySelector('#submit').addEventListener('click', async () => {
    const file = document.querySelector('#audio').files[0]
    if (!file) return
    try {
      const body = new FormData(); body.append('file', file)
      await request('/api/student/me/submissions', { method: 'POST', body })
      message.textContent = 'Recording submitted for staff review.'
    } catch (error) { message.textContent = error.message }
  })

  const languageSelect = document.querySelector('#speech-language')
  const voiceSelect = document.querySelector('#speech-voice')
  const loadVoices = async (languageCode) => {
    voiceSelect.innerHTML = '<option>Loading voices...</option>'
    try {
      const voices = await request(`/api/student/speech/voices?language_code=${encodeURIComponent(languageCode)}`)
      voiceSelect.innerHTML = `<option value="__auto__">Automatic</option>${voices.map(voice => `<option value="${voice.name}">${voice.name} · ${voice.gender}</option>`).join('')}`
    } catch (error) { voiceSelect.innerHTML = '<option value="">Unavailable</option>'; document.querySelector('#speech-message').textContent = error.message }
  }
  request('/api/student/speech/languages').then(languages => {
    const sortedLanguages = languages.slice().sort((left, right) => {
      const familyOrder = languageFamily(left).localeCompare(languageFamily(right), 'en')
      return familyOrder || languageLabel(left).localeCompare(languageLabel(right), 'en') || left.localeCompare(right)
    })
    languageSelect.innerHTML = sortedLanguages.map(code => `<option value="${code}">${languageLabel(code)} · ${code}</option>`).join('')
    const saved = languages.find(code => code.toLowerCase() === (data.language || '').toLowerCase()) || languages.find(code => code === 'en-US') || languages[0]
    languageSelect.value = saved
    return loadVoices(saved)
  }).catch(error => { languageSelect.innerHTML = '<option value="">Unavailable</option>'; document.querySelector('#speech-message').textContent = error.message })
  languageSelect.addEventListener('change', () => loadVoices(languageSelect.value))
  document.querySelector('#use-ceremony').addEventListener('click', () => { document.querySelector('#speech-text').value = document.querySelector('#announcement').value || document.querySelector('#display-name').value })
  document.querySelector('#use-native').addEventListener('click', () => { document.querySelector('#speech-text').value = document.querySelector('#native-name').value })
  document.querySelector('#use-phonetic').addEventListener('click', () => { document.querySelector('#speech-text').value = document.querySelector('#phonetic').value })
  document.querySelector('#generate').addEventListener('click', async () => {
    const speechMessage = document.querySelector('#speech-message')
    try {
      const candidate = await request('/api/student/me/candidates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: document.querySelector('#speech-text').value, language_code: languageSelect.value, voice_name: voiceSelect.value, speaking_rate: Number(document.querySelector('#speech-rate').value) }) })
      data.candidates = [candidate, ...(data.candidates || [])]
      renderCandidates(data.candidates)
      speechMessage.textContent = 'Candidate generated. Listen before selecting it.'
    } catch (error) { speechMessage.textContent = error.message }
  })
  renderCandidates(data.candidates || [])
}

const renderCandidates = (candidates) => {
  const container = document.querySelector('#candidates')
  if (!container) return
  container.innerHTML = `<div class="candidate-heading"><div><h3>Saved pronunciation candidates</h3><p>Listen to each version, then choose exactly one for your ceremony record. Unselected candidates can be deleted.</p></div><span class="selection-rule">One selection required</span></div>${candidates.length ? candidates.map(candidate => `<article class="candidate ${candidate.approved ? 'selected' : ''}"><div class="candidate-topline"><strong>${candidate.source} · ${candidate.language_code || ''}</strong><span class="candidate-status">${candidate.approved ? 'Selected for use' : 'Not selected'}</span></div><audio controls preload="none" src="${candidate.url}"></audio><div class="candidate-actions"><button type="button" data-candidate="${candidate.id}" ${candidate.approved ? 'disabled' : ''}>${candidate.approved ? 'Currently selected' : 'Use this pronunciation'}</button><button type="button" class="delete-candidate" data-delete-candidate="${candidate.id}" ${candidate.approved ? 'disabled' : ''}>Delete</button></div></article>`).join('') : '<p class="empty-candidates">No generated candidates yet. Generate one above, listen to it, and select it for use.</p>'}`
  container.querySelectorAll('[data-candidate]').forEach(button => button.addEventListener('click', async () => {
    try {
      await request(`/api/student/me/candidates/${button.dataset.candidate}/approve`, { method: 'POST' })
      message.textContent = 'Pronunciation selected.'
      const refreshed = await request('/api/student/me')
      renderCandidates(refreshed.candidates || [])
    } catch (error) { message.textContent = error.message }
  }))
  container.querySelectorAll('[data-delete-candidate]').forEach(button => button.addEventListener('click', async () => {
    const candidate = candidates.find(item => String(item.id) === button.dataset.deleteCandidate)
    if (!candidate || !window.confirm('Delete this generated pronunciation permanently?')) return
    try {
      await request(`/api/student/me/candidates/${candidate.id}`, { method: 'DELETE' })
      message.textContent = 'Generated pronunciation deleted.'
      renderCandidates(candidates.filter(item => item.id !== candidate.id))
    } catch (error) { message.textContent = error.message }
  }))
}
*/
