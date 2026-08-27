import { Readable } from "node:stream";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AppConfigService } from "../config/app-config.service";

/**
 * The bytes behind the embedded provider's uploads. Only `IdpModule` has one:
 * an instance that delegates identity to somebody else holds no blobs, the way
 * it holds no identities — docs/ARCHITECTURE.md § "Local-only mode".
 *
 * S3 is the wire this speaks, because syr's own store speaks it; the bucket is
 * private throughout and nothing outside this file is told a key.
 */
@Injectable()
export class BlobStore implements OnApplicationBootstrap {
  private readonly logger = new Logger(BlobStore.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: AppConfigService) {
    const store = config.objectStore;
    this.bucket = store.bucket;
    this.client = new S3Client({
      endpoint: store.endpoint,
      region: store.region,
      // MinIO addresses a bucket by path; the virtual-host form resolves a
      // hostname that only a real S3 deployment publishes.
      forcePathStyle: true,
      credentials: {
        accessKeyId: store.accessKeyId,
        secretAccessKey: store.secretAccessKey,
      },
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(
          new CreateBucketCommand({ Bucket: this.bucket }),
        );
      } catch (error) {
        this.logger.warn(
          `Could not open the file store: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  }

  async put(
    key: string,
    contentType: string,
    bytes: Uint8Array,
  ): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ContentType: contentType,
          ContentLength: bytes.byteLength,
          Body: bytes,
        }),
      );
    } catch (error) {
      this.logger.warn(
        `${key} could not be written: ${error instanceof Error ? error.message : error}`,
      );
      throw new ServiceUnavailableException(
        "That file could not be saved. Try again.",
      );
    }
  }

  /** `null` where the object is not there, which a caller reports as a missing
   *  file rather than as a store that is down. */
  async open(
    key: string,
  ): Promise<{ body: Readable; size?: number; contentType?: string } | null> {
    let stored: GetObjectCommandOutput;
    try {
      stored = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        ?.$metadata?.httpStatusCode;
      if (status === 404) return null;
      this.logger.warn(
        `${key} could not be read: ${error instanceof Error ? error.message : error}`,
      );
      throw new ServiceUnavailableException(
        "That file could not be opened. Try again.",
      );
    }
    if (!(stored.Body instanceof Readable)) return null;
    return {
      body: stored.Body,
      size: stored.ContentLength,
      contentType: stored.ContentType,
    };
  }

  async remove(key: string): Promise<void> {
    await this.client
      .send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
      .catch((error: unknown) => {
        this.logger.warn(
          `${key} could not be removed: ${error instanceof Error ? error.message : error}`,
        );
      });
  }
}
