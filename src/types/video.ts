import { CostDetails } from '@/lib/cost-utils';

export type VideoJob = {
    id: string;
    object: 'video';
    created_at: number;
    status: 'queued' | 'in_progress' | 'completed' | 'failed';
    model: 'sora-2' | 'sora-2-pro';
    progress: number; // 0-100
    seconds: string;
    size: string;
    prompt?: string;
    error?: {
        message: string;
        code?: string;
    };
    remix_of?: string;
};

export type VideoMetadata = {
    id: string;
    timestamp: number;
    filename: string;
    storageModeUsed?: 'fs' | 'indexeddb';
    durationMs: number;
    model: 'sora-2' | 'sora-2-pro';
    size: string;
    seconds: number;
    prompt: string;
    mode: 'create' | 'remix';
    costDetails: CostDetails | null;
    remix_of?: string;
    status?: 'processing' | 'completed' | 'failed';
    error?: string;
    progress?: number;
};

export type VideoJobCreate = {
    model: 'sora-2' | 'sora-2-pro';
    prompt: string;
    size: string;
    seconds: number;
    input_reference?: File;
};
