import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import "./gallery.css";
import "@selvren/react/styles.css";

const root = document.getElementById("root");
if (!(root instanceof HTMLElement)) {
  throw new Error("root element missing");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
