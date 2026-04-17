import { NextResponse } from 'next/server';

import { requireUser } from '@/server/route-helpers';
import { listProcessingJobs } from '@/server/processing-jobs';

export const GET = requireUser(async () => {
    return NextResponse.json(listProcessingJobs());
});
