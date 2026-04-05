import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './contexts/AuthContext'
import AppShell from './components/layout/AppShell'
import CustomerPortalShell from './components/layout/CustomerPortalShell'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import AssetList from './pages/assets/AssetList'
import AssetForm from './pages/assets/AssetForm'
import AssetDetail from './pages/assets/AssetDetail'
import CalibrationList from './pages/calibrations/CalibrationList'
import CalibrationForm from './pages/calibrations/CalibrationForm'
import CalibrationDetail from './pages/calibrations/CalibrationDetail'
import StandardsList from './pages/standards/StandardsList'
import StandardForm from './pages/standards/StandardForm'
import TemplateList from './pages/templates/TemplateList'
import TemplateForm from './pages/templates/TemplateForm'
import PortalDashboard from './pages/portal/PortalDashboard'
import PortalAssetDetail from './pages/portal/PortalAssetDetail'
import AuditPackage from './pages/AuditPackage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 1,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<CustomerPortalShell />}>
              <Route path="portal" element={<PortalDashboard />} />
              <Route path="portal/assets/:id" element={<PortalAssetDetail />} />
            </Route>
            <Route element={<AppShell />}>
              <Route index element={<Dashboard />} />
              <Route path="assets" element={<AssetList />} />
              <Route path="assets/new" element={<AssetForm />} />
              <Route path="assets/:id" element={<AssetDetail />} />
              <Route path="assets/:id/edit" element={<AssetForm />} />
              <Route path="calibrations" element={<CalibrationList />} />
              <Route path="calibrations/:assetId/new" element={<CalibrationForm />} />
              <Route path="calibrations/:assetId/edit/:existingRecordId" element={<CalibrationForm />} />
              <Route path="calibrations/:recordId" element={<CalibrationDetail />} />
              <Route path="standards" element={<StandardsList />} />
              <Route path="standards/new" element={<StandardForm />} />
              <Route path="standards/:id/edit" element={<StandardForm />} />
              <Route path="templates" element={<TemplateList />} />
              <Route path="templates/new" element={<TemplateForm />} />
              <Route path="templates/:id/edit" element={<TemplateForm />} />
              <Route path="audit" element={<AuditPackage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
