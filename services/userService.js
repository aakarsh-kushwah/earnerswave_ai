// services/userService.js

import fetch from 'node-fetch';

/**
 * Fetches user profile details using an authentication token.
 * @param {string} token - The user's authentication token.
 * @returns {Promise<object|null>} The user profile object if successful, otherwise null.
 */
export async function getUserProfile(token) {
    if (!token) {
        return null; // Guest user
    }

    try {
        const profileRes = await fetch(`${process.env.REACT_APP_PROTOCOL}/api/user/user-profile-details`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (profileRes.ok) {
            const profileJson = await profileRes.json();
            if (profileJson?.status && profileJson.data) {
                return profileJson; // Successfully fetched profile
            }
        }
        return null; // Invalid token or response format
    } catch (err) {
        console.warn("Profile fetch failed, treating as guest. Error:", err.message);
        return null; // Error during fetch
    }
}