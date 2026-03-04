declare module '@alicloud/sts-sdk' {
    export default class StsClient {
        constructor(options: { endpoint: string; accessKeyId: string; accessKeySecret: string });
        assumeRole(roleArn: string, roleSessionName: string, policy: string | undefined, durationSeconds: number): Promise<any>;
    }
}
