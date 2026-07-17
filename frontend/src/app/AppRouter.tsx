import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { WelcomePage } from '../pages/WelcomePage'
import { AccessCodePage } from '../pages/AccessCodePage'
import { SpikeUploadPage } from '../pages/SpikeUploadPage'
import { AdminLoginPage } from '../pages/AdminLoginPage'
import { AdminCapacityPage } from '../pages/AdminCapacityPage'
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
        <Route path="/admin/capacity" element={<AdminCapacityPage />} />
        <Route path="/admin/spike-upload" element={<SpikeUploadPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}
