const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;
const GHL_CALENDAR_ID = process.env.GHL_CALENDAR_ID;

const GHL_HEADERS = {
  Authorization: `Bearer ${GHL_API_KEY}`,
  "Content-Type": "application/json",
  Version: "2021-04-15"
};

const contactStore = {};

// ============================================================
// DETECT EMAIL
// ============================================================
function extractEmail(text) {
  const match = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  return match ? match[0].toLowerCase() : null;
}

// ============================================================
// CHECK IF NAME IS REAL (not a GHL placeholder)
// ============================================================
function isRealName(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  // GHL generates placeholder names like "Visitor Xuxpz"
  if (lower.includes("visitor")) return false;
  if (lower.includes("unknown")) return false;
  if (lower.includes("guest")) return false;
  if (lower.length < 2) return false;
  return true;
}

// ============================================================
// PRE-CALCULATE REAL DATES (so AI can't hallucinate)
// ============================================================
function getRealDates() {
  const tz = "Asia/Manila";
  const now = new Date();

  const formatDate = (d) => d.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: tz
  });

  const addDays = (d, n) => {
    const copy = new Date(d);
    copy.setDate(copy.getDate() + n);
    return copy;
  };

  const toISO = (d, hour) => {
    const copy = new Date(d);
    copy.setHours(hour, 0, 0, 0);
    return copy.toISOString().replace("Z", "+08:00");
  };

  const today = now;
  const dates = [];
  // Generate next 10 weekdays
  let d = addDays(today, 1);
  while (dates.length < 10) {
    const day = d.toLocaleDateString("en-US", { weekday: "short", timeZone: tz });
    if (day !== "Sat" && day !== "Sun") {
      dates.push({
        label: formatDate(d),
        iso: d.toISOString().split("T")[0]
      });
    }
    d = addDays(d, 1);
  }

  return {
    today: formatDate(today),
    todayISO: today.toISOString().split("T")[0],
    tomorrow: dates[0].label,
    tomorrowISO: dates[0].iso,
    availableDates: dates
  };
}

// ============================================================
// CONVERT NATURAL DATE TO ISO
// ============================================================
function parseAppointmentDatetime(datetimeStr) {
  // Already ISO format
  if (datetimeStr.includes("T")) return new Date(datetimeStr);
  // Try parsing natural language
  return new Date(datetimeStr);
}

// ============================================================
// SYSTEM PROMPT
// ============================================================
function buildSystemPrompt(knownName, knownEmail) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Manila"
  });
  const dates = getRealDates();

  const contactStatus = `
CUSTOMER INFO YOU HAVE:
- Name: ${knownName || "not collected yet"}
- Email: ${knownEmail || "not collected yet"}
${knownName && knownEmail ? "✅ You have both. Do NOT ask again." : ""}
${knownName && !knownEmail ? "✅ Have name. Still need email — ask naturally." : ""}
${!knownName ? "❌ Need name — ask casually when appropriate." : ""}
`;

  return `You are Lhyn's friendly chat assistant. Warm, human, casual — like texting a knowledgeable friend.

CRITICAL PRICING RULE — NEVER say "$X". Always use exact numbers:
- Funnels = $897 | Automations = $597 | Web Apps = $1,497
- Bookkeeping = $497/month | Complete Engine = $1,497/month | Retainer = $350/month

${contactStatus}

===== TODAY'S REAL DATE & TIME =====
Today: ${dates.today}
Current time: ${timeStr} Manila time

AVAILABLE APPOINTMENT DATES (use ONLY these — never make up dates):
${dates.availableDates.slice(0, 7).map((d, i) => `- ${d.label} (ISO: ${d.iso})`).join("\n")}

===== WHO IS LHYN =====
GHL Specialist, Bookkeeper, and VA from Metro Manila, PH. Works with US and UK clients.
Builds funnels, GHL automations, custom web apps (React/Next.js), and bookkeeping.
Interning at AHA Innovations. 30+ GHL systems built. 100% done-for-you.
She does GHL AND custom React code — rare combo. Tech + bookkeeping in one.

===== SERVICES & PRICING =====
1. HIGH-CONVERTING FUNNELS — $897 starting
   Full GHL funnel. Opt-in to webinar funnels. Custom design, mobile-ready, CRM forms, AI copy, 2 revisions.

2. GHL SYSTEMS & AUTOMATIONS — $597 starting
   SMS/email sequences, pipelines, calendar setup, lead tagging, walkthrough.

3. CUSTOM WEB APPS — $1,497 starting
   React/Next.js. Custom UI, data management, Loom walkthrough.

4. MONTHLY BOOKKEEPING — $497/month starting
   QBO or Xero. Up to 2 bank/credit accounts, reconciliation, reports. AP/AR add-on available.

5. COMPLETE BUSINESS ENGINE — $1,497/month
   GHL tech + full bookkeeping. Weekly check-ins, priority Slack, funnel tweaks.

RETAINER — from $350/month (updates, automations, revisions)

All USD. Discovery call is FREE.

===== PORTFOLIO =====
Webinar funnel (JC de las Alas), AI Landing Pages Training, Reyes HVAC & Plumbing funnel, lead magnet funnels, custom React/Vercel apps.

===== CONTACT =====
hello@lhynworks.com | fb.com/lhynworks | Metro Manila PH — Zoom + async for US clients

===== CONVERSATION FLOW =====
STEP 1 — Answer questions. Give EXACT prices. Be warm and short.
STEP 2 — Ask for name casually when natural: "By the way, what's your name? 😊"
STEP 3 — After name, ask for email: "What's the best email for you, [Name]?"
STEP 4 — Once you have BOTH, include silently (user won't see):
  [CONTACT:{"name":"FULL_NAME","email":"EMAIL"}]
STEP 5 — Don't push for a call. Wait until they're ready or ask about next steps.
STEP 6 — When they want to book:
  - Ask what date and time works for them
  - Pick from the AVAILABLE APPOINTMENT DATES list above ONLY
  - NEVER invent a date not in that list
  - Convert their choice to exact ISO format: YYYY-MM-DDTHH:mm:ss
  - Include silently:
  [APPOINTMENT:{"name":"FULL_NAME","email":"EMAIL","datetime":"YYYY-MM-DDTHH:mm:ss","notes":"Free discovery call - Lhyn Works"}]
STEP 7 — Confirm with real date and time. Example: "Perfect! You're booked for Thursday, April 3 at 10:00 AM Manila time 🎉"

===== TONE =====
- 2–4 sentences max per reply
- Use their name once you know it
- Emojis occasionally
- NEVER: "Certainly!", "Of course!", "Absolutely!"
- NEVER: "$X" or "varies"
- NEVER: "I don't have access to previous chats"
- Unknown questions → "Let me have Lhyn check! Reach her at hello@lhynworks.com 😊"
- Call hours: Mon–Fri 9AM–6PM Manila (flexible for US clients)`;
}

// ============================================================
// GET CONVERSATION HISTORY
// ============================================================
async function getConversationHistory(conversationId) {
  try {
    const res = await axios.get(
      `https://services.leadconnectorhq.com/conversations/${conversationId}/messages`,
      { headers: GHL_HEADERS }
    );
    const messages = res.data.messages?.messages || [];
    return messages
      .slice(-14)
      .map(m => ({
        role: m.direction === "inbound" ? "user" : "assistant",
        content: m.body || ""
      }))
      .filter(m => m.content.trim());
  } catch (err) {
    console.error("History error:", err.response?.data || err.message);
    return [];
  }
}

// ============================================================
// SAVE CONTACT
// ============================================================
async function saveContact(name, email) {
  try {
    const parts = name.trim().split(" ");
    const firstName = parts[0];
    const lastName = parts.slice(1).join(" ") || "";

    // Try create first
    try {
      const res = await axios.post(
        "https://services.leadconnectorhq.com/contacts/",
        { locationId: GHL_LOCATION_ID, firstName, lastName, email },
        { headers: GHL_HEADERS }
      );
      const id = res.data.contact?.id;
      console.log(`✅ Contact created: ${name} / ${email} / ${id}`);
      return id;
    } catch (createErr) {
      // If already exists, find and update
      const search = await axios.get(
        `https://services.leadconnectorhq.com/contacts/?locationId=${GHL_LOCATION_ID}&email=${encodeURIComponent(email)}`,
        { headers: GHL_HEADERS }
      );
      const existing = search.data.contacts?.[0];
      if (existing) {
        await axios.put(
          `https://services.leadconnectorhq.com/contacts/${existing.id}`,
          { firstName, lastName },
          { headers: GHL_HEADERS }
        );
        console.log(`✅ Contact updated: ${existing.id}`);
        return existing.id;
      }
    }
  } catch (err) {
    console.error("❌ saveContact error:", err.response?.data || err.message);
  }
}

// ============================================================
// BOOK APPOINTMENT
// ============================================================
async function bookAppointment(name, email, datetime, notes) {
  try {
    const contactId = await saveContact(name, email);
    if (!contactId) {
      console.error("❌ No contactId");
      return false;
    }

    const startTime = parseAppointmentDatetime(datetime);
    if (isNaN(startTime.getTime())) {
      console.error("❌ Invalid datetime:", datetime);
      return false;
    }
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000);

    const payload = {
      calendarId: GHL_CALENDAR_ID,
      locationId: GHL_LOCATION_ID,
      contactId,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      title: `Free Discovery Call — ${name}`,
      appointmentStatus: "new",
      selectedTimezone: "Asia/Manila",
      notes: notes || "Free 30-min discovery call"
    };

    console.log("📅 Booking payload:", JSON.stringify(payload, null, 2));

    const res = await axios.post(
      "https://services.leadconnectorhq.com/calendars/events/appointments",
      payload,
      { headers: GHL_HEADERS }
    );

    console.log(`✅ BOOKED! Response:`, JSON.stringify(res.data, null, 2));
    return true;
  } catch (err) {
    console.error("❌ Booking error:", JSON.stringify(err.response?.data, null, 2) || err.message);
    return false;
  }
}

// ============================================================
// SEND MESSAGE TO GHL
// ============================================================
async function sendGHLMessage(conversationId, message) {
  await axios.post(
    "https://services.leadconnectorhq.com/conversations/messages",
    { conversationId, type: "Live_Chat", message },
    { headers: GHL_HEADERS }
  );
}

// ============================================================
// MAIN WEBHOOK
// ============================================================
app.post("/webhook", async (req, res) => {
  const { message, conversationId, contact_name } = req.body;

  if (!message || !conversationId) {
    return res.status(400).json({ error: "Missing fields" });
  }

  if (!contactStore[conversationId]) {
    contactStore[conversationId] = { name: null, email: null, saved: false };
  }
  const store = contactStore[conversationId];

  // Auto-detect email from current message
  const detectedEmail = extractEmail(message);
  if (detectedEmail && !store.email) {
    store.email = detectedEmail;
    console.log(`📧 Email detected: ${detectedEmail}`);
  }

  // Only use GHL contact_name if it looks like a real person's name
  if (!store.name && isRealName(contact_name)) {
    store.name = contact_name;
    console.log(`👤 Real name from GHL: ${contact_name}`);
  }

  // Save immediately if we have both
  if (store.name && store.email && !store.saved) {
    await saveContact(store.name, store.email);
    store.saved = true;
  }

  try {
    const history = await getConversationHistory(conversationId);

    // Scan history for missed emails
    if (!store.email) {
      for (const msg of history) {
        const found = extractEmail(msg.content);
        if (found) {
          store.email = found;
          console.log(`📧 Email found in history: ${found}`);
          break;
        }
      }
    }

    console.log(`🗂️ Store for ${conversationId}:`, store);

    const groqRes = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama3-70b-8192",
        messages: [
          { role: "system", content: buildSystemPrompt(store.name, store.email) },
          ...history,
          { role: "user", content: message }
        ],
        max_tokens: 400,
        temperature: 0.7
      },
      {
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    let aiReply = groqRes.data.choices[0].message.content;
    console.log("🤖 Raw reply:", aiReply);

    // Handle CONTACT tag
    const contactMatch = aiReply.match(/\[CONTACT:(\{.*?\})\]/s);
    if (contactMatch) {
      try {
        const parsed = JSON.parse(contactMatch[1]);
        if (isRealName(parsed.name) && !store.name) store.name = parsed.name;
        if (parsed.email && !store.email) store.email = parsed.email;
        if (store.name && store.email && !store.saved) {
          await saveContact(store.name, store.email);
          store.saved = true;
        }
        console.log(`📋 CONTACT tag processed: ${store.name} / ${store.email}`);
      } catch (e) { console.error("Contact parse error:", e); }
      aiReply = aiReply.replace(contactMatch[0], "").trim();
    }

    // Handle APPOINTMENT tag
    const appointmentMatch = aiReply.match(/\[APPOINTMENT:(\{.*?\})\]/s);
    if (appointmentMatch) {
      try {
        const appt = JSON.parse(appointmentMatch[1]);
        const name = (isRealName(appt.name) ? appt.name : null) || store.name;
        const email = appt.email || store.email;
        console.log(`📅 APPOINTMENT tag: ${name} / ${email} / ${appt.datetime}`);
        if (name && email && appt.datetime) {
          await bookAppointment(name, email, appt.datetime, appt.notes);
        } else {
          console.error("❌ Missing data for appointment:", { name, email, datetime: appt.datetime });
        }
      } catch (e) { console.error("Appointment parse error:", e); }
      aiReply = aiReply.replace(appointmentMatch[0], "").trim();
    }

    await sendGHLMessage(conversationId, aiReply);
    res.json({ success: true });

  } catch (err) {
    console.error("Webhook error:", err.response?.data || err.message);
    res.status(500).json({ error: "Something went wrong" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🤖 Lhyn Works bot live on port ${PORT}`));
