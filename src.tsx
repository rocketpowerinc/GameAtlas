import React from 'react';
import {createRoot} from 'react-dom/client';
import Home from './app/page';
import '@fontsource/geist/latin-400.css';
import '@fontsource/geist/latin-500.css';
import '@fontsource/geist/latin-600.css';
import '@fontsource/geist/latin-700.css';
import './app/globals.css';
createRoot(document.getElementById('root')!).render(<Home/>);
