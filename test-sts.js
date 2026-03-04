require('dotenv').config();
const StsClient = require('@alicloud/sts-sdk');

(async () => {
    try {
        const sts = new StsClient({
            endpoint: 'sts.aliyuncs.com',
            accessKeyId: process.env.ALIYUN_ACCESS_KEY_ID,
            accessKeySecret: process.env.ALIYUN_ACCESS_KEY_SECRET,
        });

        const policy = {
            Statement: [
                {
                    Action: ['oss:PutObject', 'oss:PostObject'],
                    Effect: 'Allow',
                    Resource: [`arn:acs:oss:*:*:${process.env.ALIYUN_OSS_BUCKET}/brainflow-raw/*`]
                }
            ],
            Version: '1'
        };

        console.log('RoleArn:', process.env.ALIYUN_STS_ROLE_ARN);
        console.log('AccessKey:', process.env.ALIYUN_ACCESS_KEY_ID);

        const result = await sts.assumeRole(
            process.env.ALIYUN_STS_ROLE_ARN,
            'BrainflowUploader',
            undefined,
            3600
        );

        console.log(JSON.stringify(result, null, 2));
    } catch (err) {
        console.error('STS API ERROR!', err);
        console.log('Raw message:', err.message);
        console.log('Data:', err.data);
    }
})();
