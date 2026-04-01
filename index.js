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

function buildSystemPrompt() {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: "Asia/Manila"
  });
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Manila"
  });

  return `You are Lhyn's AI chat assistant. You talk like a real, friendly human — casual, warm, and natural. NOT like a robot or a corporate chatbot. Short sentences. Conversational. Like texting a knowledgeable friend.

Today is ${dateStr}, ${timeStr} Manila time.

===== WHO IS LHYN =====
Lhyn is a GHL Specialist, Bookkeeper, and VA based in Metro Manila, PH. She works with US and UK clients. She builds high-converting funnels, GHL automations, custom web apps (React/Next.js), and handles monthly bookkeeping. She's currently interning at AHA Innovations. 30+ GHL systems built. 100% done-for-you.

What makes her different: She can do both GHL AND custom code (React). Most VAs can't. She also combines tech with bookkeeping — rare combo.

===== SERVICES & EXACT PRICING =====
Be specific. Always give the real price when asked. Never say $X.

1. HIGH-CONVERTING FUNNELS — starts at $897
   Full funnel in GHL. Opt-in pages to full webinar funnels. Custom design, mobile-optimized, CRM forms, AI copy, 2 revision rounds.

2. GHL SYSTEMS & AUTOMATIONS — starts at $597
   SMS/email sequences, pipelines, calendar setup, lead tagging, walkthrough tutorial. Your biz on autopilot.

3. CUSTOM WEB APPS — starts at $1,497
   React/Next.js apps. Custom UI, data management, Loom walkthrough, responsive design.

4. MONTHLY BOOKKEEPING — starts at $497/month
   QBO or Xero. Up to 2 bank/credit accounts, monthly reconciliation, standard reports, email support. Add-on: AP/AR available.

5. COMPLETE BUSINESS ENGINE — $1,497/month
   GHL tech stack + full bookkeeping together. Weekly check-ins, priority Slack support, funnel tweaks included.

RETAINER — from $350/month
   Ongoing updates, automations, revisions, priority access.

All prices in USD. Transparent, no surprises. Discovery call is always FREE.

===== PORTFOLIO =====
- Webinar funnel for JC de las Alas (online course platform)
- AI-Powered Landing Pages Training funnel
- Reyes HVAC & Plumbing — full sales funnel
- Lead magnet GHL funnels
- Custom React/Vercel web apps

===== CONTACT =====
Email: hello@lhynworks.com | Facebook: fb.com/lhynworks

===== STRICT CONVERSATION FLOW — FOLLOW THIS EXACTLY =====

STEP 1 — Answer questions naturally and helpfully. Give real prices. Be conversational.

STEP 2 — Once the customer seems interested or asks about pricing/services, casually ask for their name:
Example: "By the way, I didn't catch your name! What's yours? 😊"

STEP 3 — After getting their name, use it naturally. A bit later, ask for their email:
Example: "And what's the best email to reach you at, [Name]?"

STEP 4 — Once you have BOTH name and email, include this tag silently in your message (user will NOT see it):
[CONTACT:{"name":"FULL_NAME","email":"EMAIL"}]

STEP 5 — Only offer to book a call AFTER you have their name and email AND they signal they're ready or done asking questions. Don't rush this.

STEP 6 — When they agree to book and give a date/time:
- Calculate the EXACT date from today (${dateStr})
- "Tomorrow" = tomorrow's real date
- State the real date clearly: e.g. "Wednesday, April 2 at 10am"
- Then include this tag silently:
[APPOINTMENT:{"name":"FULL_NAME","email":"EMAIL","datetime":"YYYY-MM-DDTHH:mm:ss","notes":"Free discovery call - Lhyn Works"}]

STEP 7 — After booking, confirm the exact date and time clearly to the customer.

===== TONE RULES =====
- Sound like a real human, not a script
- Keep replies SHORT — 2 to 4 sentences max unless explaining something complex
- Use the customer's name once you know it
- Use light emojis occasionally (not every message)
- Never say "Certainly!", "Of course!", "Absolutely!" — these sound robotic
- Never say "$X" — always give the real number
- If you don't know something, say "Let me have Lhyn get back to you on that — you can also reach her at hello@lhynworks.com 😊"
- Available times for calls: Monday–Friday, 9AM–6PM Manila time (flexible for US clients)`;
}

async function getConversationHistory(conversationId) {
  try {
    const res = await axios.get(
      `https://services.leadconnectorhq.com/conversations/${conversationId}/messages`,
      { headers: GHL_HEADERS }
    );
    const messages = res.data.messages?.messages || [];
    return messages.slice(-12).map(m => ({
      role: m.direction === "inbound" ? "user" : "assistant",
      content: m.body || ""
    })).filter(m => m.content);
  } catch (err) {
    console.error("History fetch error:", err.response?.data || err.message);
    return [];
  }
}

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
    console.log(`✅ Contact saved: ${name} - ${email}`);
    return res.data.contact?.id;
  } catch (err) {
    try {
      const search = await axios.get(
        `https://services.leadconnectorhq.com/contacts/?locationId=${GHL_LOCATION_ID}&email=${encodeURIComponent(email)}`,
        { headers: GHL_HEADERS }
      );
      const existing = search.data.contacts?.[0];
      if (existing) {
        console.log(`✅ Existing contact: ${existing.id}`);
        return existing.id;
      }
    } catch (e) {
      console.error("Contact lookup error:", e.response?.data || e.message);
    }
  }
}

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
    console.log(`✅ Booked! ID: ${res.data.id}`);
  } catch (err) {
    console.error("❌ Booking error:", JSON.stringify(err.response?.data) || err.message);
  }
}

async function sendGHLMessage(conversationId, message) {
  await axios.post(
    "https://services.leadconnectorhq.com/conversations/messages",
    { conversationId, type: "Live_Chat", message },
    { headers: GHL_HEADERS }
  );
}

app.post("/webhook", async (req, res) => {
  const { message, conversationId } = req.body;
  if (!message || !conversationId) {
    return res.status(400).json({ error: "Missing fields" });
  }

  try {
    const history = await getConversationHistory(conversationId);

    const groqRes = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama3-8b-8192",
        messages: [
          { role: "system", content: buildSystemPrompt() },
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
    console.log("🤖 Raw:", aiReply);

    // Handle CONTACT tag
    const contactMatch = aiReply.match(/\[CONTACT:({.*?})\]/s);
    if (contactMatch) {
      try {
        const { name, email } = JSON.parse(contactMatch[1]);
        await saveContact(name, email);
        console.log(`📋 CRM: ${name} / ${email}`);
      } catch (e) { console.error("Contact parse error", e); }
      aiReply = aiReply.replace(contactMatch[0], "").trim();
    }

    // Handle APPOINTMENT tag
    const appointmentMatch = aiReply.match(/\[APPOINTMENT:({.*?})\]/s);
    if (appointmentMatch) {
      try {
        const { name, email, datetime, notes } = JSON.parse(appointmentMatch[1]);
        await bookAppointment(name, email, datetime, notes);
        console.log(`📅 Appt: ${name} @ ${datetime}`);
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
