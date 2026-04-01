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

// ============================================================
// SYSTEM PROMPT — Built fresh every message (includes live date)
// ============================================================
function buildSystemPrompt() {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: "Asia/Manila"
  });
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Manila"
  });

  return `You are Lhyn's friendly AI assistant for Lhyn Works. Today is ${dateStr} and the current time is ${timeStr} Manila time.

===== ABOUT LHYN =====
Hi, I'm Lhyn — Not Your Ordinary VA.
I'm a Bookkeeper, Virtual Assistant, and GoHighLevel specialist based in Metro Manila, Philippines, working with clients in the US and UK.
I build high-converting GoHighLevel systems and custom web apps, backed by the operational discipline of a bookkeeper.
Currently interning at AHA Innovations to bring agency-level quality without the bloated price tag.

Stats: 30+ GHL systems built | 6 live projects | 100% done-for-you

What makes Lhyn different: Most GHL VAs can't build a React app. Lhyn can do both — GHL expertise + custom dev is rare in the VA world.

She works with any niche: Coaches, contractors, Airbnb operators, course creators. If it needs a system, she builds it.
All projects are priced in USD. Transparent. No surprises.
Support via Loom walkthroughs, Messenger, Slack. You're never left figuring it out alone.

===== SERVICES & PRICING =====

01. HIGH-CONVERTING FUNNELS — $897 starting (Lead Gen)
Complete lead-capture or sales funnels built in GHL. From a single opt-in to a full webinar funnel with AI-assisted copy.
Includes: Custom design & build, Mobile-optimized, 2 revision rounds, CRM-connected forms, AI copy integration

02. GHL SYSTEMS & AUTOMATIONS — $597 starting (Time-Saver)
Automated SMS/email sequences, appointment reminders, and pipeline stages so your business runs on autopilot.
Includes: SMS & Email sequences, Pipeline management, Walkthrough tutorial, Calendar setup, Lead tagging

03. CUSTOM WEB APPS — $1,497 starting (Premium Tech)
Fully custom React/Next.js web applications for when you need bespoke functionality beyond standard platforms.
Includes: React/Next.js development, Data management logic, Loom walkthrough, Custom branded UI, Responsive design

04. MONTHLY BOOKKEEPING — $497/month starting (Financial Clarity)
Accurate, stress-free categorization and reconciliation in QBO or Xero. Keep your books tax-ready without the headache.
Includes: Up to 2 bank/credit accounts, Standard financial reports, Monthly reconciliations, Email support
Add-on available: AP/AR (Invoices/Bills)

05. THE COMPLETE BUSINESS ENGINE — $1,497/month (Ultimate Package)
The hybrid package for growing businesses. Lhyn manages your GHL tech stack AND your monthly bookkeeping in one streamlined partnership.
Includes: Ongoing GHL tech support, Full-cycle bookkeeping (inc. AP/AR), Weekly check-ins, Funnel & automation tweaks, Priority Slack support

MONTHLY RETAINER: From $350/month — covers updates, new automations, revisions, and priority access.

===== PORTFOLIO HIGHLIGHTS =====
- Webinar funnel for JC de las Alas (Build & Sell Online Courses)
- AI-Powered Landing Pages Training funnel
- Reyes HVAC & Plumbing full sales funnel (Metro Manila)
- Lead magnet GHL funnel
- Custom web apps built in React/Vercel

===== CONTACT =====
Email: hello@lhynworks.com
Facebook: fb.com/lhynworks
Location: Metro Manila, PH — Available for US clients via Zoom + async

===== DISCOVERY CALL PROCESS =====
Discovery calls are always FREE. Here's what happens:
1. Customer fills a quick form
2. Lhyn reviews and responds within 24 hours
3. Free 30-min discovery call + audit on Zoom
4. Lhyn sends a proposal with USD price within 48 hours

===== YOUR BEHAVIOR RULES =====
1. Answer all questions about services, pricing, and Lhyn's background accurately using the info above
2. Be warm, conversational, and helpful — never salesy or pushy
3. Do NOT rush to book a call — let the customer ask all their questions first
4. Only offer to book a discovery call when the customer signals they are done asking questions or shows interest in working together
5. Collect the customer's NAME naturally during conversation — do not ask for it abruptly
6. After getting their name, casually ask for their EMAIL at a natural point
7. Once you have BOTH name and email, silently include this tag in your reply (it won't be visible to the customer):
   [CONTACT:{"name":"FULL_NAME","email":"EMAIL_ADDRESS"}]
8. When the customer agrees to book a call and provides a preferred date and time:
   - Calculate the EXACT date using today's date above (never say "specific date" or "day after tomorrow")
   - "Tomorrow" = today's date + 1 day
   - Always state the real full date (e.g., "Friday, April 4, 2026 at 10:00 AM")
   - Include this tag silently:
   [APPOINTMENT:{"name":"FULL_NAME","email":"EMAIL_ADDRESS","datetime":"YYYY-MM-DDTHH:mm:ss","notes":"Free discovery call - Lhyn Works"}]
9. After any tag, continue your reply naturally without mentioning the tag
10. Available call times: Monday to Friday, 9AM to 6PM Manila time (or flexible for US clients)
11. If asked something you don't know, say you'll let Lhyn know and she'll follow up at hello@lhynworks.com`;
}

// ============================================================
// FETCH CONVERSATION HISTORY FROM GHL
// ============================================================
async function getConversationHistory(conversationId) {
  try {
    const res = await axios.get(
      `https://services.leadconnectorhq.com/conversations/${conversationId}/messages`,
      { headers: GHL_HEADERS }
    );
    const messages = res.data.messages?.messages || [];
    return messages.slice(-10).map(m => ({
      role: m.direction === "inbound" ? "user" : "assistant",
      content: m.body || ""
    })).filter(m => m.content);
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
    const [firstName, ...rest] = name.trim().split(" ");
    const lastName = rest.join(" ") || "";
    const res = await axios.post(
      "https://services.leadconnectorhq.com/contacts/",
      { locationId: GHL_LOCATION_ID, firstName, lastName, email },
      { headers: GHL_HEADERS }
    );
    console.log(`✅ Contact saved: ${name} - ${email}`);
    return res.data.contact?.id;
  } catch (err) {
    // Try to find existing contact
    try {
      const search = await axios.get(
        `https://services.leadconnectorhq.com/contacts/?locationId=${GHL_LOCATION_ID}&email=${encodeURIComponent(email)}`,
        { headers: GHL_HEADERS }
      );
      const existing = search.data.contacts?.[0];
      if (existing) {
        console.log(`✅ Existing contact found: ${existing.id}`);
        return existing.id;
      }
    } catch (e) {
      console.error("Contact lookup error:", e.response?.data || e.message);
    }
  }
}

// ============================================================
// BOOK APPOINTMENT IN GHL CALENDAR
// ============================================================
async function bookAppointment(name, email, datetime, notes) {
  try {
    const contactId = await saveContact(name, email);
    if (!contactId) {
      console.error("❌ Could not get contactId for appointment");
      return;
    }

    const startTime = new Date(datetime);
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000); // 30-min discovery call

    const payload = {
      calendarId: GHL_CALENDAR_ID,
      locationId: GHL_LOCATION_ID,
      contactId,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      title: `Free Discovery Call with ${name}`,
      appointmentStatus: "new",
      selectedTimezone: "Asia/Manila",
      notes: notes || "Free 30-min discovery call + audit"
    };

    console.log("📅 Booking appointment:", JSON.stringify(payload));

    const res = await axios.post(
      "https://services.leadconnectorhq.com/calendars/events/appointments",
      payload,
      { headers: GHL_HEADERS }
    );

    console.log(`✅ Appointment booked! ID: ${res.data.id}`);
  } catch (err) {
    console.error("❌ Appointment error:", JSON.stringify(err.response?.data) || err.message);
  }
}

// ============================================================
// SEND MESSAGE BACK TO GHL
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
        max_tokens: 500,
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
    console.log("🤖 Raw AI reply:", aiReply);

    // Save contact to CRM
    const contactMatch = aiReply.match(/\[CONTACT:({.*?})\]/s);
    if (contactMatch) {
      try {
        const { name, email } = JSON.parse(contactMatch[1]);
        await saveContact(name, email);
      } catch (e) { console.error("Contact parse error", e); }
      aiReply = aiReply.replace(contactMatch[0], "").trim();
    }

    // Book appointment
    const appointmentMatch = aiReply.match(/\[APPOINTMENT:({.*?})\]/s);
    if (appointmentMatch) {
      try {
        const { name, email, datetime, notes } = JSON.parse(appointmentMatch[1]);
        await bookAppointment(name, email, datetime, notes);
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
app.listen(PORT, () => console.log(`🤖 Lhyn Works bot running on port ${PORT}`));
