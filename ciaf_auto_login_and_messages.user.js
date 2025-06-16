// ==UserScript==
// @name         Catinaflat Auto Login & Messages (Full Auto-Pilot)
// @namespace    http://tampermonkey.net/
// @version      1.6
// @description  Intelligently logs in, clears unread messages, closes popups, and navigates to the main board for monitoring.
// @author       CaitLye & Gemini
// @match        *://*.catinaflat.co.uk/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        window.alert
// @grant        window.prompt
// ==/UserScript==

(function() {
    'use strict';

    const STORE_EMAIL_KEY = 'catinaflat_email_b64';
    const STORE_PASSWORD_KEY = 'catinaflat_password_b64';

    function encodeBase64(str) { return btoa(unescape(encodeURIComponent(str))); }
    function decodeBase64(str) { return decodeURIComponent(escape(atob(str))); }

    function waitForElement(selector, timeout = 10000) {
        return new Promise(resolve => {
            const startTime = Date.now();
            const interval = setInterval(() => {
                const element = document.querySelector(selector);
                if (element) {
                    clearInterval(interval);
                    resolve(element);
                } else if (Date.now() - startTime > timeout) {
                    clearInterval(interval);
                    resolve(null);
                }
            }, 500);
        });
    }

    // Main execution function
    async function executeAutoPilot() {
        console.log('--- Auto-Pilot Script Started (Version 1.6) ---');

        // 等待一小段时间，确保页面元素（特别是动态加载的内容）渲染完成
        await new Promise(resolve => setTimeout(resolve, 2500));

        // ========================= 【新核心逻辑】 =========================
        //  第一优先级：检查并处理“Unread messages”列表
        const unreadMessageLink = document.querySelector('a.BookingSummary--unread-sitter');
        if (unreadMessageLink) {
            console.log('[ACTION_UNREAD] Unread message detected on the board. Clicking it to clear...');
            unreadMessageLink.click();
            console.log('--- Script Finished: Handled unread message. ---');
            return; // 点击后，页面会跳转，脚本任务完成
        }
        console.log('[CHECK] No priority unread messages found on the board.');
        // =================================================================

        // 检查是否已登录
        const messagesLinkIfLoggedIn = document.querySelector('a.Masthead-userNavItemInner--messages[href*="/bookings"]');

        if (messagesLinkIfLoggedIn) {
            console.log('[STATE_CHECK] User is logged in.');

            // 第二优先级：检查是否在特定的子页面，如果是，则导航回主看板
            const currentPagePath = window.location.pathname;
            if (currentPagePath.includes('/users/') || currentPagePath.includes('/edit/') || currentPagePath.includes('/inbox/')) {
                 console.log(`[ACTION_REDIRECT] On a specific sub-page (${currentPagePath}). Clicking "Messages" to return to the main board.`);
                messagesLinkIfLoggedIn.click();
            } else {
                console.log('[ACTION_CHECK] On main board. No action needed.');
            }
            console.log('--- Script Finished: Logged-in state handled. ---');
            return;
        }

        // 如果未登录，执行登录流程
        console.log('[STATE_CHECK] User not logged in, proceeding with login flow.');

        // 获取凭据
        let email = GM_getValue(STORE_EMAIL_KEY);
        let password = GM_getValue(STORE_PASSWORD_KEY);

        if (!email || !password) {
            window.alert('First run: please enter your login credentials. They will be encoded and stored locally.');
            email = window.prompt('Please enter your Catinaflat email address:');
            if (email) {
                password = window.prompt('Please enter your Catinaflat password:');
            }
            if (email && password) {
                GM_setValue(STORE_EMAIL_KEY, encodeBase64(email));
                GM_setValue(STORE_PASSWORD_KEY, encodeBase64(password));
            } else {
                return;
            }
        } else {
            email = decodeBase64(email);
            password = decodeBase64(password);
        }

        try {
            const loginLink = document.querySelector('a#login-link') || document.querySelector('a[href*="/login"]');
            if (!loginLink) throw new Error('Could not find the Login link.');
            loginLink.click();

            const emailField = await waitForElement('#email', 15000);
            if (!emailField) throw new Error('Email input field not found.');
            const passwordField = document.getElementById('password');
            const signInButton = document.querySelector('.Form-foot .Btn--secondary[type="submit"]');
            if (!passwordField || !signInButton) throw new Error('Failed to find all login form elements.');

            emailField.value = email;
            passwordField.value = password;
            emailField.dispatchEvent(new Event('input', { bubbles: true }));
            passwordField.dispatchEvent(new Event('input', { bubbles: true }));
            signInButton.click();

            const messagesLinkAfterLogin = await waitForElement('a.Masthead-userNavItemInner--messages[href*="/bookings"]', 25000);
            if (messagesLinkAfterLogin) {
                console.log('[POST_LOGIN] Login successful! Navigating to messages board...');
                messagesLinkAfterLogin.click();
            } else {
                throw new Error('Failed to find "Messages" link after login attempt.');
            }
        } catch (error) {
            console.error('[ERROR] Script encountered an error during login flow:', error.message);
            window.alert(`Script error: ${error.message}`);
        }
        console.log('--- Script Finished ---');
    }

    // 使用 DOMContentLoaded 会比 load 更早触发，可能更适合单页应用
    window.addEventListener('DOMContentLoaded', executeAutoPilot);

})();
