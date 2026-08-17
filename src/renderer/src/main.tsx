import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import "./styles.css"
import "./design-system/fonts.css"
import "./design-system/tokens.css"
import "./design-system/migrations/01-shell.css"
import "./design-system/migrations/02-library.css"
import "./design-system/migrations/03-launchers.css"
import "./design-system/migrations/04-store.css"
import "./design-system/migrations/05-settings.css"
import "./design-system/migrations/06-management.css"
import "./design-system/migrations/07-overlays-feedback.css"

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
