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

        // --- Final Defensive Sanitization before Redis ---
        const extractCleanUrl = (rawInput: string): string => {
            const input = rawInput.trim();
            const urlStartIndex = input.search(/https?:\/\//i);
            if (urlStartIndex !== -1) {
                const substring = input.slice(urlStartIndex);
                // Strip only whitespace, standard Chinese characters, and full-width punctuation
                const match = substring.match(/^([^\s\u4e00-\u9fa5\u3000-\u303F\uFF00-\uFFEF]+)/);
                if (match && match[1]) return match[1];
            }
            // Fallback: If no http found, guess the domain block and prepend https://
            const fallbackMatch = input.match(/^([^\s\u4e00-\u9fa5\u3000-\u303F\uFF00-\uFFEF]+)/);
            const domain = fallbackMatch ? fallbackMatch[1] : input;
            return /^https?:\/\//i.test(domain) ? domain : 'https://' + domain;
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
