import { NavLink } from 'react-router-dom';

const links = [
  { to: '/', label: 'Home', icon: '\u2302' },
  { to: '/org', label: 'Organization', icon: '\u25C8' },
  { to: '/chat', label: 'CEO Chat', icon: '\u25C9' },
  { to: '/channels', label: 'Channels', icon: '\u25A3' },
  { to: '/audit', label: 'Audit', icon: '\u25A7' },
];

interface SidebarProps {
  onNavigate?: () => void;
}

export function Sidebar({ onNavigate }: SidebarProps) {
  return (
    <nav className="w-56 h-full bg-slate-900 border-r border-slate-800 flex flex-col shrink-0">
      <div className="p-4 border-b border-slate-800">
        <h1 className="text-lg font-bold text-amber-500">Hive</h1>
        <p className="text-xs text-slate-500">Dashboard</p>
      </div>
      <div className="flex-1 py-2">
        {links.map(link => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.to === '/'}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                isActive
                  ? 'bg-slate-800 text-amber-500 border-r-2 border-amber-500'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`
            }
          >
            <span className="text-base">{link.icon}</span>
            {link.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
