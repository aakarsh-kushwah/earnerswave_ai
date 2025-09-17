// services/dbService.js

import db from '../db.js';

/**
 * Saves a chat message for a REGISTERED user to the 'chats' table.
 */
async function saveRegisteredUserChat(userProfile, sender, message) {
    // Ensure we have a valid profile and message
    if (!message || !userProfile?.data?.unique_id) return;
    
    const userId = userProfile.data.unique_id;
    const userName = userProfile.data.first_name;
    const sql = "INSERT INTO chats (user_id, user_name, sender, message) VALUES (?, ?, ?, ?)";
    
    try {
        await db.promise().query(sql, [userId, userName, sender, message]);
        console.log(`✅ Chat saved for registered user: ${userId}`);
    } catch (err) {
        console.error("❌ DB Error - Failed to save registered chat:", err.message);
    }
}

/**
 * Saves a chat message for a GUEST user to the 'guest_chats' table.
 */
async function saveGuestUserChat(guestId, sender, message) {
    // Ensure we have a valid guestId and message
    if (!guestId || !message) return;
    
    const sql = "INSERT INTO guest_chats (guest_id, sender, message) VALUES (?, ?, ?)";
    
    try {
        await db.promise().query(sql, [guestId, sender, message]);
        console.log(`✅ Chat saved for guest user: ${guestId}`);
    } catch (err) {
        console.error("❌ DB Error - Failed to save guest chat:", err.message);
    }
}

/**
 * Universal function that decides where to save the chat message.
 * This is the only function you need to export and call from server.js.
 */
export async function saveChatMessage(isRegistered, profileOrGuestId, sender, message) {
    // Make sure the message isn't empty
    if (!message || message.trim() === '') return;

    if (isRegistered) {
        // If registered, pass the userProfile object
        await saveRegisteredUserChat(profileOrGuestId, sender, message);
    } else {
        // If a guest, pass the guestId string
        await saveGuestUserChat(profileOrGuestId, sender, message);
    }
}