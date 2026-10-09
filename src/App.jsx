import { lazy, Suspense } from 'react';
import { Toaster as ShadcnToaster } from "@/components/ui/toaster"
import { Toaster } from "@/components/ui/sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import DemoModeBanner from '@/components/DemoModeBanner';
import ScrollToTop from './components/ScrollToTop';
// Add page imports here
import { Navigate } from 'react-router-dom';
import ProtectedRoute from '@/components/ProtectedRoute';
import Layout from '@/components/Layout';
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Profile = lazy(() => import('@/pages/Profile'));
const Universities = lazy(() => import('@/pages/Universities'));
const UniversityDetail = lazy(() => import('@/pages/UniversityDetail'));
const ApplicationReview = lazy(() => import('@/pages/ApplicationReview'));
const EssayBuilder = lazy(() => import('@/pages/EssayBuilder'));
const Materials = lazy(() => import('@/pages/Materials'));
const KnowledgeBase = lazy(() => import('@/pages/KnowledgeBase'));
const AiKnowledge = lazy(() => import('@/pages/AiKnowledge'));
const Login = lazy(() => import('@/pages/Login'));
const Register = lazy(() => import('@/pages/Register'));
const ForgotPassword = lazy(() => import('@/pages/ForgotPassword'));
const ResetPassword = lazy(() => import('@/pages/ResetPassword'));

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  // Render the main app
  return (
    <>
      <Suspense fallback={(
        <div className="fixed inset-0 flex items-center justify-center" role="status" aria-label="Loading page">
          <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
        </div>
      )}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
            <Route element={<Layout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/universities" element={<Universities />} />
              <Route path="/universities/:id" element={<UniversityDetail />} />
              <Route path="/universities/:id/review" element={<ApplicationReview />} />
              <Route path="/essay-builder" element={<EssayBuilder />} />
              <Route path="/materials" element={<Materials />} />
              <Route path="/ai-knowledge" element={<AiKnowledge />} />
              <Route path="/knowledge-base" element={<KnowledgeBase />} />
            </Route>
          </Route>
          <Route path="*" element={<PageNotFound />} />
        </Routes>
      </Suspense>
      <DemoModeBanner />
    </>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <AuthenticatedApp />
        </Router>
        <ShadcnToaster />
        <Toaster position="bottom-right" richColors closeButton />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App