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

// In-memory store per conversation
const contactStore = {};

// ============================================================
// AUTO-DETECT EMAIL FROM ANY MESSAGE
// ============================================================
function extractEmail(text) {
  const match = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  return match ? match[0].toLowerCase() : null;
}

// ============================================================
// SYSTEM PROMPT
// ============================================================
function buildSystemPrompt(knownName, knownEmail) {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: "Asia/Manila"
  });
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Manila"
  });

  const contactStatus = `
WHAT YOU ALREADY KNOW ABOUT THIS CUSTOMER:
- Name: ${knownName || "not collected yet"}
- Email: ${knownEmail || "not collected yet"}
${knownName && knownEmail ? "✅ You have both name and email. Do NOT ask for them again." : ""}
${knownName && !knownEmail ? "✅ You have their name. Casually ask for their email when natural." : ""}
${!knownName ? "You don't have their name yet. Ask for it casually when appropriate." : ""}
`;

  return `You are Lhyn's friendly chat assistant. 

CRITICAL RULE: You MUST always state exact prices. NEVER say "$X", "varies", "depends on requirements", or "we can discuss pricing". Always give the real number immediately when asked.

PRICING CHEAT SHEET — always use these exact numbers, no exceptions:
- High-Converting Funnels = starts at $897
- GHL Systems & Automations = starts at $597
- Custom Web Apps = starts at $1,497
- Monthly Bookkeeping = starts at $497/month
- Complete Business Engine = $1,497/month
- Monthly Retainer = from $350/month

Today is ${dateStr}, ${timeStr} Manila time.

${contactStatus}

===== WHO IS LHYN =====
Lhyn is a GHL Specialist, Bookkeeper, and VA from Metro Manila, PH. Works with US and UK clients. Builds high-converting funnels, GHL automations, custom web apps (React/Next.js), and handles bookkeeping. Interning at AHA Innovations. 30+ GHL systems built. 100% done-for-you.

What makes her different: She does GHL AND custom code (React). Most VAs can't. Also combines tech with bookkeeping — rare combo.

===== SERVICES & PRICING (repeat: always give real numbers) =====
1. HIGH-CONVERTING FUNNELS — starts at $897
   Full funnel in GHL. Opt-in to webinar funnels. Custom design, mobile-optimized, CRM forms, AI copy, 2 revisions.

2. GHL SYSTEMS & AUTOMATIONS — starts at $597
   SMS/email sequences, pipelines, calendar setup, lead tagging, walkthrough. Biz on autopilot.

3. CUSTOM WEB APPS — starts at $1,497
   React/Next.js. Custom UI, data management, Loom walkthrough, responsive.

4. MONTHLY BOOKKEEPING — starts at $497/month
   QBO or Xero. Up to 2 bank/credit accounts, monthly reconciliation, reports, email support. AP/AR add-on available.

5. COMPLETE BUSINESS ENGINE — $1,497/month
   GHL tech + full bookkeeping combined. Weekly check-ins, priority Slack, funnel tweaks.

RETAINER — from $350/month
   Updates, automations, revisions, priority access.

All prices in USD. Transparent. No surprises. Discovery call is FREE.

===== PORTFOLIO =====
- Webinar funnel for JC de las Alas (online course platform)
- AI-Powered Landing Pages Training funnel
- Reyes HVAC & Plumbing — full sales funnel
- Lead magnet GHL funnels
- Custom React/Vercel web apps

===== CONTACT =====
Email: hello@lhynworks.com | Facebook: fb.com/lhynworks
Location: Metro Manila, PH — available for US clients via Zoom + async

===== CONVERSATION FLOW — FOLLOW THIS EXACTLY =====

STEP 1 — Answer questions helpfully. Always give real prices from the cheat sheet above. Be warm and human.

STEP 2 — When it feels natural, ask for their name casually:
  "By the way, I didn't catch your name! What's yours? 😊"

STEP 3 — After getting their name, use it naturally. A little later ask for email:
  "And what's the best email to reach you at, [Name]?"

STEP 4 — Once you have BOTH name and email, include this silently in your reply (invisible to user):
  [CONTACT:{"name":"FULL_NAME","email":"EMAIL"}]

STEP 5 — Do NOT push for a call. Let the customer finish asking all their questions first. Only offer to book when THEY seem ready or ask about next steps.

STEP 6 — When they agree to book and give a date/time:
  - Use today's real date (${dateStr}) to calculate the exact date
  - "Tomorrow" = tomorrow's actual date
  - Always state the real full date: e.g. "Thursday, April 3 at 10am"
  - Include this silently:
  [APPOINTMENT:{"name":"FULL_NAME","email":"EMAIL","datetime":"YYYY-MM-DDTHH:mm:ss","notes":"Free discovery call - Lhyn Works"}]

STEP 7 — Confirm the booking with the exact real date and time clearly.

===== TONE RULES =====
- Warm, human, friendly — like texting a knowledgeable friend
- Short replies — 2 to 4 sentences max unless explaining something complex
- Use the customer's name naturally once you know it
- Light emojis occasionally — not every message
- NEVER say "Certainly!", "Of course!", "Absolutely!" — sounds robotic
- NEVER say "$X" or "varies" — always give the real price
- NEVER say you don't have access to previous chats — you DO have the full history
- If you don't know something: "Let me have Lhyn check on that! You can also reach her at hello@lhynworks.com 😊"
- Available for calls: Mon–Fri, 9AM–6PM Manila time (flexible for US clients)`;
}

// ============================================================
// GET CONVERSATION HISTORY FROM GHL
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
    console.error("History fetch error:", err.response?.data || err.message);
    return [];
  }
}

// ============================================================
// SAVE CONTACT TO GHL CRM
// ============================================================
async function saveContact(name, email) {
  try {
    const parts = name.trim().split(" ");
    const firstName = parts[0];
    const lastName = parts.slice(1).join(" ") || "";
    const res = await axios.post(
      "https://services.leadconnectorhq.com/contacts/",
      { locationId: GHL_LOCATION_ID, firstName, lastName, email },
      { headers: GHL_HEADERS }
    );
    const id = res.data.contact?.id;
    console.log(`✅ Contact saved: ${name} / ${email} / ID: ${id}`);
    return id;
  } catch (err) {
    try {
      const search = await axios.get(
        `https://services.leadconnectorhq.com/contacts/?locationId=${GHL_LOCATION_ID}&email=${encodeURIComponent(email)}`,
        { headers: GHL_HEADERS }
      );
      const existing = search.data.contacts?.[0];
      if (existing) {
        await axios.put(
          `https://services.leadconnectorhq.com/contacts/${existing.id}`,
          {
            firstName: name.split(" ")[0],
            lastName: name.split(" ").slice(1).join(" ") || ""
          },
          { headers: GHL_HEADERS }
        );
        console.log(`✅ Existing contact updated: ${existing.id}`);
        return existing.id;
      }
    } catch (e) {
      console.error("Contact lookup error:", e.response?.data || e.message);
    }
  }
}

// ============================================================
// BOOK APPOINTMENT
// ============================================================
async function bookAppointment(name, email, datetime, notes) {
  try {
    const contactId = await saveContact(name, email);
    if (!contactId) {
      console.error("❌ No contactId — cannot book");
      return;
    }

    const startTime = new Date(datetime);
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

    console.log("📅 Booking:", JSON.stringify(payload));
    const res = await axios.post(
      "https://services.leadconnectorhq.com/calendars/events/appointments",
      payload,
      { headers: GHL_HEADERS }
    );
    console.log(`✅ Appointment booked! ID: ${res.data.id}`);
  } catch (err) {
    console.error("❌ Booking error:", JSON.stringify(err.response?.data) || err.message);
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

  // Init store for this conversation
  if (!contactStore[conversationId]) {
    contactStore[conversationId] = { name: null, email: null, saved: false };
  }
  const store = contactStore[conversationId];

  // Auto-detect email from current message
  const detectedEmail = extractEmail(message);
  if (detectedEmail && !store.email) {
    store.email = detectedEmail;
    console.log(`📧 Email auto-detected: ${detectedEmail}`);
  }

  // Use GHL contact_name if we don't have a name yet
  if (contact_name && !store.name && contact_name !== "undefined") {
    store.name = contact_name;
    console.log(`👤 Name from GHL: ${contact_name}`);
  }

  // Save to CRM immediately when we have both
  if (store.name && store.email && !store.saved) {
    await saveContact(store.name, store.email);
    store.saved = true;
  }

  try {
    const history = await getConversationHistory(conversationId);

    // Scan history for any emails we missed
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
        temperature: 0.75
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

    // Handle CONTACT tag from AI
    const contactMatch = aiReply.match(/\[CONTACT:({.*?})\]/s);
    if (contactMatch) {
      try {
        const parsed = JSON.parse(contactMatch[1]);
        if (parsed.name && !store.name) store.name = parsed.name;
        if (parsed.email && !store.email) store.email = parsed.email;
        if (store.name && store.email && !store.saved) {
          await saveContact(store.name, store.email);
          store.saved = true;
        }
      } catch (e) { console.error("Contact parse error", e); }
      aiReply = aiReply.replace(contactMatch[0], "").trim();
    }

    // Handle APPOINTMENT tag from AI
    const appointmentMatch = aiReply.match(/\[APPOINTMENT:({.*?})\]/s);
    if (appointmentMatch) {
      try {
        const appt = JSON.parse(appointmentMatch[1]);
        const name = appt.name || store.name;
        const email = appt.email || store.email;
        if (name && email) {
          await bookAppointment(name, email, appt.datetime, appt.notes);
        } else {
          console.error("❌ Missing name or email for appointment");
        }
      } catch (e) { console.error("Appointment parse error", e); }
      aiReply = aiReply.replace(appointmentMatch[0], "").trim();
    }

    await sendGHLMessage(conversationId, aiReply);
    res.json({ success: true });

  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: "Something went wrong" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🤖 Lhyn Works bot live on port ${PORT}`));
