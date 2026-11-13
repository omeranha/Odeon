import { create } from 'zustand'

export interface Toast {
  id: number
  message: string
}

interface ToastState {
  toasts: Toast[]
  dismiss: (id: number) => void
}

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}))

let nextToastId = 0

export function showToast(message: string): void {
  const id = ++nextToastId
  useToastStore.setState((state) => ({ toasts: [...state.toasts.slice(-2), { id, message }] }))
  setTimeout(() => useToastStore.getState().dismiss(id), 3000)
}
