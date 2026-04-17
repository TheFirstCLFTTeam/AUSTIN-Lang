import { getServerUser } from '../../services/auth-server';
import SidebarShell from './components/SidebarShell';
import TopBar from './components/TopBar';
import CommandPalette from './components/CommandPalette';

export default async function DashboardLayout({ children }) {
    const user = await getServerUser();
    const userRole = user?.role || 'generic';

    return (
        <div
            className="min-h-screen flex"
            style={{ backgroundColor: '#fcf9f8' }}
        >
            <SidebarShell userRole={userRole} />

            <div className="flex-1 flex flex-col min-h-screen">
                <TopBar userRole={userRole} />
                <main className="flex-1 p-6">{children}</main>
            </div>

            <CommandPalette />
        </div>
    );
}
