import { useState } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { LayoutDashboard, User, GraduationCap, PenLine, FolderOpen, Library, Compass, Menu, X } from 'lucide-react';
import AiStatusPill from '@/components/AiStatusPill';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/profile', label: 'My Profile', icon: User },
  { to: '/universities', label: 'Universities', icon: GraduationCap },
  { to: '/essay-builder', label: 'Essay Builder', icon: PenLine },
  { to: '/materials', label: 'Materials', icon: FolderOpen },
  { to: '/knowledge-base', label: 'Knowledge Base', icon: Library },
];

export default function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);

  const closeMobile = () => setMobileOpen(false);

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-40 flex items-center justify-between px-5 py-3.5 bg-card/80 backdrop-blur-md border-b border-border">
        <div className="flex items-center gap-2">
          <Compass className="w-5 h-5 text-accent" strokeWidth={2.2} />
          <span className="font-display text-lg font-semibold tracking-tight">Atlas</span>
        </div>
        <div className="flex items-center gap-2">
          <AiStatusPill />
          <button onClick={() => setMobileOpen(true)} className="p-2 -mr-2 text-foreground/70 hover:text-foreground transition">
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-foreground/30 backdrop-blur-sm" onClick={closeMobile} />
          <aside className="relative w-72 max-w-[80vw] bg-card border-r border-border flex flex-col animate-in slide-in-from-left duration-200">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2.5">
                <Compass className="w-5 h-5 text-accent" strokeWidth={2.2} />
                <span className="font-display text-lg font-semibold tracking-tight">Atlas</span>
              </div>
              <button onClick={closeMobile} className="p-2 -mr-2 text-foreground/60 hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" onClick={closeMobile}>
              {navItems.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.to === '/'}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                      isActive
                        ? 'bg-foreground text-background'
                        : 'text-foreground/60 hover:text-foreground hover:bg-muted'
                    }`
                  }>
                  <item.icon className="w-4.5 h-4.5" strokeWidth={2} />
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 flex-col border-r border-border bg-sidebar">
        <div className="flex items-center gap-2.5 px-6 py-6">
          <Compass className="w-6 h-6 text-accent" strokeWidth={2.2} />
          <div>
            <span className="font-display text-xl font-semibold tracking-tight block leading-none">Atlas</span>
            <span className="text-[11px] text-foreground/40 tracking-wide uppercase mt-1 block">Admissions Command Center</span>
          </div>
        </div>
        <nav className="flex-1 px-3 py-2 space-y-0.5">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-foreground text-background'
                    : 'text-foreground/55 hover:text-foreground hover:bg-muted'
                }`
              }>
              <item.icon className="w-[18px] h-[18px]" strokeWidth={2} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-6 py-5 border-t border-border space-y-3">
          <AiStatusPill />
          <p className="text-[11px] text-foreground/35 leading-relaxed">
            Your private workspace. All data is yours alone.
          </p>
        </div>
      </aside>

      {/* Main content */}
      <main className="lg:pl-64">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-8 lg:py-12">
          <Outlet />
        </div>
      </main>
    </div>
  );
}