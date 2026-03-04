import { NextResponse } from 'next/server';
import Sts, { AssumeRoleRequest } from '@alicloud/sts20150401';
import { Config } from '@alicloud/openapi-client';

export async function GET() {
    try {
        const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID;
        const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET;
        const roleArn = process.env.ALIYUN_STS_ROLE_ARN;
        const bucket = process.env.ALIYUN_OSS_BUCKET;
        const rawRegion = process.env.ALIYUN_OSS_REGION || ''; // e.g. oss-cn-shenzhen.aliyuncs.com
        const region = rawRegion.replace('.aliyuncs.com', '').trim(); // ali-oss SDK requires just 'oss-cn-shenzhen'

        if (!accessKeyId || !accessKeySecret || !roleArn || !bucket) {
            return NextResponse.json(
                { error: 'Server is missing Aliyun STS/OSS configurations.' },
                { status: 500 }
            );
        }

        const config = new Config({
            accessKeyId,
            accessKeySecret,
            endpoint: 'sts.aliyuncs.com'
        });
        const client = new Sts(config);

        const request = new AssumeRoleRequest({
            roleArn: roleArn,
            roleSessionName: 'BrainflowUploader',
            durationSeconds: 3600
        });

        const result = await client.assumeRole(request);
        const credentials = result.body?.credentials;

        if (!credentials) {
            return NextResponse.json(
                { error: 'Aliyun STS API returned unexpected response without credentials' },
                { status: 500 }
            );
        }

        return NextResponse.json({
            AccessKeyId: credentials.accessKeyId,
            AccessKeySecret: credentials.accessKeySecret,
            SecurityToken: credentials.securityToken,
            Expiration: credentials.expiration,
            region: region,
            bucket: bucket
        });
    } catch (error: any) {
        console.error('STS API Error:', error);
        return NextResponse.json(
            { error: 'Failed to generate STS token', details: error.message || error.data || 'Unknown Aliyun SDK error' },
            { status: 500 }
        );
    }
}
