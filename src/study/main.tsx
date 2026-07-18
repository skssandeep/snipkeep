import React from 'react'
import ReactDOM from 'react-dom/client'
import { ensureFontLoaded } from '../lib/fonts'
import { Study } from './Study'
import './study.css'

ensureFontLoaded()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Study />
  </React.StrictMode>
)
