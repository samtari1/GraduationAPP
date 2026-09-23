const app = document.querySelector('#app')
const savedTokenKey = 'gradvoice.portal.studentToken'
let token = sessionStorage.getItem(savedTokenKey) || ''

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
  profile.innerHTML = `<h2>Review ${data.display_name}</h2><div class="form-grid"><label>Display name<input id="display-name" value="${data.display_name || ''}"></label><label>Native name<input id="native-name" value="${data.native_name || ''}"></label><label>Language or regional variety<input id="language" value="${data.language || ''}" placeholder="For example: Vietnamese"></label><label>Phonetic spelling<input id="phonetic" value="${data.phonetic_spelling || ''}"></label><label>Program<input id="program" value="${data.program || ''}"></label><label class="wide">Announcement text<textarea id="announcement" rows="2">${data.announcement_text || ''}</textarea></label></div><button id="save-profile">Save record</button><p id="profile-message" role="status"></p><hr><h3>Google pronunciation studio</h3><p>Generate candidates from your saved name details. Google credentials stay on the portal server.</p><div class="form-grid"><label>Pronunciation language<select id="speech-language"><option>Loading languages...</option></select></label><label>Voice<select id="speech-voice"><option>Select a language first</option></select></label><label class="wide">Text to pronounce<textarea id="speech-text" rows="2">${data.announcement_text || data.display_name || ''}</textarea></label><div class="wide presets"><button type="button" id="use-ceremony">Ceremony name</button><button type="button" id="use-native">Native-script name</button><button type="button" id="use-phonetic">Phonetic spelling</button></div><label>Speaking rate<input id="speech-rate" type="number" min="0.25" max="2" step="0.05" value="1"></label></div><button id="generate">Generate new candidate</button><p id="speech-message" role="status"></p><div id="candidates"></div><hr><h3>Student recording</h3><label>Upload a recording<input id="audio" type="file" accept="audio/*"></label><button id="submit">Submit recording for review</button><h3>Submission history</h3><ul>${data.submissions.map(item => `<li>${item.kind}: ${item.status}${item.note ? ` — ${item.note}` : ''}</li>`).join('') || '<li>No submissions yet.</li>'}</ul>`
  const profileMessage = document.querySelector('#profile-message')
  document.querySelector('#save-profile').addEventListener('click', async () => {
    try { await request('/api/student/me/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ display_name: document.querySelector('#display-name').value.trim(), native_name: document.querySelector('#native-name').value.trim() || null, language: document.querySelector('#language').value.trim() || null, phonetic_spelling: document.querySelector('#phonetic').value.trim() || null, program: document.querySelector('#program').value.trim(), announcement_text: document.querySelector('#announcement').value.trim() }) }); profileMessage.textContent = 'Record saved.' } catch (error) { profileMessage.textContent = error.message }
  })
  document.querySelector('#submit').addEventListener('click', async () => { const file = document.querySelector('#audio').files[0]; if (!file) return; try { const body = new FormData(); body.append('file', file); await request('/api/student/me/submissions', { method: 'POST', body }); document.querySelector('#speech-message').textContent = 'Recording submitted for staff review.' } catch (error) { document.querySelector('#speech-message').textContent = error.message } })
  const languageSelect = document.querySelector('#speech-language'); const voiceSelect = document.querySelector('#speech-voice')
  const loadVoices = async (languageCode) => { voiceSelect.innerHTML = '<option>Loading voices...</option>'; try { const voices = await request(`/api/student/speech/voices?language_code=${encodeURIComponent(languageCode)}`); voiceSelect.innerHTML = `<option value="__auto__">Automatic</option>${voices.map(voice => `<option value="${voice.name}">${voice.name} · ${voice.gender}</option>`).join('')}` } catch (error) { voiceSelect.innerHTML = '<option value="">Unavailable</option>'; document.querySelector('#speech-message').textContent = error.message } }
  request('/api/student/speech/languages').then(languages => { const sorted = languages.slice().sort((left, right) => languageFamily(left).localeCompare(languageFamily(right), 'en') || languageLabel(left).localeCompare(languageLabel(right), 'en') || left.localeCompare(right)); languageSelect.innerHTML = sorted.map(code => `<option value="${code}">${languageLabel(code)} · ${code}</option>`).join(''); const saved = languages.find(code => code.toLowerCase() === (data.language || '').toLowerCase()) || languages.find(code => code === 'en-US') || languages[0]; languageSelect.value = saved; return loadVoices(saved) }).catch(error => { languageSelect.innerHTML = '<option value="">Unavailable</option>'; document.querySelector('#speech-message').textContent = error.message })
  languageSelect.addEventListener('change', () => loadVoices(languageSelect.value)); document.querySelector('#use-ceremony').addEventListener('click', () => { document.querySelector('#speech-text').value = document.querySelector('#announcement').value || document.querySelector('#display-name').value }); document.querySelector('#use-native').addEventListener('click', () => { document.querySelector('#speech-text').value = document.querySelector('#native-name').value }); document.querySelector('#use-phonetic').addEventListener('click', () => { document.querySelector('#speech-text').value = document.querySelector('#phonetic').value })
  document.querySelector('#generate').addEventListener('click', async () => { const speechMessage = document.querySelector('#speech-message'); try { const candidate = await request('/api/student/me/candidates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: document.querySelector('#speech-text').value, language_code: languageSelect.value, voice_name: voiceSelect.value, speaking_rate: Number(document.querySelector('#speech-rate').value) }) }); data.candidates = [candidate, ...(data.candidates || [])]; renderCandidates(data.candidates); speechMessage.textContent = 'Candidate generated. Listen before selecting it.' } catch (error) { speechMessage.textContent = error.message } })
  renderCandidates(data.candidates || [])
}

const renderCandidates = (candidates) => { const container = document.querySelector('#candidates'); if (!container) return; container.innerHTML = `<div class="candidate-heading"><div><h3>Saved pronunciation candidates</h3><p>Listen to each version, then choose exactly one for your ceremony record. Unselected candidates can be deleted.</p></div><span class="selection-rule">One selection required</span></div>${candidates.length ? candidates.map(candidate => `<article class="candidate ${candidate.approved ? 'selected' : ''}"><div class="candidate-topline"><strong>${candidate.source} · ${candidate.language_code || ''}</strong><span class="candidate-status">${candidate.approved ? 'Selected for use' : 'Not selected'}</span></div><audio controls preload="none" src="${candidate.url}"></audio><div class="candidate-actions"><button type="button" data-candidate="${candidate.id}" ${candidate.approved ? 'disabled' : ''}>${candidate.approved ? 'Currently selected' : 'Use this pronunciation'}</button><button type="button" class="delete-candidate" data-delete-candidate="${candidate.id}" ${candidate.approved ? 'disabled' : ''}>Delete</button></div></article>`).join('') : '<p class="empty-candidates">No generated candidates yet. Generate one above, listen to it, and select it for use.</p>'}`; container.querySelectorAll('[data-candidate]').forEach(button => button.addEventListener('click', async () => { try { await request(`/api/student/me/candidates/${button.dataset.candidate}/approve`, { method: 'POST' }); const refreshed = await request('/api/student/me'); renderCandidates(refreshed.candidates || []) } catch (error) { alert(error.message) } })); container.querySelectorAll('[data-delete-candidate]').forEach(button => button.addEventListener('click', async () => { const candidate = candidates.find(item => String(item.id) === button.dataset.deleteCandidate); if (!candidate || !window.confirm('Delete this generated pronunciation permanently?')) return; try { await request(`/api/student/me/candidates/${candidate.id}`, { method: 'DELETE' }); renderCandidates(candidates.filter(item => item.id !== candidate.id)) } catch (error) { alert(error.message) } })) }

const render = () => {
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
