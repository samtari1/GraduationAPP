import { useEffect, useState } from 'react'
import { api } from './api'
import type { AudioAsset, Student } from './types'

type Voice = { name: string; language_codes: string[]; gender: string }

export const languageDisplayName = (code: string) => {
  try {
    return new Intl.DisplayNames([navigator.language], { type: 'language' }).of(code) || code
  } catch {
    return code
  }
}

const audioSourceLabel = (source: string) => {
  if (source.startsWith('portal:')) return source === 'portal:upload' ? 'Student recording' : 'Google Cloud'
  if (source === 'google-cloud') return 'Google Cloud'
  if (source === 'upload') return 'Local upload'
  return source
}

export default function PronunciationTools({ student, dirty, onChanged }: {
  student: Student; dirty: boolean; onChanged: (student: Student, message: string) => Promise<void>
}) {
  const [assets, setAssets] = useState<AudioAsset[]>([])
  const [languages, setLanguages] = useState<string[]>([])
  const [voices, setVoices] = useState<Voice[]>([])
  const [language, setLanguage] = useState('')
  const [voice, setVoice] = useState('')
  const [text, setText] = useState(student.announcement_text || student.display_name)
  const [textSource, setTextSource] = useState('Display name / ceremony announcement')
  const [rate, setRate] = useState(1)
  const [busy, setBusy] = useState(false)
  const [approvingId, setApprovingId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [selectedAudioId, setSelectedAudioId] = useState<number | null>(student.active_audio_id)
  const [message, setMessage] = useState('')
  const generationBlocker = dirty
    ? 'Save the student record before generating audio.'
    : !language
      ? 'Select a pronunciation language.'
      : !voice
        ? 'Wait for the voices to load or select a voice.'
        : !text.trim()
          ? 'Enter the name or text to pronounce.'
          : rate < .25 || rate > 2
            ? 'Speaking rate must be between 0.25 and 2.'
            : ''

  useEffect(() => {
    api.get<AudioAsset[]>(`/api/students/${student.id}/audio`).then(setAssets).catch(e => setMessage(e.message))
  }, [student.id])

  const loadVoices = async (languageCode: string) => {
    setBusy(true); setMessage('')
    try {
      const result = await api.get<Voice[]>(`/api/speech/voices?language_code=${encodeURIComponent(languageCode)}`)
      setVoices(result)
      setVoice(result.length ? '__auto__' : '')
      if (!result.length) setMessage('No usable voices were found for this language.')
    } catch (error) { setMessage((error as Error).message) }
    finally { setBusy(false) }
  }

  useEffect(() => {
    let active = true
    const prepareLanguages = async () => {
      setBusy(true); setMessage('')
      try {
        const result = await api.get<string[]>('/api/speech/languages')
        if (!active) return
        const sorted = result.slice().sort((a, b) => languageDisplayName(a).localeCompare(languageDisplayName(b)))
        setLanguages(sorted)
        const preferred = result.includes('en-US') ? 'en-US' : result[0]
        if (!preferred) {
          setMessage('Google did not return any supported languages.')
          return
        }
        setLanguage(preferred)
        const availableVoices = await api.get<Voice[]>(`/api/speech/voices?language_code=${encodeURIComponent(preferred)}`)
        if (!active) return
        setVoices(availableVoices)
        setVoice(availableVoices.length ? '__auto__' : '')
        if (!availableVoices.length) setMessage('No usable voices were found for this language.')
      } catch (error) {
        if (active) setMessage((error as Error).message)
      } finally {
        if (active) setBusy(false)
      }
    }
    void prepareLanguages()
    return () => { active = false }
  }, [student.id])

  const generate = async () => {
    setBusy(true); setMessage('')
    try {
      const asset = await api.post<AudioAsset>(`/api/students/${student.id}/speech`, {
        text, text_source: textSource, language_code: language, voice_name: voice, speaking_rate: rate,
      })
      setAssets(current => [asset, ...current])
      setMessage('Candidate saved locally. Listen before selecting it for the ceremony.')
    } catch (error) { setMessage((error as Error).message) }
    finally { setBusy(false) }
  }

  const approve = async (asset: AudioAsset) => {
    setApprovingId(asset.id); setMessage('')
    try {
      const updated = await api.post<Student>(`/api/students/${student.id}/audio/${asset.id}/approve`)
      setSelectedAudioId(updated.active_audio_id)
      setAssets(current => current.map(item => item.id === asset.id ? { ...item, approved: true } : item))
      await onChanged(updated, 'Pronunciation selected for ceremony. Student detail edits remain unsaved until you choose Save record.')
    } catch (error) { setMessage((error as Error).message) }
    finally { setApprovingId(null) }
  }

  const remove = async (asset: AudioAsset) => {
    const selected = asset.id === selectedAudioId
    const warning = selected
      ? 'This pronunciation is currently selected for the ceremony. Delete it and clear the student’s selected audio?'
      : 'Delete this saved pronunciation permanently?'
    if (!window.confirm(warning)) return
    setDeletingId(asset.id); setMessage('')
    try {
      const updated = await api.delete<Student>(`/api/students/${student.id}/audio/${asset.id}`)
      setAssets(current => current.filter(item => item.id !== asset.id))
      setSelectedAudioId(updated.active_audio_id)
      await onChanged(updated, selected ? 'Selected pronunciation deleted; this student now needs another pronunciation.' : 'Pronunciation candidate deleted.')
    } catch (error) { setMessage((error as Error).message) }
    finally { setDeletingId(null) }
  }

  return <section className="pronunciation-tools">
    <p><strong>Pronunciation</strong> · Generation sends the text below to Google Cloud and may incur charges. Saved MP3s play offline. Credentials stay on the server.</p>
    {dirty && <p className="studio-message">Save your record changes before generating or selecting audio.</p>}
    <div className="speech-settings">
      <label className="wide">Pronunciation language<select value={language} disabled={busy || !languages.length} onChange={e => { const code = e.target.value; setLanguage(code); setVoices([]); setVoice(''); void loadVoices(code) }}><option value="">{busy ? 'Loading supported languages…' : 'Select a language'}</option>{languages.map(code => <option value={code} key={code}>{languageDisplayName(code)} · {code}</option>)}</select><small>Choose the language or regional variety used for this audio candidate.</small></label>
      <label className="wide">Voice<select value={voice} onChange={e => setVoice(e.target.value)}><option value="">Load and select a voice</option>{voices.length > 0 && <option value="__auto__">Automatic · Let Google choose for {languageDisplayName(language)}</option>}{voices.map(item => <option value={item.name} key={item.name}>{item.name} · {item.gender}</option>)}</select></label>
      <label className="wide">Text to pronounce<textarea rows={2} value={text} onChange={e => setText(e.target.value)} maxLength={500} /></label>
      <div className="wide speech-presets">
        <button type="button" onClick={() => { setTextSource('Display name / ceremony announcement'); setText(student.announcement_text || student.display_name) }}>Display name</button>
        <button type="button" disabled={!student.native_name} onClick={() => { setTextSource('Native-language name'); setText(student.native_name ?? '') }}>Native name</button>
        <button type="button" disabled={!student.phonetic_spelling} onClick={() => { setTextSource('Phonetic guide'); setText(student.phonetic_spelling ?? '') }}>Phonetic spelling</button>
      </div>
      <label>Speaking rate<input type="number" min="0.25" max="2" step="0.05" value={rate} onChange={e => setRate(Number(e.target.value))} /></label>
      <div className="generate-control"><button type="button" className="primary" onClick={generate} disabled={busy || !!generationBlocker} title={generationBlocker}>{busy ? 'Working…' : 'Generate new candidate'}</button>{!busy && generationBlocker && <small>{generationBlocker}</small>}</div>
    </div>
    {message && <p className="studio-message" role="status">{message}</p>}
    <h4>Saved audio candidates</h4>
    {!assets.length && <p>No saved candidates yet.</p>}
    {assets.map(asset => <div className="audio-candidate" key={asset.id}>
      <strong>#{asset.id} · {asset.voice || asset.original_filename}</strong>
      {asset.source.startsWith('portal:') && student.portal_updated_fields.includes('audio') && <em className="portal-update-label">Updated from portal</em>}
      <small>{audioSourceLabel(asset.source)}{asset.language_code ? ` · ${languageDisplayName(asset.language_code)}` : ''}{asset.voice ? ` · ${asset.voice}` : ''}</small>
      {asset.id === selectedAudioId && <small className="selected-audio-label">{asset.source.startsWith('portal:') ? 'Selected by student for ceremony' : 'Selected for ceremony'}</small>}
      {asset.generation_input && <small>{(() => { try { const metadata = JSON.parse(asset.generation_input); return `Text: ${metadata.text_source || 'Custom text'} — “${metadata.text}”` } catch { return `Text: ${asset.generation_input}` } })()}</small>}
      {asset.generation_input && <small>{(() => { try { const metadata = JSON.parse(asset.generation_input); return `Settings: ${metadata.language_code ? languageDisplayName(metadata.language_code) : ''} · ${metadata.voice_name || asset.voice || ''} · speaking rate ${metadata.speaking_rate || 1}` } catch { return '' } })()}</small>}
      <audio controls preload="none" src={asset.url} aria-label={`Preview candidate ${asset.id}`} />
      <div className="candidate-actions"><button type="button" className="secondary" disabled={approvingId !== null || deletingId !== null} onClick={() => approve(asset)}>{approvingId === asset.id ? 'Selecting…' : asset.id === selectedAudioId ? 'Selected pronunciation' : 'Use this pronunciation'}</button><button type="button" className="danger-button" disabled={approvingId !== null || deletingId !== null} onClick={() => remove(asset)}>{deletingId === asset.id ? 'Deleting…' : 'Delete'}</button></div>
    </div>)}
    <h4>Student QR code</h4>
    <p>Uses a random token, not personal information. Existing student-ID QR cards also work with check-in.</p>
    <a href={`/api/students/${student.id}/qr.svg`} target="_blank" rel="noreferrer">Open student QR code</a>
  </section>
}
