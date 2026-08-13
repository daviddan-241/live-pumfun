/**
 * Unit tests for ARCC Publishing Layer
 */

import assert from 'node:assert';
import { test, describe, it } from 'node:test';
import {
  formatForPublication,
  formatDisclaimer,
  shouldAddCTA,
  stripSourceBranding
} from '../src/publishing/formatter.js';
import {
  executePNLWorkflow,
  handlePumpDetection,
  isValidCA,
  pnlEventEmitter
} from '../src/publishing/pnl.js';
import {
  routeMessage,
  publishCall,
  forwardToDestinations,
  handleEdit,
  handlePin,
  routerEventEmitter
} from '../src/publishing/router.js';
import { MessageClassification, ClassifiedMessage, Signal } from '../src/types.js';

describe('1. Formatter Tests', () => {
  it('formatDisclaimer returns expected format for HTML, Markdown, plain', () => {
    const html = formatDisclaimer('HTML');
    assert.strictEqual(html, '<a href="https://t.me/Aires_Insider/6">Disclaimer</a>');

    const md = formatDisclaimer('Markdown');
    assert.strictEqual(md, '[Disclaimer](https://t.me/Aires_Insider/6)');

    const plain = formatDisclaimer('plain');
    assert.strictEqual(plain, 'Disclaimer: https://t.me/Aires_Insider/6');
  });

  it('stripSourceBranding removes external channel links and attributions', () => {
    const raw = 'Check out t.me/some_alpha_group ! Forwarded from @alpha_channel\n\nBUY $SOL now!';
    const cleaned = stripSourceBranding(raw);
    assert.ok(!cleaned.includes('t.me/some_alpha_group'));
    assert.ok(!cleaned.includes('@alpha_channel'));
    assert.ok(cleaned.includes('BUY $SOL now!'));
  });

  it('shouldAddCTA adds CTA only for configured occasions', () => {
    const standardMsg: ClassifiedMessage = {
      id: '1',
      classification: MessageClassification.NEW_CALL,
      isHighValue: false
    };
    assert.strictEqual(shouldAddCTA(standardMsg), false);

    const highValueCall: ClassifiedMessage = {
      id: '2',
      classification: MessageClassification.NEW_CALL,
      isHighValue: true
    };
    assert.strictEqual(shouldAddCTA(highValueCall), true);

    const pnlMsg: ClassifiedMessage = {
      id: '3',
      classification: MessageClassification.PNL_UPDATE
    };
    assert.strictEqual(shouldAddCTA(pnlMsg), true);

    const vipMsg: ClassifiedMessage = {
      id: '4',
      classification: MessageClassification.FOLLOW_UP,
      isVIPContent: true
    };
    assert.strictEqual(shouldAddCTA(vipMsg), true);
  });

  it('formatForPublication formats NEW_CALL with ticker and CA', () => {
    const msg: ClassifiedMessage = {
      id: '10',
      classification: MessageClassification.NEW_CALL,
      text: 'Great entry here for PEPE',
      ca: '0x1234567890abcdef1234567890abcdef12345678',
      ticker: 'PEPE'
    };
    const formatted = formatForPublication(msg, undefined, 'HTML');
    assert.ok(formatted.includes('🎯 <b>ARCC Signal Alert</b>'));
    assert.ok(formatted.includes('Ticker:</b> $PEPE'));
    assert.ok(formatted.includes('CA: 0x1234567890abcdef1234567890abcdef12345678'));
    assert.ok(formatted.includes('https://t.me/Aires_Insider/6'));
  });

  it('formatForPublication formats PNL_UPDATE as raw /pnl command', () => {
    const msg: ClassifiedMessage = {
      id: '11',
      classification: MessageClassification.PNL_UPDATE,
      ca: '0xREALCONTRACTADDRESS'
    };
    const formatted = formatForPublication(msg);
    assert.strictEqual(formatted, '/pnl 0xREALCONTRACTADDRESS');
  });
});

describe('2. PNL Workflow Tests', () => {
  it('isValidCA accurately validates contract addresses', () => {
    assert.strictEqual(isValidCA('0x1234567890123456789012345678901234567890'), true);
    assert.strictEqual(isValidCA(''), false);
    assert.strictEqual(isValidCA(undefined), false);
    assert.strictEqual(isValidCA('0x0000000000000000000000000000000000000000'), false);
  });

  it('handlePumpDetection skips if CA is missing', async () => {
    let eventFired = false;
    pnlEventEmitter.once('pnl:skipped', (data) => {
      eventFired = true;
      assert.strictEqual(data.reason, 'missing_ca');
    });

    const signalNoCA: Signal = { id: 'sig_no_ca', ca: '' };
    const res = await handlePumpDetection(signalNoCA, { isPump: true });
    assert.strictEqual(res.success, false);
    assert.ok(eventFired);
  });

  it('executePNLWorkflow posts /pnl to private first, then forwards to public', async () => {
    let postedFired = false;
    let forwardedFired = false;

    pnlEventEmitter.once('pnl:posted', (data) => {
      postedFired = true;
      assert.ok(data.privateMessageId > 0);
    });

    pnlEventEmitter.once('pnl:forwarded', (data) => {
      forwardedFired = true;
      assert.ok(data.publicMessageId > 0);
    });

    const signal: Signal = {
      id: 'sig_valid_1',
      ca: '0x1234567890abcdef1234567890abcdef12345678',
      ticker: 'DOGE',
      privateCallMessageId: 1001,
      isPublicForwarded: false
    };

    const res = await executePNLWorkflow(signal, { isPump: true, multiplier: 5 });
    assert.strictEqual(res.success, true);
    assert.ok(res.privateMessageId! > 0);
    assert.ok(res.publicMessageId! > 0);
    assert.ok(postedFired);
    assert.ok(forwardedFired);
  });
});

describe('3. Router Tests', () => {
  it('routeMessage routes NEW_CALL via publishCall and emits message:published', async () => {
    let publishedEventFired = false;
    routerEventEmitter.once('message:published', (data) => {
      publishedEventFired = true;
      assert.strictEqual(data.classification, MessageClassification.NEW_CALL);
    });

    const msg: ClassifiedMessage = {
      id: 'msg_new_call_101',
      sourceMessageId: 'src_msg_101',
      classification: MessageClassification.NEW_CALL,
      text: 'New gem call',
      ca: '0xREALCONTRACT12345',
      ticker: 'GEM'
    };

    const res = await routeMessage(msg);
    assert.strictEqual(res.status, 'published');
    assert.ok(res.privateMessageId! > 0);
    assert.ok(res.publicMessageId! > 0);
    assert.ok(publishedEventFired);
  });

  it('routeMessage skips duplicate message ID on second call (idempotency)', async () => {
    const msg: ClassifiedMessage = {
      id: 'msg_dup_102',
      sourceMessageId: 'src_msg_102',
      classification: MessageClassification.NEW_CALL,
      text: 'First call'
    };

    const firstRes = await routeMessage(msg);
    assert.strictEqual(firstRes.status, 'published');

    const secondRes = await routeMessage(msg);
    assert.strictEqual(secondRes.status, 'skipped');
    assert.strictEqual(secondRes.reason, 'duplicate');
  });

  it('routeMessage skips CHATTER/IRRELEVANT messages', async () => {
    const chatterMsg: ClassifiedMessage = {
      id: 'chatter_1',
      classification: MessageClassification.CHATTER,
      text: 'Good morning guys'
    };

    const res = await routeMessage(chatterMsg);
    assert.strictEqual(res.status, 'skipped');
  });

  it('handleEdit updates mapped destination messages', async () => {
    const msg: ClassifiedMessage = {
      id: 'edit_src_1',
      sourceMessageId: 'edit_src_1',
      classification: MessageClassification.ANNOUNCEMENT,
      text: 'Original Announcement'
    };

    const pubRes = await routeMessage(msg);
    assert.strictEqual(pubRes.status, 'published');

    const editRes = await handleEdit('edit_src_1', 'Updated Announcement text');
    assert.strictEqual(editRes.success, true);
    assert.strictEqual(editRes.editedPrivate, true);
    assert.strictEqual(editRes.editedPublic, true);
  });

  it('handlePin pins mapped destination messages', async () => {
    const msg: ClassifiedMessage = {
      id: 'pin_src_1',
      sourceMessageId: 'pin_src_1',
      classification: MessageClassification.ANNOUNCEMENT,
      text: 'Important Pinned Post'
    };

    await routeMessage(msg);

    const pinRes = await handlePin('pin_src_1');
    assert.strictEqual(pinRes.success, true);
    assert.strictEqual(pinRes.pinnedPrivate, true);
    assert.strictEqual(pinRes.pinnedPublic, true);
  });
});
