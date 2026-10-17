import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { CookieOptions, Response } from 'express';
import { z } from 'zod';
import { clientIp } from '../common/client-ip.js';
import { EmailInput } from '../common/email.js';
import { ZodPipe } from '../common/validation.js';
import { CONFIG, type Config } from '../config.js';
import { AuditService } from '../audit/audit.js';
import { AuthService } from './auth.service.js';
import {
  CurrentUser,
  GUEST_USER,
  GuestOk,
  Public,
  type AuthedRequest,
  type SessionUser,
} from './decorators.js';
import { SiteSettingsService } from '../site/site-settings.js';
import { MembershipService } from './membership.service.js';
import { GUEST_COOKIE, SESSION_COOKIE, SessionService } from './session.service.js';

const MagicLinkBody = z.object({ email: EmailInput });
const VerifyBody = z.object({ token: z.string().min(20).max(100) });
const LoginBody = z.object({
  email: EmailInput,
  password: z.string().min(1).max(200),
  code: z.string().trim().max(20).optional(),
});
const SetPasswordBody = VerifyBody.extend({ password: z.string().max(200) });
const ChangePasswordBody = z.object({
  current: z.string().max(200).default(''),
  password: z.string().max(200),
});
const CodeBody = z.object({ code: z.string().trim().min(6).max(20) });
const PasswordBody = z.object({ password: z.string().min(1).max(200) });
const TestLoginBody = z.object({
  email: EmailInput,
  code: z.string().min(1).max(64),
  name: z.string().trim().max(80).optional(),
});

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly memberships: MembershipService,
    private readonly site: SiteSettingsService,
    private readonly audit: AuditService,
  ) {}

  private get cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: this.sessions.ttlMs,
    };
  }

  /** Signing in for real ends being a guest. */
  private setSession(res: Response, token: string) {
    res.cookie(SESSION_COOKIE, token, this.cookieOptions);
    res.clearCookie(GUEST_COOKIE, { ...this.cookieOptions, maxAge: undefined });
  }

  /**
   * "Look around as a guest": read-only, public leagues only, nicknames and golf but no
   * personal details. 404 when no league is public.
   */
  @Public()
  @Post('guest')
  @HttpCode(200)
  async guest(@Res({ passthrough: true }) res: Response) {
    if (!(await this.memberships.guestsWelcome())) throw new NotFoundException();
    res.cookie(GUEST_COOKIE, '1', this.cookieOptions);
    res.clearCookie(SESSION_COOKIE, { ...this.cookieOptions, maxAge: undefined });
    return this.meFor({ ...GUEST_USER });
  }

  /** Always 202, whether or not the email can sign in. */
  @Public()
  @Post('magic-link')
  @HttpCode(202)
  async requestLink(
    @Body(new ZodPipe(MagicLinkBody)) body: z.infer<typeof MagicLinkBody>,
    @Req() req: AuthedRequest,
  ) {
    await this.auth.requestMagicLink(body.email, clientIp(req, this.config.CLIENT_IP_HEADER));
    return { ok: true };
  }

  /** Called by the web app's verify page when the user presses "Sign in". */
  @Public()
  @Post('verify')
  @HttpCode(200)
  async verify(
    @Body(new ZodPipe(VerifyBody)) body: z.infer<typeof VerifyBody>,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, token, csrfToken } = await this.auth.verifyMagicLink(
      body.token,
      clientIp(req, this.config.CLIENT_IP_HEADER),
      req.header('user-agent'),
    );
    this.setSession(res, token);
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        nickname: user.nickname,
        phone: user.phone,
        address: user.address,
        isSiteAdmin: user.isSiteAdmin,
      },
      csrfToken,
    };
  }

  private signedIn(
    res: Response,
    r: {
      user: {
        id: string;
        email: string;
        name: string | null;
        nickname: string | null;
        phone: string | null;
        address: string | null;
        isSiteAdmin: boolean;
      };
      token: string;
      csrfToken: string;
    },
  ) {
    this.setSession(res, r.token);
    const { id, email, name, nickname, phone, address, isSiteAdmin } = r.user;
    return {
      user: { id, email, name, nickname, phone, address, isSiteAdmin },
      csrfToken: r.csrfToken,
    };
  }

  /** Email and password; answers { needsCode: true } when the account also needs an authenticator code. */
  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(LoginBody)) body: z.infer<typeof LoginBody>,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.auth.login(
      body,
      clientIp(req, this.config.CLIENT_IP_HEADER),
      req.header('user-agent'),
    );
    return 'needsCode' in r ? r : this.signedIn(res, r);
  }

  /** Who a password link is for (doesn't use it up). */
  @Public()
  @Post('password-link/check')
  @HttpCode(200)
  checkPasswordLink(@Body(new ZodPipe(VerifyBody)) body: z.infer<typeof VerifyBody>) {
    return this.auth.checkPasswordLink(body.token);
  }

  /** Sets the password from an admin's link and signs in (or asks for an authenticator code). */
  @Public()
  @Post('password-link')
  @HttpCode(200)
  async setPassword(
    @Body(new ZodPipe(SetPasswordBody)) body: z.infer<typeof SetPasswordBody>,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.auth.setPasswordWithLink(
      body.token,
      body.password,
      clientIp(req, this.config.CLIENT_IP_HEADER),
      req.header('user-agent'),
    );
    return 'needsCode' in r ? r : this.signedIn(res, r);
  }

  @Get('security')
  security(@CurrentUser() user: SessionUser) {
    return this.auth.security(user);
  }

  @Post('password')
  @HttpCode(200)
  changePassword(
    @CurrentUser() user: SessionUser,
    @Body(new ZodPipe(ChangePasswordBody)) body: z.infer<typeof ChangePasswordBody>,
  ) {
    return this.auth.changePassword(user, body.current, body.password);
  }

  @Post('totp/start')
  @HttpCode(200)
  totpStart(@CurrentUser() user: SessionUser) {
    return this.auth.totpStart(user);
  }

  @Post('totp/enable')
  @HttpCode(200)
  totpEnable(
    @CurrentUser() user: SessionUser,
    @Body(new ZodPipe(CodeBody)) body: z.infer<typeof CodeBody>,
  ) {
    return this.auth.totpEnable(user, body.code);
  }

  @Post('totp/disable')
  @HttpCode(200)
  totpDisable(
    @CurrentUser() user: SessionUser,
    @Body(new ZodPipe(PasswordBody)) body: z.infer<typeof PasswordBody>,
  ) {
    return this.auth.totpDisable(user, body.password);
  }

  /** What the sign-in page should offer. */
  @Public()
  @Get('options')
  async options() {
    return {
      testLogin: await this.site.testLoginActive(),
      emailSignIn: this.config.MAIL_MODE !== 'off',
      passwordSignIn: true,
      guests: await this.memberships.guestsWelcome(),
    };
  }

  /** Testing mode: instant sign-in with the shared access code (404 when testing mode is off). */
  @Public()
  @Post('test-login')
  @HttpCode(200)
  async testLogin(
    @Body(new ZodPipe(TestLoginBody)) body: z.infer<typeof TestLoginBody>,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, token, csrfToken } = await this.auth.testLogin(
      body,
      clientIp(req, this.config.CLIENT_IP_HEADER),
      req.header('user-agent'),
    );
    this.setSession(res, token);
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        nickname: user.nickname,
        phone: user.phone,
        address: user.address,
        isSiteAdmin: user.isSiteAdmin,
      },
      csrfToken,
    };
  }

  @Get('me')
  @GuestOk()
  me(@CurrentUser() user: SessionUser) {
    return this.meFor(user);
  }

  private async meFor(user: SessionUser) {
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        nickname: user.nickname,
        phone: user.phone,
        address: user.address,
        isSiteAdmin: user.isSiteAdmin,
        isGuest: user.isGuest ?? false,
      },
      csrfToken: user.csrfToken,
      leagues: await this.memberships.leaguesFor(user),
    };
  }

  @Post('logout')
  @GuestOk({ post: true })
  @HttpCode(204)
  async logout(@CurrentUser() user: SessionUser, @Res({ passthrough: true }) res: Response) {
    res.clearCookie(GUEST_COOKIE, { ...this.cookieOptions, maxAge: undefined });
    if (user.isGuest) return;
    await this.sessions.revoke(user.sessionId);
    await this.audit.record({
      actorUserId: user.id,
      action: 'auth.logout',
      entityType: 'user',
      entityId: user.id,
    });
    res.clearCookie(SESSION_COOKIE, { ...this.cookieOptions, maxAge: undefined });
  }
}
