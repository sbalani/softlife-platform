export interface PushTokenSnapshot {
  id: string;
  token: string;
}

export interface PayoutPushInput {
  notificationId: string;
  title: string;
  body: string;
  href: string;
  data: Record<string, unknown>;
}

export function chunkPushTokens(tokens: PushTokenSnapshot[], size = 100) {
  if (!Number.isInteger(size) || size < 1 || size > 100) throw new Error("Invalid Expo chunk size");
  const chunks: PushTokenSnapshot[][] = [];
  for (let offset = 0; offset < tokens.length; offset += size) chunks.push(tokens.slice(offset, offset + size));
  return chunks;
}

export function buildPayoutPushPayload(input: PayoutPushInput, token: string) {
  return {
    to: token,
    sound: "default",
    title: input.title,
    body: input.body,
    data: { ...input.data, notificationId: input.notificationId, href: input.href },
    channelId: "payouts",
  };
}
