import {
  Body,
  Controller,
  Delete,
  Get,
  Global,
  Headers,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Module,
  Post,
} from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import webpush from 'web-push';
import { z } from 'zod';
import { CurrentUser, type SessionUser } from '../auth/decorators.js';
import { ZodPipe } from '../common/validation.js';
import { CONFIG, type Config } from '../config.js';
import { DB, type Database } from '../db/db.js';
import { pushSubscriptions } from '../db/schema.js';

/** What a notification shows, and the page it opens when tapped. */
export interface PushMessage {
  title: string;
  body: string;
  url: string;
}

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Delivers one message to one browser; tests swap in a fake. Throws with statusCode on failure. */
export interface PushSender {
  send(target: PushTarget, payload: string): Promise<void>;
}
export const PUSH_SENDER = Symbol('PUSH_SENDER');

/** The real sender: web push with the VAPID keys, or nothing when they aren't set. */
export function webPushSender(config: Config): PushSender | null {
  if (!config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY) return null;
  const vapid = {
    subject: config.APP_URL,
    publicKey: config.VAPID_PUBLIC_KEY,
    privateKey: config.VAPID_PRIVATE_KEY,
  };
  return {
    async send(target, payload) {
      // An hour is plenty: a notice older than that is in the app anyway.
      await webpush.sendNotification(target, payload, { vapidDetails: vapid, TTL: 3600 });
    },
  };
}

const Subscription = z.object({
  endpoint: z.url().max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});
const Endpoint = z.object({ endpoint: z.url().max(1000) });

/**
 * Push notifications to the phones and computers where people turned them on. Only people who
 * said yes on a device get anything. Sending never blocks or fails the action that caused it.
 */
@Injectable()
export class PushService {
  private readonly log = new Logger('Push');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(PUSH_SENDER) private readonly sender: PushSender | null,
  ) {}

  /** The key browsers subscribe with, or null when push isn't set up on this server. */
  publicKey() {
    return this.sender ? (this.config.VAPID_PUBLIC_KEY ?? null) : null;
  }

  async subscribe(user: SessionUser, sub: z.infer<typeof Subscription>, userAgent?: string) {
    const row = {
      userId: user.id,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      userAgent: userAgent?.slice(0, 300) ?? null,
    };
    // A browser that someone else used before now belongs to whoever is signed in.
    await this.db
      .insert(pushSubscriptions)
      .values(row)
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: row });
    return { ok: true };
  }

  async unsubscribe(user: SessionUser, endpoint: string) {
    const [sub] = await this.db
      .select({ userId: pushSubscriptions.userId })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint))
      .limit(1);
    if (sub?.userId === user.id)
      await this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    return { ok: true };
  }

  /** Sends to everyone who has push on anywhere (site-wide notices). */
  async sendToEveryone(message: PushMessage) {
    if (!this.sender) return { sent: 0 };
    const rows = await this.db
      .selectDistinct({ userId: pushSubscriptions.userId })
      .from(pushSubscriptions);
    return this.send(
      rows.map((r) => r.userId),
      message,
    );
  }

  /** Sends to every device of these people. Devices the push service says are gone are removed. */
  async send(userIds: string[], message: PushMessage) {
    if (!this.sender || !userIds.length) return { sent: 0 };
    try {
      const subs = await this.db
        .select()
        .from(pushSubscriptions)
        .where(inArray(pushSubscriptions.userId, [...new Set(userIds)]));
      const payload = JSON.stringify(message);
      let sent = 0;
      await Promise.all(
        subs.map(async (s) => {
          try {
            await this.sender!.send(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              payload,
            );
            sent++;
            await this.db
              .update(pushSubscriptions)
              .set({ lastSentAt: new Date() })
              .where(eq(pushSubscriptions.id, s.id));
          } catch (err) {
            const status = (err as { statusCode?: number }).statusCode;
            if (status === 404 || status === 410)
              await this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
            else this.log.warn(`Push failed (${status ?? 'no status'}): ${String(err)}`);
          }
        }),
      );
      return { sent };
    } catch (err) {
      this.log.error(`Push failed: ${String(err)}`);
      return { sent: 0 };
    }
  }
}

@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('key')
  key() {
    return { publicKey: this.push.publicKey() };
  }

  @Post('subscriptions')
  @HttpCode(200)
  subscribe(
    @CurrentUser() user: SessionUser,
    @Body(new ZodPipe(Subscription)) body: z.infer<typeof Subscription>,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.push.subscribe(user, body, userAgent);
  }

  @Delete('subscriptions')
  unsubscribe(
    @CurrentUser() user: SessionUser,
    @Body(new ZodPipe(Endpoint)) body: z.infer<typeof Endpoint>,
  ) {
    return this.push.unsubscribe(user, body.endpoint);
  }
}

@Global()
@Module({
  controllers: [PushController],
  providers: [PushService, { provide: PUSH_SENDER, inject: [CONFIG], useFactory: webPushSender }],
  exports: [PushService],
})
export class PushModule {}
