const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GHL_API_KEY = process.env.GHL_API_KEY;

// Your custom AI personality — edit this!
const SYSTEM_PROMPT = `You are a friendly and professional customer support assistant. 
Answer customer questions helpfully and concisely.`;

app.post("/webhook", async (req, res) => {
  const { message, conversationId } = req.body;

  if (!message || !conversationId) {
    return res.status(400).json({ error: "Missing fields" });
  }

  try {
    // Call Groq AI
    const groqRes = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama3-8b-8192",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: message }
        ],
        max_tokens: 300
      },
      {
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const aiReply = groqRes.data.choices[0].message.content;

    // Send reply back to GHL
    await axios.post(
      "https://services.leadconnectorhq.com/conversations/messages",
      {
        conversationId,
        type: "Live_Chat",
        message: aiReply
      },
      {
        headers: {
          Authorization: `Bearer ${GHL_API_KEY}`,
          "Content-Type": "application/json",
          Version: "2021-04-15"
        }
      }
    );

    res.json({ success: true, reply: aiReply });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: "Something went wrong" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));
