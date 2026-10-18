import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./studio.css";
import App from "./LiveApp.jsx";
import { SessionProvider } from "./state/resources.jsx";
import TourOverlay from "./tour/Tour.jsx";

createRoot(document.getElementById("root")).render(
  <SessionProvider>
    <App />
    <TourOverlay />
  </SessionProvider>,
);
import "./quality.css";

import "./pages/victim/victim-premium.css";
import "./pages/case/analyst-workspace.css";

import "./pages/case/analyst-density.css";
