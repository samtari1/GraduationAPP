import { useEffect, useState } from 'react'
import { api } from './api'
import type { AudioAsset, Student } from './types'

type Voice = { name: string; language_codes: string[]; gender: string }

const languageDisplayName = (code: string) => {
  try {
    return new Intl.DisplayNames([navigator.language], { type: 'language' }).of(code) || code
  } catch {
    return code
  }
}

export default function PronunciationTools({ student, dirty, onApproved }: {
  student: Student; dirty: boolean; onApproved: () => Promise<void>
}) {
  const [assets, setAssets] = useState<AudioAsset[]>([])
  const [languages, setLanguages] = useState<string[]>([])
  const [voices, setVoices] = useState<Voice[]>([])
  const [language, setLanguage] = useState(/^[a-z]{2,3}-/i.test(student.language ?? '') ? student.language! : 'en-US')
  const [voice, setVoice] = useState('')
  const [text, setText] = useState(student.announcement_text || student.display_name)
  const [rate, setRate] = useState(1)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    api.get<AudioAsset[]>(`/api/students/${student.id}/audio`).then(setAssets).catch(e => setMessage(e.message))
  }, [student.id])

  const loadVoices = async (languageCode: string) => {
    setBusy(true); setMessage('')
    try {
      const result = await api.get<Voice[]>(`/api/speech/voices?language_code=${encodeURIComponent(languageCode)}`)
      setVoices(result)
      setVoice(result[0]?.name ?? '')
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
        const preferred = result.includes(language) ? language : result.includes('en-US') ? 'en-US' : result[0]
        if (!preferred) {
          setMessage('Google did not return any supported languages.')
          return
        }
        setLanguage(preferred)
        const availableVoices = await api.get<Voice[]>(`/api/speech/voices?language_code=${encodeURIComponent(preferred)}`)
        if (!active) return
        setVoices(availableVoices)
        setVoice(availableVoices[0]?.name ?? '')
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
        text, language_code: language, voice_name: voice, speaking_rate: rate,
      })
      setAssets(current => [asset, ...current])
      setMessage('Candidate saved locally. Listen before selecting it for the ceremony.')
    } catch (error) { setMessage((error as Error).message) }
    finally { setBusy(false) }
  }

  const approve = async (asset: AudioAsset) => {
    setBusy(true); setMessage('')
    try {
      await api.post(`/api/students/${student.id}/audio/${asset.id}/approve`)
      await onApproved()
    } catch (error) { setMessage((error as Error).message) }
    finally { setBusy(false) }
  }

  return <section className="pronunciation-tools">
    <h3>Google pronunciation studio</h3>
    <p>Generation sends the text below to Google Cloud and may incur charges. Saved MP3s play offline. Credentials stay on the server.</p>
    {dirty && <p className="studio-message">Save your record changes before generating or selecting audio.</p>}
    <div className="speech-settings">
      <label className="wide">Language<select value={language} disabled={busy || !languages.length} onChange={e => { const code = e.target.value; setLanguage(code); setVoices([]); setVoice(''); void loadVoices(code) }}><option value="">{busy ? 'Loading supported languages…' : 'Select a language'}</option>{languages.map(code => <option value={code} key={code}>{languageDisplayName(code)} · {code}</option>)}</select></label>
      <label className="wide">Voice<select value={voice} onChange={e => setVoice(e.target.value)}><option value="">Load and select a voice</option>{voices.map(item => <option value={item.name} key={item.name}>{item.name} · {item.gender}</option>)}</select></label>
      <label className="wide">Text to pronounce<textarea rows={2} value={text} onChange={e => setText(e.target.value)} maxLength={500} /></label>
      <div className="wide speech-presets">
        <button type="button" onClick={() => setText(student.announcement_text || student.display_name)}>Ceremony name</button>
        <button type="button" disabled={!student.native_name} onClick={() => setText(student.native_name ?? '')}>Native-script name</button>
        <button type="button" disabled={!student.phonetic_spelling} onClick={() => setText(student.phonetic_spelling ?? '')}>Phonetic spelling</button>
      </div>
      <label>Speaking rate<input type="number" min="0.25" max="2" step="0.05" value={rate} onChange={e => setRate(Number(e.target.value))} /></label>
      <button type="button" className="primary" onClick={generate} disabled={busy || dirty || !voice || !text.trim() || rate < .25 || rate > 2}>{busy ? 'Working…' : 'Generate new candidate'}</button>
    </div>
    {message && <p className="studio-message" role="status">{message}</p>}
    <h4>Saved audio candidates</h4>
    {!assets.length && <p>No saved candidates yet.</p>}
    {assets.map(asset => <div className="audio-candidate" key={asset.id}>
      <strong>#{asset.id} · {asset.voice || asset.original_filename}</strong>
      <small>{asset.source}{asset.id === student.active_audio_id ? ' · Selected for ceremony' : ''}</small>
      <audio controls preload="none" src={asset.url} aria-label={`Preview candidate ${asset.id}`} />
      <button type="button" className="secondary" disabled={busy || dirty} onClick={() => approve(asset)}>Use this pronunciation</button>
    </div>)}
    <h4>Student QR code</h4>
    <p>Uses a random token, not personal information. Existing student-ID QR cards also work with check-in.</p>
    <a href={`/api/students/${student.id}/qr.svg`} target="_blank" rel="noreferrer">Open student QR code</a>
  </section>
}
