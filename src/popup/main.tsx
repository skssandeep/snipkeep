import React from 'react'
import ReactDOM from 'react-dom/client'
import { Popup } from './Popup'
import { ensureFontLoaded } from '../lib/fonts'

// Load the bundled variable font (same one the content-script drawer uses)
ensureFontLoaded()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>
)
