// src/client/main.tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import App from "./App.js";

// Register AG Grid Community modules (Zero Enterprise watermark)
ModuleRegistry.registerModules([AllCommunityModule]);

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root mount element");

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
