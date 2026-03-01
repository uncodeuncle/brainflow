import { NextResponse } from 'next/server';

/**
 * POST - 生成二维码
 */
export async function POST() {
    try {
        const res = await fetch('https://passport.bilibili.com/x/passport-login/web/qrcode/generate', {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Referer': 'https://www.bilibili.com/',
            }
        });

        const json = await res.json();

        if (json.code !== 0) {
            return NextResponse.json({ error: 'Failed to generate QR code', detail: json }, { status: 500 });
        }

        return NextResponse.json({
            qrUrl: json.data.url,
            qrcodeKey: json.data.qrcode_key
        });

    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

/**
 * GET - 轮询扫码状态
 * 成功后把 SESSDATA 返回给前端（前端存 localStorage）
 */
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const qrcodeKey = searchParams.get('key');

    if (!qrcodeKey) {
        return NextResponse.json({ error: 'Missing qrcode key' }, { status: 400 });
    }

    try {
        const res = await fetch(
            `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${qrcodeKey}`,
            {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                    'Referer': 'https://www.bilibili.com/',
                }
            }
        );

        const json = await res.json();
        const code = json?.data?.code;

        // code: 0=成功, 86101=未扫码, 86090=已扫码待确认, 86038=过期
        if (code === 0) {
            // 从返回的 URL 参数中提取 SESSDATA
            const loginUrl = json.data.url;
            const urlParams = new URL(loginUrl).searchParams;
            const sessdata = decodeURIComponent(urlParams.get('SESSDATA') || '');

            return NextResponse.json({
                status: 'success',
                sessdata  // 返回给前端存 localStorage
            });
        }

        const statusMap: Record<number, string> = {
            86101: 'waiting',
            86090: 'scanned',
            86038: 'expired',
        };

        return NextResponse.json({
            status: statusMap[code] || 'unknown',
            code
        });

    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
