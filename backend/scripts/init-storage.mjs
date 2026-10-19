import 'dotenv/config';
import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';

const client = new S3Client({
  endpoint: process.env.MINIO_ENDPOINT, region: 'us-east-1', forcePathStyle: true,
  credentials: { accessKeyId: process.env.MINIO_ACCESS_KEY, secretAccessKey: process.env.MINIO_SECRET_KEY },
});
try {
  for (const Bucket of [process.env.EVIDENCE_BUCKET || 'evidence', process.env.REPORTS_BUCKET || 'reports']) {
    try { await client.send(new HeadBucketCommand({ Bucket })); }
    catch (error) {
      if (error.$metadata?.httpStatusCode !== 404) throw error;
      await client.send(new CreateBucketCommand({ Bucket }));
    }
  }
  console.log('Private evidence and report buckets are ready.');
} finally { client.destroy(); }
