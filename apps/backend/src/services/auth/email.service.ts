import nodemailer from "nodemailer";
import { EmailVerificationRepository } from "@/store/auth/email-verification.repository";
import type { EmailVerificationStore } from "@/store/auth/email-verification.store";
import { ConfigService } from "@/services/system/config.service";
import { BadRequestError } from "@/util/errors";
import { CustomCode } from "@/constant/custom-code";
import { getLogger, LogCategory } from "@/util/logger";

const logger = getLogger("EmailService", LogCategory.BUSINESS);

export class EmailService {
  private static instance: EmailService;

  private constructor(
    private readonly configService: ConfigService = ConfigService.getInstance(),
    private readonly emailVerificationRepository: EmailVerificationStore = EmailVerificationRepository.getInstance(),
  ) {}

  static getInstance(): EmailService {
    if (!EmailService.instance) EmailService.instance = new EmailService();

    return EmailService.instance;
  }

  async sendVerificationCode(email: string): Promise<void> {
    await this.sendCode(email, {
      subject: "邮箱验证码",
      title: "邮箱验证码",
      intro: "您的验证码是：",
      footer: "如果您没有请求此验证码，请忽略此邮件。",
    });
  }

  async sendLoginVerificationCode(email: string): Promise<void> {
    await this.sendCode(email, {
      subject: "登录验证验证码",
      title: "登录验证验证码",
      intro: "您正在进行登录验证，验证码是：",
      footer: "如果这不是您的操作，请立即修改密码并联系管理员。",
    });
  }

  async sendPasswordResetCode(email: string): Promise<void> {
    await this.sendCode(email, {
      subject: "找回密码验证码",
      title: "找回密码验证码",
      intro: "您正在重置密码，验证码是：",
      footer: "如果这不是您的操作，请立即忽略此邮件并检查账号安全。",
    });
  }

  private async sendCode(
    email: string,
    content: { subject: string; title: string; intro: string; footer: string },
  ): Promise<void> {
    const smtpConfig = await this.configService.getSmtpConfig();
    if (!smtpConfig.host) throw new BadRequestError("SMTP 未配置", CustomCode.SMTP_NOT_CONFIGURED);

    const regConfig = await this.configService.getRegistrationConfig();
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + regConfig.verificationCodeExpiry * 1000);

    await this.emailVerificationRepository.create(email, code, expiresAt);

    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      auth: { user: smtpConfig.user, pass: smtpConfig.password },
    });

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #333;">${content.title}</h2>
        <p>${content.intro}</p>
        <div style="background: #f5f5f5; padding: 15px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #333; border-radius: 8px;">
          ${code}
        </div>
        <p style="color: #666; margin-top: 15px;">验证码有效期为 ${Math.floor(regConfig.verificationCodeExpiry / 60)} 分钟，请尽快使用。</p>
        <p style="color: #999; font-size: 12px;">${content.footer}</p>
      </div>
    `;

    await transporter.sendMail({
      from: `"${smtpConfig.senderName}" <${smtpConfig.senderEmail}>`,
      to: email,
      subject: content.subject,
      html,
    });

    logger.info(`验证码已发送至 ${email}`);
  }

  async verifyCode(email: string, code: string): Promise<boolean> {
    const record = await this.emailVerificationRepository.findLatestValid(email, code);

    if (!record) return false;

    await this.emailVerificationRepository.markUsed(record.id);

    return true;
  }
}
