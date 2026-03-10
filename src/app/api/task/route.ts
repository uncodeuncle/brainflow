import { NextResponse } from 'next/server';
import { Queue } from 'bullmq';

// Configure the BullMQ queue instance pointing to the local Redis server
const extractQueue = new Queue('bili-extract', {
    connection: {
        host: '127.0.0.1',
        port: 6379,
    }
});

export async function POST(req: Request) {
    try {
        const data = await req.json();

        // items: array of selected P items to download
        // formats: object indicating what to output (markdown, marp, mermaid, downloadVideo)
        // url: original Bilibili URL to download from string
        let { items, formats, url, sessdata, type, rawData } = data;

        if (!items || items.length === 0) {
            return NextResponse.json({ error: 'No items selected' }, { status: 400 });
        }

        if (!url) {
            return NextResponse.json({ error: 'Source URL is missing' }, { status: 400 });
        }

        const extractCleanUrl = (rawInput: string): string => {
            const input = rawInput.trim();
            const match = input.match(/https?:\/\/[^\s\u4e00-\u9fa5\u3000-\u303F\uFF00-\uFFEF]+/i);
            if (match) return match[0];
            const domainBlock = input.match(/[a-zA-Z0-9][-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)/i);
            if (domainBlock) return 'https://' + domainBlock[0];
            return /^https?:\/\//i.test(input) ? input : 'https://' + input;
        };

        url = extractCleanUrl(url);

        // Add job to the queue
        const job = await extractQueue.add('process-video', {
            items,
            formats,
            url,
            sessdata,
            type,       // Injected local tag boundary
            rawData     // Injected local payload
        });

        return NextResponse.json({
            success: true,
            jobId: job.id,
            message: '任务已提交到后台处理队列'
        });

    } catch (error: any) {
        console.error("Task Queue Error:", error);
        return NextResponse.json(
            { error: 'Failed to submit task', details: error.message },
            { status: 500 }
        );
    }
}

// Polling endpoint to get job status
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('id');

    if (!jobId) {
        return NextResponse.json({ error: 'Job ID required' }, { status: 400 });
    }

    try {
        const job = await extractQueue.getJob(jobId);
        if (!job) {
            return NextResponse.json({ error: 'Job not found' }, { status: 404 });
        }

        const state = await job.getState();
        const progress = job.progress;
        const result = job.returnvalue;
        const failedReason = job.failedReason;
        const data = job.data;

        return NextResponse.json({
            id: job.id,
            state,
            progress,
            result,
            error: failedReason,
            originalData: data
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
