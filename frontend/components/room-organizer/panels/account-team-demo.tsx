'use client';

import { Check, Crown, Eye, Lock, Minus, PenTool, Plus, RotateCcw, Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { InfoTip } from './info-tip';

type Role = 'owner' | 'editor' | 'viewer';
type Permission = 'view' | 'edit' | 'export' | 'publish' | 'members';
interface DemoMember { id: string; name: string; contact: string; role: Role }
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
  { id: 'demo-owner', name: '你（演示身份）', contact: 'you@example.com', role: 'owner' },
  { id: 'demo-designer', name: '林雨舟', contact: 'lin.yuzhou@example.com', role: 'editor' },
  { id: 'demo-client', name: '许知夏', contact: '138 0000 0000', role: 'viewer' },
];
function normalizeContact(value: string): string {
  const trimmed = value.trim();
  return trimmed.includes('@') ? trimmed.toLowerCase() : trimmed.replace(/[\s-]/g, '');
}
function isContact(value: string): boolean {
  const normalized = normalizeContact(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || /^\+?\d{7,15}$/.test(normalized);
}
const initialPermissions: Record<Role, Permission[]> = {
  owner: ['view', 'edit', 'export', 'publish', 'members'],
  editor: ['view', 'edit', 'export', 'publish', 'members'],
  viewer: ['view', 'edit', 'export', 'publish', 'members'],
};
const roleIcons = { owner: Crown, editor: PenTool, viewer: Eye } as const;

function RoleIcon({ role }: { role: Role }): JSX.Element {
  const Icon = roleIcons[role];
  return <Icon size={16} aria-hidden="true" />;
}

export function AccountTeamDemo({ view }: { view: 'team' | 'permissions' }): JSX.Element {
  const [teamName, setTeamName] = useState('拾光活动工作室');
  const [members, setMembers] = useState(initialMembers);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const [grants, setGrants] = useState(initialPermissions);
  const [previewRole, setPreviewRole] = useState<Role>('editor');
  const [notice, setNotice] = useState('');

  function reset(): void {
    setTeamName('拾光活动工作室'); setMembers(initialMembers); setGrants(initialPermissions);
    setName(''); setContact(''); setRole('editor'); setPreviewRole('editor'); setNotice('已恢复初始演示。');
  }

  return <section className="sc-settings" aria-label={view === 'team' ? '团队演示空间' : '权限演示空间'}>
    {view === 'team' ? <>
      <header className="sc-settings-head">
        <div className="sc-settings-title"><h3>成员</h3><InfoTip key="team" label="演示说明"><strong>演示数据</strong><span>成员均为虚构，不会发送邀请；不影响真实权限。</span></InfoTip></div>
        <div className="sc-settings-tools"><span className="sc-settings-count">{members.length} 位演示成员</span><button className="sc-settings-icon-button" type="button" aria-label="重置演示" title="重置演示" onClick={reset}><RotateCcw size={15} aria-hidden="true"/></button></div>
      </header>
      <div className="sc-settings-group">
        <label className="sc-settings-row sc-settings-studio-row"><span className="sc-settings-row-main"><strong>工作室名称</strong></span><input className="sc-settings-input" aria-label="演示工作室名称" maxLength={60} value={teamName} onChange={event => setTeamName(event.target.value)} /></label>
        {members.map(member => <div className="sc-settings-row" key={member.id}>
          <span className="sc-settings-avatar" aria-hidden="true">{member.name.slice(0, 1)}</span>
          <div className="sc-settings-row-main"><strong>{member.name}</strong><small className="sc-settings-contact" title={member.contact}>{member.contact}</small></div>
          <div className="sc-settings-row-actions">
            {member.role === 'owner'
              ? <><span className="sc-settings-role-chip"><Crown size={12} aria-hidden="true"/>负责人</span><span className="sc-settings-lock" role="img" aria-label="工作室创建者，角色固定" title="工作室创建者，角色固定"><Lock size={14} aria-hidden="true"/></span></>
              : <><select className="sc-settings-select" aria-label={`${member.name}的演示角色`} value={member.role} onChange={event => {
                const nextRole = event.target.value as Role;
                setMembers(current => current.map(item => item.id === member.id ? { ...item, role: nextRole } : item));
                setNotice(`已更新「${member.name}」的演示角色。`);
              }}>{roles.filter(item => item.id !== 'owner').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="sc-settings-icon-button" type="button" aria-label={`移除演示成员${member.name}`} title="移除" onClick={() => { setMembers(current => current.filter(item => item.id !== member.id)); setNotice(`已移除演示成员「${member.name}」。`); }}><Trash2 size={15} aria-hidden="true"/></button></>}
          </div>
        </div>)}
        <form className="sc-settings-invite" onSubmit={event => {
          event.preventDefault();
          const trimmed = name.trim();
          const contactValue = contact.trim();
          if (!trimmed) { setNotice('请填写演示成员姓名。'); return; }
          if (!isContact(contactValue)) { setNotice('请填写邮箱或手机号，例如 name@example.com 或 138 0000 0000。'); return; }
          if (members.some(member => normalizeContact(member.contact) === normalizeContact(contactValue))) { setNotice('该邮箱或手机号已在演示团队中。'); return; }
          setMembers(current => [...current, { id: crypto.randomUUID(), name: trimmed, contact: contactValue, role }]);
          setName(''); setContact(''); setNotice(`已添加演示成员「${trimmed}」，未发送邀请。`);
        }}>
          <span className="sc-settings-invite-icon" aria-hidden="true"><UserPlus size={16}/></span>
          <label className="sc-settings-field"><span>姓名</span><input aria-label="演示成员姓名" required maxLength={40} placeholder="例如：陈知远" value={name} onChange={event => setName(event.target.value)} /></label>
          <label className="sc-settings-field"><span>邮箱或手机号</span><input aria-label="演示成员邮箱或手机号" required maxLength={80} placeholder="name@example.com 或 138 0000 0000" value={contact} onChange={event => setContact(event.target.value)} /></label>
          <label className="sc-settings-field"><span>角色</span><select value={role} onChange={event => setRole(event.target.value as Role)}><option value="editor">编辑成员</option><option value="viewer">查看成员</option></select></label>
          <button className="sc-cloud-primary sc-settings-add" type="submit"><Plus size={15} aria-hidden="true"/>添加演示成员</button>
        </form>
      </div>
    </> : <>
      <header className="sc-settings-head">
        <div className="sc-settings-title"><h3>角色权限</h3><InfoTip key="permissions" label="权限说明"><strong>功能默认开放 · 权限仅作演示</strong><span>只改变演示效果；不影响真实权限，也不限制编辑、Agent 或交付功能。</span></InfoTip></div>
        <div className="sc-settings-tools"><button className="sc-settings-icon-button" type="button" aria-label="重置演示" title="重置演示" onClick={reset}><RotateCcw size={15} aria-hidden="true"/></button></div>
      </header>
      <div className="sc-settings-permissions">
        <div className="sc-settings-group">
          {roles.map(roleItem => <div className="sc-settings-role" key={roleItem.id}>
            <header className="sc-settings-role-head"><span className="sc-settings-role-icon"><RoleIcon role={roleItem.id}/></span><div className="sc-settings-row-main"><strong>{roleItem.name}</strong><small>{roleItem.description}</small></div>{roleItem.id === 'owner' && <span className="sc-settings-lock" role="img" aria-label="角色固定" title="负责人权限固定"><Lock size={13} aria-hidden="true"/></span>}<span className="sc-settings-count is-chip">{members.filter(member => member.role === roleItem.id).length} 位</span></header>
            <ul className="sc-settings-perms">{permissions.map(permission => <li key={permission.id}>
              <label className="sc-settings-perm"><span>{permission.name}</span><span className="sc-switch"><input type="checkbox" aria-label={`${roleItem.name}：${permission.name}`} checked={grants[roleItem.id].includes(permission.id)} disabled={roleItem.id === 'owner' || permission.id === 'view'} onChange={event => {
                const checked = event.target.checked;
                setGrants(current => ({ ...current, [roleItem.id]: checked ? [...current[roleItem.id], permission.id] : current[roleItem.id].filter(id => id !== permission.id) }));
                setNotice(`演示权限已更新：${roleItem.name}${checked ? '可以' : '不可'}${permission.name}。`);
              }}/><i aria-hidden="true"/></span></label>
            </li>)}</ul>
          </div>)}
        </div>
        <aside className="sc-settings-preview">
          <span className="sc-cloud-eyebrow">角色预览</span>
          <label className="sc-settings-field"><span>预览角色</span><select value={previewRole} onChange={event => setPreviewRole(event.target.value as Role)}>{roles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <ul>{permissions.map(permission => <li key={permission.id} data-allowed={grants[previewRole].includes(permission.id)}><span>{permission.name}</span><span>{grants[previewRole].includes(permission.id) ? <><Check size={14} aria-hidden="true"/>允许</> : <><Minus size={14} aria-hidden="true"/>未开放</>}</span></li>)}</ul>
          <small>适用于 {members.filter(member => member.role === previewRole).length} 位演示成员</small>
        </aside>
      </div>
    </>}
    {notice && <p className="sc-cloud-message" role="status">{notice}</p>}
  </section>;
}
