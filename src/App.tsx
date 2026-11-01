import { useLocation } from '@/lib/router'
import { ChainDataProvider } from '@/state/ChainData'
import { NetworkGuardProvider } from '@/state/NetworkGuard'
import { Layout } from '@/components/Layout'
import Dashboard from '@/pages/Dashboard'
import Create from '@/pages/Create'
import Explorer from '@/pages/Explorer'
import AgreementDetail from '@/pages/AgreementDetail'
import Verifier from '@/pages/Verifier'
import Refunds from '@/pages/Refunds'
import Demo from '@/pages/Demo'
import Runbook from '@/pages/Runbook'
import { EmptyState, PageHeader } from '@/components/ui'
import { Link } from '@/lib/router'

function Routes() {
  const { pathname } = useLocation()
  const clean = pathname.replace(/\/+$/, '') || '/'

  const detail = /^\/agreement\/([^/]+)$/.exec(clean)
  if (detail) return <AgreementDetail id={decodeURIComponent(detail[1])} />

  switch (clean) {
    case '/':
      return <Dashboard />
    case '/create':
      return <Create />
    case '/explorer':
      return <Explorer />
    case '/verifier':
      return <Verifier />
    case '/refunds':
      return <Refunds />
    case '/demo':
      return <Demo />
    case '/demo/live':
      return <Runbook />
    default:
      return (
        <>
          <PageHeader title="Page not found" />
          <EmptyState title="Nothing here" body="That page does not exist." action={<Link to="/" className="btn btn-ghost">Back to dashboard</Link>} />
        </>
      )
  }
}

export default function App() {
  return (
    <NetworkGuardProvider>
      <ChainDataProvider>
        <Layout>
          <Routes />
        </Layout>
      </ChainDataProvider>
    </NetworkGuardProvider>
  )
}
