import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './index.css';
import { SatelliteTracker } from './satellite-tracker/SatelliteTracker';


const router = createBrowserRouter([
  {
    path: "/",
    element: <SatelliteTracker />,
  }
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);