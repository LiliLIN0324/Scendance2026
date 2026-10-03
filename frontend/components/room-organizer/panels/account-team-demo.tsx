'use client';

import { Check, FlaskConical, Plus, UsersRound } from 'lucide-react';
import { useState } from 'react';

type Role = 'owner' | 'editor' | 'viewer';
type Permission = 'view' | 'edit' | 'export' | 'publish' | 'members';
interface DemoMember { id: string; name: string; role: Role }
const roles: { id: Role; name: string; description: string }[] = [
  { id: 'owner', name: '负责人', description: '管理工作室与全部方案' },
  { id: 'editor', name: '编辑成员', description: '参与方案设计与交付' },
  { id: 'viewer', name: '查看成员', description: '查看方案与反馈沟通' },
];
const permissions: { id: Permission; name: string }[] = [
  { id: 'view', name: '查看项目' }, { id: 'edit', name: '编辑场景' }, { id: 'export', name: '导出方案' },
  { id: 'publish', name: '管理发布' }, { id: 'members', name: '管理成员' },
];
const initialMembers: DemoMember[] = [
  { id: 'demo-owner', name: '你（演示身份）', role: 'owner' },
  { id: 'demo-designer', name: '林雨舟', role: 'editor' },
  { id: 'demo-client', name: '许知夏', role: 'viewer' },
];
const initialPermissions: Record<Role, Permission[]> = {
  owner: ['view', 'edit', 'export', 'publish', 'members'], editor: ['view', 'edit', 'export'], viewer: ['view'],
};

export function AccountTeamDemo({ view }: { view: 'team' | 'permissions' }): JSX.Element {
  const [teamName, setTeamName] = useState('拾光活动工作室');
  const [members, setMembers] = useState(initialMembers);
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const [grants, setGrants] = useState(initialPermissions);
  const [previewRole, setPreviewRole] = useState<Role>('editor');
  const [notice, setNotice] = useState('');

  function reset(): void {
    setTeamName('拾光活动工作室'); setMembers(initialMembers); setGrants(initialPermissions);
    setName(''); setRole('editor'); setPreviewRole('editor'); setNotice('已恢复初始演示。');
  }

  return <section className="sc-account-demo" aria-label={view === 'team' ? '团队演示空间' : '权限演示空间'}>
    <div className="sc-account-demo-note"><FlaskConical size={18} aria-hidden="true"/><div><strong>演示空间</strong><p>成员均为虚构，设置仅在本次页面停留期间有效；不会发送邀请或改变真实云端权限。</p></div><button type="button" onClick={reset}>重置演示</button></div>
    {view === 'team' ? <>
      <div className="sc-account-section-heading"><div><h3>一起，把方案做好。</h3><p className="sc-cloud-muted">模拟一个小型活动团队，分配各自的角色。</p></div><span className="sc-cloud-badge">{members.length} 位演示成员</span></div>
      <div className="sc-account-team-grid"><section>
        <label className="sc-account-team-name">演示工作室名称<input maxLength={60} value={teamName} onChange={event => setTeamName(event.target.value)} /></label>
        <ul className="sc-account-members">{members.map(member => <li key={member.id}>
          <span className="sc-account-member-avatar" aria-hidden="true">{member.name.slice(0, 1)}</span><div><strong>{member.name}</strong><small>{member.role === 'owner' ? '工作室创建者 · 演示' : '虚构成员'}</small></div>
          <select aria-label={`${member.name}的演示角色`} disabled={member.role === 'owner'} value={member.role} onChange={event => {
            const nextRole = event.target.value as Role;
            setMembers(current => current.map(item => item.id === member.id ? { ...item, role: nextRole } : item));
            setNotice(`已更新「${member.name}」的演示角色。`);
          }}>{roles.filter(item => member.role === 'owner' || item.id !== 'owner').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          {member.role !== 'owner' ? <button type="button" aria-label={`移除演示成员${member.name}`} onClick={() => { setMembers(current => current.filter(item => item.id !== member.id)); setNotice(`已移除演示成员「${member.name}」。`); }}>移除</button> : <span className="sc-account-owner">固定</span>}
        </li>)}</ul>
      </section><form className="sc-account-invite" onSubmit={event => {
        event.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) { setNotice('请填写演示成员姓名。'); return; }
        if (members.some(member => member.name === trimmed)) { setNotice('已有同名演示成员，请换一个姓名。'); return; }
        setMembers(current => [...current, { id: crypto.randomUUID(), name: trimmed, role }]);
        setName(''); setNotice(`已添加演示成员「${trimmed}」，未发送邀请。`);
      }}><UsersRound size={25} aria-hidden="true"/><h3>试着添加一位队友</h3><p className="sc-cloud-muted">用虚构姓名体验团队管理。</p><label>演示成员姓名<input required maxLength={40} placeholder="例如：陈知远" value={name} onChange={event => setName(event.target.value)} /></label><label>加入角色<select value={role} onChange={event => setRole(event.target.value as Role)}><option value="editor">编辑成员</option><option value="viewer">查看成员</option></select></label><button className="sc-cloud-primary" type="submit"><Plus size={14} aria-hidden="true"/>添加演示成员</button></form></div>
    </> : <>
      <div className="sc-account-section-heading"><div><h3>让每个人，各司其职。</h3><p className="sc-cloud-muted">勾选角色可以执行的操作，即时查看演示结果。</p></div></div>
      <div className="sc-account-permission-grid"><div className="sc-account-permission-table"><table><caption>演示角色权限矩阵</caption><thead><tr><th scope="col">操作权限</th>{roles.map(item => <th scope="col" key={item.id}>{item.name}</th>)}</tr></thead><tbody>{permissions.map(permission => <tr key={permission.id}><th scope="row">{permission.name}</th>{roles.map(item => <td key={item.id}><input type="checkbox" aria-label={`${item.name}：${permission.name}`} checked={grants[item.id].includes(permission.id)} disabled={item.id === 'owner' || permission.id === 'view'} onChange={event => {
        const checked = event.target.checked;
        setGrants(current => ({ ...current, [item.id]: checked ? [...current[item.id], permission.id] : current[item.id].filter(id => id !== permission.id) }));
        setNotice(`演示权限已更新：${item.name}${checked ? '可以' : '不可'}${permission.name}。`);
      }} /></td>)}</tr>)}</tbody></table><p className="sc-cloud-muted">负责人保留全部权限，所有成员均可查看项目。</p></div>
      <aside className="sc-account-role-preview"><span className="sc-cloud-eyebrow">角色预览 · 仅演示</span><label>预览角色<select value={previewRole} onChange={event => setPreviewRole(event.target.value as Role)}>{roles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><p>{roles.find(item => item.id === previewRole)?.description}</p><ul>{permissions.map(permission => <li key={permission.id} data-allowed={grants[previewRole].includes(permission.id)}><span>{permission.name}</span>{grants[previewRole].includes(permission.id) ? <span><Check size={13} aria-hidden="true"/>允许</span> : <span>未开放</span>}</li>)}</ul><small>适用于 {members.filter(member => member.role === previewRole).length} 位演示成员</small></aside></div>
    </>}
    {notice && <p className="sc-cloud-message" role="status">{notice}</p>}
  </section>;
}
