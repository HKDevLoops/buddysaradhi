
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { GlassShell } from "./shell/GlassShell";
import { Dashboard } from "./routes/dashboard";
import { Students } from "./routes/students";
import { Attendance } from "./routes/attendance";
import { Fees } from "./routes/fees";
import { Settings } from "./routes/settings";

const router = createBrowserRouter([
  {
    path: "/",
    element: <GlassShell />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "dashboard", element: <Dashboard /> },
      { path: "students", element: <Students /> },
      { path: "attendance", element: <Attendance /> },
      { path: "fees", element: <Fees /> },
      { path: "settings", element: <Settings /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
