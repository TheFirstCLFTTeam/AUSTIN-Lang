import { MOCK_FILE_STORE } from './mock-data';

export async function fetchSubmittedFilesServer() {
    return MOCK_FILE_STORE.map(({ id, name, audioUrl, uploaded_at }) => ({
        id,
        name,
        audioUrl,
        uploaded_at,
        transcriptSegments: [],
    }));
}
