import { create } from 'zustand'

export const useProgressStore = create<{ position: number; duration: number }>()(() => ({ position: 0, duration: 0 }))
