/**
 * SMS via Twilio. Env-gated: dry-run without credentials. Set
 * TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER to activate.
 */
export const isSmsConfigured = Boolean(
  process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER,
);

export async function sendSms(to: string, body: string): Promise<boolean> {
  if (!isSmsConfigured) {
    if (process.env.NODE_ENV !== 'production') console.log(`[sms] (dry-run) → ${to}: ${body}`);
    return false;
  }
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const from = process.env.TWILIO_PHONE_NUMBER!;

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: body.slice(0, 1600) }),
    });
    if (!res.ok) {
      console.error('[sms] send failed', res.status, await res.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (err) {
    console.error('[sms] send error', err);
    return false;
  }
}
