import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { SimulatorConsole } from './dev/SimulatorConsole'
import './index.css'

// The app itself does not exist yet: this map produces a specification, and the
// only thing built so far is the protocol simulator (issue #7). The dev server
// therefore boots its bench. Replace this once implementation starts.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SimulatorConsole />
  </StrictMode>,
)
