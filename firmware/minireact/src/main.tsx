import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Runtime } from "./state";
import { MinichordTransport } from "./transport";
import { App } from "./ui/App";
import { RuntimeProvider } from "./ui/RuntimeProvider";
import "./index.css";

/**
 * The motor is built here, outside React, and started before the first render.
 *
 * One page, one runtime, one transport: neither StrictMode's double mount nor a
 * hot reload can duplicate what is not created inside a component. React only
 * reads it, through the single `useSyncExternalStore` of the provider
 * (SPEC.md 5.6).
 */
const runtime = new Runtime(new MinichordTransport());
runtime.start();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RuntimeProvider runtime={runtime}>
      <App />
    </RuntimeProvider>
  </StrictMode>,
);
