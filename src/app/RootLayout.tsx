import { Outlet } from 'react-router'
import { Toaster } from '../components/Toaster'
import { UpdatePrompt } from '../components/UpdatePrompt'

export function RootLayout() {
  return (
    <>
      <Outlet />
      <UpdatePrompt />
      <Toaster />
    </>
  )
}
