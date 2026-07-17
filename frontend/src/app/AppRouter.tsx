import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { WelcomePage } from '../pages/WelcomePage'
import { AccessCodePage } from '../pages/AccessCodePage'
import { SpikeUploadPage } from '../pages/SpikeUploadPage'
import { AdminLoginPage } from '../pages/AdminLoginPage'
import { OfflinePage } from '../pages/OfflinePage'
import { PrivacyPage } from '../pages/PrivacyPage'

export function AppRouter() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<WelcomePage />} />
        <Route path="/access" element={<AccessCodePage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/offline" element={<OfflinePage />} />
        <Route path="/admin" element={<AdminLoginPage />} />
        {/* Spike-only route — remove after R2 POC is proven */}
        <Route path="/admin/spike-upload" element={<SpikeUploadPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}
