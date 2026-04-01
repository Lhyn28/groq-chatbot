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
// ✏️ PASTE YOUR WEBSITE CONTENT HERE
// Copy text from your website and paste it below
// ============================================================
const WEBSITE_KNOWLEDGE = `
You are a helpful assistant for Lhyn Works.

ABOUT:
[Paste your About section here]

SERVICES:
[Paste your Services here]

PRICING:
[Paste your Pricing here]

CONTACT:
[Paste your contact info here]
`;

// ============================================================
// SYSTEM PROMPT — Controls AI behavior
// ============================================================
const SYSTEM_PROMPT = `${WEBSITE_KNOWLEDGE}

Your job is to:
1. Answer questions about our services using the info above
2. Naturally collect the customer's NAME and EMAIL during conversation
3. Offer to schedule an appointment when appropriate

IMPORTANT RULES:
- Be friendly, professional, and concise
- Do NOT ask for name and email all at once — collect naturally
- Once you have BOTH name and email, include this EXACTLY in your reply (hidden from user display):
  [CONTACT:{"name":"FULL_NAME","email":"EMAIL"}]
- When customer wants to book and you have their name/email, ask for their preferred DATE and TIME
- Once you have date and time, include this EXACTLY:
  [APPOINTMENT:{"name":"FULL_NAME","email":"EMAIL","datetime":"YYYY-MM-DDTHH:mm:ss","notes":"reason for appointment"}]
- After including these tags, continue your reply naturally
- Available appointment times: Monday to Friday, 9AM to 5PM`;

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
    await axios.post(
      "https://services.leadconnectorhq.com/contacts/",
      {
        locationId: GHL_LOCATION_ID,
        firstName,
        lastName,
        email
      },
      { headers: GHL_HEADERS }
    );
    console.log(`✅ Contact saved: ${name} - ${email}`);
  } catch (err) {
    console.error("Contact save error:", err.response?.data || err.message);
  }
}

// ============================================================
// BOOK APPOINTMENT IN GHL CALENDAR
// ============================================================
async function bookAppointment(name, email, datetime, notes) {
  try {
    // First get or create contact
    const contactRes = await axios.post(
      "https://services.leadconnectorhq.com/contacts/",
      {
        locationId: GHL_LOCATION_ID,
        email,
        name
      },
      { headers: GHL_HEADERS }
    );
    const contactId = contactRes.data.contact?.id;

    // Book the appointment (1 hour slot)
    const startTime = new Date(datetime);
    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);

    await axios.post(
      "https://services.leadconnectorhq.com/calendars/events/appointments",
      {
        calendarId: GHL_CALENDAR_ID,
        locationId: GHL_LOCATION_ID,
        contactId,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        title: `Appointment with ${name}`,
        notes: notes || ""
      },
      { headers: GHL_HEADERS }
    );
    console.log(`✅ Appointment booked for ${name} at ${datetime}`);
  } catch (err) {
    console.error("Appointment error:", err.response?.data || err.message);
  }
}

// ============================================================
// SEND MESSAGE BACK TO GHL LIVE CHAT
// ============================================================
async function sendGHLMessage(conversationId, message) {
  await axios.post(
    "https://services.leadconnectorhq.com/conversations/messages",
    {
      conversationId,
      type: "Live_Chat",
      message
    },
    { headers: GHL_HEADERS }
  );
}

// ============================================================
// MAIN WEBHOOK HANDLER
// ============================================================
app.post("/webhook", async (req, res) => {
  const { message, conversationId, contact_name } = req.body;

  if (!message || !conversationId) {
    return res.status(400).json({ error: "Missing fields" });
  }

  try {
    // Get conversation history for context
    const history = await getConversationHistory(conversationId);

    // Call Groq AI
    const groqRes = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama3-8b-8192",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...history,
          { role: "user", content: `Customer (${contact_name}): ${message}` }
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

    // Check for CONTACT tag and save to CRM
    const contactMatch = aiReply.match(/\[CONTACT:({.*?})\]/);
    if (contactMatch) {
      const { name, email } = JSON.parse(contactMatch[1]);
      await saveContact(name, email);
      aiReply = aiReply.replace(contactMatch[0], "").trim();
    }

    // Check for APPOINTMENT tag and book it
    const appointmentMatch = aiReply.match(/\[APPOINTMENT:({.*?})\]/);
    if (appointmentMatch) {
      const { name, email, datetime, notes } = JSON.parse(appointmentMatch[1]);
      await bookAppointment(name, email, datetime, notes);
      aiReply = aiReply.replace(appointmentMatch[0], "").trim();
    }

    // Send clean reply to GHL
    await sendGHLMessage(conversationId, aiReply);

    res.json({ success: true });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: "Something went wrong" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🤖 Bot running on port ${PORT}`));
```

---

## 🔧 STEP 3 — Paste Your Website Content

In the script, find this section at the top:
```
const WEBSITE_KNOWLEDGE = `
```
Go to your website **[portfolio.lhynworks.com](https://portfolio.lhynworks.com)**, manually copy your:
- About / Bio
- Services you offer
- Pricing (if public)
- Contact details

And paste it in place of the `[Paste your... here]` placeholders.

---

## 🔧 STEP 4 — Push to GitHub → Railway Auto-Deploys

Once you save and push your updated `index.js`, Railway will automatically redeploy. Watch the **logs** in Railway to confirm it says:
```
🤖 Bot running on port XXXX
```

---

## 🎯 How It Will Work
```
Customer: "Hi, what services do you offer?"
AI: Answers based on your website ✅

Customer: "I'm John, john@email.com — I'd like to book"
AI: Saves contact to CRM ✅ + asks for date/time

Customer: "April 5, 2PM"
AI: Books appointment in your calendar ✅ + confirms
