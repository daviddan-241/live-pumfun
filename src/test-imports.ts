// @ts-nocheck
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/NewMessage.js';
import { EditedMessage } from 'telegram/events/EditedMessage.js';

console.log({ TelegramClient, Api, StringSession, NewMessage, EditedMessage });
