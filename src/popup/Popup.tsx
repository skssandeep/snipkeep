import React, { useEffect, useRef, useState } from 'react'
import type { DocDestination, HistoryEntry, NotionConfig } from '../types'

type Tab = 'settings' | 'history'

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ── Gate Screen ───────────────────────────────────────────────────────────────
// Shown on first run (not signed in). Replaced by the full UI after auth.

function GateScreen({ onSignIn }: { onSignIn: () => Promise<void> }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleClick() {
    setLoading(true)
    setError('')
    try {
      await onSignIn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="gate-screen">
      <div className="gate-logo">Clip<span>Note</span></div>
      <p className="gate-tagline">Save what you read,<br />exactly where you write.</p>
      <button className="btn-primary full-width" onClick={handleClick} disabled={loading}>
        {loading ? 'Connecting…' : 'Connect with Google'}
      </button>
      {error && <p className="gate-error">{error}</p>}
      <p className="gate-note">Uses your existing Chrome profile — no new account needed</p>
    </div>
  )
}

// ── Settings Tab ──────────────────────────────────────────────────────────────
// Auth has been removed from here — it lives in the drawer header now.

function Settings() {
  const [docs, setDocs] = useState<DocDestination[]>([])
  const [newDocId, setNewDocId] = useState('')
  const [newDocName, setNewDocName] = useState('')
  const [isFetchingTitle, setIsFetchingTitle] = useState(false)
  const [nameEditMode, setNameEditMode] = useState(false)
  const [notionToken, setNotionToken] = useState('')
  const [notionPageId, setNotionPageId] = useState('')
  const [notionPageName, setNotionPageName] = useState('')
  const [flash, setFlash] = useState('')

  const nameTouchedRef = useRef(false)
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    chrome.storage.sync.get(['docs', 'docId', 'notionConfig'], (result) => {
      let d: DocDestination[] = (result.docs as DocDestination[]) ?? []
      if (d.length === 0 && result.docId) d = [{ id: result.docId as string, name: 'My Notes', active: true }]
      d = d.map(doc => ({ ...doc, active: doc.active ?? true }))
      setDocs(d)

      const nc = result.notionConfig as NotionConfig | undefined
      if (nc) {
        setNotionToken(nc.token)
        setNotionPageId(nc.pageId)
        setNotionPageName(nc.pageName)
      }

      if (d.length > 0) syncDocNames(d)
    })
  }, [])

  async function syncDocNames(currentDocs: DocDestination[]): Promise<void> {
    const token = await new Promise<string | null>((resolve) => {
      chrome.identity.getAuthToken({ interactive: false }, (t) => {
        if (chrome.runtime.lastError || !t) { resolve(null); return }
        resolve(t)
      })
    })
    if (!token) return

    const synced = await Promise.all(
      currentDocs.map(async (doc) => {
        try {
          const res = await fetch(
            `https://docs.googleapis.com/v1/documents/${doc.id}?fields=title`,
            { headers: { Authorization: `Bearer ${token}` } }
          )
          if (!res.ok) return doc
          const data = await res.json() as { title?: string }
          return data.title ? { ...doc, name: data.title } : doc
        } catch {
          return doc
        }
      })
    )

    const hasChanges = synced.some((doc, i) => doc.name !== currentDocs[i].name)
    if (!hasChanges) return
    setDocs(synced)
    chrome.storage.sync.set({ docs: synced })
  }

  function showFlash(msg: string) {
    setFlash(msg)
    setTimeout(() => setFlash(''), 3000)
  }

  function parseDocId(input: string): string {
    const match = input.match(/\/document\/d\/([a-zA-Z0-9_-]+)/)
    return match ? match[1] : input.trim()
  }

  function fetchDocTitle(docId: string): Promise<string | null> {
    return new Promise((resolve) => {
      chrome.identity.getAuthToken({ interactive: false }, async (token) => {
        if (chrome.runtime.lastError || !token) { resolve(null); return }
        try {
          const res = await fetch(
            `https://docs.googleapis.com/v1/documents/${docId}?fields=title`,
            { headers: { Authorization: `Bearer ${token}` } }
          )
          if (!res.ok) { resolve(null); return }
          const data = await res.json() as { title?: string }
          resolve(data.title ?? null)
        } catch {
          resolve(null)
        }
      })
    })
  }

  function handleDocUrlChange(value: string) {
    setNewDocId(value)
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current)

    const id = parseDocId(value.trim())
    if (id.length < 20) return

    fetchTimerRef.current = setTimeout(async () => {
      if (nameTouchedRef.current) return
      setIsFetchingTitle(true)
      const title = await fetchDocTitle(id)
      setIsFetchingTitle(false)
      if (title) setNewDocName(title)
    }, 600)
  }

  function handleNameChange(value: string) {
    setNewDocName(value)
    nameTouchedRef.current = true
  }

  function handleAddDoc() {
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current)
    setIsFetchingTitle(false)

    const id = parseDocId(newDocId.trim())
    const name = newDocName.trim() || 'My Notes'

    if (!id) { showFlash('Could not parse a Doc ID from that URL.'); return }
    if (docs.find(d => d.id === id)) { showFlash('Already in your list.'); return }

    const updated = [...docs, { id, name, active: true }]
    setDocs(updated)
    setNewDocId('')
    setNewDocName('')
    setNameEditMode(false)
    nameTouchedRef.current = false
    showFlash(`"${name}" added.`)

    chrome.storage.sync.set({ docs: updated }, () => {
      if (chrome.runtime.lastError) {
        setDocs(docs)
        showFlash(`Save failed: ${chrome.runtime.lastError.message}`)
      }
    })
  }

  function handleRemoveDoc(id: string) {
    const updated = docs.filter(d => d.id !== id)
    chrome.storage.sync.set({ docs: updated }, () => {
      if (chrome.runtime.lastError) { showFlash(`Failed to remove: ${chrome.runtime.lastError.message}`); return }
      setDocs(updated)
    })
  }

  function handleToggleDoc(id: string) {
    const updated = docs.map(d => d.id === id ? { ...d, active: !d.active } : d)
    setDocs(updated)
    chrome.storage.sync.set({ docs: updated })
  }

  function handleSaveNotion() {
    const token = notionToken.trim()
    const pageId = notionPageId.trim()
    const pageName = notionPageName.trim() || 'Notion'
    if (!token || !pageId) { showFlash('Fill in token and page ID.'); return }
    const nc: NotionConfig = { token, pageId, pageName }
    chrome.storage.sync.set({ notionConfig: nc })
    showFlash('Notion connected.')
  }

  function handleDisconnectNotion() {
    chrome.storage.sync.remove('notionConfig')
    setNotionToken('')
    setNotionPageId('')
    setNotionPageName('')
    showFlash('Notion disconnected.')
  }

  // Suppress unused variable warnings for Notion (hidden at MVP)
  void handleSaveNotion
  void handleDisconnectNotion
  void notionToken
  void notionPageId
  void notionPageName

  return (
    <div className="tab-content">
      {/* Google Docs — now at the top; auth is in the drawer header */}
      <div className="section">
        <div className="section-label">Google Docs</div>
        {docs.length > 0 && (
          <div className="doc-list">
            {docs.map(doc => (
              <div key={doc.id} className={`doc-item${doc.active ? '' : ' inactive'}`}>
                <div className="doc-info">
                  <div className="doc-name">{doc.name}</div>
                  <div className="doc-id">{doc.id.slice(0, 28)}…</div>
                </div>
                <button
                  className={`btn-toggle${doc.active ? ' on' : ' off'}`}
                  onClick={() => handleToggleDoc(doc.id)}
                  title={doc.active ? 'Hide from toolbar' : 'Show in toolbar'}
                />
                <button className="btn-remove" onClick={() => handleRemoveDoc(doc.id)} title="Remove">✕</button>
              </div>
            ))}
          </div>
        )}

        {flash && <div className="flash">{flash}</div>}

        <div className="input-group">
          <div className="field">
            <span className="field-label">Google Doc URL</span>
            <input
              className="field-input mono"
              value={newDocId}
              onChange={e => handleDocUrlChange(e.target.value)}
              placeholder="Paste URL or Doc ID"
              spellCheck={false}
            />
          </div>

          {newDocId.trim() && (
            <div className="field name-preview-field">
              <span className="field-label">
                Name {isFetchingTitle && <span className="field-fetching">fetching…</span>}
              </span>
              {nameEditMode ? (
                <input
                  className="field-input"
                  value={newDocName}
                  onChange={e => handleNameChange(e.target.value)}
                  placeholder="Enter a name"
                  autoFocus
                  onBlur={() => { if (!newDocName.trim()) setNameEditMode(false) }}
                />
              ) : (
                <div className="name-preview" onClick={() => setNameEditMode(true)}>
                  <span className="name-preview-text">
                    {isFetchingTitle ? '' : (newDocName || 'My Notes')}
                  </span>
                  <span className="name-preview-edit" title="Edit name">✎</span>
                </div>
              )}
            </div>
          )}
        </div>
        <button className="btn-primary full-width" onClick={handleAddDoc} disabled={!newDocId.trim()}>
          Add Document
        </button>
        <p className="hint">Paste the full URL from your browser — the ID is extracted automatically.</p>
      </div>

      {/* Notion — hidden until ready */}
    </div>
  )
}

// ── History Tab ───────────────────────────────────────────────────────────────

function History() {
  const [entries, setEntries] = useState<HistoryEntry[]>([])

  useEffect(() => {
    chrome.storage.local.get(['history'], (result) => {
      setEntries((result.history as HistoryEntry[]) ?? [])
    })
  }, [])

  function handleClear() {
    chrome.storage.local.remove('history')
    setEntries([])
  }

  if (entries.length === 0) {
    return (
      <div className="tab-content empty-state">
        <div className="empty-icon">📋</div>
        <div className="empty-text">No clips saved yet</div>
        <div className="empty-sub">Select text on any page and click Save to Notes</div>
      </div>
    )
  }

  return (
    <div className="tab-content">
      <div className="history-header">
        <span className="muted">{entries.length} clip{entries.length !== 1 ? 's' : ''}</span>
        <button className="btn-ghost small" onClick={handleClear}>Clear all</button>
      </div>
      <div className="history-list">
        {entries.map((entry, i) => (
          <a key={i} className="history-item" href={entry.sourceUrl} target="_blank" rel="noreferrer">
            <div className="history-text">{entry.text.slice(0, 80)}{entry.text.length > 80 ? '…' : ''}</div>
            <div className="history-meta">
              <span className="history-source">{entry.sourceTitle}</span>
              <span className="history-dot">·</span>
              <span className="history-dest">{entry.destinationName}</span>
              <span className="history-dot">·</span>
              <span className="history-time">{timeAgo(entry.savedAt)}</span>
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────
// Auth state lives here so the gate screen and the main UI are siblings.
// The drawer header reads userEmail from chrome.storage independently.

export function Popup() {
  const [tab, setTab] = useState<Tab>('settings')
  const [isSignedIn, setIsSignedIn] = useState(false)

  useEffect(() => {
    chrome.storage.sync.get(['isSignedIn'], (result) => {
      if (result.isSignedIn) setIsSignedIn(true)
    })

    const handler = (changes: Record<string, chrome.storage.StorageChange>) => {
      if ('isSignedIn' in changes) setIsSignedIn(!!changes.isSignedIn.newValue)
    }
    chrome.storage.onChanged.addListener(handler)
    return () => chrome.storage.onChanged.removeListener(handler)
  }, [])

  async function handleSignIn(): Promise<void> {
    return new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: true }, (token) => {
        if (chrome.runtime.lastError || !token) {
          reject(new Error(chrome.runtime.lastError?.message ?? 'Sign-in failed'))
          return
        }

        // Get the Chrome profile email to display in the avatar chip
        chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }, (info) => {
          chrome.storage.sync.set({
            isSignedIn: true,
            userEmail: info.email ?? '',
          })
          setIsSignedIn(true)
          resolve()
        })
      })
    })
  }

  if (!isSignedIn) {
    return <GateScreen onSignIn={handleSignIn} />
  }

  return (
    <div className="popup">
      <div className="header">
        <span className="logo">Clip<span>Note</span></span>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>
          Settings
        </button>
        <button className={`tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
          History
        </button>
      </div>

      {tab === 'settings' ? <Settings /> : <History />}
    </div>
  )
}
