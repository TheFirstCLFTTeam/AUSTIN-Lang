import { cookies } from 'next/headers';

export async function getServerUser() {
    const cookieStore = await cookies();
    const token = cookieStore.get('token')?.value;
    if (!token) return null;
    try {
        return JSON.parse(atob(token));
    } catch {
        return null;
    }
}
