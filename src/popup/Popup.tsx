import React, { useEffect, useState } from 'react'

export function Popup() {
  const [docId, setDocId] = useState('')
  const [savedDocId, setSavedDocId] = useState('')
  const [isSignedIn, setIsSignedIn] = useState(false)
  const [flash, setFlash] = useState('')

  useEffect(() => {
    chrome.storage.sync.get(['docId', 'isSignedIn'], (result) => {
      if (result.docId) {
        setDocId(result.docId as string)
        setSavedDocId(result.docId as string)
      }
      if (result.isSignedIn) setIsSignedIn(true)
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
      showFlash('Signed in successfully.')
    })
  }

  function handleSignOut() {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (!token) {
        chrome.storage.sync.set({ isSignedIn: false })
        setIsSignedIn(false)
        return
      }
      chrome.identity.removeCachedAuthToken({ token }, () => {
        chrome.storage.sync.set({ isSignedIn: false })
        setIsSignedIn(false)
        showFlash('Signed out.')
      })
    })
  }

  function handleSaveDocId() {
    const trimmed = docId.trim()
    if (!trimmed) return
    chrome.storage.sync.set({ docId: trimmed }, () => {
      setSavedDocId(trimmed)
      showFlash('Document saved.')
    })
  }

  const docIdChanged = docId.trim() !== savedDocId

  return (
    <div className="popup">
      <div className="header">
        <span className="logo">ClipNote</span>
        <span className={`dot ${isSignedIn ? 'dot--on' : ''}`} title={isSignedIn ? 'Signed in' : 'Not signed in'} />
      </div>

      <div className="section">
        <div className="label">Google Account</div>
        {isSignedIn ? (
          <div className="row">
            <span className="muted">Signed in</span>
            <button className="btn-ghost" onClick={handleSignOut}>Sign out</button>
          </div>
        ) : (
          <button className="btn-primary full-width" onClick={handleSignIn}>
            Sign in with Google
          </button>
        )}
      </div>

      <div className="section">
        <div className="label">Target Document</div>
        <div className="input-row">
          <input
            className="input"
            value={docId}
            onChange={(e) => setDocId(e.target.value)}
            placeholder="Paste your Google Doc ID"
            spellCheck={false}
          />
          <button
            className="btn-primary"
            onClick={handleSaveDocId}
            disabled={!docId.trim() || !docIdChanged}
          >
            Save
          </button>
        </div>
        <p className="hint">
          Open your doc → copy the ID from the URL:<br />
          docs.google.com/document/d/<strong>DOC_ID</strong>/edit
        </p>
      </div>

      {flash && <div className="flash">{flash}</div>}
    </div>
  )
}
