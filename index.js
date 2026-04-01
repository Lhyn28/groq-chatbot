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

function extractEmail(text) {
  const match = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  return match ? match[0].toLowerCase() : null;
}

// ============================================================
// PRE-COMPUTE REAL DATES — No hallucination possible
// ============================================================
function computeDateMap() {
  const tz = "Asia/Manila";
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));

  const pad = (n) => String(n).padStart(2, "0");
  const formatLabel = (d) => d.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: tz
  });
  const formatISO = (d) => {
    const y = d.getFullYear();
    const m = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    return `${y}-${m}-${day}`;
  };

  const addDays = (d, n) => {
    const copy = new Date(d);
    copy.setDate(copy.getDate() + n);
    return copy;
  };

  const isWeekday = (d) => {
    const day = d.getDay();
    return day !== 0 && day !== 6;
  };

  // Build next 10 weekdays
  const weekdays = [];
  let cursor = addDays(now, 1);
  while (weekdays.length < 10) {
    if (isWeekday(cursor)) {
      weekdays.push({ label: formatLabel(cursor), iso: formatISO(cursor) });
    }
    cursor = addDays(cursor, 1);
  }

  return {
    todayLabel: formatLabel(now),
    todayISO: formatISO(now),
    tomorrow: weekdays[0],
    dayAfterTomorrow: weekdays[1],
    thisWeek: weekdays.slice(0, 3),
    nextWeek: weekdays.slice(3, 8),
    all: weekdays
  };
}

// ============================================================
// SYSTEM PROMPT
// ============================================================
function buildSystemPrompt(knownName, knownEmail) {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  const dates = computeDateMap();

  return `You are Lhyn's friendly chat assistant. Warm, casual, human — like texting a knowledgeable friend. Short replies.

=== CURRENT DATE & TIME ===
Today is: ${dates.todayLabel}
Time now: ${timeStr} Manila time

=== REAL AVAILABLE DATES (USE ONLY THESE EXACT DATES — NEVER make up a date, NEVER say "insert date", NEVER say "day after tomorrow" without the real date) ===
Tomorrow = ${dates.tomorrow.label} (${dates.tomorrow.iso})
Day after tomorrow = ${dates.dayAfterTomorrow.label} (${dates.dayAfterTomorrow.iso})
This week:
${dates.thisWeek.map(d => `  - ${d.label} → ISO: ${d.iso}`).join("\n")}
Next week:
${dates.nextWeek.map(d => `  - ${d.label} → ISO: ${d.iso}`).join("\n")}

RULE: When confirming any appointment, ALWAYS state the FULL date like "Thursday, April 3, 2026 at 3:00 PM". NEVER say "[insert date]" or "[specific date]" — those are forbidden.

=== EXACT PRICING (MANDATORY — say these numbers every time, no exceptions) ===
Someone asks about funnels? → "$897 starting"
Someone asks about automations? → "$597 starting"  
Someone asks about web apps? → "$1,497 starting"
Someone asks about bookkeeping? → "$497/month starting"
Someone asks about complete package? → "$1,497/month"
Someone asks about retainer? → "$350/month"
Someone asks "how much" or "estimate" or "price"? → Give the number IMMEDIATELY. No "it depends", no "we can discuss", no "$X".

=== CUSTOMER INFO ===
Name collected: ${knownName || "NOT YET — must ask naturally"}
Email collected: ${knownEmail || "NOT YET — ask after getting name"}
${knownName && knownEmail ? "✅ Have both — DO NOT ask again." : ""}

=== WHO IS LHYN ===
GHL Specialist, Bookkeeper & VA. Metro Manila PH. US & UK clients.
Builds: GHL funnels, automations, React/Next.js web apps, bookkeeping.
30+ GHL systems built. Interning at AHA Innovations. 100% done-for-you.
What makes her different: GHL + custom React code + bookkeeping = rare combo.

=== SERVICES ===
1. High-Converting Funnels — $897 starting (custom GHL funnel, mobile-ready, AI copy, 2 revisions)
2. GHL Systems & Automations — $597 starting (SMS/email, pipelines, calendar, lead tagging)
3. Custom Web Apps — $1,497 starting (React/Next.js, custom UI, Loom walkthrough)
4. Monthly Bookkeeping — $497/month starting (QBO/Xero, reconciliation, reports)
5. Complete Business Engine — $1,497/month (GHL tech + bookkeeping combined)
Retainer — $350/month (updates, automations, priority access)
Discovery call = FREE always.

=== CONVERSATION RULES ===
1. Answer questions with EXACT prices. Never be vague about cost.
2. When customer seems curious or interested, casually ask their name:
   "By the way, what's your name? 😊"
3. After getting name, use it. Later ask for email:
   "What's the best email for you, [Name]?"
4. Once you have BOTH name AND email, add this tag silently in your message (invisible to user):
   [CONTACT:{"name":"THEIR_REAL_NAME","email":"their@email.com"}]
5. Do NOT push for a booking — let them ask all questions first.
6. When they want to book, suggest available dates from the list above. Example:
   "I have availability on Wednesday, April 2 or Thursday, April 3 — which works better for you?"
7. Once they confirm a date and time, use ONLY dates from the list above and add this silently:
   [APPOINTMENT:{"name":"THEIR_REAL_NAME","email":"their@email.com","datetime":"YYYY-MM-DDTHH:mm:ss","notes":"Free discovery call - Lhyn Works"}]
8. After booking, confirm clearly: "You're all set! I've booked your free discovery call for [FULL REAL DATE] at [TIME] Manila time 🎉"

=== TONE ===
- 2 to 4 sentences max
- Warm and human, not corporate
- Use their name once you know it
- Light emojis occasionally
- NEVER say "Certainly!", "Of course!", "Absolutely!"
- NEVER say "it depends" for pricing
- NEVER say "[insert date]" or "[specific date]" — always use the real computed date
- Unknown questions → "Let me have Lhyn check on that! hello@lhynworks.com 😊"
- Call hours: Mon–Fri 9AM–6PM Manila (flexible for US)`;
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

    try {
      const res = await axios.post(
        "https://services.leadconnectorhq.com/contacts/",
        { locationId: GHL_LOCATION_ID, firstName, lastName, email },
        { headers: GHL_HEADERS }
      );
      const id = res.data.contact?.id;
      console.log(`✅ Contact created: ${name} / ${email} / ${id}`);
      return id;
    } catch {
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
    if (!contactId) { console.error("❌ No contactId"); return false; }

    const startTime = new Date(datetime);
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

    console.log("📅 Booking:", JSON.stringify(payload, null, 2));
    const res = await axios.post(
      "https://services.leadconnectorhq.com/calendars/events/appointments",
      payload,
      { headers: GHL_HEADERS }
    );
    console.log(`✅ BOOKED:`, JSON.stringify(res.data, null, 2));
    return true;
  } catch (err) {
    console.error("❌ Booking error:", JSON.stringify(err.response?.data, null, 2) || err.message);
    return false;
  }
}

// ============================================================
// SEND MESSAGE
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
  const { message, conversationId } = req.body;

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
          console.log(`📧 Email in history: ${found}`);
          break;
        }
      }
    }

    console.log(`🗂️ Store [${conversationId}]:`, store);

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
        temperature: 0.65
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

    // Handle CONTACT tag — only accept names that look real
    const contactMatch = aiReply.match(/\[CONTACT:(\{.*?\})\]/s);
    if (contactMatch) {
      try {
        const parsed = JSON.parse(contactMatch[1]);
        const nameIsReal = parsed.name &&
          parsed.name.length > 1 &&
          !parsed.name.toLowerCase().includes("visitor") &&
          !parsed.name.toLowerCase().includes("unknown") &&
          !/^\d+$/.test(parsed.name) &&
          parsed.name.split(" ").length <= 5;

        if (nameIsReal && !store.name) store.name = parsed.name;
        if (parsed.email && !store.email) store.email = parsed.email;

        if (store.name && store.email && !store.saved) {
          await saveContact(store.name, store.email);
          store.saved = true;
        }
        console.log(`📋 CONTACT tag: ${store.name} / ${store.email}`);
      } catch (e) { console.error("Contact parse error:", e); }
      aiReply = aiReply.replace(contactMatch[0], "").trim();
    }

    // Handle APPOINTMENT tag
    const appointmentMatch = aiReply.match(/\[APPOINTMENT:(\{.*?\})\]/s);
    if (appointmentMatch) {
      try {
        const appt = JSON.parse(appointmentMatch[1]);
        const name = appt.name || store.name;
        const email = appt.email || store.email;
        console.log(`📅 APPOINTMENT tag: ${name} / ${email} / ${appt.datetime}`);
        if (name && email && appt.datetime) {
          await bookAppointment(name, email, appt.datetime, appt.notes);
        } else {
          console.error("❌ Missing appointment data:", { name, email, datetime: appt.datetime });
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
