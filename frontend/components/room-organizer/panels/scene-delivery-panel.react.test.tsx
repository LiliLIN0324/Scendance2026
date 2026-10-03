// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendSession, getBackendConfig } from '@/lib/backend-session';
import { makeLayout } from '../lib/__testfixtures__/fixtures';
import { downloadSceneDelivery, exportDeliveryGlb, sceneDeliveryCsv, sceneDeliveryJson } from '../lib/scene-delivery';
import { SceneDeliveryPanel } from './scene-delivery-panel';
vi.mock('../lib/scene-delivery',()=>({downloadSceneDelivery:vi.fn(),exportDeliveryGlb:vi.fn(),sceneDeliveryCsv:vi.fn(),sceneDeliveryJson:vi.fn()}));
let controller:BackendSession;
const layout=makeLayout();
beforeEach(()=>{controller=new BackendSession(getBackendConfig({url:'',anonKey:''}));vi.mocked(exportDeliveryGlb).mockResolvedValue({buffer:new ArrayBuffer(8),objectCount:2});vi.mocked(sceneDeliveryCsv).mockReturnValue('csv');vi.mocked(sceneDeliveryJson).mockReturnValue('{}');});
afterEach(()=>{cleanup();controller.dispose();vi.clearAllMocks();});
describe('Binggo scene delivery panel',()=>{
  it('only prepares and downloads after an explicit click',async()=>{
    render(<SceneDeliveryPanel layout={layout} controller={controller}/>);
    expect(exportDeliveryGlb).not.toHaveBeenCalled();expect(downloadSceneDelivery).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'导出场景 GLB'}));
    await waitFor(()=>expect(downloadSceneDelivery).toHaveBeenCalledOnce());
    expect(exportDeliveryGlb).toHaveBeenCalledWith(layout,controller);
    expect(screen.getByRole('status').textContent).toContain('复检');
  });
  it('keeps JSON and CSV as separate explicit downloads',async()=>{
    render(<SceneDeliveryPanel layout={layout} controller={controller}/>);
    fireEvent.click(screen.getByRole('button',{name:'导出场景 JSON'}));
    await waitFor(()=>expect(sceneDeliveryJson).toHaveBeenCalledWith(layout));
    fireEvent.click(screen.getByRole('button',{name:'导出物料清单 CSV'}));
    await waitFor(()=>expect(sceneDeliveryCsv).toHaveBeenCalledWith(layout));
    expect(exportDeliveryGlb).not.toHaveBeenCalled();
  });
  it('does not download a stale snapshot after scene editing during verification',async()=>{
    let done!:(value:{buffer:ArrayBuffer;objectCount:number})=>void;
    vi.mocked(exportDeliveryGlb).mockImplementationOnce(()=>new Promise(resolve=>{done=resolve;}));
    const view=render(<SceneDeliveryPanel layout={layout} controller={controller}/>);
    fireEvent.click(screen.getByRole('button',{name:'导出场景 GLB'}));
    await waitFor(()=>expect(exportDeliveryGlb).toHaveBeenCalledOnce());
    view.rerender(<SceneDeliveryPanel layout={{...layout,name:'Changed'}} controller={controller}/>);
    await act(async()=>{done({buffer:new ArrayBuffer(8),objectCount:2});});
    expect(downloadSceneDelivery).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('场景或账号已变化');
  });
  it('does not offer a file after geometry verification fails',async()=>{
    vi.mocked(exportDeliveryGlb).mockRejectedValueOnce(new Error('GLB 复检失败：物件数量不一致。'));
    render(<SceneDeliveryPanel layout={layout} controller={controller}/>);
    fireEvent.click(screen.getByRole('button',{name:'导出场景 GLB'}));
    await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('复检失败'));
    expect(downloadSceneDelivery).not.toHaveBeenCalled();
  });
});
