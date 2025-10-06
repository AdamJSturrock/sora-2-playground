import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_API_BASE_URL
});

const outputDir = path.resolve(process.cwd(), 'generated-videos');

function sha256(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    console.log(`Received GET request to /api/videos/${id}`);

    if (!process.env.OPENAI_API_KEY) {
        console.error('OPENAI_API_KEY is not set.');
        return NextResponse.json({ error: 'Server configuration error: API key not found.' }, { status: 500 });
    }

    try {
        // Password authentication
        const authHeader = request.headers.get('x-password-hash');
        if (process.env.APP_PASSWORD) {
            if (!authHeader) {
                return NextResponse.json({ error: 'Unauthorized: Missing password hash.' }, { status: 401 });
            }
            const serverPasswordHash = sha256(process.env.APP_PASSWORD);
            if (authHeader !== serverPasswordHash) {
                return NextResponse.json({ error: 'Unauthorized: Invalid password.' }, { status: 401 });
            }
        }

        console.log(`Retrieving video status for: ${id}`);

        // Retrieve video job status
        const video = await openai.videos.retrieve(id);

        console.log(`Video ${id} status: ${video.status}, progress: ${video.progress}`);

        // Return job status
        return NextResponse.json({
            id: video.id,
            status: video.status,
            progress: video.progress ?? 0,
            model: video.model,
            size: video.size,
            seconds: video.seconds,
            created_at: video.created_at,
            object: video.object,
            error: video.error
        });
    } catch (error: unknown) {
        console.error(`Error retrieving video ${id}:`, error);

        let errorMessage = 'An unexpected error occurred.';
        let status = 500;

        if (error instanceof Error) {
            errorMessage = error.message;
            if (typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number') {
                status = error.status;
            }
        }

        return NextResponse.json({ error: errorMessage }, { status });
    }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    console.log(`Received DELETE request to /api/videos/${id}`);

    if (!process.env.OPENAI_API_KEY) {
        console.error('OPENAI_API_KEY is not set.');
        return NextResponse.json({ error: 'Server configuration error: API key not found.' }, { status: 500 });
    }

    try {
        // Password authentication
        const authHeader = request.headers.get('x-password-hash');
        if (process.env.APP_PASSWORD) {
            if (!authHeader) {
                return NextResponse.json({ error: 'Unauthorized: Missing password hash.' }, { status: 401 });
            }
            const serverPasswordHash = sha256(process.env.APP_PASSWORD);
            if (authHeader !== serverPasswordHash) {
                return NextResponse.json({ error: 'Unauthorized: Invalid password.' }, { status: 401 });
            }
        }

        console.log(`Deleting video: ${id}`);

        // Delete video from OpenAI
        const result = await openai.videos.delete(id);

        console.log(`Video ${id} deleted successfully from OpenAI`);

        // Delete local files from filesystem if they exist
        const effectiveStorageMode = process.env.NEXT_PUBLIC_FILE_STORAGE_MODE ||
            (process.env.VERCEL === '1' ? 'indexeddb' : 'fs');

        if (effectiveStorageMode === 'fs') {
            const filesToDelete = [
                `${id}_video.mp4`,
                `${id}_thumbnail.webp`,
                `${id}_spritesheet.jpg`
            ];

            for (const filename of filesToDelete) {
                const filepath = path.join(outputDir, filename);
                try {
                    await fs.unlink(filepath);
                    console.log(`Deleted local file: ${filepath}`);
                } catch (error: unknown) {
                    // File might not exist, which is fine
                    if (typeof error === 'object' && error !== null && 'code' in error && error.code !== 'ENOENT') {
                        console.error(`Error deleting ${filepath}:`, error);
                    }
                }
            }
        }

        return NextResponse.json(result);
    } catch (error: unknown) {
        console.error(`Error deleting video ${id}:`, error);

        let errorMessage = 'An unexpected error occurred.';
        let status = 500;

        if (error instanceof Error) {
            errorMessage = error.message;
            if (typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number') {
                status = error.status;
            }
        }

        return NextResponse.json({ error: errorMessage }, { status });
    }
}
