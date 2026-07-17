import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppRouter } from './app/AppRouter'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppRouter />
    </QueryClientProvider>
  )
}
