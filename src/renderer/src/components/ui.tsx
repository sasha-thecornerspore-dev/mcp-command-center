import React from 'react'

export function Button({
  children,
  variant = 'default',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
}): React.JSX.Element {
  const styles: Record<string, string> = {
    default: 'bg-panel2 hover:bg-edge border border-edge text-gray-200',
    primary: 'bg-claw hover:bg-clawDim text-white border border-clawDim',
    ghost: 'bg-transparent hover:bg-panel2 text-gray-300',
    danger: 'bg-bad/20 hover:bg-bad/30 text-bad border border-bad/40'
  }
  return (
    <button
      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function Card({
  children,
  className = ''
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={`bg-panel border border-edge rounded-xl p-4 ${className}`}>{children}</div>
  )
}

export function Badge({
  children,
  tone = 'muted'
}: {
  children: React.ReactNode
  tone?: 'muted' | 'good' | 'warn' | 'bad' | 'accent' | 'claw'
}): React.JSX.Element {
  const tones: Record<string, string> = {
    muted: 'bg-edge text-muted',
    good: 'bg-good/15 text-good',
    warn: 'bg-warn/15 text-warn',
    bad: 'bg-bad/15 text-bad',
    accent: 'bg-accent/15 text-accent',
    claw: 'bg-claw/15 text-claw'
  }
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  )
}

export function Modal({
  title,
  onClose,
  children,
  wide = false
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
}): React.JSX.Element {
  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6"
      onClick={onClose}
    >
      <div
        className={`bg-panel border border-edge rounded-xl shadow-2xl w-full ${wide ? 'max-w-4xl' : 'max-w-xl'} max-h-[85vh] flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-edge">
          <h2 className="font-semibold text-gray-100">{title}</h2>
          <button onClick={onClose} className="text-muted hover:text-gray-200 text-lg leading-none">
            ×
          </button>
        </div>
        <div className="p-5 overflow-auto">{children}</div>
      </div>
    </div>
  )
}

export function Spinner({ label }: { label?: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 text-muted text-sm">
      <span className="inline-block w-3 h-3 border-2 border-muted border-t-transparent rounded-full animate-spin" />
      {label}
    </div>
  )
}
