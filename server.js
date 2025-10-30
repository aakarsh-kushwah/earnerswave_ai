import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Groq } from 'groq-sdk';
import fetch from 'node-fetch';
import { franc } from 'franc-min';

// --- Services & DB ---
import { saveChatMessage } from './services/dbService.js';
import { getUserProfile } from './services/userService.js';
import { unregisteredUserPrompt, registeredUserPrompt, mediaPaths } from './arsha-prompts.js';
import db from './db.js';

// --- CONFIGURATION ---
dotenv.config();
const app = express();
const port = process.env.PORT || 5000;

// --- CORE MIDDLEWARE ---

// Helmet for essential security headers
app.use(helmet());

// CORS configuration
app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000', // Restrict to your frontend URL in production
}));

// Body parser for JSON requests
app.use(bodyParser.json());

// Rate limiter to prevent abuse
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again after 15 minutes." },
});
app.use(apiLimiter);


// --- AI MODEL CONFIGURATION ---
const PRIMARY_MODELS = ['llama-3.3-70b-versatile', 'gemma2-9b-it'];
const FALLBACK_MODELS = ['openai/gpt-oss-120b', 'meta-llama/llama-4-scout-17b-16e-instruct', 'openai/gpt-oss-20b','moonshotai/kimi-k2-instruct-0905'];
const ALL_AVAILABLE_MODELS = [...PRIMARY_MODELS, ...FALLBACK_MODELS];

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

// --- BUSINESS LOGIC (SERVICES) ---

/**
 * Detects language of a message (Hindi or English).
 * @param {string} message - The user's message.
 * @returns {'hi' | 'en'} - The detected language code.
 */
function detectLanguage(message) {
    const langCode = franc(message);
    return langCode === 'hin' ? 'hi' : 'en';
}

/**
 * Constructs the system prompt for the AI model.
 * @param {boolean} isRegistered - Whether the user is logged in.
 * @param {string} userName - The user's name.
 * @param {object} replyTo - The message being replied to.
 * @returns {string} The complete system prompt.
 */
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

/**
 * Handles profile-related queries using keywords.
 */
async function handleProfileQuery({ token, userName, lastUserMessage, userLanguage, userProfile }) {
    // ... (This function remains the same as your original code)
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

/**
 * Handles downline/team-related queries.
 */
async function handleDownlineQuery({ token, userName, userLanguage }) {
    // ... (This function remains the same as your original code, but could be improved with better error handling)
    if (!token) return { reply: userLanguage === 'hi' ? "⚠️ Team dekhne ke liye login zaroori hai." : "⚠️ Please log in first to view your team members." };
    try {
        const res = await fetch(`${process.env.REACT_APP_PROTOCOL}/api/user/downline-members`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(`API failed with status ${res.status}`);
        const data = await res.json();
        const flattenMembers = (members) => { /* Helper function inside or outside */ return []; }; // Define or import your flattenMembers logic
        const members = flattenMembers(data.data);
        return { reply: userLanguage === 'hi' ? `👥 ${userName}, aapki team mein total **${members.length}** members hain.` : `👥 ${userName}, your team has a total of **${members.length}** members.` };
    } catch (err) {
        console.error("Downline API Error:", err);
        return { reply: userLanguage === 'hi' ? `${userName}, team members fetch karne me dikkat aa rahi hai.` : `${userName}, I faced an issue fetching your team members.` };
    }
}


/**
 * Handles media-related queries.
 */
async function handleMediaQuery({ userName, lastUserMessage }) {
    // ... (This function remains the same as your original code)
    if (lastUserMessage.includes("combo") || lastUserMessage.includes("kit")) return { reply: `Bilkul ${userName}, yeh dekhiye hamara bestseller **Combo Kit**! [IMAGE: ${mediaPaths.images.comboKit}]` };
    if (lastUserMessage.includes("serum")) return { reply: `Yeh lijiye, hamare amazing **Gleam&Glam Face Serum** ki photo. [IMAGE: ${mediaPaths.images.faceSerum}]` };
    if (lastUserMessage.includes("anushka")) return { reply: `Yeh lijiye Anushka ka video. [VIDEO: ${mediaPaths.videos.anushkaVideo}]` };
    return null;
}

/**
 * Gets a response from the AI, trying primary models first, then fallbacks.
 * This is the high-performance "failover" logic for production.
 */
async function handleDefaultAIResponse({ message, systemPromptContent }) {
    const recentMessages = message.slice(-6).map(({ role, content }) => ({ role, content }));
    const allMessages = [{ role: 'system', content: systemPromptContent }, ...recentMessages];

    for (const modelToTry of ALL_AVAILABLE_MODELS) {
        try {
            console.log(`🤖 Attempting to use model: ${modelToTry}`);
            const groq = getNextGroqInstance();
            const response = await groq.chat.completions.create({
                messages: allMessages,
                model: modelToTry,
                temperature: 0.7,
            });
            if (response.choices[0]?.message?.content) {
                console.log(`✅ Success with model: ${modelToTry}`);
                return { reply: response.choices[0].message.content };
            }
        } catch (error) {
            const errorMessage = error?.error?.error?.message || error.message;
            console.error(`❌ Model ${modelToTry} failed. Trying next... Error: ${errorMessage}`);
        }
    }
    
    // This is the final fallback if ALL models fail
    console.error("❌ All models failed. Sending a default fallback message.");
    throw new Error("All AI models are currently unavailable.");
}


// --- ROUTE HANDLERS (CONTROLLERS) ---

/**
 * Controller to handle fetching chat history.
 */
const getChatHistory = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
        let history = [];

        if (token) {
            const userProfile = await getUserProfile(token);
            if (userProfile?.data?.unique_id) {
                const userId = userProfile.data.unique_id;
                const sql = "SELECT sender, message, created_at FROM chats WHERE user_id = ? ORDER BY created_at ASC";
                const [rows] = await db.promise().query(sql, [userId]);
                history = rows.map(chat => ({
                    role: chat.sender,
                    content: chat.message,
                    timestamp: new Date(chat.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                }));
            }
        }
        res.json({ history });
    } catch (error) {
        next(error); // Pass errors to the global error handler
    }
};

/**
 * Controller to handle incoming chat messages.
 */
const postChatMessage = async (req, res, next) => {
    try {
        const { message, token, isRegistered, replyTo, guestId } = req.body;
        const lastUserMessage = message[message.length - 1].content;
        const userLanguage = detectLanguage(lastUserMessage);
        
        let userProfile = null;
        let userName = "Dost";

        if (isRegistered && token) {
            userProfile = await getUserProfile(token);
            userName = userProfile?.data?.first_name || "Dost";
        }

        await saveChatMessage(userProfile, guestId, 'user', lastUserMessage);

        const lastUserMessageLower = lastUserMessage.toLowerCase();
        const profileKeywords = ["profile", "balance", "paisa", "kamai"];
        const downlineKeywords = ["downline", "team", "members"];
        const mediaKeywords = ["video", "image", "photo", "kit", "serum"];

        const isProfileQuery = isRegistered && profileKeywords.some(k => lastUserMessageLower.includes(k));
        const isDownlineQuery = isRegistered && downlineKeywords.some(k => lastUserMessageLower.includes(k));
        const isMediaQuery = mediaKeywords.some(k => lastUserMessageLower.includes(k));

        let responsePayload;

        if (isProfileQuery) {
            responsePayload = await handleProfileQuery({ token, userName, lastUserMessage: lastUserMessageLower, userLanguage, userProfile });
        } else if (isDownlineQuery) {
            responsePayload = await handleDownlineQuery({ token, userName, userLanguage });
        } else if (isMediaQuery) {
            responsePayload = await handleMediaQuery({ userName, lastUserMessage: lastUserMessageLower });
            if (!responsePayload) { // If media keyword was found but no specific media, fallback to AI
                const systemPromptContent = getSystemPrompt(isRegistered, userName, replyTo);
                responsePayload = await handleDefaultAIResponse({ message, systemPromptContent });
            }
        } else {
            const systemPromptContent = getSystemPrompt(isRegistered, userName, replyTo);
            responsePayload = await handleDefaultAIResponse({ message, systemPromptContent });
        }

        if (responsePayload.reply) {
            await saveChatMessage(userProfile, guestId, 'arsha', responsePayload.reply);
        }

        res.json(responsePayload);
    } catch (error) {
        next(error); // Pass errors to the global error handler
    }
};

/**
 * Middleware for validating the chat request body.
 */
const validateChatRequest = (req, res, next) => {
    const { message, isRegistered, guestId } = req.body;
    if (!message || !Array.isArray(message) || message.length === 0) {
        return res.status(400).json({ error: 'Message array cannot be empty.' });
    }
    if (!isRegistered && !guestId) {
        return res.status(400).json({ error: 'Guest ID is required for non-registered users.' });
    }
    next();
};


// --- ROUTES ---
app.get('/chat-history', getChatHistory);
app.post('/chat', validateChatRequest, postChatMessage);


// --- GLOBAL ERROR HANDLER ---
// This middleware will catch any error passed to `next()`
app.use((err, req, res, next) => {
    console.error('Unhandled API Error:', err.stack);
    res.status(500).json({ 
        error: 'An unexpected error occurred. Please try again.' 
    });
});


// --- SERVER INITIALIZATION ---
app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Arsha's server running on port: ${port}`);
    console.log(`✅ Arsha connected to live DB via connection pool`);
});