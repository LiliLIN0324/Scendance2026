// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendSession, getBackendConfig } from '@/lib/backend-session';
import { flushSourceScope } from '@/lib/source-storage';
import { backendSceneToLayout } from '../lib/backend-adapter';
import { CreativeBriefPanel, CreativeStudioProvider } from './creative-studio';

const persisted = vi.hoisted(() => ({ sources: [] as Record<string, unknown>[], forms: new Map<string, unknown>() }));
vi.mock('@/lib/source-storage', async importOriginal => ({...await importOriginal<object>(),listStoredSources:async()=>[],storeSource:async(value:Record<string,unknown>)=>{persisted.sources.push(value);},deleteSource:async()=>{},readSourceForm:async()=>undefined,storeSourceForm:async(scope:string,value:unknown)=>{persisted.forms.set(scope,value);}}));
vi.mock('../contexts', () => ({ useSelection: () => ({ allSelectedIds: new Set<string>(), selectedItem: null }) }));

const layout = backendSceneToLayout({ schemaVersion: 1, venue: { width: 12, depth: 10, height: 3, shape: 'rectangle', entrances: [] }, objects: [], camera: 'overview', lighting: 'warm' }, { projectId: '10000000-0000-4000-8000-000000000001' });
let controller: BackendSession;
const decode = vi.fn();
const createObjectURL = vi.fn((file: File) => `blob:${file.name}`);
const revokeObjectURL = vi.fn();
const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
const file = (name: string) => new File(['image'], name, { type: 'image/png' });
const bitmap = () => ({ width: 1024, height: 768, close: vi.fn() });

function ui(id = layout.id!, hidden = false) {
  return <div hidden={hidden}><CreativeStudioProvider controller={controller} layout={{ ...layout, id }} onApply={vi.fn()}><CreativeBriefPanel/></CreativeStudioProvider></div>;
}
function renderUi() {
  const rendered = render(ui());
  fireEvent.click(screen.getByText('图纸、照片与现场条件（可选）'));
  const reconstruction = rendered.container.querySelector<HTMLDetailsElement>('.rc-inputs');
  if (reconstruction && !reconstruction.open) fireEvent.click(reconstruction.querySelector('summary')!);
  return rendered;
}
function upload(container: HTMLElement, files: File[]): void {
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files } });
}

beforeEach(() => {
  persisted.sources.length=0;persisted.forms.clear();
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
  decode.mockReset().mockImplementation(async () => bitmap());
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  vi.stubGlobal('createImageBitmap', decode);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No image may be uploaded in these local photo tests.'); }));
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
  controller = new BackendSession(getBackendConfig({ url: '', anonKey: '' }));
});
afterEach(() => {
  cleanup(); controller.dispose();
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  if (originalCreate) Object.defineProperty(URL, 'createObjectURL', originalCreate); else Reflect.deleteProperty(URL, 'createObjectURL');
  if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', originalRevoke); else Reflect.deleteProperty(URL, 'revokeObjectURL');
});

describe('venue photo input lifecycle', () => {
  it('flushes dimensions, brief and a just-selected image before creating the project', async () => {
    let finish!: (value: ReturnType<typeof bitmap>) => void;
    decode.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const rendered = renderUi();
    await act(async()=>{await Promise.resolve();});
    fireEvent.change(screen.getByLabelText('总宽（米）'),{target:{value:'18.25'}});
    fireEvent.change(screen.getByLabelText('客户需求'),{target:{value:'保留入口，安排签到区'}});
    const selected = file('just-selected.png');
    upload(rendered.container,[selected]);
    await waitFor(()=>expect(decode).toHaveBeenCalledOnce());

    // This is the creation gate. No debounce timer or image decode has finished.
    const createProject=vi.fn();
    const creation=flushSourceScope(layout.id!).then(createProject);
    await act(async()=>{await Promise.resolve();});
    expect(createProject).not.toHaveBeenCalled();
    await act(async()=>{finish(bitmap());await creation;});
    expect(createProject).toHaveBeenCalledOnce();
    expect(persisted.forms.get(layout.id!)).toMatchObject({width:'18.25'});
    expect(persisted.forms.get(`${layout.id}:brief`)).toMatchObject({description:'保留入口，安排签到区'});
    expect(persisted.sources.at(-1)).toMatchObject({scope:layout.id,name:'just-selected.png',blob:selected});
  });

  it('preserves consecutive selections in order while the first decode is pending', async () => {
    let finish!: (value: ReturnType<typeof bitmap>) => void;
    decode.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const rendered = renderUi();
    upload(rendered.container, [file('first.png')]);
    await waitFor(() => expect(decode).toHaveBeenCalledOnce());
    upload(rendered.container, [file('second.png')]);
    expect(decode).toHaveBeenCalledOnce();
    await act(async () => { finish(bitmap()); });
    await screen.findByRole('img', { name: '现场照片：second.png' });
    expect(screen.getAllByRole('img').map(image => image.getAttribute('alt'))).toEqual(['现场照片：first.png', '现场照片：second.png']);
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('allows deleting an old photo while another selection is decoding', async () => {
    const rendered = renderUi();
    upload(rendered.container, [file('old.png')]);
    await screen.findByRole('img', { name: '现场照片：old.png' });
    let finish!: (value: ReturnType<typeof bitmap>) => void;
    decode.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    upload(rendered.container, [file('new.png')]);
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    fireEvent.click(screen.getByRole('button', { name: '移除 old.png' }));
    await act(async () => { finish(bitmap()); });
    await screen.findByRole('img', { name: '现场照片：new.png' });
    expect(screen.queryByRole('img', { name: '现场照片：old.png' })).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:old.png');
  });

  it('enforces the twelve-source limit across queued selections without dropping earlier accepted photos', async () => {
    const rendered = renderUi();
    upload(rendered.container, Array.from({length:11},(_,index)=>file(`photo-${index}.png`)));
    upload(rendered.container, [file('three.png'), file('four.png')]);
    expect(await screen.findByText('最多添加 12 张图纸或现场照片。')).toBeTruthy();
    expect(screen.getAllByRole('img')).toHaveLength(11);
    expect(decode).toHaveBeenCalledTimes(11);
    upload(rendered.container, [file('three.png')]);
    await screen.findByRole('img', { name: '现场照片：three.png' });
    expect(screen.getByRole('button', { name: /已添加 12 张资料/ }).hasAttribute('disabled')).toBe(true);
  });

  it('rolls back a partially decoded invalid batch and accepts the next queued valid selection', async () => {
    const rendered = renderUi();
    upload(rendered.container, [file('temporary.png'), new File(['svg'], 'invalid.svg', { type: 'image/svg+xml' })]);
    await screen.findByText('请选择 PNG、JPEG 或 WebP 图片。');
    expect(screen.queryByRole('img')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:temporary.png');
    upload(rendered.container, [file('valid.png')]);
    expect(await screen.findByRole('img', { name: '现场照片：valid.png' })).toBeTruthy();
  });

  it('clears photos and ignores pending decodes from a previous project, while allowing new project uploads', async () => {
    const rendered = renderUi();
    upload(rendered.container, [file('saved.png')]);
    await screen.findByRole('img', { name: '现场照片：saved.png' });
    let finish!: (value: ReturnType<typeof bitmap>) => void;
    decode.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    upload(rendered.container, [file('pending-old.png')]);
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    rendered.rerender(ui('20000000-0000-4000-8000-000000000002'));
    expect(screen.queryByRole('img')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:saved.png');
    upload(rendered.container, [file('new-project.png')]);
    await screen.findByRole('img', { name: '现场照片：new-project.png' });
    const oldBitmap = bitmap();
    await act(async () => { finish(oldBitmap); });
    expect(oldBitmap.close).toHaveBeenCalledOnce();
    expect(createObjectURL.mock.calls.map(call => call[0].name)).not.toContain('pending-old.png');
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });

  it('preserves provider photos when returning from the introduction without changing project', async () => {
    const rendered = renderUi();
    upload(rendered.container, [file('venue.png')]);
    await screen.findByRole('img', { name: '现场照片：venue.png' });
    rendered.rerender(ui(layout.id, true));
    rendered.rerender(ui(layout.id, false));
    expect(screen.getByRole('img', { name: '现场照片：venue.png' })).toBeTruthy();
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });
});
