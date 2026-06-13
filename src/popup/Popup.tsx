import React, { useEffect, useState } from 'react'
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

// ── Settings Tab ──────────────────────────────────────────────────────────────

function Settings() {
  const [isSignedIn, setIsSignedIn] = useState(false)
  const [docs, setDocs] = useState<DocDestination[]>([])
  const [newDocId, setNewDocId] = useState('')
  const [newDocName, setNewDocName] = useState('')
  const [notionToken, setNotionToken] = useState('')
  const [notionPageId, setNotionPageId] = useState('')
  const [notionPageName, setNotionPageName] = useState('')
  const [flash, setFlash] = useState('')

  useEffect(() => {
    chrome.storage.sync.get(['isSignedIn', 'docs', 'docId', 'notionConfig'], (result) => {
      if (result.isSignedIn) setIsSignedIn(true)

      // Migrate legacy single-doc format
      let d: DocDestination[] = (result.docs as DocDestination[]) ?? []
      if (d.length === 0 && result.docId) d = [{ id: result.docId as string, name: 'My Notes' }]
      setDocs(d)

      const nc = result.notionConfig as NotionConfig | undefined
      if (nc) {
        setNotionToken(nc.token)
        setNotionPageId(nc.pageId)
        setNotionPageName(nc.pageName)
      }
    })
  }, [])

  function showFlash(msg: string) {
    setFlash(msg)
    setTimeout(() => setFlash(''), 3000)
  }

  function handleSignIn() {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError || !token) {
        showFlash(chrome.runtime.lastError?.message ?? 'Sign-in failed')
        return
      }
      chrome.storage.sync.set({ isSignedIn: true })
      setIsSignedIn(true)
      showFlash('Signed in.')
    })
  }

  function handleSignOut() {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      const clear = () => {
        chrome.storage.sync.set({ isSignedIn: false })
        setIsSignedIn(false)
        showFlash('Signed out.')
      }
      if (!token) { clear(); return }
      chrome.identity.removeCachedAuthToken({ token }, clear)
    })
  }

  function handleAddDoc() {
    const id = newDocId.trim()
    const name = newDocName.trim() || 'My Notes'
    if (!id) return
    if (docs.find(d => d.id === id)) { showFlash('Doc already added.'); return }
    const updated = [...docs, { id, name }]
    chrome.storage.sync.set({ docs: updated })
    setDocs(updated)
    setNewDocId('')
    setNewDocName('')
    showFlash(`"${name}" added.`)
  }

  function handleRemoveDoc(id: string) {
    const updated = docs.filter(d => d.id !== id)
    chrome.storage.sync.set({ docs: updated })
    setDocs(updated)
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

  return (
    <div className="tab-content">
      {/* Auth */}
      <div className="section">
        <div className="section-label">Google Account</div>
        {isSignedIn ? (
          <div className="row">
            <span className="muted">Signed in</span>
            <button className="btn-ghost" onClick={handleSignOut}>Sign out</button>
          </div>
        ) : (
          <button className="btn-primary full-width" onClick={handleSignIn}>Sign in with Google</button>
        )}
      </div>

      {/* Google Docs */}
      <div className="section">
        <div className="section-label">Google Docs</div>
        {docs.length > 0 && (
          <div className="doc-list">
            {docs.map(doc => (
              <div key={doc.id} className="doc-item">
                <div className="doc-info">
                  <div className="doc-name">{doc.name}</div>
                  <div className="doc-id">{doc.id.slice(0, 24)}…</div>
                </div>
                <button className="btn-remove" onClick={() => handleRemoveDoc(doc.id)} title="Remove">✕</button>
              </div>
            ))}
          </div>
        )}
        <div className="add-doc-form">
          <input
            className="input"
            value={newDocName}
            onChange={e => setNewDocName(e.target.value)}
            placeholder="Name (e.g. Study Notes)"
          />
          <input
            className="input"
            value={newDocId}
            onChange={e => setNewDocId(e.target.value)}
            placeholder="Google Doc ID"
            spellCheck={false}
          />
          <button className="btn-primary full-width" onClick={handleAddDoc} disabled={!newDocId.trim()}>
            Add Document
          </button>
        </div>
        <p className="hint">Doc ID is in the URL: docs.google.com/document/d/<strong>ID</strong>/edit</p>
      </div>

      {/* Notion */}
      <div className="section">
        <div className="section-label">Notion</div>
        <div className="add-doc-form">
          <input
            className="input"
            value={notionPageName}
            onChange={e => setNotionPageName(e.target.value)}
            placeholder="Name (e.g. Research)"
          />
          <input
            className="input"
            value={notionToken}
            onChange={e => setNotionToken(e.target.value)}
            placeholder="Integration token (ntn_…)"
            spellCheck={false}
          />
          <input
            className="input"
            value={notionPageId}
            onChange={e => setNotionPageId(e.target.value)}
            placeholder="Page ID"
            spellCheck={false}
          />
          <div className="row">
            <button className="btn-primary" onClick={handleSaveNotion} disabled={!notionToken.trim() || !notionPageId.trim()}>
              {notionToken ? 'Update' : 'Connect'}
            </button>
            {notionToken && (
              <button className="btn-ghost" onClick={handleDisconnectNotion}>Disconnect</button>
            )}
          </div>
        </div>
        <p className="hint">Create an integration at notion.so/my-integrations, share your page with it, then paste the token and page ID above.</p>
      </div>

      {flash && <div className="flash">{flash}</div>}
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

export function Popup() {
  const [tab, setTab] = useState<Tab>('settings')

  return (
    <div className="popup">
      <div className="header">
        <span className="logo">ClipNote</span>
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
