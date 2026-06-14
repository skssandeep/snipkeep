import React, { useState } from 'react'
import { Popup } from '../popup/Popup'
import popupStyles from '../popup/popup.css?inline'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SHEET_CSS,
} from '@/components/ui/sheet'

const POPUP_CSS = popupStyles
  .replace(/:root\s*\{/g, ':host {')
  .replace(/\bbody\b/g, '.cn-popup-root')

// Styles for the scrollable body area and popup overrides inside the drawer.
const BODY_CSS = `
  .cn-body {
    flex: 1;
    width: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    background: #0f0f0f;
    scrollbar-width: thin;
    scrollbar-color: #2c2c2c transparent;
  }
  /* Suppress the Popup's own header — the drawer header replaces it */
  .cn-popup-root .header { display: none !important; }
  /* Force all popup containers to fill the drawer width */
  .cn-popup-root,
  .cn-popup-root .popup { width: 100%; box-sizing: border-box; }
`

interface Props {
  // The shadow root's container element — passed so SheetPortal renders inside
  // the shadow DOM instead of escaping to document.body.
  container: HTMLElement
  onClose: () => void
  closeRef: React.MutableRefObject<(() => void) | null>
}

export function Drawer({ container, onClose, closeRef }: Props) {
  const [open, setOpen] = useState(true)

  function close() {
    setOpen(false)
  }

  // Expose animated close to content script (for icon toggle)
  closeRef.current = close

  function handleOpenChange(next: boolean) {
    if (!next) {
      // Radix plays the data-state="closed" CSS animation (200ms),
      // then we unmount the entire Drawer host after it finishes.
      setTimeout(onClose, 220)
    }
  }

  return (
    <>
      <style>{POPUP_CSS}</style>
      <style>{SHEET_CSS}</style>
      <style>{BODY_CSS}</style>
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent
          side="right"
          showClose={false}
          container={container}
        >
          <SheetHeader>
            <SheetTitle>
              Clip<span>Note</span>
            </SheetTitle>
            <button
              className="cn-sheet-close-btn"
              onClick={close}
              title="Close (Esc)"
            >
              ✕
            </button>
          </SheetHeader>
          <div className="cn-body">
            <div className="cn-popup-root">
              <Popup />
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
