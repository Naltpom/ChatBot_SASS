import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './AuthContext'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Register from './pages/Register'
import BotList from './pages/BotList'
import BotWizard from './pages/BotWizard'
import BotPage from './pages/BotPage'
import Team from './pages/Team'
import Profile from './pages/Profile'
import MyOrgs from './pages/MyOrgs'
import Analytics from './pages/Analytics'
import Inbox from './pages/Inbox'
import AdminHome, { AdminClient } from './pages/Admin'
import AdminDashboard from './pages/AdminDashboard'
import AdminUsers from './pages/AdminUsers'
import Layout from './Layout'
import './styles.css'

function Protected({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="center-page">Chargement…</div>
  if (!user) return <Navigate to="/login" replace />
  if (adminOnly && !user.is_superadmin) return <Navigate to="/app" replace />
  return <Layout>{children}</Layout>
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public */}
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          {/* Application (clients) */}
          <Route path="/app" element={<Protected><BotList /></Protected>} />
          <Route path="/app/bots/new" element={<Protected><BotWizard /></Protected>} />
          <Route path="/app/bots/:id" element={<Protected><BotPage /></Protected>} />
          <Route path="/app/analytics" element={<Protected><Analytics /></Protected>} />
          <Route path="/app/inbox" element={<Protected><Inbox /></Protected>} />
          <Route path="/app/team" element={<Protected><Team /></Protected>} />
          <Route path="/app/orgs" element={<Protected><MyOrgs /></Protected>} />
          <Route path="/app/profile" element={<Protected><Profile /></Protected>} />
          {/* Back-office superadmin */}
          <Route path="/admin" element={<Protected adminOnly><AdminDashboard /></Protected>} />
          <Route path="/admin/clients" element={<Protected adminOnly><AdminHome /></Protected>} />
          <Route path="/admin/clients/:orgId" element={<Protected adminOnly><AdminClient /></Protected>} />
          <Route path="/admin/users" element={<Protected adminOnly><AdminUsers /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>,
)
