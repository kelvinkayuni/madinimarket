import "server-only";

import nodemailer from "nodemailer";

function getGmailConfig() {
  const user = process.env.GMAIL_USER?.trim();
  const password = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, "");

  if (!user || !password) {
    throw new Error("Gmail SMTP environment variables are not configured.");
  }

  return { user, password };
}

function createTransporter() {
  const { user, password } = getGmailConfig();

  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass: password },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
}

export async function verifyGmailConnection() {
  const { user } = getGmailConfig();
  await createTransporter().verify();
  return user;
}

export async function sendGmailEmail({
  to,
  subject,
  text,
  html,
}: {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}) {
  const { user } = getGmailConfig();
  return createTransporter().sendMail({ from: user, to, subject, text, html });
}