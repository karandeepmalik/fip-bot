/**
 * FIP Warriors India — WhatsApp Support Group Bot (skeleton)
 * -----------------------------------------------------------
 * Built on Baileys (unofficial WhatsApp Web library). This logs in as a
 * LINKED DEVICE on a real WhatsApp account. It violates WhatsApp's ToS and
 * the number can be banned — use a DEDICATED number, keep volume low, and
 * pace outbound messages. If banned, re-link a new number; the group survives.
 *
 * Features: (1) auto-welcome + intake, (2) dose calculator, (3) FAQ commands,
 * with a per-user Hindi/English toggle.
 *
 * Run:  npm i baileys qrcode-terminal
 *       node fip-warriors-bot.mjs   (scan the QR once with Linked Devices)
 */

import { makeWASocket, useMultiFileAuthState, DisconnectReason } from 'baileys';
import qrcode from 'qrcode-terminal';
import fs from 'fs';

// ============================================================
// CONFIG  — set these before going live
// ============================================================
const CONFIG = {
  botName: 'FIP Warriors India',
  defaultLang: 'en',                    // 'en' | 'hi'
  commandPrefix: '!',
  adminJids: [],                        // e.g. ['9198xxxxxxxx@s.whatsapp.net'] — pinged on triage keywords
  welcomePacingMs: [1500, 4000],        // random delay range before welcoming, so it doesn't look botty

  // ---- DOSING: FAIL-CLOSED ----
  // Left null on purpose. The bot REFUSES to calculate until you fill these in
  // from YOUR protocol / product, so nobody ever ships placeholder doses.
  //   mgPerKg: target mg per kg per FIP form (you set from your protocol)
  //   concentrationMgPerMl: injectable concentration (mg/ml) — null to hide ml output
  //   tabletStrengthMg: oral tablet strength (mg) — null to hide tablet output
  dosing: {
    concentrationMgPerMl: null,
    tabletStrengthMg: null,
    mgPerKg: { wet: null, dry: null, ocular: null, neuro: null },
  },
};

const FORMS = ['wet', 'dry', 'ocular', 'neuro'];

// ============================================================
// CONTENT (i18n).  hi fields marked TODO should be filled with your
// VETTED Hindi copy — you already translated the intake form.
// ============================================================
const T = {
  welcome: {
    en: (mention) =>
      `🐾 Welcome ${mention} to *FIP Warriors India*.\n\nYou're not alone — FIP is treatable. To get you help fastest, please share:\n1) Cat's current weight (kg)\n2) FIP type if known (wet / dry / ocular / neuro)\n3) Main symptoms\n4) Latest bloodwork if available (esp. A:G ratio)\n\nA warrior will assist you shortly. Type *!help* for commands.\nSwitch to Hindi: *!lang hi*`,
    hi: (mention) =>
      `🐾 ${mention}, *FIP Warriors India* में आपका स्वागत है।\n\nआप अकेले नहीं हैं — FIP का इलाज संभव है। जल्दी मदद के लिए कृपया बताएं:\n1) बिल्ली का वर्तमान वज़न (kg)\n2) FIP का प्रकार, यदि पता हो (wet / dry / ocular / neuro)\n3) मुख्य लक्षण\n4) नवीनतम रक्त रिपोर्ट, यदि उपलब्ध हो (खासकर A:G अनुपात)\n\nएक warrior जल्द ही आपकी सहायता करेगा। कमांड के लिए *!help* लिखें।\nEnglish में बदलें: *!lang en*`,
  },
  help: {
    en:
      `*Commands*\n` +
      `!dose <weight_kg> <form> — dose calculator (forms: wet, dry, ocular, neuro)\n` +
      `!source — where to get treatment\n` +
      `!storage — storage & handling\n` +
      `!injection — injection tips\n` +
      `!sideeffects — common side effects\n` +
      `!relapse — about relapse\n` +
      `!observation — post-treatment observation\n` +
      `!lang <en|hi> — change language\n` +
      `!help — this menu`,
    hi:
      `*कमांड*\n` +
      `!dose <वज़न_kg> <प्रकार> — खुराक कैलकुलेटर (प्रकार: wet, dry, ocular, neuro)\n` +
      `!source — इलाज कहाँ से लें\n` +
      `!storage — भंडारण व देखभाल\n` +
      `!injection — इंजेक्शन सुझाव\n` +
      `!sideeffects — सामान्य दुष्प्रभाव\n` +
      `!relapse — रिलैप्स के बारे में\n` +
      `!observation — इलाज के बाद निगरानी\n` +
      `!lang <en|hi> — भाषा बदलें\n` +
      `!help — यह मेन्यू`,
  },
  langSet: {
    en: 'Language set to English. Type !help for commands.',
    hi: 'भाषा हिंदी पर सेट कर दी गई है। कमांड के लिए !help लिखें।',
  },
  doseUsage: {
    en: 'Usage: *!dose <weight_kg> <form>*\nExample: !dose 3.2 wet\nForms: wet, dry, ocular, neuro',
    hi: 'उपयोग: *!dose <वज़न_kg> <प्रकार>*\nउदाहरण: !dose 3.2 wet\nप्रकार: wet, dry, ocular, neuro',
  },
  doseBadInput: {
    en: 'Could not read that. Weight must be a positive number and form one of: wet, dry, ocular, neuro.',
    hi: 'इनपुट समझ नहीं आया। वज़न एक धनात्मक संख्या हो और प्रकार इनमें से एक: wet, dry, ocular, neuro।',
  },
  doseNotConfigured: {
    en: '⚠️ Dosing is not configured for this form yet. An admin needs to set the protocol values. Please ask a warrior for dosing.',
    hi: '⚠️ इस प्रकार के लिए खुराक अभी कॉन्फ़िगर नहीं है। एक एडमिन को प्रोटोकॉल मान सेट करने होंगे। कृपया खुराक के लिए किसी warrior से पूछें।',
  },
  disclaimer: {
    en: '\n\n_Please double-check the weight and confirm this with your assigned warrior before dosing._',
    hi: '\n\n_कृपया वज़न दोबारा जाँचें और खुराक देने से पहले अपने warrior से पुष्टि करें।_',
  },
};

// FAQ content — English placeholders. Replace with your vetted clinical copy,
// and add Hindi. Kept deliberately light so no unreviewed clinical claim ships.
const FAQ = {
  source: {
    en: 'TODO: replace with your vetted sourcing info (Kuronyx / approved channels).',
    hi: 'TODO: यहाँ आपकी सत्यापित जानकारी जोड़ें।',
  },
  storage: {
    en: 'TODO: replace with vetted storage & handling guidance for your product.',
    hi: 'TODO: भंडारण संबंधी सत्यापित जानकारी जोड़ें।',
  },
  injection: {
    en: 'TODO: replace with vetted injection technique tips.',
    hi: 'TODO: इंजेक्शन तकनीक की सत्यापित जानकारी जोड़ें।',
  },
  sideeffects: {
    en: 'TODO: replace with vetted common side-effects info.',
    hi: 'TODO: सामान्य दुष्प्रभावों की सत्यापित जानकारी जोड़ें।',
  },
  relapse: {
    en: 'TODO: replace with vetted relapse guidance.',
    hi: 'TODO: रिलैप्स संबंधी सत्यापित जानकारी जोड़ें।',
  },
  observation: {
    en: 'TODO: replace with vetted post-treatment observation guidance (e.g. 84-day watch).',
    hi: 'TODO: इलाज के बाद निगरानी की सत्यापित जानकारी जोड़ें।',
  },
};

// Triage keywords → ping admins (stretch). Add Hindi terms too.
const TRIAGE_KEYWORDS = ['seizure', 'jaundice', 'not eating', 'gasping', 'collapse'];

// ============================================================
// STATE / PERSISTENCE  (simple JSON store for language prefs)
// ============================================================
const PREFS_FILE = './lang_prefs.json';
let langPrefs = {};
try { langPrefs = JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')); } catch { langPrefs = {}; }
const savePrefs = () => fs.writeFileSync(PREFS_FILE, JSON.stringify(langPrefs, null, 2));

const normJid = (jid = '') => jid.replace(/:[0-9]+@/, '@'); // strip device id
const langOf = (jid) => langPrefs[normJid(jid)] || CONFIG.defaultLang;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = ([lo, hi]) => lo + Math.random() * (hi - lo);

// ============================================================
// DOSE CALCULATOR (pure, testable, fail-closed)
// ============================================================
export function calcDose(weightKg, form, dosing = CONFIG.dosing) {
  if (!FORMS.includes(form)) return { error: 'bad_input' };
  const w = Number(weightKg);
  if (!Number.isFinite(w) || w <= 0) return { error: 'bad_input' };

  const mgPerKg = dosing?.mgPerKg?.[form];
  if (mgPerKg == null) return { error: 'not_configured' };

  const mg = w * mgPerKg;
  const ml = dosing.concentrationMgPerMl ? mg / dosing.concentrationMgPerMl : null;
  const tablets = dosing.tabletStrengthMg ? mg / dosing.tabletStrengthMg : null;
  return { weightKg: w, form, mgPerKg, mg, ml, tablets };
}

function formatDose(res, lang) {
  const round = (n, d = 2) => Number(n.toFixed(d));
  let out =
    `💉 *Dose — ${res.form}*\n` +
    `Weight: ${res.weightKg} kg × ${res.mgPerKg} mg/kg\n` +
    `Daily dose: *${round(res.mg)} mg*`;
  if (res.ml != null) out += `\nInjection volume: *${round(res.ml)} ml*`;
  if (res.tablets != null) out += `\nTablets: *${round(res.tablets)}* (round to your tablet size)`;
  out += T.disclaimer[lang];
  return out;
}

// ============================================================
// COMMAND ROUTER
// ============================================================
async function handleCommand(sock, replyJid, senderJid, body) {
  const lang = langOf(senderJid);
  const [cmdRaw, ...args] = body.slice(CONFIG.commandPrefix.length).trim().split(/\s+/);
  const cmd = cmdRaw.toLowerCase();
  const reply = (text) => sock.sendMessage(replyJid, { text });

  switch (cmd) {
    case 'help':
    case 'menu':
      return reply(T.help[lang]);

    case 'lang': {
      const target = (args[0] || '').toLowerCase();
      if (target !== 'en' && target !== 'hi') return reply('Use: !lang en  |  !lang hi');
      langPrefs[normJid(senderJid)] = target;
      savePrefs();
      return reply(T.langSet[target]);
    }

    case 'dose': {
      if (args.length < 2) return reply(T.doseUsage[lang]);
      const res = calcDose(args[0], (args[1] || '').toLowerCase());
      if (res.error === 'bad_input') return reply(T.doseBadInput[lang]);
      if (res.error === 'not_configured') return reply(T.doseNotConfigured[lang]);
      return reply(formatDose(res, lang));
    }

    default:
      if (FAQ[cmd]) return reply(FAQ[cmd][lang]);
      return; // unknown command → stay quiet in a group
  }
}

// ============================================================
// BAILEYS CONNECTION + EVENT HANDLERS
// ============================================================
async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const sock = makeWASocket({ auth: state });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) qrcode.generate(qr, { small: true });
    if (connection === 'open') console.log('✅ Connected as', sock.user?.id);
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      console.log('Connection closed.', loggedOut ? 'Logged out — delete auth_info and re-scan.' : 'Reconnecting…');
      if (!loggedOut) start();
    }
  });

  // (1) Welcome new members — paced so it doesn't look like spam
  sock.ev.on('group-participants.update', async ({ id: groupJid, participants, action }) => {
    if (action !== 'add') return;
    for (const p of participants) {
      await delay(rand(CONFIG.welcomePacingMs));
      const lang = CONFIG.defaultLang; // new member has no pref yet
      const mention = '@' + p.split('@')[0];
      await sock.sendMessage(groupJid, { text: T.welcome[lang](mention), mentions: [p] });
    }
  });

  // Messages — commands + triage
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      const remoteJid = msg.key.remoteJid;                 // group or DM
      const isGroup = remoteJid?.endsWith('@g.us');
      const senderJid = isGroup ? (msg.key.participant || remoteJid) : remoteJid;
      const m = msg.message;
      const text = m.conversation || m.extendedTextMessage?.text ||
                   m.imageMessage?.caption || m.videoMessage?.caption || '';
      if (!text) continue;

      // Triage: ping admins on red-flag terms
      const low = text.toLowerCase();
      if (CONFIG.adminJids.length && TRIAGE_KEYWORDS.some((k) => low.includes(k))) {
        const who = senderJid.split('@')[0];
        for (const admin of CONFIG.adminJids) {
          await sock.sendMessage(admin, { text: `🚨 Possible urgent case from +${who}:\n"${text}"` });
        }
      }

      if (text.startsWith(CONFIG.commandPrefix)) {
        await handleCommand(sock, remoteJid, senderJid, text);
      }
    }
  });
}

// Only auto-start when run directly (so tests can import calcDose safely)
if (import.meta.url === `file://${process.argv[1]}`) start();
