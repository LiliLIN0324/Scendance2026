// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {RoomEditorProvider,type RoomEditorContextValue} from '../contexts/room-editor-context';
import {SelectionProvider,type SelectionContextValue} from '../contexts/selection-context';
import {makeFloor,makeLayout,makeViewSettings} from '../lib/__testfixtures__/fixtures';
import type {RoomLayout} from '../lib/types';
import {ScendanceViewTools} from './scendance-workspace';
afterEach(cleanup);
function show(layout:RoomLayout,index=0){const addFloor=vi.fn(),setActiveFloorIndex=vi.fn(),setView=vi.fn();
 const editor={layout,activeFloor:layout.floors[index]!,activeFloorIndex:index,view:makeViewSettings(),actions:{addFloor,setActiveFloorIndex},history:{},setView,toggle:vi.fn()} as unknown as RoomEditorContextValue;
 const selection={selectedItemId:null,selectedItem:null,allSelectedIds:new Set(),extraSelectedIds:new Set(),setSelectedItemId:vi.fn(),setExtraSelectedIds:vi.fn(),selectOnly:vi.fn()} as unknown as SelectionContextValue;
 render(<RoomEditorProvider value={editor}><SelectionProvider value={selection}><ScendanceViewTools onZoom={vi.fn()}/></SelectionProvider></RoomEditorProvider>);
 return {addFloor,setActiveFloorIndex,setView};}
it('disables V2 floor creation and displays the reason without changing the view',()=>{
 const layout=makeLayout();layout.backendSceneV2={} as NonNullable<RoomLayout['backendSceneV2']>;
 const {addFloor,setView}=show(layout);const reason='当前结构场景暂不支持新增、删除或调整楼层。';
 const button=screen.getByRole('button',{name:reason}) as HTMLButtonElement;
 expect(button.disabled).toBe(true);expect(screen.getByRole('note').textContent).toBe(reason);
 fireEvent.click(button);expect(addFloor).not.toHaveBeenCalled();expect(setView).not.toHaveBeenCalled();
});
it('keeps normal floor creation for ordinary scenes and navigation to an existing V2 floor',()=>{
 const normal=show(makeLayout());fireEvent.click(screen.getByRole('button',{name:'新建并切换到第 2 层'}));expect(normal.addFloor).toHaveBeenCalledOnce();
 cleanup();const layout=makeLayout({floors:[makeFloor({id:'one'}),makeFloor({id:'two'})]});layout.backendSceneV2={} as NonNullable<RoomLayout['backendSceneV2']>;
 const v2=show(layout);fireEvent.click(screen.getByRole('button',{name:'切换到第 2 层'}));expect(v2.setActiveFloorIndex).toHaveBeenCalledWith(1);expect(v2.addFloor).not.toHaveBeenCalled();
});
