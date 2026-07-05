import * as React from 'react'
import * as SheetPrimitive from '@radix-ui/react-dialog'
import { XIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

// Injected into the Shadow DOM after POPUP_CSS, so all --variables are already defined on :host.
export const SHEET_CSS = `
  @keyframes cn-sheet-overlay-in  { from { opacity: 0 } to { opacity: 1 } }
  @keyframes cn-sheet-overlay-out { from { opacity: 1 } to { opacity: 0 } }
  @keyframes cn-sheet-slide-in-right  { from { transform: translateX(100%) } to { transform: translateX(0) } }
  @keyframes cn-sheet-slide-out-right { from { transform: translateX(0) } to { transform: translateX(100%) } }

  .cn-sheet-overlay {
    position: fixed;
    inset: 0;
    z-index: 2147483646;
    background: rgba(0, 0, 0, 0.25);
  }
  .cn-sheet-overlay[data-state="open"]   { animation: cn-sheet-overlay-in  0.2s ease forwards; }
  .cn-sheet-overlay[data-state="closed"] { animation: cn-sheet-overlay-out 0.2s ease forwards; }

  .cn-sheet-content {
    position: fixed;
    z-index: 2147483647;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font);
    font-size: 13px;
    line-height: 1.5;
    box-shadow: -20px 0 60px rgba(0,0,0,0.6);
    border-radius: 16px 0 0 16px;
    overflow: hidden;
    outline: none;
  }
  .cn-sheet-content[data-side="right"] {
    inset-block: 0;
    right: 0;
    height: 100dvh;
    width: 380px;
  }
  .cn-sheet-content[data-side="right"][data-state="open"] {
    animation: cn-sheet-slide-in-right 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
  .cn-sheet-content[data-side="right"][data-state="closed"] {
    animation: cn-sheet-slide-out-right 0.22s cubic-bezier(0.4, 0, 1, 1) forwards;
  }

  /* Header is seamless — same bg as body, no divider line */
  .cn-sheet-header {
    display: flex;
    align-items: center;
    padding: 0 14px 0 20px;
    height: 58px;
    background: transparent;
    flex-shrink: 0;
  }

  .cn-sheet-footer {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px;
    border-top: 1px solid var(--border);
  }

  .cn-sheet-title {
    flex: 1;
    display: flex;
    align-items: center;
    font-size: 18px;
    font-weight: 800;
    color: var(--text);
    letter-spacing: -0.5px;
    font-family: var(--font);
  }
  .cn-sheet-title .cn-accent { color: var(--accent); }

  .cn-sheet-description {
    font-size: 12px;
    color: var(--text-3);
    font-family: var(--font);
  }

  .cn-sheet-close-btn {
    background: none;
    border: none;
    color: var(--text-3);
    cursor: pointer;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    flex-shrink: 0;
    font-family: var(--font);
    transition: background 0.12s, color 0.12s;
  }
  .cn-sheet-close-btn:hover { background: rgba(255,255,255,0.07); color: var(--text-2); }
  .cn-sheet-close-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
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
