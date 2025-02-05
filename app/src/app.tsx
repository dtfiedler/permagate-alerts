import { Subscribe } from './pages/subscribe';
import {
  NotFoundRoute,
  RouterProvider,
  createRootRouteWithContext,
  redirect,
  useNavigate,
} from '@tanstack/react-router';
import { createRoute, createRouter } from '@tanstack/react-router';
import { routerWithQueryClient } from '@tanstack/react-router-with-query';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Layout from './components/layout';

// Auth wrapper component that protects routes requiring authentication
const AuthPage = ({ children }: { children: React.ReactNode }) => {
  const navigate = useNavigate();

  return <>{children}</>;
};

// Create the route configuration
const rootRoute = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  component: Layout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: async () => {
    return redirect({ to: '/subscribe' });
  },
});

const subscribeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/subscribe',
  component: Subscribe,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'settings',
  component: () => (
    <AuthPage>
      <div>Settings</div>
    </AuthPage>
  ),
});

const notFoundRoute = new NotFoundRoute({
  getParentRoute: () => rootRoute,
  beforeLoad: async () => {
    return redirect({ to: '/' });
  },
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  subscribeRoute,
  settingsRoute,
  notFoundRoute,
]);

const queryClient = new QueryClient();

const router = routerWithQueryClient(
  createRouter({
    routeTree,
    defaultPreload: 'intent',
    context: {
      queryClient,
    },
    Wrap: ({ children }: { children: React.ReactNode }) => (
      <>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </>
    ),
  }),
  queryClient,
);

function App() {
  return <RouterProvider router={router} />;
}

export default App;
