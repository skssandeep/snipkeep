import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  HistoryEntry,
  ClipRole,
  ClassifyRolesMessage,
  ExportOutlineMessage,
  ExportOutlineResponse,
} from '../types'

// Argument Skeleton (feature research PDF #07): the doc's clips as
// role-labeled cards the student DRAGS into an argument tree. The AI only
// classified the pieces (see CLASSIFY_ROLES); every arrangement decision is
// the student's — including overriding the labels by placing a card anywhere.
// Native HTML5 drag-and-drop, no library: modern feel comes from clear states
// (dimmed+tilted drag ghost, accent-dashed hot zones), not physics.

interface OutlinePoint {
  claim: number | null   // savedAt of the placed claim card
  children: number[]     // savedAts of supporting/counter cards, in order
}
interface OutlineData {
  points: OutlinePoint[]
}

const ROLE_LABEL: Record<ClipRole, string> = {
  claim: 'Claim',
  evidence: 'Evidence',
  counterpoint: 'Counter',
  definition: 'Definition',
  procedure: 'Procedure',
}

interface Props {
  clips: HistoryEntry[]
  destinationId: string
  aiConnected: boolean
}

export function Outline({ clips, destinationId, aiConnected }: Props) {
  const textClips = useMemo(() => clips.filter(c => c.kind !== 'image'), [clips])
  const byId = useMemo(() => new Map(textClips.map(c => [c.savedAt, c])), [textClips])

  const [outline, setOutline] = useState<OutlineData>({ points: [] })
  const [loaded, setLoaded] = useState(false)
  const [dragging, setDragging] = useState<number | null>(null)
  // Which drop zone is hot: 'tray' | `claim-${i}` | `children-${i}`
  const [hotZone, setHotZone] = useState<string | null>(null)
  const [exportState, setExportState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [exportError, setExportError] = useState('')
  const classifyRequested = useRef(false)

  // Load the persisted skeleton; prune savedAts whose clips no longer exist.
  useEffect(() => {
    chrome.storage.local.get(['outlines']).then(stored => {
      const all = (stored.outlines as Record<string, OutlineData>) ?? {}
      const raw = all[destinationId] ?? { points: [] }
      const valid = (id: number | null) => id !== null && byId.has(id)
      setOutline({
        points: raw.points.map(p => ({
          claim: valid(p.claim) ? p.claim : null,
          children: p.children.filter(id => byId.has(id)),
        })),
      })
      setLoaded(true)
    })
    // byId is derived from the clips prop, which is frozen for this page view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destinationId])

  // Classify unlabeled clips once per visit (fire-and-forget; role chips
  // arrive via the parent's storage listener refreshing the clips prop).
  useEffect(() => {
    if (!aiConnected || classifyRequested.current) return
    const unlabeled = textClips.filter(c => !c.role).map(c => c.savedAt)
    if (unlabeled.length === 0) return
    classifyRequested.current = true
    const msg: ClassifyRolesMessage = { type: 'CLASSIFY_ROLES', payload: { savedAts: unlabeled } }
    chrome.runtime.sendMessage(msg).catch(() => {})
  }, [aiConnected, textClips])

  function persist(next: OutlineData) {
    setOutline(next)
    chrome.storage.local.get(['outlines']).then(stored => {
      const all = (stored.outlines as Record<string, OutlineData>) ?? {}
      all[destinationId] = next
      chrome.storage.local.set({ outlines: all })
    })
  }

  const placed = useMemo(() => {
    const set = new Set<number>()
    for (const p of outline.points) {
      if (p.claim !== null) set.add(p.claim)
      p.children.forEach(id => set.add(id))
    }
    return set
  }, [outline])

  const tray = textClips.filter(c => !placed.has(c.savedAt))

  // Remove a card from wherever it currently sits.
  function without(data: OutlineData, savedAt: number): OutlineData {
    return {
      points: data.points.map(p => ({
        claim: p.claim === savedAt ? null : p.claim,
        children: p.children.filter(id => id !== savedAt),
      })),
    }
  }

  function dropOn(zone: string) {
    if (dragging === null) return
    let next = without(outline, dragging)
    if (zone.startsWith('claim-')) {
      const i = Number(zone.slice(6))
      // An occupied claim slot swaps its old card back to the tray.
      next = {
        points: next.points.map((p, idx) => (idx === i ? { ...p, claim: dragging } : p)),
      }
    } else if (zone.startsWith('children-')) {
      const i = Number(zone.slice(9))
      next = {
        points: next.points.map((p, idx) =>
          idx === i ? { ...p, children: [...p.children, dragging] } : p
        ),
      }
    }
    // zone === 'tray' → without() already returned it there.
    persist(next)
    setDragging(null)
    setHotZone(null)
  }

  // Shared drop-zone props. dragover MUST preventDefault or drop never fires.
  const zoneProps = (zone: string) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault()
      if (hotZone !== zone) setHotZone(zone)
    },
    onDragLeave: (e: React.DragEvent) => {
      if (e.currentTarget === e.target) setHotZone(z => (z === zone ? null : z))
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dropOn(zone)
    },
  })

  function card(entry: HistoryEntry, compact = false) {
    return (
      <div
        key={entry.savedAt}
        className={`ol-card${dragging === entry.savedAt ? ' dragging' : ''}${compact ? ' compact' : ''}`}
        draggable
        onDragStart={e => {
          e.dataTransfer.setData('text/plain', String(entry.savedAt))
          e.dataTransfer.effectAllowed = 'move'
          setDragging(entry.savedAt)
        }}
        onDragEnd={() => { setDragging(null); setHotZone(null) }}
      >
        {entry.role && <span className={`ol-role ol-role-${entry.role}`}>{ROLE_LABEL[entry.role]}</span>}
        <span className="ol-card-text">
          {entry.text.slice(0, 110)}{entry.text.length > 110 ? '…' : ''}
        </span>
      </div>
    )
  }

  async function handleExport() {
    setExportState('sending')
    setExportError('')
    const msg: ExportOutlineMessage = {
      type: 'EXPORT_OUTLINE',
      payload: {
        destinationId,
        points: outline.points
          .filter(p => p.claim !== null || p.children.length > 0)
          .map(p => ({ claimSavedAt: p.claim, childSavedAts: p.children })),
      },
    }
    const res: ExportOutlineResponse = await chrome.runtime.sendMessage(msg)
    if (res?.success) {
      setExportState('sent')
      setTimeout(() => setExportState('idle'), 2500)
    } else {
      setExportState('error')
      setExportError(res?.error ?? 'Export failed — try again')
    }
  }

  if (!loaded) return null

  const exportable = outline.points.some(p => p.claim !== null)

  return (
    <div className="outline">
      <div className="outline-columns">
        {/* ── The tray: unplaced pieces ── */}
        <aside className={`ol-tray${hotZone === 'tray' ? ' drop-hot' : ''}`} {...zoneProps('tray')}>
          <h2 className="ol-zone-title">
            Your pieces <span className="ol-count">{tray.length} left</span>
          </h2>
          {!aiConnected && tray.some(c => !c.role) && (
            <p className="ol-hint">Connect an AI key (drawer → ✨) and the pieces get role labels.</p>
          )}
          <div className="ol-tray-list">
            {tray.map(c => card(c))}
            {tray.length === 0 && <p className="ol-hint">Everything's placed.</p>}
          </div>
        </aside>

        {/* ── The skeleton: the argument tree ── */}
        <section className="ol-skeleton">
          {outline.points.map((p, i) => {
            const claim = p.claim !== null ? byId.get(p.claim) : undefined
            const supported = !!claim && p.children.length > 0
            return (
              <div key={i} className={`ol-point${supported ? '' : ' unsupported'}`}>
                <div className="ol-point-head">
                  <span className="ol-point-n">Point {i + 1}</span>
                  {!supported && <span className="ol-unsupported-tag">{claim ? 'no evidence yet' : 'unsupported'}</span>}
                  <button
                    className="ol-point-x"
                    aria-label={`Remove point ${i + 1}`}
                    onClick={() => persist({ points: outline.points.filter((_, idx) => idx !== i) })}
                  >
                    ✕
                  </button>
                </div>
                <div
                  className={`ol-claim-slot${hotZone === `claim-${i}` ? ' drop-hot' : ''}`}
                  {...zoneProps(`claim-${i}`)}
                >
                  {claim ? card(claim) : <span className="ol-slot-hint">Drag a claim here</span>}
                </div>
                <div
                  className={`ol-children${hotZone === `children-${i}` ? ' drop-hot' : ''}`}
                  {...zoneProps(`children-${i}`)}
                >
                  {p.children.map(id => {
                    const child = byId.get(id)
                    return child ? card(child, true) : null
                  })}
                  <span className="ol-slot-hint small">
                    {p.children.length === 0 ? 'Drag evidence or counters under it' : 'Drop more here'}
                  </span>
                </div>
              </div>
            )
          })}
          <button
            className="ol-add-point"
            onClick={() => persist({ points: [...outline.points, { claim: null, children: [] }] })}
          >
            + Add point
          </button>
        </section>
      </div>

      {/* ── Footer: honesty count + export ── */}
      <footer className="ol-foot">
        <span className="ol-foot-info">
          {tray.length > 0
            ? `${tray.length} piece${tray.length !== 1 ? 's' : ''} unplaced — unused, or a missing point?`
            : 'Every piece has a place.'}
        </span>
        {exportState === 'error' && <span className="ol-export-error">{exportError}</span>}
        <button
          className="study-primary"
          disabled={!exportable || exportState === 'sending'}
          onClick={handleExport}
        >
          {exportState === 'sending' ? 'Sending…' : exportState === 'sent' ? 'Sent ✓' : 'Send skeleton to Doc'}
        </button>
      </footer>
    </div>
  )
}
