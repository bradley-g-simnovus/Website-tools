import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './index.css';
import { BandInfoStandalone } from './BandInfo/BandInfoStandalone';
import { NRGSCNCalculator } from './NR-GSCN/NR-GSCN-Calculator';


const router = createBrowserRouter([
  {
    path: "/band-info",
    element: <BandInfoStandalone />,
  },
  {
    path: "/",
    element: <NRGSCNCalculator />,
  }
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);