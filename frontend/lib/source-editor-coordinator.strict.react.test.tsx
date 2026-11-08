// @vitest-environment jsdom
import {cleanup,render,screen} from '@testing-library/react';
import {StrictMode,useEffect,useState} from 'react';
import {afterEach,expect,it} from 'vitest';
import {createSourceEditorCoordinator,type SourceEditorRole} from './source-editor-coordinator';
afterEach(cleanup);
it('StrictMode clean setup-cleanup-setup requires fresh reads and settles only after all re-register',()=>{
 const coordinator=createSourceEditorCoordinator('strict-react');const transitions:string[]=[];
 const stop=coordinator.subscribe(value=>transitions.push(value.status));
 function Writer({role}:{role:SourceEditorRole}){useEffect(()=>{const writer=coordinator.register(role);writer.readSucceeded(writer.beginRead());return()=>writer.destroy();},[role]);return null;}
 function View(){const [status,setStatus]=useState(coordinator.snapshot().status);useEffect(()=>coordinator.subscribe(value=>setStatus(value.status)),[]);return <span>{status}</span>;}
 const view=render(<StrictMode><Writer role="brief"/><Writer role="drawing"/><Writer role="images"/><View/></StrictMode>);
 expect(screen.getByText('settled')).toBeTruthy();
 expect(transitions.filter(value=>value==='settled').length).toBeGreaterThanOrEqual(2);
 expect(transitions.join(',')).toContain('settled,unknown');
 view.unmount();expect(coordinator.snapshot().status).toBe('unknown');stop();coordinator.destroy();
});
