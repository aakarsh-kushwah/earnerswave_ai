// server.js (Final Version)

import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import { Groq } from 'groq-sdk';
import fetch from 'node-fetch';
import { franc } from 'franc-min';

// --- Services ko import karein ---
import { saveChatMessage } from './services/dbService.js';
import { getUserProfile } from './services/userService.js';

// --- Baki imports ---
import { unregisteredUserPrompt, registeredUserPrompt, mediaPaths } from './arsha-prompts.js';

import db from './db.js';

dotenv.config();
const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(bodyParser.json());

// --- Helper Functions ---
const groqKeys = (process.env.GROQ_API_KEYS || '').split(',');
let currentKeyIndex = 0;
function getNextGroqInstance() {
    if (groqKeys.length === 0 || !groqKeys[0]) {
        throw new Error("GROQ_API_KEYS not found in .env file.");
    }
    const key = groqKeys[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % groqKeys.length;
    return new Groq({ apiKey: key });
}

function detectLanguage(message) {
    const langCode = franc(message);
    if (langCode === 'hin') return 'hi';
    if (langCode === 'eng') return 'en';
    return 'en';
}

function getSystemPrompt(isRegistered, userName, replyTo) {
    const basePrompt = isRegistered ? registeredUserPrompt : unregisteredUserPrompt;
    const nameInstruction = (userName && userName !== "Dost")
        ? `⚡ IMPORTANT RULE: The user's name is "${userName}". Address them by their name naturally and warmly in every reply.`
        : '';
    const smartAssistantRule = isRegistered
        ? `🧠 SMART ASSISTANT RULE: Aap user ki profile details (jaise naam, email, balance) aur unki team size fetch kar sakti hain. Isliye, user se yeh information dobara **kabhi na poochein**. Jab user iske baare mein baat kare, to aap directly unki details batayein.`
        : '';
    let replyToInstruction = '';
    if (replyTo) {
        const repliedRole = replyTo.role === 'user' ? 'User' : 'Arsha';
        replyToInstruction = `\n[CONTEXT: The user is replying to the following message]:\n"${repliedRole}: ${replyTo.content}"`;
    }
    return `${basePrompt}\n${nameInstruction}\n${smartAssistantRule}${replyToInstruction}`.trim();
}

function flattenMembers(members) {
    let allMembers = [];
    const traverse = (memberNode) => {
        if (memberNode.children && memberNode.children.length > 0) {
            memberNode.children.forEach(child => {
                allMembers.push(child);
                traverse(child);
            });
        }
    };
    if (Array.isArray(members)) {
        members.forEach(traverse);
    } else if (members) {
        traverse(members);
    }
    return allMembers;
}

// --- Request Handlers ---
async function handleProfileQuery({ token, userName, lastUserMessage, userLanguage, userProfile }) {
    if (!token) return { reply: userLanguage === 'hi' ? "⚠️ Login zaroori hai." : "⚠️ Please log in first." };
    if (!userProfile || !userProfile.data) return { reply: userLanguage === 'hi' ? "⚠️ Profile details fetch karne mein samasya aa rahi hai." : "⚠️ There was a problem fetching your profile details." };
    const u = userProfile.data;
    let reply = "";
    const balanceKeywords = ["balance", "paisa", "pese", "commission", "kamai"];
    if (balanceKeywords.some(k => lastUserMessage.includes(k))) { reply = userLanguage === 'hi' ? `${userName}, aapka current balance **₹${u.Balance}** hai.` : `Your current balance is **₹${u.Balance}**.`; }
    else if (lastUserMessage.includes("naam") || lastUserMessage.includes("name")) { reply = userLanguage === 'hi' ? `${userName}, aapka naam **${u.first_name}** hai.` : `Your name is **${u.first_name}**.`; }
    else if (lastUserMessage.includes("email")) { reply = userLanguage === 'hi' ? `${userName}, aapka email **${u.email}** hai.` : `Your email is **${u.email}**.`; }
    else if (lastUserMessage.includes("phone") || lastUserMessage.includes("number")) { reply = userLanguage === 'hi' ? `${userName}, aapka phone number **${u.phone_number}** hai.` : `Your phone number is **${u.phone_number}**.`; }
    else if (lastUserMessage.includes("id")) { reply = userLanguage === 'hi' ? `${userName}, aapki ID **${u.unique_id}** hai.` : `Your ID is **${u.unique_id}**.`; }
    else { reply = userLanguage === 'hi' ? `Yeh rahi aapki profile details, ${userName}:\n👤 Naam: ${u.first_name}\n📧 Email: ${u.email}\n📱 Phone: ${u.phone_number}\n💰 Balance: ₹${u.Balance}` : `Here are your profile details, ${userName}:\n👤 Name: ${u.first_name}\n📧 Email: ${u.email}\n📱 Phone: ${u.phone_number}\n💰 Balance: ₹${u.Balance}`; }
    return { reply, user: u };
}

async function handleDownlineQuery({ token, userName, userLanguage }) {
    if (!token) return { reply: userLanguage === 'hi' ? "⚠️ Team dekhne ke liye login zaroori hai." : "⚠️ Please log in first to view your team members." };
    try {
        const res = await fetch(`${process.env.REACT_APP_PROTOCOL}/api/user/downline-members`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(`API failed with status ${res.status}`);
        const data = await res.json();
        if (data?.status && data.data) {
            const members = flattenMembers(data.data);
            const reply = userLanguage === 'hi' ? `👥 ${userName}, aapki team mein total **${members.length}** members hain.` : `👥 ${userName}, your team has a total of **${members.length}** members.`;
            return { reply };
        }
        throw new Error("Invalid downline data format");
    } catch (err) {
        console.error("Downline API Error:", err);
        return { reply: userLanguage === 'hi' ? `${userName}, team members fetch karne me dikkat aa rahi hai.` : `${userName}, I faced an issue fetching your team members.` };
    }
}

async function handleMediaQuery({ userName, lastUserMessage }) {
    if (lastUserMessage.includes("combo") || lastUserMessage.includes("kit")) return { reply: `Bilkul ${userName}, yeh dekhiye hamara bestseller **Combo Kit**! [IMAGE: ${mediaPaths.images.comboKit}]` };
    if (lastUserMessage.includes("serum")) return { reply: `Yeh lijiye, hamare amazing **Gleam&Glam Face Serum** ki photo. [IMAGE: ${mediaPaths.images.faceSerum}]` };
    if (lastUserMessage.includes("wash")) return { reply: `Sure! Here's a picture of our refreshing **Face Wash**. [IMAGE: ${mediaPaths.images.faceWash}]` };
    if (lastUserMessage.includes("cream")) return { reply: `Zaroor, yeh dekhiye hamari **Face Cream**. [IMAGE: ${mediaPaths.images.faceCream}]` };
    if (lastUserMessage.includes("gel")) return { reply: `Here you go! This is our **Gel**. [IMAGE: ${mediaPaths.images.gel}]` };
    if (lastUserMessage.includes("lotion")) return { reply: `Of course, here is our **Body Lotion**. [IMAGE: ${mediaPaths.images.bodyLotion}]` };
    if (lastUserMessage.includes("anushka")) return { reply: `Yeh lijiye Anushka ka video. [VIDEO: ${mediaPaths.videos.anushkaVideo}]` };
    if (lastUserMessage.includes("harshita")) return { reply: `Yeh lijiye Harshita ka video. [VIDEO: ${mediaPaths.videos.harshitaVideo}]` };
    if (lastUserMessage.includes("pragati")) return { reply: `Yeh lijiye Pragati ka video. [VIDEO: ${mediaPaths.videos.pragatiVideo}]` };
    return null;
}

// --- Model Priority and Fallback Logic ---
const PRIMARY_MODELS = ['llama-3.3-70b-versatile', 'gemma2-9b-it'];
const FALLBACK_MODELS = [
    'openai/gpt-oss-120b',
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'openai/gpt-oss-20b',
    'moonshotai/kimi-k2-instruct-0905'
];
const ALL_AVAILABLE_MODELS = [...PRIMARY_MODELS, ...FALLBACK_MODELS];

async function handleDefaultAIResponse({ message, systemPromptContent }) {
    const groq = getNextGroqInstance();
    const recentMessages = message.slice(-6).map(({ role, content }) => ({ role, content }));
    const allMessages = [{ role: 'system', content: systemPromptContent }, ...recentMessages];
    for (const modelToTry of ALL_AVAILABLE_MODELS) {
        try {
            console.log(`🤖 Attempting to use model: ${modelToTry}`);
            const response = await groq.chat.completions.create({
                messages: allMessages,
                model: modelToTry,
                temperature: 0.7
            });
            if (response.choices[0]?.message?.content) {
                console.log(`✅ Success with model: ${modelToTry}`);
                return { reply: response.choices[0].message.content };
            }
        } catch (error) {
            console.error(`❌ Model ${modelToTry} failed. Trying next... Error: ${error.message}`);
        }
    }
    console.error("❌ All models failed. Sending a default fallback message.");
    return { reply: "I'm currently facing some technical difficulties. Please try again in a moment." };
}

// --- API Endpoint to Fetch Chat History ---
app.get('/chat-history', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
        if (token) {
            const userProfile = await getUserProfile(token);
            if (userProfile?.data?.unique_id) {
                const userId = userProfile.data.unique_id;
                const sql = "SELECT sender, message, timestamp FROM chats WHERE user_id = ? ORDER BY timestamp ASC";
                const [rows] = await db.promise().query(sql, [userId]);
                const history = rows.map(chat => ({
                    role: chat.sender,
                    content: chat.message,
                    timestamp: new Date(chat.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                }));
                return res.json({ history });
            }
        }
        return res.json({ history: [] });
    } catch (error) {
        console.error('Error fetching chat history:', error);
        res.status(500).json({ error: 'Failed to fetch chat history.' });
    }
});

// --- Main Chat Endpoint ---
app.post('/chat', async (req, res) => {
    try {
        const { message, token, isRegistered, replyTo, guestId } = req.body;
        if (!message || !Array.isArray(message) || message.length === 0) {
            return res.status(400).json({ error: 'Message array cannot be empty.' });
        }
        if (!isRegistered && !guestId) {
            return res.status(400).json({ error: 'Guest ID is required for non-registered users.' });
        }
        const lastUserMessage = message[message.length - 1].content;
        const userLanguage = detectLanguage(lastUserMessage);
        
        let userProfile = null;
        let userName = "Dost";

        if (isRegistered && token) {
            userProfile = await getUserProfile(token);
            userName = userProfile?.data?.first_name || "Dost";
        }

        const profileOrGuestId = isRegistered ? userProfile : guestId;
        await saveChatMessage(isRegistered, profileOrGuestId, 'user', lastUserMessage);

        const lastUserMessageLower = lastUserMessage.toLowerCase();
        const profileKeywords = ["mera naam", "my name", "email", "phone", "number", "id", "balance", "paisa", "pese", "commission", "kamai", "profile"];
        const downlineKeywords = ["downline", "team", "members", "network", "member"];
        const mediaKeywords = ["video", "image", "photo", "pic", "kit", "serum", "wash", "cream", "gel", "lotion", "tasveer", "chitra"];

        const isMediaQuery = mediaKeywords.some(k => lastUserMessageLower.includes(k));
        const isProfileQuery = isRegistered && profileKeywords.some(k => lastUserMessageLower.includes(k));
        const isDownlineQuery = isRegistered && downlineKeywords.some(k => lastUserMessageLower.includes(k));
        
        let responsePayload;

        if (isProfileQuery) {
            responsePayload = await handleProfileQuery({ token, userName, lastUserMessage: lastUserMessageLower, userLanguage, userProfile });
        } else if (isDownlineQuery) {
            responsePayload = await handleDownlineQuery({ token, userName, userLanguage });
        } else if (isMediaQuery) {
            responsePayload = await handleMediaQuery({ userName, lastUserMessage: lastUserMessageLower });
            if (!responsePayload) {
                const systemPromptContent = getSystemPrompt(isRegistered, userName, replyTo);
                responsePayload = await handleDefaultAIResponse({ message, systemPromptContent });
            }
        } else {
            const systemPromptContent = getSystemPrompt(isRegistered, userName, replyTo);
            responsePayload = await handleDefaultAIResponse({ message, systemPromptContent });
        }

        if (responsePayload.reply) {
            // THIS IS THE ONLY LINE THAT WAS CHANGED
            await saveChatMessage(isRegistered, profileOrGuestId, 'arsha', responsePayload.reply);
        }

        res.json(responsePayload);
    } catch (error) {
        console.error('Unhandled API Error:', error);
        res.status(500).json({ error: 'Failed to process your request. Please try again.' });
    }
});

app.listen(port, () => {
    console.log(`🚀 Arsha's server running on http://localhost:${port}`);
});