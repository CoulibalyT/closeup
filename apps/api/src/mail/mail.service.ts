import { Injectable, Logger } from '@nestjs/common';
import { brand } from '@closeup/shared';
import { createTransport, type Transporter } from 'nodemailer';
import { AppConfig } from '../config/app-config.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

const RESET_MAIL = {
  fr: (name: string, link: string) => ({
    subject: `${name} : choisir un nouveau mot de passe`,
    text: `Bonjour,\n\nPour choisir un nouveau mot de passe, ouvre ce lien dans l'heure qui vient :\n${link}\n\nSi tu n'as rien demandé, ignore ce message : ton mot de passe ne change pas.\n\n${name}`,
  }),
  en: (name: string, link: string) => ({
    subject: `${name}: choose a new password`,
    text: `Hello,\n\nTo choose a new password, open this link within the hour:\n${link}\n\nIf you did not ask for it, ignore this message: your password does not change.\n\n${name}`,
  }),
};

const VERIFY_MAIL = {
  fr: (name: string, link: string) => ({
    subject: `${name} : confirme ton adresse`,
    text: `Bonjour,\n\nPour confirmer que cette adresse est bien la tienne, ouvre ce lien dans l'heure qui vient :\n${link}\n\nSi tu n'as pas de compte chez nous, ignore ce message.\n\n${name}`,
  }),
  en: (name: string, link: string) => ({
    subject: `${name}: confirm your address`,
    text: `Hello,\n\nTo confirm that this address is yours, open this link within the hour:\n${link}\n\nIf you have no account with us, ignore this message.\n\n${name}`,
  }),
};

/**
 * Plain-text e-mail through whatever SMTP server `SMTP_URL` names. Without one, nothing is sent:
 * in development the message is printed in the API log (so the reset link can be followed), in
 * production it is dropped with a warning. The caller never learns which: see the forgot flow.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  private readonly transport: Transporter | null;

  constructor(private readonly config: AppConfig) {
    const { SMTP_URL } = config.env;
    this.transport = SMTP_URL ? createTransport(SMTP_URL) : null;
  }

  async send(mail: Mail): Promise<void> {
    if (!this.transport) {
      if (this.config.env.NODE_ENV === 'production') {
        this.logger.warn('SMTP_URL is not set: an e-mail was not sent');
      } else this.logger.log(`(no SMTP) to ${mail.to}: ${mail.subject}\n${mail.text}`);
      return;
    }
    try {
      await this.transport.sendMail({ from: this.config.env.MAIL_FROM, ...mail });
    } catch (error) {
      this.logger.error(`E-mail to ${mail.to} failed: ${String(error)}`);
    }
  }

  passwordReset(to: string, locale: string, token: string): Promise<void> {
    const template = locale === 'en' ? RESET_MAIL.en : RESET_MAIL.fr;
    return this.send({ to, ...template(this.name, this.link('/account/reset', token)) });
  }

  verifyEmail(to: string, locale: string, token: string): Promise<void> {
    const template = locale === 'en' ? VERIFY_MAIL.en : VERIFY_MAIL.fr;
    return this.send({ to, ...template(this.name, this.link('/account/verify', token)) });
  }

  private get name(): string {
    return process.env.CLOSEUP_DISPLAY_NAME || brand.displayName;
  }

  private link(path: string, token: string): string {
    return `${this.config.env.PUBLIC_WEB_URL}${path}?token=${encodeURIComponent(token)}`;
  }
}
