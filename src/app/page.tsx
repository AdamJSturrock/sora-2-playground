'use client';

import { CreationForm, type CreationFormData } from '@/components/creation-form';
import { RemixForm, type RemixFormData } from '@/components/remix-form';
import { VideoHistoryPanel } from '@/components/video-history-panel';
import { VideoOutput } from '@/components/video-output';
import { PasswordDialog } from '@/components/password-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { calculateVideoCost } from '@/lib/cost-utils';
import { db, type VideoRecord } from '@/lib/db';
import { useLiveQuery } from 'dexie-react-hooks';
import * as React from 'react';
import type { VideoJob, VideoMetadata } from '@/types/video';

const explicitModeClient = process.env.NEXT_PUBLIC_FILE_STORAGE_MODE;
const vercelEnvClient = process.env.NEXT_PUBLIC_VERCEL_ENV;
const isOnVercelClient = vercelEnvClient === 'production' || vercelEnvClient === 'preview';

let effectiveStorageModeClient: 'fs' | 'indexeddb';

if (explicitModeClient === 'fs') {
    effectiveStorageModeClient = 'fs';
} else if (explicitModeClient === 'indexeddb') {
    effectiveStorageModeClient = 'indexeddb';
} else if (isOnVercelClient) {
    effectiveStorageModeClient = 'indexeddb';
} else {
    effectiveStorageModeClient = 'fs';
}

console.log(
    `Client Effective Storage Mode: ${effectiveStorageModeClient} (Explicit: ${explicitModeClient || 'unset'}, Vercel Env: ${vercelEnvClient || 'N/A'})`
);

export default function HomePage() {
    const [mode, setMode] = React.useState<'create' | 'remix'>('create');
    const [isPasswordRequiredByBackend, setIsPasswordRequiredByBackend] = React.useState<boolean | null>(null);
    const [clientPasswordHash, setClientPasswordHash] = React.useState<string | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [isPasswordDialogOpen, setIsPasswordDialogOpen] = React.useState(false);
    const [passwordDialogContext, setPasswordDialogContext] = React.useState<'initial' | 'retry'>('initial');

    // Job tracking
    const [activeJobs, setActiveJobs] = React.useState<Map<string, VideoJob>>(new Map());
    const activeJobsRef = React.useRef(activeJobs);
    const [pollingInterval, setPollingInterval] = React.useState<NodeJS.Timeout | null>(null);
    const [currentJobId, setCurrentJobId] = React.useState<string | null>(null);
    const [videoSrcCache, setVideoSrcCache] = React.useState<Map<string, string>>(new Map());
    const [isSubmitting, setIsSubmitting] = React.useState(false);

    // Keep ref in sync with state
    React.useEffect(() => {
        activeJobsRef.current = activeJobs;
    }, [activeJobs]);

    // Memoize a stable key for active job IDs to trigger polling effect
    const activeJobIdsKey = React.useMemo(() => {
        const ids = Array.from(activeJobs.keys()).filter(id => !id.startsWith('temp_'));
        return ids.join('|');
    }, [activeJobs]);

    // Helper to save active job IDs to localStorage
    const saveActiveJobIds = React.useCallback((jobs: Map<string, VideoJob>) => {
        const activeIds = Array.from(jobs.keys()).filter(id => !id.startsWith('temp_'));
        localStorage.setItem('activeVideoJobs', JSON.stringify(activeIds));
    }, []);

    // History
    const [history, setHistory] = React.useState<VideoMetadata[]>([]);
    const [isInitialLoad, setIsInitialLoad] = React.useState(true);

    // Creation form state
    const [createModel, setCreateModel] = React.useState<'sora-2' | 'sora-2-pro'>('sora-2');
    const [createPrompt, setCreatePrompt] = React.useState('');
    const [createSize, setCreateSize] = React.useState('720x1280');
    const [createSeconds, setCreateSeconds] = React.useState(4);
    const [createInputReference, setCreateInputReference] = React.useState<File | null>(null);

    // Remix form state
    const [remixSourceVideoId, setRemixSourceVideoId] = React.useState('');
    const [remixPrompt, setRemixPrompt] = React.useState('');

    const allDbVideos = useLiveQuery<VideoRecord[] | undefined>(() => db.videos.toArray(), []);

    // Load history from localStorage
    React.useEffect(() => {
        try {
            const storedHistory = localStorage.getItem('soraVideoHistory');
            if (storedHistory) {
                const parsedHistory: VideoMetadata[] = JSON.parse(storedHistory);
                if (Array.isArray(parsedHistory)) {
                    setHistory(parsedHistory);
                } else {
                    console.warn('Invalid history data found in localStorage.');
                    localStorage.removeItem('soraVideoHistory');
                }
            }
        } catch (e) {
            console.error('Failed to load or parse history from localStorage:', e);
            localStorage.removeItem('soraVideoHistory');
        }
        setIsInitialLoad(false);
    }, []);

    // Save history to localStorage
    React.useEffect(() => {
        if (!isInitialLoad) {
            try {
                localStorage.setItem('soraVideoHistory', JSON.stringify(history));
            } catch (e) {
                console.error('Failed to save history to localStorage:', e);
            }
        }
    }, [history, isInitialLoad]);

    // Check password requirement
    React.useEffect(() => {
        const fetchAuthStatus = async () => {
            try {
                const response = await fetch('/api/auth-status');
                if (!response.ok) {
                    throw new Error('Failed to fetch auth status');
                }
                const data = await response.json();
                setIsPasswordRequiredByBackend(data.passwordRequired);
            } catch (error) {
                console.error('Error fetching auth status:', error);
                setIsPasswordRequiredByBackend(false);
            }
        };

        fetchAuthStatus();
        const storedHash = localStorage.getItem('clientPasswordHash');
        if (storedHash) {
            setClientPasswordHash(storedHash);
        }
    }, []);

    // Cleanup polling interval on unmount
    React.useEffect(() => {
        return () => {
            if (pollingInterval) {
                clearInterval(pollingInterval);
            }
        };
    }, [pollingInterval]);

    async function sha256Client(text: string): Promise<string> {
        const encoder = new TextEncoder();
        const data = encoder.encode(text);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
    }

    const handleSavePassword = async (password: string) => {
        if (!password.trim()) {
            setError('Password cannot be empty.');
            return;
        }
        try {
            const hash = await sha256Client(password);
            localStorage.setItem('clientPasswordHash', hash);
            setClientPasswordHash(hash);
            setError(null);
            setIsPasswordDialogOpen(false);
        } catch (e) {
            console.error('Error hashing password:', e);
            setError('Failed to save password due to a hashing error.');
        }
    };

    const handleOpenPasswordDialog = () => {
        setPasswordDialogContext('initial');
        setIsPasswordDialogOpen(true);
    };

    const getVideoSrc = React.useCallback(
        (id: string): string | undefined => {
            // Don't return video source for failed or processing videos
            const historyItem = history.find(h => h.id === id);
            if (historyItem?.status === 'failed' || historyItem?.status === 'processing') {
                return undefined;
            }

            // Check cache first
            if (videoSrcCache.has(id)) {
                return videoSrcCache.get(id);
            }

            // Check IndexedDB
            const record = allDbVideos?.find((vid) => vid.id === id);
            if (record?.blob) {
                const url = URL.createObjectURL(record.blob);
                // Don't set state during render - cache will be set when video is downloaded
                return url;
            }

            // Fallback to filesystem API
            return `/api/videos/${id}/content`;
        },
        [allDbVideos, videoSrcCache, history]
    );

    const getThumbnailSrc = React.useCallback(
        (id: string): string | undefined => {
            // Don't return thumbnail for failed or processing videos
            const historyItem = history.find(h => h.id === id);
            if (historyItem?.status === 'failed' || historyItem?.status === 'processing') {
                return undefined;
            }

            const record = allDbVideos?.find((vid) => vid.id === id);
            if (record?.thumbnail) {
                return URL.createObjectURL(record.thumbnail);
            }
            return `/api/videos/${id}/content?variant=thumbnail`;
        },
        [allDbVideos, history]
    );

    // Single polling interval for all active jobs
    React.useEffect(() => {
        // Get non-temp active jobs that are still processing
        const realJobs = Array.from(activeJobs.entries()).filter(
            ([id, job]) => !id.startsWith('temp_') && job.status !== 'completed' && job.status !== 'failed'
        );

        const hasActiveJobs = realJobs.length > 0;

        // Stop polling if no active jobs
        if (!hasActiveJobs) {
            if (pollingInterval) {
                console.log('No active jobs, stopping polling');
                clearInterval(pollingInterval);
                setPollingInterval(null);
            }
            return;
        }

        // Start polling if we don't have an interval yet
        if (!pollingInterval && hasActiveJobs) {
            console.log(`Starting polling for ${realJobs.length} active job(s)`);

            // Define the polling function
            const pollAllJobs = async () => {
                // Get current real jobs from ref (always latest) that are still processing
                const currentRealJobs = Array.from(activeJobsRef.current.entries()).filter(
                    ([id, job]) => !id.startsWith('temp_') && job.status !== 'completed' && job.status !== 'failed'
                );

                if (currentRealJobs.length === 0) {
                    console.log('No jobs to poll');
                    return;
                }

                // Poll each job sequentially
                for (const [jobId, job] of currentRealJobs) {
                    try {
                        const response = await fetch(`/api/videos/${jobId}`, {
                                headers: clientPasswordHash
                                    ? {
                                          'x-password-hash': clientPasswordHash
                                      }
                                    : {}
                            });

                            if (!response.ok) {
                                throw new Error(`Failed to fetch job status: ${response.statusText}`);
                            }

                            const jobUpdate: VideoJob = await response.json();
                            console.log(`Job ${jobId} status: ${jobUpdate.status}, progress: ${jobUpdate.progress}`);

                            // Update active jobs
                            setActiveJobs(prev => {
                                const existingJob = prev.get(jobId);
                                if (!existingJob) return prev;

                                const updatedJob = {
                                    ...jobUpdate,
                                    prompt: existingJob.prompt || jobUpdate.prompt,
                                    remix_of: existingJob.remix_of || jobUpdate.remix_of
                                };

                                const newJobs = new Map(prev);
                                newJobs.set(jobId, updatedJob);
                                return newJobs;
                            });

                            // Update history item with progress
                            setHistory(prev =>
                                prev.map(item => {
                                    if (item.id === jobId) {
                                        return {
                                            ...item,
                                            progress: jobUpdate.progress,
                                            status: jobUpdate.status === 'completed' ? 'completed' :
                                                   jobUpdate.status === 'failed' ? 'failed' : 'processing'
                                        };
                                    }
                                    return item;
                                })
                            );

                            if (jobUpdate.status === 'completed') {
                                // Remove from active jobs FIRST to prevent duplicate downloads
                                setActiveJobs(prev => {
                                    const newJobs = new Map(prev);
                                    newJobs.delete(jobId);
                                    saveActiveJobIds(newJobs);
                                    return newJobs;
                                });

                                // Download and store video (async, won't block next poll)
                                downloadAndStoreVideo({
                                    ...jobUpdate,
                                    prompt: job.prompt || jobUpdate.prompt,
                                    remix_of: job.remix_of || jobUpdate.remix_of
                                }).catch(err => {
                                    console.error(`Error downloading completed video ${jobId}:`, err);
                                    setError(err instanceof Error ? err.message : 'Failed to download video');
                                });
                            } else if (jobUpdate.status === 'failed') {
                                // Update history with error and remove cost
                                setHistory(prev =>
                                    prev.map(item => {
                                        if (item.id === jobId) {
                                            return {
                                                ...item,
                                                status: 'failed',
                                                error: jobUpdate.error?.message || 'Video generation failed',
                                                costDetails: null // No cost for failed videos
                                            };
                                        }
                                        return item;
                                    })
                                );
                                // Remove from active jobs
                                setActiveJobs(prev => {
                                    const newJobs = new Map(prev);
                                    newJobs.delete(jobId);
                                    saveActiveJobIds(newJobs);
                                    return newJobs;
                                });
                                setError(jobUpdate.error?.message || 'Video generation failed');
                            }
                    } catch (err) {
                        console.error(`Error polling job ${jobId}:`, err);
                        // Don't stop polling other jobs if one fails
                    }
                }
            };

            // Poll immediately on start
            pollAllJobs();

            // Then continue polling every 10 seconds
            const interval = setInterval(pollAllJobs, 10000);

            setPollingInterval(interval);
        }

        // Cleanup when effect re-runs or component unmounts
        // Note: Only clear if we're about to create a new one or unmounting
        return undefined;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeJobIdsKey, clientPasswordHash]);

    // Resume active jobs on initial load
    React.useEffect(() => {
        if (!isInitialLoad && history.length > 0) {
            // Check for active jobs and resume them
            const activeJobIds = JSON.parse(localStorage.getItem('activeVideoJobs') || '[]');
            const processingJobs = history.filter(
                item => item.status === 'processing' && activeJobIds.includes(item.id)
            );

            if (processingJobs.length > 0) {
                console.log(`Found ${processingJobs.length} active jobs to resume`);

                const restoredJobs = new Map<string, VideoJob>();

                processingJobs.forEach(item => {
                    console.log(`Resuming job: ${item.id}`);

                    // Recreate the job in activeJobs
                    const restoredJob: VideoJob = {
                        id: item.id,
                        object: 'video',
                        created_at: item.timestamp / 1000, // Convert to seconds
                        status: 'in_progress', // Will be updated by polling
                        model: item.model,
                        progress: item.progress || 0,
                        seconds: item.seconds.toString(),
                        size: item.size,
                        prompt: item.prompt,
                        remix_of: item.remix_of
                    };

                    restoredJobs.set(item.id, restoredJob);
                });

                // Set all restored jobs at once
                setActiveJobs(restoredJobs);

                console.log('Restored jobs will be picked up by the polling interval');
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isInitialLoad]);

    const downloadAndStoreVideo = async (job: VideoJob) => {
        console.log(`Downloading video for job: ${job.id}`);

        try {
            // Download video content
            const response = await fetch(`/api/videos/${job.id}/content`, {
                headers: clientPasswordHash
                    ? {
                          'x-password-hash': clientPasswordHash
                      }
                    : {}
            });

            if (!response.ok) {
                throw new Error(`Failed to download video: ${response.statusText}`);
            }

            const blob = await response.blob();
            const filename = `${job.id}.mp4`;

            // Download thumbnail proactively
            let thumbnailBlob: Blob | undefined;
            try {
                console.log(`Downloading thumbnail for video ${job.id}...`);
                const thumbnailResponse = await fetch(`/api/videos/${job.id}/content?variant=thumbnail`, {
                    headers: clientPasswordHash
                        ? {
                              'x-password-hash': clientPasswordHash
                          }
                        : {}
                });
                if (thumbnailResponse.ok) {
                    thumbnailBlob = await thumbnailResponse.blob();
                    console.log(`Downloaded thumbnail for video ${job.id}`);
                }
            } catch (err) {
                console.error(`Error downloading thumbnail for ${job.id}:`, err);
            }

            // Download spritesheet proactively (for future timeline scrubbing)
            try {
                console.log(`Downloading spritesheet for video ${job.id}...`);
                const spritesheetResponse = await fetch(`/api/videos/${job.id}/content?variant=spritesheet`, {
                    headers: clientPasswordHash
                        ? {
                              'x-password-hash': clientPasswordHash
                          }
                        : {}
                });
                if (spritesheetResponse.ok) {
                    await spritesheetResponse.blob();
                    console.log(`Downloaded spritesheet for video ${job.id}`);
                    // Spritesheet is saved to filesystem by the API endpoint
                    // We're not storing it in IndexedDB for now since it's mainly for future features
                }
            } catch (err) {
                console.error(`Error downloading spritesheet for ${job.id}:`, err);
            }

            // Store in IndexedDB if needed
            if (effectiveStorageModeClient === 'indexeddb') {
                await db.videos.put({
                    id: job.id,
                    filename,
                    blob,
                    thumbnail: thumbnailBlob,
                    created_at: job.created_at
                });
                console.log(`Saved video ${job.id} with thumbnail to IndexedDB`);

                // Create blob URL for immediate display
                const blobUrl = URL.createObjectURL(blob);
                setVideoSrcCache((prev) => new Map(prev).set(job.id, blobUrl));
            }

            // Calculate total duration from job creation to completion (created_at is Unix timestamp in seconds)
            const durationMs = Date.now() - job.created_at * 1000;

            // Update the existing history entry with completion data
            setHistory((prev) => {
                return prev.map((item) => {
                    if (item.id === job.id) {
                        // Update existing entry with completion data
                        return {
                            ...item,
                            durationMs,
                            storageModeUsed: effectiveStorageModeClient,
                            status: 'completed' as const
                        };
                    }
                    return item;
                });
            });
            console.log(`Video ${job.id} completed and history updated`);
        } catch (err) {
            console.error(`Error downloading video ${job.id}:`, err);
            setError(err instanceof Error ? err.message : 'Failed to download video');
        }
    };

    const handleCreateVideo = async (formData: CreationFormData) => {
        setError(null);
        setIsSubmitting(true);

        if (isPasswordRequiredByBackend && !clientPasswordHash) {
            setError('Password is required. Please configure the password by clicking the lock icon.');
            setPasswordDialogContext('initial');
            setIsPasswordDialogOpen(true);
            setIsSubmitting(false);
            return;
        }

        // Create a temporary job to show immediate feedback
        const tempId = `temp_${Date.now()}`;
        const tempJob: VideoJob = {
            id: tempId,
            object: 'video',
            created_at: Date.now() / 1000,
            status: 'queued',
            model: formData.model,
            progress: 0,
            seconds: formData.seconds.toString(),
            size: formData.size,
            prompt: formData.prompt
        };

        // Show temporary job immediately
        setActiveJobs((prev) => new Map(prev).set(tempId, tempJob));
        setCurrentJobId(tempId);

        try {
            const apiFormData = new FormData();
            if (isPasswordRequiredByBackend && clientPasswordHash) {
                apiFormData.append('passwordHash', clientPasswordHash);
            }

            apiFormData.append('model', formData.model);
            apiFormData.append('prompt', formData.prompt);
            apiFormData.append('size', formData.size);
            apiFormData.append('seconds', formData.seconds.toString());

            if (formData.input_reference) {
                apiFormData.append('input_reference', formData.input_reference);
            }

            console.log('Creating video job...');

            const response = await fetch('/api/videos', {
                method: 'POST',
                body: apiFormData
            });

            const result = await response.json();

            if (!response.ok) {
                if (response.status === 401 && isPasswordRequiredByBackend) {
                    setError('Unauthorized: Invalid or missing password. Please try again.');
                    setPasswordDialogContext('retry');
                    setIsPasswordDialogOpen(true);
                    return;
                }
                throw new Error(result.error || `API request failed with status ${response.status}`);
            }

            console.log('Video job created:', result);

            // Remove temporary job and add real job
            setActiveJobs((prev) => {
                const newJobs = new Map(prev);
                newJobs.delete(tempId);
                const job: VideoJob = {
                    ...result,
                    prompt: formData.prompt // Store the prompt with the job
                };
                newJobs.set(job.id, job);
                return newJobs;
            });

            const job: VideoJob = {
                ...result,
                prompt: formData.prompt
            };
            setCurrentJobId(job.id);

            // Calculate cost immediately
            const costDetails = calculateVideoCost({
                model: job.model,
                size: job.size,
                seconds: parseInt(job.seconds)
            });

            // Add to history immediately with queued status
            const newHistoryEntry: VideoMetadata = {
                id: job.id,
                timestamp: Date.now(),
                filename: `${job.id}.mp4`,
                storageModeUsed: effectiveStorageModeClient,
                durationMs: 0, // Will be updated when complete
                model: job.model,
                size: job.size,
                seconds: parseInt(job.seconds),
                prompt: formData.prompt,
                mode: 'create',
                costDetails,
                status: 'processing',
                progress: 0
            };

            setHistory((prev) => [newHistoryEntry, ...prev]);

            // Save active job IDs
            setActiveJobs((prev) => {
                const newJobs = new Map(prev).set(job.id, job);
                saveActiveJobIds(newJobs);
                return newJobs;
            });
            console.log(`Video ${job.id} added to history with queued status`);

            setIsSubmitting(false);
        } catch (err: unknown) {
            console.error('Error creating video:', err);
            const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred.';
            setError(errorMessage);

            // Remove temporary job on error
            setActiveJobs((prev) => {
                const newJobs = new Map(prev);
                newJobs.delete(tempId);
                return newJobs;
            });
            setCurrentJobId(null);
            setIsSubmitting(false);
        }
    };

    const handleRemixVideo = async (formData: RemixFormData) => {
        setError(null);
        setIsSubmitting(true);

        if (isPasswordRequiredByBackend && !clientPasswordHash) {
            setError('Password is required. Please configure the password by clicking the lock icon.');
            setPasswordDialogContext('initial');
            setIsPasswordDialogOpen(true);
            setIsSubmitting(false);
            return;
        }

        // Create a temporary job to show immediate feedback
        const tempId = `temp_${Date.now()}`;
        const tempJob: VideoJob = {
            id: tempId,
            object: 'video',
            created_at: Date.now() / 1000,
            status: 'queued',
            model: 'sora-2', // We'll update this with actual model from API
            progress: 0,
            seconds: '4', // Will be updated with actual value
            size: '720x1280', // Will be updated with actual value
            prompt: formData.prompt,
            remix_of: formData.source_video_id
        };

        // Show temporary job immediately
        setActiveJobs((prev) => new Map(prev).set(tempId, tempJob));
        setCurrentJobId(tempId);

        try {
            console.log(`Creating remix for video: ${formData.source_video_id}`);

            const response = await fetch(`/api/videos/${formData.source_video_id}/remix`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    prompt: formData.prompt,
                    passwordHash: clientPasswordHash
                })
            });

            const result = await response.json();

            if (!response.ok) {
                if (response.status === 401 && isPasswordRequiredByBackend) {
                    setError('Unauthorized: Invalid or missing password. Please try again.');
                    setPasswordDialogContext('retry');
                    setIsPasswordDialogOpen(true);
                    return;
                }
                throw new Error(result.error || `API request failed with status ${response.status}`);
            }

            console.log('Remix job created:', result);

            // Remove temporary job and add real job
            setActiveJobs((prev) => {
                const newJobs = new Map(prev);
                newJobs.delete(tempId);
                const job: VideoJob = {
                    ...result,
                    prompt: formData.prompt, // Store the remix prompt with the job
                    remix_of: formData.source_video_id // Preserve the source video reference
                };
                newJobs.set(job.id, job);
                return newJobs;
            });

            const job: VideoJob = {
                ...result,
                prompt: formData.prompt,
                remix_of: formData.source_video_id
            };
            setCurrentJobId(job.id);

            // Calculate cost immediately
            const costDetails = calculateVideoCost({
                model: job.model,
                size: job.size,
                seconds: parseInt(job.seconds)
            });

            // Add to history immediately with queued status
            const newHistoryEntry: VideoMetadata = {
                id: job.id,
                timestamp: Date.now(),
                filename: `${job.id}.mp4`,
                storageModeUsed: effectiveStorageModeClient,
                durationMs: 0, // Will be updated when complete
                model: job.model,
                size: job.size,
                seconds: parseInt(job.seconds),
                prompt: formData.prompt,
                mode: 'remix',
                costDetails,
                remix_of: formData.source_video_id,
                status: 'processing',
                progress: 0
            };

            setHistory((prev) => [newHistoryEntry, ...prev]);

            // Save active job IDs
            setActiveJobs((prev) => {
                const newJobs = new Map(prev).set(job.id, job);
                saveActiveJobIds(newJobs);
                return newJobs;
            });
            console.log(`Remix ${job.id} added to history with queued status`);

            setIsSubmitting(false);
        } catch (err: unknown) {
            console.error('Error creating remix:', err);
            const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred.';
            setError(errorMessage);

            // Remove temporary job on error
            setActiveJobs((prev) => {
                const newJobs = new Map(prev);
                newJobs.delete(tempId);
                return newJobs;
            });
            setCurrentJobId(null);
            setIsSubmitting(false);
        }
    };

    const handleHistorySelect = (item: VideoMetadata) => {
        console.log(`Selecting video from history: ${item.id}`);
        setCurrentJobId(item.id);

        // If job is still active, it's already tracked
        if (activeJobs.has(item.id)) {
            return;
        }

        // Create a job entry for display based on the item's actual status
        const jobForDisplay: VideoJob = {
            id: item.id,
            object: 'video',
            created_at: item.timestamp,
            status: item.status === 'failed' ? 'failed' : 'completed',
            model: item.model,
            progress: item.status === 'failed' ? (item.progress || 0) : 100,
            seconds: item.seconds.toString(),
            size: item.size,
            prompt: item.prompt,
            ...(item.error && { error: { message: item.error } }),
            ...(item.remix_of && { remix_of: item.remix_of })
        };

        setActiveJobs((prev) => new Map(prev).set(item.id, jobForDisplay));
    };

    const handleClearHistory = async () => {
        const confirmationMessage =
            effectiveStorageModeClient === 'indexeddb'
                ? 'Are you sure you want to clear the entire video history? This will delete all stored videos from your browser (IndexedDB) but will NOT delete them from OpenAI servers. This cannot be undone.'
                : 'Are you sure you want to clear the entire video history? This only clears your local history and does NOT delete videos from OpenAI servers. This cannot be undone.';

        if (window.confirm(confirmationMessage)) {
            setHistory([]);
            setCurrentJobId(null);
            setActiveJobs(new Map());
            setError(null);

            try {
                localStorage.removeItem('soraVideoHistory');
                console.log('Cleared history metadata from localStorage.');

                if (effectiveStorageModeClient === 'indexeddb') {
                    await db.videos.clear();
                    console.log('Cleared videos from IndexedDB.');
                    setVideoSrcCache(new Map());
                }
            } catch (e) {
                console.error('Failed during history clearing:', e);
                setError(`Failed to clear history: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
    };

    const handleDeleteVideo = async (item: VideoMetadata) => {
        console.log(`Deleting video: ${item.id}`);
        setError(null);

        try {
            // Only delete from storage/OpenAI if video was actually created (not failed)
            if (item.status !== 'failed') {
                if (effectiveStorageModeClient === 'indexeddb') {
                    await db.videos.where('id').equals(item.id).delete();
                    setVideoSrcCache((prev) => {
                        const next = new Map(prev);
                        next.delete(item.id);
                        return next;
                    });
                    console.log('Deleted video from IndexedDB');
                } else {
                    // Delete from filesystem and OpenAI via API
                    const response = await fetch(`/api/videos/${item.id}`, {
                        method: 'DELETE',
                        headers: clientPasswordHash
                            ? {
                                  'x-password-hash': clientPasswordHash
                              }
                            : {}
                    });

                    if (!response.ok) {
                        const result = await response.json();
                        throw new Error(result.error || 'Failed to delete video');
                    }
                    console.log('Deleted video from filesystem and OpenAI');
                }
            } else {
                console.log(`Skipping storage/OpenAI deletion for failed video ${item.id}`);
            }

            // Remove from history
            setHistory((prev) => prev.filter((v) => v.id !== item.id));

            // Clear if it's the current video
            if (currentJobId === item.id) {
                setCurrentJobId(null);
                setActiveJobs((prev) => {
                    const next = new Map(prev);
                    next.delete(item.id);
                    return next;
                });
            }
        } catch (err) {
            console.error('Error deleting video:', err);
            setError(err instanceof Error ? err.message : 'Failed to delete video');
        }
    };

    const handleSendToRemix = (videoId: string) => {
        console.log(`Sending video to remix: ${videoId}`);
        setRemixSourceVideoId(videoId);
        setMode('remix');
    };

    const handleDownloadVideo = async (videoId: string) => {
        console.log(`Downloading video: ${videoId}`);
        try {
            const url = getVideoSrc(videoId);
            if (!url) {
                throw new Error('Video source not found');
            }

            // Create a download link
            const a = document.createElement('a');
            a.href = url;
            a.download = `${videoId}.mp4`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch (err) {
            console.error('Error downloading video:', err);
            setError(err instanceof Error ? err.message : 'Failed to download video');
        }
    };

    const currentJob = currentJobId ? activeJobs.get(currentJobId) : null;
    const currentVideoSrc = currentJobId ? getVideoSrc(currentJobId) : null;
    const currentThumbnailSrc = currentJobId ? getThumbnailSrc(currentJobId) : null;

    const completedVideos = history
        .filter((item) => {
            // Check if we have the video available
            const job = activeJobs.get(item.id);
            return !job || job.status === 'completed';
        })
        .map((item) => ({
            id: item.id,
            prompt: item.prompt,
            model: item.model,
            size: item.size,
            seconds: item.seconds
        }));

    return (
        <main className='flex min-h-screen flex-col items-center bg-black p-4 text-white md:p-8 lg:p-12'>
            <PasswordDialog
                isOpen={isPasswordDialogOpen}
                onOpenChange={setIsPasswordDialogOpen}
                onSave={handleSavePassword}
                title={passwordDialogContext === 'retry' ? 'Password Required' : 'Configure Password'}
                description={
                    passwordDialogContext === 'retry'
                        ? 'The server requires a password, or the previous one was incorrect. Please enter it to continue.'
                        : 'Set a password to use for API requests.'
                }
            />
            <div className='w-full max-w-7xl space-y-6'>
                <div className='grid grid-cols-1 gap-6 lg:grid-cols-2'>
                    <div className='relative flex h-[70vh] min-h-[600px] flex-col lg:col-span-1'>
                        <div className={mode === 'create' ? 'block h-full w-full' : 'hidden'}>
                            <CreationForm
                                onSubmit={handleCreateVideo}
                                isLoading={isSubmitting}
                                currentMode={mode}
                                onModeChange={setMode}
                                isPasswordRequiredByBackend={isPasswordRequiredByBackend}
                                clientPasswordHash={clientPasswordHash}
                                onOpenPasswordDialog={handleOpenPasswordDialog}
                                model={createModel}
                                setModel={setCreateModel}
                                prompt={createPrompt}
                                setPrompt={setCreatePrompt}
                                size={createSize}
                                setSize={setCreateSize}
                                seconds={createSeconds}
                                setSeconds={setCreateSeconds}
                                inputReference={createInputReference}
                                setInputReference={setCreateInputReference}
                            />
                        </div>
                        <div className={mode === 'remix' ? 'block h-full w-full' : 'hidden'}>
                            <RemixForm
                                onSubmit={handleRemixVideo}
                                isLoading={isSubmitting}
                                currentMode={mode}
                                onModeChange={setMode}
                                isPasswordRequiredByBackend={isPasswordRequiredByBackend}
                                clientPasswordHash={clientPasswordHash}
                                onOpenPasswordDialog={handleOpenPasswordDialog}
                                sourceVideoId={remixSourceVideoId}
                                setSourceVideoId={setRemixSourceVideoId}
                                remixPrompt={remixPrompt}
                                setRemixPrompt={setRemixPrompt}
                                completedVideos={completedVideos}
                                getVideoSrc={getVideoSrc}
                            />
                        </div>
                    </div>
                    <div className='flex h-[70vh] min-h-[600px] flex-col lg:col-span-1'>
                        {error && (
                            <Alert variant='destructive' className='mb-4 border-red-500/50 bg-red-900/20 text-red-300'>
                                <AlertTitle className='text-red-200'>Error</AlertTitle>
                                <AlertDescription>{error}</AlertDescription>
                            </Alert>
                        )}
                        <VideoOutput
                            job={currentJob || null}
                            videoSrc={currentVideoSrc}
                            thumbnailSrc={currentThumbnailSrc}
                            isLoading={currentJob ? currentJob.status === 'queued' || currentJob.status === 'in_progress' : false}
                            onSendToRemix={handleSendToRemix}
                            onDownload={handleDownloadVideo}
                        />
                    </div>
                </div>

                <div className='min-h-[450px]'>
                    <VideoHistoryPanel
                        history={history}
                        activeJobs={activeJobs}
                        onSelectVideo={handleHistorySelect}
                        onClearHistory={handleClearHistory}
                        getVideoSrc={getVideoSrc}
                        getThumbnailSrc={getThumbnailSrc}
                        onDeleteItem={handleDeleteVideo}
                    />
                </div>
            </div>
        </main>
    );
}
