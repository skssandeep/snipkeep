import * as React from 'react'
import * as SheetPrimitive from '@radix-ui/react-dialog'
import { XIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

// Injected into the Shadow DOM alongside POPUP_CSS so these styles are isolated.
// No Tailwind — we use our CSS variable system directly.
export const SHEET_CSS = `
  @keyframes cn-sheet-overlay-in  { from { opacity: 0 } to { opacity: 1 } }
  @keyframes cn-sheet-overlay-out { from { opacity: 1 } to { opacity: 0 } }
  @keyframes cn-sheet-slide-in-right  { from { transform: translateX(100%) } to { transform: translateX(0) } }
  @keyframes cn-sheet-slide-out-right { from { transform: translateX(0) } to { transform: translateX(100%) } }

  .cn-sheet-overlay {
    position: fixed;
    inset: 0;
    z-index: 2147483646;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
  }
  .cn-sheet-overlay[data-state="open"]   { animation: cn-sheet-overlay-in  0.2s ease forwards; }
  .cn-sheet-overlay[data-state="closed"] { animation: cn-sheet-overlay-out 0.2s ease forwards; }

  .cn-sheet-content {
    position: fixed;
    z-index: 2147483647;
    display: flex;
    flex-direction: column;
    background: var(--bg, #0f0f0f);
    box-shadow: -8px 0 32px rgba(0,0,0,0.45), -1px 0 0 rgba(255,255,255,0.05);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .cn-sheet-content[data-side="right"] {
    inset-block: 0;
    right: 0;
    height: 100dvh;
    width: 360px;
    border-left: 1px solid rgba(255,255,255,0.06);
  }
  .cn-sheet-content[data-side="right"][data-state="open"] {
    animation: cn-sheet-slide-in-right 0.28s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
  .cn-sheet-content[data-side="right"][data-state="closed"] {
    animation: cn-sheet-slide-out-right 0.2s cubic-bezier(0.4, 0, 1, 1) forwards;
  }

  .cn-sheet-header {
    display: flex;
    align-items: center;
    padding: 0 12px 0 16px;
    height: 48px;
    background: #242424;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    flex-shrink: 0;
  }

  .cn-sheet-footer {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px;
    background: rgba(255,255,255,0.02);
    border-top: 1px solid rgba(255,255,255,0.06);
  }

  .cn-sheet-title {
    flex: 1;
    font-size: 14px;
    font-weight: 700;
    color: #fff;
    letter-spacing: -0.3px;
  }
  .cn-sheet-title span { color: #c8f135; }

  .cn-sheet-description {
    font-size: 12px;
    color: #888;
  }

  .cn-sheet-close-btn {
    background: none;
    border: none;
    color: #999;
    cursor: pointer;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    flex-shrink: 0;
    transition: background 0.12s, color 0.12s;
  }
  .cn-sheet-close-btn:hover { background: rgba(255,255,255,0.07); color: #ccc; }
  .cn-sheet-close-btn:focus-visible { outline: 2px solid #c8f135; outline-offset: 2px; }
`

// ─── Primitives ───────────────────────────────────────────────────────────────

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({ ...props }: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

// The container prop is the critical Chrome-extension adaptation:
// By default Radix portals to document.body, escaping the Shadow DOM.
// Passing the shadow root's container element keeps everything isolated.
function SheetPortal({
  container,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal> & {
  container?: HTMLElement | null
}) {
  return (
    <SheetPrimitive.Portal
      data-slot="sheet-portal"
      container={container ?? undefined}
      {...props}
    />
  )
}

function SheetOverlay({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn('cn-sheet-overlay', className)}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = 'right',
  showClose = true,
  container,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: 'top' | 'right' | 'bottom' | 'left'
  showClose?: boolean
  container?: HTMLElement | null
}) {
  return (
    <SheetPortal container={container}>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn('cn-sheet-content', className)}
        {...props}
      >
        {children}
        {showClose && (
          <SheetPrimitive.Close className="cn-sheet-close-btn" title="Close (Esc)">
            <XIcon size={14} />
            <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' }}>
              Close
            </span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('cn-sheet-header', className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn('cn-sheet-footer', className)}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('cn-sheet-title', className)}
      {...props}
    />
  )
}

function SheetDescription({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('cn-sheet-description', className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
