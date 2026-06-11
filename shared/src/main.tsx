import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

const ROOT_ID = "__diviewer_shared_root__";
const host = document.getElementById(ROOT_ID) as (HTMLElement & { shadowRoot?: ShadowRoot | null }) | null;
const mount = host?.shadowRoot?.querySelector<HTMLElement>("#__diviewer_shared_mount__") ?? host;

if (mount) {
  ReactDOM.createRoot(mount).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
