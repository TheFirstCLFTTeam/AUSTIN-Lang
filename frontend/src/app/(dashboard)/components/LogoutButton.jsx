'use client';

import { useRouter } from 'next/navigation';
import { logout } from '../../../services/api';

export default function LogoutButton() {
    const router = useRouter();

    const handleLogout = () => {
        logout();
        router.push('/login');
    };

    return (
        <button
            onClick={handleLogout}
            className="text-[0.8125rem] font-medium cursor-pointer"
            style={{ backgroundColor: 'transparent', border: 'none', color: '#b20100' }}
        >
            Logout
        </button>
    );
}
