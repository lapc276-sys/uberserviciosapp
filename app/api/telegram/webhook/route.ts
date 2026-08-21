import { NextResponse } from 'next/server';
import { ROOM_LABELS, type RoomType } from '@/lib/vision/types';
import { parseActivity, HELP_TEXT } from '@/lib/activity/commands';
import {
  cancelSession,
  closeOpenSegment,
  endSession,
  openSession,
  startRoom,
  startSession,
  type Session,
} from '@/lib/activity/store';
import {
  downloadFile,
  hasAllowlist,
  isChatAllowed,
  isTelegramConfigured,
  sendMessage,
  transcribe,
  verifyWebhookSecret,
} from '@/lib/telegram';

/**
 * The field time logger.
 *
 * Someone walks into a kitchen, says "cocina", and a clock starts. They say
 * "baño" and the kitchen closes with a real duration. At the end they get a
 * breakdown per room. That breakdown is the label the time model has never
 * had: today a job produces one total, which proves the estimate was wrong
 * without saying which room made it wrong.
 *
 * Always answers 200. Telegram retries any other status, and a retry would
 * replay the command and log the same room twice.
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

const ok = () => NextResponse.json({ ok: true });

interface TelegramUpdate {
  message?: {
    chat?: { id?: number | string };
    text?: string;
    voice?: { file_id?: string };
    audio?: { file_id?: string };
  };
}

function label(room: string): string {
  return ROOM_LABELS[room as RoomType] ?? room;
}

function summarise(session: Session): string {
  const closed = session.segments.filter((s) => typeof s.minutes === 'number');
  if (closed.length === 0) return 'No quedó ninguna habitación registrada.';

  const lines = closed.map((s) => `• ${label(s.roomType)} — <b>${s.minutes} min</b>${s.task ? ` (${s.task})` : ''}`);
  const total = closed.reduce((sum, s) => sum + (s.minutes ?? 0), 0);
  const hours = Math.floor(total / 60);
  const mins = total % 60;

  return [
    session.label ? `<b>${session.label}</b>` : '<b>Trabajo terminado</b>',
    ...lines,
    '',
    `Total: <b>${hours > 0 ? `${hours} h ${mins} min` : `${mins} min`}</b> en ${closed.length} ${closed.length === 1 ? 'zona' : 'zonas'}`,
  ].join('\n');
}

export async function POST(req: Request) {
  if (!isTelegramConfigured) return ok();
  if (!verifyWebhookSecret(req)) {
    // Not an error to Telegram — just silence for a caller that isn't them.
    return ok();
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return ok();
  }

  const chatId = update.message?.chat?.id;
  if (chatId === undefined) return ok();

  if (!hasAllowlist()) {
    await sendMessage(chatId, 'El bot no tiene chats autorizados todavía. Tu chat id es: <code>' + chatId + '</code>');
    return ok();
  }
  if (!isChatAllowed(chatId)) {
    // Say nothing useful — the id is all they get, and only so the owner can
    // add themselves the first time.
    await sendMessage(chatId, 'Este bot es privado. Chat id: <code>' + chatId + '</code>');
    return ok();
  }

  const who = String(chatId);
  let text = update.message?.text?.trim() ?? '';

  // Voice note — the whole point of using chat rather than the web app.
  const voiceId = update.message?.voice?.file_id ?? update.message?.audio?.file_id;
  if (!text && voiceId) {
    const file = await downloadFile(voiceId);
    const heard = file ? await transcribe(file.buffer, file.path.split('/').pop() ?? 'voice.ogg') : null;
    if (!heard) {
      await sendMessage(chatId, 'No pude entender la nota de voz. Escríbelo y sigo igual.');
      return ok();
    }
    text = heard;
    await sendMessage(chatId, `🎙 <i>${heard}</i>`);
  }

  if (!text) return ok();

  const command = parseActivity(text);

  switch (command.kind) {
    case 'help':
      await sendMessage(chatId, HELP_TEXT);
      break;

    case 'startJob': {
      const session = await startSession(who, command.label);
      await sendMessage(
        chatId,
        `▶️ Trabajo abierto${session.label ? `: <b>${session.label}</b>` : ''}.\nDi el nombre de la habitación para empezar a contar.`,
      );
      break;
    }

    case 'startRoom': {
      const { closed } = await startRoom(who, command.room, command.task);
      const previous = closed ? `⏹ ${label(closed.roomType)}: <b>${closed.minutes} min</b>\n` : '';
      await sendMessage(chatId, `${previous}▶️ ${label(command.room)} en marcha.`);
      break;
    }

    case 'endRoom': {
      const closed = await closeOpenSegment(who);
      await sendMessage(
        chatId,
        closed
          ? `⏹ ${label(closed.roomType)}: <b>${closed.minutes} min</b>`
          : 'No hay ninguna habitación en marcha.',
      );
      break;
    }

    case 'endJob': {
      const session = await endSession(who);
      await sendMessage(chatId, session ? summarise(session) : 'No hay ningún trabajo abierto.');
      break;
    }

    case 'status': {
      const session = await openSession(who);
      if (!session) {
        await sendMessage(chatId, 'No hay ningún trabajo abierto. Di "nuevo trabajo" para empezar.');
        break;
      }
      const running = session.segments.find((s) => !s.endedAt);
      const done = session.segments.filter((s) => typeof s.minutes === 'number');
      await sendMessage(
        chatId,
        [
          session.label ? `<b>${session.label}</b>` : '<b>Trabajo en curso</b>',
          running
            ? `▶️ ${label(running.roomType)} — ${Math.max(0, Math.round((Date.now() - new Date(running.startedAt).getTime()) / 60000))} min hasta ahora`
            : 'Nada en marcha ahora mismo.',
          `Cerradas: ${done.length} · ${done.reduce((s, x) => s + (x.minutes ?? 0), 0)} min`,
        ].join('\n'),
      );
      break;
    }

    case 'cancel': {
      const removed = await cancelSession(who);
      await sendMessage(chatId, removed ? '🗑 Trabajo descartado.' : 'No había nada abierto.');
      break;
    }

    default:
      await sendMessage(chatId, `No entendí "${text}".\n\n${HELP_TEXT}`);
  }

  return ok();
}
