import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/manrope";
import { Compass } from "lucide-react";
import App from "./App";
import "./styles.css";
import "./redesign.css";

// Windows desktop: Electron leaves the title bar to the page, beside Windows' own minimize, maximize and close
// buttons (titleBarOverlay in electron/main.js). Dragging it moves the window; double-clicking maximizes.
const titleBar = !!(navigator as Navigator & { windowControlsOverlay?: { visible: boolean } }).windowControlsOverlay?.visible;
if (titleBar) document.documentElement.classList.add("has-titlebar");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {titleBar && (
      <div className="window-titlebar">
        <span className="brand-mark" aria-hidden="true">
          <Compass size={13} strokeWidth={2} />
        </span>
        Issue Scout
      </div>
    )}
    <App />
  </React.StrictMode>,
);
