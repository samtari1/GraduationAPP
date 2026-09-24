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
  document.querySelector('.review-header')?.insertAdjacentHTML('afterend', '<section class="panel staff-panel ceremony-overview"><div class="section-heading"><div><p class="eyebrow">CEREMONY OVERVIEW</p><h2>Progress at a glance</h2><p>Live counts for the selected ceremony.</p></div><span id="stats-updated" class="stats-updated"></span></div><div id="ceremony-stats" class="stats-grid"><p>Loading ceremony statistics...</p></div></section>')
  const overview = document.querySelector('.ceremony-overview')
  const importPanel = document.querySelector('#roster-file')?.closest('.staff-panel')
  const exportPanel = document.querySelector('#export-package')?.closest('.staff-panel')
  if (overview && importPanel && exportPanel) {
    const actions = document.createElement('div')
    actions.className = 'ceremony-actions'
    const importAction = document.createElement('div')
    importAction.className = 'ceremony-action'
    importAction.append(importPanel.querySelector('h2'), importPanel.querySelector('p'), document.querySelector('#roster-file'), document.querySelector('#import-roster'), document.querySelector('#import-message'), document.querySelector('#invite-output'))
    const exportAction = document.createElement('div')
    exportAction.className = 'ceremony-action'
    exportAction.append(exportPanel.querySelector('h2'), exportPanel.querySelector('p'), document.querySelector('#export-package'), document.querySelector('#export-message'))
    actions.append(importAction, exportAction)
    overview.append(actions)
    importPanel.remove(); exportPanel.remove()
  }
  const ceremonyPicker = document.querySelector('.ceremony-picker')
  if (ceremonyPicker) {
    const recordingToggle = document.querySelector('#recording-toggle')
    const recordingLabel = recordingToggle?.closest('.toggle-row')
    const recordingPanel = recordingToggle?.closest('.staff-panel')
    const recordingMessage = document.querySelector('#setting-message')
    let recordingRow
    if (recordingLabel) {
      recordingRow = document.createElement('div')
      recordingRow.className = 'toggle-row'
      recordingLabel.querySelector('span').textContent = 'Allow audio uploads'
      recordingRow.append(recordingToggle, recordingLabel.querySelector('span'))
      recordingLabel.replaceWith(recordingRow)
    }
    const uploadControl = document.createElement('div')
    uploadControl.className = 'ceremony-upload-control'
    if (recordingRow) uploadControl.append(recordingRow)
    if (recordingMessage) uploadControl.append(recordingMessage)
    ceremonyPicker.append(uploadControl)
    recordingPanel?.remove()
    const deleteButton = document.createElement('button')
    deleteButton.type = 'button'; deleteButton.className = 'danger-button'; deleteButton.textContent = 'Delete ceremony'
    ceremonyPicker.append(deleteButton)
    document.querySelector('.review-header')?.after(ceremonyPicker)
    deleteButton.addEventListener('click', async () => {
      const ceremonyId = document.querySelector('#ceremony-select').value
      const ceremonyName = document.querySelector('#ceremony-select').selectedOptions[0]?.textContent || 'this ceremony'
      if (!ceremonyId || !window.confirm(`Delete ${ceremonyName}? Student records will be kept, but this ceremony and its roster membership will be removed.`)) return
      try {
        await staffRequest(`/api/staff/ceremonies/${encodeURIComponent(ceremonyId)}`, { method: 'DELETE' })
        await loadCeremonies(); await loadStaffSubmissions()
      } catch (error) { document.querySelector('#setting-message').textContent = error.message }
    })
  }
  const loadRecordingSetting = async () => {
    const ceremonyId = document.querySelector('#ceremony-select').value
    const toggle = document.querySelector('#recording-toggle')
    if (!ceremonyId) { toggle.disabled = true; toggle.checked = false; return }
    const settings = await staffRequest(`/api/staff/settings?ceremony_id=${encodeURIComponent(ceremonyId)}`)
    toggle.disabled = false; toggle.checked = settings.recording_enabled
  }
  try { await loadCeremonies(); await loadRecordingSetting(); await loadStaffSubmissions() } catch (error) { sessionStorage.removeItem(savedStaffTokenKey); staffToken = ''; go('/staff/login'); return }
  document.querySelector('#staff-logout').addEventListener('click', async () => { await staffRequest('/api/staff/logout', { method: 'POST' }).catch(() => {}); sessionStorage.removeItem(savedStaffTokenKey); staffToken = ''; go('/staff/login') })
  document.querySelector('#import-roster').addEventListener('click', async () => { const file = document.querySelector('#roster-file').files[0]; const message = document.querySelector('#import-message'); if (!file) { message.textContent = 'Choose a roster ZIP first.'; return } try { const body = new FormData(); body.append('file', file); const result = await staffRequest('/api/staff/rosters/import', { method: 'POST', body }); message.textContent = `Imported ${result.imported} student records.`; document.querySelector('#invite-output').textContent = result.invites.map(invite => `${invite.student_id}: ${invite.token}`).join('\n'); await loadCeremonies(); await loadStaffSubmissions() } catch (error) { message.textContent = error.message } })
  document.querySelector('#refresh-submissions').addEventListener('click', loadStaffSubmissions)
  document.querySelector('#ceremony-select').addEventListener('change', async () => { try { await loadRecordingSetting(); await loadStaffSubmissions() } catch (error) { document.querySelector('#setting-message').textContent = error.message } })
  document.querySelector('#recording-toggle').addEventListener('change', async () => { const message = document.querySelector('#setting-message'); try { const ceremonyId = document.querySelector('#ceremony-select').value; const result = await staffRequest(`/api/staff/settings?ceremony_id=${encodeURIComponent(ceremonyId)}&student_recording_enabled=${document.querySelector('#recording-toggle').checked}`, { method: 'PATCH' }); message.textContent = result.recording_enabled ? 'Audio uploads enabled for this ceremony.' : 'Audio uploads disabled for this ceremony.' } catch (error) { document.querySelector('#recording-toggle').checked = !document.querySelector('#recording-toggle').checked; message.textContent = error.message } })
  document.querySelector('#export-package').addEventListener('click', async () => { const message = document.querySelector('#export-message'); try { const ceremonyId = document.querySelector('#ceremony-select').value; const response = await staffRequest(`/api/staff/portal-package/export?ceremony_id=${encodeURIComponent(ceremonyId)}`, { download: true }); if (!response.ok) throw new Error((await response.json()).detail || response.statusText); const blob = await response.blob(); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'gradvoice-portal-approved.zip'; link.click(); URL.revokeObjectURL(link.href); message.textContent = 'Approved package downloaded.' } catch (error) { message.textContent = error.message } })
  document.querySelector('#change-password').addEventListener('click', async () => { const message = document.querySelector('#password-message'); try { await staffRequest('/api/staff/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current_password: document.querySelector('#current-password').value, new_password: document.querySelector('#new-password').value }) }); message.textContent = 'Password changed.'; document.querySelector('#current-password').value = ''; document.querySelector('#new-password').value = '' } catch (error) { message.textContent = error.message } })
}

const loadCeremonyStats = async () => {
  const container = document.querySelector('#ceremony-stats'); const ceremonyId = document.querySelector('#ceremony-select')?.value
  if (!container || !ceremonyId) { if (container) container.innerHTML = '<p>No ceremony selected.</p>'; return }
  try {
    const stats = await staffRequest(`/api/staff/ceremonies/${encodeURIComponent(ceremonyId)}/stats`)
    const cards = [['students', 'Students', 'Roster size'], ['logged_in', 'Logged in', 'Opened their portal'], ['profile_edited', 'Profile edits', 'Any optional detail changed'], ['native_names_added', 'Native names', 'Added or updated'], ['phonetic_guides_added', 'Phonetic guides', 'Added or updated'], ['audio_generated', 'Audio generated', 'Candidates created'], ['audio_selected', 'Audio selected', 'Chosen for ceremony'], ['recordings_submitted', 'Recordings', 'Student uploads']]
    const values = stats.stats || stats
    container.innerHTML = cards.map(([key, label, detail]) => `<div class="stat-card"><strong>${Number(values[key] ?? 0)}</strong><span>${label}</span><small>${detail}</small></div>`).join('')
    const updated = document.querySelector('#stats-updated'); if (updated) updated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
  } catch (error) { container.innerHTML = `<p class="stats-error">${error.message}</p>` }
}

const loadStaffSubmissions = async () => {
  const container = document.querySelector('#submissions'); if (!container) return
  try {
    const ceremonyId = document.querySelector('#ceremony-select').value;
    if (!ceremonyId) { await loadCeremonyStats(); container.innerHTML = '<p>Select a ceremony to review its students.</p>'; return }
    await loadCeremonyStats();
    const students = await staffRequest(`/api/staff/students/progress?ceremony_id=${encodeURIComponent(ceremonyId)}`);
    container.innerHTML = students.length ? students.map(student => `<article class="student-progress"><div class="student-progress-header"><div><h3>${student.display_name}</h3><span>${student.student_id}</span></div><span class="progress-badge">${student.candidates.length} generated · ${student.submissions.length} uploads</span></div><div class="progress-grid"><div><strong>Profile</strong><ul class="progress-list"><li>Name: ${student.profile.display_name || 'Missing'}</li><li>Native name: ${student.profile.native_name || 'Missing'}</li><li>Language: ${student.profile.language || 'Missing'}</li><li>Phonetic: ${student.profile.phonetic_spelling || 'Missing'}</li><li>Program: ${student.profile.program || 'Missing'}</li><li>Announcement: ${student.profile.announcement_text || 'Missing'}</li></ul><button type="button" class="quiet-button token-button" data-token-student="${student.student_id}">Show login token</button><p class="student-token" data-token-output="${student.student_id}" role="status"></p></div><div><strong>Student-generated audio</strong><div class="admin-audio-list">${student.candidates.map(candidate => `<div><span>${candidate.approved ? 'Selected' : 'Candidate'} · ${candidate.source} · ${candidate.language_code || ''}</span><audio controls preload="none" src="${candidate.url}"></audio></div>`).join('') || '<p>No student-generated audio.</p>'}${student.submissions.map(item => `<div><span>Upload · ${item.status}${item.original_filename ? ` · ${item.original_filename}` : ''}</span>${item.url ? `<audio controls preload="none" src="${item.url}"></audio>` : ''}</div>`).join('')}</div></div></div></article>`).join('') : '<p>No students in this ceremony.</p>'; container.querySelectorAll('[data-token-student]').forEach(button => button.addEventListener('click', async () => { const studentId = button.dataset.tokenStudent; const output = container.querySelector(`[data-token-output="${studentId}"]`); button.disabled = true; try { const result = await staffRequest(`/api/staff/students/${encodeURIComponent(studentId)}/invitation-token`, { method: 'POST' }); output.textContent = `Login token: ${result.token}` } catch (error) { output.textContent = error.message } finally { button.disabled = false } })) } catch (error) { container.textContent = error.message }
}

const loadCeremonies = async () => {
  const ceremonySelect = document.querySelector('#ceremony-select')
  if (!ceremonySelect) return
  const ceremonies = await staffRequest('/api/staff/ceremonies')
  ceremonySelect.innerHTML = ceremonies.length ? ceremonies.map(ceremony => `<option value="${ceremony.id}">${ceremony.name}${ceremony.event_date ? ` · ${ceremony.event_date}` : ''} · ${ceremony.student_count} students</option>`).join('') : '<option value="">No ceremonies imported</option>'
}

const renderLogin = () => {
  app.innerHTML = `<main class="auth-page"><p class="eyebrow">GRADVOICE · STUDENT PORTAL</p><h1>Review your pronunciation.</h1><p class="intro">Sign in with your invitation token, or use your name and student ID.</p><section class="panel auth-panel"><label>Invitation token<input id="token" type="password" autocomplete="off"></label><p class="login-divider">Or sign in with your student details</p><label>Student name<input id="student-name" autocomplete="name"></label><label>Student ID<input id="student-id" autocomplete="username"></label><button id="login">Open my profile</button><p id="message" role="status"></p></section></main>`
  const message = document.querySelector('#message')
  if (token) request('/api/student/me').then(() => go('/review')).catch(() => { sessionStorage.removeItem(savedTokenKey); token = '' })
  document.querySelector('#login').addEventListener('click', async () => {
    const enteredToken = document.querySelector('#token').value.trim()
    const studentName = document.querySelector('#student-name').value.trim()
    const studentId = document.querySelector('#student-id').value.trim()
    if (!enteredToken && (!studentName || !studentId)) { message.textContent = 'Enter an invitation token or both your student name and ID.'; return }
    try {
      if (enteredToken) {
        token = enteredToken
        await request('/api/student/login', { method: 'POST' })
      } else {
        const response = await fetch('/api/student/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ display_name: studentName, student_id: studentId }) })
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(result.detail || response.statusText)
        token = result.token
      }
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
  const detailsGrid = profile.querySelector('.record-section .form-grid')
  if (detailsGrid) {
    const [displayName, program, nativeName, phonetic, announcement] = Array.from(detailsGrid.children)
    const studentId = document.createElement('label')
    studentId.innerHTML = `Student ID<span class="read-only-value">${data.student_id || 'Not provided'}</span>`
    displayName.classList.add('wide')
    nativeName.classList.add('wide')
    phonetic.classList.add('wide')
    announcement.remove()
    detailsGrid.replaceChildren(studentId, program, displayName, nativeName, phonetic)
  }
  const sourceOptions = profile.querySelector('.presets')
  if (sourceOptions) {
    sourceOptions.className = 'wide source-options'
    const sources = [
      ['use-ceremony', 'Display name', data.display_name],
      ['use-native', 'Native-language name', data.native_name],
      ['use-phonetic', 'Phonetic name', data.phonetic_spelling],
    ]
    sourceOptions.replaceChildren(...sources.map(([id, labelText, value], index) => {
      const label = document.createElement('label')
      label.className = index === 0 ? 'selected' : value ? '' : 'disabled'
      const input = document.createElement('input')
      input.type = 'radio'; input.name = 'portal-text-source'; input.id = id; input.checked = index === 0; input.disabled = index > 0 && !value
      const content = document.createElement('span')
      const strong = document.createElement('strong'); strong.textContent = labelText
      const small = document.createElement('small'); small.textContent = value || 'Not provided'
      content.append(strong, small); label.append(input, content)
      return label
    }))
    sourceOptions.querySelectorAll('input').forEach(input => input.addEventListener('change', () => sourceOptions.querySelectorAll('label').forEach(label => label.classList.toggle('selected', label.contains(input)))))
  }
  const speechText = profile.querySelector('#speech-text')
  if (speechText) {
    const hiddenSpeechText = document.createElement('input')
    hiddenSpeechText.type = 'hidden'; hiddenSpeechText.id = 'speech-text'; hiddenSpeechText.value = speechText.value
    speechText.closest('label')?.replaceWith(hiddenSpeechText)
  }
  const profileMessage = document.querySelector('#profile-message')
  const syncSourceCards = () => {
    [['use-native', 'native-name'], ['use-phonetic', 'phonetic']].forEach(([sourceId, fieldId]) => {
      const input = document.querySelector(`#${sourceId}`)
      const field = document.querySelector(`#${fieldId}`)
      const label = input?.closest('label')
      const value = field?.value.trim() || ''
      const caption = label?.querySelector('small')
      if (input && label && caption) {
        input.disabled = !value
        label.classList.toggle('disabled', !value)
        caption.textContent = value || 'Not provided'
      }
    })
  }
  syncSourceCards()
  ;['native-name', 'phonetic'].forEach(id => document.querySelector(`#${id}`).addEventListener('input', syncSourceCards))
  let saveTimer
  const saveProfile = async () => {
    try { await request('/api/student/me/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ native_name: document.querySelector('#native-name').value.trim() || null, phonetic_spelling: document.querySelector('#phonetic').value.trim() || null }) }); profileMessage.textContent = '' } catch (error) { profileMessage.textContent = error.message }
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
