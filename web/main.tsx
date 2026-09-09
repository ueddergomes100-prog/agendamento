import {createRoot} from 'react-dom/client';
import {SalonApp} from '@/components/salon/app';
import '@/app/globals.css';

createRoot(document.getElementById('root')!).render(<SalonApp/>);
