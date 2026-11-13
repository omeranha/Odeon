import { LoaderCircle } from 'lucide-react'
import type { ReactNode } from 'react'

export function LoadingState() {
  return (
    <div className="grid place-items-center py-24" role="status" aria-label="Loading">
      <LoaderCircle className="size-8 animate-spin text-subdued" />
    </div>
  )
}

export function MessageState({ icon, title, message, children }: { icon?: ReactNode; title: string; message?: string; children?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-16 text-center">
      {icon}
      <h2 className="text-xl font-bold">{title}</h2>
      {message && <p className="text-sm text-subdued">{message}</p>}
      {children}
    </div>
  )
}
