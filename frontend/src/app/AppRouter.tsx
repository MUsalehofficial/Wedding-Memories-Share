import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { WelcomePage } from '../pages/WelcomePage'
import { AccessCodePage } from '../pages/AccessCodePage'
import { UploadPage } from '../pages/UploadPage'
import { GalleryPage } from '../pages/GalleryPage'
import { OfflinePage } from '../pages/OfflinePage'
import { PrivacyPage } from '../pages/PrivacyPage'
import { AdminDrivePage } from '../pages/AdminDrivePage'

/** Guest MVP + minimal Drive reconnect page (no admin dashboard). */
export function AppRouter() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<WelcomePage />} />
        <Route path="/access" element={<AccessCodePage />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/gallery" element={<GalleryPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/offline" element={<OfflinePage />} />
        <Route path="/admin/drive" element={<AdminDrivePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}
