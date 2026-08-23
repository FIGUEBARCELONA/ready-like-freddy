import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import ExecutionDashboard from "./pages/ExecutionDashboard";
import DashboardLayout from "./components/DashboardLayout";
import { ThemeProvider } from "./contexts/ThemeContext";
import ControlSection from "./pages/ControlSection";
import Home from "./pages/Home";
import VisualForensics from "./pages/VisualForensics";

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <DashboardLayout>
      <Switch>
        <Route path={"/"} component={Home} />
        <Route path={"/execution"} component={ExecutionDashboard} />
        <Route path={"/queue"}>{() => <ControlSection section="queue" />}</Route>
        <Route path={"/partitions"}>{() => <ControlSection section="partitions" />}</Route>
        <Route path={"/cache"}>{() => <ControlSection section="cache" />}</Route>
        <Route path={"/imports"}>{() => <ControlSection section="imports" />}</Route>
        <Route path={"/calibration"}>{() => <ControlSection section="calibration" />}</Route>
        <Route path={"/audit"}>{() => <ControlSection section="audit" />}</Route>
        <Route path={"/visual"} component={VisualForensics} />
        <Route path={"/404"} component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
